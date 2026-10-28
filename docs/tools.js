// Utilidades de imagen: pixelar fotos / imágenes de IA, quitar fondo, reducir colores y crear ZIP.
'use strict';

const Tools = (() => {
  const loadImage = src => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('No se pudo leer la imagen'));
    img.src = src;
  });

  // Copia la imagen a un canvas (limitando el lado mayor) para poder leer sus píxeles.
  function toCanvas(img, maxSide = 1024) {
    const s = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round((img.naturalWidth || img.width) * s));
    c.height = Math.max(1, Math.round((img.naturalHeight || img.height) * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  const pixelsOf = c => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

  // Color de fondo = el más repetido en el borde de la imagen (o de la zona indicada).
  function estimateBg(c, data, box = { x: 0, y: 0, w: c.width, h: c.height }) {
    const counts = new Map();
    const add = (x, y) => {
      const i = (Math.floor(y) * c.width + Math.floor(x)) * 4;
      if (data[i + 3] < 128) return;
      const k = (data[i] >> 4) << 8 | (data[i + 1] >> 4) << 4 | (data[i + 2] >> 4);
      const e = counts.get(k) || { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2];
      counts.set(k, e);
    };
    const x1 = box.x + box.w - 1, y1 = box.y + box.h - 1;
    for (let t = 0; t <= 1; t += 0.01) {
      add(box.x + t * (box.w - 1), box.y); add(box.x + t * (box.w - 1), y1);
      add(box.x, box.y + t * (box.h - 1)); add(x1, box.y + t * (box.h - 1));
    }
    let best = null;
    for (const e of counts.values()) if (!best || e.n > best.n) best = e;
    return best ? [best.r / best.n, best.g / best.n, best.b / best.n] : null;
  }

  // Convierte una zona de la imagen en una cuadrícula outW x outH.
  // mapFn(cx, cy) -> [sx0, sy0, sx1, sy1] en píxeles de la imagen, o null si cae fuera.
  function sampleGrid(c, data, outW, outH, mapFn, bg, bgTol = 70) {
    const isBg = (r, g, b, a) => a < 128 || (bg && d2([r, g, b], bg) < bgTol * bgTol);
    const grid = [];
    for (let cy = 0; cy < outH; cy++) {
      const row = [];
      for (let cx = 0; cx < outW; cx++) {
        const box = mapFn(cx, cy);
        if (!box) { row.push(null); continue; }
        let [x0, y0, x1, y1] = box;
        x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(c.width, x1); y1 = Math.min(c.height, y1);
        if (x1 - x0 <= 0 || y1 - y0 <= 0) { row.push(null); continue; }
        const steps = 6, buckets = new Map();
        let solid = 0, total = 0;
        for (let j = 0; j < steps; j++)
          for (let i = 0; i < steps; i++) {
            const sx = Math.min(c.width - 1, Math.floor(x0 + (i + 0.5) * (x1 - x0) / steps));
            const sy = Math.min(c.height - 1, Math.floor(y0 + (j + 0.5) * (y1 - y0) / steps));
            const p = (sy * c.width + sx) * 4, r = data[p], g = data[p + 1], b = data[p + 2];
            total++;
            if (isBg(r, g, b, data[p + 3])) continue;
            solid++;
            const k = (r >> 5) << 6 | (g >> 5) << 3 | (b >> 5);
            const e = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
            e.n++; e.r += r; e.g += g; e.b += b;
            buckets.set(k, e);
          }
        if (solid / total < 0.5) { row.push(null); continue; }
        let best = null; // el color dominante mantiene los bordes nítidos (mejor que la media)
        for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
        row.push([best.r / best.n, best.g / best.n, best.b / best.n]);
      }
      grid.push(row);
    }
    return grid;
  }

  // Recorta el sujeto (todo lo que no es fondo) y lo encaja en outW x outH.
  function fitSubject(c, outW, outH, { removeBg = true, fill = false } = {}) {
    const data = pixelsOf(c);
    const bg = removeBg ? estimateBg(c, data) : null;
    if (fill || !bg) {
      const sx = c.width / outW, sy = c.height / outH;
      return sampleGrid(c, data, outW, outH, (x, y) => [x * sx, y * sy, (x + 1) * sx, (y + 1) * sy], bg);
    }
    let bx0 = c.width, by0 = c.height, bx1 = -1, by1 = -1;
    for (let y = 0; y < c.height; y += 2)
      for (let x = 0; x < c.width; x += 2) {
        const i = (y * c.width + x) * 4;
        if (data[i + 3] >= 128 && d2([data[i], data[i + 1], data[i + 2]], bg) >= 70 * 70) {
          bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x + 2); by1 = Math.max(by1, y + 2);
        }
      }
    if (bx1 < 0) return Array.from({ length: outH }, () => Array(outW).fill(null));
    const bw = bx1 - bx0, bh = by1 - by0, margin = 1;
    const s = Math.min((outW - 2 * margin) / bw, (outH - 2 * margin) / bh);
    const tw = Math.max(1, Math.round(bw * s)), th = Math.max(1, Math.round(bh * s));
    const ox = Math.floor((outW - tw) / 2), oy = Math.floor((outH - th) / 2);
    return sampleGrid(c, data, outW, outH, (x, y) => {
      if (x < ox || y < oy || x >= ox + tw || y >= oy + th) return null;
      return [bx0 + (x - ox) * bw / tw, by0 + (y - oy) * bh / th, bx0 + (x - ox + 1) * bw / tw, by0 + (y - oy + 1) * bh / th];
    }, bg);
  }

  // Reducción de colores por "median cut".
  function medianCut(colors, n) {
    if (!colors.length) return [];
    let boxes = [colors];
    while (boxes.length < n) {
      let bi = -1, bestRange = 0, ch = 0;
      boxes.forEach((b, i) => {
        if (b.length < 2) return;
        for (let k = 0; k < 3; k++) {
          let lo = 255, hi = 0;
          for (const c of b) { lo = Math.min(lo, c[k]); hi = Math.max(hi, c[k]); }
          if (hi - lo > bestRange) { bestRange = hi - lo; bi = i; ch = k; }
        }
      });
      if (bi < 0) break;
      const b = boxes[bi].slice().sort((p, q) => p[ch] - q[ch]), mid = b.length >> 1;
      boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
    }
    return boxes.map(b => [0, 1, 2].map(k => b.reduce((s, c) => s + c[k], 0) / b.length));
  }

  const hex = c => Gen.rgbToHex(c[0], c[1], c[2]);
  const nearest = (c, pal) => {
    let best = pal[0], bd = Infinity;
    for (const p of pal) {
      const d = 2 * (c[0] - p[0]) ** 2 + 4 * (c[1] - p[1]) ** 2 + 3 * (c[2] - p[2]) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };

  // colors: número de colores automáticos, o una lista de "#rrggbb" (paleta actual).
  function quantize(grid, colors) {
    const all = [];
    for (const row of grid) for (const c of row) if (c) all.push(c);
    const pal = Array.isArray(colors) ? colors.map(Gen.hexToRgb) : medianCut(all, colors);
    if (!pal.length) return grid.map(r => r.map(() => null));
    return grid.map(row => row.map(c => (c ? hex(nearest(c, pal)) : null)));
  }

  // Añade un contorno oscuro de 1 px alrededor de lo dibujado.
  function outline(grid) {
    const h = grid.length, w = grid[0].length, out = grid.map(r => r.slice());
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (grid[y][x]) continue;
        for (const [nx, ny] of [[x, y + 1], [x, y - 1], [x + 1, y], [x - 1, y]])
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && grid[ny][nx]) { out[y][x] = Gen.blend(grid[ny][nx], '#000000', 0.7); break; }
      }
    return out;
  }

  // ---------------------------------------------------------------- ZIP ----
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = d => { let c = 0xffffffff; for (const b of d) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

  // files: [{name, data: Uint8Array | string}] -> Blob ZIP (sin compresión)
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    const u16 = v => [v & 255, (v >> 8) & 255], u32 = v => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
    for (const f of files) {
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const name = enc.encode(f.name), crc = crc32(data);
      const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
      const local = new Uint8Array([...u32(0x04034b50), ...common, ...name]);
      parts.push(local, data);
      central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]));
      offset += local.length + data.length;
    }
    const size = central.reduce((s, c) => s + c.length, 0);
    const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(size), ...u32(offset), ...u16(0)]);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }

  return { loadImage, toCanvas, pixelsOf, estimateBg, sampleGrid, fitSubject, quantize, outline, zip };
})();
