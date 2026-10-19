#!/usr/bin/env node
/**
 * Sinh icon cho build (chạy TAY lúc dev, KHÔNG chạy lúc runtime):
 *   build/icon.png (512x512), build/icon.ico (16–256, entry PNG), build/tray-icon.png (32x32).
 * Dùng sharp của project server (../server/node_modules/sharp) chỉ trong script này.
 * Chạy: node scripts/generate-icons.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const PRIMARY = '#2563eb';
const PRIMARY_DARK = '#1d4ed8';

/** Logo: bong bóng chat trắng trên nền bo góc xanh, 3 chấm "đang soạn" */
function logoSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${PRIMARY}"/><stop offset="1" stop-color="${PRIMARY_DARK}"/></linearGradient></defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#g)"/>
  <path d="M256 112c-94 0-170 62-170 139 0 43 24 82 62 107-4 25-16 48-34 66 36-4 69-17 94-38 15 3 31 5 48 5 94 0 170-62 170-140S350 112 256 112z" fill="#ffffff"/>
  <circle cx="186" cy="252" r="22" fill="${PRIMARY}"/><circle cx="256" cy="252" r="22" fill="${PRIMARY}"/><circle cx="326" cy="252" r="22" fill="${PRIMARY}"/>
</svg>`;
}

/**
 * Ghép file .ico từ các PNG (định dạng ICO cho phép entry PNG — Windows Vista+).
 * @param {{size: number, data: Buffer}[]} images
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach((img, i) => {
    const o = i * 16;
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, o); // 0 = 256
    dir.writeUInt8(img.size >= 256 ? 0 : img.size, o + 1);
    dir.writeUInt8(0, o + 2); // palette
    dir.writeUInt8(0, o + 3); // reserved
    dir.writeUInt16LE(1, o + 4); // color planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(img.data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += img.data.length;
  });
  return Buffer.concat([header, dir, ...images.map((img) => img.data)]);
}

async function main() {
  let sharp;
  try {
    sharp = require(path.join(__dirname, '..', '..', 'be', 'node_modules', 'sharp'));
  } catch (err) {
    console.error('✖ Không tìm thấy sharp (cần chạy `npm ci` trong server/ trước):', err.message);
    process.exit(1);
  }
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  const render = (size) => sharp(Buffer.from(logoSvg(size))).resize(size, size).png().toBuffer();

  fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), await render(512));
  fs.writeFileSync(path.join(BUILD_DIR, 'tray-icon.png'), await render(32));
  const images = [];
  for (const size of ICO_SIZES) images.push({ size, data: await render(size) });
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), buildIco(images));
  console.log('✔ Đã sinh build/icon.png, build/icon.ico, build/tray-icon.png');
}

main().catch((err) => {
  console.error('✖ Sinh icon thất bại:', err);
  process.exit(1);
});
