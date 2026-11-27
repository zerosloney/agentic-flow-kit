// kernel 门面（issue #75，2026-11-22）——安装机件判据原语单源，供同源插件经包 exports
// （`agentic-flow-kit/kernel`）复用；判据口径 = 插件侧已验证超集：文本判据一律 CRLF→LF 归一
//（Windows CRLF 检出与 LF 手存不产生判据漂移）。安装三方合并由
// src/install/baseline.mjs 的 mergeThreeWay 转到本文件，口径只留这一份。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const normalizeEol = (text) => String(text).replace(/\r\n/g, '\n');

// sha256（CRLF→LF 归一后）——判据摘要，非密码学用途。
export function hashText(text) {
  return createHash('sha256').update(normalizeEol(text), 'utf8').digest('hex');
}

// 读 utf8 后走 hashText；文件不可读时让底层异常自然抛出（fail-loud，不静默 null）。
export function hashFile(file) {
  return hashText(fs.readFileSync(file, 'utf8'));
}

// 脏树三态（口径同 templates/engine/.agents/scripts/git-tree-digest.mjs + CRLF 归一超集）：
// 干净 '' / 脏 16 位 hex / git 不可用或非 git 根 null（缺键=未知，不伪造）。
// 摘要 = sha256(`${git status --porcelain 输出}\n${git diff HEAD 输出}`) 前 16 位；
// 零提交仓 diff 失败时只以 porcelain 入摘要。
export function dirtyTreeDigest(root) {
  const st = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8', cwd: root, windowsHide: true });
  if (st.status !== 0) return null;
  if (!st.stdout.trim()) return '';
  const diff = spawnSync('git', ['diff', 'HEAD'], { encoding: 'utf8', cwd: root, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  return createHash('sha256')
    .update(normalizeEol(`${st.stdout}\n${diff.status === 0 ? diff.stdout : ''}`), 'utf8')
    .digest('hex')
    .slice(0, 16);
}

// 归一三方合并：base/ours/theirs 先 CRLF→LF，再走 git merge-file -p -q -L current -L baseline -L kit。
// 返回 { status: 'clean'|'conflict', text } 或 { status: 'unavailable' }（git 失败/退出码 > 127）；
// 临时目录 mkdtemp + finally 清理，语义对齐 src/install/baseline.mjs（差异仅输入归一）。
export function mergeThreeWay({ base, ours, theirs }) {
  let dir;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-kit-merge-'));
    const oursFile = path.join(dir, 'ours');
    const baseFile = path.join(dir, 'base');
    const theirsFile = path.join(dir, 'theirs');
    fs.writeFileSync(oursFile, normalizeEol(ours), 'utf8');
    fs.writeFileSync(baseFile, normalizeEol(base), 'utf8');
    fs.writeFileSync(theirsFile, normalizeEol(theirs), 'utf8');
    const result = spawnSync(
      'git',
      ['merge-file', '-p', '-q', '-L', 'current', '-L', 'baseline', '-L', 'kit', oursFile, baseFile, theirsFile],
      { encoding: 'utf8', windowsHide: true },
    );
    // git merge-file 的退出码是冲突块数量（最多 127）；>=128 才是 git 自身错误。
    // git 被信号杀死时 status 为 null（null < 0 / null > 127 均为 false），非数值须显式归入 unavailable（#82）。
    if (result.error || typeof result.status !== 'number' || result.status < 0 || result.status > 127) return { status: 'unavailable' };
    return {
      status: result.status === 0 ? 'clean' : 'conflict',
      text: result.stdout,
    };
  } catch {
    return { status: 'unavailable' };
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}
