// PixelForge web: editor de pixel art táctil (Apple Pencil, dedos y ratón) con capas e IA.
'use strict';

const $ = id => document.getElementById(id);
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'style') e.style.cssText = v;
    else if (k === 'list' || k.includes('-')) e.setAttribute(k, v);
    else if (k.startsWith('on') || k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid instanceof Node ? kid : String(kid));
  return e;
}

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
  ['ellipse', '◯ Elipse', 'o'], ['select', '⬚ Selección', 's'],
];
const TOOL_NAMES = { ...Object.fromEntries(TOOLS.map(t => [t[0], t[1]])), moveref: '✋ Mover foto' };
const AUTOSAVE = '__autosave__', REFSAVE = '__ref__';

const blank = (w, h) => Array.from({ length: h }, () => Array(w).fill(null));
const copyFrame = f => f.map(r => r.slice());
const deepFrames = frames => frames.map(f => f.map(copyFrame));
const newLayer = name => ({ name, visible: true, opacity: 1 });
const mod = (a, n) => ((a % n) + n) % n;

const st = {
  w: 32, h: 32, layers: [newLayer('Capa 1')], frames: [[blank(32, 32)]], cur: 0, layer: 0,
  palette: DEFAULT_PALETTE.slice(), primary: '#d6493c', secondary: '#0d0b14', tool: 'pencil', brush: 1,
  mirror: false, fillShapes: false, onion: true, grid: true, penOnly: false, tile: false, fps: 8,
  name: 'sin título', id: null, dirty: false,
};
const view = { zoom: 16, panX: 0, panY: 0 };
const ref = { src: null, canvas: null, data: null, iw: 0, ih: 0, x: 0, y: 0, fitScale: 1, scale: 1, opacity: 0.5, visible: true };
let sel = null, float = null, clip = null;
let undoStack = [], redoStack = [];
let playing = false, playIdx = 0, playTimer = null;
let lastGen = null, exportScale = 1;

const cel = () => st.frames[st.cur][st.layer];
const genSize = () => (Math.min(st.w, st.h) >= 64 ? 64 : 32);

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

// "frames" lleva cada frame aplanado para que la versión de escritorio también pueda abrirlo.
const projectData = () => ({
  version: 2, width: st.w, height: st.h, fps: st.fps, palette: st.palette,
  layers: st.layers, cels: st.frames, frames: st.frames.map((_, i) => composite(i)),
});

let autosaveTimer = null;
function markDirty() {
  st.dirty = true;
  updateTitle();
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    DB.put({ id: AUTOSAVE, name: st.name, docId: st.id, updated: Date.now(), ...projectData() }).catch(() => {});
  }, 800);
}

// ----------------------------------------------------------- historial ----

const stateCopy = () => ({ frames: deepFrames(st.frames), layers: st.layers.map(l => ({ ...l })), cur: st.cur, layer: st.layer });

function snapshot() {
  undoStack.push(stateCopy());
  if (undoStack.length > 80) undoStack.shift();
  redoStack = [];
  markDirty();
}

function applyState(s) {
  st.frames = s.frames;
  st.layers = s.layers;
  st.cur = Math.min(s.cur, s.frames.length - 1);
  st.layer = Math.min(s.layer, s.layers.length - 1);
  float = null;
  sel = null;
}

