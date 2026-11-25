import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { makeTmp } from './helpers/tmp.mjs';
import {
  extractSymbols,
  diffSymbols,
  normalizeSignature,
  computeSymbolDigest,
  parsePlanSymbolRules,
  hasSymbolRules,
  verifySemanticSandbox,
} from '../templates/engine/.agents/scripts/semantic-sandbox.mjs';
import {
  checkAuthorized,
} from '../templates/engine/.agents/scripts/pipeline-run.mjs';

test('Unit 1: extractSymbols accurately extracts JS/TS, Python, and Go symbols', () => {
  const jsSource = `
export async function calculateFee(amount, currency) {
  const rate = 0.05;
  return amount * rate;
}

export const formatInvoice = (id, total) => {
  return \`#\${id}: \${total}\`;
};

class BaseService {}

export class BillingService extends BaseService {
  process() {}
}

export interface InvoiceItem {
  name: string;
  price: number;
}

export type CurrencyCode = 'USD' | 'EUR' | 'CNY';

function privateHelper(x) {
  return x + 1;
}

export { privateHelper };
`;

  const symbols = extractSymbols(jsSource, '.ts');
  const symMap = new Map(symbols.map((s) => [s.name, s]));

  assert.ok(symMap.has('calculateFee'));
  assert.equal(symMap.get('calculateFee').kind, 'function');
  assert.equal(symMap.get('calculateFee').isExported, true);
  assert.ok(symMap.get('calculateFee').signature.includes('async function calculateFee(amount, currency)'));

  assert.ok(symMap.has('formatInvoice'));
  assert.equal(symMap.get('formatInvoice').kind, 'function');
  assert.equal(symMap.get('formatInvoice').isExported, true);

  assert.ok(symMap.has('BillingService'));
  assert.equal(symMap.get('BillingService').kind, 'class');
  assert.equal(symMap.get('BillingService').isExported, true);

  assert.ok(symMap.has('InvoiceItem'));
  assert.equal(symMap.get('InvoiceItem').kind, 'interface');
  assert.equal(symMap.get('InvoiceItem').isExported, true);

  assert.ok(symMap.has('CurrencyCode'));
  assert.equal(symMap.get('CurrencyCode').kind, 'type');
  assert.equal(symMap.get('CurrencyCode').isExported, true);

  // privateHelper was marked exported via export { privateHelper }
  assert.ok(symMap.has('privateHelper'));
  assert.equal(symMap.get('privateHelper').isExported, true);

  // Python symbols
  const pySource = `
def public_api(x, y):
    res = x + y
    return res

async def async_worker(task):
    pass

def _private_func():
    pass

class DataModel:
    pass
`;
  const pySymbols = extractSymbols(pySource, '.py');
  const pyMap = new Map(pySymbols.map((s) => [s.name, s]));

  assert.equal(pyMap.get('public_api').isExported, true);
  assert.equal(pyMap.get('async_worker').isExported, true);
  assert.equal(pyMap.get('_private_func').isExported, false);
  assert.equal(pyMap.get('DataModel').kind, 'class');

  // Go symbols
  const goSource = `
func ExportedFunc(a int) bool {
  return true
}

func unexportedFunc() {}

type Config struct {}
`;
  const goSymbols = extractSymbols(goSource, '.go');
  const goMap = new Map(goSymbols.map((s) => [s.name, s]));

  assert.equal(goMap.get('ExportedFunc').isExported, true);
  assert.equal(goMap.get('unexportedFunc').isExported, false);
  assert.equal(goMap.get('Config').isExported, true);
});

test('Unit 1: normalizeSignature and computeSymbolDigest handle whitespace and formatting stably', () => {
  const sig1 = 'export   async   function   foo ( a ,   b ) {';
  const sig2 = 'export async function foo(a, b)';
  assert.equal(normalizeSignature(sig1), normalizeSignature(sig2));

  const body1 = '  const   x = 1;\n  return x;  ';
  const body2 = 'const x = 1;\nreturn x;';
  assert.equal(computeSymbolDigest(body1), computeSymbolDigest(body2));
});

