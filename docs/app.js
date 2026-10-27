// PixelForge web: editor de pixel art táctil (Apple Pencil, dedos y ratón).
'use strict';

const $ = id => document.getElementById(id);
const CHECK_A = '#3a3a46', CHECK_B = '#30303b';
const DEFAULT_PALETTE = [
  '#0d0b14', '#2b2840', '#4b4a6b', '#7a7a9a', '#b4b4c8', '#f0f0f4',
  '#5e2236', '#9c2f3a', '#d6493c', '#f08a4b', '#f7c26b', '#fff1a8',
  '#3a2a20', '#6b4430', '#a0673e', '#d29b6a', '#f2cfa4', '#f0a0c8',
  '#1d3b2a', '#2f6b3a', '#4ea14a', '#94d168', '#d2f08c', '#2a6b6b',
  '#162a4a', '#24508c', '#3c88d6', '#7cc4f0', '#c4ecff',
  '#3e1f5c', '#7a3aa0', '#c060c8',
];
const TOOLS = [
  ['pencil', '✏️ Lápiz', 'b'], ['eraser', '🧽 Goma', 'e'], ['fill', '🪣 Relleno', 'g'],
  ['picker', '💧 Cuentagotas', 'i'], ['line', '📏 Línea', 'l'], ['rect', '▭ Rectángulo', 'r'],
  ['ellipse', '◯ Elipse', 'o'],
];
const AUTOSAVE = '__autosave__';

const blank = (w, h) => Array.from({ length: h }, () => Array(w).fill(null));
const copyFrame = f => f.map(r => r.slice());

const st = {
  w: 32, h: 32, frames: [blank(32, 32)], cur: 0, palette: DEFAULT_PALETTE.slice(),
  primary: '#d6493c', secondary: '#0d0b14', tool: 'pencil', brush: 1,
  mirror: false, fillShapes: false, onion: true, grid: true, penOnly: false, fps: 8,
  name: 'sin título', id: null, dirty: false,
};
const view = { zoom: 16, panX: 0, panY: 0 };
let undoStack = [], redoStack = [];
let playing = false, playIdx = 0, playTimer = null;
let lastGen = null, exportScale = 1;

// ------------------------------------------------------------ almacén ----

const DB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('pixelforge', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('projects', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('projects', mode);
      const req = fn(t.objectStore('projects'));
      t.oncomplete = () => res(req.result);
      t.onerror = () => rej(t.error);
    });
  };
  return {
    put: p => tx('readwrite', s => s.put(p)),
    get: id => tx('readonly', s => s.get(id)),
    all: () => tx('readonly', s => s.getAll()),
    del: id => tx('readwrite', s => s.delete(id)),
  };
})();

const projectData = () => ({ version: 1, width: st.w, height: st.h, fps: st.fps, palette: st.palette, frames: st.frames });

let autosaveTimer = null;
function markDirty() {
  st.dirty = true;
  updateTitle();
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    DB.put({ id: AUTOSAVE, name: st.name, docId: st.id, updated: Date.now(), ...projectData() }).catch(() => {});
  }, 700);
}

// ----------------------------------------------------------- historial ----

function snapshot() {
  undoStack.push([st.frames.map(copyFrame), st.cur]);
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
  markDirty();
}

function restore(src, dst) {
  if (!src.length) return;
  dst.push([st.frames.map(copyFrame), st.cur]);
  const [frames, cur] = src.pop();
  st.frames = frames;
  st.cur = Math.min(cur, frames.length - 1);
  markDirty();
  refreshAll();
}
const undo = () => restore(undoStack, redoStack);
const redo = () => restore(redoStack, undoStack);

// ------------------------------------------------------------- dibujo ----

const art = $('art'), actx = art.getContext('2d');
const rgbCache = new Map();
const rgbOf = c => {
  let v = rgbCache.get(c);
  if (!v) { v = Gen.hexToRgb(c); rgbCache.set(c, v); }
  return v;
};

function render() {
  const { w, h } = st, f = st.frames[st.cur];
  const prev = st.onion && st.cur > 0 ? st.frames[st.cur - 1] : null;
  const img = actx.createImageData(w, h), d = img.data;
  const ca = rgbOf(CHECK_A), cb = rgbOf(CHECK_B);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = f[y][x], i = (y * w + x) * 4;
      let rgb;
      if (c) rgb = rgbOf(c);
      else {
        const ch = (x + y) % 2 ? cb : ca;
        const p = prev && prev[y][x];
        rgb = p ? rgbOf(p).map((v, k) => v + (ch[k] - v) * 0.7) : ch;
      }
      d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = 255;
    }
  actx.putImageData(img, 0, 0);
  if (!playing) drawPreview(st.cur);
}

