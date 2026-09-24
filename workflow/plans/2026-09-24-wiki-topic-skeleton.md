---
状态: done
级别: L1
模块: wiki
---
# PLAN — wiki 模板预置主题内容目录骨架

对应入口：../intents/2026-09-24-wiki-topic-skeleton.md

## 改动面（L1 极简形态主节）
- `templates/wiki/产品需求/README.md`：新增——需求文档与变更记录（PRD、需求说明、评审结论）
- `templates/wiki/用户功能/README.md`：新增——功能清单与操作说明（功能视角）
- `templates/wiki/开发方案/README.md`：新增——技术方案与设计文档（架构、接口、关键取舍）
- `templates/wiki/项目规范/README.md`：新增——编码 / 流程 / 协作规范
- `templates/wiki/项目计划/README.md`：新增——计划、里程碑与会议纪要
- `templates/wiki/测试报告/README.md`：新增——测试报告与验收记录（按日期-主题命名）
- `templates/wiki/数据维护/README.md`：新增——schema 变更与数据修复台账（注明子目录批内台账不参与登记的引擎特例）
- `templates/wiki/INDEX.md`：速览表预填 7 行（主题 + 用途，文件数留生成区首跑回填）

## 验证方式
- 静态门：`npm test`（生成器 fixture 不回归）
- 实测：临时目录 init → 7 目录在 → 目录内 gen-wiki-board + verify-wiki-consistency 全过 → doctor 0 FAIL
- 闭环：本任务自己走 verify + 关单勾验

## 确认与复核
- 确认结果：approved（2026-09-24 用户截图指名 7 目录随报随修——「补齐这些目录」，需求即确认）；done（2026-09-24 关单，随入口文档置终态）
- 确认门记录：改动面 = 截图 7 目录的直接展开；「README 占位 + INDEX 预填人工列」方案要点随 intent 记录
