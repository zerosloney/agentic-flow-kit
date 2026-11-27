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
  safeGitPath,
  checkCsrf,
  isValidRunId,
  isValidGateName,
  isValidArenaTopic,
  handleBoardRequest,
  DEFAULT_WATCHDOG_CONFIG,
  detectRunWatchdogAlert,
  inspectWatchdog,
  executeCircuitBreak,
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

test('safeGitPath 白名单校验防穿越与参数注入', () => {
  // 合法相对路径与缺省路径
  assert.equal(safeGitPath(''), '', '空路径表示 diff 全仓');
  assert.equal(safeGitPath('package.json', REPO), 'package.json');
  assert.equal(safeGitPath('templates/engine/.agents/board/index.html', REPO), 'templates/engine/.agents/board/index.html');
  assert.equal(safeGitPath('templates\\engine\\.agents\\board\\index.html', REPO), 'templates/engine/.agents/board/index.html');

  // 防穿越与注入
  assert.equal(safeGitPath('../../secret.txt', REPO), null, '禁止上级目录穿越');
  assert.equal(safeGitPath('/etc/passwd', REPO), null, '禁止绝对路径');
  assert.equal(safeGitPath('-p', REPO), null, '禁止以连字符开头的参数注入');
  assert.equal(safeGitPath('--output=bad', REPO), null, '禁止参数注入');
  assert.equal(safeGitPath('foo\0bar', REPO), null, '禁止包含空字符');
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
  assert.ok(html.includes('id="view-arena"'), '应包含 view-arena 导航按钮');
  assert.ok(html.includes('id="arena-view"'), '应包含 arena-view 容器');
  assert.ok(html.includes('.arm-card'), '应包含 .arm-card 样式');
  assert.ok(html.includes('.rubric-bars'), '应包含 .rubric-bars 样式');

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
  assert.ok(html.includes('.chip-preset'), '应包含 .chip-preset 快捷评语样式');
  assert.ok(html.includes('.diff-box'), '应包含 .diff-box Git Diff 折叠容器样式');
  assert.ok(html.includes('.diff-stat'), '应包含 .diff-stat 变更统计样式');

  // 2. JS 核心控制函数
  assert.ok(html.includes('function renderActionPanelHtml('), '应定义 renderActionPanelHtml');
  assert.ok(html.includes('async function executeNext('), '应定义 executeNext');
  assert.ok(html.includes('async function executeRerunGate('), '应定义 executeRerunGate');
  assert.ok(html.includes('async function executeAbort('), '应定义 executeAbort');
  assert.ok(html.includes('async function fillGitChangedFiles('), '应定义 fillGitChangedFiles');
  assert.ok(html.includes('function copyCmd('), '应定义 copyCmd');
  assert.ok(html.includes('function setDelegatedInput('), '应定义 setDelegatedInput');
  assert.ok(html.includes('async function previewConfirmDoc('), '应定义 previewConfirmDoc');
  assert.ok(html.includes('function formatGitDiffHtml('), '应定义 formatGitDiffHtml');
  assert.ok(html.includes('async function toggleGitDiffBox('), '应定义 toggleGitDiffBox');
  assert.ok(html.includes('async function executeApprove('), '应定义 executeApprove');
  assert.ok(html.includes('async function executeReject('), '应定义 executeReject');
  assert.ok(html.includes('function copyApprovalCmd('), '应定义 copyApprovalCmd');

  // 3. 核心人件门审批 DOM 元素标记
  assert.ok(html.includes('id="act-delegated-input"'), '应包含审批原话输入框 #act-delegated-input');
  assert.ok(html.includes('id="act-diff-box"'), '应包含 Diff 展示容器 #act-diff-box');

  // 4. DAG 阶段流转状态机拓扑视图静态结构检查 (方案2)
  assert.ok(html.includes('.dag-container'), '应包含 .dag-container 样式');
  assert.ok(html.includes('.dag-svg'), '应包含 .dag-svg 样式');
  assert.ok(html.includes('.dag-toolbar'), '应包含 .dag-toolbar 样式');
  assert.ok(html.includes('.dag-inspector'), '应包含 .dag-inspector 样式');
  assert.ok(html.includes('data-tab="topology"'), '应包含阶段拓扑 Tab 按钮');
  assert.ok(html.includes('function renderDagSvg('), '应定义 renderDagSvg');
  assert.ok(html.includes('function loadRunTopology('), '应定义 loadRunTopology');
  assert.ok(html.includes('function getPipelineDagStages('), '应定义 getPipelineDagStages');
  assert.ok(html.includes('function inspectDagNode('), '应定义 inspectDagNode');
  assert.ok(html.includes('function renderDagNodeDetailHtml('), '应定义 renderDagNodeDetailHtml');
  assert.ok(html.includes('const STAGE_META ='), '应定义 STAGE_META 元数据映射');

  // 5. 看门狗巡检与熔断状态机静态结构检查 (方案3)
  assert.ok(html.includes('.watchdog-indicator'), '应包含 .watchdog-indicator 样式');
  assert.ok(html.includes('.watchdog-banner'), '应包含 .watchdog-banner 样式');
  assert.ok(html.includes('.dag-node.stalled'), '应包含 .dag-node.stalled 停滞节点高亮样式');
  assert.ok(html.includes('.stall-chip'), '应包含 .stall-chip 卡片预警徽标样式');
  assert.ok(html.includes('id="watchdog-indicator"'), '应包含看门狗健康状态徽标 #watchdog-indicator');
  assert.ok(html.includes('id="watchdog-banner"'), '应包含看门狗全局告警横幅 #watchdog-banner');
  assert.ok(html.includes('async function refreshWatchdog('), '应定义 refreshWatchdog');
  assert.ok(html.includes('function renderWatchdogIndicator('), '应定义 renderWatchdogIndicator');
  assert.ok(html.includes('function renderWatchdogBanner('), '应定义 renderWatchdogBanner');
  assert.ok(html.includes('async function triggerCircuitBreak('), '应定义 triggerCircuitBreak');
  assert.ok(html.includes('function openRunDrawerById('), '应定义 openRunDrawerById');
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

test('git 端点: /api/git/diff 的校验分支与工作区 diff 输出', async () => {
  const server = http.createServer(handleBoardRequest);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const socketPort = server.address().port;
  const srvHost = `127.0.0.1:8933`;

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

  try {
    // 1. 非法请求方式 POST /api/git/diff -> 405
    const badMethod = await request('POST', '/api/git/diff');
    assert.equal(badMethod.status, 405);

    // 2. 路径穿越与参数注入校验 -> 400
    const traversal = await request('GET', '/api/git/diff?file=../../secret');
    assert.equal(traversal.status, 400);
    assert.match(traversal.json.error, /路径不合法/);

    const flagInject = await request('GET', '/api/git/diff?file=-p');
    assert.equal(flagInject.status, 400);
    assert.match(flagInject.json.error, /路径不合法/);

    // 3. 全局 diff 查询 -> 200
    const fullDiff = await request('GET', '/api/git/diff');
    assert.equal(fullDiff.status, 200);
    assert.equal(fullDiff.json.ok, true);
    assert.equal(typeof fullDiff.json.diff, 'string');

    // 4. 单文件 diff 查询 -> 200
    const fileDiff = await request('GET', '/api/git/diff?file=package.json');
    assert.equal(fileDiff.status, 200);
    assert.equal(fileDiff.json.ok, true);
    assert.equal(fileDiff.json.file, 'package.json');
    assert.equal(typeof fileDiff.json.diff, 'string');
  } finally {
    server.close();
  }
});

test('pipeline 配置端点: /api/pipeline/config 的校验与结构读取', async () => {
  const server = http.createServer(handleBoardRequest);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const socketPort = server.address().port;
  const srvHost = `127.0.0.1:8933`;

  const request = (method, pathname, body, headers = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: socketPort, method, path: pathname, headers: { Host: srvHost, ...headers } },
        (res) => {
          let raw = '';
          res.on('data', (d) => { raw += d; });
          res.on('end', () => {
            let json = null;
            try { json = JSON.parse(raw); } catch { /* ignore */ }
            resolve({ status: res.statusCode, json });
          });
        },
      );
      req.on('error', reject);
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    });

  try {
    // 1. 非法请求方式 POST /api/pipeline/config -> 405
    const badMethod = await request('POST', '/api/pipeline/config');
    assert.equal(badMethod.status, 405);

    // 2. 正常获取 pipeline.json 配置 -> 200
    const res = await request('GET', '/api/pipeline/config');
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.ok(Array.isArray(res.json.config.stages), 'config.stages 必须为数组');
    assert.ok(res.json.config.stages.includes('verify'), 'config.stages 应包含 verify 阶段');
    assert.ok(res.json.config.stageArtifacts, '应包含 stageArtifacts 契约映射');
    assert.ok(res.json.config.onFail, '应包含 onFail 失败路由配置');
  } finally {
    server.close();
  }
});

