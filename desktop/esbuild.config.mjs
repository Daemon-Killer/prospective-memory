import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const isDev = process.argv.includes('--watch');

function copyFile(src, dest) {
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFile(srcPath, destPath);
    }
  }
}

async function build() {
  console.log('Building Remy Reminders Desktop...');

  const alias = {
    '@core': path.resolve('../reminder app/src/utils'),
    '@types-remy': path.resolve('../reminder app/src/types'),
  };

  // 1. Build main process
  await esbuild.build({
    entryPoints: ['src/main/index.ts'],
    tsconfig: 'tsconfig.json',
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: 'dist/main/index.js',
    external: ['electron', 'sql.js'],
    sourcemap: isDev,
    alias,
  });

  // 2. Build preload
  await esbuild.build({
    entryPoints: ['src/preload.ts'],
    tsconfig: 'tsconfig.json',
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: 'dist/preload.js',
    external: ['electron'],
    sourcemap: isDev,
    alias,
  });

  // 3. Build renderers
  await esbuild.build({
    entryPoints: ['src/renderer/spotlight/spotlight.ts'],
    tsconfig: 'tsconfig.json',
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    outfile: 'dist/renderer/spotlight/spotlight.js',
    sourcemap: isDev,
  });

  await esbuild.build({
    entryPoints: ['src/renderer/agenda/agenda.ts'],
    tsconfig: 'tsconfig.json',
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    outfile: 'dist/renderer/agenda/agenda.js',
    sourcemap: isDev,
    alias,
  });

  // 4. Copy static HTML, CSS, assets, and wasm
  copyFile('src/renderer/spotlight/index.html', 'dist/renderer/spotlight/index.html');
  copyFile('src/renderer/spotlight/spotlight.css', 'dist/renderer/spotlight/spotlight.css');
  copyFile('src/renderer/agenda/index.html', 'dist/renderer/agenda/index.html');
  copyFile('src/renderer/agenda/agenda.css', 'dist/renderer/agenda/agenda.css');
  copyDir('assets', 'dist/assets');

  // Copy sql-wasm.wasm
  const wasmSrc = 'node_modules/sql.js/dist/sql-wasm.wasm';
  if (fs.existsSync(wasmSrc)) {
    copyFile(wasmSrc, 'dist/main/sql-wasm.wasm');
  }

  console.log('✓ Remy Reminders Desktop build complete!');
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
