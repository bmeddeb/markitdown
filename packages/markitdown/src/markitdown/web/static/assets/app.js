const fileInput = document.querySelector("#fileInput");
const chooseFilesButton = document.querySelector("#chooseFilesButton");
const uploadForm = document.querySelector("#uploadForm");
const convertButton = document.querySelector("#convertButton");
const clearButton = document.querySelector("#clearButton");
const fileList = document.querySelector("#fileList");
const markdownPreview = document.querySelector("#markdownPreview");
const renderedPreview = document.querySelector("#renderedPreview");
const previewMeta = document.querySelector("#previewMeta");
const runSummary = document.querySelector("#runSummary");
const statusPill = document.querySelector("#statusPill");
const keepDataUris = document.querySelector("#keepDataUris");
const enablePlugins = document.querySelector("#enablePlugins");
const copyButton = document.querySelector("#copyButton");
const downloadButton = document.querySelector("#downloadButton");
const downloadAllButton = document.querySelector("#downloadAllButton");
const markdownModeButton = document.querySelector("#markdownModeButton");
const previewModeButton = document.querySelector("#previewModeButton");

const state = {
  files: [],
  results: [],
  selectedId: null,
  converting: false,
  outputMode: "markdown",
};

chooseFilesButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => addFiles(fileInput.files));
uploadForm.addEventListener("submit", convertFiles);
clearButton.addEventListener("click", clearFiles);
copyButton.addEventListener("click", copySelectedMarkdown);
downloadButton.addEventListener("click", downloadSelectedMarkdown);
downloadAllButton.addEventListener("click", downloadAllMarkdown);
markdownModeButton.addEventListener("click", () => setOutputMode("markdown"));
previewModeButton.addEventListener("click", () => setOutputMode("preview"));

for (const eventName of ["dragenter", "dragover"]) {
  chooseFilesButton.addEventListener(eventName, (event) => {
    event.preventDefault();
    chooseFilesButton.classList.add("is-dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  chooseFilesButton.addEventListener(eventName, (event) => {
    event.preventDefault();
    chooseFilesButton.classList.remove("is-dragging");
  });
}

chooseFilesButton.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));

function addFiles(fileListObject) {
  const nextFiles = Array.from(fileListObject || []).map((file) => ({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    file,
    status: "ready",
  }));

  state.files = [...state.files, ...nextFiles];
  state.results = [];
  if (!state.selectedId && state.files.length > 0) {
    state.selectedId = state.files[0].id;
  }
  fileInput.value = "";
  render();
}

function clearFiles() {
  state.files = [];
  state.results = [];
  state.selectedId = null;
  state.converting = false;
  render();
}

function setOutputMode(mode) {
  state.outputMode = mode;
  renderPreview();
}

async function convertFiles(event) {
  event.preventDefault();
  if (state.files.length === 0 || state.converting) {
    return;
  }

  state.converting = true;
  state.results = [];
  state.files = state.files.map((entry) => ({ ...entry, status: "working" }));
  render();

  const formData = new FormData();
  for (const entry of state.files) {
    formData.append("files", entry.file, entry.file.name);
  }
  formData.append("keep_data_uris", keepDataUris.checked ? "true" : "false");
  formData.append("enable_plugins", enablePlugins.checked ? "true" : "false");

  try {
    const response = await fetch("/api/convert", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || "Conversion failed.");
    }

    state.results = payload.files.map((result, index) => ({
      ...result,
      id: state.files[index]?.id || `${Date.now()}-${index}`,
    }));
    state.files = state.files.map((entry, index) => ({
      ...entry,
      status: state.results[index]?.status || "failed",
    }));
    const firstConverted = state.results.find((result) => result.status === "converted");
    state.selectedId = firstConverted?.id || state.results[0]?.id || state.selectedId;
    runSummary.textContent = `${payload.summary.converted} converted, ${payload.summary.failed} failed`;
  } catch (error) {
    runSummary.textContent = error.message;
    state.files = state.files.map((entry) => ({ ...entry, status: "failed" }));
    state.results = state.files.map((entry) => ({
      id: entry.id,
      status: "failed",
      filename: entry.file.name,
      output_filename: `${stripExtension(entry.file.name)}.md`,
      message: error.message,
      size: entry.file.size,
    }));
  } finally {
    state.converting = false;
    render();
  }
}

function render() {
  convertButton.disabled = state.files.length === 0 || state.converting;
  clearButton.disabled = state.files.length === 0 || state.converting;
  keepDataUris.disabled = state.converting;
  enablePlugins.disabled = state.converting;

  if (!state.converting && state.results.length === 0) {
    runSummary.textContent = state.files.length ? `${state.files.length} selected` : "Ready";
  }

  renderFileList();
  renderPreview();
}

