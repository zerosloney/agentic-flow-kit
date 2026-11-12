// TUI 业务流：安装 / 升级 / 追加宿主 / 体检 / 宿主列表，以及 FLOWS 派发表。
// 只经 prompts 层问答、screen.print 输出与各 command 入口执行，不直接触碰终端状态。
import { visualWidth, box, green, red, progressLine } from './ansi.mjs';
import { pickOne, pickMany, confirmYes, showLines, askText } from './prompts.mjs';
import { HOSTS, HOST_NAMES } from '../hosts/registry.mjs';
import { probeModels } from '../models/probe.mjs';
import { ROLE_NAMES, loadRoleConfig, recommendRoles, summarizeModels } from '../models/resolve.mjs';
import { readManifest } from '../install/manifest.mjs';
import { detectStackDetail, STACKS, stackMarkerLabel, formatInstallLog, installLogNotable, installCommand } from '../commands/install.mjs';
import { stackDescription } from '../render/tokens.mjs';
import { LANGUAGES } from '../i18n.mjs';
import { doctorCommand } from '../commands/doctor.mjs';
import { addHostCommand } from '../commands/add-host.mjs';
import { upgradeCommand } from '../commands/upgrade.mjs';

// flows 内部 argv 统一经 baseArgs 构造（形状与 cli/args.mjs parseArgs 一致：flag() 依赖 args.flags）
export const baseArgs = () => ({ _: [], agents: [], flags: new Set() });

function fileOf(msg) {
  const text = String(msg ?? '');
  const i = text.indexOf('（');
  return (i >= 0 ? text.slice(0, i) : text).trim();
}

function clip(text, max) {
  if (visualWidth(text) <= max) return text;
  let out = '';
  let width = 0;
  for (const ch of text) {
    const w = visualWidth(ch);
    if (width + w > max - 1) return `${out}…`;
    out += ch;
    width += w;
  }
  return out;
}

// 常规创建/更新只留在进度条上。冲突和非常规跳过先换行落盘，避免被下一帧 \\r 清掉。
export function installProgressWrites({ action, msg, done, total }) {
  const writes = [];
  if (installLogNotable(action, msg)) {
    const text = formatInstallLog(action, msg);
    writes.push(`\r\x1b[2K${action === 'conflict' ? red(text) : text}\n`);
  }
  const detail = clip(formatInstallLog(action, fileOf(msg)), 48);
  const line = progressLine(done, total, detail);
  writes.push(done === total ? `${line}\n` : line);
  return writes;
}

// 栈菜单：名称在 label，hint 带典型标记与描述。命中项改写为实际文件名。
export function stackItems({ detected, current, lang, t }) {
  return STACKS.map((stack) => {
    const matched = detected?.stack === stack;
    const tags = [];
    if (current && stack === current) tags.push(t('tui.currentStack'));
    if (matched && detected.file) tags.push(t('tui.detectedFile', { file: detected.file }));
    else if (matched) tags.push(t('tui.detected'));
    else {
      const marker = stackMarkerLabel(stack);
      if (marker) tags.push(marker);
    }
    const hint = [...tags, stackDescription(stack, lang)].filter(Boolean).join(' · ');
    return { value: stack, label: t(`tui.stack.${stack}`), hint };
  });
}

// 宿主候选项单一映射：已安装的提示「已安装」，否则提示 label → dir
function hostItems({ installed = [], t }) {
  return HOST_NAMES.map((n) => ({
    value: n,
    label: n,
    hint: installed.includes(n) ? t('tui.installed') : `${HOSTS[n].label} → ${HOSTS[n].dir}`,
    checked: installed.includes(n),
  }));
}

