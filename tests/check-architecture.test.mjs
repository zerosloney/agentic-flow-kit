import { test } from 'node:test';
import { makeTmp } from './helpers/tmp.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(KIT, 'templates', 'engine', '.agents', 'hooks', 'check-architecture.mjs');
const CONFIG = '.agents/hooks/architecture-redlines.json';

function tmpRepo() {
  const dir = makeTmp('flow-kit-arch-');
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function write(dir, rel, text) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function writeConfig(dir, config) {
  write(dir, CONFIG, `${JSON.stringify(config, null, 2)}\n`);
}

function runHook(dir) {
  return spawnSync(process.execPath, [HOOK], { cwd: dir, encoding: 'utf8' });
}

// 违例 stderr 的组结构：`架构红线违例（<config>）：` 头 + 若干组（`- message：` + finding 行，组间空行）
function parseGroups(stderr) {
  const lines = stderr.split(/\r?\n/);
  assert.equal(lines[0], `架构红线违例（${CONFIG}）：`);
  const groups = [];
  let current = null;
  for (const line of lines.slice(1)) {
    if (line === '') { current = null; continue; }
    if (line.startsWith('- ')) {
      assert.ok(line.endsWith('：'), line);
      current = { message: line.slice(2, -1), findings: [] };
      groups.push(current);
    } else if (current) {
      current.findings.push(line);
    } else {
      assert.fail(`意外输出行：${line}`);
    }
  }
  return groups;
}

// 夹具行数组里唯一行的 1-based 行号，避免手数行号出错
const ln = (lines, text) => lines.indexOf(text) + 1;

test('未配置：配置文件不存在 → SKIP、exit 0、stdout 为空', () => {
  const dir = tmpRepo();
  const r = runHook(dir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /SKIP 未配置架构红线/);
  assert.match(r.stderr, /architecture-redlines\.json/);
});

test('未配置：配置为空对象或三数组全空 → SKIP、exit 0', () => {
  const dir = tmpRepo();
  writeConfig(dir, {});
  let r = runHook(dir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /SKIP/);
  writeConfig(dir, { forbidden: [], noNavigationProperties: [], catchRequires: [] });
  r = runHook(dir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /SKIP/);
});

test('forbidden：contains 子串命中 + 单文件目标', () => {
  const dir = tmpRepo();
  write(dir, 'src/Legacy.cs', 'namespace Legacy;\npublic class Legacy { } // TODO 拆掉\n');
  writeConfig(dir, {
    forbidden: [{ id: 'no-todo', targets: ['src/Legacy.cs'], contains: ['TODO'], message: '遗留文件禁止新增 TODO' }],
  });
  const r = runHook(dir);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stdout, '');
  const groups = parseGroups(r.stderr);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].message, '遗留文件禁止新增 TODO');
  assert.deepEqual(groups[0].findings, ['src/Legacy.cs:2:public class Legacy { } // TODO 拆掉']);
});

test('forbidden：matches 正则命中', () => {
  const dir = tmpRepo();
  write(dir, 'src/A.cs', 'var x = LoadData(1);\n');
  writeConfig(dir, {
    forbidden: [{ id: 'no-direct-load', targets: ['src/A.cs'], matches: ['LoadData\\('], message: '禁止直连数据访问' }],
  });
  const r = runHook(dir);
  assert.equal(r.status, 1, r.stderr);
  const groups = parseGroups(r.stderr);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].findings, ['src/A.cs:1:var x = LoadData(1);']);
});

test('forbidden：unless 行级豁免与 exclude 整文件豁免', () => {
  const dir = tmpRepo();
  write(dir, 'src/Keep.cs', 'Log(Warning, ex.InnerException);\nthrow new Exception(ex.InnerException);\n');
  write(dir, 'src/Skip.cs', 'throw new Exception(ex.InnerException);\n');
  writeConfig(dir, {
    forbidden: [{
      id: 'no-inner-exception',
      targets: ['src'],
      contains: ['InnerException'],
      unless: 'Log\\(Warning',
      exclude: ['src/Skip.cs'],
      message: '异常细节只许进日志',
    }],
  });
  const r = runHook(dir);
  assert.equal(r.status, 1, r.stderr);
  const groups = parseGroups(r.stderr);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].findings, ['src/Keep.cs:2:throw new Exception(ex.InnerException);']);
});

