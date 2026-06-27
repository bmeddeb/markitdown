# SPDX-FileCopyrightText: 2024-present Adam Fourney <adamfo@microsoft.com>
#
# SPDX-License-Identifier: MIT

from __future__ import annotations

import argparse
import io
import json
import mimetypes
import os
import re
import sys
import webbrowser
from dataclasses import dataclass
from email import policy
from email.parser import BytesParser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.resources import files
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlparse

from charset_normalizer import from_bytes

from markitdown import MarkItDown, StreamInfo


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8484
MAX_UPLOAD_BYTES = int(
    os.getenv("MARKITDOWN_WEB_MAX_UPLOAD_BYTES", str(100 * 1024 * 1024))
)


@dataclass(frozen=True)
class UploadedFile:
    filename: str
    content_type: str | None
    charset: str | None
    data: bytes


@dataclass(frozen=True)
class MultipartForm:
    fields: Mapping[str, list[str]]
    files: list[UploadedFile]


def parse_multipart_form(body: bytes, content_type: str) -> MultipartForm:
    """Parse a multipart/form-data request body into fields and uploaded files."""

    if not content_type.lower().startswith("multipart/form-data"):
        raise ValueError("Expected multipart/form-data.")

    message = BytesParser(policy=policy.default).parsebytes(
        b"Content-Type: " + content_type.encode("utf-8") + b"\r\n"
        b"MIME-Version: 1.0\r\n\r\n" + body
    )
    if not message.is_multipart():
        raise ValueError("Malformed multipart/form-data payload.")

    fields: dict[str, list[str]] = {}
    uploads: list[UploadedFile] = []

    for part in message.iter_parts():
        if part.get_content_disposition() != "form-data":
            continue

        name = part.get_param("name", header="content-disposition")
        if not name:
            continue

        payload = part.get_payload(decode=True)
        if payload is None:
            value = part.get_content()
            payload = value.encode(part.get_content_charset() or "utf-8")

        filename = part.get_filename()
        if filename is not None:
            if len(payload) == 0:
                continue
            uploads.append(
                UploadedFile(
                    filename=sanitize_filename(filename),
                    content_type=normalize_content_type(part.get_content_type()),
                    charset=normalize_charset(part.get_content_charset()),
                    data=payload,
                )
            )
        else:
            fields.setdefault(name, []).append(
                payload.decode(part.get_content_charset() or "utf-8", errors="replace")
            )

    return MultipartForm(fields=fields, files=uploads)


def convert_uploads(
    uploads: list[UploadedFile],
    *,
    keep_data_uris: bool = False,
    enable_plugins: bool = False,
) -> dict[str, Any]:
    markitdown = MarkItDown(enable_plugins=enable_plugins)
    converted = [
        convert_upload(
            upload,
            markitdown=markitdown,
            keep_data_uris=keep_data_uris,
        )
        for upload in uploads
    ]
    return {
        "files": converted,
        "summary": {
            "total": len(converted),
            "converted": sum(1 for item in converted if item["status"] == "converted"),
            "failed": sum(1 for item in converted if item["status"] == "failed"),
        },
    }


def convert_upload(
    upload: UploadedFile,
    *,
    markitdown: MarkItDown,
    keep_data_uris: bool,
) -> dict[str, Any]:
    stream_info = StreamInfo(
        filename=upload.filename,
        extension=Path(upload.filename).suffix or None,
        mimetype=upload.content_type,
        charset=infer_text_charset(upload),
    )

    try:
        result = markitdown.convert_stream(
            io.BytesIO(upload.data),
            stream_info=stream_info,
            keep_data_uris=keep_data_uris,
        )
        markdown = result.markdown
        return {
            "status": "converted",
            "filename": upload.filename,
            "output_filename": markdown_filename(upload.filename),
            "title": result.title,
            "markdown": markdown,
            "size": len(upload.data),
            "characters": len(markdown),
        }
    except Exception as exc:
        return {
            "status": "failed",
            "filename": upload.filename,
            "output_filename": markdown_filename(upload.filename),
            "error": type(exc).__name__,
            "message": str(exc),
            "size": len(upload.data),
        }


def sanitize_filename(filename: str) -> str:
    base = filename.replace("\\", "/").rsplit("/", 1)[-1]
    base = re.sub(r"[\x00-\x1f\x7f]", "", base).strip()
    return base or "upload"


def markdown_filename(filename: str) -> str:
    clean = sanitize_filename(filename)
    stem, _ = os.path.splitext(clean)
    return f"{stem or clean}.md"


