// 工作树脏状态摘要（BACKLOG 34）：sha256(`git status --porcelain` 输出 + `git diff HEAD` 内容) 前 16 位。
// 三态恒可判定：干净树 = ''、脏树 = 16 位 hex、git 不可用 / 非 git 根 = null（调用方省略键，不伪造）。
// 零提交仓 `diff HEAD` 失败时只以 porcelain 入摘要（该状态下未提交改动本就全在 porcelain 里）。
// 独立成模块（无副作用）：verify.mjs 落账与单元测试共用单源——verify 顶层 import 即跑主流程，
// 测试无法直接 import 它（同 confirm-doc 导出计算函数的既有做法的模块级版本）。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const dirtyTreeDigest = (root) => {
  const st = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8', cwd: root });
  if (st.status !== 0) return null;
  if (!st.stdout.trim()) return '';
  const diff = spawnSync('git', ['diff', 'HEAD'], { encoding: 'utf8', cwd: root, maxBuffer: 32 * 1024 * 1024 });
  return createHash('sha256').update(`${st.stdout}\n${diff.status === 0 ? diff.stdout : ''}`, 'utf8').digest('hex').slice(0, 16);
};