test('forbidden：目录目标递归收集、默认只收 .cs、跳过 bin/obj', () => {
  const dir = tmpRepo();
  write(dir, 'src/deep/Nested.cs', 'callLegacy();\n');
  write(dir, 'src/deep/Notes.txt', 'callLegacy();\n');
  write(dir, 'src/obj/Generated.cs', 'callLegacy();\n');
  write(dir, 'src/bin/Debug/Build.cs', 'callLegacy();\n');
  writeConfig(dir, {
    forbidden: [{ id: 'no-legacy-call', targets: ['src'], contains: ['callLegacy'], message: '禁止调用遗留通道' }],
  });
  const r = runHook(dir);
  assert.equal(r.status, 1, r.stderr);
  const groups = parseGroups(r.stderr);
  assert.deepEqual(groups[0].findings, ['src/deep/Nested.cs:1:callLegacy();']);
});

test('forbidden：glob 目标，* 单段通配与 ** 跨段通配', () => {
  const dir = tmpRepo();
  write(dir, 'app/one/Bad.cs', 'evil();\n');
  write(dir, 'app/one/sub/Deep.cs', 'evil();\n');
  write(dir, 'app/two/Ok.cs', 'fine();\n');
  writeConfig(dir, {
    forbidden: [
      { id: 'star-segment', targets: ['app/*/Bad.cs'], contains: ['evil'], message: '星号只配单段' },
      { id: 'double-star', targets: ['app/**/*.cs'], contains: ['evil'], message: '双星跨段' },
    ],
  });
  const r = runHook(dir);
  assert.equal(r.status, 1, r.stderr);
  const groups = parseGroups(r.stderr);
  assert.deepEqual(groups.map((g) => g.message), ['星号只配单段', '双星跨段']);
  assert.deepEqual(groups[0].findings, ['app/one/Bad.cs:1:evil();']);
  assert.deepEqual(groups[1].findings, ['app/one/Bad.cs:1:evil();', 'app/one/sub/Deep.cs:1:evil();']);
});

test('forbidden：once 只报第一条', () => {
  const dir = tmpRepo();
  write(dir, 'src/Multi.cs', 'bad();\nbad();\n');
  write(dir, 'src/More.cs', 'bad();\n');
  writeConfig(dir, {
    forbidden: [{ id: 'no-bad', targets: ['src'], contains: ['bad'], message: '禁 bad', once: true }],
  });
  const r = runHook(dir);
  assert.equal(r.status, 1, r.stderr);
  const groups = parseGroups(r.stderr);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].findings, ['src/More.cs:1:bad();']);
});

test('门禁目标缺失：字面缺失 fail-closed、optional 跳过、glob 静态前缀缺失同样 fail-closed', () => {
  const dir = tmpRepo();
  write(dir, 'src/Real.cs', 'ok();\n');

  writeConfig(dir, {
    forbidden: [{ id: 'missing-dir', targets: ['ghost-dir'], contains: ['x'], message: '字面目录缺失' }],
  });
  let r = runHook(dir);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /门禁目标缺失/);
  assert.match(r.stderr, /ghost-dir/);

  writeConfig(dir, {
    forbidden: [
      { id: 'missing-dir-opt', targets: ['ghost-dir'], contains: ['x'], message: 'optional 目录', optional: true },
      { id: 'missing-file-opt', targets: ['ghost-file.cs'], contains: ['x'], message: 'optional 文件', optional: true },
    ],
  });
  r = runHook(dir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');

  writeConfig(dir, {
    forbidden: [{ id: 'missing-glob', targets: ['ghost-prefix/**/*.cs'], contains: ['x'], message: 'glob 前缀缺失' }],
  });
  r = runHook(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /门禁目标缺失/);
  assert.match(r.stderr, /ghost-prefix/);
});

test('配置错误：非法 JSON / 未知顶层键 / 非法正则 / id 重复或格式不符 / targets 空 / 缺匹配项 → exit 2', () => {
  const dir = tmpRepo();
  write(dir, 'src/A.cs', 'x();\n');
  const cases = [
    ['{ not json', /不是合法 JSON/],
    [{ forbidden: [], unknownKey: [] }, /未知顶层键/],
    [{ forbidden: [{ id: 'bad-re', targets: ['src'], matches: ['[unclosed'], message: 'm' }] }, /正则非法/],
    [{ forbidden: [{ id: 'dup', targets: ['src'], contains: ['x'], message: 'a' }, { id: 'dup', targets: ['src'], contains: ['x'], message: 'b' }] }, /重复/],
    [{ forbidden: [{ id: 'Bad_Id', targets: ['src'], contains: ['x'], message: 'm' }] }, /id.*\[a-z0-9-\]/],
    [{ forbidden: [{ id: 'empty-targets', targets: [], contains: ['x'], message: 'm' }] }, /targets/],
    [{ forbidden: [{ id: 'no-needles', targets: ['src'], message: 'm' }] }, /contains.*matches/],
  ];
  for (const [config, pattern] of cases) {
    if (typeof config === 'string') write(dir, CONFIG, config);
    else writeConfig(dir, config);
    const r = runHook(dir);
    assert.equal(r.status, 2, JSON.stringify(config));
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /配置错误/);
    assert.match(r.stderr, pattern);
  }
});

