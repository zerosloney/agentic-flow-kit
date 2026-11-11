---
name: tfs-pr
description: 内网自托管 TFS / Azure DevOps Server PR 技能，项目无关：自动识别 git 仓库与远端推导 collection/project/repo，PAT 缺失时引导创建并保存环境变量；查 PR / 建 PR（context 拉 diff 提炼标题与描述）/ 改 PR 描述 / 冲突预检与 worktree 隔离解决，走 REST API + PAT（az devops 扩展拒 http 组织 URL，az 不可用）。命令入口 .agents/skills/tfs-pr/scripts/tfs-pr.mjs。
---

权威技能：`.agents/skills/tfs-pr/SKILL.md`。本文件是指针壳，执行时读取权威源，不在此复制正文。