function frameToCanvas(f, canvas, scale = 1) {
  const w = f[0].length, h = f.length;
  canvas = canvas || document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = f[y][x];
      if (!c) continue;
      const [r, g, b] = rgbOf(c), i = (y * w + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  if (scale === 1) return canvas;
  const big = document.createElement('canvas');
  big.width = w * scale; big.height = h * scale;
  const bctx = big.getContext('2d');
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(canvas, 0, 0, big.width, big.height);
  return big;
}

const inside = (x, y) => x >= 0 && x < st.w && y >= 0 && y < st.h;

function put(x, y, col) {
  const b = st.brush, f = st.frames[st.cur];
  for (let dy = 0; dy < b; dy++)
    for (let dx = 0; dx < b; dx++) {
      const px = x + dx - (b >> 1), py = y + dy - (b >> 1);
      for (const qx of st.mirror ? [px, st.w - 1 - px] : [px])
        if (inside(qx, py)) f[py][qx] = col;
    }
}

function linePoints(x0, y0, x1, y1) {
  const pts = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    pts.push([x0, y0]);
    if (x0 === x1 && y0 === y1) return pts;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function flood(x, y, col) {
  const f = st.frames[st.cur], target = f[y][x];
  if (target === col) return;
  const stack = [[x, y]];
  while (stack.length) {
    const [px, py] = stack.pop();
    if (inside(px, py) && f[py][px] === target) {
      f[py][px] = col;
      stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
    }
  }
}

function drawShape(stroke, x1, y1) {
  const f = st.frames[st.cur];
  for (let y = 0; y < st.h; y++) f[y] = stroke.base[y].slice();
  const [x0, y0] = stroke.start;
  let pts;
  if (st.tool === 'line') pts = linePoints(x0, y0, x1, y1);
  else {
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    pts = [];
    if (st.tool === 'rect') {
      for (let y = ay; y <= by; y++)
        for (let x = ax; x <= bx; x++)
          if (st.fillShapes || x === ax || x === bx || y === ay || y === by) pts.push([x, y]);
    } else {
      const cx = (ax + bx) / 2, cy = (ay + by) / 2, rx = (bx - ax) / 2 + 0.5, ry = (by - ay) / 2 + 0.5;
      const ins = (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
      for (let y = ay; y <= by; y++)
        for (let x = ax; x <= bx; x++)
          if (ins(x, y) && (st.fillShapes || ![[1, 0], [-1, 0], [0, 1], [0, -1]].every(([i, j]) => ins(x + i, y + j))))
            pts.push([x, y]);
    }
  }
  for (const [px, py] of pts) put(px, py, stroke.col);
}

// ------------------------------------------------- lápiz, dedos, ratón ----

const stage = $('stage'), board = $('board');
const touches = new Map();
let stroke = null, gesture = null;

function cellOf(e) {
  const r = art.getBoundingClientRect();
  return [Math.floor((e.clientX - r.left) / r.width * st.w), Math.floor((e.clientY - r.top) / r.height * st.h)];
}

function pick(x, y, secondary) {
  const c = inside(x, y) && st.frames[st.cur][y][x];
  if (!c) return;
  if (secondary) st.secondary = c; else st.primary = c;
  updateColors();
}

function startStroke(e) {
  if (playing) togglePlay();
  const [x, y] = cellOf(e), secondary = e.button === 2;
  if (st.tool === 'picker') { stroke = { id: e.pointerId, picker: true, secondary }; pick(x, y, secondary); return; }
  if (st.tool === 'fill' && !inside(x, y)) return;
  snapshot();
  const col = st.tool === 'eraser' ? null : secondary ? st.secondary : st.primary;
  stroke = { id: e.pointerId, touch: e.pointerType === 'touch', start: [x, y], last: [x, y], base: copyFrame(st.frames[st.cur]), col };
  if (st.tool === 'pencil' || st.tool === 'eraser') put(x, y, col);
  else if (st.tool === 'fill') flood(x, y, col);
  else drawShape(stroke, x, y);
  render();
}

function moveStroke(e) {
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of events.length ? events : [e]) {
    const [x, y] = cellOf(ev);
    if (stroke.picker) { pick(x, y, stroke.secondary); continue; }
    if (st.tool === 'pencil' || st.tool === 'eraser') {
      for (const [px, py] of linePoints(stroke.last[0], stroke.last[1], x, y)) put(px, py, stroke.col);
      stroke.last = [x, y];
    } else if (st.tool !== 'fill') drawShape(stroke, x, y);
  }
  render();
}

function endStroke() {
  const wasPicker = stroke.picker;
  stroke = null;
  if (!wasPicker) refreshFrames();
}

function cancelStroke() { // un segundo dedo convierte el trazo en gesto: lo deshacemos
  if (!stroke.picker && undoStack.length) {
    const [frames, cur] = undoStack.pop();
    st.frames = frames; st.cur = cur;
    render();
  }
  stroke = null;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const maxZoom = () => Math.max(1, Math.min(64, Math.floor(6000 / Math.max(st.w, st.h))));

function stageCenter() {
  const r = stage.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function startGesture() {
  const pts = [...touches.values()];
  if (pts.length >= 2) {
    const m = midpoint(pts[0], pts[1]), c = stageCenter();
    gesture = { d0: dist(pts[0], pts[1]), z0: view.zoom, ox: m.x - c.x - view.panX, oy: m.y - c.y - view.panY };
  } else if (pts.length === 1 && st.penOnly) {
    gesture = { pan: true, sx: pts[0].x, sy: pts[0].y, px: view.panX, py: view.panY };
  } else gesture = { idle: true };
}

function moveGesture() {
  const pts = [...touches.values()], c = stageCenter();
  if (gesture.pan) {
    view.panX = gesture.px + pts[0].x - gesture.sx;
    view.panY = gesture.py + pts[0].y - gesture.sy;
  } else if (!gesture.idle && pts.length >= 2) {
    const z = Math.max(1, Math.min(maxZoom(), Math.round(gesture.z0 * dist(pts[0], pts[1]) / gesture.d0)));
    const k = z / gesture.z0, m = midpoint(pts[0], pts[1]);
    view.panX = m.x - c.x - gesture.ox * k;
    view.panY = m.y - c.y - gesture.oy * k;
    if (z !== view.zoom) { view.zoom = z; layout(); return; }
  }
  placeBoard();
}

stage.addEventListener('pointerdown', e => {
  stage.setPointerCapture(e.pointerId);
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size >= 2) {
      if (stroke && stroke.touch) cancelStroke();
      startGesture();
      return;
    }
    if (st.penOnly) { startGesture(); return; }
  }
  // el lápiz siempre pinta, aunque haya una palma o dedos apoyados
  if (stroke || (gesture && e.pointerType !== 'pen')) return;
  startStroke(e);
});

stage.addEventListener('pointermove', e => {
  if (touches.has(e.pointerId)) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture) moveGesture();
  }
  if (stroke && stroke.id === e.pointerId) moveStroke(e);
  const [x, y] = cellOf(e);
  updateStatus(inside(x, y) ? [x, y] : null);
});

