// ci-templates.test.mjs — 随包发布的 CI 工作流：第三方 action 必须按完整 commit SHA 固定，
// 模板最小权限，且安装到项目里的 kit 版本与渲染器注入的 {{kitVersion}} 一致。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "../src/render/tokens.mjs";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = path.join(KIT, "templates", "git", ".github", "workflows", "ci.yml");
const RELEASE = path.join(KIT, ".github", "workflows", "release.yml");

const read = (file) => fs.readFileSync(file, "utf8");

/** 抽出所有 `uses:` 行（忽略注释行）。 */
function usesLines(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:-\s+)?uses:\s*\S+/.test(line) && !/^\s*#/.test(line));
}

function assertPinned(text, label) {
  const lines = usesLines(text);
  assert.ok(lines.length > 0, `${label}: 未找到 uses: 行`);
  for (const line of lines) {
    const step = line.trim().replace(/^-\s+/, "");
    const ref = step.replace(/^uses:\s*/, "").split(/\s+#/)[0].trim();
    if (ref.startsWith("./")) continue; // 本地 composite action 无需固定
    const m = ref.match(/^[^@\s]+@([0-9a-f]{40})$/);
    assert.ok(m, `${label}: action 未按 40 位 commit SHA 固定：${ref}`);
    assert.match(line, /#\s*v\d+\.\d+\.\d+/, `${label}: 固定行缺少可读 tag 注释：${line.trim()}`);
  }
}

test("发布用工作流按完整 commit SHA 固定第三方 action", () => {
  const text = read(RELEASE);
  // 该作业持有 secrets.NPM_TOKEN：tag 被移动即等于把发布令牌交给上游任意代码。
  assert.match(text, /secrets\.NPM_TOKEN/);
  assertPinned(text, "release.yml");
});

test("安装到项目的 CI 模板按完整 commit SHA 固定第三方 action", () => {
  assertPinned(read(TEMPLATE), "templates/git ci.yml");
});

test("安装到项目的 CI 模板最小权限并锁定 kit 版本", () => {
  const text = read(TEMPLATE);

  // 默认令牌 scope 扩大到写入面：模板自身只读仓库，必须显式声明。
  assert.match(text, /^permissions:\s*$/m);
  assert.match(text, /^\s+contents:\s*read\s*$/m);

  // npx 每次都必须带版本——渲染器把 {{kitVersion}} 换成安装时的 kit 版本，
  // 否则 CI 跑的是 registry 上的浮动 latest，与项目内已安装的门禁实现不一致。
  const npx = text.match(/npx --yes agentic-flow-kit[^\s]*/g) || [];
  assert.ok(npx.length > 0, "模板应包含 npx agentic-flow-kit 调用");
  for (const call of npx) {
    assert.equal(call, "npx --yes agentic-flow-kit@{{kitVersion}}", `未锁定 kit 版本：${call}`);
  }

  const rendered = render(text, { kitVersion: "9.9.9" });
  assert.doesNotMatch(rendered, /\{\{kitVersion\}\}/);
  assert.match(rendered, /npx --yes agentic-flow-kit@9\.9\.9 run verify --full/);
});
