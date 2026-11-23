// 技能改名：shipyard-workflow-closeout → workflow-closeout（v2.11.0）。
// ≤2.10 的 manifest 仍托管旧技能正文与各宿主指针；升级重建 manifest 后这些条目会
// 消失但不删文件，status/diff/prune 因此失明。迁移只从 manifest 摘除旧路径并把旧
// 哈希登记为清理资格；磁盘清理由 upgrade 在迁移成功后按 pendingRemovals 执行
// （哈希一致才删，见 install.mjs），本迁移不触碰目标文件。
export const from = 2;
export const to = 3;

const OLD_SKILL_SEGMENT = 'shipyard-workflow-closeout';

function isOldSkillPath(rel) {
  const p = String(rel).replace(/\\/g, '/');
  return p.split('/').includes(OLD_SKILL_SEGMENT);
}

export function migrate({ manifest }) {
  const files = { ...(manifest.files || {}) };
  const removals = [];
  for (const [rel, hash] of Object.entries(files)) {
    if (!isOldSkillPath(rel)) continue;
    delete files[rel];
    if (hash) removals.push(rel);
  }
  const notes = [];
  if (removals.length) {
    notes.push(`技能改名 shipyard-workflow-closeout → workflow-closeout：待清理 ${removals.length} 个旧路径`);
  }
  return {
    manifest: { ...manifest, schemaVersion: 3, files },
    notes,
    removals,
  };
}
