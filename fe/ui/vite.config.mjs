/**
 * Vite config cho React renderer.
 * - base './' → asset path tương đối (Electron loadFile từ ổ đĩa, app portable).
 * - Build ra fe/dist/ui.
 * - CSP chỉ chèn khi build (dev cần inline preamble của React refresh).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const rendererRoot = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(rendererRoot, '..');

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data: blob: lcfile:",
  "media-src 'self' blob: lcfile:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
].join('; ');

/** Plugin nhỏ: chèn thẻ meta CSP vào index.html khi build production. */
function cspPlugin() {
  return {
    name: 'lanchat-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const tag = `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`;
        return html.replace(/(<meta charset="[^"]*"\s*\/?>)/i, `$1\n    ${tag}`);
      },
    },
  };
}

export default defineConfig({
  root: rendererRoot,
  base: './',
  plugins: [react(), cspPlugin()],
  css: {
    postcss: clientRoot,
  },
  build: {
    outDir: path.resolve(clientRoot, 'dist', 'ui'),
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
});