function pointerEnd(e) {
  touches.delete(e.pointerId);
  if (stroke && stroke.id === e.pointerId) endStroke();
  if (gesture) {
    if (touches.size === 0) gesture = null;
    else if (touches.size === 1) gesture = st.penOnly ? (startGesture(), gesture) : { idle: true };
  }
}
stage.addEventListener('pointerup', pointerEnd);
stage.addEventListener('pointercancel', pointerEnd);
stage.addEventListener('contextmenu', e => e.preventDefault());
stage.addEventListener('wheel', e => {
  e.preventDefault();
  setZoom(view.zoom + (e.deltaY < 0 ? 1 : -1) * Math.max(1, Math.round(view.zoom / 8)));
}, { passive: false });

// --------------------------------------------------------------- vista ----

function placeBoard() {
  board.style.transform = `translate(calc(-50% + ${view.panX}px), calc(-50% + ${view.panY}px))`;
}

function layout() {
  const cw = st.w * view.zoom, ch = st.h * view.zoom;
  board.style.width = cw + 'px'; board.style.height = ch + 'px';
  art.style.width = cw + 'px'; art.style.height = ch + 'px';
  placeBoard();
  const g = $('grid'), dpr = window.devicePixelRatio || 1;
  g.style.width = cw + 'px'; g.style.height = ch + 'px';
  g.width = Math.round(cw * dpr); g.height = Math.round(ch * dpr);
  const ctx = g.getContext('2d');
  ctx.clearRect(0, 0, g.width, g.height);
  if (st.grid && view.zoom >= 6) {
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 1 / dpr;
    for (const major of [false, true]) {
      ctx.beginPath();
      for (let x = 1; x < st.w; x++) if ((x % 8 === 0) === major) { ctx.moveTo(x * view.zoom, 0); ctx.lineTo(x * view.zoom, ch); }
      for (let y = 1; y < st.h; y++) if ((y % 8 === 0) === major) { ctx.moveTo(0, y * view.zoom); ctx.lineTo(cw, y * view.zoom); }
      ctx.strokeStyle = major ? 'rgba(150,150,200,.55)' : 'rgba(0,0,0,.28)';
      ctx.stroke();
    }
  }
  updateStatus();
}

