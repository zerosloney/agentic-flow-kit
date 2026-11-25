import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeTmp } from './helpers/tmp.mjs';
import { detectProductMode } from '../src/install/profiler.mjs';

function tmpDir() {
  return makeTmp('profiler-test-');
}

test('profiler: handles invalid or non-existent directories gracefully', () => {
  assert.equal(detectProductMode(null), null);
  assert.equal(detectProductMode(''), null);
  assert.equal(detectProductMode(path.join(os.tmpdir(), 'definitely-not-exist-dir-12345')), null);
});

test('profiler: empty directory returns null (fallback to web by caller)', () => {
  const dir = tmpDir();
  try {
    assert.equal(detectProductMode(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('profiler: monorepo detection via workspace files and structures', () => {
  const dir = tmpDir();
  try {
    // pnpm workspace
    fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
    assert.equal(detectProductMode(dir), 'monorepo');
    fs.rmSync(path.join(dir, 'pnpm-workspace.yaml'));

    // turbo.json
    fs.writeFileSync(path.join(dir, 'turbo.json'), '{"pipeline": {}}');
    assert.equal(detectProductMode(dir), 'monorepo');
    fs.rmSync(path.join(dir, 'turbo.json'));

    // package.json workspaces
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'my-mono', workspaces: ['apps/*', 'packages/*'] }));
    assert.equal(detectProductMode(dir), 'monorepo');
    fs.rmSync(path.join(dir, 'package.json'));

    // Cargo.toml workspace
    fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[workspace]\nmembers = ["crates/*"]\n');
    assert.equal(detectProductMode(dir), 'monorepo');
    fs.rmSync(path.join(dir, 'Cargo.toml'));

    // packages/ directory with subpackage
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'pkg-root' }));
    fs.mkdirSync(path.join(dir, 'packages', 'core'), { recursive: true });
    assert.equal(detectProductMode(dir), 'monorepo');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('profiler: CLI detection via bin or cmd structures', () => {
  const dir = tmpDir();
  try {
    // package.json bin
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'my-cli', bin: './bin/cli.mjs' }));
    assert.equal(detectProductMode(dir), 'cli');
    fs.rmSync(path.join(dir, 'package.json'));

    // cmd/ directory
    fs.mkdirSync(path.join(dir, 'cmd'), { recursive: true });
    assert.equal(detectProductMode(dir), 'cli');
    fs.rmdirSync(path.join(dir, 'cmd'));

    // src/bin/ directory
    fs.mkdirSync(path.join(dir, 'src', 'bin'), { recursive: true });
    assert.equal(detectProductMode(dir), 'cli');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('profiler: API detection via backend entry points without frontend', () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'Program.cs'), '// ASP.NET Core API\n');
    assert.equal(detectProductMode(dir), 'api');
    fs.rmSync(path.join(dir, 'Program.cs'));

    fs.writeFileSync(path.join(dir, 'main.go'), 'package main\n');
    assert.equal(detectProductMode(dir), 'api');
    fs.rmSync(path.join(dir, 'main.go'));

    fs.writeFileSync(path.join(dir, 'app.py'), '# Flask or FastAPI\n');
    assert.equal(detectProductMode(dir), 'api');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('profiler: Web detection via frontend assets and configs', () => {
  const dir = tmpDir();
  try {
    // index.html
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
    assert.equal(detectProductMode(dir), 'web');
    fs.rmSync(path.join(dir, 'index.html'));

    // vite.config.ts
    fs.writeFileSync(path.join(dir, 'vite.config.ts'), 'export default {}');
    assert.equal(detectProductMode(dir), 'web');
    fs.rmSync(path.join(dir, 'vite.config.ts'));

    // frontend directory
    fs.mkdirSync(path.join(dir, 'frontend'), { recursive: true });
    assert.equal(detectProductMode(dir), 'web');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('profiler: Library detection via package exports / Rust lib without bin', () => {
  const dir = tmpDir();
  try {
    // Rust library
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'lib.rs'), '// Rust lib');
    assert.equal(detectProductMode(dir), 'library');
    fs.rmSync(path.join(dir, 'src', 'lib.rs'));

    // Node library
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
      name: 'my-lib',
      main: './dist/index.js',
      types: './dist/index.d.ts',
    }));
    assert.equal(detectProductMode(dir), 'library');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