test('detectRunWatchdogAlert 与 inspectWatchdog 智能巡检与死锁检测规则', () => {
  const now = 1732600000000;

  // 1. 终态流水线不告警
  assert.equal(detectRunWatchdogAlert({ runId: 'r1', stopType: 'done', updatedAt: new Date(now - 3600000).toISOString() }, { now }), null);
  assert.equal(detectRunWatchdogAlert({ runId: 'r2', stopType: 'aborted', updatedAt: new Date(now - 3600000).toISOString() }, { now }), null);

  // 2. 正常运行中，未超时 -> null
  const normalRun = {
    runId: 'r3',
    stage: 'implement',
    stopType: 'work-order',
    updatedAt: new Date(now - 2 * 60 * 1000).toISOString(),
  };
  assert.equal(detectRunWatchdogAlert(normalRun, { now }), null);

  // 3. 超时停滞预警 (>= 8 分钟)
  const warnRun = {
    runId: 'r4',
    stage: 'implement',
    stopType: 'work-order',
    updatedAt: new Date(now - 10 * 60 * 1000).toISOString(),
  };
  const warnAlert = detectRunWatchdogAlert(warnRun, { now });
  assert.ok(warnAlert);
  assert.equal(warnAlert.type, 'timeout');
  assert.equal(warnAlert.severity, 'warning');

  // 4. 超时严重停滞 (>= 15 分钟)
  const timeoutRun = {
    runId: 'r5',
    stage: 'verify',
    stopType: 'gate-fail',
    updatedAt: new Date(now - 20 * 60 * 1000).toISOString(),
  };
  const timeoutAlert = detectRunWatchdogAlert(timeoutRun, { now });
  assert.ok(timeoutAlert);
  assert.equal(timeoutAlert.type, 'timeout');
  assert.equal(timeoutAlert.severity, 'critical');

  // 5. 重试触顶 (retry cap exhausted)
  const cappedRun = {
    runId: 'r6',
    stage: 'verify',
    stopType: 'gate-fail',
    route: { from: 'verify', to: 'implement', attempt: 3, cap: 3 },
    updatedAt: new Date(now - 1000).toISOString(),
  };
  const cappedAlert = detectRunWatchdogAlert(cappedRun, { now });
  assert.ok(cappedAlert);
  assert.equal(cappedAlert.type, 'retry_cap');
  assert.equal(cappedAlert.severity, 'critical');

  // 6. 门禁连续同质报错空转震荡 (loop oscillation: 3 consecutive identical gate fails)
  const oscillatingRun = {
    runId: 'r7',
    stage: 'verify',
    stopType: 'gate-fail',
    events: [
      { type: 'gate', gate: 'unit-test', exit: 1 },
      { type: 'gate', gate: 'unit-test', exit: 1 },
      { type: 'gate', gate: 'unit-test', exit: 1 },
    ],
    updatedAt: new Date(now - 1000).toISOString(),
  };
  const oscAlert = detectRunWatchdogAlert(oscillatingRun, { now });
  assert.ok(oscAlert);
  assert.equal(oscAlert.type, 'loop_oscillation');
  assert.equal(oscAlert.severity, 'critical');

  // 7. 已被熔断的任务
  const cbRun = {
    runId: 'r8',
    stage: 'verify',
    circuitBreak: { at: new Date(now).toISOString(), reason: 'manual test' },
    updatedAt: new Date(now - 1000).toISOString(),
  };
  const cbAlert = detectRunWatchdogAlert(cbRun, { now });
  assert.ok(cbAlert);
  assert.equal(cbAlert.type, 'circuit_break');
  assert.equal(cbAlert.severity, 'critical');

  // 8. inspectWatchdog 全局巡检聚合
  const inspection = inspectWatchdog([normalRun, warnRun, cappedRun], { now, root: REPO });
  assert.equal(inspection.ok, true);
  assert.equal(inspection.health, 'critical');
  assert.equal(inspection.activeRuns, 3);
  assert.equal(inspection.stalledRuns, 2);
  assert.equal(inspection.criticalAlerts, 1);
  assert.equal(inspection.warningAlerts, 1);
  assert.equal(inspection.alerts.length, 2);
});

