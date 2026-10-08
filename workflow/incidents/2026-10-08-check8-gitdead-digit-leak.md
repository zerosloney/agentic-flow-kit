---
状态: closed
级别: L1
发现: 2026-10-08
模块: pipeline
备注: 检查 8「纯数字证据 × git 通道坏死」组合路径漏拦——rev-parse 实证不可能时纯数字 text 豁免把 fail-closed 漏成 fail-open（v1.3.0 Release ubuntu 腿实证）；本件为补留痕：修复 e1624b7 已于 2026-10-08 提交，双轴审查 Spec 轴发现该修复无 incident 留痕后回填
确认指纹: 75b07d36ad27b96c
---
# INCIDENT — 2026-10-08 check8 通道坏死 × 纯数字证据漏拦

## 时间线

- 前情：2026-10-05-check8-digit-sha-misfire（77da9d2）把纯数字证据改由 rev-parse 实证分流——通道**健康**时「解析不存在 → text 豁免 / 解析存在 → 裁决」语义自洽；但**通道坏死**（spawn 异常）时 rev-parse 不可能给出回答，旧代码落入纯数字 text 豁免 → fail-open
- 2026-10-07/08 之交：v1.3.0 Release CI ubuntu 腿实证——fixture 短 sha 恰全数字（`--short` 7 位 ≈4%/run）时，fail-closed 预期被纯数字 text 豁免漏成 exit 0（win32 sha 含字母走 forged 故本地恒绿——平台概率差异，见 e1624b7 测试注释）
- 2026-10-08 00:21 修复：e1624b7——`revParse.error`（spawn 异常，非 git 的正常回答）时禁用 text/external 豁免、按伪造拦（fail-closed），与守卫上方既有注释「本地核验不了就按伪造拦」对齐；通道健康时纯数字 text 豁免语义保持（misfire 防线不回归，+2 断言）
- 2026-10-08 补留痕：双轴审查（Spec 轴）发现该修复类门禁行为变更无 incident 留痕、提交信息是唯一规格——本件与同名 plan 回填
- 用户确认：补留痕授权（2026-10-08 对话内「处理1，2，3」第 2 项）
- 2026-10-08 用户确认：关单（对话内，原话「确认」——incident fixed→closed、同名 plan approved→done 逐件代录）

## 影响面

- 检查 8 证据核验可靠性：装户/本仓在 git spawn 异常（runner 资源紧张 EAGAIN/EPERM 类，2026-10-05-gitout-fail-open 已实证存在）× 证据 sha 恰全数字（≈4%）的组合下，伪造证据被 text 豁免放行（fail-open）；平时不可见，CI 概率性暴露
- 判定面变化（修复本身）：通道坏死 × 纯数字证据 → 由 text 豁免（exit 0）改为 forged 拦（exit 1）——方向为收紧，与既有 fail-closed 契约一致

## 根因

2026-10-05 misfire 修复把「纯数字 → rev-parse 实证」插在通道坏死判定之前，但实证分流只处理了「rev-parse 正常回答不存在」的分支；`revParse.error`（spawn 异常 = 实证不可能）未单独分流，落入纯数字 text 豁免——「实证不可能」与「实证为否」两种失败被同一豁免吞掉。
（深层：gitout-fail-open 已立「通道坏死必须 fail-closed」原则并以注释落在守卫上方，misfire 修复新增豁免分支时未对照该原则做组合路径盘点——纯数字 × 通道坏死是两张 L2 单各自修一半留下的组合缺口。）

## 为什么之前没拦住

- 测试：misfire 单的场景 5u 只覆盖通道健康（git tag 数字 ref）；「通道坏死 × 纯数字 sha」组合依赖 fixture sha 恰好全数字（≈4%/run 概率），无法构造性复现——直到 v1.3.0 Release ubuntu 腿偶然命中
- 门禁：检查 20 只查套件存在；概率性组合路径无静态拦截面
- 规范：fail-closed 原则已存在（gitout-fail-open 落的注释），但「新增豁免分支须对照通道坏死原则做组合路径盘点」未成流程——修复提交本身也未立 incident（本件即该流程缺口的补课）

## 复盘三件套（缺一不可）

1. 结构性修复
   - 修复 commit：e1624b7（templates/_agents/scripts/check-loop.mjs `revParse.error` 守卫 + 注释；check-loop.test.mjs 坏死/健康双态 2 断言；.agents/ 装副本两件 + kit.json sha + CHANGELOG）
   - 影响环境：dev（引擎包源 templates/ + 装副本 .agents/ 双源）；装户经下个版本发布获得
   - 是否需要新 intent：
     - 否 → 理由：实现 bug 单点修复（守卫顺序与既有注释已声明的 fail-closed 契约不符——契约由 2026-10-05 两张 L2 incident 立法，本修是补齐漏点不是立新规）；判定面变化方向为收紧，且已有规范条目覆盖（misfire「文本启发式须可被实证兜底」+ gitout-fail-open fail-closed 注释）
2. 防复发验证（必须落到自动化用例或回归清单条目，禁止只写「已人工验证」）
   - 自动化用例：templates/_agents/scripts/check-loop.test.mjs（e1624b7 新增场景双断言：① `CHECK_LOOP_GIT` 坏死 × 纯数字证据 → exit 1 + 「证据伪造」；② 通道健康 × 纯数字假 sha → exit 0 + 「证据豁免 text」——misfire 防线不回归）（随 npm test 回归）
3. 规范条目（必须有可追溯的落点）
   - 落点：templates/_agents/scripts/check-loop.mjs `revParse.error` 守卫处注释（通道坏死禁豁免、fail-closed 与守卫上方注释互引）；本 incident（「新增豁免分支须对照通道坏死原则做组合路径盘点」的流程教训落点）
   - 引用：commit e1624b7