test('Unit 2: diffSymbols accurately detects added, removed, signatureChanged, and bodyChanged', () => {
  const baseSource = `
export function computeTotal(price, qty) {
  return price * qty;
}
export function unchangedFn() {
  return 1;
}
export function willDelete() {
  return null;
}
`;

  const targetSource = `
export function computeTotal(price, qty, discount = 0) {
  return price * qty - discount;
}
export function unchangedFn() {
  return 1;
}
export function newFunction() {
  return 'hello';
}
`;

  const baseSyms = extractSymbols(baseSource, '.js');
  const targetSyms = extractSymbols(targetSource, '.js');
  const diff = diffSymbols(baseSyms, targetSyms);

  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0].name, 'newFunction');

  assert.equal(diff.removed.length, 1);
  assert.equal(diff.removed[0].name, 'willDelete');

  assert.equal(diff.signatureChanged.length, 1);
  assert.equal(diff.signatureChanged[0].name, 'computeTotal');

  assert.equal(diff.unchanged.length, 1);
  assert.equal(diff.unchanged[0].name, 'unchangedFn');
});

test('Unit 2: verifySemanticSandbox enforces allowedSymbols, frozenSymbols, and freezeExports', () => {
  const baseFiles = {
    'src/services/billing.mjs': `
export function calculateFee(amount) {
  return amount * 0.1;
}
export function parseTaxTable() {
  return { rate: 0.1 };
}
export function internalToken() {
  return 'secret';
}
`,
  };

  // 场景 A: 修改了未授权的符号 internalToken
  const targetFilesViolationA = {
    'src/services/billing.mjs': `
export function calculateFee(amount) {
  return amount * 0.15;
}
export function parseTaxTable() {
  return { rate: 0.1 };
}
export function internalToken() {
  return 'compromised';
}
`,
  };

  const resA = verifySemanticSandbox({
    baseSourceMap: baseFiles,
    targetSourceMap: targetFilesViolationA,
    rules: {
      allowedSymbols: {
        'src/services/billing.mjs': ['calculateFee'],
      },
    },
  });
  assert.equal(resA.ok, false);
  assert.ok(resA.violations.some((v) => v.code === 'UNAUTHORIZED_SYMBOL_MUTATION' && v.symbol === 'internalToken'));

  // 场景 B: 仅修改允许的符号 calculateFee，验证通过
  const targetFilesOk = {
    'src/services/billing.mjs': `
export function calculateFee(amount) {
  return amount * 0.15;
}
export function parseTaxTable() {
  return { rate: 0.1 };
}
export function internalToken() {
  return 'secret';
}
`,
  };

  const resB = verifySemanticSandbox({
    baseSourceMap: baseFiles,
    targetSourceMap: targetFilesOk,
    rules: {
      allowedSymbols: {
        'src/services/billing.mjs': ['calculateFee'],
      },
    },
  });
  assert.equal(resB.ok, true);
  assert.equal(resB.violations.length, 0);

  // 场景 C: 修改冻结符号 parseTaxTable 触发 FROZEN_SYMBOL_BREACH
  const targetFilesViolationC = {
    'src/services/billing.mjs': `
export function calculateFee(amount) {
  return amount * 0.15;
}
export function parseTaxTable() {
  return { rate: 0.2 };
}
export function internalToken() {
  return 'secret';
}
`,
  };

  const resC = verifySemanticSandbox({
    baseSourceMap: baseFiles,
    targetSourceMap: targetFilesViolationC,
    rules: {
      frozenSymbols: {
        'src/services/billing.mjs': ['parseTaxTable'],
      },
    },
  });
  assert.equal(resC.ok, false);
  assert.ok(resC.violations.some((v) => v.code === 'FROZEN_SYMBOL_BREACH' && v.symbol === 'parseTaxTable'));

  // 场景 D: 开启 freezeExports 时修改导出函数签名触发 EXPORT_CONTRACT_BREACH
  const targetFilesViolationD = {
    'src/services/billing.mjs': `
export function calculateFee(amount, currency, options) {
  return amount * 0.1;
}
export function parseTaxTable() {
  return { rate: 0.1 };
}
export function internalToken() {
  return 'secret';
}
`,
  };

  const resD = verifySemanticSandbox({
    baseSourceMap: baseFiles,
    targetSourceMap: targetFilesViolationD,
    rules: {
      freezeExports: true,
    },
  });
  assert.equal(resD.ok, false);
  assert.ok(resD.violations.some((v) => v.code === 'EXPORT_CONTRACT_BREACH' && v.symbol === 'calculateFee'));
});

