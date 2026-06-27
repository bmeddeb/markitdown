#!/usr/bin/env python3 -m pytest

from markitdown.web.server import (
    UploadedFile,
    convert_uploads,
    format_upload_size,
    markdown_filename,
    parse_multipart_form,
    parse_max_upload_mb,
    sanitize_filename,
)


def test_sanitize_filename_strips_paths_and_controls() -> None:
    assert sanitize_filename("../../report.pdf") == "report.pdf"
    assert sanitize_filename("C:\\Users\\Ada\\notes.txt") == "notes.txt"
    assert sanitize_filename("\x00") == "upload"


def test_markdown_filename_replaces_extension() -> None:
    assert markdown_filename("report.pdf") == "report.md"
    assert markdown_filename("archive") == "archive.md"


def test_parse_max_upload_mb_returns_bytes() -> None:
    assert parse_max_upload_mb("100") == 100 * 1024 * 1024
    assert parse_max_upload_mb("0") == 0
    assert parse_max_upload_mb("1.5") == int(1.5 * 1024 * 1024)


def test_format_upload_size_is_human_readable() -> None:
    assert format_upload_size(100 * 1024 * 1024) == "100 MiB (104857600 bytes)"
    assert format_upload_size(0) == "unlimited"


def test_parse_multipart_form_collects_fields_and_files() -> None:
    boundary = "----markitdown-test"
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="keep_data_uris"\r\n\r\n'
        "true\r\n"
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="files"; filename="notes.txt"\r\n'
        "Content-Type: text/plain\r\n\r\n"
        "hello from upload\r\n"
        f"--{boundary}--\r\n"
    ).encode("utf-8")

    form = parse_multipart_form(
        body,
        f"multipart/form-data; boundary={boundary}",
    )

    assert form.fields["keep_data_uris"] == ["true"]
    assert len(form.files) == 1
    assert form.files[0].filename == "notes.txt"
    assert form.files[0].content_type == "text/plain"
    assert form.files[0].charset is None
    assert form.files[0].data == b"hello from upload"


def test_convert_uploads_converts_each_plain_text_file() -> None:
    result = convert_uploads(
        [
            UploadedFile(
                filename="one.txt",
                content_type="text/plain",
                charset=None,
                data=b"# One\n\nfirst file",
            ),
            UploadedFile(
                filename="two.md",
                content_type="text/markdown",
                charset=None,
                data=b"# Two\n\nsecond file",
            ),
        ]
    )

    assert result["summary"] == {"total": 2, "converted": 2, "failed": 0}
    assert result["files"][0]["output_filename"] == "one.md"
    assert "# One" in result["files"][0]["markdown"]
    assert result["files"][1]["output_filename"] == "two.md"
    assert "# Two" in result["files"][1]["markdown"]


def test_convert_uploads_handles_utf8_text_without_charset() -> None:
    result = convert_uploads(
        [
            UploadedFile(
                filename="unicode.md",
                content_type="text/markdown",
                charset=None,
                data="# Unicode\n\n– smart dash".encode("utf-8"),
            )
        ]
    )

    assert result["summary"] == {"total": 1, "converted": 1, "failed": 0}
    assert "– smart dash" in result["files"][0]["markdown"]
