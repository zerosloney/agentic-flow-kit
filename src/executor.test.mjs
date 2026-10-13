// executor.test.mjs — flow-kit route / run 薄壳套件（2026-10-13 flow-kit-route）
// 方法：子进程 driver 调真实 src/executor.mjs（route 内部会 process.exit，隔离到子进程才能测退出码与 stdout）；
//       装户 fixture 只放薄壳**依赖面**文件（level-criteria.mjs 真拷、stage-gates/pipeline-run 用哨兵 stub）。
// 覆盖：route 档位与入口映射 / hints 抬档与 underHint / 泳道真取装户单源（缺失时回落并标注）/
//       --kind·--level 非法值 fail-loud / 缺判据单源 fail-loud / --json 机读面 /
//       run 参数·退出码透传 / run 缺子命令用法提示 / run 缺 pipeline-run 指向 init-sync。
// 用法：node src/executor.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(SRC, '..');
const REAL_CRIT = path.join(PKG, 'templates/_agents/scripts/level-criteria.mjs');
const REAL_ENUMS_MJS = path.join(PKG, 'templates/_agents/scripts/workflow-enums.mjs');
const REAL_ENUMS_TXT = path.join(PKG, 'templates/_agents/workflow-enums.txt');

let pass = 0, failCount = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { failCount++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
const W = (p, content) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content, 'utf8'); };