function setZoom(z) {
  z = Math.max(1, Math.min(maxZoom(), z));
  if (z !== view.zoom) { view.zoom = z; layout(); }
}

function fitZoom() {
  const r = stage.getBoundingClientRect();
  view.zoom = Math.max(1, Math.min(maxZoom(), Math.floor(Math.min(r.width * 0.92 / st.w, r.height * 0.92 / st.h))));
  view.panX = view.panY = 0;
  layout();
}

function rebuildCanvas() {
  art.width = st.w; art.height = st.h;
  fitZoom();
  render();
}

// ------------------------------------------------------------ colores ----

const colorInput = $('colorInput');
let colorTarget = null;

function askColor(initial, cb) {
  colorTarget = cb;
  colorInput.value = initial;
  colorInput.click();
}
colorInput.addEventListener('change', () => { if (colorTarget) colorTarget(colorInput.value.toLowerCase()); colorTarget = null; });

function updateColors() {
  $('sw1').style.background = st.primary;
  $('sw2').style.background = st.secondary;
  $('hex').innerHTML = `1: ${st.primary}<br>2: ${st.secondary}`;
  const pal = $('palette');
  pal.innerHTML = '';
  st.palette.forEach((c, i) => {
    const d = document.createElement('div');
    d.style.background = c;
    if (c === st.primary) d.className = 'p1';
    else if (c === st.secondary) d.className = 'p2';
    d.dataset.i = i;
    pal.appendChild(d);
  });
}

let lastTap = { i: -1, t: 0 };
$('palette').addEventListener('pointerup', e => {
  const i = e.target.dataset.i;
  if (i === undefined) return;
  const now = Date.now();
  if (lastTap.i === i && now - lastTap.t < 350) { // doble toque: editar color
    askColor(st.palette[i], c => { st.palette[i] = c; st.primary = c; updateColors(); });
  } else if (e.button === 2) st.secondary = st.palette[i];
  else st.primary = st.palette[i];
  lastTap = { i, t: now };
  updateColors();
});
$('palette').addEventListener('contextmenu', e => e.preventDefault());

$('sw1').onclick = () => askColor(st.primary, c => { st.primary = c; updateColors(); });
$('sw2').onclick = () => askColor(st.secondary, c => { st.secondary = c; updateColors(); });
const swapColors = () => { [st.primary, st.secondary] = [st.secondary, st.primary]; updateColors(); };
$('swap').onclick = swapColors;
$('palAdd').onclick = () => askColor(st.primary, c => {
  st.primary = c;
  if (!st.palette.includes(c)) st.palette.push(c);
  updateColors();
});
$('palRamp').onclick = () => {
  for (const c of Gen.makeRamp(st.primary)) if (!st.palette.includes(c)) st.palette.push(c);
  updateColors();
};
$('palDel').onclick = () => {
  if (st.palette.length > 1 && st.palette.includes(st.primary)) st.palette.splice(st.palette.indexOf(st.primary), 1);
  updateColors();
};
$('palSprite').onclick = () => {
  const cols = [];
  for (const f of st.frames) for (const row of f) for (const c of row) if (c && !cols.includes(c)) cols.push(c);
  if (cols.length) { st.palette = cols.slice(0, 256); updateColors(); }
};
$('palReset').onclick = () => { st.palette = DEFAULT_PALETTE.slice(); updateColors(); };

// ------------------------------------------------------------- frames ----

