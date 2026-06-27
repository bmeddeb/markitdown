const fileInput = document.querySelector("#fileInput");
const chooseFilesButton = document.querySelector("#chooseFilesButton");
const uploadForm = document.querySelector("#uploadForm");
const convertButton = document.querySelector("#convertButton");
const clearButton = document.querySelector("#clearButton");
const fileList = document.querySelector("#fileList");
const markdownPreview = document.querySelector("#markdownPreview");
const previewMeta = document.querySelector("#previewMeta");
const runSummary = document.querySelector("#runSummary");
const statusPill = document.querySelector("#statusPill");
const keepDataUris = document.querySelector("#keepDataUris");
const enablePlugins = document.querySelector("#enablePlugins");
const copyButton = document.querySelector("#copyButton");
const downloadButton = document.querySelector("#downloadButton");
const downloadAllButton = document.querySelector("#downloadAllButton");

const state = {
  files: [],
  results: [],
  selectedId: null,
  converting: false,
};

chooseFilesButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => addFiles(fileInput.files));
uploadForm.addEventListener("submit", convertFiles);
clearButton.addEventListener("click", clearFiles);
copyButton.addEventListener("click", copySelectedMarkdown);
downloadButton.addEventListener("click", downloadSelectedMarkdown);
downloadAllButton.addEventListener("click", downloadAllMarkdown);

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

  statusPill.className = "status-pill";
  if (selectedResult?.status) {
    statusPill.classList.add(selectedResult.status);
  }

  if (selectedResult?.status === "converted") {
    markdownPreview.textContent = selectedResult.markdown;
    previewMeta.textContent = `${selectedResult.output_filename} · ${selectedResult.characters.toLocaleString()} chars`;
    statusPill.textContent = "Converted";
    return;
  }

  if (selectedResult?.status === "failed") {
    markdownPreview.textContent = selectedResult.message || selectedResult.error || "Failed";
    previewMeta.textContent = selectedResult.filename;
    statusPill.textContent = "Failed";
    return;
  }

  if (state.converting) {
    markdownPreview.textContent = "";
    previewMeta.textContent = selectedFile ? selectedFile.file.name : "Working";
    statusPill.textContent = "Working";
    return;
  }

  markdownPreview.textContent = "";
  previewMeta.textContent = selectedFile ? selectedFile.file.name : "Ready";
  statusPill.textContent = "Ready";
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

render();
