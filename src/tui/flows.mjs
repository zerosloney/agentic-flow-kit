// TUI 业务流：安装 / 升级 / 追加宿主 / 体检 / 宿主列表，以及 FLOWS 派发表。
// 只经 prompts 层问答、screen.print 输出与各 command 入口执行，不直接触碰终端状态。
import { visualWidth, box, green, progressLine } from './ansi.mjs';
import { pickOne, pickMany, confirmYes, showLines } from './prompts.mjs';
import { HOSTS, HOST_NAMES } from '../hosts/registry.mjs';
import { readManifest } from '../install/manifest.mjs';
import { detectStack, STACKS, installCommand } from '../commands/install.mjs';
import { LANGUAGES } from '../i18n.mjs';
import { doctorCommand } from '../commands/doctor.mjs';
import { addHostCommand } from '../commands/add-host.mjs';
import { upgradeCommand } from '../commands/upgrade.mjs';

// flows 内部 argv 统一经 baseArgs 构造（形状与 cli/args.mjs parseArgs 一致：flag() 依赖 args.flags）
export const baseArgs = () => ({ _: [], agents: [], flags: new Set() });

// 宿主候选项单一映射：已安装的提示「已安装」，否则提示 label → dir
function hostItems({ installed = [], t }) {
  return HOST_NAMES.map((n) => ({
    value: n,
    label: n,
    hint: installed.includes(n) ? t('tui.installed') : `${HOSTS[n].label} → ${HOSTS[n].dir}`,
    checked: installed.includes(n),
  }));
}

// 安装流：宿主 → 语言 → 栈 → 开关 → 计划确认 → 执行（进度行）→ 可选体检
async function installFlow(ctx) {
  const { screen, t } = ctx;
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

  const detected = detectStack(cwd);
  const stack = await pickOne(ctx, {
    question: t('tui.stackQuestion'),
    hint: t('tui.hint.moveEnter'),
    cursor: Math.max(0, STACKS.indexOf(detected)),
    items: STACKS.map((s) => ({
      value: s,
      label: s,
      hint: s === detected ? t('tui.detected') : undefined,
    })),
  });
  if (stack === null) return;

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
  if (!opts.includes('git-config')) args.flags.add('no-git-config');
  if (dryRun) args.flags.add('dry-run');
  if (opts.includes('force')) args.flags.add('force');

  showLines(ctx, box(t('tui.planTitle'), [
    t('tui.plan.target', { target: cwd }),
    t('tui.plan.hosts', { hosts: hosts.join(', ') }),
    t('tui.plan.lang', { lang: selLang }),
    t('tui.plan.stack', { stack }),
  ]));
  if (!(await confirmYes(ctx, t('tui.confirmInstall')))) return;

  screen.print(t('tui.running') + '\n');
  // 进度回调契约 (action, msg, done, total)：只渲染 spinner + 进度条，末帧换行收尾
  await installCommand({
    args,
    t,
    lang: selLang,
    onLog: (_action, _msg, done, total) => {
      const line = progressLine(done, total);
      screen.output.write(done === total ? line + '\n' : line);
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
  const manifest = readManifest(process.cwd());
  if (!manifest) throw new Error(t('error.noManifest'));
  showLines(ctx, box(t('tui.planTitle'), [
    t('tui.plan.hosts', { hosts: (manifest.hosts || []).join(', ') }),
    t('tui.plan.lang', { lang: manifest.language || lang }),
    t('tui.plan.stack', { stack: manifest.stack || '-' }),
  ]));
  if (!(await confirmYes(ctx, t('tui.confirmUpgrade')))) return;
  return upgradeCommand({ args: baseArgs(), t, lang });
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
  return addHostCommand({ args: { ...baseArgs(), _: ['add-host'], agents }, t, lang });
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
