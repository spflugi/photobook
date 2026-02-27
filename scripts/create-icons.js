#!/usr/bin/env node
// Generates a minimal monochromatic icon PNG for development.
// Run: node scripts/create-icons.js
// Then: npx tauri icon src-tauri/icons/source.png  (generates all required sizes)

import { createWriteStream } from "fs";
import { deflateSync } from "zlib";
import { mkdirSync } from "fs";
import { execSync } from "child_process";

mkdirSync("src-tauri/icons", { recursive: true });

function crc32(buf) {
  const table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
      t[i] = c;
    }
    return t;
  })();
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length);
  const typeBytes = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBytes, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

function createPng(size) {
  const bg = 15; // #0f0f0f dark background
  const fg = 200; // light square representing a photo frame

  // Draw icon: dark bg with a simple white square (photo icon)
  const pixels = Buffer.alloc(size * size * 3);
  const margin = Math.floor(size * 0.15);
  const inner = size - margin * 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      const inSquare =
        x >= margin && x < margin + inner && y >= margin && y < margin + inner;
      const onBorder =
        inSquare &&
        (x === margin ||
          x === margin + inner - 1 ||
          y === margin ||
          y === margin + inner - 1);
      const v = onBorder ? fg : bg;
      pixels[i] = v;
      pixels[i + 1] = v;
      pixels[i + 2] = v;
    }
  }

  // Build raw filtered image data (filter byte 0 per row)
  const rowSize = 1 + size * 3;
  const raw = Buffer.alloc(size * rowSize);
  for (let y = 0; y < size; y++) {
    raw[y * rowSize] = 0; // None filter
    pixels.copy(raw, y * rowSize + 1, y * size * 3, (y + 1) * size * 3);
  }

  const compressed = deflateSync(raw);

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB color type

  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// Write source icon (512x512)
import { writeFileSync } from "fs";
writeFileSync("src-tauri/icons/source.png", createPng(512));
console.log("Created src-tauri/icons/source.png");

// Generate all required Tauri icon sizes
console.log("Generating all icon sizes via Tauri CLI...");
try {
  execSync("npx tauri icon src-tauri/icons/source.png", { stdio: "inherit" });
  console.log("Icons generated successfully.");
} catch (e) {
  console.error(
    "tauri icon command failed — run manually: npx tauri icon src-tauri/icons/source.png"
  );
}
