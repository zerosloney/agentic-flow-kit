#!/usr/bin/env node
// 一次性迁移工具：从项目现行引擎面提取模板到 agentic-flow-kit/templates。
// 只复制「引擎/宿主/脚手架」允许清单，运行态（cache/tmp/*.jsonl/confirmations.d）、
// 业务内容（backend/frontend/tools/wiki 业务文档）与机器本地文件（runtime-env.local.md、
// model-roles.local.json、宿主 worktrees/v2 生成物）一律不复制。
// 用法：node tools/extract-from-project.mjs --project <项目根> [--dry-run]
import fs from 'node:fs';
import path from 'node:path';

const KIT = path.resolve(import.meta.dirname, '..');
// kit 独立于项目仓：项目根由 --project / AGENTIC_FLOW_PROJECT 指定，缺省当前工作目录。
const argProject = (() => {
  const i = process.argv.indexOf('--project');
  return i >= 0 ? process.argv[i + 1] : '';
})();
const ROOT = path.resolve(argProject || process.env.AGENTIC_FLOW_PROJECT || process.cwd());
const T = path.join(KIT, 'templates');
const dry = process.argv.includes('--dry-run');
let copied = 0;

const cp = (srcRel, destRel) => {
  const src = path.join(ROOT, srcRel);
  if (!fs.existsSync(src)) {
    console.warn(`[skip] missing ${srcRel}`);
    return;
  }
  const dest = path.join(T, destRel);
  if (!dry) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true, force: true });
  }
  copied++;
  console.log(`[copy] ${srcRel} -> templates/${destRel}`);
};

// —— 引擎核心（.agents 允许清单）——
cp('.agents/commands', 'engine/.agents/commands');
cp('.agents/config', 'engine/.agents/config');
cp('.agents/hooks', 'engine/.agents/hooks');
cp('.agents/scripts', 'engine/.agents/scripts');
cp('.agents/skills', 'engine/.agents/skills');
cp('.agents/roles', 'engine/.agents/roles');
cp('.agents/pipelines', 'engine/.agents/pipelines');
cp('.agents/tests', 'engine/.agents/tests');
cp('.agents/board', 'engine/.agents/board');
cp('.agents/settings.json', 'engine/.agents/settings.json');
cp('.agents/notes/runtime-env.md', 'engine/.agents/notes/runtime-env.md');
cp('.agents/notes/runtime-env.local.example.md', 'engine/.agents/notes/runtime-env.local.example.md');

// —— 宿主适配层（v1 十宿主）——
cp('.trae/agents', 'hosts/trae/agents');
cp('.trae/commands', 'hosts/trae/commands');
cp('.trae/rules', 'hosts/trae/rules');
cp('.trae/hooks.json', 'hosts/trae/hooks.json');

cp('.codebuddy/agents', 'hosts/codebuddy/agents');
cp('.codebuddy/commands', 'hosts/codebuddy/commands');
cp('.codebuddy/rules', 'hosts/codebuddy/rules');
cp('.codebuddy/skills', 'hosts/codebuddy/skills');
cp('.codebuddy/settings.json', 'hosts/codebuddy/settings.json');
cp('.codebuddy/CODEBUDDY.md', 'hosts/codebuddy/CODEBUDDY.md');

cp('.claude/agents', 'hosts/claude/agents');
cp('.claude/commands', 'hosts/claude/commands');
cp('.claude/settings.json', 'hosts/claude/settings.json');
cp('CLAUDE.md', 'hosts/claude/CLAUDE.md');

cp('.opencode/agents', 'hosts/opencode/agents');
cp('.opencode/commands', 'hosts/opencode/commands');
cp('.opencode/.gitignore', 'hosts/opencode/.gitignore');

cp('.qwen/agents', 'hosts/qwen/agents');
cp('.qwen/commands', 'hosts/qwen/commands');
cp('.qwen/settings.json', 'hosts/qwen/settings.json');

cp('.pi/agents', 'hosts/pi/agents');
cp('.pi/extensions', 'hosts/pi/extensions');
cp('.pi/settings.json', 'hosts/pi/settings.json');

cp('.cline/agents', 'hosts/cline/agents');
cp('.cline/hooks', 'hosts/cline/hooks');
cp('.cline/workflows', 'hosts/cline/workflows');

cp('.commandcode/agents', 'hosts/commandcode/agents');
cp('.commandcode/commands', 'hosts/commandcode/commands');
cp('.commandcode/settings.json', 'hosts/commandcode/settings.json');

cp('.qoder/agents', 'hosts/qoder/agents');
cp('.qoder/commands', 'hosts/qoder/commands');
cp('.qoder/settings.json', 'hosts/qoder/settings.json');

cp('.zcode/agents', 'hosts/zcode/agents');
cp('.zcode/config.json', 'hosts/zcode/config.json');
cp('.zcode/workflows', 'hosts/zcode/workflows');

// —— git 门禁 ——
cp('.githooks', 'git/.githooks');
cp('.gitattributes', 'git/.gitattributes');

// —— 数据资产脚手架（只取协议/模板，不取业务内容）——
cp('workflow/README.md', 'scaffold/workflow/README.md');
cp('workflow/intents/_TEMPLATE.md', 'scaffold/workflow/intents/_TEMPLATE.md');
cp('workflow/specs/_TEMPLATE.md', 'scaffold/workflow/specs/_TEMPLATE.md');
cp('workflow/plans/_TEMPLATE.md', 'scaffold/workflow/plans/_TEMPLATE.md');
cp('workflow/incidents/_TEMPLATE.md', 'scaffold/workflow/incidents/_TEMPLATE.md');
cp('wiki/drafts-archive/README.md', 'scaffold/wiki/drafts-archive/README.md');
cp('wiki/数据维护/README.md', 'scaffold/wiki/数据维护/README.md');
cp('wiki/知识沉淀总览.html', 'scaffold/wiki/知识沉淀总览.html');
cp('wiki/INDEX.md', 'scaffold/wiki/INDEX.md');

console.log(`\n[done] ${copied} source paths copied${dry ? ' (dry-run)' : ''}.`);