function restore(src, dst) {
  if (!src.length) return;
  dst.push(stateCopy());
  applyState(src.pop());
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

function stamp(out, grid, op, ox = 0, oy = 0) {
  for (let y = 0; y < grid.length; y++)
    for (let x = 0; x < grid[0].length; x++) {
      const c = grid[y][x], X = x + ox, Y = y + oy;
      if (!c || X < 0 || Y < 0 || X >= st.w || Y >= st.h) continue;
      const below = out[Y][X];
      out[Y][X] = op >= 1 || !below ? c : Gen.blend(below, c, op);
    }
}

// Mezcla las capas visibles de un frame (con la selección flotante si es el frame actual).
function composite(fi, withFloat = false) {
  const out = blank(st.w, st.h), fr = st.frames[fi];
  st.layers.forEach((L, li) => {
    if (!L.visible) return;
    stamp(out, fr[li], L.opacity);
    if (withFloat && float && fi === st.cur && li === st.layer) stamp(out, float.px, L.opacity, float.x, float.y);
  });
  return out;
}

const tiles = () => (st.tile ? 3 : 1);

function render() {
  const { w, h } = st, T = tiles(), W = w * T, H = h * T;
  if (art.width !== W || art.height !== H) { art.width = W; art.height = H; }
  const comp = composite(st.cur, true);
  const prev = st.onion && st.cur > 0 ? composite(st.cur - 1) : null;
  const img = actx.createImageData(W, H), d = img.data;
  const ca = rgbOf(CHECK_A), cb = rgbOf(CHECK_B);
  for (let Y = 0; Y < H; Y++)
    for (let X = 0; X < W; X++) {
      const x = X % w, y = Y % h, c = comp[y][x], i = (Y * W + X) * 4;
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
  drawOverlay();
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
  const b = st.brush, g = cel();
  for (let dy = 0; dy < b; dy++)
    for (let dx = 0; dx < b; dx++) {
      const px = x + dx - (b >> 1), py = y + dy - (b >> 1);
      for (const qx of st.mirror ? [px, st.w - 1 - px] : [px]) {
        const X = st.tile ? mod(qx, st.w) : qx, Y = st.tile ? mod(py, st.h) : py;
        if (inside(X, Y)) g[Y][X] = col;
      }
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
  const f = cel(), target = f[y][x];
  if (target === col) return;
  const stack = [[x, y]];
  while (stack.length) {
    let [px, py] = stack.pop();
    if (st.tile) { px = mod(px, st.w); py = mod(py, st.h); }
    if (inside(px, py) && f[py][px] === target) {
      f[py][px] = col;
      stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
    }
  }
}

function drawShape(stroke, x1, y1) {
  const f = cel();
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

// ---------------------------------------------------------- selección ----

const normRect = (a, b) => {
  const x0 = Math.max(0, Math.min(a[0], b[0])), y0 = Math.max(0, Math.min(a[1], b[1]));
  const x1 = Math.min(st.w - 1, Math.max(a[0], b[0])), y1 = Math.min(st.h - 1, Math.max(a[1], b[1]));
  return x1 < x0 || y1 < y0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
};
const inRect = (r, x, y) => r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
const extract = (g, r) => Array.from({ length: r.h }, (_, j) => g[r.y + j].slice(r.x, r.x + r.w));

function lift() { // levanta los píxeles seleccionados para moverlos
  snapshot();
  const g = cel();
  float = { ...sel, px: extract(g, sel) };
  for (let j = 0; j < sel.h; j++) for (let i = 0; i < sel.w; i++) g[sel.y + j][sel.x + i] = null;
}

function commitFloat() {
  if (!float) return;
  const g = cel();
  float.px.forEach((row, j) => row.forEach((c, i) => {
    const X = float.x + i, Y = float.y + j;
    if (c && inside(X, Y)) g[Y][X] = c;
  }));
  float = null;
  markDirty();
}

function copySel() {
  const src = float ? float.px : sel ? extract(cel(), sel) : null;
  if (!src) { setStatus('Primero selecciona una zona con ⬚ Selección.'); return false; }
  clip = { w: src[0].length, h: src.length, px: copyFrame(src) };
  setStatus(`Copiado ${clip.w}×${clip.h}. Puedes pegarlo en otro frame o capa.`);
  return true;
}

function deleteSel() {
  if (float) float = null;
  else if (sel) {
    snapshot();
    const g = cel();
    for (let j = 0; j < sel.h; j++) for (let i = 0; i < sel.w; i++) g[sel.y + j][sel.x + i] = null;
  }
  refreshAll();
}

function pasteClip() {
  if (!clip) { setStatus('No hay nada copiado.'); return; }
  commitFloat();
  snapshot();
  const x = sel ? sel.x : 0, y = sel ? sel.y : 0;
  float = { x, y, w: clip.w, h: clip.h, px: copyFrame(clip.px) };
  sel = { x, y, w: clip.w, h: clip.h };
  st.tool = 'select';
  syncButtons();
  render();
  setStatus('Pegado: arrástralo para colocarlo.');
}

function deselect() { commitFloat(); sel = null; refreshAll(); }

function selectAll() {
  commitFloat();
  sel = { x: 0, y: 0, w: st.w, h: st.h };
  st.tool = 'select';
  syncButtons();
  render();
}

function transformSel(fn) { // voltear la selección o, si no hay, la capa entera
  if (!sel) { replaceCel(fn(cel())); return; }
  if (!float) lift();
  float.px = fn(float.px);
  render();
}

// ------------------------------------------------- lápiz, dedos, ratón ----

const stage = $('stage'), board = $('board');
const touches = new Map();
let stroke = null, gesture = null;

function cellOf(e) {
  const r = art.getBoundingClientRect(), T = tiles();
  const X = Math.floor((e.clientX - r.left) / r.width * st.w * T), Y = Math.floor((e.clientY - r.top) / r.height * st.h * T);
  return st.tile ? [X - st.w, Y - st.h] : [X, Y];
}

function sampleRef(x, y) {
  if (!ref.canvas || !ref.visible) return null;
  const ix = Math.floor((x + 0.5 - ref.x) / ref.scale), iy = Math.floor((y + 0.5 - ref.y) / ref.scale);
  if (ix < 0 || iy < 0 || ix >= ref.iw || iy >= ref.ih) return null;
  const i = (iy * ref.iw + ix) * 4;
  return ref.data[i + 3] < 128 ? null : Gen.rgbToHex(ref.data[i], ref.data[i + 1], ref.data[i + 2]);
}

function pick(x, y, secondary) {
  if (st.tile) { x = mod(x, st.w); y = mod(y, st.h); }
  if (!inside(x, y)) return;
  const c = composite(st.cur)[y][x] || sampleRef(x, y); // si está vacío, toma el color de la foto
  if (!c) return;
  if (secondary) st.secondary = c; else st.primary = c;
  updateColors();
}

function startStroke(e) {
  if (playing) togglePlay();
  const [x, y] = cellOf(e), secondary = e.button === 2;
  const base = { id: e.pointerId, touch: e.pointerType === 'touch' };
  if (st.tool === 'moveref') {
    stroke = { ...base, moveref: true, sx: e.clientX, sy: e.clientY, rx: ref.x, ry: ref.y };
    return;
  }
  if (st.tool === 'picker') { stroke = { ...base, picker: true, secondary }; pick(x, y, secondary); return; }
  if (st.tool === 'select') {
    stroke = { ...base, select: true, start: [x, y] };
    if (float && inRect(float, x, y)) stroke.move = [x - float.x, y - float.y];
    else if (sel && inRect(sel, x, y)) { lift(); stroke.move = [x - float.x, y - float.y]; }
    else { commitFloat(); sel = normRect([x, y], [x, y]); }
    render();
    return;
  }
  if (st.tool === 'fill' && !st.tile && !inside(x, y)) return;
  if (!st.layers[st.layer].visible) setStatus('Ojo: estás pintando en una capa oculta.');
  snapshot();
  const col = st.tool === 'eraser' ? null : secondary ? st.secondary : st.primary;
  stroke = { ...base, start: [x, y], last: [x, y], base: copyFrame(cel()), col };
  if (st.tool === 'pencil' || st.tool === 'eraser') put(x, y, col);
  else if (st.tool === 'fill') flood(st.tile ? mod(x, st.w) : x, st.tile ? mod(y, st.h) : y, col);
  else drawShape(stroke, x, y);
  render();
}

function moveStroke(e) {
  if (stroke.moveref) {
    ref.x = stroke.rx + (e.clientX - stroke.sx) / view.zoom;
    ref.y = stroke.ry + (e.clientY - stroke.sy) / view.zoom;
    placeRef();
    return;
  }
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  for (const ev of events.length ? events : [e]) {
    const [x, y] = cellOf(ev);
    if (stroke.picker) { pick(x, y, stroke.secondary); continue; }
    if (stroke.select) {
      if (stroke.move) {
        float.x = x - stroke.move[0];
        float.y = y - stroke.move[1];
        sel = { x: float.x, y: float.y, w: float.w, h: float.h };
      } else sel = normRect(stroke.start, [x, y]);
      stroke.end = [x, y];
      continue;
    }
    if (st.tool === 'pencil' || st.tool === 'eraser') {
      for (const [px, py] of linePoints(stroke.last[0], stroke.last[1], x, y)) put(px, py, stroke.col);
      stroke.last = [x, y];
    } else if (st.tool !== 'fill') drawShape(stroke, x, y);
  }
  render();
}

function endStroke() {
  const s = stroke;
  stroke = null;
  if (s.moveref) { saveRef(); return; }
  if (s.picker) return;
  if (s.select) {
    // un toque sin arrastrar fuera de la selección la quita
    if (!s.move && (!s.end || (s.end[0] === s.start[0] && s.end[1] === s.start[1]))) sel = null;
    render();
    return;
  }
  refreshFrames();
}

function cancelStroke() { // un segundo dedo convierte el trazo en gesto: lo deshacemos
  if (!stroke.picker && !stroke.select && !stroke.moveref && undoStack.length) {
    applyState(undoStack.pop());
    render();
  }
  stroke = null;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const maxZoom = () => Math.max(1, Math.min(64, Math.floor(6000 / (Math.max(st.w, st.h) * tiles()))));

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
  try { stage.setPointerCapture(e.pointerId); } catch (err) { /* puntero ya liberado */ }
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
  const T = tiles(), cw = st.w * T * view.zoom, ch = st.h * T * view.zoom;
  board.style.width = cw + 'px'; board.style.height = ch + 'px';
  art.style.width = cw + 'px'; art.style.height = ch + 'px';
  placeBoard();
  const g = $('grid'), dpr = window.devicePixelRatio || 1;
  g.style.width = cw + 'px'; g.style.height = ch + 'px';
  g.width = Math.round(cw * dpr); g.height = Math.round(ch * dpr);
  placeRef();
  drawOverlay();
  updateStatus();
}

function drawOverlay() {
  const g = $('grid'), ctx = g.getContext('2d'), dpr = window.devicePixelRatio || 1, z = view.zoom;
  const T = tiles(), W = st.w * T, H = st.h * T;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, g.width, g.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineWidth = 1 / dpr;
  if (st.grid && z >= 6)
    for (const major of [false, true]) {
      ctx.beginPath();
      for (let x = 1; x < W; x++) if ((x % 8 === 0) === major) { ctx.moveTo(x * z, 0); ctx.lineTo(x * z, H * z); }
      for (let y = 1; y < H; y++) if ((y % 8 === 0) === major) { ctx.moveTo(0, y * z); ctx.lineTo(W * z, y * z); }
      ctx.strokeStyle = major ? 'rgba(150,150,200,.55)' : 'rgba(0,0,0,.28)';
      ctx.stroke();
    }
  const ox = st.tile ? st.w : 0, oy = st.tile ? st.h : 0;
  if (st.tile) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(91,110,225,.9)';
    ctx.strokeRect(ox * z, oy * z, st.w * z, st.h * z);
  }
  if (sel) {
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    for (const [color, offset] of [['#000', 0], ['#fff', 5]]) {
      ctx.strokeStyle = color;
      ctx.lineDashOffset = offset;
      ctx.strokeRect((sel.x + ox) * z + 1, (sel.y + oy) * z + 1, sel.w * z - 2, sel.h * z - 2);
    }
    ctx.setLineDash([]);
  }
}

function setZoom(z) {
  z = Math.max(1, Math.min(maxZoom(), z));
  if (z !== view.zoom) { view.zoom = z; layout(); }
}

function fitZoom() {
  const r = stage.getBoundingClientRect(), T = tiles();
  view.zoom = Math.max(1, Math.min(maxZoom(), Math.floor(Math.min(r.width * 0.92 / (st.w * T), r.height * 0.92 / (st.h * T)))));
  view.panX = view.panY = 0;
  layout();
}

function rebuildCanvas() {
  fitZoom();
  render();
}

// ---------------------------------------------------- foto de calco ----

const refImg = $('refImg');

function placeRef() {
  if (!ref.src || !ref.visible) { refImg.hidden = true; return; }
  const z = view.zoom, off = st.tile ? 1 : 0;
  refImg.hidden = false;
  refImg.style.left = (ref.x + off * st.w) * z + 'px';
  refImg.style.top = (ref.y + off * st.h) * z + 'px';
  refImg.style.width = ref.iw * ref.scale * z + 'px';
  refImg.style.height = ref.ih * ref.scale * z + 'px';
  refImg.style.opacity = ref.opacity;
}

function syncRefPanel() {
  $('refCtl').hidden = !ref.src;
  $('refLoad').textContent = ref.src ? '📷 Cambiar foto…' : '📷 Cargar foto…';
  $('refOpacity').value = Math.round(ref.opacity * 100);
  $('refScale').value = Math.round(ref.scale / ref.fitScale * 100);
  $('refHide').textContent = ref.visible ? 'Ocultar' : 'Mostrar';
}

async function setRef(src, saved) {
  const img = await Tools.loadImage(src);
  const c = Tools.toCanvas(img, 1024);
  ref.src = c.toDataURL('image/png');
  ref.canvas = c;
  ref.data = Tools.pixelsOf(c);
  ref.iw = c.width; ref.ih = c.height;
  ref.fitScale = Math.min(st.w / ref.iw, st.h / ref.ih);
  if (saved) Object.assign(ref, { x: saved.x, y: saved.y, scale: saved.scale, opacity: saved.opacity, visible: saved.visible });
  else fitRef();
  refImg.src = ref.src;
  ref.visible = saved ? saved.visible : true;
  placeRef();
  syncRefPanel();
  if (!saved) saveRef();
}

function fitRef() {
  ref.fitScale = Math.min(st.w / ref.iw, st.h / ref.ih);
  ref.scale = ref.fitScale;
  ref.x = (st.w - ref.iw * ref.scale) / 2;
  ref.y = (st.h - ref.ih * ref.scale) / 2;
}

function saveRef() {
  const data = ref.src ? { id: REFSAVE, src: ref.src, x: ref.x, y: ref.y, scale: ref.scale, opacity: ref.opacity, visible: ref.visible } : null;
  (data ? DB.put(data) : DB.del(REFSAVE)).catch(() => {});
}

$('refLoad').onclick = () => $('refInput').click();
$('refInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    await setRef(URL.createObjectURL(file));
    setStatus('Foto cargada. Ajusta transparencia y tamaño, y pinta encima. El cuentagotas toma colores de la foto.');
  } catch (err) { alert(err.message); }
});
$('refOpacity').oninput = () => { ref.opacity = $('refOpacity').value / 100; placeRef(); };
$('refOpacity').onchange = saveRef;
$('refScale').oninput = () => {
  const cx = ref.x + ref.iw * ref.scale / 2, cy = ref.y + ref.ih * ref.scale / 2;
  ref.scale = ref.fitScale * $('refScale').value / 100;
  ref.x = cx - ref.iw * ref.scale / 2;
  ref.y = cy - ref.ih * ref.scale / 2;
  placeRef();
};
$('refScale').onchange = saveRef;
$('refMove').onclick = () => setTool(st.tool === 'moveref' ? 'pencil' : 'moveref');
$('refFit').onclick = () => { fitRef(); placeRef(); syncRefPanel(); saveRef(); };
$('refHide').onclick = () => { ref.visible = !ref.visible; placeRef(); syncRefPanel(); saveRef(); };
$('refDel').onclick = () => {
  ref.src = ref.canvas = ref.data = null;
  if (st.tool === 'moveref') setTool('pencil');
  placeRef(); syncRefPanel(); saveRef();
};

// Formulario común de colores/contorno para fotos e imágenes de IA.
function colorOptions(defaults = {}) {
  const colors = el('select', {},
    el('option', { value: 'pal' }, 'Usar mi paleta'),
    ...[4, 8, 12, 16, 24, 32].map(n => el('option', { value: n }, `${n} colores automáticos`)));
  colors.value = defaults.colors || '16';
  const outline = el('input', { type: 'checkbox', checked: Boolean(defaults.outline) });
  const removeBg = el('input', { type: 'checkbox', checked: defaults.removeBg !== false });
  const node = el('div', {},
    el('span', { className: 'lbl' }, 'Colores'), colors,
    el('label', { className: 'chk' }, removeBg, 'Quitar el fondo'),
    el('label', { className: 'chk' }, outline, 'Añadir contorno oscuro'));
  const get = () => ({ colors: colors.value === 'pal' ? st.palette : Number(colors.value), outline: outline.checked, removeBg: removeBg.checked });
  return { node, get, inputs: [colors, outline, removeBg] };
}

function finishGrid(grid, opts) {
  let g = Tools.quantize(grid, opts.colors);
  if (opts.outline) g = Tools.outline(g);
  return g;
}

function refToGrid(opts) {
  const c = ref.canvas, s = ref.scale;
  const box = { x: Math.max(0, Math.floor(-ref.x / s)), y: Math.max(0, Math.floor(-ref.y / s)) };
  box.w = Math.min(ref.iw, Math.ceil((st.w - ref.x) / s)) - box.x;
  box.h = Math.min(ref.ih, Math.ceil((st.h - ref.y) / s)) - box.y;
  const bg = opts.removeBg && box.w > 2 && box.h > 2 ? Tools.estimateBg(c, ref.data, box) : null;
  return Tools.sampleGrid(c, ref.data, st.w, st.h, (x, y) =>
    [(x - ref.x) / s, (y - ref.y) / s, (x + 1 - ref.x) / s, (y + 1 - ref.y) / s], bg);
}

$('refConvert').onclick = () => {
  if (!ref.canvas) return;
  const opts = colorOptions({ colors: '16', removeBg: false });
  const prev = el('canvas', { className: 'checker' });
  const update = () => frameToCanvas(finishGrid(refToGrid(opts.get()), opts.get()), prev);
  opts.inputs.forEach(i => { i.onchange = update; });
  update();
  openSheet('Convertir foto a píxeles', [
    el('div', { className: 'note' }, 'Convierte la parte de la foto que está sobre el lienzo en píxeles, en una capa nueva.'),
    opts.node,
    el('div', { className: 'pair' }, el('img', { src: ref.src, className: 'checker' }), prev),
    ['✅ Crear capa con la foto pixelada', () => addLayerWith(finishGrid(refToGrid(opts.get()), opts.get()), 'Foto')],
  ]);
};

function addLayerWith(grid, name) {
  snapshot();
  const idx = st.layer + 1;
  st.layers.splice(idx, 0, newLayer(name));
  st.frames.forEach((f, i) => f.splice(idx, 0, i === st.cur ? grid : blank(st.w, st.h)));
  st.layer = idx;
  refreshAll();
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
    const d = el('div', { className: c === st.primary ? 'p1' : c === st.secondary ? 'p2' : '' });
    d.style.background = c;
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
  for (const f of st.frames) for (const g of f) for (const row of g) for (const c of row) if (c && !cols.includes(c)) cols.push(c);
  if (cols.length) { st.palette = cols.slice(0, 256); updateColors(); }
};
$('palReset').onclick = () => { st.palette = DEFAULT_PALETTE.slice(); updateColors(); };

// -------------------------------------------------------------- capas ----

function refreshLayers() {
  const box = $('layers');
  box.innerHTML = '';
  for (let li = st.layers.length - 1; li >= 0; li--) {
    const L = st.layers[li];
    const eye = el('button', { textContent: L.visible ? '👁' : '🚫', title: 'Mostrar / ocultar' });
    eye.onclick = e => { e.stopPropagation(); L.visible = !L.visible; markDirty(); refreshAll(); };
    const name = el('span', { textContent: L.name + (L.opacity < 1 ? ` (${Math.round(L.opacity * 100)}%)` : '') });
    const row = el('div', { className: 'layer' + (li === st.layer ? ' cur' : '') }, eye, name);
    row.onclick = () => selectLayer(li);
    row.ondblclick = () => {
      const n = prompt('Nombre de la capa:', L.name);
      if (n) { L.name = n; markDirty(); refreshLayers(); }
    };
    box.appendChild(row);
  }
  $('lyOpacity').value = Math.round(st.layers[st.layer].opacity * 100);
}

function selectLayer(li) {
  commitFloat();
  sel = null;
  st.layer = li;
  refreshLayers();
  render();
}

$('lyAdd').onclick = () => addLayerWith(blank(st.w, st.h), `Capa ${st.layers.length + 1}`);
$('lyDup').onclick = () => {
  commitFloat();
  snapshot();
  const idx = st.layer + 1, L = st.layers[st.layer];
  st.layers.splice(idx, 0, { ...L, name: L.name + ' copia' });
  st.frames.forEach(f => f.splice(idx, 0, copyFrame(f[st.layer])));
  st.layer = idx;
  refreshAll();
};
$('lyDel').onclick = () => {
  if (st.layers.length === 1) { setStatus('No se puede borrar la única capa (usa «Limpiar capa»).'); return; }
  if (!confirm(`¿Borrar la capa «${st.layers[st.layer].name}» en todos los frames?`)) return;
  float = null; sel = null;
  snapshot();
  st.layers.splice(st.layer, 1);
  st.frames.forEach(f => f.splice(st.layer, 1));
  st.layer = Math.min(st.layer, st.layers.length - 1);
  refreshAll();
};
function moveLayer(d) {
  const j = st.layer + d;
  if (j < 0 || j >= st.layers.length) return;
  commitFloat();
  snapshot();
  [st.layers[st.layer], st.layers[j]] = [st.layers[j], st.layers[st.layer]];
  st.frames.forEach(f => { [f[st.layer], f[j]] = [f[j], f[st.layer]]; });
  st.layer = j;
  refreshAll();
}
$('lyUp').onclick = () => moveLayer(1);
$('lyDown').onclick = () => moveLayer(-1);
$('lyMerge').onclick = () => {
  if (st.layer === 0) { setStatus('No hay ninguna capa debajo para fusionar.'); return; }
  commitFloat();
  snapshot();
  const li = st.layer, op = st.layers[li].opacity;
  st.frames.forEach(f => {
    const below = f[li - 1];
    f[li].forEach((row, y) => row.forEach((c, x) => {
      if (c) below[y][x] = op >= 1 || !below[y][x] ? c : Gen.blend(below[y][x], c, op);
    }));
    f.splice(li, 1);
  });
  st.layers.splice(li, 1);
  st.layer = li - 1;
  refreshAll();
};
$('lyOpacity').oninput = () => { st.layers[st.layer].opacity = $('lyOpacity').value / 100; render(); };
$('lyOpacity').onchange = () => { markDirty(); refreshLayers(); refreshFrames(); };

// ------------------------------------------------------------- frames ----

function refreshFrames() {
  const box = $('frames');
  box.innerHTML = '';
  st.frames.forEach((f, i) => {
    const c = frameToCanvas(composite(i));
    c.className = 'checker';
    const d = el('div', { className: 'fr' + (i === st.cur ? ' cur' : '') }, c, el('span', { textContent: i + 1 }));
    d.onclick = () => selectFrame(i);
    box.appendChild(d);
  });
  const cur = box.children[st.cur];
  if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  updateStatus();
}

function selectFrame(i) {
  commitFloat();
  sel = null;
  st.cur = mod(i, st.frames.length);
  render();
  refreshFrames();
}

function refreshAll() { render(); refreshFrames(); refreshLayers(); updateTitle(); }

function replaceCel(g) { commitFloat(); snapshot(); st.frames[st.cur][st.layer] = g; refreshAll(); }

const blankFrame = () => st.layers.map(() => blank(st.w, st.h));
$('frAdd').onclick = () => { commitFloat(); snapshot(); st.frames.splice(st.cur + 1, 0, blankFrame()); selectFrame(st.cur + 1); };
$('frDup').onclick = () => { commitFloat(); snapshot(); st.frames.splice(st.cur + 1, 0, st.frames[st.cur].map(copyFrame)); selectFrame(st.cur + 1); };
$('frDel').onclick = () => {
  commitFloat();
  snapshot();
  if (st.frames.length === 1) st.frames[0] = blankFrame();
  else { st.frames.splice(st.cur, 1); st.cur = Math.min(st.cur, st.frames.length - 1); }
  refreshAll();
};
function moveFrame(d) {
  const j = st.cur + d;
  if (j < 0 || j >= st.frames.length) return;
  commitFloat();
  snapshot();
  [st.frames[st.cur], st.frames[j]] = [st.frames[j], st.frames[st.cur]];
  selectFrame(j);
}
$('frLeft').onclick = () => moveFrame(-1);
$('frRight').onclick = () => moveFrame(1);

$('flipH').onclick = () => transformSel(g => g.map(r => r.slice().reverse()));
$('flipV').onclick = () => transformSel(g => copyFrame(g).reverse());
$('clear').onclick = () => replaceCel(blank(st.w, st.h));
$('replace').onclick = () => replaceCel(cel().map(r => r.map(c => (c === st.primary ? st.secondary : c))));
const shiftCel = (dx, dy) => {
  if (float) { float.x += dx; float.y += dy; sel = { x: float.x, y: float.y, w: float.w, h: float.h }; render(); return; }
  replaceCel(Gen.shifted(cel(), dx, dy, true));
};
document.querySelectorAll('[data-shift]').forEach(b => {
  const [dx, dy] = b.dataset.shift.split(',').map(Number);
  b.onclick = () => shiftCel(dx, dy);
});
$('selCopy').onclick = copySel;
$('selCut').onclick = () => { if (copySel()) deleteSel(); };
$('selPaste').onclick = pasteClip;
$('selDelete').onclick = deleteSel;
$('selAll').onclick = selectAll;
$('selNone').onclick = deselect;

// ------------------------------------------------------- vista previa ----

function drawPreview(i) { frameToCanvas(composite(i, i === st.cur), $('preview')); }

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
  commitFloat();
  const seed = Math.floor(Math.random() * 2 ** 30);
  lastGen = [fn, multi];
  const result = fn(seed, genSize());
  snapshot();
  if (multi) {
    const base = st.frames[st.cur];
    st.frames = result.map(g => st.layers.map((_, li) => (li === st.layer ? Gen.fit(g, st.w, st.h) : copyFrame(base[li]))));
    st.cur = 0;
  } else st.frames[st.cur][st.layer] = Gen.fit(result, st.w, st.h);
  refreshAll();
  setStatus(`Generado a ${genSize()}×${genSize()} (semilla ${seed}). «Otra variante» o Ctrl+G para probar otro.`);
}
const regenerate = () => { if (lastGen) generate(...lastGen); };