// 模型配置流：静态探测 → 可选只读 CLI 探测 → 推荐确认 / 逐角色选择（含手填、inherit、跳过）。
async function modelFlow(ctx, hosts) {
  const { t } = ctx;
  const cwd = process.cwd();
  const roleConfig = loadRoleConfig(cwd);
  const models = {};
  let explicit = false;

  for (const host of hosts) {
    const h = HOSTS[host];
    if (!h?.agents?.modelField) continue;

    let candidates = probeModels({ host, target: cwd, allowCli: false });
    if (!candidates.length && (h.modelProbe?.cli || []).length) {
      const allow = await confirmYes(ctx, t('tui.model.allowProbe', { host }));
      if (allow === null) return null;
      if (allow) candidates = probeModels({ host, target: cwd, allowCli: true });
    }

    const recommended = recommendRoles({ host, candidates, roleConfig });
    const hasRecommended = ROLE_NAMES.some((role) => recommended[role]);
    let useRecommended = false;
    if (hasRecommended) {
      useRecommended = await confirmYes(ctx, t('tui.model.useRecommended', { host }));
      if (useRecommended === null) return null;
    }
    if (useRecommended) {
      models[host] = recommended;
      continue;
    }

    explicit = true;
    const values = {};
    for (const role of ROLE_NAMES) {
      const items = candidates.map((c) => ({ value: c.id, label: c.id, hint: c.source }));
      if (recommended[role] && !items.some((it) => it.value === recommended[role])) {
        items.push({ value: recommended[role], label: recommended[role], hint: t('tui.model.recommended') });
      }
      if (h.agents.inheritValue) items.push({ value: h.agents.inheritValue, label: t('tui.model.inherit') });
      items.push({ value: '__manual__', label: t('tui.model.manual') });
      items.push({ value: '__skip__', label: t('tui.model.skip') });

      const choice = await pickOne(ctx, {
        question: t('tui.model.role', { role: t(`tui.model.role.${role}`) }),
        hint: t('tui.hint.moveEnter'),
        items,
      });
      if (choice === null) return null;
      if (choice === '__skip__') {
        values[role] = '__none__';
      } else if (choice === '__manual__') {
        const value = await askText(ctx, {
          question: t('tui.model.manualPrompt'),
          validate: (v) => (String(v).trim() ? null : t('tui.model.invalid')),
        });
        if (value === null) return null;
        values[role] = value.trim();
      } else {
        values[role] = choice;
      }
    }
    // 跳过 / inherit 不是具体模型，不触发同模型告警。
    const concrete = (v) => Boolean(v) && v !== '__none__' && v !== h.agents.inheritValue;
    if (concrete(values.review) && concrete(values.code) && values.review === values.code) {
      showLines(ctx, [red(t('tui.model.sameAsCode'))]);
    }
    models[host] = values;
  }

  return { models, explicit };
}

// 安装流：宿主 → 语言 → 栈 → 模型 → 开关 → 计划确认 → 执行（进度行）→ 可选体检
async function installFlow(ctx) {
  const { screen, t, lang } = ctx;
  const cwd = process.cwd();
  const prev = readManifest(cwd);
  const prevHosts = Array.isArray(prev && prev.hosts) ? prev.hosts : [];

  const hosts = await pickMany(ctx, {
    question: t('tui.hostsQuestion'),
    hint: t('tui.hint.toggle'),
    min: 1,
    items: hostItems({ installed: prevHosts, t }),
  });
  if (hosts === null) return;

  const selLang = await pickOne(ctx, {
    question: t('tui.langQuestion'),
    hint: t('tui.hint.moveEnter'),
    items: LANGUAGES.map((l) => ({ value: l, label: l })),
  });
  if (selLang === null) return;

  const detected = detectStackDetail(cwd);
  const stack = await pickOne(ctx, {
    question: t('tui.stackQuestion'),
    hint: t('tui.hint.moveEnter'),
    cursor: Math.max(0, STACKS.indexOf(detected.stack)),
    items: stackItems({ detected, lang, t }),
  });
  if (stack === null) return;

  const modelResult = await modelFlow(ctx, hosts);
  if (modelResult === null) return;

  const opts = await pickMany(ctx, {
    question: t('tui.optsQuestion'),
    hint: t('tui.hint.toggle'),
    min: 0,
    items: [
      { value: 'git-config', label: t('tui.opt.gitConfig'), checked: true },
      { value: 'dry-run', label: t('tui.opt.dryRun') },
      { value: 'force', label: t('tui.opt.force') },
    ],
  });
  if (opts === null) return;

  const dryRun = opts.includes('dry-run');
  // argv 形状与 wizard.mjs buildInstallArgs 一致：git 配置默认开，开关转 flags
  const args = { ...baseArgs(), _: ['install'], agents: hosts, lang: selLang, stack };
  if (modelResult.models && Object.keys(modelResult.models).length) args.tuiModels = modelResult.models;
  if (!opts.includes('git-config')) args.flags.add('no-git-config');
  if (dryRun) args.flags.add('dry-run');
  if (opts.includes('force')) args.flags.add('force');

  const planLines = [
    t('tui.plan.target', { target: cwd }),
    t('tui.plan.hosts', { hosts: hosts.join(', ') }),
    t('tui.plan.lang', { lang: selLang }),
    t('tui.plan.stack', { stack }),
  ];
  if (modelResult.models && Object.keys(modelResult.models).length) {
    planLines.push(t('tui.plan.models', { models: summarizeModels({ hosts: modelResult.models }) }));
  }
  showLines(ctx, box(t('tui.planTitle'), planLines));
  if (!(await confirmYes(ctx, t('tui.confirmInstall')))) return;

  screen.print(t('tui.running') + '\n');
  // 进度回调契约 (action, msg, done, total)：进度条带当前文件；冲突与非常规跳过单独留行。
  await installCommand({
    args,
    t,
    lang: selLang,
    onLog: (action, msg, done, total) => {
      for (const chunk of installProgressWrites({ action, msg, done, total })) screen.output.write(chunk);
    },
  });
  // dry-run 未写盘，完成文案须区分，避免误导
  screen.print(green(`✓ ${t(dryRun ? 'tui.dryDone' : 'tui.done')}`) + '\n');

  screen.print('');
  if (await confirmYes(ctx, t('tui.askDoctor'))) {
    return doctorCommand({ args: { deep: false }, t, lang: selLang });
  }
}

