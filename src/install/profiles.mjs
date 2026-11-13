// 组合式 profile：stack 为单值基底，surface 是可叠加的闭集切面。
// 闭集严格限制组合爆炸；未知 surface 立即失败，不与旧行为静默兼容。
export const SURFACES = ['frontend', 'api', 'data'];

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
export function parseProfileArgs({ stackArg, surfaceArgs = [], fallbackSurfaces = [], t }) {
  const parts = String(stackArg || '').split('+').map((part) => part.trim()).filter(Boolean);
  const stack = parts[0] || null;
  const listed = [
    ...parts.slice(1),
    ...surfaceArgs.flatMap((value) => String(value).split(',')).map((value) => value.trim()).filter(Boolean),
  ];
  const surfaces = [...new Set(listed.length ? listed : fallbackSurfaces)];
  for (const surface of surfaces) {
    if (!SURFACES.includes(surface)) {
      const err = new Error(t('error.badSurface', { surface, surfaces: SURFACES.join(', ') }));
      err.code = 'BAD_SURFACE';
      throw err;
    }
  }
  return { stack, surfaces };
}