def normalize_content_type(content_type: str | None) -> str | None:
    if not content_type or content_type == "application/octet-stream":
        return None
    return content_type


def normalize_charset(charset: str | None) -> str | None:
    if not charset:
        return None
    return charset.strip().lower() or None


def infer_text_charset(upload: UploadedFile) -> str | None:
    if upload.charset is not None:
        return upload.charset

    extension = Path(upload.filename).suffix.lower()
    content_type = (upload.content_type or "").lower()
    is_text = (
        content_type.startswith("text/")
        or content_type in ("application/json", "application/markdown")
        or extension in (
            ".txt",
            ".text",
            ".md",
            ".markdown",
            ".json",
            ".jsonl",
            ".csv",
            ".xml",
        )
    )
    if not is_text:
        return None

    best = from_bytes(upload.data).best()
    if best is None or best.encoding is None:
        return None
    return best.encoding.lower()


def form_bool(form: MultipartForm, name: str, *, default: bool = False) -> bool:
    values = form.fields.get(name)
    if not values:
        return default
    return values[-1].strip().lower() in ("1", "true", "yes", "on")


class MarkItDownWebHandler(BaseHTTPRequestHandler):
    server_version = "MarkItDownWeb/0.1"

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/health":
            self._send_json({"ok": True})
            return

        static_path = {
            "/": "index.html",
            "/assets/app.css": "assets/app.css",
            "/assets/app.js": "assets/app.js",
        }.get(path)

        if static_path is None:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        self._send_static(static_path)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path != "/api/convert":
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        content_length_header = self.headers.get("Content-Length")
        if content_length_header is None:
            self.send_error(HTTPStatus.LENGTH_REQUIRED)
            return

        try:
            content_length = int(content_length_header)
        except ValueError:
            self.send_error(HTTPStatus.BAD_REQUEST, "Invalid Content-Length.")
            return

        if content_length > MAX_UPLOAD_BYTES:
            self._send_json(
                {
                    "error": "PayloadTooLarge",
                    "message": f"Upload is larger than {MAX_UPLOAD_BYTES} bytes.",
                },
                status=HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
            )
            return

        try:
            body = self.rfile.read(content_length)
            form = parse_multipart_form(body, self.headers.get("Content-Type", ""))
        except ValueError as exc:
            self._send_json(
                {"error": "BadRequest", "message": str(exc)},
                status=HTTPStatus.BAD_REQUEST,
            )
            return

        if len(form.files) == 0:
            self._send_json(
                {"error": "NoFiles", "message": "No files were uploaded."},
                status=HTTPStatus.BAD_REQUEST,
            )
            return

        payload = convert_uploads(
            form.files,
            keep_data_uris=form_bool(form, "keep_data_uris"),
            enable_plugins=form_bool(form, "enable_plugins"),
        )
        self._send_json(payload)

    def _send_json(
        self, payload: Mapping[str, Any], *, status: HTTPStatus = HTTPStatus.OK
    ) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_static(self, relative_path: str) -> None:
        resource = files("markitdown.web.static").joinpath(relative_path)
        try:
            body = resource.read_bytes()
        except FileNotFoundError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        content_type = mimetypes.guess_type(relative_path)[0] or "application/octet-stream"
        if content_type.startswith("text/") or relative_path.endswith(".js"):
            content_type += "; charset=utf-8"

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)


def run_server(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT, *, open_browser: bool = False) -> None:
    httpd = ThreadingHTTPServer((host, port), MarkItDownWebHandler)
    actual_host, actual_port = httpd.server_address[:2]
    url = f"http://{actual_host}:{actual_port}/"

    print(f"MarkItDown Web is running at {url}")
    print("Press Ctrl+C to stop.")

    if open_browser:
        webbrowser.open(url)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping MarkItDown Web...")
    finally:
        httpd.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the local MarkItDown browser UI.")
    parser.add_argument(
        "--host", default=DEFAULT_HOST, help=f"Host to bind to (default: {DEFAULT_HOST})"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"Port to listen on (default: {DEFAULT_PORT})",
    )
    parser.add_argument("--open", action="store_true", help="Open the UI in the default browser.")
    args = parser.parse_args()

    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print(
            "\n"
            "WARNING: markitdown-web has no authentication and runs with your user's "
            "privileges. Binding to a non-localhost interface can expose uploaded "
            "content and conversion results to other machines.\n",
            file=sys.stderr,
        )

    run_server(args.host, args.port, open_browser=args.open)
