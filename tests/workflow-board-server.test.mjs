import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseRunFile,
  runCard,
  activeRunsCount,
  safeRunPath,
  checkCsrf,
  isValidRunId,
  isValidGateName,
  handleBoardRequest,
} from '../templates/engine/.agents/scripts/workflow-board-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const INDEX_HTML = path.join(REPO, 'templates', 'engine', '.agents', 'board', 'index.html');

test('parseRunFile 解析与校验规则', () => {
  assert.equal(parseRunFile('not a json'), null, '非 JSON 字符串返回 null');
  assert.equal(parseRunFile(''), null, '空字符串返回 null');
  assert.equal(parseRunFile('[]'), null, '数组返回 null');
  assert.equal(parseRunFile('null'), null, 'null 返回 null');
  assert.equal(parseRunFile('{"foo":"bar"}'), null, '缺少 runId 返回 null');
  assert.equal(parseRunFile('{"runId":""}'), null, '空 runId 返回 null');
  assert.equal(parseRunFile('{"runId":123}'), null, '非字符串 runId 返回 null');

  const valid = parseRunFile('{"runId":"2026-11-21-test-run","stage":"implement"}');
  assert.ok(valid);
  assert.equal(valid.runId, '2026-11-21-test-run');
  assert.equal(valid.stage, 'implement');
});

test('runCard 产物、阶段流与退回路由投影', () => {
  const mockRun = {
    runId: '2026-11-21-feat-test',
    requirement: '实现 pipeline 看板测试',
    stage: 'fix',
    stopType: 'work-order',
    updatedAt: '2026-11-21T12:00:00.000Z',
    triage: { kind: 'feat', level: 'L2', module: 'board' },
    nextTarget: 'plan',
    docs: {
      entry: 'intents/2026-11-21-test.md',
      spec: 'specs/2026-11-21-test/spec.md',
      plan: 'plans/2026-11-21-test.md',
      apiDocs: ['api-docs/test.md'],
    },
    retries: { fix: 1 },
    workOrder: {
      id: 42,
      kind: 'fix',
      title: '修复门禁阻断',
      goal: '修复测试不通过项',
    },
    awaitConfirm: {
      doc: 'specs/2026-11-21-test/spec.md',
      points: '请确认测试范围',
      ledger: true,
    },
    gateFail: {
      gate: 'check-loop',
      exit: 1,
      hint: '闭环检验未通过',
    },
    events: [
      { type: 'run-created', t: '2026-11-21T11:50:00.000Z' },
      { type: 'route', from: 'fix', to: 'plan', attempt: 1, cap: 2, t: '2026-11-21T11:55:00.000Z' },
    ],
  };

  const card = runCard(mockRun);
  assert.equal(card.runId, '2026-11-21-feat-test');
  assert.equal(card.requirement, '实现 pipeline 看板测试');
  assert.equal(card.stage, 'fix');
  assert.equal(card.stopType, 'work-order');
  assert.equal(card.eventCount, 2);
  assert.equal(card.nextTarget, 'plan');

  // 退回指示器
  assert.ok(card.stageBar.includes('↩ 退回 plan（fix 1/2）'));
  assert.deepEqual(card.route, { to: 'plan', from: 'fix', attempt: 1, cap: 2 });

  // 产物投影
  assert.deepEqual(card.docs, mockRun.docs);
  assert.deepEqual(card.retries, { fix: 1 });

  // 关键字段投影
  assert.deepEqual(card.workOrder, {
    id: 42,
    kind: 'fix',
    title: '修复门禁阻断',
    goal: '修复测试不通过项',
  });
  assert.deepEqual(card.awaitConfirm, {
    doc: 'specs/2026-11-21-test/spec.md',
    points: '请确认测试范围',
    ledger: true,
  });
  assert.deepEqual(card.gateFail, {
    gate: 'check-loop',
    exit: 1,
    hint: '闭环检验未通过',
  });
});

test('runCard 缺省字段容错兜底', () => {
  const minimal = { runId: '2026-11-21-min' };
  const card = runCard(minimal);
  assert.equal(card.runId, '2026-11-21-min');
  assert.equal(card.requirement, '');
  assert.equal(card.stage, '');
  assert.equal(card.stopType, '');
  assert.equal(card.eventCount, 0);
  assert.equal(card.nextTarget, null);
  assert.equal(card.docs, null);
  assert.equal(card.route, null);
  assert.equal(card.workOrder, null);
  assert.equal(card.awaitConfirm, null);
  assert.equal(card.gateFail, null);
});

test('activeRunsCount 准确识别非终态流水线', () => {
  const runs = [
    { runId: 'r1', stopType: 'work-order' },
    { runId: 'r2', stopType: 'await-confirm' },
    { runId: 'r3', stopType: 'gate-fail' },
    { runId: 'r4', stopType: 'done' },
    { runId: 'r5', stopType: 'aborted' },
    { runId: 'r6', stopType: '' },
    null,
  ];

  assert.equal(activeRunsCount(runs), 3, '只有 work-order/await-confirm/gate-fail 等运行中态计入 active');
});

