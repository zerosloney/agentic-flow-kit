#!/usr/bin/env node
// 项目门禁挂载点（.githooks/pre-commit 在通用门禁之后执行本文件；返回非零即阻断提交）
// 单一执行路径（rules v1）：四个 code 门（架构 / 审计字段 / 删除守卫 / 通知守卫）统一由
// `flow-kit rules check --staged --phase pre-commit --face code,ui` 求值；规则由旧配置投影
// （src/rules/adapters.mjs），与旧门禁逐条对拍（tests/rules-parity.test.mjs）。
// 旧门禁脚本仍保留可单独调用（verify / 写前门过渡期使用），本挂载点不再逐个 spawn。
// 退出码透传：0 通过 / 1 违例（或目标缺失）/ 2 配置错——不要在末尾无条件 exit 0。
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// stdin 属于宿主的 hook 协议，不向下传；stdout/stderr 继承，违例输出原样可见。
const CLI = path.resolve(HERE, '..', '..', '..', '..', 'bin', 'flow-kit.mjs');
const child = spawn(process.execPath, [CLI, 'rules', 'check', '--staged', '--phase', 'pre-commit', '--face', 'code,ui'], {
  stdio: ['ignore', 'inherit', 'inherit'],
});
child.on('error', (err) => {
  console.error(`local-pre-commit: 无法执行 rules check（${err.message}）——提交已阻止`);
  process.exit(1);
});
child.on('close', (code) => process.exit(code === null ? 1 : code));
