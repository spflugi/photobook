// Generates src-tauri/icons/icon-source.png — a 1024×1024 RGBA icon
// for the PhotoBook app. Uses only Node.js built-ins (zlib, fs).
// Run: node gen-icon.mjs
// Then: npm run tauri icon src-tauri/icons/icon-source.png

import { deflateSync } from 'zlib';
import { writeFileSync } from 'fs';

const SIZE = 1024;
const pix = new Uint8Array(SIZE * SIZE * 4); // RGBA, all transparent

// ── Pixel helpers ─────────────────────────────────────────────────────────────

function set(x, y, r, g, b, a = 255) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  const sa = a / 255;
  const da = pix[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return;
  pix[i]     = Math.round((r * sa + pix[i]     * da * (1 - sa)) / oa);
  pix[i + 1] = Math.round((g * sa + pix[i + 1] * da * (1 - sa)) / oa);
  pix[i + 2] = Math.round((b * sa + pix[i + 2] * da * (1 - sa)) / oa);
  pix[i + 3] = Math.round(oa * 255);
}

/** Filled rounded rectangle with per-pixel corner anti-aliasing. */
function roundRect(x, y, w, h, rad, r, g, b, a = 255) {
  const x1 = x + rad, y1 = y + rad;
  const x2 = x + w - rad, y2 = y + h - rad;
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      let inside = true;
      if      (px < x1 && py < y1) { const dx = px - x1, dy = py - y1; inside = dx*dx + dy*dy <= rad*rad; }
      else if (px >= x2 && py < y1) { const dx = px - x2, dy = py - y1; inside = dx*dx + dy*dy <= rad*rad; }
      else if (px < x1 && py >= y2) { const dx = px - x1, dy = py - y2; inside = dx*dx + dy*dy <= rad*rad; }
      else if (px >= x2 && py >= y2) { const dx = px - x2, dy = py - y2; inside = dx*dx + dy*dy <= rad*rad; }
      if (inside) set(px, py, r, g, b, a);
    }
  }
}

/** Filled circle. */
function circle(cx, cy, rad, r, g, b, a = 255) {
  const r2 = rad * rad;
  for (let py = cy - rad; py <= cy + rad; py++)
    for (let px = cx - rad; px <= cx + rad; px++)
      if ((px - cx) ** 2 + (py - cy) ** 2 <= r2) set(px, py, r, g, b, a);
}

/** Thick line using square brush of given half-width. */
function line(x0, y0, x1, y1, thick, r, g, b, a = 255) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = Math.round(x0 + (x1 - x0) * t);
    const py = Math.round(y0 + (y1 - y0) * t);
    for (let dy = -thick; dy <= thick; dy++)
      for (let dx = -thick; dx <= thick; dx++)
        set(px + dx, py + dy, r, g, b, a);
  }
}

// ── Design ────────────────────────────────────────────────────────────────────

// Background: zinc-900 (#18181b) rounded square
roundRect(48, 48, SIZE - 96, SIZE - 96, 200, 24, 24, 27);

// 2×2 photo thumbnail grid, centred
const CELL = 218, GAP = 40, CRAD = 22;
const GW = 2 * CELL + GAP;
const GX = Math.round((SIZE - GW) / 2);
const GY = Math.round((SIZE - GW) / 2);

const positions = [
  [GX,          GY],
  [GX + CELL + GAP, GY],
  [GX,          GY + CELL + GAP],
  [GX + CELL + GAP, GY + CELL + GAP],
];

