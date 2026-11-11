---
标题: L1 单文件样例
状态: 起草中
级别: L1
模块: 物资
日期: 2099-12-31
---
# PLAN — L1 单文件样例：修复物资推送重试

## 背景
推送失败后直接静默，需要补重试。

## 改动方案
- `backend/Widgets/MaterialPushService.cs`：失败后重试 3 次
- `backend/Widgets/MaterialPushOptions.cs`：新增重试间隔配置
