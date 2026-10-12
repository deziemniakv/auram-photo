import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

/** Content Security Policy; development additionally allows the Vite dev server. */
function contentSecurityPolicy(): Plugin {
  let isDev = false;
  return {
    name: 'auram-csp',
    configResolved(config) {
      isDev = config.command === 'serve';
    },
    transformIndexHtml(html) {
      const policy = [
        "default-src 'self'",
        isDev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
        "worker-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        isDev ? "connect-src 'self' ws://localhost:* http://localhost:*" : "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; ');
      return html.replace('%CONTENT_SECURITY_POLICY%', policy);
    },
  };
}

export default defineConfig({
  main: {
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } },
  },
  preload: {
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), contentSecurityPolicy()],
    worker: { format: 'es' },
    build: {
      minify: true,
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
  },
});
