#!/usr/bin/env node
// flow-kit CLI 入口：init（安装）/ doctor（体检）/ help
import { init } from './init.mjs';
import { doctor } from './doctor.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const HELP = `flow-kit — AI-Native 闭环工作流 + wiki 知识层脚手架（agentic-flow-kit）

用法：
  flow-kit init    安装到当前项目（裸跑无参数 → 交互确认环节；带参数直接执行）
  flow-kit doctor  体检：目录布局 / git 钩子 / managed 清单 / 索引漂移 / check-loop

init 选项（全部可选，均有默认值）：
  --stack <技术栈>     dotnet | node | python | go | none（默认 none）——门禁配置三处：commit-check
                       条件编译检查（builds）与质量检测（checks：lint/类型/vet 等秒级确定性检查，
                       有对应配置文件才启用）、settings.json 自检验命令权限（allow）、
                       AGENTS.md「项目适配区」命令预填
  --hosts <宿主列表>   逗号分隔：zcode,opencode,trae,omp（默认 zcode；zcode/omp 为本地配置，自动进 .gitignore）
  --board-port <端口>  workflow 看板端口（默认 8933）
  --dir <目录>         目标项目根（默认当前目录）
  --force              覆盖已存在的同名文件（默认保守跳过）

示例：
  npx agentic-flow-kit init                        # 交互模式：宿主 → 技术栈 → 端口 → 确认安装
  npx agentic-flow-kit init --stack node --hosts zcode,opencode

装完即自包含：项目不依赖本包运行；AGENTS.md 生成「AI工作流 + Wiki」骨架，项目细节在「项目适配区」自填；升级用 flow-kit sync（后续版本提供）。`;

export function run(argv) {
  const cmd = argv[0];
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    return;
  }
  if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
    const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
    console.log(pkg.version);
    return;
  }
  if (cmd === 'init') {
    init(argv.slice(1), PKG_ROOT).catch((e) => {
      console.error(`❌ ${e?.message || e}`);
      process.exit(1);
    });
    return;
  }
  if (cmd === 'doctor') {
    doctor(argv.slice(1), PKG_ROOT);
    return;
  }
  console.error(`未知命令：${cmd}\n\n${HELP}`);
  process.exit(1);
}