test('noNavigationProperties：集合与同类型导航判违例，标量/枚举不误报，extraTypeNames 生效', () => {
  const dir = tmpRepo();
  const noteLines = ['public class Note', '{', '  public External Ref { get; set; }', '}'];
  const orderLines = [
    'public class Order',
    '{',
    '  public int Id { get; set; }',
    '  public string Title { get; set; }',
    '  public OrderStatus Status { get; set; }',
    '  public Order? Parent { get; set; }',
    '  public virtual Order Root { get; set; }',
    '  public ICollection<Order> Children { get; set; }',
    '  public List<OrderStatus> History { get; set; }',
    '}',
  ];
  const relatedLines = ['public class Related', '{', '  public Widget Part { get; set; }', '}'];
  write(dir, 'entities/Note.cs', `${noteLines.join('\n')}\n`);
  write(dir, 'entities/Order.cs', `${orderLines.join('\n')}\n`);
  write(dir, 'entities/OrderStatus.cs', 'public enum OrderStatus { New }\n');
  write(dir, 'entities/Related.cs', `${relatedLines.join('\n')}\n`);
  write(dir, 'entities/Widget.cs', 'public class Widget\n{\n  public int Id { get; set; }\n}\n');
  const rule = { id: 'no-nav', dir: 'entities', message: '实体禁导航属性', extraTypeNames: ['External'] };
  writeConfig(dir, { noNavigationProperties: [rule] });

  let r = runHook(dir);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stdout, '');
  let groups = parseGroups(r.stderr);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].message, '实体禁导航属性');
  assert.deepEqual(groups[0].findings, [
    `Note.cs:${ln(noteLines, '  public External Ref { get; set; }')} Ref : External`,
    `Order.cs:${ln(orderLines, '  public Order? Parent { get; set; }')} Parent : Order?`,
    `Order.cs:${ln(orderLines, '  public virtual Order Root { get; set; }')} Root : Order`,
    `Order.cs:${ln(orderLines, '  public ICollection<Order> Children { get; set; }')} Children : ICollection<Order>`,
    `Related.cs:${ln(relatedLines, '  public Widget Part { get; set; }')} Part : Widget`,
  ]);

  // 去掉 extraTypeNames：External 不再视为实体类型，Note 的属性不再违例
  writeConfig(dir, { noNavigationProperties: [{ id: rule.id, dir: rule.dir, message: rule.message }] });
  r = runHook(dir);
  assert.equal(r.status, 1, r.stderr);
  groups = parseGroups(r.stderr);
  assert.deepEqual(groups[0].findings, [
    `Order.cs:${ln(orderLines, '  public Order? Parent { get; set; }')} Parent : Order?`,
    `Order.cs:${ln(orderLines, '  public virtual Order Root { get; set; }')} Root : Order`,
    `Order.cs:${ln(orderLines, '  public ICollection<Order> Children { get; set; }')} Children : ICollection<Order>`,
    `Related.cs:${ln(relatedLines, '  public Widget Part { get; set; }')} Part : Widget`,
  ]);
});