function renderFileList() {
  fileList.innerHTML = "";
  if (state.files.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Ready";
    fileList.append(empty);
    return;
  }

  for (const entry of state.files) {
    const result = state.results.find((item) => item.id === entry.id);
    const status = result?.status || entry.status;
    const row = document.createElement("button");
    row.className = `file-row ${state.selectedId === entry.id ? "is-selected" : ""}`;
    row.type = "button";
    row.addEventListener("click", () => {
      state.selectedId = entry.id;
      render();
    });

    row.innerHTML = `
      <svg class="file-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v5h5"></path></svg>
      <span>
        <span class="file-name">${escapeHtml(entry.file.name)}</span>
        <span class="file-details">${formatBytes(entry.file.size)}${result?.characters ? ` · ${result.characters.toLocaleString()} chars` : ""}</span>
      </span>
      <span class="row-status ${status}">${statusLabel(status)}</span>
    `;
    fileList.append(row);
  }
}

function renderPreview() {
  const selectedResult = state.results.find((result) => result.id === state.selectedId);
  const selectedFile = state.files.find((entry) => entry.id === state.selectedId);
  const convertedResults = state.results.filter((result) => result.status === "converted");

  copyButton.disabled = !selectedResult || selectedResult.status !== "converted";
  downloadButton.disabled = !selectedResult || selectedResult.status !== "converted";
  downloadAllButton.disabled = convertedResults.length === 0;
  markdownModeButton.classList.toggle("is-active", state.outputMode === "markdown");
  previewModeButton.classList.toggle("is-active", state.outputMode === "preview");
  markdownModeButton.setAttribute(
    "aria-pressed",
    state.outputMode === "markdown" ? "true" : "false",
  );
  previewModeButton.setAttribute(
    "aria-pressed",
    state.outputMode === "preview" ? "true" : "false",
  );

  statusPill.className = "status-pill";
  if (selectedResult?.status) {
    statusPill.classList.add(selectedResult.status);
  }

  if (selectedResult?.status === "converted") {
    markdownPreview.textContent = selectedResult.markdown;
    renderedPreview.innerHTML = renderMarkdown(selectedResult.markdown);
    previewMeta.textContent = `${selectedResult.output_filename} · ${selectedResult.characters.toLocaleString()} chars`;
    statusPill.textContent = "Converted";
    renderOutputMode();
    return;
  }

  if (selectedResult?.status === "failed") {
    markdownPreview.textContent = selectedResult.message || selectedResult.error || "Failed";
    renderedPreview.textContent = selectedResult.message || selectedResult.error || "Failed";
    previewMeta.textContent = selectedResult.filename;
    statusPill.textContent = "Failed";
    renderOutputMode();
    return;
  }

  if (state.converting) {
    markdownPreview.textContent = "";
    renderedPreview.textContent = "";
    previewMeta.textContent = selectedFile ? selectedFile.file.name : "Working";
    statusPill.textContent = "Working";
    renderOutputMode();
    return;
  }

  markdownPreview.textContent = "";
  renderedPreview.textContent = "";
  previewMeta.textContent = selectedFile ? selectedFile.file.name : "Ready";
  statusPill.textContent = "Ready";
  renderOutputMode();
}

function renderOutputMode() {
  if (state.outputMode === "preview") {
    markdownPreview.classList.add("is-hidden");
    renderedPreview.classList.remove("is-hidden");
  } else {
    showMarkdownOutput();
  }
}

function showMarkdownOutput() {
  markdownPreview.classList.remove("is-hidden");
  renderedPreview.classList.add("is-hidden");
}

