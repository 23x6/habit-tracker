import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync } from 'node:fs';

// Emits sw.js with the precache list of every built file, so the app works offline after the first load.
function serviceWorker(): Plugin {
  return {
    name: 'still-sw',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const files = ['./', ...new Set([...Object.keys(bundle), ...readdirSync('public')])].map((f) => (f === './' ? f : './' + f));
      const template = readFileSync('src/sw-template.js', 'utf8');
      const version = hash(files.sort().join('|') + template);
      const src = template.replace('__PRECACHE__', JSON.stringify(files)).replace('__VERSION__', JSON.stringify(String(version)));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

export default defineConfig({
  base: './',
  plugins: [react(), serviceWorker()],
  test: { environment: 'node' },
} as any);
