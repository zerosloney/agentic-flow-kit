---
description: Deploy 阶段:prod 上线清单(静态门 + 配对检查 + 回归 + DB + 授权 + 24h 观察；文档关单在 test)
stage: Deploy
triggers:
  - "跑下 release"
  - "可以上了"
  - "过一遍 release 清单"
  - "准备上线"
approval_required: true
next: .agents/commands/maintain.md(仅事故时)
---

# Deploy · 上线清单

> 仅 prod。文档关单（验收勾验 / intent done）在 `test.md`，本阶段不重复关单。个人工作流:唯一授权人是用户本人——上线授权 = 用户一句确认 + `release/<日期>` tag 留痕,追溯靠 git,不依赖第二人审批。
> 环境定位:dev 为开发自测;staging 即人工验证环境(不设独立发布门);prod 上线必须过本清单。

## 1. 静态门(必跑,全过方可继续)

同 `test.md` §1(静态门全集:`项目构建命令` / `项目测试命令` / `项目类型检查命令` 与项目自有门禁;含环境注记与 Windows 取码注记),逐条跑完再继续。

## 2. 文档闭环(必查)

- L2 / L3 变更:入口文档(`workflow/intents/` 或 `workflow/incidents/`) + `workflow/specs/` + `workflow/plans/` 三件同名配对齐全；intent/spec/plan 状态为 done（test 已关单）。若仍为 approved，先回 `test.md` 补关单再上
- 若属修复:`workflow/incidents/` 同时须满足复盘三件套完整(结构性修复 / 防复发验证 / 规范条目)，状态 closed
- 新 intent 是否已立:根因属门禁缺位 / 规范未落地 / 系统性问题时强制立(即使修复已完成)

## 3. 回归清单(必过)

- `workflow/regression-checklist.md` 中涉及模块的关键路径条目全过
- 项目自动化测试用例全过(`项目测试命令`;不得跳过失败用例)
- 历史同类 incident 的防复发验证条目(清单「防复发验证」节)逐条过

## 4. 数据库(若涉及 schema 变更)

- 迁移 SQL 已按项目约定的 schema 变更流程验证并留档
- 实体映射与迁移 SQL 已人工核对一致
- 备份点已记录 + 回滚 SQL 就绪(L3 且含 schema 变更时强制)

## 5. 上线授权(用户本人最后一关)

- 授权人:用户本人(个人工作流,无第二审批人);对话内一句"上"即授权
- 授权记录:打 `release/<日期>` tag + commit SHA——tag 是「prod 跑的是哪个 commit」的追溯依据,`git log` 可查
- 发布流水线(可选):若项目 CI/CD 配置了人工审批卡点,按提示在流水线平台自行批准;批准人仍是本人,不构成第二人评审
- 回滚决策人:用户本人
- 回滚预案(按 L3 类型分叉):含 schema 变更 → <备份点 + 回滚 SQL 路径>;仅运行时 / 管线(无 schema,如认证管线 / DI 注册 / 中间件) → 回退上一 `release/<日期>` tag + 配置开关回退
- 回滚 SQL 必须在 dev 演练执行过(没跑过的回滚脚本等于没有);回退版本类预案须确认上一 tag 可复现构建

## 6. 上线后观察(用户观察,Maintain 阶段接手)

- 观察期:上线后 24h;由用户观察错误率 / 延迟 / 关键业务流(无监控时人工看)
- 闭环宣告:用户确认无异常后才算闭环;AI 不得自行宣告
- 异常回落:超阈值 → 生成 `workflow/incidents/YYYY-MM-DD-<主题>.md`,进 `maintain.md`(止血方案用户拍板,见 maintain.md §0)
- 事故响应:单用途账号 + 最小权限;不得跨智能体协作推送修复(参考 Anthropic 教训)

## 子代理调用约定

- 上线清单、回滚方案、授权、tag 与事故决策均由主智能体处理,本阶段不委派子智能体;回滚方案(尤其含数据回滚 SQL)涉及数据安全,不得以通用实现子智能体代替主智能体判断与用户确认。

## 确认后

- 打 `release/<日期>` tag（commit SHA 可追溯）
- 上线 + 用户观察 24h
- 用户确认无异常 → prod 闭环（文档 done 应已在 test 写好；若漏写在此补勾验收并置 done）
- 异常 → 进 `next: .agents/commands/maintain.md`
