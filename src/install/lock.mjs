import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// 通用单写者锁：O_EXCL 创建 file，防止并发读改写交错写盘。
// 新鲜锁 → 抛 errorCode（fail-loud）；陈旧锁（超过 staleMs 或内容不可读）→ 告警后接管重建。
// 返回 best-effort 释放函数：锁已被接管方重建或手动清理时，释放失败静默。
// t：i18n 翻译函数（可选，缺省回退直书中文，兼容直调测试）。
export function acquireLock(file, { staleMs = 15 * 60_000, label, errorCode = 'INSTALL_LOCKED', t } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = `${JSON.stringify({ pid: process.pid, ts: Date.now(), command: label ?? null })}\n`;

  let fd;
  try {
    fd = fs.openSync(file, 'wx');
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    let holder = null;
    try {
      holder = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { /* 内容不可读：按陈旧锁处理 */ }
    const age = holder && Number.isFinite(holder.ts) ? Date.now() - holder.ts : null;
    if (age != null && age <= staleMs) {
      const seconds = Math.round(age / 1000);
      const message = t
        ? t('error.installLocked', { file, pid: holder.pid ?? '?', command: holder.command || '?', seconds })
        : `安装锁冲突：${file} 已被其他安装持有（pid ${holder.pid ?? '?'}，命令 ${holder.command || '?'}，约 ${seconds} 秒前创建）。确认无并发安装后可删除该锁文件并重试。`;
      const error = new Error(message);
      error.code = errorCode;
      throw error;
    }
    console.warn(t
      ? t('warn.installLockStale', { file, pid: holder?.pid ?? '?' })
      : `检测到陈旧的安装锁，已接管并重建：${file}${holder && holder.pid != null ? `（原持有 pid ${holder.pid}）` : ''}`);
    fs.unlinkSync(file);
    // 接管竞态（另一进程抢先重建）会在此抛 EEXIST：按失败上抛，不重试。
    fd = fs.openSync(file, 'wx');
  }
  try {
    fs.writeFileSync(fd, payload);
  } finally {
    fs.closeSync(fd);
  }
  return function releaseLock() {
    try {
      fs.unlinkSync(file);
    } catch { /* best-effort：锁已消失时忽略 */ }
  };
}

// 安装锁（项目级）：O_EXCL 创建 <target>/.agents/install.lock。dry-run 纯净性契约：
// 目标是全新目录时，释放锁要把自己新建的 .agents 空目录一并回收。
export function acquireInstallLock(target, { staleMs, label, t } = {}) {
  const agentsDir = path.join(target, '.agents');
  const createdAgentsDir = !fs.existsSync(agentsDir);
  const releaseLock = acquireLock(path.join(agentsDir, 'install.lock'), { staleMs, label, t });
  return function releaseInstallLock() {
    releaseLock();
    if (createdAgentsDir) {
      // AV/索引进程可能瞬时占住刚删完锁文件的目录句柄：短重试压低偶发残留概率。
      // 重试耗尽仍失败则静默——残留是偶发且下次写自愈。
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          fs.rmdirSync(agentsDir);
          return;
        } catch { /* best-effort */ }
        if (attempt < 2) sleepSync(50);
      }
    }
  };
}

// user-hooks 全局锁（本机同用户唯一，不打进 ~/.codex 也不新建家目录）：
// 锁文件按被保护配置文件的绝对路径派生（sha256 前 16 位），不同配置文件互不争锁；
// 同一份配置（单机单用户同路径）仍被正确串行化，堵并发安装的读改写丢更新窗口。
export function userHooksLockFile(configFile) {
  const digest = crypto.createHash('sha256').update(path.resolve(String(configFile))).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), `flow-kit-${digest}.lock`);
}