function refreshFrames() {
  const box = $('frames');
  box.innerHTML = '';
  st.frames.forEach((f, i) => {
    const d = document.createElement('div');
    d.className = 'fr' + (i === st.cur ? ' cur' : '');
    d.appendChild(frameToCanvas(f));
    const n = document.createElement('span');
    n.textContent = i + 1;
    d.appendChild(n);
    d.onclick = () => selectFrame(i);
    box.appendChild(d);
  });
  const cur = box.children[st.cur];
  if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  updateStatus();
}

function selectFrame(i) {
  st.cur = ((i % st.frames.length) + st.frames.length) % st.frames.length;
  render();
  refreshFrames();
}

function refreshAll() { render(); refreshFrames(); updateTitle(); }

function replaceCurrent(f) { snapshot(); st.frames[st.cur] = f; refreshAll(); }

$('frAdd').onclick = () => { snapshot(); st.frames.splice(st.cur + 1, 0, blank(st.w, st.h)); selectFrame(st.cur + 1); };
$('frDup').onclick = () => { snapshot(); st.frames.splice(st.cur + 1, 0, copyFrame(st.frames[st.cur])); selectFrame(st.cur + 1); };
$('frDel').onclick = () => {
  snapshot();
  if (st.frames.length === 1) st.frames[0] = blank(st.w, st.h);
  else { st.frames.splice(st.cur, 1); st.cur = Math.min(st.cur, st.frames.length - 1); }
  refreshAll();
};
function moveFrame(d) {
  const j = st.cur + d;
  if (j < 0 || j >= st.frames.length) return;
  snapshot();
  [st.frames[st.cur], st.frames[j]] = [st.frames[j], st.frames[st.cur]];
  selectFrame(j);
}
$('frLeft').onclick = () => moveFrame(-1);
$('frRight').onclick = () => moveFrame(1);

$('flipH').onclick = () => replaceCurrent(st.frames[st.cur].map(r => r.slice().reverse()));
$('flipV').onclick = () => replaceCurrent(copyFrame(st.frames[st.cur]).reverse());
$('clear').onclick = () => replaceCurrent(blank(st.w, st.h));
$('replace').onclick = () => replaceCurrent(st.frames[st.cur].map(r => r.map(c => (c === st.primary ? st.secondary : c))));
const shiftFrame = (dx, dy) => replaceCurrent(Gen.shifted(st.frames[st.cur], dx, dy, true));
document.querySelectorAll('[data-shift]').forEach(b => {
  const [dx, dy] = b.dataset.shift.split(',').map(Number);
  b.onclick = () => shiftFrame(dx, dy);
});

// ------------------------------------------------------- vista previa ----

function drawPreview(i) { frameToCanvas(st.frames[i], $('preview')); }

function togglePlay() {
  playing = !playing;
  $('play').textContent = playing ? '■ Parar' : '▶ Reproducir';
  $('play').classList.toggle('on', playing);
  clearTimeout(playTimer);
  if (playing) { playIdx = st.cur; tick(); } else drawPreview(st.cur);
}

function tick() {
  if (!playing) return;
  playIdx = (playIdx + 1) % st.frames.length;
  drawPreview(playIdx);
  playTimer = setTimeout(tick, 1000 / st.fps);
}
$('play').onclick = togglePlay;
const fpsSel = $('fps');
for (const n of [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 24, 30]) fpsSel.add(new Option(n + ' fps', n));
fpsSel.onchange = () => { st.fps = Number(fpsSel.value); markDirty(); };

// --------------------------------------------------- generar / animar ----

function generate(fn, multi = false) {
  const seed = Math.floor(Math.random() * 2 ** 30);
  lastGen = [fn, multi];
  const result = fn(seed);
  snapshot();
  if (multi) { st.frames = result.map(g => Gen.fit(g, st.w, st.h)); st.cur = 0; }
  else st.frames[st.cur] = Gen.fit(result, st.w, st.h);
  refreshAll();
  setStatus(`Generado con semilla ${seed}. Usa «Otra variante» (Ctrl+G) para probar otro.`);
}
const regenerate = () => { if (lastGen) generate(...lastGen); };

function autoAnim(fn) {
  snapshot();
  st.frames = fn(st.frames[st.cur]).map(copyFrame);
  st.cur = 0;
  refreshAll();
  if (!playing) togglePlay();
}

// ------------------------------------------------------------ menús ----