test('Unit 3: parsePlanSymbolRules and hasSymbolRules parse markdown declarations correctly', () => {
  const planSection = `
## 改动方案
- [x] src/services/billing.mjs (symbols: calculateFee, formatInvoice; freeze: parseTaxTable)
- [x] src/auth/token.mjs (freeze-exports)
- [x] src/common/utils.mjs
`;

  const parsed = parsePlanSymbolRules(planSection);
  assert.ok(hasSymbolRules(parsed));

  assert.deepEqual(parsed.allowedSymbols['src/services/billing.mjs'], ['calculateFee', 'formatInvoice']);
  assert.deepEqual(parsed.frozenSymbols['src/services/billing.mjs'], ['parseTaxTable']);
  assert.equal(parsed.fileFreezeExports['src/auth/token.mjs'], true);
  assert.equal(parsed.allowedSymbols['src/common/utils.mjs'], undefined);

  assert.equal(hasSymbolRules({}), false);
});

test('Unit 4: pipeline checkAuthorized enforces semantic sandbox with Git base', () => {
  const tmpDir = makeTmp('flow-kit-sandbox-');
  spawnSync('git', ['init', '-q'], { cwd: tmpDir });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpDir });
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: tmpDir });

  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'workflow', 'plans'), { recursive: true });

  fs.writeFileSync(path.join(tmpDir, 'src', 'billing.mjs'), `
export function calculateFee(amount) {
  return amount * 0.1;
}
export function parseTaxTable() {
  return { rate: 0.1 };
}
`);

  fs.writeFileSync(path.join(tmpDir, 'workflow', 'plans', 'plan.md'), `
# 计费方案
## 改动方案
- [x] src/billing.mjs (symbols: calculateFee; freeze: parseTaxTable)
`);

  spawnSync('git', ['add', '-A'], { cwd: tmpDir });
  spawnSync('git', ['commit', '-q', '-m', 'initial'], { cwd: tmpDir });

  const ctx = {
    root: tmpDir,
    gitPrefix: ['git'],
    runsDir: path.join(tmpDir, '.agents', 'cache', 'pipeline-runs'),
  };
  const run = {
    runId: 'test-sandbox-run',
    docs: { plan: 'workflow/plans/plan.md' },
    gitBaseSha: 'HEAD',
    stage: 'implement',
    events: [],
  };

  // 1. 尝试修改冻结符号 parseTaxTable，应被 checkAuthorized 阻断
  fs.writeFileSync(path.join(tmpDir, 'src', 'billing.mjs'), `
export function calculateFee(amount) {
  return amount * 0.15;
}
export function parseTaxTable() {
  return { rate: 0.2 };
}
`);
  const blockedRes = checkAuthorized(ctx, run, 'src/billing.mjs');
  assert.equal(blockedRes.ok, false);
  assert.ok(blockedRes.problems.some((p) => p.includes('语义沙箱阻断') && p.includes('parseTaxTable')));

  // 2. 仅修改授权符号 calculateFee，应顺利放行
  fs.writeFileSync(path.join(tmpDir, 'src', 'billing.mjs'), `
export function calculateFee(amount) {
  return amount * 0.15;
}
export function parseTaxTable() {
  return { rate: 0.1 };
}
`);
  const okRes = checkAuthorized(ctx, run, 'src/billing.mjs');
  assert.equal(okRes.ok, true);
});

