// TUI 业务流：安装 / 升级 / 追加宿主 / 体检 / 宿主列表，以及 FLOWS 派发表。
// 只经 prompts 层问答、screen.print 输出与各 command 入口执行，不直接触碰终端状态。
import { visualWidth, box, green, red, progressLine } from './ansi.mjs';
import { pickOne, pickMany, confirmYes, showLines, askText } from './prompts.mjs';
import { HOSTS, HOST_NAMES } from '../hosts/registry.mjs';
import { detectHosts } from '../hosts/detect.mjs';
import { probeModels } from '../models/probe.mjs';
import { ROLE_NAMES, loadRoleConfig, recommendRoles, summarizeModels } from '../models/resolve.mjs';
import { readManifest } from '../install/manifest.mjs';
import { detectStackDetail, STACKS, stackMarkerLabel, formatInstallLog, installLogNotable, installCommand, PRODUCT_MODES, SCAFFOLD_MODES, parsePortNumber, detectProductMode } from '../commands/install.mjs';
import { STACK_REGISTRY } from '../install/stack-registry.mjs';
import { stackDescription } from '../render/tokens.mjs';
import { SURFACES, surfaceDescription } from '../install/profiles.mjs';
import { LANGUAGES } from '../i18n.mjs';
import { doctorCommand } from '../commands/doctor.mjs';
import { addHostCommand } from '../commands/add-host.mjs';
import { upgradeCommand } from '../commands/upgrade.mjs';
import { removeHostCommand, uninstallCommand } from '../commands/remove-host.mjs';

// flows 内部 argv 统一经 baseArgs 构造（形状与 cli/args.mjs parseArgs 一致：flag() 依赖 args.flags）
export const baseArgs = () => ({ _: [], agents: [], flags: new Set() });

// 纯函数：向导选择 → runInstall 入参（argv 形状与 cli/args.mjs parseArgs 经 baseArgs 一致）。
// git 配置 CLI 侧默认开，--no-git-config 关闭
export function buildInstallArgs({
  hosts, lang, stack, surfaces = [], gitConfig = true, dryRun = false, force = false, models = null,
  product = null, ports = null, scaffold = null,
}) {
  const args = {
    ...baseArgs(),
    _: ['install'],
    agents: hosts,
    lang,
    stack,
    flags: new Set([
      ...(gitConfig ? [] : ['no-git-config']),
      ...(dryRun ? ['dry-run'] : []),
      ...(force ? ['force'] : []),
    ]),
  };
  // 模型参数保持 opt-in：默认路径不新增 flag，避免破坏既有 argv 断言。
  if (models && Object.keys(models).length) args.tuiModels = models;
  if (surfaces.length) args.surfaces = surfaces;
  // 项目形态 / 端口 / 脚手架只显式传入：缺省值不落 argv，manifest 端口继续跟随栈注册表。
  if (product && product !== 'web') args.product = product;
  if (ports?.api !== undefined) args['api-port'] = ports.api;
  if (ports?.web !== undefined) args['web-port'] = ports.web;
  if (scaffold && scaffold !== 'full') args.scaffold = scaffold;
  return args;
}

// 向导的「项目形态 → 端口 → 脚手架档位」三问。端口只在 web / api 形态下问，
// 选栈默认（或留空）时不回传端口：manifest 不钉死默认值，升级继续跟随栈注册表。
// 任一步 EOF / 退出返回 null。
export async function projectShapeFlow(ctx, { stack }) {
  const { t } = ctx;
  const detected = ctx.target ? detectProductMode(ctx.target) : null;
  const initialIndex = detected ? PRODUCT_MODES.indexOf(detected) : -1;
  const cursor = initialIndex >= 0 ? initialIndex : Math.max(0, PRODUCT_MODES.indexOf('web'));
  const product = await pickOne(ctx, {
    question: t('tui.shapeQuestion'),
    hint: t('tui.hint.moveEnter'),
    cursor,
    items: PRODUCT_MODES.map((mode) => ({
      value: mode,
      label: t(`tui.shape.${mode}`),
      hint: t(`tui.shape.${mode}.hint`),
    })),
  });
  if (product === null) return null;

  const defaults = STACK_REGISTRY[stack]?.ports || {};
  const ports = {};
  if (product === 'web' || product === 'api') {
    const portMode = await pickOne(ctx, {
      question: t('tui.portsQuestion'),
      hint: t('tui.hint.moveEnter'),
      items: [
        {
          value: 'default',
          label: product === 'web'
            ? t('tui.port.useDefaults', { api: defaults.api, web: defaults.web })
            : t('tui.port.useDefaultsApi', { api: defaults.api }),
        },
        { value: 'custom', label: t('tui.port.custom') },
      ],
    });
    if (portMode === null) return null;

    if (portMode === 'custom') {
      const askPort = async (key) => {
        const raw = await askText(ctx, {
          question: t(`tui.port.${key}Question`),
          hint: t('tui.port.hint'),
          validate: (s) => {
            const value = String(s).trim();
            if (value === '') return null; // 留空 = 沿用该端口栈默认
            return parsePortNumber(value) === null ? t('tui.port.invalid') : null;
          },
        });
        if (raw === null) return null;
        const value = String(raw).trim();
        if (value !== '') ports[key] = parsePortNumber(value);
        return true;
      };
      if ((await askPort('api')) === null) return null;
      if (product === 'web' && (await askPort('web')) === null) return null;
    }
  }

  const scaffold = await pickOne(ctx, {
    question: t('tui.scaffoldQuestion'),
    hint: t('tui.hint.moveEnter'),
    cursor: Math.max(0, SCAFFOLD_MODES.indexOf('full')),
    items: SCAFFOLD_MODES.map((mode) => ({
      value: mode,
      label: t(`tui.scaffold.${mode}`),
      hint: t(`tui.scaffold.${mode}.hint`),
    })),
  });
  if (scaffold === null) return null;

  return { product, ports, scaffold };
}

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