test('safeRunPath 白名单校验防穿越', () => {
  assert.equal(safeRunPath('../secret.json'), null);
  assert.equal(safeRunPath('../../etc/passwd.json'), null);
  assert.equal(safeRunPath('run.txt'), null);
  assert.equal(safeRunPath('run.js'), null);

  const safe = safeRunPath('2026-11-21-test.json');
  assert.ok(safe);
  assert.ok(safe.endsWith(path.join('pipeline-runs', '2026-11-21-test.json')));
});

test('Web 看板 index.html 阶段图、产物流与呼吸徽标静态结构检查', () => {
  assert.ok(fs.existsSync(INDEX_HTML), 'index.html 必须存在');
  const html = fs.readFileSync(INDEX_HTML, 'utf8');

  // 1. 顶部呼吸灯与徽标
  assert.ok(html.includes('id="runs-badge"'), '导航栏应包含 runs-badge 徽标');
  assert.ok(html.includes('badge-pulse'), '徽标样式应包含 badge-pulse');

  // 2. 抽屉 tab
  assert.ok(html.includes('data-tab="overview"'), '抽屉应包含 overview tab');
  assert.ok(html.includes('data-tab="artifacts"'), '抽屉应包含 artifacts tab');

  // 3. 阶段流图与产物标签 CSS
  assert.ok(html.includes('.stage-flow'), '应包含 .stage-flow 样式');
  assert.ok(html.includes('.sf-node'), '应包含 .sf-node 样式');
  assert.ok(html.includes('.sf-arrow'), '应包含 .sf-arrow 样式');
  assert.ok(html.includes('.route-pill'), '应包含 .route-pill 样式');
  assert.ok(html.includes('.art-tag'), '应包含 .art-tag 样式');

  // 4. JS 核心函数定义
  assert.ok(html.includes('function getStageSequence('), '应定义 getStageSequence');
  assert.ok(html.includes('function renderStageFlowHtml('), '应定义 renderStageFlowHtml');
  assert.ok(html.includes('function renderArtifactsHtml('), '应定义 renderArtifactsHtml');
  assert.ok(html.includes('function loadRunOverview('), '应定义 loadRunOverview');
  assert.ok(html.includes('function loadRunArtifacts('), '应定义 loadRunArtifacts');
  assert.ok(html.includes('data.activeRuns'), 'refreshBoard 中应处理 data.activeRuns');
});

test('checkCsrf Origin 与 Host 校验规则', () => {
  const port = 8933;
  // 无 origin / 无 referer（同源脚本、终端 curl 或非浏览器调用）-> 放行
  assert.equal(checkCsrf({ headers: {} }, port), true);

  // 本地 127.0.0.1 或 localhost 且端口匹配 -> 放行
  assert.equal(checkCsrf({ headers: { origin: 'http://127.0.0.1:8933' } }, port), true);
  assert.equal(checkCsrf({ headers: { origin: 'http://localhost:8933' } }, port), true);

  // VS Code / Cursor / Trae webview scheme -> 放行
  assert.equal(checkCsrf({ headers: { origin: 'vscode-webview://webview-panel' } }, port), true);

  // 跨端口或恶意域名 -> 拦截
  assert.equal(checkCsrf({ headers: { origin: 'http://127.0.0.1:9000' } }, port), false);
  assert.equal(checkCsrf({ headers: { origin: 'http://localhost:9000' } }, port), false);
  assert.equal(checkCsrf({ headers: { origin: 'http://evil.com' } }, port), false);
  assert.equal(checkCsrf({ headers: { origin: 'http://attacker.com:8933' } }, port), false);

  // Referer 兜底校验
  assert.equal(checkCsrf({ headers: { referer: 'http://127.0.0.1:8933/board' } }, port), true);
  assert.equal(checkCsrf({ headers: { referer: 'http://evil.com/phish' } }, port), false);
});

test('isValidRunId 与 isValidGateName 安全白名单校验', () => {
  // runId
  assert.equal(isValidRunId('2026-11-21-feat-test'), true);
  assert.equal(isValidRunId('run-123_abc'), true);
  assert.equal(isValidRunId(''), false);
  assert.equal(isValidRunId('../secret'), false);
  assert.equal(isValidRunId('a'.repeat(80)), false);
  assert.equal(isValidRunId('test;rm -rf'), false);

  // gate
  assert.equal(isValidGateName('check-loop'), true);
  assert.equal(isValidGateName('verify'), true);
  assert.equal(isValidGateName('verify-fast'), true);
  assert.equal(isValidGateName('check-local-gates'), true);
  assert.equal(isValidGateName('check-links'), true);
  assert.equal(isValidGateName(''), false);
  assert.equal(isValidGateName('rm-rf'), false);
  assert.equal(isValidGateName('curl'), false);
  assert.equal(isValidGateName('../../gate'), false);
});

