// 运行时输出语言（门禁脚本共用）：读 .agents/config/engine.json options.language，en → 'en'，其余/缺失 → 'zh-CN'。
// 注意：这是「脚本运行时输出」的语言，不是模板安装期渲染（那边由 locales/overrides 负责）。
// 读取失败 / 非法一律回退 zh-CN；不缓存——脚本短生命周期，每次读一次文件即可。
import fs from 'node:fs';
import path from 'node:path';

export function runtimeLang(root = process.cwd()) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, '.agents', 'config', 'engine.json'), 'utf8'));
    const options = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg.options : null;
    const language = options && typeof options === 'object' && !Array.isArray(options) ? options.language : null;
    return language === 'en' ? 'en' : 'zh-CN';
  } catch {
    return 'zh-CN';
  }
}

export function t(zh, en, root = process.cwd()) {
  return runtimeLang(root) === 'en' ? en : zh;
}