async function upgradeFlow(ctx) {
  const { t, lang } = ctx;
  const cwd = process.cwd();
  const manifest = readManifest(cwd);
  if (!manifest) throw new Error(t('error.noManifest'));
  const recorded = STACKS.includes(manifest.stack) ? manifest.stack : 'empty';
  const detected = detectStackDetail(cwd);
  const stack = await pickOne(ctx, {
    question: t('tui.upgradeStackQuestion'),
    hint: t('tui.hint.moveEnter'),
    cursor: Math.max(0, STACKS.indexOf(recorded)),
    items: stackItems({ detected, current: recorded, lang, t }),
  });
  if (stack === null) return;
  showLines(ctx, box(t('tui.planTitle'), [
    t('tui.plan.hosts', { hosts: (manifest.hosts || []).join(', ') }),
    t('tui.plan.lang', { lang: manifest.language || lang }),
    t('tui.plan.stack', { stack }),
  ]));
  if (!(await confirmYes(ctx, t('tui.confirmUpgrade')))) return;
  return upgradeCommand({ args: { ...baseArgs(), stack }, t, lang });
}

async function addHostFlow(ctx) {
  const { t, lang } = ctx;
  const manifest = readManifest(process.cwd());
  if (!manifest) throw new Error(t('error.noManifest'));
  const installed = Array.isArray(manifest.hosts) ? manifest.hosts : [];
  const agents = await pickMany(ctx, {
    question: t('tui.addHostQuestion'),
    hint: t('tui.hint.toggle'),
    min: 1,
    items: hostItems({ installed, t }),
  });
  if (agents === null) return;
  const modelResult = await modelFlow(ctx, agents);
  if (modelResult === null) return;
  const args = { ...baseArgs(), _: ['add-host'], agents };
  if (modelResult.models && Object.keys(modelResult.models).length) args.tuiModels = modelResult.models;
  return addHostCommand({ args, t, lang });
}

async function doctorFlow(ctx) {
  const { t, lang } = ctx;
  const deep = await pickOne(ctx, {
    question: t('tui.doctorQuestion'),
    hint: t('tui.hint.moveEnter'),
    items: [
      { value: false, label: t('tui.doctor.normal') },
      { value: true, label: t('tui.doctor.deep') },
    ],
  });
  if (deep === null) return;
  return doctorCommand({ args: { deep }, t, lang });
}

function listHostsFlow(ctx) {
  const { t } = ctx;
  const rows = HOST_NAMES.map((n) => ({ name: n, label: HOSTS[n].label, dir: HOSTS[n].dir }));
  const wName = Math.max(...rows.map((r) => visualWidth(r.name)));
  const wLabel = Math.max(...rows.map((r) => visualWidth(r.label)));
  const pad = (s, w) => s + ' '.repeat(w - visualWidth(s) + 2);
  showLines(ctx, box(t('listHosts.title'), rows.map((r) => `${pad(r.name, wName)}${pad(r.label, wLabel)}${r.dir}`)));
}

export const FLOWS = {
  install: installFlow,
  upgrade: upgradeFlow,
  'add-host': addHostFlow,
  doctor: doctorFlow,
  'list-hosts': listHostsFlow,
};