// 装户 fixture：判据单源与枚举单源真拷；stage-gates / pipeline-run 用哨兵 stub（证明薄壳是「调用装户」而非自带实现）
//   withEnums 默认 true = 完整装户面。降级通道（2026-10-13）要求能断言「完整态无降级」，
//   若夹具恒缺枚举单源，enums-fallback 会恒真、该断言即假护栏。
function mkProject({ withCrit = true, withStageGates = true, withEnums = true, laneKey = null, hints = null, modules = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-exec-'));
  const S = path.join(root, '.agents', 'scripts');
  if (withCrit) fs.mkdirSync(S, { recursive: true }), fs.copyFileSync(REAL_CRIT, path.join(S, 'level-criteria.mjs'));
  if (withStageGates) {
    // 默认哨兵：按 L2/L3 → high 的常规口径（写在被写入的 stub 文件里，在装户侧求值）
    const body = laneKey
      ? `return ${JSON.stringify(laneKey)};`
      : `return (level === 'L2' || level === 'L3') ? 'high' : 'low';`;
    W(path.join(S, 'stage-gates.mjs'), `export function laneOfDoc(level){ ${body} }\n`);
  }
  if (hints !== null) W(path.join(root, '.agents', 'level-hints.txt'), hints);
  if (modules !== null) W(path.join(root, '.agents', 'workflow-modules.txt'), modules);
  if (withEnums) {
    fs.mkdirSync(S, { recursive: true });
    fs.copyFileSync(REAL_ENUMS_MJS, path.join(S, 'workflow-enums.mjs'));
    fs.copyFileSync(REAL_ENUMS_TXT, path.join(root, '.agents', 'workflow-enums.txt'));
  }
  return root;
}

function runCli(args, cwd) {
  // win32 绝对路径必须转 file:// URL，否则 ESM loader 判 ERR_UNSUPPORTED_ESM_URL_SCHEME（protocol 'e:'）
  const href = pathToFileURL(path.join(SRC, 'executor.mjs')).href;
  const driver = `import(${JSON.stringify(href)})`
    + `.then(m=>m.${args[0] === 'run' ? 'runPipeline' : 'route'}(${JSON.stringify(args.slice(1))}))`;
  return spawnSync(process.execPath, ['-e', driver], { cwd, encoding: 'utf8', windowsHide: true });
}
const route = (args, cwd) => runCli(['route', ...args], cwd);
const run = (args, cwd) => runCli(['run', ...args], cwd);

// ============ 场景 1：无 hints（默认装户）→ L1 起步 + 明示未配置 ============
{
  const r = mkProject();
  const x = route(['--kind', 'require'], r);
  check('S1 exit=0', x.status === 0, `status=${x.status} ${x.stderr}`);
  check('S1 给出 L1', x.stdout.includes('建议级别：L1'));
  check('S1 明示机器面给不出档位（不假装判得出）', x.stdout.includes('未配置') && x.stdout.includes('L1 起步'));
  check('S1 带 level-hints.txt 路径指引', x.stdout.includes('.agents/level-hints.txt'));
  check('S1 输出 L1 负例面', x.stdout.includes('单模块内部重构'));
  check('S1 输出自查句', x.stdout.includes('能否列出'));
  check('S1 kind=require → plan.md 入口', x.stdout.includes('.agents/commands/plan.md'));
  check('S1 泳道=协作道', x.stdout.includes('泳道：协作道'));
}

// ============ 场景 2：kind → 入口 md 映射（五个值全覆盖） ============
{
  const r = mkProject();
  const map = { require: 'plan.md', fix: 'maintain.md', verify: 'test.md', review: 'review.md', deploy: 'deploy.md' };
  for (const [kind, md] of Object.entries(map)) {
    const x = route(['--kind', kind, '--json'], r);
    const j = JSON.parse(x.stdout);
    check(`S2 kind=${kind} → ${md}`, j.nextCommand === `.agents/commands/${md}`, JSON.stringify(j.nextCommand));
  }
  const none = JSON.parse(route(['--json'], r).stdout);
  check('S2 未给 kind → 默认 require 且显式标记未定', none.kind === '(未定)' && none.nextStage === 'plan.md');
  check('S2 未给 kind 的文本面提示先判 kind', route([], r).stdout.includes('先判 kind'));
}

// ============ 场景 3：hints 抬档 + underHint ============
{
  const r = mkProject({ hints: 'L3 ^src/db/migrations/.*\\.sql$\nL2 ^src/contracts/\n' });
  const hit = route(['--files', 'src/db/migrations/001_init.sql', '--json'], r);
  const hj = JSON.parse(hit.stdout);
  check('S3 hints 命中抬到 L3', hj.level === 'L3' && hj.hintLevel === 'L3');
  check('S3 matched 带命中证据', hj.matched.length > 0 && hj.matched[0].includes('001_init.sql'), JSON.stringify(hj.matched));
  check('S3 L2 hints 抬到 L2', JSON.parse(route(['--files', 'src/contracts/t.ts', '--json'], r).stdout).level === 'L2');
  const low = JSON.parse(route(['--level', 'L1', '--files', 'src/db/migrations/002_x.sql', '--json'], r).stdout);
  check('S3 建议档低于下限 → underHint=true', low.underHint === true);
  check('S3 就高不就低：level 仍取下限 L3', low.level === 'L3');
  check('S3 文本面输出改判警告', route(['--level', 'L1', '--files', 'src/db/migrations/002_x.sql'], r).stdout.includes('低于路径提示下限'));
  const miss = JSON.parse(route(['--files', 'src/ui/b.tsx', '--json'], r).stdout);
  check('S3 未命中 → L1 且 hintLevel 空', miss.level === 'L1' && miss.hintLevel === '' && miss.matched.length === 0);
  check('S3 多文件逗号/中文逗号切分', JSON.parse(route(['--files', 'src/a.ts,src/contracts/t.ts', '--json'], r).stdout).level === 'L2');
  // 寻址：--dir=<path> 与 --dir <path> 等价（后者被 parseArgs 消费后不能落进 files）
  const eqDir = route([`--dir=${r}`, '--kind', 'require', '--files', 'src/contracts/t.ts', '--json'], os.tmpdir());
  check('S3 --dir= 形式定位装户根', JSON.parse(eqDir.stdout).level === 'L2', eqDir.stderr);
  check('S3 --dir 不被误当改动文件', JSON.parse(eqDir.stdout).files.length === 1, eqDir.stdout);
}

// ============ 场景 4：泳道真取装户单源 ============
{
  // 哨兵：装户 laneOfDoc 对 L1 返回 low、对 L2 返回 high —— 若薄壳自带实现（按档写死），
  // 换成「L2 返回 low」的哨兵即可测出：薄壳必须问装户，不能自己判。
  const r = mkProject({ laneKey: null });
  W(path.join(r, '.agents', 'scripts', 'stage-gates.mjs'),
    'export function laneOfDoc(level){ return level === "L2" ? "low" : "high"; }\n');
  const j = JSON.parse(route(['--kind', 'require', '--level', 'L2', '--json'], r).stdout);
  check('S4 泳道取装户单源返回值（不按档写死）', j.laneKey === 'low', `laneKey=${j.laneKey}`);
  check('S4 laneSource 标明单源', j.laneSource === 'stage-gates.mjs', j.laneSource);
  check('S4 low → 协作道', j.lane === '协作道（快车道）');
  const j2 = JSON.parse(route(['--level', 'L3', '--json'], r).stdout);
  check('S4 high → 防御道', j2.laneKey === 'high' && j2.lane.includes('防御道'));

  // 单源返回非法值 → 不假装取到，回落并标注
  const bad = mkProject();
  W(path.join(bad, '.agents', 'scripts', 'stage-gates.mjs'), 'export function laneOfDoc(){ return "banana"; }\n');
  const bj = JSON.parse(route(['--level', 'L2', '--json'], bad).stdout);
  check('S4 单源返回非法值 → 回落', bj.laneKey === 'high' && bj.laneSource === 'fallback', JSON.stringify(bj.laneKey));

  // 单源缺失 → 回落 + 降级通道可见（2026-10-13 degradation-channel：文本与 JSON 同一出口）
  const miss = mkProject({ withStageGates: false });
  const mx = route(['--level', 'L2'], miss);
  check('S4 单源缺失 → 回落标注', mx.stdout.includes('lane-source-fallback'), mx.stdout.slice(-200));
  check('S4 降级文本面统一出口', mx.stdout.includes('降级运行'));
  check('S4 缺单源不阻断路由（仍给档位与入口）', mx.stdout.includes('建议级别：L2') && mx.status === 0);
  const mj = JSON.parse(route(['--level', 'L2', '--json'], miss).stdout);
  check('S4 缺单源时 JSON 面标 fallback', mj.laneSource === 'fallback');
  check('S4 JSON 降级数组含 lane-source-fallback', mj.degraded === true && mj.degradations.some((d) => d.code === 'lane-source-fallback'), JSON.stringify(mj.degradations));
}

// ============ 场景 4b：降级通道完整性（此前四种缺失策略混用、只有 laneSource 可见）============
{
  const codesOf = (proj, args) => JSON.parse(route(args.concat(['--json']), proj).stdout).degradations.map((d) => d.code);

  // 判据单源齐全、无 hints → level-hints-empty 必须登记（此前对 JSON 消费方完全静默）
  const noHints = mkProject();
  const c1 = codesOf(noHints, ['--level', 'L1']);
  check('S4b 未配 hints → 降级登记 level-hints-empty', c1.includes('level-hints-empty'), JSON.stringify(c1));
  check('S4b 配了 hints 后不再报该降级', (() => {
    fs.writeFileSync(path.join(noHints, '.agents', 'level-hints.txt'), '# x\nL2 ^src/db/\n');
    return !codesOf(noHints, ['--level', 'L1']).includes('level-hints-empty');
  })());

  // 枚举单源缺失 → enums-fallback（此前静默用自带表）
  const noEnums = mkProject({ withEnums: false });
  check('S4b 枚举缺失 → 降级登记 enums-fallback', codesOf(noEnums, ['--level', 'L1']).includes('enums-fallback'), JSON.stringify(codesOf(noEnums, ['--level', 'L1'])));

  // 建议档低于 hints 下限 → under-hint-proposed（此前仅 warning 字段，无统一出口）
  const under = mkProject();
  fs.writeFileSync(path.join(under, '.agents', 'level-hints.txt'), 'L3 ^src/db/\n');
  const c3 = codesOf(under, ['--level', 'L1', '--files', 'src/db/schema.sql']);
  check('S4b 判低 → 降级登记 under-hint-proposed 且仍按就高不就低取 L3', c3.includes('under-hint-proposed')
    && JSON.parse(route(['--level', 'L1', '--files', 'src/db/schema.sql', '--json'], under).stdout).level === 'L3', JSON.stringify(c3));

  // 完整态（hints + 枚举 + 单源齐全）→ degraded=false，降级数组为空
  const full = mkProject();
  fs.writeFileSync(path.join(full, '.agents', 'level-hints.txt'), 'L2 ^src/db/\n');
  const fj = JSON.parse(route(['--level', 'L1', '--json'], full).stdout);
  check('S4b 完整态无降级', fj.degraded === false && fj.degradations.length === 0, JSON.stringify(fj.degradations));
}

// ============ 场景 5：非法输入 fail-loud ============
{
  const r = mkProject();
  const k = route(['--kind', 'bogus'], r);
  check('S5 非法 kind exit=1', k.status === 1);
  check('S5 非法 kind 报文列合法值', k.stderr.includes('require|fix|verify|review|deploy'), k.stderr);
  const l = route(['--level', 'L9'], r);
  check('S5 非法 level exit=1 且列闭集', l.status === 1 && l.stderr.includes('L0|L1|L2|L3'), l.stderr);
  const nc = mkProject({ withCrit: false });
  const n = route([], nc);
  check('S5 缺判据单源 exit=1', n.status === 1);
  check('S5 缺判据单源指向 sync 升级（不自动改盘面）', n.stderr.includes('flow-kit sync'), n.stderr);
  const badHints = route(['--files', 'src/a.ts'], mkProject({ hints: 'L9 ^src/\n' }));
  check('S5 非法 hints 配置 → exit=1 且报错定位', badHints.status === 1 && badHints.stderr.includes('level-hints.txt'));
}

// ============ 场景 6：--json 机读面 ============
{
  const r = mkProject({ hints: 'L2 ^src/contracts/\n', modules: '# 注释\nbilling\norder\n' });
  const x = route(['--kind', 'fix', '--files', 'src/contracts/t.ts', '--json'], r);
  check('S6 exit=0 且 stdout 是纯 JSON', x.status === 0 && (() => { try { JSON.parse(x.stdout); return true; } catch { return false; } })(), x.stdout.slice(0, 120));
  const j = JSON.parse(x.stdout);
  check('S6 字段齐备', ['level', 'lane', 'laneKey', 'laneSource', 'kind', 'files', 'proposed', 'hintLevel', 'matched', 'underHint', 'hintsConfigured', 'nextStage', 'nextCommand', 'modules']
    .every((k) => k in j), Object.keys(j).join(','));
  check('S6 modules 读装户词表（去注释）', Array.isArray(j.modules) && j.modules.length === 2 && !j.modules.includes('# 注释'), JSON.stringify(j.modules));
  check('S6 JSON 面不含人读散文（判据面归单源）', !x.stdout.includes('能否列出'));
}

// ============ 场景 7：run 透传（参数 + 退出码 + cwd） ============
{
  const r = mkProject();
  W(path.join(r, '.agents', 'scripts', 'pipeline-run.mjs'),
    'const a = process.argv.slice(2);\n'
    + 'console.log("STUB_PIPE " + JSON.stringify(a) + " cwd=" + process.cwd());\n'
    + 'process.exit(a[0] === "boom" ? 7 : 0);\n');
  const st = run(['status'], r);
  check('S7 status 透传成功 exit=0', st.status === 0, st.stderr);
  check('S7 参数原样送达装户状态机', st.stdout.includes('STUB_PIPE ["status"]'), st.stdout.trim());
  check('S7 cwd = 装户根', st.stdout.includes(path.resolve(r).replace(/\\/g, '\\')), st.stdout.trim());
  const nx = run(['next'], r);
  check('S7 next 透传', nx.stdout.includes('["next"]'));
  const bo = run(['boom'], r);
  check('S7 装户非零退出码原样回传', bo.status === 7, `status=${bo.status}`);
  const args = run(['start', '给导入功能加审计字段'], r);
  check('S7 含空格的需求原话不被拆词', args.stdout.includes('["start","给导入功能加审计字段"]'), args.stdout.trim());
  const withDir = run(['status', '--dir', r], os.tmpdir());
  check('S7 --dir 被薄壳消费、不透传状态机', withDir.stdout.includes('["status"]'), withDir.stdout.trim());
  check('S7 --dir 仍定位到装户根', withDir.stdout.includes('STUB_PIPE') && withDir.status === 0, withDir.stderr);
  const dirEq = run([`--dir=${r}`, 'status'], os.tmpdir());
  check('S7 --dir= 形式同样被消费', dirEq.stdout.includes('["status"]'), dirEq.stdout.trim());
}

// ============ 场景 8：run 的 fail-loud 与边界 ============
{
  const r = mkProject();
  const noSub = run([], r);
  check('S8 缺子命令 exit=1', noSub.status === 1);
  check('S8 缺子命令列子命令闭集', noSub.stderr.includes('start|next|status|watch|abort'), noSub.stderr);
  check('S8 缺子命令指向宿主面驱动协议权威', noSub.stderr.includes('.agents/commands/pipeline-run.md'), noSub.stderr);
  const bare = mkProject();
  fs.unlinkSync(path.join(bare, '.agents', 'scripts', 'level-criteria.mjs'));
  const miss = run(['status'], bare);
  check('S8 缺 pipeline-run exit=1', miss.status === 1);
  check('S8 缺脚本指向 init/sync（不静默装一遍）', miss.stderr.includes('flow-kit init') && miss.stderr.includes('flow-kit sync'), miss.stderr);
  const notInstalled = run(['status'], mkProject({ withCrit: false }));
  check('S8 非装户目录 → 明确报未安装', notInstalled.stderr.includes('不是已安装 flow-kit 的项目'), notInstalled.stderr);
}

// ============ 场景 9：薄壳纪律 —— 包面不复制判据/不自带实现 ============
{
  const ex = fs.readFileSync(path.join(SRC, 'executor.mjs'), 'utf8');
  check('S9 包面不硬编码判据散文', !ex.includes('聚合投影键') && !ex.includes('能否列出'));
  check('S9 包面不硬编码泳道 low/high 口径', !/level === 'L2' \|\| level === 'L3'/.test(ex));
  // 纪律只查**代码里的引用形式**（引号包裹的实参），不查注释散文——注释里出现「不带 --no-verify」是
  // 纪律声明本身，不是违规；把它也算违规等于逼人删掉自述。
  check('S9 薄壳代码不出现 --no-verify 实参', !ex.includes("'--no-verify'") && !ex.includes('"--no-verify"'));
  check('S9 薄壳不 spawn AI 会话', !/claude|codex|opencode|gemini/.test(ex));
  check('S9 判据单源从装户面动态载入（不在包内拷一份）', ex.includes('level-criteria.mjs') && ex.includes('import('));
}

console.log(`\n合计: PASS ${pass} / FAIL ${failCount}`);
process.exit(failCount ? 1 : 0);
