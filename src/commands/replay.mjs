import fs from 'node:fs';
import path from 'node:path';

// 安装清单 → buildPlan / buildVars 入参的唯一重放点：diff / explain / doctor 漂移 /
// remove-host / uninstall 等一切「重建已安装内容」的路径都走这里。
// 新增影响计划或渲染的安装选项时，必须同时写进 manifest 并在此重放；漏一处会让
// 非默认安装出现假漂移，或让 remove-host 收敛时把文件退回默认渲染。

// engine.json 的 createdAt 是安装时唯一使用 {{installedAt}} 的 token；
// 从已安装文件回读它，避免把该文件误判为模板更新（manifest.installedAt 是写盘时间）。
// 安装器重跑 / 崩溃续装时复用同一个值以保证字节幂等——两边共用这一份实现。
export function readInstalledAt(target) {
  try {
    const engine = JSON.parse(fs.readFileSync(path.join(target, '.agents/config/engine.json'), 'utf8'));
    return engine.createdAt || null;
  } catch {
    return null;
  }
}

export function planInputsFromManifest({ target, manifest, hosts, lang, models = null, categories = null }) {
  return {
    target,
    hosts,
    lang,
    stack: manifest.stack || 'empty',
    stacks: manifest.stacks || null,
    projectName: manifest.projectName || path.basename(target),
    categories,
    models,
    tier: manifest.tier || 'standard',
    hardened: Boolean(manifest.hardened),
    // 与 installer 重放旧清单的口径一致（previous?.mcp !== false）：显式 false 才算关闭。
    mcp: manifest.mcp !== false,
    surfaces: manifest.surfaces || [],
    managedPermissions: manifest.managedPermissions || {},
    devcontainer: manifest.devcontainer !== false,
    ci: manifest.ci || null,
    scaffold: manifest.scaffold || 'full',
  };
}

export function varsInputsFromManifest({ target, manifest, hosts, lang, kitVersion }) {
  return {
    target,
    projectName: manifest.projectName || path.basename(target),
    stack: manifest.stack || 'empty',
    stacks: manifest.stacks || null,
    language: lang,
    hosts,
    kitVersion,
    installedAt: readInstalledAt(target) || manifest.installedAt || '',
    trackHosts: manifest.trackHosts === true,
    // 项目形态与端口参与模板渲染：不重放会把非默认安装误判成「模板更新」或回退成默认文案。
    ports: manifest.ports,
    product: manifest.product,
  };
}