test('executeCircuitBreak 原子熔断状态变更', async () => {
  const tmpRoot = path.join(REPO, '.flow-kit-test-tmp-wd-' + Date.now());
  const runsDir = path.join(tmpRoot, '.agents', 'cache', 'pipeline-runs');
  fs.mkdirSync(runsDir, { recursive: true });

  const testRunId = '2026-11-26-wd-test';
  const testRunFile = path.join(runsDir, `${testRunId}.json`);
  const initialData = {
    runId: testRunId,
    requirement: '看门狗熔断测试',
    stage: 'verify',
    stopType: 'gate-fail',
    events: [{ type: 'gate', gate: 'check', exit: 1 }],
  };
  fs.writeFileSync(testRunFile, JSON.stringify(initialData, null, 2), 'utf8');

  try {
    const res = await executeCircuitBreak(testRunId, {
      root: tmpRoot,
      reason: '死锁超时熔断',
      by: 'test_runner',
      skipExec: true,
    });

    assert.equal(res.ok, true);
    assert.equal(res.runId, testRunId);
    assert.equal(res.circuitBreak.reason, '死锁超时熔断');
    assert.equal(res.circuitBreak.by, 'test_runner');

    // 检查落盘文件内容
    const updated = JSON.parse(fs.readFileSync(testRunFile, 'utf8'));
    assert.equal(updated.stopType, 'aborted');
    assert.ok(updated.circuitBreak);
    assert.equal(updated.circuitBreak.reason, '死锁超时熔断');
    const lastEv = updated.events[updated.events.length - 1];
    assert.equal(lastEv.type, 'circuit-break');
    assert.equal(lastEv.reason, '死锁超时熔断');

    // 再次对同一任务重复熔断应平稳幂等或更新
    const res2 = await executeCircuitBreak(testRunId, {
      root: tmpRoot,
      reason: '二次熔断测试',
      skipExec: true,
    });
    assert.equal(res2.ok, true);

    // 对不存在的任务熔断应抛出友好错误
    await assert.rejects(
      executeCircuitBreak('non-existent-run', { root: tmpRoot, skipExec: true }),
      /找不到/
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test('watchdog 端点: /api/watchdog/status 与 /api/watchdog/circuit-break 的校验与熔断执行', async () => {
  const server = http.createServer(handleBoardRequest);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const socketPort = server.address().port;
  const srvHost = `127.0.0.1:8933`;

  const request = (method, pathname, body, headers = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: socketPort, method, path: pathname, headers: { Host: srvHost, ...headers } },
        (res) => {
          let raw = '';
          res.on('data', (d) => { raw += d; });
          res.on('end', () => {
            let json = null;
            try { json = JSON.parse(raw); } catch { /* ignore */ }
            resolve({ status: res.statusCode, json });
          });
        },
      );
      req.on('error', reject);
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    });

  try {
    // 1. /api/watchdog/status 仅接受 GET
    const badStatusMethod = await request('POST', '/api/watchdog/status');
    assert.equal(badStatusMethod.status, 405);

    // 2. GET /api/watchdog/status 获取巡检状态
    const statusRes = await request('GET', '/api/watchdog/status');
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.json.ok, true);
    assert.ok(['ok', 'warning', 'critical'].includes(statusRes.json.health));
    assert.ok(Array.isArray(statusRes.json.alerts));
    assert.equal(typeof statusRes.json.activeRuns, 'number');

    // 3. /api/watchdog/circuit-break 仅接受 POST
    const badCbMethod = await request('GET', '/api/watchdog/circuit-break');
    assert.equal(badCbMethod.status, 405);

    // 4. POST /api/watchdog/circuit-break CSRF 拦截
    const csrfFail = await request('POST', '/api/watchdog/circuit-break', { runId: '2026-11-21-test' }, { Origin: 'http://malicious.site' });
    assert.equal(csrfFail.status, 403);
    assert.match(csrfFail.json.error, /CSRF/);

    // 5. POST /api/watchdog/circuit-break 缺少或非法 runId
    const badRunId = await request('POST', '/api/watchdog/circuit-break', { runId: '../../etc/bad' }, { Origin: `http://${srvHost}` });
    assert.equal(badRunId.status, 400);
    assert.match(badRunId.json.error, /runId/);

    const emptyRunId = await request('POST', '/api/watchdog/circuit-break', {}, { Origin: `http://${srvHost}` });
    assert.equal(emptyRunId.status, 400);

    // 6. POST /api/watchdog/circuit-break 不存在的合法 runId -> 404
    const notFound = await request('POST', '/api/watchdog/circuit-break', { runId: '2026-99-99-non-existent' }, { Origin: `http://${srvHost}` });
    assert.equal(notFound.status, 404);
  } finally {
    server.close();
  }
});

