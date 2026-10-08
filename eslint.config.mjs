// eslint.config.mjs — 包源仓 lint（flat config；agentic-flow-kit）
// 范围：包源四区（src / bin / templates/_agents/scripts / modules+scripts 根辅助）。
// ignores 即边界：.agents/（managed 装副本，sync 生成物）、modules/hosts/（薄适配生成物 + 宿主工程件）、
//   workflow/ 与 wiki/（内容文档）、cache、装户目录——lint 双源一侧，不双计。
// 零运行时依赖红线不破：eslint/@eslint/js 仅 devDependencies，不进 files 打包面。
// 豁免纪律：存量清零用行内 // eslint-disable-next-line 最小标注（进评审视野），禁文件级禁用
//   （engine-quality-batch plan 偏离留痕 ②）。
import js from '@eslint/js';

// node 常用全局手写清单（免引 globals 包）
const nodeGlobals = {
  process: 'readonly', console: 'readonly', Buffer: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  setImmediate: 'readonly', clearImmediate: 'readonly',
  queueMicrotask: 'readonly', structuredClone: 'readonly', fetch: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
  __dirname: 'readonly', __filename: 'readonly', require: 'readonly', module: 'writable', exports: 'writable',
  global: 'readonly',
};

export default [
  {
    ignores: [
      'node_modules/**', '.agents/**', '.zcode/**', '.opencode/**', '.trae/**',
      'modules/hosts/**', 'workflow/**', 'wiki/**', 'docs/**',
      '**/cache/**', '**/*.min.js',  // marked.min.js 等第三方 minified 产物不 lint
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: nodeGlobals },
    rules: {
      // 测试导出的纯函数 / 委派断言参数用 _ 前缀豁免；caught 错误变量允许具名不用（空块仍被 no-empty 拦）
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: nodeGlobals },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none', varsIgnorePattern: '^_' }],
    },
  },
];