// 需要 manifest 的流统一从这里取：缺失即抛错终止，行为与各流内联写法一致。
function requireManifest(t) {
  const manifest = readManifest(process.cwd());
  if (!manifest) throw new Error(t('error.noManifest'));
  return manifest;
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

// 宿主候选项单一映射：已安装或探测到的提示，用户仍可改选。
function hostItems({ installed = [], suggested = [], t }) {
  return HOST_NAMES.map((n) => {
    const isInstalled = installed.includes(n);
    const isSuggested = !isInstalled && suggested.includes(n);
    const tags = [
      isInstalled ? t('tui.installed') : null,
      isSuggested ? t('tui.detectedHost') : null,
      `${HOSTS[n].label} → ${HOSTS[n].dir}`,
    ].filter(Boolean);
    return {
      value: n,
      label: n,
      hint: tags.join(' · '),
      checked: isInstalled || isSuggested,
    };
  });
}

// allowProbe 确认问题：把宿主声明的探测命令逐条渲染进提示（知情同意；命令清单在 flows 组装，locale 只留句式）。
export function allowProbeQuestion({ host, t }) {
  const commands = (HOSTS[host]?.modelProbe?.cli || [])
    .filter((c) => c?.command)
    .map((c) => [c.command, ...(c.args || [])].join(' '))
    .join('; ');
  return t('tui.model.allowProbe', { host, commands });
}

// 模型配置流：静态探测 → 可选只读 CLI 探测 → 推荐确认 / 逐角色选择（含手填、inherit、跳过）。
async function modelFlow(ctx, hosts) {
  const { t } = ctx;
  const cwd = process.cwd();
  const roleConfig = loadRoleConfig(cwd);
  const models = {};

  for (const host of hosts) {
    const h = HOSTS[host];
    if (!h?.agents?.modelField) continue;

    let candidates = probeModels({ host, target: cwd, allowCli: false });
    if (!candidates.length && (h.modelProbe?.cli || []).length) {
      const allow = await confirmYes(ctx, allowProbeQuestion({ host, t }));
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

  return { models };
}

// 安装流：宿主 → 语言 → 栈 → 项目形态 / 端口 / 脚手架 → 切面 → 模型 → 开关 → 计划确认 → 执行（进度行）→ 可选体检
async function installFlow(ctx) {
  const { screen, t, lang } = ctx;
  const cwd = process.cwd();
  ctx.target = cwd;
  const prev = readManifest(cwd);
  const prevHosts = Array.isArray(prev && prev.hosts) ? prev.hosts : [];

  const hosts = await pickMany(ctx, {
    question: t('tui.hostsQuestion'),
    hint: t('tui.hint.toggle'),
    min: 1,
    items: hostItems({ installed: prevHosts, suggested: detectHosts(cwd), t }),
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

  // 项目形态 / 端口 / 脚手架紧跟栈选择：端口默认值依赖所选栈。
  const shape = await projectShapeFlow(ctx, { stack });
  if (shape === null) return;

  // 组合式 profile：surface 可多选、可不选；闭集由 profiles.mjs 约束。
  const surfaces = await pickMany(ctx, {
    question: t('tui.surfaceQuestion'),
    hint: t('tui.hint.toggle'),
    min: 0,
    items: SURFACES.map((surface) => ({
      value: surface,
      label: t(`tui.surface.${surface}`),
      hint: surfaceDescription(surface, lang),
    })),
  });
  if (surfaces === null) return;

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
  const args = buildInstallArgs({
    hosts,
    lang: selLang,
    stack,
    surfaces,
    gitConfig: opts.includes('git-config'),
    dryRun,
    force: opts.includes('force'),
    models: modelResult.models,
    product: shape.product,
    ports: shape.ports,
    scaffold: shape.scaffold,
  });

  const planLines = [
    t('tui.plan.target', { target: cwd }),
    t('tui.plan.hosts', { hosts: hosts.join(', ') }),
    t('tui.plan.lang', { lang: selLang }),
    t('tui.plan.stack', { stack }),
    t('tui.plan.shape', { shape: t(`tui.shape.${shape.product}`) }),
  ];
  // 端口行只对 web / api 有意义；每项标明是栈默认还是自定义。
  if (shape.product === 'web' || shape.product === 'api') {
    const stackPorts = STACK_REGISTRY[stack]?.ports || {};
    const portText = (key) => (shape.ports[key] !== undefined
      ? t('tui.plan.portCustom', { port: shape.ports[key] })
      : t('tui.plan.portDefault', { port: stackPorts[key] }));
    planLines.push(shape.product === 'web'
      ? t('tui.plan.ports', { api: portText('api'), web: portText('web') })
      : t('tui.plan.portsApi', { api: portText('api') }));
  }
  if (shape.scaffold !== 'full') planLines.push(t('tui.plan.scaffold', { scaffold: t(`tui.scaffold.${shape.scaffold}`) }));
  if (surfaces.length) planLines.push(t('tui.plan.surfaces', { surfaces: surfaces.join(', ') }));
  if (modelResult.models && Object.keys(modelResult.models).length) {
    planLines.push(t('tui.plan.models', { models: summarizeModels({ hosts: modelResult.models }) }));
  }
  showLines(ctx, box(t('tui.planTitle'), planLines));
  if (!(await confirmYes(ctx, t('tui.confirmInstall')))) return;

  screen.print(t('tui.running') + '\n');
  // 进度回调契约 (action, msg, done, total)：进度条带当前文件；冲突与非常规跳过单独留行。
  await installCommand({
    args: { ...args, ...(shape.product ? { product: shape.product } : {}) },
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
    return doctorCommand({ args: { ...baseArgs(), deep: false }, t, lang: selLang });
  }
}

async function upgradeFlow(ctx) {
  const { t, lang } = ctx;
  const cwd = process.cwd();
  const manifest = requireManifest(t);
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
  const manifest = requireManifest(t);
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
  return doctorCommand({ args: { ...baseArgs(), deep }, t, lang });
}

function listHostsFlow(ctx) {
  const { t } = ctx;
  const rows = HOST_NAMES.map((n) => ({ name: n, label: HOSTS[n].label, dir: HOSTS[n].dir }));
  const wName = Math.max(...rows.map((r) => visualWidth(r.name)));
  const wLabel = Math.max(...rows.map((r) => visualWidth(r.label)));
  const pad = (s, w) => s + ' '.repeat(w - visualWidth(s) + 2);
  showLines(ctx, box(t('listHosts.title'), rows.map((r) => `${pad(r.name, wName)}${pad(r.label, wLabel)}${r.dir}`)));
}

async function removeHostFlow(ctx) {
  const { t, lang } = ctx;
  const manifest = requireManifest(t);
  const installed = HOST_NAMES.filter((name) => (manifest.hosts || []).includes(name));
  if (!installed.length) {
    showLines(ctx, [t('tui.removeHost.none')]);
    return;
  }
  const agents = await pickMany(ctx, {
    question: t('tui.removeHostQuestion'),
    hint: t('tui.hint.toggle'),
    min: 1,
    items: installed.map((name) => ({
      value: name,
      label: name,
      hint: `${HOSTS[name].label} → ${HOSTS[name].dir}`,
    })),
  });
  if (agents === null) return;
  showLines(ctx, box(t('tui.planTitle'), [
    t('tui.plan.hosts', { hosts: agents.join(', ') }),
    t('tui.plan.target', { target: process.cwd() }),
  ]));
  if (!(await confirmYes(ctx, t('tui.confirmRemoveHost', { hosts: agents.join(', ') })))) return;
  return removeHostCommand({ args: { ...baseArgs(), _: ['remove-host'], agents }, t, lang });
}

async function uninstallFlow(ctx) {
  const { t, lang } = ctx;
  const manifest = requireManifest(t);
  showLines(ctx, box(t('tui.planTitle'), [
    t('tui.plan.target', { target: process.cwd() }),
    t('tui.plan.hosts', { hosts: (manifest.hosts || []).join(', ') || '-' }),
  ]));
  if (!(await confirmYes(ctx, t('tui.confirmUninstall')))) return;
  return uninstallCommand({ args: { ...baseArgs(), _: ['uninstall'] }, t, lang });
}

export const FLOWS = {
  install: installFlow,
  upgrade: upgradeFlow,
  'add-host': addHostFlow,
  'remove-host': removeHostFlow,
  uninstall: uninstallFlow,
  doctor: doctorFlow,
  'list-hosts': listHostsFlow,
};
