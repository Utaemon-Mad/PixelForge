// Generadores procedurales de pixel art (versión web de escritorio/generadores.py).
// Cada generador devuelve una cuadrícula 32x32 de "#rrggbb" o null (transparente).
'use strict';

const Gen = (() => {
  const S = 32;

  // ------------------------------------------------------------ azar ----
  class Rand {
    constructor(seed) { this.a = seed >>> 0; }
    random() { // mulberry32
      let t = (this.a = (this.a + 0x6D2B79F5) | 0);
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    choice(arr) { return arr[Math.floor(this.random() * arr.length)]; }
    uniform(a, b) { return a + (b - a) * this.random(); }
    randint(a, b) { return a + Math.floor(this.random() * (b - a + 1)); }
  }

  // ----------------------------------------------------------- color ----
  const hexToRgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  const rgbToHex = (r, g, b) => '#' + [r, g, b]
    .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

  function blend(a, b, t) {
    const [ra, ga, ba] = hexToRgb(a), [rb, gb, bb] = hexToRgb(b);
    return rgbToHex(ra + (rb - ra) * t, ga + (gb - ga) * t, ba + (bb - ba) * t);
  }

  function rgbToHls(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, l, 0];
    const d = mx - mn;
    const s = l <= 0.5 ? d / (mx + mn) : d / (2 - mx - mn);
    let h = mx === r ? (g - b) / d : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
    return [h, l, s];
  }

  function hlsToRgb(h, l, s) {
    if (s === 0) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = t => {
      t = ((t % 1) + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
  }

  const hsl = (h, s, l) => rgbToHex(...hlsToRgb(((h % 1) + 1) % 1, l, s).map(v => v * 255));
  const hueToward = (h, target, amt) => {
    const d = ((((target - h + 0.5) % 1) + 1) % 1) - 0.5;
    return (((h + d * amt) % 1) + 1) % 1;
  };

  // Rampa oscuro -> claro con desplazamiento de matiz (sombras violetas, luces amarillas).
  function makeRamp(base, n = 5) {
    const [h, l, s] = rgbToHls(...hexToRgb(base).map(v => v / 255));
    const mid = (n - 1) / 2, out = [];
    for (let i = 0; i < n; i++) {
      const k = mid ? (i - mid) / mid : 0;
      const nl = Math.min(0.95, Math.max(0.05, l + k * 0.28));
      let nh, ns;
      if (k < 0) { nh = hueToward(h, 0.72, -k * 0.12); ns = Math.min(1, s * (1 - k * 0.15)); }
      else { nh = hueToward(h, 0.14, k * 0.10); ns = s * (1 - k * 0.2); }
      out.push(hsl(nh, ns, nl));
    }
    return out;
  }

  // ---------------------------------------------------------- boceto ----
  class Sketch {
    constructor() { this.m = Array.from({ length: S }, () => Array(S).fill(null)); }
    get(x, y) { return x >= 0 && x < S && y >= 0 && y < S ? this.m[y][x] : null; }
    set(x, y, mat) {
      x = Math.trunc(x); y = Math.trunc(y);
      if (x >= 0 && x < S && y >= 0 && y < S) this.m[y][x] = mat;
    }
    rect(x0, y0, x1, y1, mat, sym = false) {
      for (let y = Math.trunc(Math.min(y0, y1)); y <= Math.trunc(Math.max(y0, y1)); y++)
        for (let x = Math.trunc(Math.min(x0, x1)); x <= Math.trunc(Math.max(x0, x1)); x++) {
          this.set(x, y, mat);
          if (sym) this.set(S - 1 - x, y, mat);
        }
    }
    ellipse(cx, cy, rx, ry, mat, cond = null) {
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++)
          if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 && (!cond || cond(x, y))) this.m[y][x] = mat;
    }
    render(ramps) {
      const boxes = {};
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const m = this.m[y][x];
          if (m === null) continue;
          const b = boxes[m] || [y, y];
          boxes[m] = [Math.min(b[0], y), Math.max(b[1], y)];
        }
      const out = Array.from({ length: S }, () => Array(S).fill(null));
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const m = this.m[y][x];
          if (m === null) continue;
          const ramp = ramps[m];
          if (typeof ramp === 'string') { out[y][x] = ramp; continue; }
          const up = this.get(x, y - 1) !== m, left = this.get(x - 1, y) !== m;
          const down = this.get(x, y + 1) !== m, right = this.get(x + 1, y) !== m;
          let idx = 2 + Number(up || left) + Number(up && left) - Number(down || right) - Number(down && right);
          const [y0, y1] = boxes[m];
          if (idx === 2 && y1 - y0 >= 4 && (y - y0) / (y1 - y0 + 1) > 0.7) idx = 1;
          out[y][x] = ramp[Math.max(0, Math.min(ramp.length - 1, idx))];
        }
      // contorno selectivo con el tono más oscuro del material vecino
      const res = out.map(r => r.slice());
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          if (this.m[y][x] !== null) continue;
          for (const [nx, ny] of [[x, y + 1], [x, y - 1], [x + 1, y], [x - 1, y]]) {
            const nm = this.get(nx, ny);
            if (nm !== null) {
              const ramp = ramps[nm];
              res[y][x] = blend(typeof ramp === 'string' ? ramp : ramp[0], '#000000', 0.45);
              break;
            }
          }
        }
      return res;
    }
  }

  // ------------------------------------------------------ personajes ----
  const SKINS = ['#f2c7a5', '#e0a77f', '#c68653', '#8d5524', '#ffdbac', '#8fc27a', '#9fb4e0'];
  const HAIRS = ['#3b2a1e', '#e8c063', '#a33a2a', '#2b2b3a', '#d8d8e0', '#5a7bd8', '#e070a0', '#6a4a2a'];
  const BOOTS = ['#5a3a22', '#3b2f2f', '#4a4a5a', '#2f3b2a'];

  function personaje(seed, pose = 0) {
    const r = new Rand(seed);
    const skin = r.choice(SKINS), hair = r.choice(HAIRS);
    const cloth = hsl(r.random(), r.uniform(0.45, 0.75), r.uniform(0.38, 0.55));
    const pants = hsl(r.random(), r.uniform(0.2, 0.5), r.uniform(0.25, 0.4));
    const boots = r.choice(BOOTS);
    const hatCol = hsl(r.random(), r.uniform(0.4, 0.7), r.uniform(0.3, 0.5));
    const rx = r.choice([5, 5, 6]), ry = r.choice([5, 6]), tw = r.choice([4, 5, 5, 6]);
    const th = r.choice([7, 8, 8]), aw = r.choice([2, 2, 3]), ex = r.choice([2, 3]);
    const hat = r.random() < 0.35, sword = r.random() < 0.35;
    const longHair = r.random() < 0.4, belt = r.random() < 0.6;

    const oy = pose === 1 || pose === 3 ? -1 : 0;
    const swing = [0, 1, 0, -1][pose];
    const sk = new Sketch();
    const cy = 3 + ry + oy, tt = cy + ry, hip = tt + th;

    const lw = Math.max(3, tw - 1);
    for (const [side, lifted] of [[0, pose === 1], [1, pose === 3]]) {
      const [x0, x1] = side === 0 ? [15 - lw, 14] : [17, 16 + lw];
      const bottom = 29 - (lifted ? 1 : 0);
      sk.rect(x0, hip, x1, bottom - 3, 'pants');
      sk.rect(x0, bottom - 2, x1, bottom, 'boots');
    }
    sk.rect(16 - tw, tt, 15 + tw, hip - 1, 'cloth');
    if (belt) sk.rect(16 - tw, hip - 2, 15 + tw, hip - 2, 'belt');
    for (const [side, dy] of [[0, swing], [1, -swing]]) {
      const [x0, x1] = side === 0 ? [16 - tw - aw, 15 - tw] : [16 + tw, 15 + tw + aw];
      sk.rect(x0, tt + 1 + dy, x1, hip - 3 + dy, 'arm');
      sk.rect(x0, hip - 2 + dy, x1, hip - 1 + dy, 'skin');
    }
    if (longHair) sk.rect(16 - rx - 1, cy, 16 - rx, cy + ry + 3, 'hair', true);
    sk.ellipse(15.5, cy, rx + 0.5, ry + 0.5, 'skin');
    sk.ellipse(15.5, cy - 1, rx + 1.2, ry + 0.8, 'hair', (x, y) => y <= cy - ry * 0.25);
    for (const x of [15 - ex, 16 + ex]) {
      sk.set(x, cy + 1, 'eye');
      if (rx >= 6) sk.set(x, cy, 'eye');
    }
    if (hat) {
      const yb = Math.trunc(cy - ry * 0.35);
      sk.rect(16 - rx - 2, yb, 15 + rx + 2, yb, 'hat');
      sk.rect(16 - rx + 1, yb - 4, 15 + rx - 1, yb - 1, 'hat');
    }
    if (sword) {
      const hx = 16 + tw + Math.floor(aw / 2), hy = hip - 2 - swing;
      sk.rect(hx, Math.max(1, hy - 10), hx, hy - 2, 'blade');
      sk.rect(hx - 1, hy - 1, hx + 1, hy - 1, 'guard');
    }
    return sk.render({
      skin: makeRamp(skin), hair: makeRamp(hair), cloth: makeRamp(cloth), arm: makeRamp(cloth),
      pants: makeRamp(pants), boots: makeRamp(boots), belt: makeRamp('#4a2f1c'), hat: makeRamp(hatCol),
      blade: makeRamp('#b8c4d0'), guard: makeRamp('#d8a838'), eye: '#1b1b2a',
    });
  }

  const personajeCaminando = seed => [0, 1, 2, 3].map(p => personaje(seed, p));

  // ------------------------------------------------------- criaturas ----
  function criatura(seed) {
    const r = new Rand(seed);
    let alive = Array.from({ length: S }, () => Array(S).fill(false));
    for (let y = 3; y < 29; y++)
      for (let x = 3; x < 16; x++) {
        const dx = (15.5 - x) / 12.5, dy = (y - 16) / 13;
        if (r.random() < 0.78 - (dx * dx + dy * dy) * 0.65) alive[y][x] = alive[y][S - 1 - x] = true;
      }
    for (let it = 0; it < 2; it++) {
      const nxt = Array.from({ length: S }, () => Array(S).fill(false));
      for (let y = 1; y < S - 1; y++)
        for (let x = 1; x < S - 1; x++) {
          let n = 0;
          for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if ((i || j) && alive[y + j][x + i]) n++;
          nxt[y][x] = n >= 5 || (alive[y][x] && n >= 4);
        }
      alive = nxt;
    }
    const seen = new Set();
    let best = [];
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        if (!alive[y][x] || seen.has(y * S + x)) continue;
        const comp = [], stack = [[x, y]];
        seen.add(y * S + x);
        while (stack.length) {
          const [cx, cy] = stack.pop();
          comp.push([cx, cy]);
          for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]])
            if (nx >= 0 && nx < S && ny >= 0 && ny < S && alive[ny][nx] && !seen.has(ny * S + nx)) {
              seen.add(ny * S + nx);
              stack.push([nx, ny]);
            }
        }
        if (comp.length > best.length) best = comp;
      }
    if (best.length < 40) return criatura(seed + 7919);

    const sk = new Sketch();
    for (const [x, y] of best) sk.set(x, y, 'body');
    const ys = best.map(p => p[1]);
    const top = Math.min(...ys), bottom = Math.max(...ys), mid = (top + bottom) / 2;
    if (r.random() < 0.6)
      for (const [x, y] of best)
        if (Math.abs(x - 15.5) < 3 && y > mid && [[1, 0], [-1, 0], [0, 1]].every(([i, j]) => sk.get(x + i, y + j)))
          sk.set(x, y, 'belly');
    if (r.random() < 0.5) {
      const n = r.randint(2, 4);
      for (let k = 0; k < n; k++) {
        const [x, y] = r.choice(best);
        if (x < 13 && sk.get(x, y) === 'body') { sk.set(x, y, 'spot'); sk.set(S - 1 - x, y, 'spot'); }
      }
    }
    const cand = [];
    for (let y = top + 2; y <= Math.trunc(mid); y++)
      for (let ex = 2; ex < 7; ex++) {
        const x = 15 - ex;
        let ok = true;
        for (const i of [-1, 0, 1, 2]) for (const j of [-1, 0, 1, 2]) if (sk.get(x + i, y + j) !== 'body') ok = false;
        if (ok) cand.push([x, y]);
      }
    if (cand.length) {
      const [x, y] = r.choice(cand);
      sk.rect(x, y, x + 1, y + 1, 'eyew', true);
      sk.set(x + 1, y + 1, 'eye');
      sk.set(S - 2 - x, y + 1, 'eye');
    }
    const h = r.random();
    const body = hsl(h, r.uniform(0.45, 0.7), r.uniform(0.42, 0.55));
    return sk.render({
      body: makeRamp(body), belly: makeRamp(hsl(h + 0.08, 0.5, 0.72)),
      spot: makeRamp(hsl(h + 0.5, 0.55, 0.5)), eyew: '#f4f4f8', eye: '#141420',
    });
  }

  // --------------------------------------------------------- objetos ----
  function pocion(seed) {
    const r = new Rand(seed), sk = new Sketch();
    const rad = r.choice([7, 8, 8, 9]), cy = 29 - rad, bodyTop = cy - rad;
    const square = r.random() < 0.3, neckTop = bodyTop - 4;
    sk.rect(14, neckTop, 17, bodyTop + 1, 'glass');
    sk.rect(13, neckTop, 18, neckTop, 'glass');
    sk.rect(14, neckTop - 3, 17, neckTop - 1, 'cork');
    const level = cy - rad * r.uniform(-0.1, 0.4);
    if (square) {
      sk.rect(16 - rad, bodyTop + 1, 15 + rad, 28, 'glass');
      sk.rect(17 - rad, Math.trunc(level), 14 + rad, 27, 'liquid');
    } else {
      sk.ellipse(15.5, cy, rad + 0.5, rad + 0.5, 'glass');
      sk.ellipse(15.5, cy, rad - 0.5, rad - 0.5, 'liquid', (x, y) => y >= level);
    }
    const sx = Math.trunc(15.5 - rad * 0.5), sy = Math.trunc(cy - rad * 0.3);
    sk.set(sx, sy, 'shine');
    sk.set(sx, sy + 1, 'shine');
    return sk.render({
      glass: makeRamp('#9cc4d8'), cork: makeRamp('#9a6a3e'),
      liquid: makeRamp(hsl(r.random(), 0.75, 0.5)), shine: '#ffffff',
    });
  }

  function espada(seed) {
    const r = new Rand(seed), sk = new Sketch();
    const length = r.randint(13, 18);
    for (let i = 0; i < length; i++) {
      sk.set(9 + i, 22 - i, 'blade');
      if (i < length - 1) sk.set(10 + i, 22 - i, 'edge');
    }
    for (let i = -3; i <= 3; i++) { sk.set(8 + i, 23 + i, 'guard'); sk.set(9 + i, 23 + i, 'guard'); }
    for (let i = 1; i <= 3; i++) sk.set(8 - i, 23 + i, 'grip');
    sk.rect(3, 27, 4, 28, 'guard');
    if (r.random() < 0.5) sk.set(8, 23, 'gem');
    const metal = r.choice(['#b8c4d0', '#c8b89a', '#8fd0e0', '#d0a0a0']);
    const guard = r.choice(['#d8a838', '#a0a8b8', '#b04030', '#4a8a4a']);
    return sk.render({
      blade: makeRamp(metal), edge: makeRamp(blend(metal, '#ffffff', 0.35)), guard: makeRamp(guard),
      grip: makeRamp(r.choice(['#5a3a22', '#3a2a4a', '#2a3a5a'])), gem: hsl(r.random(), 0.8, 0.55),
    });
  }

  function gema(seed) {
    const r = new Rand(seed), sk = new Sketch();
    const a = r.randint(9, 12), crown = r.randint(4, 6), pav = r.randint(10, 13), cy = 4 + crown;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const dx = Math.abs(x - 15.5);
        if (y >= cy - crown && y < cy) {
          if (dx <= a - (cy - y) * 0.8) sk.set(x, y, dx <= a * 0.35 && y < cy - crown / 2 ? 'table' : 'crown');
        } else if (y >= cy && y <= cy + pav) {
          if (dx <= a * (1 - (y - cy) / pav)) sk.set(x, y, x < 16 ? 'pav' : 'pav2');
        }
      }
    sk.set(Math.trunc(15.5 - a * 0.5), cy - 2, 'shine');
    const base = hsl(r.random(), 0.75, 0.5);
    return sk.render({
      crown: makeRamp(blend(base, '#ffffff', 0.2)), table: makeRamp(blend(base, '#ffffff', 0.4)),
      pav: makeRamp(base), pav2: makeRamp(blend(base, '#000000', 0.2)), shine: '#ffffff',
    });
  }

  function escudo(seed) {
    const r = new Rand(seed), sk = new Sketch();
    const hw = r.choice([10, 11]), top = 4, taper = r.randint(15, 19), bottom = 28;
    const inside = (x, y) => {
      if (y < top || y > bottom) return false;
      const w = y <= taper ? hw : hw * (1 - ((y - taper) / (bottom - taper + 1)) ** 1.4);
      return Math.abs(x - 15.5) <= w;
    };
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++)
        if (inside(x, y)) {
          const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([i, j]) => !inside(x + i, y + j));
          sk.set(x, y, edge ? 'rim' : 'face');
        }
    const kind = r.choice(['cruz', 'circulo', 'franja']);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        if (sk.get(x, y) !== 'face') continue;
        if ((kind === 'cruz' && ((x >= 14 && x <= 17 && y >= 8 && y <= 24) || (x >= 9 && x <= 22 && y >= 12 && y <= 15))) ||
            (kind === 'circulo' && (x - 15.5) ** 2 + (y - 14) ** 2 <= 20) ||
            (kind === 'franja' && Math.abs((x - 4) - (y - 4)) <= 2))
          sk.set(x, y, 'emblem');
      }
    return sk.render({
      rim: makeRamp(r.choice(['#a0a8b8', '#d8a838'])), face: makeRamp(hsl(r.random(), 0.6, 0.42)),
      emblem: makeRamp(r.choice(['#f0e0b0', '#e8e8f0', '#d8a838', '#202030'])),
    });
  }

  const OBJETOS = { 'Poción': pocion, 'Espada': espada, 'Gema': gema, 'Escudo': escudo };
  const objetoAleatorio = seed => new Rand(seed).choice(Object.values(OBJETOS))(seed);

  // ------------------------------------------------------ utilidades ----
  function fit(grid, w, h) {
    let src = grid.length;
    if (w < src || h < src) {
      const size = Math.min(w, h);
      grid = Array.from({ length: size }, (_, y) =>
        Array.from({ length: size }, (_, x) => grid[Math.floor(y * src / size)][Math.floor(x * src / size)]));
      src = size;
    }
    const out = Array.from({ length: h }, () => Array(w).fill(null));
    const ox = Math.floor((w - src) / 2), oy = Math.floor((h - src) / 2);
    for (let y = 0; y < src; y++) for (let x = 0; x < src; x++) out[y + oy][x + ox] = grid[y][x];
    return out;
  }

  function shifted(f, dx, dy, wrap = false) {
    const h = f.length, w = f[0].length;
    const out = Array.from({ length: h }, () => Array(w).fill(null));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = f[y][x];
        if (c === null) continue;
        let nx = x + dx, ny = y + dy;
        if (wrap) { nx = ((nx % w) + w) % w; ny = ((ny % h) + h) % h; }
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) out[ny][nx] = c;
      }
    return out;
  }

  const copy = f => f.map(r => r.slice());

  function bboxRows(f) {
    const rows = [];
    f.forEach((row, y) => { if (row.some(c => c !== null)) rows.push(y); });
    return rows.length ? [rows[0], rows[rows.length - 1]] : [0, 0];
  }

  const animFlotar = f => Array.from({ length: 8 }, (_, i) => shifted(f, 0, Math.round(Math.sin(i / 8 * 2 * Math.PI) * -1.4)));

  function animRespirar(f) {
    const [top, bottom] = bboxRows(f), mid = Math.floor((top + bottom) / 2);
    const squash = copy(f);
    for (let y = mid; y > top; y--) squash[y] = f[y - 1].slice();
    squash[top] = Array(f[0].length).fill(null);
    return [copy(f), copy(f), squash, copy(squash)];
  }

  function animDestello(f) {
    const flash = f.map(row => row.map(c => (c ? blend(c, '#ffffff', 0.65) : null)));
    return [copy(f), flash, copy(f), copy(f)];
  }

  const animSacudida = f => [0, 1, -1, 1, -1, 0].map(dx => shifted(f, dx, 0));

  const ANIMACIONES = {
    'Flotar (8 frames)': animFlotar,
    'Respirar / idle (4 frames)': animRespirar,
    'Destello / golpe (4 frames)': animDestello,
    'Sacudida (6 frames)': animSacudida,
  };

  return {
    personaje, personajeCaminando, criatura, OBJETOS, objetoAleatorio, ANIMACIONES,
    fit, shifted, makeRamp, blend, hexToRgb,
  };
})();