function openSheet(title, items, note) {
  const box = $('sheetBox');
  box.innerHTML = '';
  const h = document.createElement('h2');
  h.textContent = title;
  box.appendChild(h);
  if (note) {
    const p = document.createElement('div');
    p.className = 'note';
    p.textContent = note;
    box.appendChild(p);
  }
  for (const it of items) {
    if (it instanceof Node) { box.appendChild(it); continue; }
    const b = document.createElement('button');
    b.textContent = it[0];
    b.onclick = () => { closeSheet(); it[1](); };
    box.appendChild(b);
  }
  $('sheet').classList.add('open');
}
const closeSheet = () => $('sheet').classList.remove('open');
$('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });

const MENUS = {
  archivo: () => openSheet('Archivo', [
    ['📄 Nuevo lienzo…', newProject],
    [st.id ? `💾 Guardar «${st.name}»` : '💾 Guardar en la biblioteca…', () => saveToLibrary(false)],
    ['📝 Guardar como copia…', () => saveToLibrary(true)],
    ['📚 Biblioteca de sprites', openLibrary],
    ['📥 Abrir archivo (.pxf o PNG)…', () => $('fileInput').click()],
    ['📤 Descargar proyecto (.pxf)', downloadProject],
  ], 'Los sprites se guardan en este dispositivo. Descarga el .pxf o exporta PNG para tener copia en Archivos, en tu PC o en GitHub. El .pxf también se abre en la versión de escritorio.'),
  generar: () => openSheet('Generar', [
    ['🧍 Personaje', () => generate(Gen.personaje)],
    ['🚶 Personaje caminando (4 frames)', () => generate(Gen.personajeCaminando, true)],
    ['👾 Criatura / monstruo', () => generate(Gen.criatura)],
    ...Object.entries(Gen.OBJETOS).map(([n, fn]) => [`🎁 Objeto: ${n}`, () => generate(fn)]),
    ['🎲 Objeto aleatorio', () => generate(Gen.objetoAleatorio)],
    ['🔁 Otra variante', regenerate],
  ], 'Reemplaza el frame actual (puedes deshacer con ↶).'),
  animacion: () => openSheet('Animación', [
    ...Object.entries(Gen.ANIMACIONES).map(([n, fn]) => [`🎞️ ${n}`, () => autoAnim(fn)]),
    [playing ? '■ Parar' : '▶ Reproducir', togglePlay],
  ], 'Crea la animación a partir del frame actual y reemplaza los frames (puedes deshacer con ↶).'),
  exportar: () => {
    const row = document.createElement('div');
    row.className = 'row';
    row.style.margin = '4px 0 8px';
    for (const s of [1, 2, 4, 8, 16]) {
      const b = document.createElement('button');
      b.textContent = `${s}×`;
      b.className = s === exportScale ? 'on' : '';
      b.onclick = () => { exportScale = s; row.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
      row.appendChild(b);
    }
    openSheet('Exportar', [row,
      ['🖼️ Frame actual (PNG)', exportPNG],
      ['🧩 Spritesheet (PNG horizontal)', exportSheet],
      ['🎞️ GIF animado', exportGIF],
    ], 'Escala: 1× es el tamaño real para usar en un motor de juegos.');
  },
};
document.querySelectorAll('[data-menu]').forEach(b => { b.onclick = () => MENUS[b.dataset.menu](); });

// ------------------------------------------------- archivos / biblioteca ----

function loadProject(p, name, id) {
  st.w = p.width; st.h = p.height;
  st.frames = p.frames.map(copyFrame);
  st.cur = 0;
  if (p.palette && p.palette.length) st.palette = p.palette.slice();
  if (p.fps) { st.fps = p.fps; fpsSel.value = p.fps; }
  st.name = name || 'sin título';
  st.id = id || null;
  st.dirty = false;
  undoStack = []; redoStack = [];
  if (playing) togglePlay();
  rebuildCanvas();
  refreshFrames();
  updateColors();
  updateTitle();
}

function newProject() {
  const txt = prompt('Tamaño del lienzo (ancho x alto):', `${st.w}x${st.h}`);
  if (!txt) return;
  const nums = (txt.match(/\d+/g) || []).map(Number);
  if (!nums.length) return;
  const [w, h] = [nums[0], nums[1] || nums[0]];
  if (w < 1 || h < 1 || w > 256 || h > 256) { alert('El tamaño debe estar entre 1 y 256 píxeles.'); return; }
  loadProject({ width: w, height: h, frames: [blank(w, h)] }, 'sin título', null);
  markDirty();
}

async function saveToLibrary(asCopy) {
  if (!st.id || asCopy) {
    const name = prompt('Nombre del sprite:', st.name === 'sin título' ? '' : st.name);
    if (!name) return;
    st.name = name;
    st.id = 'p' + Date.now();
  }
  await DB.put({ id: st.id, name: st.name, updated: Date.now(), ...projectData() });
  st.dirty = false;
  updateTitle();
  markDirty(); // actualiza el autoguardado con el nombre/id
  st.dirty = false;
  updateTitle();
  setStatus(`Guardado «${st.name}» en la biblioteca.`);
}

async function openLibrary() {
  const all = (await DB.all()).filter(p => p.id !== AUTOSAVE).sort((a, b) => b.updated - a.updated);
  const items = all.map(p => {
    const row = document.createElement('div');
    row.className = 'item';
    row.appendChild(frameToCanvas(p.frames[0]));
    const open = document.createElement('button');
    open.className = 'grow';
    open.textContent = `${p.name} — ${p.width}x${p.height}, ${p.frames.length} frame(s)`;
    open.onclick = () => { closeSheet(); loadProject(p, p.name, p.id); };
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '🗑';
    del.onclick = async () => {
      if (!confirm(`¿Borrar «${p.name}» de la biblioteca?`)) return;
      await DB.del(p.id);
      if (st.id === p.id) st.id = null;
      openLibrary();
    };
    row.append(open, del);
    return row;
  });
  openSheet('Biblioteca de sprites', items, all.length ? 'Toca un sprite para abrirlo.' : 'Aún no has guardado nada. Usa Archivo → Guardar en la biblioteca.');
}

const safeName = () => (st.name === 'sin título' ? 'sprite' : st.name).replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '_');

async function deliver(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  setStatus(`Descargado ${filename}`);
}

const canvasBlob = c => new Promise(res => c.toBlob(res, 'image/png'));

async function exportPNG() {
  await deliver(await canvasBlob(frameToCanvas(st.frames[st.cur], null, exportScale)), `${safeName()}.png`);
}

async function exportSheet() {
  const fw = st.w * exportScale, fh = st.h * exportScale;
  const c = document.createElement('canvas');
  c.width = fw * st.frames.length; c.height = fh;
  const ctx = c.getContext('2d');
  st.frames.forEach((f, i) => ctx.drawImage(frameToCanvas(f, null, exportScale), i * fw, 0));
  await deliver(await canvasBlob(c), `${safeName()}_sheet_${st.frames.length}f.png`);
}

async function exportGIF() {
  const bytes = encodeGIF(st.frames, st.w, st.h, exportScale, 1000 / st.fps);
  await deliver(new Blob([bytes], { type: 'image/gif' }), `${safeName()}.gif`);
}

async function downloadProject() {
  const json = JSON.stringify(projectData());
  await deliver(new Blob([json], { type: 'application/json' }), `${safeName()}.pxf`);
}

$('fileInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const base = file.name.replace(/\.[^.]+$/, '');
  if (/\.(pxf|json)$/i.test(file.name)) {
    try { loadProject(JSON.parse(await file.text()), base, null); }
    catch (err) { alert('No se pudo abrir el archivo: ' + err.message); }
    return;
  }
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  const grab = (ox, w, h) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => {
    const i = (y * c.width + ox + x) * 4;
    return data[i + 3] >= 128 ? '#' + [data[i], data[i + 1], data[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('') : null;
  }));
  const iw = c.width, ih = c.height;
  if (iw === st.w && ih === st.h) replaceCurrent(grab(0, iw, ih));
  else if (ih === st.h && iw % st.w === 0 && confirm(`Parece un spritesheet de ${iw / st.w} frames. ¿Importarlo como frames?`)) {
    snapshot();
    st.frames = Array.from({ length: iw / st.w }, (_, i) => grab(i * st.w, st.w, st.h));
    st.cur = 0;
    refreshAll();
  } else if (iw <= 256 && ih <= 256 && confirm(`La imagen mide ${iw}x${ih}. ¿Crear un lienzo nuevo con ese tamaño?`)) {
    loadProject({ width: iw, height: ih, frames: [grab(0, iw, ih)] }, base, null);
    markDirty();
  } else if (iw > 256 || ih > 256) alert('La imagen es demasiado grande (máximo 256x256).');
});