test('Unit 1: extractSymbols attaches source ranges (start/end)', () => {
  const src = `export function foo(a) {
  return a;
}

export const bar = (b) => b + 1;
`;
  const symMap = new Map(extractSymbols(src, '.mjs').map((s) => [s.name, s]));

  assert.ok(Number.isInteger(symMap.get('foo').start));
  assert.ok(symMap.get('foo').end > symMap.get('foo').start);
  assert.ok(src.slice(symMap.get('foo').start, symMap.get('foo').end).includes('return a;'));

  assert.ok(Number.isInteger(symMap.get('bar').start));
  assert.ok(src.slice(symMap.get('bar').start, symMap.get('bar').end).endsWith('b + 1;'));
});

test('Fail-closed: unrecognized constructs outside allowed symbols are blocked', () => {
  const base = `export function allowedFn(a) {
  return a;
}
`;
  const constructs = [
    ['top-level side effect', 'initSideEffect();'],
    ['function expression const', 'export const f = function () {}'],
    ['generator function', 'export function* gen() { yield 1; }'],
    ['enum declaration', 'export enum E { A, B }'],
    ['default anonymous class', 'export default class {}'],
    ['abstract class', 'export abstract class Base {}'],
    ['object const export', 'export const cfg = { rate: 1 };'],
    ['decorated class one-liner', '@Injectable() export class Evil {}'],
  ];

  for (const [label, snippet] of constructs) {
    const res = verifySemanticSandbox({
      baseSourceMap: { 'src/blind.mjs': base },
      targetSourceMap: { 'src/blind.mjs': `${base}${snippet}\n` },
      rules: { allowedSymbols: { 'src/blind.mjs': ['allowedFn'] } },
    });
    assert.equal(res.ok, false, `${label} 应被阻断`);
    assert.ok(
      res.violations.some((v) => v.code === 'UNAUTHORIZED_REGION_CHANGE'),
      `${label} 应判 UNAUTHORIZED_REGION_CHANGE`
    );
  }

  // Python 多行签名的 def：签名行识别不出，函数体改动必须可见
  const pyBase = `def allowed_fn(a):
    return a

def multi_line(
    a,
    b,
):
    return a + b
`;
  const pyTarget = pyBase.replace('return a + b', 'return a - b');
  const pyRes = verifySemanticSandbox({
    baseSourceMap: { 'src/blind.py': pyBase },
    targetSourceMap: { 'src/blind.py': pyTarget },
    rules: { allowedSymbols: { 'src/blind.py': ['allowed_fn'] } },
  });
  assert.equal(pyRes.ok, false);
  assert.ok(pyRes.violations.some((v) => v.code === 'UNAUTHORIZED_REGION_CHANGE'));
});

test('Fail-closed: freezeExports detects unrecognized export surface additions', () => {
  const jsBase = `export function baseFn(a) {
  return a;
}
`;
  const jsCases = [
    ['enum declaration', 'export enum E { A }'],
    ['generator function', 'export function* gen() { yield 1; }'],
    ['commonjs export', 'module.exports = { baseFn };'],
  ];
  for (const [label, snippet] of jsCases) {
    const res = verifySemanticSandbox({
      baseSourceMap: { 'src/surface.mjs': jsBase },
      targetSourceMap: { 'src/surface.mjs': `${jsBase}${snippet}\n` },
      rules: { freezeExports: true },
    });
    assert.equal(res.ok, false, `${label} 应被阻断`);
    assert.ok(
      res.violations.some((v) => v.code === 'EXPORT_SURFACE_CHANGE'),
      `${label} 应判 EXPORT_SURFACE_CHANGE`
    );
  }

  const pyBase = `def base_fn(a):
    return a
`;
  const pyTarget = `${pyBase}
def added(
    a,
):
    return a
`;
  const pyRes = verifySemanticSandbox({
    baseSourceMap: { 'src/surface.py': pyBase },
    targetSourceMap: { 'src/surface.py': pyTarget },
    rules: { freezeExports: true },
  });
  assert.equal(pyRes.ok, false);
  assert.ok(pyRes.violations.some((v) => v.code === 'EXPORT_SURFACE_CHANGE'));
});

