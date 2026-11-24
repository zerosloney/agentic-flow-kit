// adapters — 旧配置 → rules 模型投影（v1 兼容层）。
// 旧文件仍是权威：`rules check` 与旧门禁跑同一批判定；对拍测试保证判定一致。
// 未覆盖项显式登记在 unsupported（不静默丢弃）——v2 随门禁改造逐个迁入。
import { readRulesFile } from './model.mjs';

const arr = (v) => (Array.isArray(v) ? v : []);
const msg = (zh) => ({ zh, en: zh });

/** 项目面配置 → faces（与 faces.mjs 同口径）。 */
function adaptFaces(root) {
  const data = readRulesFile(root, '.agents/config/project-faces.json');
  if (!data) return {};
  return {
    ui: arr(data.ui),
    code: arr(data.code),
    tests: arr(data.tests),
    data: arr(data.data),
  };
}

/** 架构红线：forbidden → content；catchRequires → require；noNavigationProperties 暂由原门执行。 */
function adaptArchitecture(root, rules, unsupported) {
  const data = readRulesFile(root, '.agents/hooks/architecture-redlines.json');
  if (!data) return;
  for (const r of arr(data.forbidden)) {
    rules.push({
      id: `arch.${r.id}`,
      face: 'code',
      phase: 'pre-commit',
      severity: 'block',
      scope: 'repo',
      assert: {
        kind: 'content',
        args: {
          targets: arr(r.targets),
          ext: r.ext,
          contains: arr(r.contains),
          matches: arr(r.matches),
          unless: r.unless,
          exclude: arr(r.exclude),
          allow: arr(r.allow),
          optional: r.optional === true,
          once: r.once === true,
        },
      },
      message: msg(r.message),
    });
  }
  for (const r of arr(data.catchRequires)) {
    rules.push({
      id: `arch.catch.${r.id}`,
      face: 'code',
      phase: 'pre-commit',
      severity: 'block',
      scope: 'repo',
      assert: {
        kind: 'require',
        args: {
          files: arr(r.files),
          trigger: r.catch,
          require: r.require,
          exclude: arr(r.exclude),
          optional: r.optional === true,
        },
      },
      message: msg(r.message),
    });
  }
  const nav = arr(data.noNavigationProperties);
  for (const r of nav) {
    rules.push({
      id: `arch.nav.${r.id}`,
      face: 'code',
      phase: 'pre-commit',
      severity: 'block',
      scope: 'repo',
      assert: {
        kind: 'navProperties',
        args: { dir: r.dir, extraTypeNames: arr(r.extraTypeNames), optional: r.optional === true },
      },
      message: msg(r.message),
    });
  }
}

/** 删除守卫：scan[] + allowlist 精确比对 → inventory。 */
function adaptDeleteGuard(root, rules) {
  const data = readRulesFile(root, '.agents/hooks/delete-guard.json');
  if (!data || !arr(data.scan).length) return;
  rules.push({
    id: 'delete.call-sites',
    face: 'code',
    phase: 'pre-commit',
    severity: 'block',
    scope: 'repo',
    assert: {
      kind: 'inventory',
      args: { scan: arr(data.scan), baseline: '.agents/hooks/delete-guard-allowlist.txt' },
    },
    message: msg('删除调用点与 .agents/hooks/delete-guard-allowlist.txt 不一致'),
  });
}

/** 审计字段：diff 新增行手写受保护字段 → content(scope=diff)。 */
function adaptAuditFields(root, rules) {
  const data = readRulesFile(root, '.agents/hooks/audit-fields.json');
  if (!data || !arr(data.fields).length) return;
  const alt = arr(data.fields).join('|');
  const ext = arr(data.ext).length ? arr(data.ext) : ['.cs'];
  rules.push({
    id: 'audit.protected-fields',
    face: 'code',
    phase: 'pre-commit',
    severity: 'block',
    scope: 'diff',
    files: { ext },
    assert: {
      kind: 'content',
      args: {
        ext,
        pattern: `(?<![A-Za-z0-9_])(${alt})\\s*(\\?\\?=|=[^=])`,
        copyPattern: `(^|[^?])=\\s*[A-Za-z0-9_.]*\\.(${alt})\\s*([;,})]|$)`,
        allowFiles: arr(data.allowFiles),
        allowLines: arr(data.allowLines),
      },
    },
    message: msg('审计字段红线：diff 新增行手工补写受保护审计字段，应走项目的统一写入路径'),
  });
}

/** 上岗自检：testDb → env（phase=local：只在 rules check --phase local / 自检面执行，不进提交门）。 */
function adaptLocalGates(root, rules) {
  const data = readRulesFile(root, '.agents/config/local-gates.json');
  const testDb = data && data.testDb && typeof data.testDb === 'object' ? data.testDb : null;
  if (!testDb || typeof testDb.env !== 'string' || !testDb.env) return;
  rules.push({
    id: 'local.test-db-env',
    face: 'any',
    phase: 'local',
    severity: 'block',
    scope: 'repo',
    assert: {
      kind: 'env',
      args: { name: testDb.env, forbiddenValues: arr(testDb.forbiddenDatabases) },
    },
    message: msg(`${testDb.env} 必须已设置且不指向禁用库`),
  });
}