function autoAnim(fn) {
  commitFloat();
  snapshot();
  const base = st.frames[st.cur], box = Gen.bboxRows(composite(st.cur));
  const seqs = base.map(g => fn(g, box)); // misma animación en todas las capas
  st.frames = seqs[0].map((_, i) => seqs.map(s => copyFrame(s[i])));
  st.cur = 0;
  refreshAll();
  if (!playing) togglePlay();
}

// ------------------------------------------------------------ menús ----

function openSheet(title, items, note) {
  const box = $('sheetBox');
  box.innerHTML = '';
  const close = el('button', { textContent: '✕', onclick: closeSheet });
  box.appendChild(el('h2', {}, el('span', { textContent: title }), close));
  if (note) box.appendChild(el('div', { className: 'note', textContent: note }));
  for (const it of items) {
    if (it instanceof Node) { box.appendChild(it); continue; }
    box.appendChild(el('button', { textContent: it[0], onclick: () => { closeSheet(); it[1](); } }));
  }
  $('sheet').classList.add('open');
}
const closeSheet = () => $('sheet').classList.remove('open');
$('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });

const MENUS = {
  archivo: () => openSheet('Archivo', [
    ['📄 Nuevo lienzo…', newCanvasSheet],
    [st.id ? `💾 Guardar «${st.name}»` : '💾 Guardar en la biblioteca…', () => saveToLibrary(false)],
    ['📝 Guardar como copia…', () => saveToLibrary(true)],
    ['📚 Biblioteca de sprites', openLibrary],
    ['📥 Abrir archivo (.pxf o PNG)…', () => $('fileInput').click()],
    ['📤 Descargar proyecto (.pxf)', downloadProject],
  ], 'Los sprites se guardan en este dispositivo. Descarga el .pxf o exporta PNG para tener copia en Archivos, en tu PC o en GitHub.'),
  generar: () => openSheet('Generar', [
    ['🧍 Personaje', () => generate(Gen.personaje)],
    ['🚶 Personaje caminando (4 frames)', () => generate(Gen.personajeCaminando, true)],
    ['👾 Criatura / monstruo', () => generate(Gen.criatura)],
    ...Object.entries(Gen.OBJETOS).map(([n, fn]) => [`🎁 Objeto: ${n}`, () => generate(fn)]),
    ['🎲 Objeto aleatorio', () => generate(Gen.objetoAleatorio)],
    ['🔁 Otra variante', regenerate],
  ], `Se dibuja en la capa actual a ${genSize()}×${genSize()} (en lienzos de 64 o más se genera con detalle de 64×64). Puedes deshacer con ↶.`),
  animacion: () => openSheet('Animación', [
    ...Object.entries(Gen.ANIMACIONES).map(([n, fn]) => [`🎞️ ${n}`, () => autoAnim(fn)]),
    [playing ? '■ Parar' : '▶ Reproducir', togglePlay],
  ], 'Crea la animación a partir del frame actual (todas las capas) y reemplaza los frames. Puedes deshacer con ↶.'),
  exportar: () => {
    const row = el('div', { className: 'row', style: 'margin:4px 0 8px' });
    for (const s of [1, 2, 4, 8, 16]) {
      const b = el('button', { textContent: `${s}×`, className: s === exportScale ? 'on' : '' });
      b.onclick = () => { exportScale = s; row.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
      row.appendChild(b);
    }
    openSheet('Exportar', [row,
      ['🖼️ Frame actual (PNG)', exportPNG],
      ['🧩 Spritesheet (PNG horizontal)', exportSheet],
      ['🎞️ GIF animado', exportGIF],
      ['🎮 Paquete para motores (Godot, Unity, Phaser)', exportEngine],
    ], 'Escala: 1× es el tamaño real para usar en un motor de juegos.');
  },
  ia: () => openSheet('Asistente IA (Gemini)', [
    ['🪄 Crear sprite desde texto', aiCreateSheet],
    ['✏️ Editar mi sprite', aiEditSheet],
    ['💬 Asistente (consejos sobre tu sprite)', aiChatSheet],
    ['🎨 Paleta por tema', aiPaletteSheet],
    ['⚙️ Ajustes de Gemini (clave y modelos)', aiSettingsSheet],
  ], AI.ready() ? 'Gemini está configurado.' : 'Primero pon tu clave gratuita de Gemini en «Ajustes de Gemini».'),
};
document.querySelectorAll('[data-menu]').forEach(b => { b.onclick = () => MENUS[b.dataset.menu](); });

// ------------------------------------------------- archivos / biblioteca ----

function loadProject(p, name, id) {
  st.w = p.width; st.h = p.height;
  if (p.cels && p.layers) {
    st.frames = p.cels.map(f => f.map(copyFrame));
    st.layers = p.layers.map(l => ({ ...l }));
  } else {
    st.frames = p.frames.map(f => [copyFrame(f)]);
    st.layers = [newLayer('Capa 1')];
  }
  st.cur = 0;
  st.layer = st.layers.length - 1;
  if (p.palette && p.palette.length) st.palette = p.palette.slice();
  if (p.fps) { st.fps = p.fps; fpsSel.value = p.fps; }
  st.name = name || 'sin título';
  st.id = id || null;
  st.dirty = false;
  undoStack = []; redoStack = [];
  sel = float = null;
  if (playing) togglePlay();
  if (ref.canvas) ref.fitScale = Math.min(st.w / ref.iw, st.h / ref.ih);
  rebuildCanvas();
  refreshFrames();
  refreshLayers();
  updateColors();
  updateTitle();
}

function newCanvas(w, h) {
  if (w < 1 || h < 1 || w > 256 || h > 256) { alert('El tamaño debe estar entre 1 y 256 píxeles.'); return; }
  loadProject({ width: w, height: h, frames: [blank(w, h)] }, 'sin título', null);
  markDirty();
}

function newCanvasSheet() {
  openSheet('Nuevo lienzo', [
    ...[[16, 'mini iconos'], [32, 'clásico'], [48, ''], [64, 'más detalle'], [128, 'retratos, fondos']]
      .map(([n, d]) => [`▫️ ${n}×${n}${d ? '  — ' + d : ''}`, () => newCanvas(n, n)]),
    ['✏️ Tamaño personalizado…', () => {
      const txt = prompt('Tamaño del lienzo (ancho x alto):', `${st.w}x${st.h}`);
      const nums = ((txt || '').match(/\d+/g) || []).map(Number);
      if (nums.length) newCanvas(nums[0], nums[1] || nums[0]);
    }],
  ], 'Se empieza un sprite nuevo (el actual sigue en la biblioteca si lo guardaste).');
}

async function saveToLibrary(asCopy) {
  commitFloat();
  if (!st.id || asCopy) {
    const name = prompt('Nombre del sprite:', st.name === 'sin título' ? '' : st.name);
    if (!name) return;
    st.name = name;
    st.id = 'p' + Date.now();
  }
  await DB.put({ id: st.id, name: st.name, updated: Date.now(), ...projectData() });
  markDirty(); // actualiza el autoguardado con el nombre/id
  st.dirty = false;
  updateTitle();
  setStatus(`Guardado «${st.name}» en la biblioteca.`);
}

async function openLibrary() {
  const all = (await DB.all()).filter(p => p.id !== AUTOSAVE && p.id !== REFSAVE).sort((a, b) => b.updated - a.updated);
  const items = all.map(p => {
    const thumb = frameToCanvas(p.frames[0]);
    thumb.className = 'checker';
    const open = el('button', {
      className: 'grow', textContent: `${p.name} — ${p.width}×${p.height}, ${p.frames.length} frame(s)`,
      onclick: () => { closeSheet(); loadProject(p, p.name, p.id); },
    });
    const del = el('button', {
      className: 'del', textContent: '🗑',
      onclick: async () => {
        if (!confirm(`¿Borrar «${p.name}» de la biblioteca?`)) return;
        await DB.del(p.id);
        if (st.id === p.id) st.id = null;
        openLibrary();
      },
    });
    return el('div', { className: 'item' }, thumb, open, del);
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
  const a = el('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  setStatus(`Descargado ${filename}`);
}

const canvasBlob = c => new Promise(res => c.toBlob(res, 'image/png'));
const allComposites = () => { commitFloat(); return st.frames.map((_, i) => composite(i)); };

function sheetCanvas(scale) {
  const frames = allComposites(), fw = st.w * scale, fh = st.h * scale;
  const c = el('canvas', { width: fw * frames.length, height: fh });
  const ctx = c.getContext('2d');
  frames.forEach((f, i) => ctx.drawImage(frameToCanvas(f, null, scale), i * fw, 0));
  return c;
}

async function exportPNG() {
  commitFloat();
  await deliver(await canvasBlob(frameToCanvas(composite(st.cur), null, exportScale)), `${safeName()}.png`);
}

async function exportSheet() {
  await deliver(await canvasBlob(sheetCanvas(exportScale)), `${safeName()}_sheet_${st.frames.length}f.png`);
}

async function exportGIF() {
  const bytes = encodeGIF(allComposites(), st.w, st.h, exportScale, 1000 / st.fps);
  await deliver(new Blob([bytes], { type: 'image/gif' }), `${safeName()}.gif`);
}

async function exportEngine() {
  const name = safeName().replace(/\s+/g, '_'), sc = exportScale;
  const fw = st.w * sc, fh = st.h * sc, n = st.frames.length, dur = Math.round(1000 / st.fps);
  const png = new Uint8Array(await (await canvasBlob(sheetCanvas(sc))).arrayBuffer());
  const frames = {};
  for (let i = 0; i < n; i++)
    frames[`${name}_${i}`] = {
      frame: { x: i * fw, y: 0, w: fw, h: fh }, rotated: false, trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: fw, h: fh }, sourceSize: { w: fw, h: fh }, duration: dur,
    };
  const json = JSON.stringify({
    frames,
    meta: {
      app: 'PixelForge', version: '2', image: `${name}.png`, format: 'RGBA8888',
      size: { w: fw * n, h: fh }, scale: '1',
      frameTags: [{ name, from: 0, to: n - 1, direction: 'forward' }],
    },
  }, null, 2);
  const tres = [
    `[gd_resource type="SpriteFrames" load_steps=${n + 2} format=3]`, '',
    `[ext_resource type="Texture2D" path="res://${name}.png" id="1_sheet"]`, '',
    ...Array.from({ length: n }, (_, i) => [
      `[sub_resource type="AtlasTexture" id="AtlasTexture_${i}"]`, 'atlas = ExtResource("1_sheet")',
      `region = Rect2(${i * fw}, 0, ${fw}, ${fh})`, '']).flat(),
    '[resource]', 'animations = [{', '"frames": [',
    Array.from({ length: n }, (_, i) => `{\n"duration": 1.0,\n"texture": SubResource("AtlasTexture_${i}")\n}`).join(', '),
    '],', '"loop": true,', `"name": &"${name}",`, `"speed": ${st.fps}.0`, '}]', '',
  ].join('\n');
  const readme = [
    `PixelForge — paquete "${name}" (${n} frames de ${fw}x${fh} px, ${st.fps} fps)`, '',
    `${name}.png   spritesheet horizontal`,
    `${name}.json  atlas (formato JSON hash de Aseprite/TexturePacker)`,
    `${name}.tres  SpriteFrames para Godot 4`, '',
    'GODOT 4: copia el .png y el .tres a la raíz del proyecto (res://). Si los pones en otra carpeta,',
    `  edita la ruta "res://${name}.png" dentro del .tres. Úsalo en un AnimatedSprite2D (Sprite Frames).`,
    '  Para que se vea nítido: Proyecto > Configuración > Rendering > Textures > Default Texture Filter = Nearest.', '',
    `UNITY: importa ${name}.png > Texture Type: Sprite (2D and UI), Sprite Mode: Multiple,`,
    `  Pixels Per Unit: ${fw}, Filter Mode: Point (no filter), Compression: None.`,
    `  Sprite Editor > Slice > Grid By Cell Size: ${fw} x ${fh}. Selecciona los sprites y arrástralos a la escena`,
    '  para crear la animación.', '',
    `PHASER 3: this.load.aseprite('${name}', '${name}.png', '${name}.json');`,
    `  y en create(): this.anims.createFromAseprite('${name}'); sprite.play('${name}');`,
    '  (o this.load.atlas con el mismo .json).', '',
  ].join('\n');
  await deliver(Tools.zip([
    { name: `${name}.png`, data: png }, { name: `${name}.json`, data: json },
    { name: `${name}.tres`, data: tres }, { name: 'LEEME.txt', data: readme },
  ]), `${name}_motores.zip`);
}

async function downloadProject() {
  commitFloat();
  await deliver(new Blob([JSON.stringify(projectData())], { type: 'application/json' }), `${safeName()}.pxf`);
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
  const c = el('canvas', { width: bmp.width, height: bmp.height });
  c.getContext('2d').drawImage(bmp, 0, 0);
  const data = Tools.pixelsOf(c);
  const grab = (ox, w, h) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => {
    const i = (y * c.width + ox + x) * 4;
    return data[i + 3] >= 128 ? Gen.rgbToHex(data[i], data[i + 1], data[i + 2]) : null;
  }));
  const iw = c.width, ih = c.height;
  if (iw === st.w && ih === st.h) replaceCel(grab(0, iw, ih));
  else if (ih === st.h && iw % st.w === 0 && confirm(`Parece un spritesheet de ${iw / st.w} frames. ¿Importarlo como frames?`)) {
    snapshot();
    st.frames = Array.from({ length: iw / st.w }, (_, i) => st.layers.map((_, li) => (li === st.layer ? grab(i * st.w, st.w, st.h) : blank(st.w, st.h))));
    st.cur = 0;
    refreshAll();
  } else if (iw <= 256 && ih <= 256 && confirm(`La imagen mide ${iw}x${ih}. ¿Crear un lienzo nuevo con ese tamaño?`)) {
    loadProject({ width: iw, height: ih, frames: [grab(0, iw, ih)] }, base, null);
    markDirty();
  } else if (iw > 256 || ih > 256) alert('La imagen es demasiado grande para abrirla como sprite. Usa «Foto de calco» y «Convertir a píxeles».');
});

// ------------------------------------------------------------- IA ----

function aiGuard() {
  if (AI.ready()) return true;
  aiSettingsSheet('Para usar la IA, pega aquí tu clave de Gemini.');
  return false;
}

function aiSettingsSheet(msg) {
  const s = AI.settings();
  const key = el('input', { type: 'password', value: s.key, placeholder: 'AIza…', autocomplete: 'off' });
  const textModel = el('input', { type: 'text', value: s.textModel, list: 'aiModels' });
  const imageModel = el('input', { type: 'text', value: s.imageModel, list: 'aiModels' });
  const models = el('datalist', { id: 'aiModels' });
  const out = el('div', { className: 'note' });
  const saveBtn = el('button', { textContent: '💾 Guardar', style: 'width:100%;margin-top:8px' });
  saveBtn.onclick = () => {
    AI.save({ key: key.value.trim(), textModel: textModel.value.trim() || s.textModel, imageModel: imageModel.value.trim() || s.imageModel });
    out.className = 'note';
    out.textContent = '✅ Guardado en este dispositivo.';
  };
  const testBtn = el('button', { textContent: '🔌 Probar clave y ver modelos', style: 'width:100%;margin-top:4px' });
  testBtn.onclick = async () => {
    saveBtn.onclick();
    testBtn.disabled = true;
    out.className = 'note';
    out.textContent = 'Conectando con Gemini…';
    try {
      const list = await AI.listModels();
      models.replaceChildren(...list.map(m => el('option', { value: m })));
      const img = list.filter(m => /image/.test(m));
      out.textContent = `✅ Funciona. ${list.length} modelos disponibles.` +
        (img.length ? ` Con imágenes: ${img.join(', ')}.` : ' Ninguno con «image» en el nombre: la creación de imágenes puede no estar disponible con tu clave.');
    } catch (err) { out.className = 'error'; out.textContent = '❌ ' + err.message; }
    testBtn.disabled = false;
  };
  openSheet('Ajustes de Gemini', [
    msg ? el('div', { className: 'note', textContent: msg }) : null,
    el('div', { className: 'note' }, '1. Entra en ', el('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener', textContent: 'aistudio.google.com/apikey' }),
      ' con tu cuenta de Google y pulsa «Create API key».', el('br'), '2. Copia la clave y pégala aquí.'),
    el('span', { className: 'lbl' }, 'Clave de API'), key,
    el('span', { className: 'lbl' }, 'Modelo de texto (asistente y paletas)'), textModel,
    el('span', { className: 'lbl' }, 'Modelo de imagen (crear y editar sprites)'), imageModel, models,
    saveBtn, testBtn, out,
    el('div', { className: 'note' }, '🔒 La clave se guarda solo en este dispositivo y solo se envía a Google. No se sube a GitHub. Al usar la IA se envía a Google tu texto y, si lo pides, tu sprite.'),
  ].filter(Boolean));
}