test('Fail-closed: unsupported languages cannot be judged symbolically', () => {
  const base = `public class A {
  public int run() {
    return 1;
  }
}
`;
  const target = base.replace('return 1;', 'return 2;');
  const rules = { allowedSymbols: { 'src/A.java': ['run'] } };

  const res = verifySemanticSandbox({
    baseSourceMap: { 'src/A.java': base },
    targetSourceMap: { 'src/A.java': target },
    rules,
  });
  assert.equal(res.ok, false);
  assert.ok(res.violations.some((v) => v.code === 'SANDBOX_UNSUPPORTED_LANGUAGE'));

  const same = verifySemanticSandbox({
    baseSourceMap: { 'src/A.java': base },
    targetSourceMap: { 'src/A.java': base },
    rules: {},
  });
  assert.equal(same.ok, true);
});

test('Fail-closed: symbol rules naming unrecognizable declarations are rejected', () => {
  // 冻结清单：多行签名的 def 识别不出
  const pyBase = `def foo(
    a,
):
    return a
`;
  const pyTarget = pyBase.replace('return a', 'return a + 1');
  const frozenRes = verifySemanticSandbox({
    baseSourceMap: { 'src/x.py': pyBase },
    targetSourceMap: { 'src/x.py': pyTarget },
    rules: { frozenSymbols: { 'src/x.py': ['foo'] } },
  });
  assert.equal(frozenRes.ok, false);
  assert.ok(
    frozenRes.violations.some((v) => v.code === 'SANDBOX_SYMBOL_UNRESOLVED' && v.symbol === 'foo')
  );

  // 授权清单：函数表达式识别不出
  const tsBase = `export const foo = function () {
  return 1;
};
`;
  const tsTarget = tsBase.replace('return 1;', 'return 2;');
  const tsRules = {
    allowedSymbols: { 'src/x.ts': ['foo'] },
    frozenSymbols: { 'src/x.ts': ['foo'] },
  };
  const allowedRes = verifySemanticSandbox({
    baseSourceMap: { 'src/x.ts': tsBase },
    targetSourceMap: { 'src/x.ts': tsTarget },
    rules: tsRules,
  });
  assert.equal(allowedRes.ok, false);
  assert.ok(
    allowedRes.violations.some((v) => v.code === 'SANDBOX_SYMBOL_UNRESOLVED' && v.symbol === 'foo')
  );
  // 同一文件同一名字只报一次（授权清单 + 冻结清单）
  assert.equal(
    allowedRes.violations.filter((v) => v.code === 'SANDBOX_SYMBOL_UNRESOLVED').length,
    1
  );

  // 可识别声明不产生该违例
  const jsBase = `export function foo(a) {
  return a;
}
`;
  const jsRes = verifySemanticSandbox({
    baseSourceMap: { 'src/x.mjs': jsBase },
    targetSourceMap: { 'src/x.mjs': jsBase.replace('return a;', 'return a + 1;') },
    rules: { allowedSymbols: { 'src/x.mjs': ['foo'] } },
  });
  assert.equal(jsRes.ok, true);
  assert.ok(!jsRes.violations.some((v) => v.code === 'SANDBOX_SYMBOL_UNRESOLVED'));
});