// -------------------------------------------------------- interfaz ----

function updateTitle() {
  $('docName').textContent = `${st.name}${st.dirty ? ' •' : ''}  [${st.w}x${st.h}]`;
}

let statusMsg = '', statusUntil = 0;
function setStatus(msg) { statusMsg = msg; statusUntil = Date.now() + 4000; updateStatus(); }

function updateStatus(pos) {
  if (Date.now() < statusUntil) { $('status').textContent = statusMsg; return; }
  const tool = TOOLS.find(t => t[0] === st.tool)[1];
  const parts = [`Frame ${st.cur + 1}/${st.frames.length}`, tool, `${st.w}x${st.h}`, `Zoom ${view.zoom}×`];
  if (st.mirror) parts.push('Espejo');
  if (st.penOnly) parts.push('Solo lápiz');
  if (pos) parts.unshift(`(${pos[0]}, ${pos[1]})`);
  $('status').textContent = parts.join('  ·  ');
}

function buildTools() {
  const box = $('tools');
  for (const [key, label, sc] of TOOLS) {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = `Atajo: ${sc.toUpperCase()}`;
    b.dataset.tool = key;
    b.onclick = () => setTool(key);
    box.appendChild(b);
  }
  const br = $('brushes');
  for (const n of [1, 2, 3, 4]) {
    const b = document.createElement('button');
    b.textContent = n;
    b.dataset.brush = n;
    b.onclick = () => { st.brush = n; syncButtons(); };
    br.appendChild(b);
  }
}

