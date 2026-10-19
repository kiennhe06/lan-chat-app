#!/usr/bin/env node
/**
 * Đóng gói server cho Windows x64 (chạy ở BUILD-TIME trên máy CÓ internet: macOS / Linux / Windows).
 *
 * Kết quả:
 *   dist/LANChat-Server/                       thư mục portable (code + node_modules win32-x64 + node/node.exe)
 *   dist/LANChat-Server-<version>-win-x64.zip  để copy sang máy offline
 *
 * Các bước:
 *   1. Copy mã nguồn (không gồm data/, test/, dist/, node_modules/, scripts/).
 *   2. `npm install --omit=dev --os=win32 --cpu=x64 --ignore-scripts` trong thư mục staging
 *      → sharp kéo @img/sharp-win32-x64; better-sqlite3 + bcrypt có sẵn prebuild N-API win32-x64 trong tarball.
 *      Kiểm tra các file .node win32-x64 tồn tại — thiếu là DỪNG NGAY (fail loudly).
 *   3. Tải Node.js Windows x64 zip chính thức (mặc định v22.23.3, override env NODE_VERSION) vào cache,
 *      verify SHASUMS256, giải nén vào LANChat-Server/node/.
 *   4. Nén zip.
 *
 * Biến môi trường:
 *   NODE_VERSION=v22.23.3     phiên bản Node portable
 *   NODE_DIST_URL=...         mirror (mặc định https://nodejs.org/dist)
 *   NODE_CACHE_DIR=...        thư mục cache file tải về (mặc định dist/.cache)
 *   SKIP_NODE_DOWNLOAD=1      bỏ qua bước 3 (kiểm tra nhanh staging + npm install + zip)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const SERVER_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(SERVER_DIR, 'dist');
const STAGE_NAME = 'LANChat-Server';
const STAGE_DIR = path.join(DIST_DIR, STAGE_NAME);
const CACHE_DIR = path.resolve(process.env.NODE_CACHE_DIR || path.join(DIST_DIR, '.cache'));
const DEFAULT_NODE_VERSION = 'v22.23.3';
const NODE_DIST_URL = (process.env.NODE_DIST_URL || 'https://nodejs.org/dist').replace(/\/+$/, '');
const SKIP_NODE = ['1', 'true', 'yes'].includes(String(process.env.SKIP_NODE_DOWNLOAD || '').toLowerCase());
const IS_WINDOWS = process.platform === 'win32';

/** File/thư mục mã nguồn được đưa vào gói. */
const INCLUDE = [
  'index.js',
  'src',
  'app-config.json',
  'start-server.bat',
  'start-server.vbs',
  'README.md',
  'package.json',
  'package-lock.json',
];

/** Binary native bắt buộc cho win32-x64 (đường dẫn tương đối trong node_modules). */
const REQUIRED_NATIVE = [
  { name: 'better-sqlite3', path: 'better-sqlite3/prebuilds/win32-x64.node' },
  { name: 'bcrypt', path: 'bcrypt/prebuilds/win32-x64', dirWithNode: true },
  { name: 'sharp', path: '@img/sharp-win32-x64/lib', dirWithNode: true },
];

/** Thư mục prebuilds cần giữ win32-x64, bỏ nền tảng khác cho gọn. */
const PRUNE_PREBUILDS = [
  { dir: 'better-sqlite3/prebuilds', keep: 'win32-x64.node' },
  { dir: 'bcrypt/prebuilds', keep: 'win32-x64' },
];

const log = (msg) => process.stdout.write(`${msg}\n`);
const step = (n, msg) => log(`\n[${n}] ${msg}`);
const fail = (msg) => {
  throw new Error(msg);
};

