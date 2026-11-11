---
标题: 裸中段路径样例
状态: 起草中
级别: L1
模块: 物资
日期: 2099-12-31
---
# PLAN — 裸中段路径样例：托盘查询联动

## 任务拆解
1. **T1 前端查询栏联动**：改造 pml/index.vue 查询栏，收敛 if/else 分支，Success/Error 提示对齐 contractTemplate/index.vue
   - 判据：前端构建通过
2. **T2 列序常量调整**：抽共享常量到 pml/shared.ts
   - 判据：单测通过
