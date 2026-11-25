import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeTmp } from './helpers/tmp.mjs';
import { detectProductMode, detectProductModeDetailed } from '../src/install/product-detect.mjs';

function tmpDir() {
  return makeTmp('product-detect-test-');
}

test('product-detect: handles invalid or non-existent directories gracefully', () => {
  assert.equal(detectProductMode(null), null);
  assert.equal(detectProductMode(''), null);
  assert.equal(detectProductMode(path.join(os.tmpdir(), 'definitely-not-exist-dir-12345')), null);
});

test('product-detect: empty directory returns null (fallback to web by caller)', () => {
  const dir = tmpDir();
  try {
    assert.equal(detectProductMode(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('product-detect: monorepo detection via workspace files and structures', () => {
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

    // packages/ 只有目录、子目录无 package.json 时不算 monorepo（旧行为误判，已收紧）
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'pkg-root' }));
    fs.mkdirSync(path.join(dir, 'packages', 'core'), { recursive: true });
    assert.equal(detectProductMode(dir), null);

    // 子目录含 package.json 才算 monorepo
    fs.writeFileSync(path.join(dir, 'packages', 'core', 'package.json'), JSON.stringify({ name: 'core' }));
    assert.equal(detectProductMode(dir), 'monorepo');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('product-detect: CLI detection via bin or cmd structures', () => {
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

test('product-detect: API detection via backend entry points without frontend', () => {
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

test('product-detect: Web detection via frontend assets and configs', () => {
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

test('product-detect: ASP.NET SPA template (ClientApp/) is web with evidence', () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'Program.cs'), '// ASP.NET Core host\n');
    fs.mkdirSync(path.join(dir, 'ClientApp'), { recursive: true });
    assert.equal(detectProductMode(dir), 'web');
    const detailed = detectProductModeDetailed(dir);
    assert.equal(detailed.mode, 'web');
    assert.equal(detailed.reason, 'Program.cs + ClientApp/');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('product-detect: ASP.NET MVC / Razor templates are web', () => {
  const dir = tmpDir();
  try {
    // MVC: Views/ + wwwroot/
    fs.writeFileSync(path.join(dir, 'Program.cs'), '// ASP.NET Core host\n');
    fs.mkdirSync(path.join(dir, 'Views'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'wwwroot'), { recursive: true });
    assert.equal(detectProductMode(dir), 'web');

    // Razor Pages: Pages/ + .csproj
    fs.rmSync(path.join(dir, 'Views'), { recursive: true, force: true });
    fs.rmSync(path.join(dir, 'wwwroot'), { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'Pages'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'App.csproj'), '<Project />\n');
    assert.equal(detectProductMode(dir), 'web');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('product-detect: Spring MVC template / webapp dirs are web', () => {
  const dir = tmpDir();
  try {
    fs.mkdirSync(path.join(dir, 'src', 'main', 'java'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src', 'main', 'resources', 'templates'), { recursive: true });
    assert.equal(detectProductMode(dir), 'web');

    fs.rmSync(path.join(dir, 'src', 'main', 'resources'), { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'src', 'main', 'webapp'), { recursive: true });
    assert.equal(detectProductMode(dir), 'web');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('product-detect: Django is web unless DRF is present', () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'manage.py'), '#!/usr/bin/env python\n');
    fs.writeFileSync(path.join(dir, 'requirements.txt'), 'Django==5.0\n');
    assert.equal(detectProductMode(dir), 'web');

    fs.writeFileSync(path.join(dir, 'requirements.txt'), 'Django==5.0\ndjangorestframework==3.15\n');
    assert.equal(detectProductMode(dir), 'api');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('product-detect: Go service under cmd/ importing net/http is api, otherwise cli', () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'go.mod'), 'module example.com/app\n');
    fs.mkdirSync(path.join(dir, 'cmd', 'server'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'cmd', 'server', 'main.go'), 'package main\nimport "net/http"\nfunc main() { _ = http.ListenAndServe }\n');
    assert.equal(detectProductMode(dir), 'api');

    fs.writeFileSync(path.join(dir, 'cmd', 'server', 'main.go'), 'package main\nfunc main() {}\n');
    assert.equal(detectProductMode(dir), 'cli');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('product-detect: packages/ without workspace config stays a web app', () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'web-app', dependencies: { react: '^18.0.0' } }));
    fs.mkdirSync(path.join(dir, 'packages'), { recursive: true });
    assert.equal(detectProductMode(dir), 'web');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('product-detect: Library detection via package exports / Rust lib without bin', () => {
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
