// 组合式 profile：stack 为单值基底（可多栈叠加），surface 是可叠加的闭集切面。
// 闭集严格限制组合爆炸；未知 stack / surface 立即失败，不与旧行为静默兼容。
export const SURFACES = ['frontend', 'api', 'data'];
// 可选技术栈闭集单一来源：TUI 向导栈菜单由它生成（install.mjs 转出口）。
export const STACKS = ['dotnet', 'node', 'typescript', 'rust', 'go', 'java', 'empty'];

export function surfaceDescription(surface, lang = 'zh-CN') {
  const zh = {
    frontend: '前端界面 / 交互 / 视觉验证',
    api: 'HTTP API / 契约 / 集成测试',
    data: '数据库 / 迁移 / 数据维护',
  };
  const en = {
    frontend: 'UI, interaction and visual verification',
    api: 'HTTP API, contracts and integration tests',
    data: 'database, migrations and data maintenance',
  };
  return (lang === 'en' ? en : zh)[surface] || surface;
}

// "--stack dotnet+frontend" 与 "--surface frontend" 等价；两者可混用，按声明顺序去重。
// stackArg 接受 string 或 string[]（重复/逗号收集后的声明序列）；每个元素按 + 拆分：
// 首 token 是栈、其余是 surface（既有语义）。无显式栈声明时回退 fallbackStacks（对称于 fallbackSurfaces）。
export function parseProfileArgs({ stackArg, surfaceArgs = [], fallbackSurfaces = [], fallbackStacks = [], t }) {
  const tokens = Array.isArray(stackArg) ? stackArg : [stackArg];
  const declared = [];
  const listed = [];
  for (const token of tokens) {
    const parts = String(token || '').split('+').map((part) => part.trim()).filter(Boolean);
    if (parts[0]) declared.push(parts[0]);
    listed.push(...parts.slice(1));
  }
  listed.push(...surfaceArgs.flatMap((value) => String(value).split(',')).map((value) => value.trim()).filter(Boolean));
  const stacks = [...new Set(declared.length ? declared : fallbackStacks)];
  for (const stack of stacks) {
    if (!STACKS.includes(stack)) {
      const err = new Error(t('error.badStack', { value: stack, stacks: STACKS.join(', ') }));
      err.code = 'BAD_STACK';
      throw err;
    }
  }
  const surfaces = [...new Set(listed.length ? listed : fallbackSurfaces)];
  for (const surface of surfaces) {
    if (!SURFACES.includes(surface)) {
      const err = new Error(t('error.badSurface', { surface, surfaces: SURFACES.join(', ') }));
      err.code = 'BAD_SURFACE';
      throw err;
    }
  }
  return { stacks, stack: stacks[0] || null, surfaces };
}
