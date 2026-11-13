// manifest 0 → 1：初始化 schemaVersion。
// 只改 manifest 元数据，不触碰目标文件；重复执行幂等（框架按 schemaVersion 跳过）。
export const from = 0;
export const to = 1;

export function migrate({ manifest }) {
  return {
    manifest: { ...manifest, schemaVersion: 1 },
    notes: ['初始化 manifest schemaVersion=1'],
  };
}
