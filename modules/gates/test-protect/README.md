# test-protect

暂存 diff 若同时包含「测试文件」与「非测试文件」（即测试与代码同框改动），提交失败。

fix/调试任务中，测试是「bug 已修」的证据；证据与结论同一次改动 = 自证，闭环失去意义。此门禁把
「fix 不得改测试」从提示语变成机器红线，不依赖 agent 客户端自觉。

```sh
npx agentic-flow-kit add-gate test-protect
```

**测试文件识别**（脚本头部 CONFIG 可按项目扩展）：

- 目录面：`tests/`、`__tests__/`、`test/`、`spec/`（任意层级）
- 文件面：`*.test.*`、`*.spec.*`、`_test_*.py`（python pytest 风格）

**豁免**（不是漏洞，是显式语义）：

- 纯测试提交（只改测试文件，无代码同框）——新增/修正测试本身合法。
- 显式声明 `FLOW_KIT_ALLOW_TEST_EDIT=1 git commit`——对应 plan 中显式标注「本次需同步演进测试」
  （测试先行 / 行为断言变更）。门禁只判暂存面事实，语义归显式声明，不读任务元数据。

**不拦截**：merge 提交无暂存 diff；工作区未暂存改动（提交面之外）。