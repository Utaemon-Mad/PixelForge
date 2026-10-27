// Codificador mínimo de GIF animado (GIF89a, paleta global, transparencia, bucle infinito).
'use strict';

function lzwEncode(pixels, minCode) {
  const clear = 1 << minCode, eoi = clear + 1;
  let codeSize = minCode + 1, next = eoi + 1, dict = new Map();
  const bytes = [];
  let cur = 0, curBits = 0;
  const emit = code => {
    cur |= code << curBits;
    curBits += codeSize;
    while (curBits >= 8) { bytes.push(cur & 255); cur >>>= 8; curBits -= 8; }
  };
  emit(clear);
  let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i], key = prefix * 256 + k;
    const found = dict.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      dict = new Map();
      codeSize = minCode + 1;
      next = eoi + 1;
    } else {
      if (next >= (1 << codeSize)) codeSize++;
      dict.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (curBits > 0) bytes.push(cur & 255);
  return bytes;
}

// frames: listas de filas con "#rrggbb" o null. scale: ampliación entera. delay en ms.
function encodeGIF(frames, w, h, scale, delayMs) {
  const colors = [], index = new Map();
  for (const f of frames) for (const row of f) for (const c of row)
    if (c && !index.has(c) && colors.length < 255) { index.set(c, colors.length + 1); colors.push(c); }
  const rgb = colors.map(c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)));
  const nearest = c => { // por si hubiera más de 255 colores
    const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
    let best = 1, bd = Infinity;
    rgb.forEach(([pr, pg, pb], i) => {
      const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
      if (d < bd) { bd = d; best = i + 1; }
    });
    index.set(c, best);
    return best;
  };

  let bits = 1;
  while ((1 << bits) < colors.length + 1) bits++;
  const W = w * scale, H = h * scale, out = [];
  const u16 = v => out.push(v & 255, (v >> 8) & 255);
  const str = s => { for (const ch of s) out.push(ch.charCodeAt(0)); };

  str('GIF89a');
  u16(W); u16(H);
  out.push(0x80 | (bits - 1), 0, 0);
  for (let i = 0; i < (1 << bits); i++) out.push(...(i === 0 || i > rgb.length ? [0, 0, 0] : rgb[i - 1]));
  out.push(0x21, 0xff, 0x0b); str('NETSCAPE2.0'); out.push(3, 1, 0, 0, 0);

  const minCode = Math.max(2, bits);
  for (const f of frames) {
    out.push(0x21, 0xf9, 4, (2 << 2) | 1); u16(Math.round(delayMs / 10)); out.push(0, 0);
    out.push(0x2c); u16(0); u16(0); u16(W); u16(H); out.push(0);
    const px = new Array(W * H);
    for (let y = 0; y < H; y++) {
      const row = f[Math.floor(y / scale)];
      for (let x = 0; x < W; x++) {
        const c = row[Math.floor(x / scale)];
        px[y * W + x] = c ? (index.get(c) ?? nearest(c)) : 0;
      }
    }
    const data = lzwEncode(px, minCode);
    out.push(minCode);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.slice(i, i + 255);
      out.push(chunk.length, ...chunk);
    }
    out.push(0);
  }
  out.push(0x3b);
  return new Uint8Array(out);
}

if (typeof module !== 'undefined') module.exports = { encodeGIF };