/** 通知守卫：配置存在用配置，否则用与 check-notify-guard.mjs 一致的内建默认（行为不变）。 */
export const NOTIFY_DEFAULTS = {
  targets: ['frontend/src'],
  ext: ['.vue', '.ts'],
  pattern: 'message\\.(error|warning|warn|info)\\s*\\(',
  allowFiles: ['frontend/src/utils/notify.ts'],
};

function adaptNotifyGuard(root, rules) {
  const data = readRulesFile(root, '.agents/hooks/notify-guard.json');
  const cfg = data && typeof data === 'object' ? data : {};
  const targets = arr(cfg.targets).length ? arr(cfg.targets) : NOTIFY_DEFAULTS.targets;
  const ext = arr(cfg.ext).length ? arr(cfg.ext) : NOTIFY_DEFAULTS.ext;
  const pattern = typeof cfg.pattern === 'string' && cfg.pattern ? cfg.pattern : NOTIFY_DEFAULTS.pattern;
  const allowFiles = arr(cfg.allowFiles).length ? arr(cfg.allowFiles) : NOTIFY_DEFAULTS.allowFiles;
  rules.push({
    id: 'notify.message-guard',
    face: 'ui',
    phase: 'pre-commit',
    severity: 'block',
    scope: 'repo',
    assert: {
      kind: 'content',
      args: {
        targets, ext, pattern, unless: '^\\s*(?://|\\*|/\\*)', allow: allowFiles.map((glob) => ({ glob })), optional: true,
      },
    },
    message: msg('前端禁止直接调用 antd message.error/warning/info：一律经统一 notify.* 出口'),
  });
}

const whenOf = (entry) => {
  const when = arr(entry.when).filter((w) => typeof w === 'string' && w);
  if (typeof entry.whenEnv === 'string' && entry.whenEnv.includes('=')) when.push(`env:${entry.whenEnv}`);
  return when.length ? when : undefined;
};

/** 提交/推送门 + 产品门 → command 规则（命令与触发面原样保留；builds/checks/pushTests 排除引擎面）。 */
function adaptCommandGroups(root, rules) {
  const cc = readRulesFile(root, '.agents/hooks/commit-check.config.json');
  if (cc) {
    const groups = [
      { list: arr(cc.builds), phase: 'pre-commit', prefix: 'commit.build', exclude: ['.agents/', '.githooks/'] },
      { list: arr(cc.checks), phase: 'pre-commit', prefix: 'commit.check', exclude: ['.githooks/'] },
      { list: arr(cc.pushTests), phase: 'pre-push', prefix: 'commit.push', exclude: ['.agents/', '.githooks/'] },
    ];
    for (const group of groups) {
      group.list.forEach((entry, i) => {
        const name = typeof entry.name === 'string' && entry.name ? entry.name : `item${i}`;
        const files = {};
        if (arr(entry.ext).length) files.ext = arr(entry.ext);
        const prefixes = typeof entry.prefix === 'string' ? [entry.prefix] : arr(entry.prefix);
        if (prefixes.length) files.prefix = prefixes;
        files.exclude = group.exclude;
        rules.push({
          id: `${group.prefix}.${i}`,
          face: 'any',
          phase: group.phase,
          severity: 'block',
          scope: 'repo',
          when: whenOf(entry),
          files,
          assert: {
            kind: 'command',
            args: {
              run: String(entry.command || ''),
              cwd: entry.cwd,
              timeoutMs: entry.timeoutMs,
              lockPattern: entry.lockPattern,
              lockHint: entry.lockHint,
              name,
            },
          },
          message: msg(`${name} 未通过`),
        });
      });
    }
  }
  const pg = readRulesFile(root, '.agents/config/product-gates.json');
  const gates = Array.isArray(pg) ? pg : arr(pg && pg.gates);
  for (const gate of gates) {
    if (!gate || typeof gate.cmd !== 'string' || !gate.cmd) continue;
    rules.push({
      id: `product.${String(gate.id || gate.cmd).toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}`,
      face: 'any',
      phase: 'verify',
      severity: 'block',
      scope: 'repo',
      when: arr(gate.when).filter((w) => typeof w === 'string'),
      assert: {
        kind: 'command',
        args: { run: gate.cmd, cwd: gate.folder && gate.folder !== '.' ? gate.folder : undefined, deps: arr(gate.deps) },
      },
      message: msg(gate.name || gate.cmd),
    });
  }
}

/** 兼容层入口：返回 {name:'legacy', rules, waivers, faces, unsupported, warnings}。 */
export function adaptLegacy(root) {
  const rules = [];
  const unsupported = [];
  const faces = adaptFaces(root);
  adaptArchitecture(root, rules, unsupported);
  adaptDeleteGuard(root, rules);
  adaptAuditFields(root, rules);
  adaptLocalGates(root, rules);
  adaptNotifyGuard(root, rules);
  adaptCommandGroups(root, rules);
  return { name: 'legacy', rules, waivers: [], faces, unsupported, warnings: [] };
}