test('isValidArenaTopic 校验器', () => {
  assert.equal(isValidArenaTopic('perf-opt'), true);
  assert.equal(isValidArenaTopic('plan_a'), true);
  assert.equal(isValidArenaTopic('arm123'), true);

  assert.equal(isValidArenaTopic('../bad'), false);
  assert.equal(isValidArenaTopic('topic/sub'), false);
  assert.equal(isValidArenaTopic(''), false);
  assert.equal(isValidArenaTopic(null), false);
  assert.equal(isValidArenaTopic(undefined), false);
  assert.equal(isValidArenaTopic(123), false);
});

test('arena 与 eval 端点: topics/status/report/eval/adopt/cleanup/benchmarks 校验与处理', async () => {
  const server = http.createServer(handleBoardRequest);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const socketPort = server.address().port;
  const srvHost = `127.0.0.1:8933`;

  const request = (method, pathname, body, headers = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: socketPort, method, path: pathname, headers: { Host: srvHost, ...headers } },
        (res) => {
          let raw = '';
          res.on('data', (d) => { raw += d; });
          res.on('end', () => {
            let json = null;
            try { json = JSON.parse(raw); } catch { /* ignore */ }
            resolve({ status: res.statusCode, json });
          });
        },
      );
      req.on('error', reject);
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    });

  try {
    // 1. GET /api/arena/topics 正常返回主题列表
    const topicsRes = await request('GET', '/api/arena/topics');
    assert.equal(topicsRes.status, 200);
    assert.equal(topicsRes.json.ok, true);
    assert.ok(Array.isArray(topicsRes.json.topics));

    // 2. GET /api/arena/status 参数与存在性校验
    const badStatusParam = await request('GET', '/api/arena/status');
    assert.equal(badStatusParam.status, 400);

    const nonExistentStatus = await request('GET', '/api/arena/status?topic=non-existent-topic');
    assert.equal(nonExistentStatus.status, 404);

    // 3. GET /api/arena/report 参数与存在性校验
    const badReportParam = await request('GET', '/api/arena/report');
    assert.equal(badReportParam.status, 400);

    const nonExistentReport = await request('GET', '/api/arena/report?topic=non-existent-topic');
    assert.equal(nonExistentReport.status, 404);

    // 4. POST /api/arena/eval CSRF、参数与不存在校验
    const evalBadMethod = await request('GET', '/api/arena/eval');
    assert.equal(evalBadMethod.status, 405);

    const evalCsrf = await request('POST', '/api/arena/eval', { topic: 'test' }, { Origin: 'http://malicious.org' });
    assert.equal(evalCsrf.status, 403);

    const evalBadTopic = await request('POST', '/api/arena/eval', { topic: '../bad' }, { Origin: `http://${srvHost}` });
    assert.equal(evalBadTopic.status, 400);

    const evalNotFound = await request('POST', '/api/arena/eval', { topic: 'non-existent-topic' }, { Origin: `http://${srvHost}` });
    assert.equal(evalNotFound.status, 404);

    // 5. POST /api/arena/adopt CSRF 与参数校验
    const adoptBadMethod = await request('GET', '/api/arena/adopt');
    assert.equal(adoptBadMethod.status, 405);

    const adoptCsrf = await request('POST', '/api/arena/adopt', { topic: 'test', arm: 'arm-a' }, { Origin: 'http://evil.com' });
    assert.equal(adoptCsrf.status, 403);

    const adoptBadParams = await request('POST', '/api/arena/adopt', { topic: 'test' }, { Origin: `http://${srvHost}` });
    assert.equal(adoptBadParams.status, 400);

    // 6. POST /api/arena/cleanup CSRF 与参数校验
    const cleanupBadMethod = await request('GET', '/api/arena/cleanup');
    assert.equal(cleanupBadMethod.status, 405);

    const cleanupCsrf = await request('POST', '/api/arena/cleanup', { topic: 'test' }, { Origin: 'http://evil.com' });
    assert.equal(cleanupCsrf.status, 403);

    const cleanupBadTopic = await request('POST', '/api/arena/cleanup', { topic: '' }, { Origin: `http://${srvHost}` });
    assert.equal(cleanupBadTopic.status, 400);

    // 7. GET /api/eval/benchmarks
    const bmRes = await request('GET', '/api/eval/benchmarks');
    assert.equal(bmRes.status, 200);
    assert.equal(bmRes.json.ok, true);
    assert.ok(Array.isArray(bmRes.json.results));
  } finally {
    server.close();
  }
});