// Draw the three unselected thumbnails
for (let i = 0; i < 3; i++) {
  const [cx, cy] = positions[i];
  // card background: zinc-700 (#3f3f46 → 63 63 70)
  roundRect(cx, cy, CELL, CELL, CRAD, 52, 52, 60);
  // sky area (upper 55%)
  const skyH = Math.round((CELL - 20) * 0.55);
  roundRect(cx + 10, cy + 10, CELL - 20, skyH, CRAD - 6, 72, 72, 84);
  // mountain silhouette: isoceles triangle
  const mx = cx + CELL / 2, mtop = cy + 10, mbot = cy + 10 + skyH, mhw = (CELL - 20) / 2;
  for (let py = mtop; py <= mbot; py++) {
    const t = (py - mtop) / (mbot - mtop);
    const hw = t * mhw;
    for (let px = Math.ceil(mx - hw); px <= Math.floor(mx + hw); px++)
      set(px, py, 52, 52, 65);
  }
  // Ground strip (lower 45%)
  roundRect(cx + 10, cy + 10 + skyH, CELL - 20, CELL - 20 - skyH, CRAD - 6, 58, 60, 68);
}

// Draw the selected thumbnail (bottom-right)
const [sx, sy] = positions[3];
const BORD = 9;
// White selection border
roundRect(sx - BORD, sy - BORD, CELL + 2 * BORD, CELL + 2 * BORD, CRAD + BORD, 240, 240, 240);
// Card: slightly brighter than siblings
roundRect(sx, sy, CELL, CELL, CRAD, 68, 68, 78);
const skyH2 = Math.round((CELL - 20) * 0.55);
roundRect(sx + 10, sy + 10, CELL - 20, skyH2, CRAD - 6, 92, 92, 110);
// Mountain
const mx2 = sx + CELL / 2, mt2 = sy + 10, mb2 = sy + 10 + skyH2, mhw2 = (CELL - 20) / 2;
for (let py = mt2; py <= mb2; py++) {
  const t = (py - mt2) / (mb2 - mt2);
  const hw = t * mhw2;
  for (let px = Math.ceil(mx2 - hw); px <= Math.floor(mx2 + hw); px++)
    set(px, py, 68, 68, 86);
}
// Ground strip
roundRect(sx + 10, sy + 10 + skyH2, CELL - 20, CELL - 20 - skyH2, CRAD - 6, 76, 78, 88);

// Check badge (top-right of selected cell)
const BX = sx + CELL - 2, BY = sy + 2;
const BR = 40; // badge radius
circle(BX, BY, BR, 92, 190, 92);        // green circle
circle(BX, BY, BR - 6, 68, 160, 68);   // darker ring inside (optional, skip if cluttered)
circle(BX, BY, BR, 92, 190, 92);        // re-fill green

// Thick white checkmark inside badge
const CX = BX, CY = BY;
const S = BR * 0.46;
// knee point: CX-0.44*S, CY+0.18*S → CX-0.05*S, CY+0.48*S → CX+0.52*S, CY-0.3*S
line(
  Math.round(CX - 0.44 * S), Math.round(CY + 0.18 * S),
  Math.round(CX - 0.05 * S), Math.round(CY + 0.50 * S),
  5, 255, 255, 255
);
line(
  Math.round(CX - 0.05 * S), Math.round(CY + 0.50 * S),
  Math.round(CX + 0.52 * S), Math.round(CY - 0.32 * S),
  5, 255, 255, 255
);

// ── PNG encoder ───────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(data) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const tb = Buffer.from(type, 'ascii');
  const lb = Buffer.allocUnsafe(4); lb.writeUInt32BE(data.length);
  const cb = Buffer.allocUnsafe(4); cb.writeUInt32BE(crc32(Buffer.concat([tb, data])));
  return Buffer.concat([lb, tb, data, cb]);
}

const ihdr = Buffer.allocUnsafe(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const rows = [];
for (let y = 0; y < SIZE; y++) {
  rows.push(Buffer.from([0]));
  rows.push(Buffer.from(pix.buffer, y * SIZE * 4, SIZE * 4));
}
const compressed = deflateSync(Buffer.concat(rows), { level: 6 });

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', compressed),
  chunk('IEND', Buffer.alloc(0)),
]);

writeFileSync('src-tauri/icons/icon-source.png', png);
console.log('Written src-tauri/icons/icon-source.png');
