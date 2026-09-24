---
description: Test 阶段:静态门(架构红线 + build + test)+ UI 实测(headless Chrome)
stage: Test
triggers:
  - "跑下 verify"
  - "改完了"
  - "跑下 verify 看看"
  - "验证一下"
delegation:
  - role: ui-verifier
    instructions: .agents/roles/ui-verifier.md
    when: 涉及 UI 改动且静态门已通过
    required: true
    fallback: main
  - role: independent-reviewer
    instructions: .agents/roles/independent-reviewer.md
    when: L2 或 L3 改动完成且 diff 已固定
    required: true
    fallback: new-session
approval_required: true
next: L1 关单结束 ；L2/L3 上 prod 时 → .agents/commands/deploy.md
---

# Test · 静态门 + UI 实测

> 两道闸:静态门全过 + 涉及 UI 走浏览器实测。失败不放过。

## 1. 静态门(代码改动后必跑)

```bash
# 项目自有门禁脚本(如有;清单以 .agents/hooks/ 与目录级 AGENTS.md 头部注释为准)
项目构建命令                                      # 编译
项目测试命令                                       # 自动化测试
项目类型检查命令                                  # 前端类型检查/构建(涉及前端时跑)
node .agents/scripts/verify-wiki-consistency.mjs   # 触及 wiki/ 时跑(exit 1 即先修台账再继续:跑 gen-wiki-board.mjs 补索引/看板;pre-commit 已按增量自动拦,此行用于改完即验)
```

> **环境注记**：本地服务占用构建产物导致编译失败、多会话并行时「谁跑静态门 / 提交谁先停服务」等约定——如有,见项目注记 `.agents/notes/runtime-env.md` §2,跑静态门前先过一眼。

> **Windows / PowerShell 取码**：`bash` / `sh` 不在 PATH、命令不存在时 `$LASTEXITCODE` 保持旧值（假绿）——调法与取真码姿势见 `.agents/notes/runtime-env.md` §1(如有),断言「通过」前先确认命令真的跑了。

任一失败 → 不进 UI 实测,回 `build.md` 修复;失败难复现(偶发/跨层)时先用 `diagnosing-bugs` 技能走诊断循环(红→最小化→假设→插桩→修复→回归),修复仍回 `build.md`。

> **门禁 / 看板 / wiki 脚本改动**(`.agents/scripts/`、`.agents/hooks/`、`.agents/board/`):按改动对象跑对应 fixture 回归,须全绿——闭环门禁 `sh .agents/scripts/check-loop.test.sh`、wiki 生成器 `node .agents/scripts/gen-wiki-board.test.mjs`、提交前 hook 测试(如有);涉及看板告警规则时,用同批 workflow fixture 双跑 `check-loop.sh` 与看板 `/api/board`,断言 hard-block 集合被看板告警覆盖(防口径分叉)。

## 2. 切库冒烟(切换 / 新增目标库后必跑)

改了项目数据库连接配置(或新增目标库)时,静态门不足以保证库-代码一致(编译 / 类型检查不连库;自动化测试覆盖受既有用例限制),必须额外两步:

1. **schema 比对**:代码期望的表与列 vs 目标库实际 schema。范围 = 近期 schema 变更脚本涉及对象 + 项目基础 / 平台只读表(如有)
2. **接口探活**:跑项目自有冒烟脚本(如有,脚本路径登记于根 `AGENTS.md`「项目适配区」;脚本不可用再手工逐个 GET 关键端点),任一非 200 即判库未同步,**停在此步,不部署**

防复发条目的断言增量登记在 `workflow/regression-checklist.md`(如有)。

## 3. UI 实测(涉及前端改动时)

调用项目 UI 实测技能 `.agents/skills/verify-ui/SKILL.md`(如有)；环境细节(服务起法 / headless Chrome 参数 / CDP 注入 / 进程生命周期)见该技能与项目注记 `.agents/notes/runtime-env.md`(如有)。

## 4. 独立复核(L2/L3 强制)

- L2/L3 改动必须由 `independent-reviewer` 在独立上下文复核;宿主不支持子智能体时另开新会话,避免沿用原修改思路盲区
- 复核者读入口文档(intent / incident) + spec + plan + diff,判断变更意图与风险
- 复核意见交用户定性(采纳 / 驳回);采纳项回 `build.md` 修改

## 子代理调用约定

- 静态门不委派;UI 实测委派 `ui-verifier`(静态门通过后)、独立复核委派 `independent-reviewer`,均要求读取对应 `.agents/roles/*.md`;宿主不支持时按 frontmatter `fallback`(reviewer 必须另开新会话,不得主智能体自查冒充)。
- 子智能体只返回证据与结论——失败项修复仍回 `build.md`,不得在 Test 阶段顺手改代码;修复后重跑本阶段,全过后用户确认再关单。

## 确认后

- 输出测试报告(通过项 / 失败项)
- 失败项已修复并复测通过
- **关单**（日常闭环点，不依赖是否上 prod）:
  - 新需求：逐条勾验入口 intent「验收标准」，每条补「证据：」，intent → done；同名 spec（若有）仍 approved → done
  - 修复：防复发验证已落地，incident → closed
  - **同族收尾**：入口置终态时，同名 plan 一并置 `done`（spec 见上条），不留 `approved` 孤儿（口径同看板「入口已 done，本 plan 未终态」告警）
  - 主智能体自做的 L1+ 新需求在 `workflow/delegations.md`「自做任务结果表」记一行（修复类不重复记）
- L1：本阶段结束，不进 deploy
- L2/L3：仅当用户确认要上 prod 时进 `.agents/commands/deploy.md`
