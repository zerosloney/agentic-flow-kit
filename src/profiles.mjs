// 宿主注册表 + 技术栈 profile + init 生成的 owned 基线配置
// stack 决定门禁配置三处：commit-check 的条件构建（builds）与质量检测（checks，秒级确定性
// 检查——lint/类型/vet；测试不放提交门，关单在 test.md 阶段门）、settings.json 的自检验
// 命令权限（allow）、AGENTS.md「项目适配区」命令预填；不改工作流流程本身。
// checks.when = 配置文件存在才启用（如 tsconfig.json / go.mod / ruff.toml）——没有对应
// 配置的项目自动跳过，不 fail-closed 误拦。none = 不配置（项目日后自填）。
export const HOSTS = {
  zcode: { dir: '.zcode', localOnly: true },
  opencode: { dir: '.opencode', localOnly: false },
  trae: { dir: '.trae', localOnly: false },
  omp: { dir: '.omp', localOnly: true },
};

const ESLINT_CONFIGS = [
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs',
  '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc',
];

export const STACKS = {
  dotnet: {
    build: 'dotnet build',
    test: 'dotnet test',
    typecheck: 'dotnet build（编译即类型检查）',
    builds: [{ name: 'backend', command: 'dotnet build', ext: ['.cs', '.sln', '.csproj'] }],
    checks: [{ name: 'format', command: 'dotnet format --verify-no-changes', ext: ['.cs'], when: ['*.sln'] }],
    allow: ['dotnet build', 'dotnet run', 'dotnet test', 'dotnet format'],
  },
  node: {
    build: 'npm run build',
    test: 'npm test',
    typecheck: 'npx tsc --noEmit（或 npm run typecheck）',
    builds: [{ name: 'build', command: 'npm run build', ext: ['.ts', '.tsx', '.vue', '.js', '.jsx', '.mjs', '.cjs'] }],
    checks: [
      { name: 'typecheck', command: 'npx tsc --noEmit', ext: ['.ts', '.tsx'], when: ['tsconfig.json'] },
      { name: 'lint', command: 'npx eslint .', ext: ['.ts', '.tsx', '.js', '.jsx', '.vue'], when: ESLINT_CONFIGS },
    ],
    allow: ['npm test'],
  },
  python: {
    build: '（Python 无统一构建命令，按项目填）',
    test: 'python -m pytest',
    typecheck: '（可选：mypy）',
    builds: [{ name: 'tests', command: 'python -m pytest', ext: ['.py'] }],
    checks: [{ name: 'lint', command: 'ruff check .', ext: ['.py'], when: ['ruff.toml', '.ruff.toml'] }],
    allow: ['python -m pytest', 'pytest', 'ruff check'],
  },
  go: {
    build: 'go build ./...',
    test: 'go test ./...',
    typecheck: 'go vet',
    builds: [{ name: 'build', command: 'go build ./...', ext: ['.go'] }],
    checks: [{ name: 'vet', command: 'go vet ./...', ext: ['.go'], when: ['go.mod'] }],
    allow: ['go build', 'go test', 'go vet'],
  },
  none: {
    build: '<填写>',
    test: '<填写>',
    typecheck: '<填写>',
    builds: [],
    checks: [],
    allow: [],
  },
};

// AGENTS.md「项目适配区」的命令预填变量（技术栈未知时留 <填写> 占位）
export function pickStackVars(stackKey) {
  const s = STACKS[stackKey] || STACKS.none;
  return { BUILD_CMD: s.build, TEST_CMD: s.test, TYPECHECK_CMD: s.typecheck };
}

// 两态文件模型的归属判定：managed（随包升级）之外皆 owned（项目内容，sync 永不覆盖）
// local-pre-commit 是项目门禁挂载点——一旦接线即含项目内容，按 owned 起步（旧台账里若在 managed，改动后 sync 也会保守跳过）
export function isOwned(rel) {
  return rel === 'AGENTS.md' || rel === '.gitattributes' || rel.startsWith('workflow/') || rel.startsWith('wiki/')
    || rel.startsWith('.agents/notes/')
    || rel === '.agents/workflow-modules.txt' || rel === '.agents/rule-budgets.txt'
    || rel === '.agents/hooks/local-pre-commit';
}

export function settingsJson(stackKey) {
  const allow = [...new Set([
    'node', 'git status', 'git diff', 'git add', 'git commit', 'git log', 'git push',
    'npm run', 'npm install', 'npm ci',
    ...(STACKS[stackKey]?.allow || []),
  ])];
  return `${JSON.stringify({
    permissions: {
      allow,
      deny: ['git reset --hard', 'git push --force', 'git push -f', 'drop database'],
      ask: ['git checkout', 'git clean', 'git branch -D', 'rm -rf'],
    },
  }, null, 2)}\n`;
}

export function commitCheckConfig(stackKey) {
  return `${JSON.stringify({
    knownPatterns: [],
    builds: STACKS[stackKey]?.builds || [],
    checks: STACKS[stackKey]?.checks || [],
  }, null, 2)}\n`;
}