test('Web 看板 index.html 交互动作面板与控制函数静态结构检查', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');

  // 1. 样式类
  assert.ok(html.includes('.act-panel'), '应包含 .act-panel 样式');
  assert.ok(html.includes('.act-title'), '应包含 .act-title 样式');
  assert.ok(html.includes('.act-btn'), '应包含 .act-btn 样式');
  assert.ok(html.includes('.act-input'), '应包含 .act-input 样式');
  assert.ok(html.includes('.act-log'), '应包含 .act-log 样式');

  // 2. JS 核心控制函数
  assert.ok(html.includes('function renderActionPanelHtml('), '应定义 renderActionPanelHtml');
  assert.ok(html.includes('async function executeNext('), '应定义 executeNext');
  assert.ok(html.includes('async function executeRerunGate('), '应定义 executeRerunGate');
  assert.ok(html.includes('async function executeAbort('), '应定义 executeAbort');
  assert.ok(html.includes('async function fillGitChangedFiles('), '应定义 fillGitChangedFiles');
  assert.ok(html.includes('function copyCmd('), '应定义 copyCmd');
});

test('VS Code tasks.json 模板完整性与任务配置结构检查', () => {
  const TASKS_PATH = path.join(REPO, 'templates', 'engine', '.vscode', 'tasks.json');
  assert.ok(fs.existsSync(TASKS_PATH), 'templates/engine/.vscode/tasks.json 必须存在');

  const content = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
  assert.equal(content.version, '2.0.0');
  assert.ok(Array.isArray(content.tasks), 'tasks 必须是数组');

  const labels = content.tasks.map((t) => t.label);
  assert.ok(labels.some((l) => l.includes('打开流程看板')), '应包含 打开流程看板 任务');
  assert.ok(labels.some((l) => l.includes('流水线推进下一步')), '应包含 流水线推进下一步 任务');
  assert.ok(labels.some((l) => l.includes('运行本地全量门禁')), '应包含 运行本地全量门禁 任务');
  assert.ok(labels.some((l) => l.includes('流水线状态与排查')), '应包含 流水线状态与排查 任务');
  assert.ok(labels.some((l) => l.includes('检查闭环健康度')), '应包含 检查闭环健康度 任务');
});

// 端点级测试（审查遗留批 2026-11-23）：用内存 http 挂真实请求处理器（import 不 listen，isMain 守卫不变）。
// 只测不 spawn 子进程的校验分支（405/403/400/404），不触发 pipeline-run / 门禁脚本执行。
// Host/Origin 头须与服务端固定的 PORT 常量（默认 8933）一致才过 Host/CSRF 校验，与实际 socket 端口无关，
// 故用裸 http.request 显式置头（fetch 会丢弃受限的 Host 头）。
test('pipeline 控制端点: /api/pipeline/next 与 /api/pipeline/gate 的校验分支', async () => {
  const server = http.createServer(handleBoardRequest);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const socketPort = server.address().port;
  const srvHost = `127.0.0.1:8933`; // 服务端 Host 校验与 checkCsrf 白名单都按模块常量 PORT=8933 判定

  const request = (method, pathname, body, headers = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: socketPort, method, path: pathname, headers: { Host: srvHost, ...headers } },
        (res) => {
          let raw = '';
          res.on('data', (d) => { raw += d; });
          res.on('end', () => {
            let json = null;
            try { json = JSON.parse(raw); } catch { /* 非 JSON 响应体原样忽略 */ }
            resolve({ status: res.statusCode, json });
          });
        },
      );
      req.on('error', reject);
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    });

  const postJson = (pathname, body, extraHeaders = {}) =>
    request('POST', pathname, body, { 'Content-Type': 'application/json', Origin: `http://${srvHost}`, ...extraHeaders });

  try {
    // 方法与 CSRF（两控制端点各一条）
    const badMethod = await request('GET', '/api/pipeline/next');
    assert.equal(badMethod.status, 405);
    const badOrigin = await postJson('/api/pipeline/next', { gate: 'verify' }, { Origin: 'http://evil.example' });
    assert.equal(badOrigin.status, 403);

    // /api/pipeline/next：非法 gate 名 400（审查遗留批 2026-11-23：不再静默丢弃后全量跑 verify）
    const badGateNext = await postJson('/api/pipeline/next', { gate: 'not-a-gate' });
    assert.equal(badGateNext.status, 400);
    assert.match(badGateNext.json.error, /非法的门禁名称/);
    assert.match(badGateNext.json.error, /not-a-gate/);

    // /api/pipeline/gate：非法 gate 名 400（对齐行为）；合法格式但脚本缺失 404
    const badGate = await postJson('/api/pipeline/gate', { gate: 'drop-table' });
    assert.equal(badGate.status, 400);
    assert.match(badGate.json.error, /非法的门禁名称/);
    const missingGate = await postJson('/api/pipeline/gate', { gate: 'verify-nonexistent' });
    assert.equal(missingGate.status, 404);
    assert.match(missingGate.json.error, /门禁脚本不存在/);
  } finally {
    server.close();
  }
});
