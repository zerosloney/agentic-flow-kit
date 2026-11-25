import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTmp } from './helpers/tmp.mjs';
import { rulesCommand } from '../src/commands/rules.mjs';
import { main } from '../src/cli/main.mjs';
import { loadModel } from '../src/rules/load.mjs';
import { parseYaml } from '../src/rules/yaml.mjs';
import { makeT } from '../src/i18n.mjs';

function withTempDir(fn) {
  const dir = makeTmp('rules-export-test-');
  return fn(dir);
}

test('rules export - consolidates legacy configs into flow-rules.yml', () => {
  withTempDir((root) => {
    // 写入旧碎片配置 1: project-faces.json
    const cfgDir = path.join(root, '.agents', 'config');
    const hooksDir = path.join(root, '.agents', 'hooks');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.mkdirSync(hooksDir, { recursive: true });

    fs.writeFileSync(path.join(cfgDir, 'project-faces.json'), JSON.stringify({
      ui: ['src/views', 'src/components'],
      code: ['src/core'],
      tests: ['tests'],
      data: ['data'],
    }), 'utf8');

    // 写入旧碎片配置 2: architecture-redlines.json
    fs.writeFileSync(path.join(hooksDir, 'architecture-redlines.json'), JSON.stringify({
      forbidden: [
        {
          id: 'no-direct-sql',
          targets: ['src/core'],
          contains: ['SELECT * FROM'],
          message: '禁止拼装裸 SQL',
        },
      ],
    }), 'utf8');

    // 写入 package.json
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'my-legacy-app',
      version: '1.0.0',
    }), 'utf8');

    const t = makeT('zh-CN');
    const code = rulesCommand({
      args: { _: ['rules', 'export'], target: root, flags: new Set() },
      t,
      lang: 'zh-CN',
    });

    assert.equal(code, 0);

    const outPath = path.join(root, 'flow-rules.yml');
    assert.ok(fs.existsSync(outPath), '生成了 flow-rules.yml');

    const content = fs.readFileSync(outPath, 'utf8');
    assert.ok(content.includes('# 由 `flow-kit rules export` 自动合拢生成'));

    const parsed = parseYaml(content, 'flow-rules.yml');
    assert.equal(parsed.version, 1);
    assert.equal(parsed.name, 'my-legacy-app');
    assert.deepEqual(parsed.faces.ui, ['src/views', 'src/components']);
    assert.ok(parsed.rules.some((r) => r.id === 'arch.no-direct-sql'));

    // 验证新生成的 flow-rules.yml 能直接被 loadModel 正确装配
    const loaded = loadModel(root);
    assert.ok(loaded.model.rules.some((r) => r.id === 'arch.no-direct-sql'));
    assert.deepEqual(loaded.model.faces.ui, ['src/views', 'src/components']);
  });
});

test('rules export - handles --out, --force, and --json', () => {
  withTempDir((root) => {
    fs.mkdirSync(path.join(root, '.agents', 'config'), { recursive: true });
    fs.writeFileSync(path.join(root, '.agents', 'config', 'project-faces.json'), JSON.stringify({
      ui: ['src/ui'],
    }), 'utf8');

    const t = makeT('zh-CN');

    // 1. 指定 --out
    const code1 = rulesCommand({
      args: { _: ['rules', 'export'], target: root, out: 'custom-rules.yaml', flags: new Set() },
      t,
      lang: 'zh-CN',
    });
    assert.equal(code1, 0);
    assert.ok(fs.existsSync(path.join(root, 'custom-rules.yaml')));

    // 2. 再次执行但未给 --force -> 报错 exit 2
    const code2 = rulesCommand({
      args: { _: ['rules', 'export'], target: root, out: 'custom-rules.yaml', flags: new Set() },
      t,
      lang: 'zh-CN',
    });
    assert.equal(code2, 2);

    // 3. 加上 --force -> 成功覆盖
    const flagsWithForce = new Set(['force']);
    const code3 = rulesCommand({
      args: { _: ['rules', 'export'], target: root, out: 'custom-rules.yaml', force: true, flags: flagsWithForce },
      t,
      lang: 'zh-CN',
    });
    assert.equal(code3, 0);

    // 4. 测试 --json 旗标
    let captured = '';
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk) => {
      captured += chunk;
      return true;
    };
    try {
      const flagsWithJson = new Set(['force', 'json']);
      const code4 = rulesCommand({
        args: { _: ['rules', 'export'], target: root, out: 'custom-rules.yaml', force: true, json: true, flags: flagsWithJson },
        t,
        lang: 'zh-CN',
      });
      assert.equal(code4, 0);
      const jsonRes = JSON.parse(captured);
      assert.equal(jsonRes.written, 'custom-rules.yaml');
      assert.ok(jsonRes.rulesCount > 0);
    } finally {
      process.stdout.write = origWrite;
    }
  });
});

test('rules export - cli main end-to-end', async () => {
  await withTempDir(async (root) => {
    fs.mkdirSync(path.join(root, '.agents', 'config'), { recursive: true });
    fs.writeFileSync(path.join(root, '.agents', 'config', 'project-faces.json'), JSON.stringify({
      code: ['src'],
    }), 'utf8');

    const exitCode = await main(['rules', 'export', '--target', root, '--out', 'exported.yml']);
    assert.equal(exitCode, 0);
    assert.ok(fs.existsSync(path.join(root, 'exported.yml')));

    // 验证导出的文件被 loadModel 正确装配
    const loaded = loadModel(root);
    assert.deepEqual(loaded.model.faces.code, ['src']);
  });
});