test('parsePlanSymbolRules normalizes paths and verify resolves normalized keys', () => {
  const parsed = parsePlanSymbolRules(`
- [x] ./src/a.mjs (symbols: foo)
- [x] src\\win\\b.mjs (freeze: bar)
`);
  assert.deepEqual(parsed.allowedSymbols['src/a.mjs'], ['foo']);
  assert.deepEqual(parsed.frozenSymbols['src/win/b.mjs'], ['bar']);

  const base = `export function foo(a) {
  return a;
}
export function bar(a) {
  return a;
}
`;
  const target = `export function foo(a) {
  return a;
}
export function bar(a) {
  return a * 2;
}
`;
  const res = verifySemanticSandbox({
    baseSourceMap: { './src/a.mjs': base },
    targetSourceMap: { './src/a.mjs': target },
    rules: parsePlanSymbolRules('- [x] ./src/a.mjs (symbols: foo)'),
  });
  assert.equal(res.ok, false);
  assert.ok(
    res.violations.some((v) => v.code === 'UNAUTHORIZED_SYMBOL_MUTATION' && v.filePath === './src/a.mjs')
  );
});

test('Fail-closed: new files allow only imports plus authorized symbols', () => {
  const okRes = verifySemanticSandbox({
    baseSourceMap: { 'src/new.mjs': '' },
    targetSourceMap: {
      'src/new.mjs': `import fs from 'node:fs';
export function added(a) {
  return a;
}
`,
    },
    rules: { allowedSymbols: { 'src/new.mjs': ['added'] } },
  });
  assert.equal(okRes.ok, true);

  const badRes = verifySemanticSandbox({
    baseSourceMap: { 'src/side.mjs': '' },
    targetSourceMap: {
      'src/side.mjs': `initSideEffect();
export function added(a) {
  return a;
}
`,
    },
    rules: { allowedSymbols: { 'src/side.mjs': ['added'] } },
  });
  assert.equal(badRes.ok, false);
  assert.ok(badRes.violations.some((v) => v.code === 'UNAUTHORIZED_REGION_CHANGE'));
});

test('Regression: existing symbol-level verdicts keep working', () => {
  const base = `// header
export function allowedFn(a) {
  return a;
}
export function frozenFn(a) {
  return a;
}
`;
  const file = 'src/rules.mjs';

  // 授权符号内改动 → 通过
  const allowedRes = verifySemanticSandbox({
    baseSourceMap: { [file]: base },
    targetSourceMap: { [file]: base.replace('return a;\n}\nexport function frozenFn', 'return a + 1;\n}\nexport function frozenFn') },
    rules: { allowedSymbols: { [file]: ['allowedFn'] } },
  });
  assert.equal(allowedRes.ok, true);

  // 冻结符号被改 → 违例
  const frozenRes = verifySemanticSandbox({
    baseSourceMap: { [file]: base },
    targetSourceMap: {
      [file]: base.replace(
        'export function frozenFn(a) {\n  return a;\n}',
        'export function frozenFn(a) {\n  return a * 2;\n}'
      ),
    },
    rules: { frozenSymbols: { [file]: ['frozenFn'] } },
  });
  assert.equal(frozenRes.ok, false);
  assert.ok(frozenRes.violations.some((v) => v.code === 'FROZEN_SYMBOL_BREACH'));

  // 导出函数签名变化 → 违例
  const sigRes = verifySemanticSandbox({
    baseSourceMap: { [file]: base },
    targetSourceMap: { [file]: base.replace('allowedFn(a)', 'allowedFn(a, b)') },
    rules: { freezeExports: true },
  });
  assert.equal(sigRes.ok, false);
  assert.ok(sigRes.violations.some((v) => v.code === 'EXPORT_CONTRACT_BREACH'));

  // 只改注释 → 通过
  const commentRes = verifySemanticSandbox({
    baseSourceMap: { [file]: base },
    targetSourceMap: { [file]: base.replace('// header', '// updated header') },
    rules: { allowedSymbols: { [file]: ['allowedFn'] } },
  });
  assert.equal(commentRes.ok, true);
});