// Cuadrícula -> imagen grande con fondo magenta para que Gemini la vea bien.
function gridToAiImage(grid, bg = '#ff00ff') {
  const scale = Math.max(1, Math.floor(512 / Math.max(st.w, st.h)));
  const src = frameToCanvas(grid, null, scale);
  const c = el('canvas', { width: src.width, height: src.height });
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(src, 0, 0);
  return c.toDataURL('image/png');
}

const KIND_HINTS = {
  personaje: 'A full-body game character, front view, standing, facing the viewer.',
  criatura: 'A full-body game monster or creature, front view.',
  objeto: 'A single game item or icon, slightly angled for readability.',
  tile: 'A seamless, tileable square texture for a 2D game tile that fills the whole image edge to edge (no background, no border).',
  libre: '',
};

// Hoja común de resultado: imagen de Gemini + vista pixelada + aplicar.
function aiResultSheet(title, form, run) {
  const opts = colorOptions({ colors: '16', outline: true });
  const status = el('div', { className: 'note' });
  const raw = el('img', { className: 'checker', alt: '' });
  const prev = el('canvas', { className: 'checker' });
  const pair = el('div', { className: 'pair', hidden: true }, raw, prev);
  const applyNew = el('button', { textContent: '✅ Poner en una capa nueva', hidden: true, style: 'width:100%;margin-top:6px' });
  const applyRep = el('button', { textContent: '♻️ Reemplazar la capa actual', hidden: true, style: 'width:100%;margin-top:4px' });
  const go = el('button', { textContent: '🪄 Generar con Gemini', className: 'on', style: 'width:100%;margin-top:8px' });
  let canvas = null, grid = null, fill = false;

  const update = () => {
    if (!canvas) return;
    const o = opts.get();
    grid = finishGrid(Tools.fitSubject(canvas, st.w, st.h, { removeBg: o.removeBg && !fill, fill }), o);
    frameToCanvas(grid, prev);
  };
  opts.inputs.forEach(i => { i.onchange = update; });

  go.onclick = async () => {
    if (!aiGuard()) return;
    const req = run();
    if (!req) return;
    go.disabled = true;
    status.className = 'note';
    status.textContent = '⏳ Gemini está dibujando… (puede tardar 10-30 s)';
    try {
      const url = await AI.image(req.prompt, req.image);
      fill = Boolean(req.fill);
      raw.src = url;
      canvas = Tools.toCanvas(await Tools.loadImage(url), 768);
      update();
      pair.hidden = applyNew.hidden = applyRep.hidden = false;
      go.textContent = '🔁 Generar otra vez';
      status.textContent = 'Izquierda: imagen de Gemini. Derecha: convertida a píxeles. Cambia los colores si quieres.';
    } catch (err) {
      status.className = 'error';
      status.textContent = '❌ ' + err.message + (/not found|not supported|permission|quota|billing/i.test(err.message)
        ? '\n\nRevisa el modelo de imagen en «Ajustes de Gemini». La generación de imágenes puede requerir facturación activada en Google AI Studio.' : '');
    }
    go.disabled = false;
  };
  applyNew.onclick = () => { closeSheet(); addLayerWith(grid, title.replace(/^\S+\s/, '')); };
  applyRep.onclick = () => { closeSheet(); replaceCel(grid); };

  openSheet(title, [...form, opts.node, go, status, pair, applyNew, applyRep]);
}

