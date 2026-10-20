#!/usr/bin/env node
// level-criteria.test.mjs — 级别判据机器单源套件（2026-10-13 flow-kit-route）
// 覆盖：档位闭集 / rankOf·maxLevel 边界 / hints 解析（注释·空行·CRLF·分隔）/ 非法 hints fail-loud /
//       路径下限与多命中取高 / assessLevel 就高不就低与 underHint / hints 缺失·为空两态 /
//       routeAdvice 分档输出面（负例·触达面·结构面·未配置提示）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const C = await import(pathToFileURL(path.join(SCRIPT_DIR, 'level-criteria.mjs')).href);

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const mkRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'level-criteria-'));
const wHints = (root, text) => {
  const p = path.join(root, ...C.HINTS_REL.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
};
const throwsCode = (fn, code) => {
  try { fn(); return ''; } catch (e) { return e.code === code ? 'ok' : `code=${e.code}`; }
};

// ============ 场景 1：档位闭集与排序原语 ============
{
  check('S1 档位闭集为 L1-L3（L0 已退役）', JSON.stringify(C.LEVELS) === JSON.stringify(['L1', 'L2', 'L3']));
  check('S1 rankOf 大小写不敏感', C.rankOf('l2') === 1 && C.rankOf('L3') === 2);
  check('S1 rankOf 非法档返回 null（含已退役的 L0）', C.rankOf('L9') === null && C.rankOf('L0') === null && C.rankOf('') === null && C.rankOf(undefined) === null);
  check('S1 maxLevel 取高', C.maxLevel('L1', 'L3') === 'L3' && C.maxLevel('L3', 'L1') === 'L3');
  check('S1 maxLevel 同档幂等', C.maxLevel('L2', 'L2') === 'L2');
  check('S1 maxLevel 单边非法时取合法侧', C.maxLevel('L9', 'L2') === 'L2' && C.maxLevel('L1', 'L9') === 'L1');
  check('S1 maxLevel 双边非法返回空串（不假装判得出）', C.maxLevel('L9', 'X') === '');
  check('S1 maxLevel 小写输入归一为大写', C.maxLevel('l1', 'l2') === 'L2');
}

// ============ 场景 2：hints 解析 —— 注释/空行/CRLF/档位前缀 ============
{
  const txt = [
    '# 注释行',
    '',
    '   ',
    'L2 ^src/contracts/',
    'L3 ^src/db/migrations/.*\\.sql$',
    '\tL2 \uFEFFsrc/gen/',   // 前导空白 + BOM 残留（Windows 编辑器常见）
  ].join('\r\n');
  const hints = C.parseLevelHints(txt);
  check('S2 解析出 3 条（注释/空行不计）', hints.length === 3, `实得 ${hints.length}`);
  check('S2 首条档位与正则正确', hints[0].level === 'L2' && hints[0].re === '^src/contracts/');
  check('S2 CRLF 不污染正则', hints[1].rx.test('src/db/migrations/001_init.sql'));
  check('S2 空白/BOM 前缀被 trim 掉', hints[2].rx.test('src/gen/x.ts'), `re=${hints[2].re}`);
  check('S2 无命中项不抛', C.parseLevelHints('# 全是注释\n\n').length === 0);
}

// ============ 场景 3：非法 hints fail-loud（写错配置比没配置危险） ============
{
  check('S3 非法档位行报 LEVEL_HINTS_INVALID', throwsCode(() => C.parseLevelHints('L9 ^src/'), 'LEVEL_HINTS_INVALID') === 'ok');
  check('S3 缺正发行报 LEVEL_HINTS_INVALID', throwsCode(() => C.parseLevelHints('L2'), 'LEVEL_HINTS_INVALID') === 'ok');
  check('S3 正则语法错报 LEVEL_HINTS_INVALID', throwsCode(() => C.parseLevelHints('L2 ^src/(['), 'LEVEL_HINTS_INVALID') === 'ok');
  let msg = '';
  try { C.parseLevelHints('L9 ^src/\nL2 ^ok/'); } catch (e) { msg = e.message; }
  check('S3 报文含清单路径与行号定位', msg.includes(C.HINTS_REL) && msg.includes('第 1 行'), msg);
  let msg2 = '';
  try { C.parseLevelHints('L2 ^ok/\n\nL2 ^bad/([\nL9 x'); } catch (e) { msg2 = e.message; }
  check('S3 一次聚合全部坏行行号', msg2.includes('第 3 行') && msg2.includes('第 4 行'), msg2);
  check('S3 合法行不报错（只聚合坏行）', !msg2.includes('第 2 行'), msg2);

  // 2026-10-13 executor-review 两条实测 Major 的回归锁：
  // ① 行内 `#` 注释会被编进 ERE → 含 $ 锚点时该条永不命中且**无任何报错**，
  //    路径下限与提交面兜底同时静默失效（原随包模板示例就是这个写法）。
  let c1 = '';
  try { C.parseLevelHints('L3 ^src/db/migrations/.*\\.sql$   # 迁移 SQL'); } catch (e) { c1 = e.message; }
  check('S3 行内 # 注释 → fail-loud（否则该条永不命中且静默）',
    c1.includes('LEVEL_HINTS_INVALID') || c1.includes('行内注释'), c1);
  check('S3 行内注释报文点名该行并给出正确写法', c1.includes('第 1 行') && c1.includes('单独成行'), c1);
  check('S3 转义 \\# 视为路径字符而非注释', C.parseLevelHints('L2 ^src/\\#old/').length === 1);
  check('S3 路径里的 #（前非空白）不算注释', C.parseLevelHints('L2 ^src/#old/').length === 1);

  // ② L0/L1 档被原实现接受，而提交面判低门会当真：`L0 ^docs/` 让纯文档提交被硬拦，
  //    修法还让人「升级至 L0 及以上」（L0 即最低档）。只收 L2/L3。
  let c2 = '';
  try { C.parseLevelHints('L0 ^docs/'); } catch (e) { c2 = e.message; }
  check('S3 L0 档 → fail-loud（本清单只登记 L2/L3 下限）', c2.includes('只能是 L2 或 L3'), c2);
  check('S3 L1 档同样被拒', throwsCode(() => C.parseLevelHints('L1 ^src/'), 'LEVEL_HINTS_INVALID') === 'ok');
  check('S3 拒绝低档时说明理由（登记低档只会让提交面门出手）', c2.includes('噪声') || c2.includes('不构成门槛'), c2);
}

// ============ 场景 4：路径下限与多命中取高 ============
{
  const hints = C.parseLevelHints(['L2 ^src/contracts/', 'L3 ^src/db/migrations/.*\\.sql$', 'L2 ^docs/api\\.md$'].join('\n'));
  check('S4 单命中取该档', C.hintLevelFor(hints, ['src/contracts/types.ts']).level === 'L2');
  check('S4 多文件多档取最高', C.hintLevelFor(hints, ['src/contracts/a.ts', 'src/db/migrations/002_x.sql']).level === 'L3');
  check('S4 未命中返回空串', C.hintLevelFor(hints, ['src/ui/button.tsx']).level === '');
  check('S4 反斜杠路径归一为 /', C.hintLevelFor(hints, ['src\\contracts\\a.ts']).level === 'L2');
  check('S4 ./ 前缀剥离', C.hintLevelFor(hints, ['./src/contracts/a.ts']).level === 'L2');
  // ERE 按「仓库相对路径」语义写，`^` 锚定即不命中绝对路径 —— 这是契约不是漏洞：
  // 命中绝对路径说明清单写成了无锚 ERE，容易误伤同名目录。
  check('S4 `^` 锚定规则不命中绝对路径（清单契约=仓库相对路径）',
    C.hintLevelFor(hints, ['C:/repo/src/db/migrations/003_y.sql']).level === '');
  check('S4 无锚 ERE 命中子串（清单作者自选口径）',
    C.hintLevelFor(C.parseLevelHints('L3 migrations/.*\\.sql$'), ['C:/repo/src/db/migrations/003_y.sql']).level === 'L3');
  const m = C.hintLevelFor(hints, ['src/contracts/a.ts', 'src/db/migrations/002_x.sql']);
  check('S4 matched 给出命中证据', m.matched.length === 2 && m.matched.some((s) => s.includes('src/contracts/a.ts')), JSON.stringify(m.matched));
  check('S4 matched 去重', new Set(m.matched).size === m.matched.length);
  check('S4 空输入不抛', C.hintLevelFor(hints, []).level === '' && C.hintLevelFor([], ['a']).level === '');
}

// ============ 场景 5：assessLevel —— 就高不就低 / underHint / 两态配置 ============
{
  const r = mkRoot();
  wHints(r, 'L3 ^src/db/migrations/.*\\.sql$\n');
  const noProposed = C.assessLevel(r, { files: ['src/db/migrations/001_init.sql'] });
  check('S5 无建议档时按 hint 抬档', noProposed.level === 'L3' && noProposed.hintLevel === 'L3');
  check('S5 无建议档不算 underHint（无档可低）', noProposed.underHint === false);
  check('S5 hintsConfigured=true', noProposed.hintsConfigured === true);

  const up = C.assessLevel(r, { files: ['src/db/migrations/001_init.sql'], proposed: 'L3' });
  check('S5 建议档≥下限 → 不提示', up.underHint === false && up.level === 'L3');

  const down = C.assessLevel(r, { files: ['src/db/migrations/001_init.sql'], proposed: 'L1' });
  check('S5 建议档低于下限 → underHint=true', down.underHint === true);
  check('S5 就高不就低：仍取 L3（建议档只作提示不压档）', down.level === 'L3');
  check('S5 proposed 归一为大写回显', down.proposed === 'L1');

  const noHit = C.assessLevel(r, { files: ['src/ui/button.tsx'], proposed: 'L2' });
  check('S5 无命中时尊重建议档', noHit.level === 'L2' && noHit.hintLevel === '' && noHit.underHint === false);
}

// ============ 场景 6：hints 缺失 vs 为空 —— 两态都算「未配置」但不崩 ============
{
  const missing = C.assessLevel(mkRoot(), { files: ['src/a.ts'] });
  check('S6 文件缺失 → hintsConfigured=false', missing.hintsConfigured === false);
  check('S6 文件缺失 → 按 L1 起步（不假装判得出）', missing.level === '' && missing.hintLevel === '');

  const empty = mkRoot();
  wHints(empty, '# 只有注释\n');
  const e = C.assessLevel(empty, { files: ['src/a.ts'], proposed: 'L2' });
  check('S6 清单存在但为空 → hintsConfigured=false', e.hintsConfigured === false);
  check('S6 空清单不压建议档', e.level === 'L2');
}

// ============ 场景 7：routeAdvice 分档输出面 ============
{
  const l1 = C.routeAdvice('L1', { hintsConfigured: true });
  check('S7 L1 输出负例清单', C.L1_NEGATIVES.every((s) => l1.includes(s)));
  check('S7 L1 不输出 L2/L3 触达面', !l1.includes('共享契约') && !l1.includes('迁移 SQL'));
  check('S7 一律输出自查句', l1.includes(C.SELF_CHECK));
  check('S7 一律声明机器边界（语义面不由机器裁决）', l1.includes('语义'));

  const l2 = C.routeAdvice('L2', { hintsConfigured: true });
  check('S7 L2 输出四类触达面', C.L2_SURFACES.every((s) => l2.includes(s)));
  check('S7 L2 不输出 L3 结构面', !l2.includes('DI 链：注册'));
  check('S7 L2 不输出负例面', !l2.includes('【负例'));

  const l3 = C.routeAdvice('L3', { hintsConfigured: true });
  check('S7 L3 同时输出 L2 触达面与 L3 结构面', C.L2_SURFACES.every((s) => l3.includes(s)) && C.L3_SURFACES.every((s) => l3.includes(s)));

  // L0 已退役（2026-10-13）：不在 LEVELS 闭集 → routeAdvice 只报「未知档」，
  // 不再有语义行、也不产生下溢（下溢概念随 L0 退役消失）。
  const l0 = C.routeAdvice('L0', { hintsConfigured: true });
  check('S7 已退役的 L0 → 无语义行（未知档），不产生下溢', l0.includes('建议级别：L0 —— （未知档）') && !l0.includes('【负例'));

  // 2026-10-13 executor-review：hints 未配置 / 低于下限两条**状态**信息已移出 routeAdvice，
  //   改由 route 的降级块（executor.mjs degradations）单一输出——原实现把同一事实在文本面打两遍。
  //   判据面留在本函数，状态面归降级块；此处锁死「不再重复」。
  const un = C.routeAdvice('L1', { hintsConfigured: false });
  check('S7 routeAdvice 不再输出 hints 状态（降级块唯一出口）',
    !un.includes('未配置') && !un.includes('机器面给不出档位提示'), un);
  const under = C.routeAdvice('L3', { hintsConfigured: true, underHint: true, proposed: 'L1', hintLevel: 'L3', matched: ['L3←src/db/migrations/001_init.sql'] });
  check('S7 routeAdvice 不再输出 underHint 状态（降级块唯一出口）',
    !under.includes('低于路径提示下限') && !under.includes('src/db/migrations/001_init.sql'), under);
  check('S7 但判据面照常输出（自查句 + 机器边界声明）',
    under.includes(C.SELF_CHECK) && under.includes('语义'), under);

  check('S7 未知档位标注未知而非假装', C.routeAdvice('L9', {}).includes('（未知档）'));
  check('S7 空档位回落 L1', C.routeAdvice('', {}).includes('建议级别：L1'));
}

// ============ 场景 8：单源纪律 —— md 不再承载判据散文 ============
{
  const cmdPath = path.join(SCRIPT_DIR, '..', 'commands', 'new-task.md');
  const md = fs.readFileSync(cmdPath, 'utf8');
  check('S8 new-task.md 指向判据单源', md.includes('level-criteria.mjs'));
  check('S8 new-task.md 登记 level-hints.txt', md.includes('.agents/level-hints.txt'));
  check('S8 new-task.md 不再内嵌 L2 四类触达面散文', !md.includes('聚合投影键'));
  check('S8 new-task.md 不再内嵌判低负例散文', !md.includes('单模块内部重构且无对外契约变化'));
  check('S8 new-task.md 不再内嵌自查句原文', !md.includes('能否列出 ≥2 个受影响的消费方'));

  // 过期指针回归：§级别判断 已改为「引用单源」，别处再指向它就是指向一个不再承载判据的章节。
  // （改写该节时同步发现 design.md 与 fill-intent.mjs 两处指针，测试锁死免得日后再长出来。）
  const design = fs.readFileSync(path.join(SCRIPT_DIR, '..', 'commands', 'design.md'), 'utf8');
  const fillIntent = fs.readFileSync(path.join(SCRIPT_DIR, 'fill-intent.mjs'), 'utf8');
  const cmdsDir = path.join(SCRIPT_DIR, '..', 'commands');
  const cmdHits = fs.readdirSync(cmdsDir)
    .filter((f) => f.endsWith('.md'))
    .filter((f) => fs.readFileSync(path.join(cmdsDir, f), 'utf8').match(/§\s*级别判断|new-task\.md[^）)]*级别判断/));
  check('S8 无 md 指令指向已改写的 §级别判断', cmdHits.length === 0, cmdHits.join(','));
  check('S8 design.md 指向判据单源', design.includes('level-criteria.mjs'));
  check('S8 fill-intent 不再指向 §级别判断', !fillIntent.includes('§级别判断'));

  // 面扩到 md 之外：首轮改写漏掉的三处（pipeline-run 工单 / check-lane-surface 门禁报文 /
  // lane-surfaces.txt 头注释）都在 .mjs 与 .txt 里，只扫 commands/*.mjs 会漏。扫描整个装户面。
  const AGENTS_DIR = path.join(SCRIPT_DIR, '..');
  const stale = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'scripts' && dir !== AGENTS_DIR) continue; // 避免重复扫
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'cache') walk(abs); continue; }
      if (!/\.(mjs|txt|md|json)$/.test(e.name)) continue;
      if (e.name.endsWith('.test.mjs')) continue; // 含本文件（顶层 await 环境下不能用 __filename）
      const t = fs.readFileSync(abs, 'utf8');
      if (/new-task\.md[^\n]{0,40}§\s*级别判断/.test(t)) stale.push(path.relative(AGENTS_DIR, abs).replace(/\\/g, '/'));
    }
  };
  walk(AGENTS_DIR);
  check('S8 装户面无指向 §级别判断的过期指针', stale.length === 0, stale.join(','));

  // 判据**散文本身**的回归（2026-10-13 executor-review）：原护栏只锁 new-task.md 里 3 个字面串，
  //   于是判据换了措辞就能在别处重新长回来——实测 design.md 与 fill-intent.mjs 各存了一份
  //   （后者把 L2 列成五项，单源是四项）。故改为**按单源词条扫判级面**：单源与本测试之外，
  //   凡列举/复述判据闭集的文件即判红。
  //   扫描面 = 会指导判级的两类件（命令 md + 起草工具脚本）；不含 level-hints.txt——那是路径
  //   示例文件，其注释里提到「迁移 SQL」「DI 链」是路径举例，不是判据复述。
  const CRITERIA_TERMS = ['编码权威', '共享契约', '既有接口语义', '全局横切口径', 'DI 链', '认证与中间件管线'];
  const ALLOW = new Set(['level-criteria.mjs', 'level-criteria.test.mjs']);
  const proseHits = [];
  const scanProse = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(AGENTS_DIR, abs).replace(/\\/g, '/');
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'cache') scanProse(abs); continue; }
      if (!/\.(mjs|md)$/.test(e.name)) continue;
      if (e.name.endsWith('.test.mjs') || ALLOW.has(e.name)) continue;
      // 只扫判级面：命令 md + 起草工具（fill-*）。其余脚本引用单源属正常。
      if (!/^commands\//.test(rel) && !/^scripts\/fill-/.test(rel)) continue;
      const t = fs.readFileSync(abs, 'utf8');
      const hit = CRITERIA_TERMS.filter((w) => t.includes(w));
      if (hit.length) proseHits.push(`${rel} → ${hit.join('/')}`);
    }
  };
  scanProse(AGENTS_DIR);
  check('S8 判级面不复述判据闭集（词条只在单源一处）', proseHits.length === 0, proseHits.join(' | '));
  check('S8 design.md 只留流程映射 + 指向单源',
    design.includes('L2_SURFACES') && design.includes('L3_SURFACES') && proseHits.every((h) => !h.startsWith('commands/design.md')),
    proseHits.filter((h) => h.startsWith('commands/design.md')).join('|'));
  check('S8 fill-intent 触达红线改为对照单源（不再自带五项/四项清单）',
    fillIntent.includes('L2_SURFACES') && fillIntent.includes('L3_SURFACES'), '');

  // B3：route 曾是「可绕旁路」——装户面唯一提及只是 §4 里一行 bash 提示，无任何必跑语义，
  //   而机器又无法发现它没被调用（定级早于改动面确定，无可比对的记录面，见 ARCHITECTURE §5）。
  //   故把接线强度锁在**流程文本**上：必跑标记 + 不给 --files 拿不到下限 + 跳过须写理由 + 兜底门。
  const nt = fs.readFileSync(path.join(SCRIPT_DIR, '..', 'commands', 'new-task.md'), 'utf8');
  check('S8 new-task.md 定级第 0 步标注必跑 route（非可选提示）', /必跑/.test(nt) && /flow-kit route --files/.test(nt));
  check('S8 new-task.md 说明不给 --files 就拿不到路径下限', nt.includes('不给 `--files` 就拿不到路径下限'));
  check('S8 new-task.md 要求跳过时写明理由', nt.includes('写明理由'));
  check('S8 new-task.md 点名提交面兜底门', nt.includes('check-lane-surface'));
  check('S8 new-task.md 声明机器无法发现跳过（诚实边界）', nt.includes('无法**发现'));
}

// ============ 场景 9：装户模板面 —— level-hints.txt 随模板下发且默认为空 ============
{
  const tpl = path.join(SCRIPT_DIR, '..', 'level-hints.txt');
  const ok = fs.existsSync(tpl);
  check('S9 模板带 level-hints.txt', ok);
  if (ok) {
    const txt = fs.readFileSync(tpl, 'utf8');
    check('S9 默认无有效条目（内容项目私有）', C.parseLevelHints(txt).length === 0);
    check('S9 说明格式为 `<档位> <ERE>`', txt.includes('`<档位> <ERE>`'), txt.slice(0, 200));
    check('S9 含被注释掉的 L2/L3 示例行', /#\s*L3\s+\^/.test(txt) && /#\s*L2\s+\^/.test(txt));
    check('S9 说明默认留空与项目私有立场', txt.includes('默认留空') && txt.includes('项目私有'));
  }
}

console.log(`\n合计: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
