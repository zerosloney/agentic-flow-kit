// rules-driven-verify.test.mjs — 验证 Milestone 3：门禁脚本与工作流执行的“规则驱动化”
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SCRIPTS_DIR = path.join(ROOT, 'templates', 'engine', '.agents', 'scripts');

function scriptUrl(name) {
  return pathToFileURL(path.join(SCRIPTS_DIR, name)).href;
}

function makeTmpDir(prefix = 'rules-verify-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('rules-loader: parseYamlSimple and findProjectRulesFile', async () => {
  const { parseYamlSimple, findProjectRulesFile, loadProjectRules, extractVerifyCommandGates } =
    await import(scriptUrl('rules-loader.mjs'));

  const tmp = makeTmpDir();
  try {
    assert.equal(findProjectRulesFile(tmp), null);

    const yamlContent = `
# 示例 flow-rules.yml
name: my-app
faces:
  backend:
    paths:
      - src/Backend/**
  frontend:
    paths:
      - src/Frontend/**
rules:
  - id: product.backend-build
    name: 后端构建
    phase: verify
    folder: src/Backend
    command: dotnet build
    when:
      exists: src/Backend/App.sln
  - id: product.frontend-test
    name: 前端测试
    phase: verify
    folder: src/Frontend
    command: pnpm test
`;
    fs.writeFileSync(path.join(tmp, 'flow-rules.yml'), yamlContent, 'utf8');

    assert.equal(findProjectRulesFile(tmp), 'flow-rules.yml');

    const loaded = loadProjectRules(tmp);
    assert.ok(loaded);
    assert.equal(loaded.name, 'my-app');
    assert.deepEqual(loaded.faces.backend.paths, ['src/Backend/**']);
    assert.equal(loaded.rules.length, 2);

    const gates = extractVerifyCommandGates(loaded, tmp);
    assert.equal(gates.length, 2);
    assert.equal(gates[0].id, 'backend-build');
    assert.equal(gates[0].name, '后端构建');
    assert.equal(gates[0].folder, 'src/Backend');
    assert.equal(gates[0].cmd, 'flow-kit rules check --with-commands --prefix product.backend-build');
    assert.deepEqual(gates[0].when, { exists: 'src/Backend/App.sln' });

    assert.equal(gates[1].id, 'frontend-test');
    assert.equal(gates[1].folder, 'src/Frontend');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('faces.mjs: reads faces from flow-rules.yml when project-faces.json is missing', async () => {
  const { loadFaces, faceOf } = await import(scriptUrl('faces.mjs'));

  const tmp = makeTmpDir();
  try {
    const yamlContent = `
faces:
  backend:
    paths:
      - "server/**"
      - "api/**"
  frontend:
    paths:
      - "web/**"
`;
    fs.writeFileSync(path.join(tmp, 'flow-rules.yml'), yamlContent, 'utf8');

    const config = loadFaces(tmp);
    assert.equal(config.configured, true);
    assert.deepEqual(config.code, ['server/**', 'api/**']);
    assert.deepEqual(config.ui, ['web/**']);

    assert.equal(faceOf(config, 'server/main.go'), 'code');
    assert.equal(faceOf(config, 'api/proto/v1.proto'), 'code');
    assert.equal(faceOf(config, 'web/src/App.vue'), 'ui');
    assert.equal(faceOf(config, 'README.md'), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('verify-scope.mjs: readProductGateEntries merges rules from flow-rules.yml', async () => {
  const { readProductGateEntries } = await import(scriptUrl('verify-scope.mjs'));

  const tmp = makeTmpDir();
  try {
    const yamlContent = `
faces:
  backend:
    paths:
      - "core/**"
rules:
  - id: product.core-compile
    name: 核心模块编译
    phase: verify
    folder: core
    command: cargo check
`;
    fs.writeFileSync(path.join(tmp, 'flow-rules.yml'), yamlContent, 'utf8');

    const entries = readProductGateEntries(tmp);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, 'core-compile');
    assert.equal(entries[0].folder, 'core');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('verify.mjs: declarative rules center summary and gate listing', () => {
  const tmp = makeTmpDir();
  try {
    const yamlContent = `
name: yaml-demo
faces:
  backend:
    paths:
      - "backend/**"
rules:
  - id: product.service-build
    name: 微服务构建
    phase: verify
    folder: backend
    command: go build ./...
    when:
      exists: backend/go.mod
`;
    fs.writeFileSync(path.join(tmp, 'flow-rules.yml'), yamlContent, 'utf8');
    fs.mkdirSync(path.join(tmp, 'backend'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'backend', 'go.mod'), 'module example.com/demo\n', 'utf8');

    // 运行 verify.mjs --list
    const verifyScript = path.join(SCRIPTS_DIR, 'verify.mjs');
    const res = spawnSync(process.execPath, [verifyScript, '--list'], {
      encoding: 'utf8',
      cwd: tmp,
      env: {
        ...process.env,
        FLOW_KIT_TEST: '1',
        FLOW_KIT_PROJECT_ROOT: tmp,
      },
    });

    assert.equal(res.status, 0, `verify.mjs failed:\nSTDERR:\n${res.stderr}\nSTDOUT:\n${res.stdout}`);
    // 检查 stderr 中是否包含声明式规则中心摘要，且绝无“未配置 6 项”
    assert.match(res.stderr, /门禁配置：已加载 flow-rules\.yml（声明式规则中心：1 条规则）/);
    assert.doesNotMatch(res.stderr, /未配置 6 项/);

    // 检查 stdout 包含提取出来的产品门
    assert.match(res.stdout, /service-build/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('verify.mjs: gate skipped when "when" guard is not satisfied', () => {
  const tmp = makeTmpDir();
  try {
    const yamlContent = `
name: yaml-demo
rules:
  - id: product.backend-build
    name: 后端构建
    phase: verify
    folder: src/Backend
    command: dotnet build
    when:
      exists: src/Backend/NonExistent.sln
`;
    fs.writeFileSync(path.join(tmp, 'flow-rules.yml'), yamlContent, 'utf8');

    const verifyScript = path.join(SCRIPTS_DIR, 'verify.mjs');
    const res = spawnSync(process.execPath, [verifyScript, '--list'], {
      encoding: 'utf8',
      cwd: tmp,
      env: {
        ...process.env,
        FLOW_KIT_TEST: '1',
        FLOW_KIT_PROJECT_ROOT: tmp,
      },
    });

    assert.equal(res.status, 0);
    // 当 when 未满足时：门禁不进清单，stderr 打印 SKIP 行
    assert.doesNotMatch(res.stdout, /backend-build/);
    assert.match(res.stderr, /SKIP: backend-build/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('verify.mjs: legacy fallback when flow-rules.yml is absent', () => {
  const tmp = makeTmpDir();
  try {
    const verifyScript = path.join(SCRIPTS_DIR, 'verify.mjs');
    const res = spawnSync(process.execPath, [verifyScript, '--list'], {
      encoding: 'utf8',
      cwd: tmp,
      env: {
        ...process.env,
        FLOW_KIT_TEST: '1',
        FLOW_KIT_PROJECT_ROOT: tmp,
      },
    });

    assert.equal(res.status, 0);
    // 依然保持旧提示格式：未配置 7 项
    assert.match(res.stderr, /未配置 7/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('check-local-gate-config.mjs: detects dotnet stack from flow-rules.yml', async () => {
  const { detectStackFromRules } = await import(scriptUrl('rules-loader.mjs'));

  const tmp = makeTmpDir();
  try {
    fs.writeFileSync(path.join(tmp, 'flow-rules.yml'), 'stack: dotnet\n', 'utf8');
    const stacks = detectStackFromRules(tmp);
    assert.deepEqual(stacks, ['dotnet']);

    fs.writeFileSync(path.join(tmp, 'flow-rules.yml'), 'extends:\n  - preset:stack/dotnet\n  - preset:stack/node\n', 'utf8');
    const stacks2 = detectStackFromRules(tmp);
    assert.ok(stacks2.includes('dotnet'));
    assert.ok(stacks2.includes('node'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('load.mjs: getVerifyCommandGates extracts gates correctly', async () => {
  const { getVerifyCommandGates } = await import(pathToFileURL(path.join(ROOT, 'src', 'rules', 'load.mjs')).href);
  const fakeModel = {
    rules: [
      {
        id: 'product.unit-test',
        name: '单元测试',
        phase: 'verify',
        assert: {
          kind: 'command',
          args: { run: 'npm test', cwd: 'packages/app' },
        },
      },
      {
        id: 'commit.hygiene',
        name: '提交卫生',
        phase: 'commit-msg',
        assert: { kind: 'command', args: { run: 'check-commit' } },
      },
      {
        id: 'product.disabled-gate',
        enabled: false,
        phase: 'verify',
        assert: { kind: 'command', args: { run: 'echo disabled' } },
      },
    ],
  };

  const gates = getVerifyCommandGates(fakeModel);
  assert.equal(gates.length, 1);
  assert.equal(gates[0].id, 'unit-test');
  assert.equal(gates[0].name, '单元测试');
  assert.equal(gates[0].folder, 'packages/app');
  assert.equal(gates[0].rawCmd, 'npm test');
  assert.equal(gates[0].cmd, 'flow-kit rules check --with-commands --prefix product.unit-test');
});

test('rules-loader: automatically cascades stack rules when flow-rules.yml is absent or extends them', async () => {
  const { loadProjectRules, extractVerifyCommandGates, findStackRulesFiles, detectStackFromRules } =
    await import(scriptUrl('rules-loader.mjs'));

  const tmp = makeTmpDir();
  try {
    const rulesDir = path.join(tmp, '.agents', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });

    // 1. 模拟安装在 .agents/rules/stack.node.json
    const nodeStackRules = {
      name: 'stack.node',
      rules: [
        {
          id: 'product.node-lint',
          name: 'Node 代码规范检查',
          phase: 'verify',
          check: { primitive: 'command', run: 'npm run lint' },
        },
        {
          id: 'product.node-test',
          name: 'Node 单元测试',
          phase: 'verify',
          check: { primitive: 'command', run: 'npm test' },
        },
      ],
    };
    fs.writeFileSync(path.join(rulesDir, 'stack.node.json'), JSON.stringify(nodeStackRules, null, 2), 'utf8');

    assert.deepEqual(findStackRulesFiles(tmp), ['.agents/rules/stack.node.json']);
    assert.deepEqual(detectStackFromRules(tmp), ['node']);

    // 无 flow-rules.yml 时，自动加载 stack 规则
    const loadedWithoutProject = loadProjectRules(tmp);
    assert.ok(loadedWithoutProject);
    assert.equal(loadedWithoutProject.rules.length, 2);
    const gatesWithoutProject = extractVerifyCommandGates(loadedWithoutProject, tmp);
    assert.equal(gatesWithoutProject.length, 2);
    assert.equal(gatesWithoutProject[0].id, 'node-lint');
    assert.equal(gatesWithoutProject[1].id, 'node-test');

    // 2. 项目定义了 flow-rules.yml，覆盖其中一条并禁用另一条
    const projectYaml = `
version: 1
name: my-node-project
rules:
  - id: product.node-lint
    name: 项目专属 Lint 规则
    phase: verify
    command: pnpm lint:custom
  - id: product.node-test
    enabled: false
  - id: product.custom-e2e
    name: 端到端测试
    phase: verify
    command: pnpm test:e2e
`;
    fs.writeFileSync(path.join(tmp, 'flow-rules.yml'), projectYaml, 'utf8');

    const loadedWithProject = loadProjectRules(tmp);
    assert.ok(loadedWithProject);
    assert.equal(loadedWithProject._file, 'flow-rules.yml');
    // node-lint (覆盖) + node-test (覆盖为 disabled) + custom-e2e (新增) = 3
    assert.equal(loadedWithProject.rules.length, 3);

    const mergedGates = extractVerifyCommandGates(loadedWithProject, tmp);
    // node-test 被禁用，所以只有 node-lint 和 custom-e2e
    assert.equal(mergedGates.length, 2);
    assert.equal(mergedGates[0].id, 'node-lint');
    assert.equal(mergedGates[0].name, '项目专属 Lint 规则');
    assert.equal(mergedGates[0].rawCmd, 'pnpm lint:custom');
    assert.equal(mergedGates[1].id, 'custom-e2e');
    assert.equal(mergedGates[1].name, '端到端测试');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('rules-loader: supports JSONC in project.json without crashing faces.mjs', async () => {
  const { loadProjectRules } = await import(scriptUrl('rules-loader.mjs'));
  const { loadFaces } = await import(scriptUrl('faces.mjs'));

  const tmp = makeTmpDir('rules-jsonc-');
  try {
    const rulesDir = path.join(tmp, '.agents', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });

    // 模拟 rules init 生成的带 // 注释的 project.json
    const jsoncContent = `// 由 flow-kit rules init 生成
// 第二行注释
{
  /* 块级注释 */
  "version": 1,
  "faces": {
    "code": ["src/**"],
    "ui": ["web/**"]
  },
  "rules": [
    {
      "id": "product.custom-test",
      "name": "Custom Test",
      "phase": "verify",
      "assert": { "kind": "command", "args": { "run": "npm test" } }
    }
  ],
  "waivers": []
}
`;
    fs.writeFileSync(path.join(rulesDir, 'project.json'), jsoncContent, 'utf8');

    const loaded = loadProjectRules(tmp);
    assert.ok(loaded);
    assert.equal(loaded.version, 1);
    assert.equal(loaded.rules.length, 1);
    assert.equal(loaded.rules[0].id, 'product.custom-test');

    const faces = loadFaces(tmp);
    assert.equal(faces.configured, true);
    assert.deepEqual(faces.code, ['src/**']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('rules-loader: parseYamlSimple fails fast on lines missing colon instead of silent truncation', async () => {
  const { parseYamlSimple } = await import(scriptUrl('rules-loader.mjs'));

  const badYaml = `
version: 1
rules:
  - id: product.rule-one
    name: First
  corrupted_line_without_colon
  - id: product.rule-two
    name: Second
`;
  assert.throws(() => {
    parseYamlSimple(badYaml);
  }, /(?:语法错误|缩进错误)/);
});

// 审计 D35：栈规则层此前 fail-open（坏文件只打一行 stderr、形状错误全静默），
// 与项目层解析错误 fail-closed 不一致——栈层坏文件必须同样抛错，空项目文件仍合法。
test('rules-loader: corrupt or shape-wrong stack rules fail closed; empty project rules stays legal', async () => {
  const { loadProjectRules } = await import(scriptUrl('rules-loader.mjs'));

  const tmp = makeTmpDir();
  try {
    const rulesDir = path.join(tmp, '.agents', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });

    // 1. 语法坏掉的栈文件：解析失败必须抛（此前只 stderr 警告，门表静默变绿）
    fs.writeFileSync(path.join(rulesDir, 'stack.node.yml'), 'rules:\n  - id: product.build\n     bad indent here :\n  broken\n', 'utf8');
    assert.throws(() => loadProjectRules(tmp), /stack\.node\.yml/, '坏栈文件应 fail-closed');

    // 2. 形状错误（rules 非数组）：同样抛错（此前完全静默丢门）
    fs.rmSync(path.join(rulesDir, 'stack.node.yml'));
    fs.writeFileSync(path.join(rulesDir, 'stack.node.json'), '{"name":"node","rules":"not-an-array"}', 'utf8');
    assert.throws(() => loadProjectRules(tmp), /stack\.node\.json/, 'rules 非数组应 fail-closed');

    // 3. 顶层为数组的栈文件：不是映射，也抛错
    fs.writeFileSync(path.join(rulesDir, 'stack.node.json'), JSON.stringify([{ id: 'product.x' }]), 'utf8');
    assert.throws(() => loadProjectRules(tmp), /stack\.node\.json/, '顶层数组应 fail-closed');

    // 4. 空项目规则文件 = 有意留空，仍合法，栈层照常装载
    fs.writeFileSync(path.join(rulesDir, 'stack.node.json'), JSON.stringify({
      name: 'stack.node',
      rules: [{ id: 'product.node-lint', phase: 'verify', command: 'npm run lint' }],
    }), 'utf8');
    fs.writeFileSync(path.join(tmp, 'flow-rules.yml'), '', 'utf8');
    const loaded = loadProjectRules(tmp);
    assert.ok(loaded, '空项目文件不应返回 null');
    assert.deepEqual(loaded.rules.map((r) => r.id), ['product.node-lint']);

    // 5. 顶层为数组的项目文件：形状错误同样 fail-closed（此前静默 0 门）
    fs.writeFileSync(path.join(tmp, 'flow-rules.yml'), '- id: product.a\n- id: product.b\n', 'utf8');
    assert.throws(() => loadProjectRules(tmp), /flow-rules\.yml/, '列表形项目文件应 fail-closed');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