function aiCreateSheet() {
  if (!aiGuard()) return;
  const desc = el('textarea', { rows: 3, placeholder: 'Ej.: caballero con armadura roja y espada de fuego' });
  const kind = el('select', {}, ...['personaje', 'criatura', 'objeto', 'tile', 'libre'].map(k => el('option', { value: k }, k[0].toUpperCase() + k.slice(1))));
  aiResultSheet('🪄 Crear sprite', [
    el('span', { className: 'lbl' }, '¿Qué quieres dibujar? (en español vale)'), desc,
    el('span', { className: 'lbl' }, 'Tipo'), kind,
  ], () => {
    if (!desc.value.trim()) { desc.focus(); return null; }
    const tile = kind.value === 'tile';
    return {
      fill: tile,
      prompt: `Create a pixel art game sprite of: ${desc.value.trim()}. ${KIND_HINTS[kind.value]} ` +
        `Retro ${st.w}x${st.h} pixel art style with crisp hard-edged pixels, limited color palette, clear dark outline and simple cel shading, ` +
        (tile ? 'no text.' : 'single subject centered and fully visible with margin around it. Background: one flat, solid, pure magenta color (#FF00FF) filling the whole background, with no gradient, no ground shadow, no text and no border.'),
    };
  });
}

function aiEditSheet() {
  if (!aiGuard()) return;
  commitFloat();
  const instr = el('textarea', { rows: 3, placeholder: 'Ej.: ponle un sombrero de mago azul' });
  const current = composite(st.cur);
  const thumb = frameToCanvas(current);
  thumb.className = 'checker';
  thumb.style.cssText = 'width:96px;height:96px;image-rendering:pixelated;border-radius:8px';
  aiResultSheet('✏️ Editar sprite', [
    el('div', { className: 'note' }, 'Se envía a Gemini el frame actual (todas las capas visibles):'), thumb,
    el('span', { className: 'lbl' }, '¿Qué quieres cambiar?'), instr,
  ], () => {
    if (!instr.value.trim()) { instr.focus(); return null; }
    return {
      image: gridToAiImage(current),
      prompt: `This is an enlarged pixel art game sprite on a flat magenta (#FF00FF) background. Edit it: ${instr.value.trim()}. ` +
        'Keep the same pixel art style, framing, proportions, outline and color palette as much as possible, and keep the flat solid magenta #FF00FF background. Return only the edited image.',
    };
  });
}

