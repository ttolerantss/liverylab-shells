const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');
const { DEFAULT_PAINT_SHADERS, normalizeShaderName } = require('../lib/shaders');

const $ = (id) => document.getElementById(id);

const state = {
  inputPath: null,
  outputDir: null,
  mergePaints: false,
  shaders: [...DEFAULT_PAINT_SHADERS],
  busy: false,
};

// ===== Window controls =====
$('btn-minimize').addEventListener('click', () => ipcRenderer.send('minimize-window'));
$('btn-maximize').addEventListener('click', () => ipcRenderer.send('maximize-window'));
$('btn-close').addEventListener('click', () => ipcRenderer.send('close-window'));

// ===== Drop zone / file picker =====
const dropZone = $('drop-zone');
const dropInner = $('drop-zone-inner');
const fileNameEl = $('file-name');
const btnChangeFile = $('btn-change-file');

function isYftXml(filePath) {
  const lower = filePath.toLowerCase();
  return lower.endsWith('.yft.xml') || lower.endsWith('.xml');
}

function setInputFile(filePath) {
  if (!filePath) return;
  if (!isYftXml(filePath)) {
    setStatus(`Not a .yft.xml file: ${path.basename(filePath)}`, 'error');
    return;
  }
  state.inputPath = filePath;
  fileNameEl.textContent = path.basename(filePath);
  fileNameEl.title = filePath;
  dropZone.classList.add('file-loaded');
  updateOutputPathDisplay();
  setStatus(`Loaded ${path.basename(filePath)} — ready to extract.`);
  $('btn-extract').disabled = false;
  hideResult();
}

dropInner.addEventListener('click', async (e) => {
  if (state.busy) return;
  if (e.target.closest('.file-change-btn')) return;
  const picked = await ipcRenderer.invoke('open-yft-dialog');
  if (picked) setInputFile(picked);
});

btnChangeFile.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (state.busy) return;
  const picked = await ipcRenderer.invoke('open-yft-dialog');
  if (picked) setInputFile(picked);
});

['dragenter', 'dragover'].forEach((evt) => {
  document.addEventListener(evt, (e) => {
    e.preventDefault();
    dropInner.classList.add('drag-over');
  });
});
['dragleave', 'drop'].forEach((evt) => {
  document.addEventListener(evt, (e) => {
    e.preventDefault();
    if (evt === 'dragleave' && e.target !== document.documentElement) return;
    dropInner.classList.remove('drag-over');
  });
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  if (state.busy) return;
  const files = [...(e.dataTransfer?.files || [])];
  if (files.length === 0) return;
  setInputFile(files[0].path);
});

// ===== Output folder =====
function updateOutputPathDisplay() {
  const el = $('output-path-display');
  if (state.outputDir) {
    el.textContent = state.outputDir;
    el.title = state.outputDir;
    el.classList.remove('muted');
  } else if (state.inputPath) {
    const dir = path.dirname(state.inputPath);
    el.textContent = `${dir}  (default — input folder)`;
    el.title = dir;
    el.classList.add('muted');
  } else {
    el.textContent = 'Same as input file';
    el.title = '';
    el.classList.add('muted');
  }
}

$('btn-browse-output').addEventListener('click', async () => {
  if (state.busy) return;
  const def = state.outputDir || (state.inputPath ? path.dirname(state.inputPath) : undefined);
  const picked = await ipcRenderer.invoke('select-output-directory', def);
  if (picked) {
    state.outputDir = picked;
    updateOutputPathDisplay();
  }
});

$('btn-reset-output').addEventListener('click', () => {
  state.outputDir = null;
  updateOutputPathDisplay();
});

// ===== Merge paints toggle =====
$('chk-merge-paints').addEventListener('change', (e) => {
  state.mergePaints = !!e.target.checked;
});

// ===== Shader whitelist editor =====
const shaderChips = $('shader-chips');
const shaderInput = $('shader-input');

function renderShaderChips() {
  // remove all chips, keep the input
  [...shaderChips.querySelectorAll('.shader-chip')].forEach((c) => c.remove());
  for (const name of state.shaders) {
    const chip = document.createElement('span');
    chip.className = 'shader-chip';
    const text = document.createElement('span');
    text.textContent = name;
    const remove = document.createElement('button');
    remove.className = 'shader-chip-remove';
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = `Remove ${name}`;
    remove.addEventListener('click', () => {
      state.shaders = state.shaders.filter((s) => s !== name);
      renderShaderChips();
    });
    chip.appendChild(text);
    chip.appendChild(remove);
    shaderChips.insertBefore(chip, shaderInput);
  }
}

function addShaderFromInput() {
  const raw = shaderInput.value;
  if (!raw) return;
  const tokens = raw.split(/[,\s]+/).map(normalizeShaderName).filter(Boolean);
  for (const t of tokens) {
    if (!state.shaders.includes(t)) state.shaders.push(t);
  }
  shaderInput.value = '';
  renderShaderChips();
}

shaderInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
    e.preventDefault();
    addShaderFromInput();
  } else if (e.key === 'Backspace' && shaderInput.value === '' && state.shaders.length > 0) {
    state.shaders.pop();
    renderShaderChips();
  }
});
shaderInput.addEventListener('blur', () => {
  if (shaderInput.value) addShaderFromInput();
});