test('catchRequires：缺符号判违例、含符号通过、exclude 豁免文件', () => {
  const dir = tmpRepo();
  const oneLines = [
    'public class OneController',
    '{',
    '  public void Save()',
    '  {',
    '    try',
    '    {',
    '      Submit();',
    '    }',
    '    catch (DbUpdateConcurrencyException)',
    '    {',
    '      Log("conflict");',
    '    }',
    '  }',
    '}',
  ];
  const twoLines = [
    'public class TwoController',
    '{',
    '  public void Save()',
    '  {',
    '    try',
    '    {',
    '      Submit();',
    '    }',
    '    catch (DbUpdateConcurrencyException)',
    '    {',
    '      ReturnConflict(ApiMessages.DataStateInvalid);',
    '    }',
    '  }',
    '}',
  ];
  write(dir, 'ctrl/OneController.cs', `${oneLines.join('\n')}\n`);
  write(dir, 'ctrl/TwoController.cs', `${twoLines.join('\n')}\n`);
  const rule = {
    id: 'concurrency-message',
    files: ['ctrl/OneController.cs', 'ctrl/TwoController.cs'],
    catch: 'catch (DbUpdateConcurrencyException)',
    require: 'ApiMessages.DataStateInvalid',
    message: '并发 catch 必须返回统一文案',
  };
  writeConfig(dir, { catchRequires: [rule] });
  let r = runHook(dir);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stdout, '');
  let groups = parseGroups(r.stderr);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].message, '并发 catch 必须返回统一文案');
  assert.deepEqual(groups[0].findings, [`ctrl/OneController.cs:${ln(oneLines, '    catch (DbUpdateConcurrencyException)')}:catch (DbUpdateConcurrencyException)`]);

  // exclude 掉唯一违例文件后整体干净
  writeConfig(dir, { catchRequires: [{ ...rule, exclude: ['ctrl/OneController.cs'] }] });
  r = runHook(dir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('已配置且干净 → exit 0 且 stdout/stderr 全空', () => {
  const dir = tmpRepo();
  write(dir, 'src/Clean.cs', 'ok();\n');
  writeConfig(dir, {
    forbidden: [{ id: 'nothing', targets: ['src'], contains: ['missing-marker'], message: '无违例规则' }],
    noNavigationProperties: [{ id: 'no-nav', dir: 'src', message: '无导航属性' }],
    catchRequires: [{ id: 'catch-ok', files: ['src/Clean.cs'], catch: 'never-appears', require: 'x', message: '无 catch' }],
  });
  const r = runHook(dir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('不在 git 仓库内 → exit 1', () => {
  const dir = makeTmp('flow-kit-arch-nogit-');
  const r = runHook(dir);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /不在 git 仓库内/);
});

test('迁移等价：旧 6 条红线以中性配置复刻，每条规则一处违例全报，修掉后干净通过', () => {
  const dir = tmpRepo();

  // ---- 中性夹具（Acme）----
  const csproj = '<ProjectReference Include="..\\Acme.Infrastructure\\Acme.Infrastructure.csproj" />';
  write(dir, 'backend/acme/Acme.Application/Acme.Application.csproj', `${csproj}\n`);
  const orderServiceLines = [
    'using Acme.Infrastructure;',
    'public class OrderService',
    '{',
    '  public void Load()',
    '  {',
    '    db.Orders.Include(o => o.Items).ToList();',
    '  }',
    '}',
  ];
  write(dir, 'backend/acme/Acme.Application/Services/OrderService.cs', `${orderServiceLines.join('\n')}\n`);
  const ordersCtrlLines = [
    'using Acme.Infrastructure;',
    'public class AcmeOrdersController',
    '{',
    '  private readonly AcmeDbContext _db;',
    '  public IActionResult Save()',
    '  {',
    '    try',
    '    {',
    '      _db.SaveChanges();',
    '    }',
    '    catch (DbUpdateConcurrencyException)',
    '    {',
    '      return Conflict("该数据已被其他用户修改，请刷新后再试");',
    '    }',
    '    try',
    '    {',
    '      Load();',
    '    }',
    '    catch (Exception ex)',
    '    {',
    '      throw new Exception(ex.InnerException);',
    '    }',
    '  }',
    '}',
  ];
  write(dir, 'backend/acme/Acme.API/Controllers/AcmeOrdersController.cs', `${ordersCtrlLines.join('\n')}\n`);
  // 豁免面：Codes 控制器（DbContext 豁免 + 日志行 InnerException 豁免），保持原样不修
  write(dir, 'backend/acme/Acme.API/Controllers/AcmeCodesController.cs', [
    'public class AcmeCodesController',
    '{',
    '  private readonly AcmeDbContext _codes;',
    '  public IActionResult Index()',
    '  {',
    '    try',
    '    {',
    '      Load();',
    '    }',
    '    catch (Exception ex)',
    '    {',
    '      Log(Warning, ex.InnerException);',
    '      return Problem();',
    '    }',
    '  }',
    '}',
  ].join('\n') + '\n');
  const changesCtrlLines = [
    'public class AcmeChangesController',
    '{',
    '  public IActionResult Save()',
    '  {',
    '    try',
    '    {',
    '      Submit();',
    '    }',
    '    catch (DbUpdateConcurrencyException)',
    '    {',
    '      return Conflict(ApiMessages.DataStateInvalid);',
    '    }',
    '  }',
    '}',
  ];
  write(dir, 'backend/acme/Acme.API/Controllers/AcmeChangesController.cs', `${changesCtrlLines.join('\n')}\n`);
  // 排除面：Outbound 控制器沿用自有并发口径（不含被执法的旧文案），catch 从 catchRequires 里排除
  write(dir, 'backend/acme/Acme.API/Controllers/AcmeOutboundController.cs', [
    'public class AcmeOutboundController',
    '{',
    '  public IActionResult Save()',
    '  {',
    '    try',
    '    {',
    '      Submit();',
    '    }',
    '    catch (DbUpdateConcurrencyException)',
    '    {',
    '      return Conflict("data-state-legacy-outbound");',
    '    }',
    '  }',
    '}',
  ].join('\n') + '\n');
  const dbContextLines = [
    'public class AcmeDbContext',
    '{',
    '  protected override void OnModelCreating(ModelBuilder b)',
    '  {',
    '    b.Entity<Order>().HasOne(x => x.Owner).WithMany().HasForeignKey("OwnerId");',
    '  }',
    '}',
  ];
  write(dir, 'backend/acme/Acme.Infrastructure/Data/AcmeDbContext.cs', `${dbContextLines.join('\n')}\n`);
  const widgetLines = [
    'public class Widget',
    '{',
    '  public int Id { get; set; }',
    '  public ICollection<Widget> Parts { get; set; }',
    '}',
  ];
  write(dir, 'backend/acme/Acme.Domain/Entities/Widget.cs', `${widgetLines.join('\n')}\n`);
  write(dir, 'backend/acme/Acme.Domain/Entities/Gadget.cs', [
    'public class Gadget',
    '{',
    '  public int Id { get; set; }',
    '  public string Code { get; set; }',
    '}',
  ].join('\n') + '\n');

  // ---- 与旧脚本 6 条红线一一对应的配置 ----
  const ordersCtrlPath = 'backend/acme/Acme.API/Controllers/AcmeOrdersController.cs';
  const changesCtrlPath = 'backend/acme/Acme.API/Controllers/AcmeChangesController.cs';
  const outboundCtrlPath = 'backend/acme/Acme.API/Controllers/AcmeOutboundController.cs';
  writeConfig(dir, {
    forbidden: [
      { id: 'app-csproj-no-infra', targets: ['backend/acme/Acme.Application'], ext: ['.csproj'], contains: ['Infrastructure'], message: 'Application csproj 禁引用 Infrastructure 项目' },
      { id: 'app-no-dbcontext', targets: ['backend/acme/Acme.Application'], contains: ['AcmeDbContext'], matches: ['using Acme\\.Infrastructure'], message: 'Application 代码禁 DbContext / Infrastructure 命名空间' },
      { id: 'api-no-dbcontext', targets: ['backend/acme/Acme.API/Controllers'], contains: ['AcmeDbContext'], exclude: ['**/AcmeCodesController.cs'], message: 'API 层禁直接注入 DbContext' },
      { id: 'ctx-no-relations', targets: ['backend/acme/Acme.Infrastructure/Data/AcmeDbContext.cs'], matches: ['HasOne|HasMany|WithOne|WithMany|HasForeignKey|OnDelete'], message: 'DbContext 禁关系映射' },
      { id: 'no-include', targets: ['backend/acme/Acme.Application', 'backend/acme/Acme.API'], matches: ['\\.Include\\('], message: '禁 EF Include' },
      { id: 'no-inner-exception', targets: ['backend/acme/Acme.API/Controllers'], contains: ['InnerException'], unless: 'Log\\(Warning', message: 'Controller 禁透传 InnerException' },
      { id: 'legacy-message', targets: [ordersCtrlPath, changesCtrlPath, outboundCtrlPath], contains: ['该数据已被其他用户修改，请刷新后再试'], message: '并发文案必须走统一单源' },
    ],
    noNavigationProperties: [
      { id: 'entities-no-nav', dir: 'backend/acme/Acme.Domain/Entities', extraTypeNames: ['Widget', 'Gadget', 'BaseThing'], message: '实体禁导航属性' },
    ],
    catchRequires: [
      { id: 'concurrency-catch', files: [ordersCtrlPath, changesCtrlPath, outboundCtrlPath], catch: 'catch (DbUpdateConcurrencyException)', require: 'ApiMessages.DataStateInvalid', exclude: ['**/AcmeOutboundController.cs'], message: '并发 catch 必须返回统一文案' },
    ],
  });

  const r = runHook(dir);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stdout, '');
  const groups = parseGroups(r.stderr);
  assert.deepEqual(groups.map((g) => g.message), [
    'Application csproj 禁引用 Infrastructure 项目',
    'Application 代码禁 DbContext / Infrastructure 命名空间',
    'API 层禁直接注入 DbContext',
    'DbContext 禁关系映射',
    '禁 EF Include',
    'Controller 禁透传 InnerException',
    '并发文案必须走统一单源',
    '实体禁导航属性',
    '并发 catch 必须返回统一文案',
  ]);
  assert.deepEqual(groups.map((g) => g.findings), [
    [`backend/acme/Acme.Application/Acme.Application.csproj:1:${csproj}`],
    [`backend/acme/Acme.Application/Services/OrderService.cs:${ln(orderServiceLines, 'using Acme.Infrastructure;')}:using Acme.Infrastructure;`],
    [`${ordersCtrlPath}:${ln(ordersCtrlLines, '  private readonly AcmeDbContext _db;')}:  private readonly AcmeDbContext _db;`],
    [`backend/acme/Acme.Infrastructure/Data/AcmeDbContext.cs:${ln(dbContextLines, '    b.Entity<Order>().HasOne(x => x.Owner).WithMany().HasForeignKey("OwnerId");')}:    b.Entity<Order>().HasOne(x => x.Owner).WithMany().HasForeignKey("OwnerId");`],
    [`backend/acme/Acme.Application/Services/OrderService.cs:${ln(orderServiceLines, '    db.Orders.Include(o => o.Items).ToList();')}:    db.Orders.Include(o => o.Items).ToList();`],
    [`${ordersCtrlPath}:${ln(ordersCtrlLines, '      throw new Exception(ex.InnerException);')}:      throw new Exception(ex.InnerException);`],
    [`${ordersCtrlPath}:${ln(ordersCtrlLines, '      return Conflict("该数据已被其他用户修改，请刷新后再试");')}:      return Conflict("该数据已被其他用户修改，请刷新后再试");`],
    [`Widget.cs:${ln(widgetLines, '  public ICollection<Widget> Parts { get; set; }')} Parts : ICollection<Widget>`],
    [`${ordersCtrlPath}:${ln(ordersCtrlLines, '    catch (DbUpdateConcurrencyException)')}:catch (DbUpdateConcurrencyException)`],
  ]);

  // ---- 逐个修掉违例（豁免面保持原样），应完全干净 ----
  write(dir, 'backend/acme/Acme.Application/Acme.Application.csproj', '<ProjectReference Include="..\\Acme.Domain\\Acme.Domain.csproj" />\n');
  write(dir, 'backend/acme/Acme.Application/Services/OrderService.cs', [
    'using Acme.Domain;',
    'public class OrderService',
    '{',
    '  public void Load()',
    '  {',
    '    db.Orders.ToList();',
    '  }',
    '}',
  ].join('\n') + '\n');
  write(dir, ordersCtrlPath, [
    'using Acme.Domain;',
    'public class AcmeOrdersController',
    '{',
    '  private readonly IOrderRepository _repo;',
    '  public IActionResult Save()',
    '  {',
    '    try',
    '    {',
    '      _repo.Save();',
    '    }',
    '    catch (DbUpdateConcurrencyException)',
    '    {',
    '      return Conflict(ApiMessages.DataStateInvalid);',
    '    }',
    '    try',
    '    {',
    '      Load();',
    '    }',
    '    catch (Exception ex)',
    '    {',
    '      Log(Warning, ex.InnerException);',
    '      return Problem();',
    '    }',
    '  }',
    '}',
  ].join('\n') + '\n');
  write(dir, 'backend/acme/Acme.Infrastructure/Data/AcmeDbContext.cs', [
    'public class AcmeDbContext',
    '{',
    '  public DbSet<Order> Orders => Set<Order>();',
    '}',
  ].join('\n') + '\n');
  write(dir, 'backend/acme/Acme.Domain/Entities/Widget.cs', [
    'public class Widget',
    '{',
    '  public int Id { get; set; }',
    '}',
  ].join('\n') + '\n');

  const fixed = runHook(dir);
  assert.equal(fixed.status, 0, fixed.stderr);
  assert.equal(fixed.stdout, '');
  assert.equal(fixed.stderr, '');
});
