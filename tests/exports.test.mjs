// issue #88：配置 exports 后 npm 包对未声明深层路径激活子路径封装（ERR_PACKAGE_PATH_NOT_EXPORTED），
// 仅声明 ./kernel 曾封锁下游对 package.json / bin / templates 资产的访问。本测试钉住补全后的
// 公开面：四个子路径可解析；未列出的 src 深层路径仍保持封装。解析用包名自引用（self-reference），
// 与下游 import / require.resolve 走同一份 exports 映射规则。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('package.json exports pin the intended public subpaths (issue #88)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(KIT, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg.exports), ['./kernel', './package.json', './bin/*', './templates/*']);
});

test('kernel / package.json / bin / templates subpaths resolve through exports', () => {
  const subpaths = [
    'agentic-flow-kit/kernel',
    'agentic-flow-kit/package.json',
    'agentic-flow-kit/bin/flow-kit.mjs',
    // issue #88 的实测报错路径：深层模板脚本（`*` 需匹配含路径分隔符的子路径）
    'agentic-flow-kit/templates/engine/.agents/scripts/quote-grounding.mjs',
  ];
  for (const spec of subpaths) {
    const abs = fileURLToPath(import.meta.resolve(spec));
    assert.ok(
      abs.startsWith(KIT + path.sep) && fs.existsSync(abs),
      `${spec} 应解析为本仓库内存在的文件，实际：${abs}`,
    );
  }
});

test('deep src paths stay encapsulated by exports', () => {
  assert.throws(
    () => import.meta.resolve('agentic-flow-kit/src/commands/diff.mjs'),
    (err) => err.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED',
  );
});