$('btn-reset-shaders').addEventListener('click', () => {
  state.shaders = [...DEFAULT_PAINT_SHADERS];
  renderShaderChips();
});

renderShaderChips();

// ===== Status / busy =====
function setStatus(text, level = 'normal') {
  const el = $('status');
  el.classList.remove('error', 'success', 'warn');
  if (level === 'error') el.classList.add('error');
  else if (level === 'success') el.classList.add('success');
  else if (level === 'warn') el.classList.add('warn');
  el.innerHTML = text;
}

function setBusy(busy) {
  state.busy = busy;
  $('btn-extract').disabled = busy || !state.inputPath;
}

// ===== Result panel =====
const resultEl = $('result');

function hideResult() {
  resultEl.className = 'result';
  resultEl.innerHTML = '';
}

function showResult({ ok, error, writtenPath, vertexCount, faceCount, keptCount, discardedCount, lodUsed, groupNames, warnings }) {
  resultEl.innerHTML = '';
  resultEl.className = 'result visible';

  const title = document.createElement('div');
  title.className = 'result-title';
  const dot = document.createElement('span');
  dot.className = 'dot';
  title.appendChild(dot);

  if (!ok) {
    resultEl.classList.add('error');
    title.appendChild(document.createTextNode(' Extraction failed'));
    resultEl.appendChild(title);
    const msg = document.createElement('div');
    msg.style.fontSize = '12px';
    msg.style.color = 'var(--text-secondary)';
    msg.textContent = error || 'Unknown error';
    resultEl.appendChild(msg);
    return;
  }

  const hasWarn = (warnings && warnings.length > 0) || keptCount === 0;
  if (hasWarn) resultEl.classList.add('warn');

  title.appendChild(document.createTextNode(` Bodyshell exported`));
  resultEl.appendChild(title);

  const stats = document.createElement('div');
  stats.className = 'result-stats';
  stats.innerHTML = `
    <span class="stat"><span class="num">${keptCount}</span> geometries kept</span>
    <span class="stat"><span class="num">${discardedCount}</span> discarded</span>
    <span class="stat"><span class="num">${vertexCount.toLocaleString()}</span> verts</span>
    <span class="stat"><span class="num">${faceCount.toLocaleString()}</span> tris</span>
    <span class="stat">LOD: <span class="num">${lodUsed.replace('DrawableModels', '')}</span></span>
    <span class="stat">Groups: <span class="num">${(groupNames || []).join(', ') || '—'}</span></span>
  `;
  resultEl.appendChild(stats);

  const out = document.createElement('div');
  out.className = 'result-output';
  const pathDisp = document.createElement('div');
  pathDisp.className = 'path-display';
  pathDisp.textContent = writtenPath;
  pathDisp.title = writtenPath;
  out.appendChild(pathDisp);
  const openBtn = document.createElement('button');
  openBtn.className = 'btn btn-sm';
  openBtn.textContent = 'Open folder';
  openBtn.addEventListener('click', () => ipcRenderer.invoke('show-in-folder', writtenPath));
  out.appendChild(openBtn);
  resultEl.appendChild(out);

  if (warnings && warnings.length > 0) {
    const ul = document.createElement('ul');
    ul.className = 'result-warnings';
    for (const w of warnings) {
      const li = document.createElement('li');
      li.textContent = w;
      ul.appendChild(li);
    }
    resultEl.appendChild(ul);
  }
}

// ===== Progress events from main =====
ipcRenderer.on('extract-progress', (event, { stage, info }) => {
  switch (stage) {
    case 'reading-file':
      setStatus(`<span class="spinner"></span> Reading file...`);
      break;
    case 'parsing-xml':
      setStatus(`<span class="spinner"></span> Parsing XML (this can take a few seconds for large files)...`);
      break;
    case 'walking-geometries':
      setStatus(`<span class="spinner"></span> Walking ${info?.modelCount || 0} model(s) in ${info?.lod || ''}...`);
      break;
    case 'writing-obj':
      setStatus(`<span class="spinner"></span> Writing OBJ...`);
      break;
    case 'done':
      setStatus(`<span class="spinner"></span> Finalizing...`);
      break;
    default:
      break;
  }
});

// ===== Extract button =====
$('btn-extract').addEventListener('click', async () => {
  if (state.busy || !state.inputPath) return;
  setBusy(true);
  hideResult();
  setStatus(`<span class="spinner"></span> Starting...`);
  try {
    const result = await ipcRenderer.invoke('extract-bodyshell', {
      inputPath: state.inputPath,
      outputDir: state.outputDir,
      yUp: true,
      mergePaints: state.mergePaints,
      shaderWhitelist: state.shaders,
    });

    if (result.ok) {
      const fileName = path.basename(result.writtenPath);
      setStatus(`Saved ${fileName}`, 'success');
      showResult(result);
    } else {
      setStatus(result.error || 'Extraction failed', 'error');
      showResult(result);
    }
  } catch (err) {
    setStatus(err.message || String(err), 'error');
    showResult({ ok: false, error: err.message || String(err) });
  } finally {
    setBusy(false);
  }
});
