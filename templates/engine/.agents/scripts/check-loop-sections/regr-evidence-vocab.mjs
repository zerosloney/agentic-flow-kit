// regr-evidence-vocab — incident「防复发验证」证据词表（单源，配置驱动）。
//
// 门的是「落到可复跑的验证资产」，不是猜具体测试名：命中任一形态即视为有自动化/清单落点。
// 词表沿革：
//   - 2026-10-09 首版：引擎 .test.mjs / 后端 xunit / 前端测试目录 / 回归清单 / 冒烟 / 测试命令。
//   - 2026-10-28 补分片：regression-checklist.d/<YYYY-MM>.md（append-only 分片）——此前只认主台账
//     workflow/regression-checklist.md，只引分片的 incident 被误判（2026-10-27-aggrid-hover-popconfirm 实证）。
//   - 2026-11-16 补仓库验证脚本：scripts/verify/**/*.mjs 是 kit `verify` 门实际执行的验证资产族
//     （business UI 断言、契约检查等），却不在此词表——incident 引用
//     `scripts/verify/business/verify-order-filters-ui.mjs` 仍被判「回归证据缺失」
//     （2026-11-16 实证）。词表漏项 → 假阳性硬阻断，且 closed 文档已无补登记出口
//     （confirm-doc --reconfirm 仅受理 approved），故本次一并补上。
//   - 2026-11-24 配置驱动：基座只留跨栈形态（测试目录/测试文件后缀/清单/冒烟/引擎脚本），
//     测试命令按 .agents/config/engine.json 的 options.stacks 追加；product-gates*.json 与
//     commit-check.config.json 的命令首段也纳入。配置读取失败一律回退基座（fail-open）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = process.env.FLOW_KIT_PROJECT_ROOT
  || process.env.CHECK_LOOP_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** 栈 → 测试命令正则（re）与规范命令（cmds，供收敛对账白名单复用）。 */
export const STACK_TEST_COMMANDS = {
  dotnet: { re: 'dotnet\\s+test', cmds: ['dotnet test'] },
  node: { re: 'npm\\s+(?:run\\s+)?test', cmds: ['npm test', 'npm run test'] },
  typescript: { re: 'npm\\s+(?:run\\s+)?test', cmds: ['npm test', 'npm run test'] },
  rust: { re: 'cargo\\s+test', cmds: ['cargo test'] },
  go: { re: 'go\\s+test', cmds: ['go test'] },
  java: { re: '(?:mvn|gradlew?)\\s+[^\\n]*test', cmds: ['mvn test', 'gradle test', 'gradlew test'] },
  python: { re: '(?:python\\s+-m\\s+)?pytest', cmds: ['pytest', 'python -m pytest'] },
  cpp: { re: 'ctest', cmds: ['ctest'] },
};

// 跨栈基座：任何项目都认的验证资产形态。
const BASE_PARTS = [
  '\\.test\\.mjs',
  '(?:^|[\\/\\w.-])(?:tests?|__tests__)/',
  '\\w+Tests?\\.(?:cs|java|kt)',
  '_test\\.(?:go|py|rs)',
  'scripts/verify/[^\\s]*\\.mjs',
  'workflow/regression-checklist(?:\\.d\\/|\\.md)',
  'regression-smoke',
  'run-tests',
];

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const readJson = (abs) => {
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
};

const readdirOrEmpty = (abs) => {
  try {
    return fs.readdirSync(abs);
  } catch {
    return [];
  }
};

const firstToken = (cmd) => String(cmd || '').trim().split(/\s+/)[0] || '';

/** engine.json options.stacks（缺省 []；读取失败按空处理）。 */
const engineStacks = (root) => {
  const cfg = readJson(path.join(root, '.agents', 'config', 'engine.json'));
  const stacks = cfg && cfg.options && Array.isArray(cfg.options.stacks) ? cfg.options.stacks : [];
  return stacks.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim().toLowerCase());
};

/** product-gates*.json 的 gates[].cmd（通配族与 verify.mjs 同口径）。 */
const productGateCommands = (root) => {
  const dir = path.join(root, '.agents', 'config');
  const out = [];
  for (const name of readdirOrEmpty(dir)) {
    if (name !== 'product-gates.json' && !/^product-gates\..+\.json$/.test(name)) continue;
    const gate = readJson(path.join(dir, name));
    for (const entry of (gate && Array.isArray(gate.gates) ? gate.gates : [])) {
      if (entry && typeof entry.cmd === 'string') out.push(entry.cmd);
    }
  }
  return out;
};

/** commit-check.config.json 的 pushTests/builds 命令（数组项可为字符串或 {command}）。 */
const commitCheckCommands = (root) => {
  const cfg = readJson(path.join(root, '.agents', 'hooks', 'commit-check.config.json'));
  if (!cfg) return [];
  const out = [];
  for (const key of ['pushTests', 'builds']) {
    for (const entry of (Array.isArray(cfg[key]) ? cfg[key] : [])) {
      if (typeof entry === 'string') out.push(entry);
      else if (entry && typeof entry.command === 'string') out.push(entry.command);
    }
  }
  return out;
};

/** 由基座 + 项目配置生成证据词表正则。root 缺省取本模块所在项目根。 */
export function buildRegrEvidenceRe(root = ROOT) {
  const parts = BASE_PARTS.slice();
  for (const stack of engineStacks(root)) {
    const mapping = STACK_TEST_COMMANDS[stack];
    if (mapping) parts.push(mapping.re);
  }
  const tokens = [...new Set(
    [...productGateCommands(root), ...commitCheckCommands(root)]
      .map(firstToken)
      .filter(Boolean)
      .map(escapeRe),
  )].sort((a, b) => b.length - a.length);
  parts.push(...tokens);
  return new RegExp(parts.join('|'));
}

/** 现有调用方（s03x）沿用的预计算词表。 */
export const REGR_EVIDENCE_RE = buildRegrEvidenceRe();
