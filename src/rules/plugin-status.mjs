// plugin-status — 插件运行期异常的本机留痕。
// warn 档插件的崩溃 / 超时 / 输出非法只在提交那一刻闪过一次，事后无处可查；rules check 把这类异常
// 记到 .agents/cache/rules-plugins.json（git 忽略的运行态），doctor 据此告警。同一条插件再次正常求值即清除。
// 留痕是尽力而为：写不进去（只读目录、占用）不影响门禁判定。
import fs from 'node:fs';
import path from 'node:path';

export const PLUGIN_STATUS_REL = '.agents/cache/rules-plugins.json';

/** 返回 { [ruleId]: { at, detail } }；文件缺失或损坏 = 无留痕。 */
export function readPluginStatus(root) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(root, PLUGIN_STATUS_REL), 'utf8'));
    const results = data && typeof data === 'object' ? data.results : null;
    return results && typeof results === 'object' && !Array.isArray(results) ? results : {};
  } catch {
    return {};
  }
}

/** evaluated = 本次实际求值过的插件规则 [{ ruleId, anomaly, detail }]：异常的记一笔，正常的清掉；没有变化不落盘。 */
export function recordPluginStatus(root, evaluated) {
  if (!evaluated.length) return;
  try {
    const results = readPluginStatus(root);
    let changed = false;
    for (const { ruleId, anomaly, detail } of evaluated) {
      if (anomaly) {
        results[ruleId] = { at: new Date().toISOString(), detail: String(detail || '').slice(0, 400) };
        changed = true;
      } else if (Object.prototype.hasOwnProperty.call(results, ruleId)) {
        delete results[ruleId];
        changed = true;
      }
    }
    if (!changed) return;
    const abs = path.join(root, PLUGIN_STATUS_REL);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    // 先写临时文件再改名：并发跑的两个门禁不会读到写了一半的 JSON。
    const tmp = `${abs}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, results }, null, 2)}\n`);
    fs.renameSync(tmp, abs);
  } catch { /* 尽力而为 */ }
}
