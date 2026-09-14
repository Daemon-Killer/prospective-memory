import { resolve } from 'node:path';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { build as viteBuild } from 'vite';

export default defineConfig(({ mode }) => {
  const isFirefox = mode === 'firefox';
  const outDir = isFirefox ? 'dist/firefox' : 'dist/chrome';
  const manifestSource = isFirefox ? 'manifest.firefox.json' : 'manifest.json';

  return {
    base: '',
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@core': resolve(__dirname, '../reminder app/src/utils'),
      },
    },
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          popup: resolve(__dirname, 'src/popup/popup.html'),
          sidepanel: resolve(__dirname, 'src/sidepanel/sidepanel.html'),
          options: resolve(__dirname, 'src/options/options.html'),
          background: resolve(__dirname, 'src/background/background.ts'),
        },
        output: {
          entryFileNames: (chunk) => {
            if (chunk.name === 'background') return 'background.js';
            return 'assets/[name]-[hash].js';
          },
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
    },
    plugins: [
      {
        name: 'manifest-and-assets',
        generateBundle() {
          const manifestPath = resolve(__dirname, manifestSource);
          if (existsSync(manifestPath)) {
            this.emitFile({
              type: 'asset',
              fileName: 'manifest.json',
              source: readFileSync(manifestPath, 'utf-8'),
            });
          }
        },
        async closeBundle() {
          if (process.env.VITEST) return;
          // 1. Bundle content script as a standalone IIFE bundle (zero external module imports)
          await viteBuild({
            configFile: false,
            resolve: {
              alias: {
                '@': resolve(__dirname, 'src'),
                '@core': resolve(__dirname, '../reminder app/src/utils'),
              },
            },
            build: {
              outDir: resolve(__dirname, outDir),
              emptyOutDir: false,
              lib: {
                entry: resolve(__dirname, 'src/content/content.ts'),
                name: 'RemyContent',
                formats: ['iife'],
                fileName: () => 'content.js',
              },
            },
          });

          // 2. Also copy sidepanel.html, popup.html, options.html to target outDir root for fallback compatibility
          const copies = [
            ['src/sidepanel/sidepanel.html', 'sidepanel.html'],
            ['src/popup/popup.html', 'popup.html'],
            ['src/options/options.html', 'options.html'],
          ];
          for (const [srcRel, destRel] of copies) {
            const fullSrc = resolve(__dirname, outDir, srcRel);
            const fullDest = resolve(__dirname, outDir, destRel);
            if (existsSync(fullSrc)) {
              let html = readFileSync(fullSrc, 'utf-8');
              html = html.replace(/\.\.\/\.\.\/assets\//g, './assets/');
              writeFileSync(fullDest, html, 'utf-8');
            }
          }
        },
      },
    ],
    test: {
      globals: true,
      environment: 'happy-dom',
      setupFiles: ['./tests/setup.ts'],
    },
  };
});
