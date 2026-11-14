#!/usr/bin/env node
// check-devcontainer：开发容器声明校验（R3-8 沙箱面；零依赖零网络）。
// 动机：R3-8「沙箱与供应链」——容器是 AI 干活的隔离环境，它从哪来、拉哪个镜像、
//   装哪个版本的 flow-kit，都得是「声明过的」而不是「随手改的」。
// 判定面（对齐 .agents/config/devcontainer-policy.json，schema schemas/devcontainer-policy.schema.json）：
//   - 镜像来源必须在 allowedImagePrefixes 白名单内（供应链：不许拉来路不明的镜像）；
//   - 镜像必须钉到具体 tag（forbiddenTags 里的浮动 tag 一律红）；
//   - Dockerfile 必须钉定 flow-kit 版本（requirePinnedFlowKit；不接受 latest/*）；
//   - devcontainer.json 必须是合法 JSON，且有 name / build.dockerfile / 合法 forwardPorts。
// 项目没有 .devcontainer/（未启用容器，或 --no-devcontainer 安装）→ 大声跳过并记 0，不算红。
// 退出码：0 通过或跳过；1 声明违规；2 策略文件损坏。
// 用法：flow-kit run check-devcontainer.mjs [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.FLOW_KIT_PROJECT_ROOT || path.join(SCRIPT_DIR, '..', '..'));
const POLICY_REL = '.agents/config/devcontainer-policy.json';
const JSON_REL = '.devcontainer/devcontainer.json';
const DOCKERFILE_REL = '.devcontainer/Dockerfile';

const DEFAULT_POLICY = {
  version: 1,
  allowedImagePrefixes: ['mcr.microsoft.com/devcontainers/'],
  forbiddenTags: ['latest'],
  requirePinnedFlowKit: true,
};

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const unknownArgs = args.filter((a) => a !== '--json');
if (unknownArgs.length) {
  console.error(`check-devcontainer: 未知参数：${unknownArgs.join(' ')}（用法：flow-kit run check-devcontainer.mjs [--json]）`);
  process.exit(2);
}

function readJson(abs) {
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

function loadPolicy() {
  const abs = path.join(ROOT, POLICY_REL);
  if (!fs.existsSync(abs)) return { ...DEFAULT_POLICY };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    console.error(`check-devcontainer: ${POLICY_REL} 无法解析（${err.message}）——策略失守，按违规处理。`);
    process.exit(2);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    console.error(`check-devcontainer: ${POLICY_REL} 根必须是对象——策略失守，按违规处理。`);
    process.exit(2);
  }
  return {
    version: Number(raw.version) || DEFAULT_POLICY.version,
    allowedImagePrefixes: Array.isArray(raw.allowedImagePrefixes)
      ? raw.allowedImagePrefixes.map(String)
      : DEFAULT_POLICY.allowedImagePrefixes,
    forbiddenTags: Array.isArray(raw.forbiddenTags) ? raw.forbiddenTags.map(String) : DEFAULT_POLICY.forbiddenTags,
    requirePinnedFlowKit: raw.requirePinnedFlowKit !== false,
  };
}

function parseDockerfileImage(text) {
  const m = /^FROM\s+(\S+)/im.exec(String(text || ''));
  return m ? m[1] : null;
}

// 钉定版本优先读 Dockerfile 的 ARG 默认值（生成器就是这么写的），没有 ARG 时退回安装目标上的字面版本。
function parseDockerfileKitVersion(text) {
  const s = String(text || '');
  const arg = /^\s*ARG\s+FLOW_KIT_VERSION=(\S+)/im.exec(s);
  if (arg) return arg[1].trim();
  const m = /agentic-flow-kit@([^\s"'\\]+)/.exec(s);
  return m ? m[1] : null;
}

function isConcreteVersion(version) {
  return /^\d+\.\d+\.\d+/.test(String(version || ''));
}

function imageTag(image) {
  const s = String(image || '');
  const slash = s.lastIndexOf('/');
  const colon = s.lastIndexOf(':');
  if (colon <= slash || colon < 0) return null;
  return s.slice(colon + 1);
}

function main() {
  const policy = loadPolicy();
  const jsonAbs = path.join(ROOT, JSON_REL);
  const dockerAbs = path.join(ROOT, DOCKERFILE_REL);

  if (!fs.existsSync(jsonAbs)) {
    const summary = { ok: true, skipped: true, reason: 'no-devcontainer', problems: [] };
    if (jsonOut) console.log(JSON.stringify(summary, null, 2));
    else console.log(`[check-devcontainer] 跳过：项目没有 ${JSON_REL}（未启用开发容器）——不判红。`);
    process.exit(0);
  }

  const problems = [];
  let doc = null;
  try {
    doc = JSON.parse(fs.readFileSync(jsonAbs, 'utf8'));
  } catch (err) {
    problems.push(`${JSON_REL}: ${err.message}`);
  }
  if (doc) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) problems.push(`${JSON_REL}: 根必须是对象`);
    else {
      if (!doc.name || typeof doc.name !== 'string') problems.push(`${JSON_REL}: 缺少 name`);
      if (!doc.build || typeof doc.build !== 'object' || !doc.build.dockerfile) problems.push(`${JSON_REL}: 缺少 build.dockerfile`);
      if (doc.forwardPorts != null) {
        const ports = Array.isArray(doc.forwardPorts) ? doc.forwardPorts : [];
        if (!ports.every((p) => Number.isInteger(p) && p > 0)) problems.push(`${JSON_REL}: forwardPorts 非法`);
      }
    }
  }

  let image = null;
  let kitVersion = null;
  if (!fs.existsSync(dockerAbs)) {
    problems.push(`${DOCKERFILE_REL}: 缺失`);
  } else {
    const text = fs.readFileSync(dockerAbs, 'utf8');
    image = parseDockerfileImage(text);
    if (!image) problems.push(`${DOCKERFILE_REL}: 缺少 FROM 指令`);
    else {
      if (!policy.allowedImagePrefixes.some((prefix) => image.startsWith(prefix))) {
        problems.push(`镜像不在白名单内：${image}`);
      }
      const tag = imageTag(image);
      if (!tag) problems.push(`镜像未钉版本：${image}`);
      else if (policy.forbiddenTags.includes(tag)) problems.push(`镜像使用了浮动 tag「${tag}」：${image}`);
    }
    kitVersion = parseDockerfileKitVersion(text);
    if (policy.requirePinnedFlowKit && !isConcreteVersion(kitVersion)) {
      problems.push(`${DOCKERFILE_REL}: 未钉定 flow-kit 版本`);
    }
  }

  const summary = { ok: problems.length === 0, skipped: false, image, kitVersion, problems };
  if (jsonOut) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    if (problems.length) {
      console.error('[check-devcontainer] ❌ 开发容器声明违规：');
      for (const p of problems) console.error(`  · ${p}`);
      console.error(`  策略：${POLICY_REL}`);
    } else {
      console.log(`[check-devcontainer] ✅ 开发容器声明通过（镜像 ${image}，flow-kit ${kitVersion}）`);
    }
  }
  process.exit(summary.ok ? 0 : 1);
}

main();