function formatSize(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

/** Chạy lệnh, trả về true nếu exit 0. ENOENT (không có lệnh) → false nếu allowMissing. */
function run(cmd, args, options) {
  const opts = options || {};
  const result = spawnSync(cmd, args, { cwd: opts.cwd, stdio: 'inherit', shell: IS_WINDOWS && opts.shell !== false });
  if (result.error) {
    if (opts.allowMissing && result.error.code === 'ENOENT') return false;
    fail(`Không chạy được "${cmd}": ${result.error.message}`);
  }
  if (result.status !== 0) {
    if (opts.allowFailure) return false;
    fail(`Lệnh "${cmd} ${args.join(' ')}" thất bại (exit ${result.status})`);
  }
  return true;
}

/** Xóa thư mục staging (chỉ cho phép xóa bên trong dist/). */
function cleanStage() {
  const rel = path.relative(DIST_DIR, STAGE_DIR);
  if (rel.startsWith('..') || path.isAbsolute(rel) || !rel) fail(`Đường dẫn staging bất thường: ${STAGE_DIR}`);
  fs.rmSync(STAGE_DIR, { recursive: true, force: true });
  fs.mkdirSync(STAGE_DIR, { recursive: true });
}

function copySources() {
  for (const entry of INCLUDE) {
    const src = path.join(SERVER_DIR, entry);
    if (!fs.existsSync(src)) fail(`Thiếu file nguồn: ${entry}`);
    fs.cpSync(src, path.join(STAGE_DIR, entry), { recursive: true });
    log(`  + ${entry}`);
  }
}

function installProductionDeps() {
  const npm = IS_WINDOWS ? 'npm.cmd' : 'npm';
  run(npm, ['install', '--omit=dev', '--os=win32', '--cpu=x64', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: STAGE_DIR });
}

function verifyNative() {
  const nm = path.join(STAGE_DIR, 'node_modules');
  for (const item of REQUIRED_NATIVE) {
    const target = path.join(nm, item.path);
    const ok = item.dirWithNode
      ? fs.existsSync(target) && fs.readdirSync(target).some((f) => f.endsWith('.node'))
      : fs.existsSync(target);
    if (!ok) fail(`THIẾU binary native win32-x64 của ${item.name}: ${target}\n  → Không thể đóng gói. Kiểm tra phiên bản package / kết nối mạng khi npm install.`);
    log(`  ✔ ${item.name}: ${item.path}`);
  }
  // sharp cần thêm libvips đi kèm (@img/sharp-libvips-win32-x64 hoặc nằm chung thư mục lib)
  const sharpLib = path.join(nm, '@img/sharp-win32-x64/lib');
  const dlls = fs.readdirSync(sharpLib).filter((f) => f.toLowerCase().endsWith('.dll'));
  if (!dlls.length) fail(`THIẾU thư viện libvips (.dll) cho sharp trong ${sharpLib}`);
  log(`  ✔ sharp libvips: ${dlls.length} file .dll`);
}

function prunePrebuilds() {
  const nm = path.join(STAGE_DIR, 'node_modules');
  for (const { dir, keep } of PRUNE_PREBUILDS) {
    const full = path.join(nm, dir);
    if (!fs.existsSync(full)) continue;
    for (const name of fs.readdirSync(full)) {
      if (name !== keep) fs.rmSync(path.join(full, name), { recursive: true, force: true });
    }
  }
  log('  ✔ Đã bỏ prebuild của nền tảng khác (chỉ giữ win32-x64)');
}

/** Tải URL về file (theo redirect), ghi qua file .part rồi đổi tên. */
async function download(url, dest) {
  log(`  ↓ ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) fail(`Tải thất bại ${url}: HTTP ${res.status}`);
  const part = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(part));
  fs.renameSync(part, dest);
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Tải (hoặc dùng cache) zip Node.js + verify SHASUMS256. @returns {Promise<string>} đường dẫn zip */
async function fetchNodeZip(version) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const zipName = `node-${version}-win-x64.zip`;
  const zipPath = path.join(CACHE_DIR, zipName);
  const sumsPath = path.join(CACHE_DIR, `SHASUMS256-${version}.txt`);
  if (!fs.existsSync(sumsPath)) await download(`${NODE_DIST_URL}/${version}/SHASUMS256.txt`, sumsPath);
  const line = fs
    .readFileSync(sumsPath, 'utf8')
    .split('\n')
    .find((l) => l.trim().endsWith(`  ${zipName}`));
  if (!line) fail(`Không tìm thấy ${zipName} trong SHASUMS256.txt — sai NODE_VERSION?`);
  const expected = line.trim().split(/\s+/)[0];
  if (fs.existsSync(zipPath) && sha256File(zipPath) !== expected) {
    log('  ! File cache sai checksum → tải lại');
    fs.rmSync(zipPath);
  }
  if (!fs.existsSync(zipPath)) await download(`${NODE_DIST_URL}/${version}/${zipName}`, zipPath);
  const actual = sha256File(zipPath);
  if (actual !== expected) fail(`SHA-256 không khớp cho ${zipName}\n  mong đợi: ${expected}\n  thực tế : ${actual}`);
  log(`  ✔ SHA-256 hợp lệ (${formatSize(fs.statSync(zipPath).size)})`);
  return zipPath;
}

/** Giải nén zip Node vào LANChat-Server/node/. */
function extractNode(zipPath, version) {
  const tmp = path.join(CACHE_DIR, `extract-${version}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  // bsdtar (Windows 10+, macOS) giải nén được zip; Linux (GNU tar) → dùng unzip
  const extracted = run('tar', ['-xf', zipPath, '-C', tmp], { allowMissing: true, allowFailure: true, shell: false });
  if (!extracted) run('unzip', ['-q', zipPath, '-d', tmp], { shell: false });
  const inner = path.join(tmp, `node-${version}-win-x64`);
  if (!fs.existsSync(path.join(inner, 'node.exe'))) fail(`Không thấy node.exe sau khi giải nén: ${inner}`);
  const target = path.join(STAGE_DIR, 'node');
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(inner, target, { recursive: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  log(`  ✔ node/node.exe (${version})`);
}

/** Nén thư mục staging thành zip. */
function createZip(zipPath) {
  fs.rmSync(zipPath, { force: true });
  const viaZip = run('zip', ['-qrX', zipPath, STAGE_NAME], { cwd: DIST_DIR, allowMissing: true, allowFailure: true, shell: false });
  if (!viaZip) {
    // bsdtar: -a chọn định dạng theo đuôi .zip (Windows 10+ / macOS)
    run('tar', ['-a', '-c', '-f', zipPath, STAGE_NAME], { cwd: DIST_DIR, shell: false });
  }
  if (!fs.existsSync(zipPath)) fail(`Không tạo được ${zipPath}`);
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(SERVER_DIR, 'package.json'), 'utf8'));
  const rawVersion = process.env.NODE_VERSION || DEFAULT_NODE_VERSION;
  const nodeVersion = rawVersion.startsWith('v') ? rawVersion : `v${rawVersion}`;
  const zipPath = path.join(DIST_DIR, `${STAGE_NAME}-${pkg.version}-win-x64.zip`);

  log(`Đóng gói ${STAGE_NAME} v${pkg.version} cho Windows x64 (build trên ${process.platform}-${process.arch})`);
  step(1, `Chuẩn bị thư mục ${path.relative(SERVER_DIR, STAGE_DIR)}`);
  cleanStage();
  copySources();

  step(2, 'Cài dependencies production cho win32-x64');
  installProductionDeps();
  verifyNative();
  prunePrebuilds();

  step(3, SKIP_NODE ? 'Bỏ qua tải Node portable (SKIP_NODE_DOWNLOAD=1)' : `Node.js portable ${nodeVersion}`);
  if (!SKIP_NODE) extractNode(await fetchNodeZip(nodeVersion), nodeVersion);

  step(4, 'Nén zip');
  createZip(zipPath);
  log(`\n✔ Hoàn tất: ${zipPath} (${formatSize(fs.statSync(zipPath).size)})`);
  if (SKIP_NODE) log('  ⚠ Gói KHÔNG có node/node.exe — máy đích cần Node cài sẵn (≥ 22).');
}

main().catch((err) => {
  process.stderr.write(`\n✖ Đóng gói thất bại: ${err.message}\n`);
  process.exit(1);
});