const chatLog = [];
function aiChatSheet() {
  if (!aiGuard()) return;
  const log = el('div', { className: 'chatlog' });
  const input = el('textarea', { rows: 2, placeholder: 'Ej.: ¿cómo mejoro las sombras de este personaje?' });
  const withSprite = el('input', { type: 'checkbox', checked: true });
  const send = el('button', { textContent: 'Enviar', className: 'on', style: 'width:100%;margin-top:6px' });
  const draw = () => {
    log.replaceChildren(...chatLog.map(m => {
      const text = m.parts.filter(p => p.text).map(p => p.text).join('\n');
      const node = el('div', { className: 'msg ' + m.role, textContent: text });
      const hexes = m.role === 'model' ? [...new Set((text.match(/#[0-9a-fA-F]{6}\b/g) || []).map(h => h.toLowerCase()))] : [];
      if (!hexes.length) return node;
      const sw = el('div', { className: 'swatches', style: 'margin-top:6px' }, ...hexes.map(h => { const d = el('div'); d.style.background = h; return d; }));
      const add = el('button', { textContent: '+ Añadir estos colores a la paleta', style: 'margin-top:6px' });
      add.onclick = () => { for (const h of hexes) if (!st.palette.includes(h)) st.palette.push(h); updateColors(); add.textContent = '✅ Añadidos'; };
      node.append(sw, add);
      return node;
    }));
    log.scrollTop = log.scrollHeight;
  };
  send.onclick = async () => {
    const q = input.value.trim();
    if (!q) return;
    commitFloat();
    const parts = [{ text: q }];
    if (withSprite.checked) parts.push(AI.imagePart(gridToAiImage(composite(st.cur), '#808080')));
    chatLog.push({ role: 'user', parts });
    input.value = '';
    send.disabled = true;
    draw();
    try {
      const system = 'Eres un asistente experto en pixel art y diseño de sprites para videojuegos 2D. Responde en español, breve y práctico, ' +
        'con pasos concretos. Si sugieres colores, da códigos hex #rrggbb. ' +
        `El usuario usa PixelForge: lienzo de ${st.w}x${st.h}, ${st.frames.length} frame(s), capas: ${st.layers.map(l => l.name).join(', ')}. ` +
        'Si te envía una imagen, es su sprite ampliado sobre fondo gris (el gris es transparente).';
      // las imágenes de mensajes anteriores no se reenvían, para ahorrar
      const history = chatLog.map((m, i) => (i === chatLog.length - 1 ? m : { role: m.role, parts: m.parts.filter(p => p.text) }));
      chatLog.push({ role: 'model', parts: [{ text: await AI.chat(history, system) }] });
    } catch (err) {
      chatLog.pop();
      input.value = q;
      log.append(el('div', { className: 'error', textContent: '❌ ' + err.message }));
    }
    send.disabled = false;
    draw();
  };
  const clearBtn = el('button', { textContent: 'Borrar conversación', style: 'width:100%;margin-top:4px' });
  clearBtn.onclick = () => { chatLog.length = 0; draw(); };
  openSheet('💬 Asistente de pixel art', [log, input, el('label', { className: 'chk' }, withSprite, 'Enviar mi sprite actual'), send, clearBtn]);
  draw();
}

function aiPaletteSheet() {
  if (!aiGuard()) return;
  const theme = el('input', { type: 'text', placeholder: 'Ej.: bosque otoñal, cueva de cristal, desierto al atardecer' });
  const count = el('select', {}, ...[8, 12, 16, 24, 32].map(n => el('option', { value: n }, `${n} colores`)));
  count.value = '16';
  const out = el('div');
  const go = el('button', { textContent: '🎨 Crear paleta', className: 'on', style: 'width:100%;margin-top:8px' });
  go.onclick = async () => {
    if (!theme.value.trim()) { theme.focus(); return; }
    go.disabled = true;
    out.replaceChildren(el('div', { className: 'note', textContent: '⏳ Pensando colores…' }));
    try {
      const res = await AI.json(
        `Diseña una paleta de pixel art de exactamente ${count.value} colores para el tema: "${theme.value.trim()}". ` +
        'Incluye rampas de sombra a luz con desplazamiento de matiz, un color casi negro para contornos y uno claro para brillos. ' +
        'Ordena los colores por rampas, de oscuro a claro.',
        { type: 'OBJECT', properties: { nombre: { type: 'STRING' }, colores: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['nombre', 'colores'] });
      const cols = (res.colores || []).map(c => c.trim().toLowerCase()).filter(c => /^#[0-9a-f]{6}$/.test(c));
      if (!cols.length) throw new Error('La respuesta no traía colores válidos.');
      const sw = el('div', { className: 'swatches', style: 'margin:8px 0' }, ...cols.map(h => { const d = el('div'); d.style.background = h; return d; }));
      out.replaceChildren(
        el('div', { className: 'note', textContent: `«${res.nombre || theme.value}»` }), sw,
        el('button', { textContent: '♻️ Usar como paleta', style: 'width:100%', onclick: () => { st.palette = cols; st.primary = cols[0]; updateColors(); closeSheet(); } }),
        el('button', { textContent: '+ Añadir a mi paleta', style: 'width:100%;margin-top:4px', onclick: () => { for (const c of cols) if (!st.palette.includes(c)) st.palette.push(c); updateColors(); closeSheet(); } }));
    } catch (err) { out.replaceChildren(el('div', { className: 'error', textContent: '❌ ' + err.message })); }
    go.disabled = false;
  };
  openSheet('🎨 Paleta por tema', [el('span', { className: 'lbl' }, 'Tema'), theme, el('span', { className: 'lbl' }, 'Tamaño'), count, go, out]);
}

// -------------------------------------------------------- interfaz ----

function updateTitle() {
  $('docName').textContent = `${st.name}${st.dirty ? ' •' : ''}  [${st.w}×${st.h}]`;
}

let statusMsg = '', statusUntil = 0;
function setStatus(msg) { statusMsg = msg; statusUntil = Date.now() + 5000; updateStatus(); }

function updateStatus(pos) {
  if (Date.now() < statusUntil) { $('status').textContent = statusMsg; return; }
  const parts = [`Frame ${st.cur + 1}/${st.frames.length}`, `Capa: ${st.layers[st.layer].name}`, TOOL_NAMES[st.tool],
    `${st.w}×${st.h}`, `Zoom ${view.zoom}×`];
  if (st.mirror) parts.push('Espejo');
  if (st.tile) parts.push('Mosaico');
  if (st.penOnly) parts.push('Solo lápiz');
  if (sel) parts.push(`Selección ${sel.w}×${sel.h}`);
  if (pos) parts.unshift(`(${pos[0]}, ${pos[1]})`);
  $('status').textContent = parts.join('  ·  ');
}

function buildTools() {
  const box = $('tools');
  for (const [key, label, sc] of TOOLS)
    box.appendChild(el('button', { textContent: label, title: `Atajo: ${sc.toUpperCase()}`, onclick: () => setTool(key), 'data-tool': key }));
  const br = $('brushes');
  for (const n of [1, 2, 3, 4])
    br.appendChild(el('button', { textContent: n, onclick: () => { st.brush = n; syncButtons(); }, 'data-brush': n }));
}

function setTool(t) {
  if (t !== 'select') { commitFloat(); if (sel) { sel = null; render(); } }
  st.tool = t;
  syncButtons();
  updateStatus();
}

function syncButtons() {
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === st.tool));
  document.querySelectorAll('[data-brush]').forEach(b => b.classList.toggle('on', Number(b.dataset.brush) === st.brush));
  $('refMove').classList.toggle('on', st.tool === 'moveref');
  for (const [id, key] of Object.entries(OPTS)) $(id).checked = st[key];
}

const OPTS = { optPen: 'penOnly', optMirror: 'mirror', optFill: 'fillShapes', optOnion: 'onion', optGrid: 'grid', optTile: 'tile' };
for (const [id, key] of Object.entries(OPTS))
  $(id).onchange = () => {
    st[key] = $(id).checked;
    try { localStorage.setItem('pf_opts', JSON.stringify({ penOnly: st.penOnly, grid: st.grid, onion: st.onion })); } catch (e) { /* sin almacenamiento */ }
    if (key === 'tile') { fitZoom(); render(); }
    else if (key === 'grid') drawOverlay();
    else if (key === 'onion') render();
    updateStatus();
  };

$('undo').onclick = undo;
$('redo').onclick = redo;
$('zoomIn').onclick = () => setZoom(view.zoom + Math.max(1, Math.round(view.zoom / 4)));
$('zoomOut').onclick = () => setZoom(view.zoom - Math.max(1, Math.round(view.zoom / 4)));
$('zoomFit').onclick = fitZoom;

document.addEventListener('keydown', e => {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || $('sheet').classList.contains('open')) return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    const acts = { z: () => (e.shiftKey ? redo() : undo()), y: redo, s: () => saveToLibrary(false), g: regenerate,
      c: copySel, x: () => { if (copySel()) deleteSel(); }, v: pasteClip, a: selectAll };
    if (acts[k]) { e.preventDefault(); acts[k](); }
    return;
  }
  const tool = TOOLS.find(t => t[2] === k);
  if (tool) setTool(tool[0]);
  else if (k === 'm') { st.mirror = !st.mirror; syncButtons(); updateStatus(); }
  else if (k === 'x') swapColors();
  else if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 'escape') deselect();
  else if (k === 'delete' || k === 'backspace') deleteSel();
  else if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (e.shiftKey || float) shiftCel(...d);
    else if (d[1] === 0) selectFrame(st.cur + d[0]);
  } else if (k === '+' || k === '=') setZoom(view.zoom + 1);
  else if (k === '-') setZoom(view.zoom - 1);
});

window.addEventListener('resize', () => fitZoom());

// -------------------------------------------------------------- inicio ----

async function init() {
  buildTools();
  try { Object.assign(st, JSON.parse(localStorage.getItem('pf_opts') || '{}')); } catch (e) { /* opciones por defecto */ }
  syncButtons();
  fpsSel.value = st.fps;
  updateColors();
  rebuildCanvas();
  refreshFrames();
  refreshLayers();
  syncRefPanel();
  updateTitle();
  try {
    const saved = await DB.get(AUTOSAVE);
    if (saved) {
      loadProject(saved, saved.name, saved.docId);
      setStatus('Recuperado tu último trabajo.');
    }
    const savedRef = await DB.get(REFSAVE);
    if (savedRef) await setRef(savedRef.src, savedRef);
  } catch (e) { /* sin IndexedDB (modo privado): se trabaja sin autoguardado */ }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol.startsWith('http'))
    navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