async function copySelectedMarkdown() {
  const result = state.results.find((item) => item.id === state.selectedId);
  if (!result || result.status !== "converted") {
    return;
  }

  try {
    await navigator.clipboard.writeText(result.markdown);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = result.markdown;
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

function downloadSelectedMarkdown() {
  const result = state.results.find((item) => item.id === state.selectedId);
  if (!result || result.status !== "converted") {
    return;
  }
  downloadBlob(new Blob([result.markdown], { type: "text/markdown;charset=utf-8" }), result.output_filename);
}

function downloadAllMarkdown() {
  const files = state.results
    .filter((result) => result.status === "converted")
    .map((result) => ({
      name: result.output_filename,
      data: new TextEncoder().encode(result.markdown),
    }));
  if (files.length === 0) {
    return;
  }
  downloadBlob(createZip(files), "markitdown-results.zip");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function createZip(files) {
  const chunks = [];
  const centralDirectory = [];
  let offset = 0;
  const now = new Date();
  const { time, date } = dosDateTime(now);

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    const crc = crc32(file.data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, file.data.length, true);
    localView.setUint32(22, file.data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);
    chunks.push(localHeader, file.data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, file.data.length, true);
    centralView.setUint32(24, file.data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralDirectory.push(centralHeader);
    offset += localHeader.length + file.data.length;
  }

  const centralSize = centralDirectory.reduce((size, chunk) => size + chunk.length, 0);
  chunks.push(...centralDirectory);

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  chunks.push(end);

  return new Blob(chunks, { type: "application/zip" });
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: dosDate };
}

function crc32(data) {
  let crc = -1;
  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let j = 0; j < 8; j += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units.shift();
  while (value >= 1024 && units.length) {
    value /= 1024;
    unit = units.shift();
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}

function statusLabel(status) {
  if (status === "converted") {
    return "Converted";
  }
  if (status === "failed") {
    return "Failed";
  }
  if (status === "working") {
    return "Working";
  }
  return "Ready";
}

function stripExtension(filename) {
  const index = filename.lastIndexOf(".");
  return index > 0 ? filename.slice(0, index) : filename;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  }[char]));
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;
  let blockquote = [];
  let codeFence = null;
  let tableRows = [];

  function flushParagraph() {
    if (paragraph.length === 0) {
      return;
    }
    blocks.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  }

  function flushList() {
    if (!list) {
      return;
    }
    const items = list.items
      .map((item) => `<li>${renderInline(item)}</li>`)
      .join("");
    blocks.push(`<${list.type}>${items}</${list.type}>`);
    list = null;
  }

  function flushBlockquote() {
    if (blockquote.length === 0) {
      return;
    }
    blocks.push(`<blockquote>${renderMarkdown(blockquote.join("\n"))}</blockquote>`);
    blockquote = [];
  }

  function flushTable() {
    if (tableRows.length === 0) {
      return;
    }
    const [header, , ...body] = tableRows;
    const headCells = splitTableRow(header)
      .map((cell) => `<th>${renderInline(cell.trim())}</th>`)
      .join("");
    const bodyRows = body
      .map((row) => {
        const cells = splitTableRow(row)
          .map((cell) => `<td>${renderInline(cell.trim())}</td>`)
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");
    blocks.push(
      `<table><thead><tr>${headCells}</tr></thead><tbody>${bodyRows}</tbody></table>`,
    );
    tableRows = [];
  }

  function flushOpenBlocks() {
    flushParagraph();
    flushList();
    flushBlockquote();
    flushTable();
  }

  for (const line of lines) {
    if (codeFence) {
      if (/^```/.test(line.trim())) {
        blocks.push(`<pre><code>${escapeHtml(codeFence.lines.join("\n"))}</code></pre>`);
        codeFence = null;
      } else {
        codeFence.lines.push(line);
      }
      continue;
    }

    if (/^```/.test(line.trim())) {
      flushOpenBlocks();
      codeFence = { lines: [] };
      continue;
    }

    if (line.trim() === "") {
      flushOpenBlocks();
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushOpenBlocks();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      continue;
    }

    if (/^\s*\|.+\|\s*$/.test(line) || tableRows.length > 0) {
      if (
        tableRows.length === 1
        && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
      ) {
        flushParagraph();
        flushList();
        flushBlockquote();
        tableRows.push(line);
        continue;
      }
      if (tableRows.length >= 2 && /^\s*\|.+\|\s*$/.test(line)) {
        tableRows.push(line);
        continue;
      }
      if (tableRows.length === 1) {
        paragraph.push(tableRows.shift());
      } else {
        flushTable();
      }
    }

    if (/^\s*\|.+\|\s*$/.test(line)) {
      flushParagraph();
      flushList();
      flushBlockquote();
      tableRows.push(line);
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      flushList();
      flushTable();
      blockquote.push(quote[1]);
      continue;
    }

    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (unordered) {
      flushParagraph();
      flushBlockquote();
      flushTable();
      if (!list || list.type !== "ul") {
        flushList();
        list = { type: "ul", items: [] };
      }
      list.items.push(unordered[1]);
      continue;
    }

    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (ordered) {
      flushParagraph();
      flushBlockquote();
      flushTable();
      if (!list || list.type !== "ol") {
        flushList();
        list = { type: "ol", items: [] };
      }
      list.items.push(ordered[1]);
      continue;
    }

    flushList();
    flushBlockquote();
    flushTable();
    paragraph.push(line.trim());
  }

  if (codeFence) {
    blocks.push(`<pre><code>${escapeHtml(codeFence.lines.join("\n"))}</code></pre>`);
  }
  flushOpenBlocks();
  return blocks.join("");
}

function renderInline(value) {
  const placeholders = [];
  let html = escapeHtml(value);

  html = html.replace(/`([^`]+)`/g, (_match, code) => {
    placeholders.push(`<code>${code}</code>`);
    return `\u0000${placeholders.length - 1}\u0000`;
  });

  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label, href) => {
    const safeHref = sanitizeHref(href);
    if (!safeHref) {
      return label;
    }
    return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  html = html.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");

  return html.replace(
    /\u0000(\d+)\u0000/g,
    (_match, index) => placeholders[Number(index)],
  );
}

function sanitizeHref(href) {
  const decoded = href.replace(/&amp;/g, "&").trim();
  if (
    /^(https?:|mailto:)/i.test(decoded)
    || decoded.startsWith("#")
    || decoded.startsWith("/")
  ) {
    return escapeHtml(decoded);
  }
  return "";
}

function splitTableRow(row) {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
}

render();