function setTool(t) { st.tool = t; syncButtons(); updateStatus(); }

function syncButtons() {
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === st.tool));
  document.querySelectorAll('[data-brush]').forEach(b => b.classList.toggle('on', Number(b.dataset.brush) === st.brush));
  $('optPen').checked = st.penOnly;
  $('optMirror').checked = st.mirror;
  $('optFill').checked = st.fillShapes;
  $('optOnion').checked = st.onion;
  $('optGrid').checked = st.grid;
}

const OPTS = { optPen: 'penOnly', optMirror: 'mirror', optFill: 'fillShapes', optOnion: 'onion', optGrid: 'grid' };
for (const [id, key] of Object.entries(OPTS))
  $(id).onchange = () => {
    st[key] = $(id).checked;
    try { localStorage.setItem('pf_opts', JSON.stringify({ penOnly: st.penOnly, grid: st.grid, onion: st.onion })); } catch (e) {}
    if (key === 'grid') layout();
    if (key === 'onion') render();
    updateStatus();
  };

$('undo').onclick = undo;
$('redo').onclick = redo;
$('zoomIn').onclick = () => setZoom(view.zoom + Math.max(1, Math.round(view.zoom / 4)));
$('zoomOut').onclick = () => setZoom(view.zoom - Math.max(1, Math.round(view.zoom / 4)));
$('zoomFit').onclick = fitZoom;

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (k === 'y') { e.preventDefault(); redo(); }
    else if (k === 's') { e.preventDefault(); saveToLibrary(false); }
    else if (k === 'g') { e.preventDefault(); regenerate(); }
    return;
  }
  const tool = TOOLS.find(t => t[2] === k);
  if (tool) setTool(tool[0]);
  else if (k === 'm') { st.mirror = !st.mirror; syncButtons(); updateStatus(); }
  else if (k === 'x') swapColors();
  else if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (e.shiftKey) shiftFrame(...d);
    else if (d[1] === 0) selectFrame(st.cur + d[0]);
  } else if (k === '+' || k === '=') setZoom(view.zoom + 1);
  else if (k === '-') setZoom(view.zoom - 1);
});

window.addEventListener('resize', () => fitZoom());

// -------------------------------------------------------------- inicio ----

async function init() {
  buildTools();
  try { Object.assign(st, JSON.parse(localStorage.getItem('pf_opts') || '{}')); } catch (e) {}
  syncButtons();
  fpsSel.value = st.fps;
  updateColors();
  rebuildCanvas();
  refreshFrames();
  updateTitle();
  try {
    const saved = await DB.get(AUTOSAVE);
    if (saved) {
      loadProject(saved, saved.name, saved.docId);
      setStatus('Recuperado tu último trabajo.');
    }
  } catch (e) { /* sin IndexedDB (modo privado): se trabaja sin autoguardado */ }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol.startsWith('http'))
    navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
