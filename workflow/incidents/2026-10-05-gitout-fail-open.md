---
状态: closed
级别: L2
发现: 2026-10-05
模块: pipeline
备注: gitOut 把 spawn 异常与「非 git 仓」合并返回 null——git 仓内瞬时探测异常静默降级（fail-open）；根治 = fail-loud + 单次重试，同名 spec/plan 配对
确认指纹: 008afa92f3c22cc2
---
# INCIDENT — 2026-10-05 gitOut fail-open：瞬时 spawn 异常致检查 8 静默跳过

## 时间线

- 2026-10-05 01:48Z（v1.1.0 发版窗口）：CI dedfc7d（run 37252874044）ubuntu+node22 腿红 1 例——check-loop.test.mjs 场景「过程证据:无标记无关提交 → 仍拦 证据无关」合计 PASS 195 / FAIL 1；失败 detail：`exit=0`、输出仅 advisory（角色缺失 ×3），**无任何证据核验裁决**（检查 8 整体被跳过，而非判错）
- 2026-10-05 定位：`gitOut`（templates/_agents/scripts/check-loop.mjs:213-218）把 spawn 异常（`r.error`）与「非 git 仓」（status≠0）与 ok 过滤失败合并返回单一 `null`；检查 8 入口门（:720 `gitOut(['rev-parse','--git-dir']) !== null`）得 null 即静默跳过证据核验 → git 仓内瞬时 spawn 异常（runner 资源紧张 EAGAIN/EPERM 类）被降级为「非 git 仓」，fail-open
- 2026-10-05 排除业务误判：同环境后续 Release v1.1.0（run 37262932643）与 CI 34ba1b8（run 37262932728）两轮 `npm test` 全绿——单次未复现，定性 flaky；同根源旁支：:581 直连 spawnSync 的 SHA 存在性判定遇 `r.error`（status=null）会被 `status !== 0` 捕获而误判「证据伪造」（fail-closed 方向误报）
- 2026-10-05 留痕：workflow/papercuts.md 2026-10-05 行（d9096ba 双观察项收口批），含根治方向
- 2026-10-05 用户确认：按 papercuts 2026-10-05 行口径排期立单（L2 根治 incident，对话内明确）
- 2026-10-05 实现期稳定性诊断：首轮 50 轮循环捕获 8 次同型失败（含与本单无关的旧场景）；聚焦取证（12 轮带全 detail）显示失败轮 check-loop 自身 git 调用**全部成功**（无「git 探测异常」出账、exit=0）但证据裁决缺失 → 根因侧修正：flake 直接根因在**测试夹具自身的 git spawn**（gitCommitAll / rev-parse 裸 spawnSync 瞬时 `r.error` → sha 空 → 证据串成纯文本 → 无裁决）；gitOut fail-open 为同暴露的真实引擎缺陷但非该 flake 直接根因（引擎侧加固保留——原 CI flake 与今日复现形态一致，夹具侧假说与引擎侧假说在旧代码无出账时不可区分，本单两侧同修）
- 2026-10-05 夹具侧加固：check-loop.test.mjs 新增 gitRetry（spawn `r.error` 重试一次、持续失败抛错响亮失败）+ shortSha 统一入口，替换 gitInit / gitCommitAll / 全部 6 处裸 rev-parse——「绝不静默产出空 sha / 缺提交的假夹具」
- 2026-10-05 复验：加固后套件 201/0，诊断循环复跑见 plan 验证记录
- 2026-10-05 修复完成：c7b6cf5（实现）+ 4f55c4a（L2 复核 4 项 P2 关单前收口，复核结论放行）；复验套件 201/0（包源）/ 199/0（装副本）/ doctor 13 PASS 0 WARN 0 FAIL / sync.test 56/0 / 稳定性循环 fail-loud 全覆盖后 20 轮 0 失败（加固前基线 8/50）+ P2 收口后 10 轮 0 失败
- 2026-10-05 用户确认：关单（对话内，原话「确认」——incident fixed→closed、spec/plan done 逐件代录）

## 影响面

- 引擎件 check-loop.mjs 全部 git 探测消费点——:161（`--show-toplevel` 根定位）、:555（证据上下文）、:720（检查 8 入口门）、:796（检查 X 入口门）：git 仓内瞬时 spawn 异常 → 静默降级「非 git 仓」→ 对应检查静默失效且 exit 0。装户 CI 门禁与本仓发版链（Release 跑 npm test）同暴露
- 测试平台：check-loop.test.mjs 196 断言跨 CI 六矩阵的稳定性；现有 fixture 全部走 git 成功路径，对探测异常零检测面
- 同根源旁支：:581 直连 spawnSync（绕过 gitOut），`r.error` 被误判「证据伪造」——方向相反（fail-closed 误报）但同属「基础设施异常与业务失败不可区分」

## 根因

- **直接根因（flake 向量，测试平台侧）**：check-loop.test.mjs 夹具 git 调用零防护——gitInit / gitCommitAll / 6 处 rev-parse 全部裸 spawnSync 且失败静默，宿主 / CI runner 资源压力下瞬时 `r.error` → sha 为空或提交缺失 → 证据场景静默拿到「无裁决」的错误结果（exit 0 无 verdict）
- **同暴露真实缺陷（引擎侧，本单主修）**：`gitOut` 三态合并（`r.error` 与 status≠0 与 ok 过滤合并返回 null）→ :720/:796 探测门 null 即静默跳过检查面（fail-open）；:581 直连点 `r.error` 误判「证据伪造」（fail-closed 方向误报）——基础设施异常与业务失败不可区分、零出账
- 深层原因：缺「引擎与测试平台内 spawn 基础设施异常须与业务失败区分并响亮出账」的横切口径——检查 16 装户侧已确立 fail-loud 先例（取数器载入失败响亮出账、不静默），git 探测面与测试夹具面均未纳入同一口径

## 为什么之前没拦住

- 门禁：check-loop 检查 20 只查引擎脚本「有同名套件」，不查异常路径的覆盖面
- 测试：196 场景全部走 git 成功路径；无 GIT 替身 / 必败注入，引擎 spawn 异常路径零检测；**夹具自身 git 调用零防护**（瞬时失败静默产出假 fixture）——防线与真实威胁形态（宿主 / runner 资源抖动）不同构（同 2026-09-25 wf-run-review-fixes「测试环境与真实威胁形态不同构」教训的二度命中）
- 规范：fail-loud 原则散见于检查 16 实现（响亮出账先例），未成文覆盖 git 探测面；无「spawn 基础设施异常不得与业务失败合并」条目

## 复盘三件套（缺一不可）

> fixed 时已回填实际 SHA 与复验证据（2026-10-05）。

1. 结构性修复
   - 修复 commit：c7b6cf5（引擎 spawnGit 统一通道——gitOut 与 :581 证据核验/:628 git show/:633 git log 归口，`r.error` 响亮出账 + 瞬时类单次重试；linesOf fs 读取重试 + 响亮出账；CHECK_LOOP_GIT 注入钩子；场景 5v 两块 5 断言；夹具 gitRetry/shortSha 替换 gitInit/gitCommitAll/6 处裸 rev-parse）+ 4f55c4a（L2 复核 P2 收口：出账时机与 linesOf 对称、夹具 git add 入统一通道、计数订正、断言补注）
   - 影响环境：dev（引擎包源 templates/ + 装副本 .agents/，经 flow-kit sync 双源同步）
   - 是否需要新 intent：
     - 否 → 理由：根因属实现缺陷（错误分类缺失 + 夹具防护缺位），单点修复 + 防复发用例 + 规范条目可覆盖；incident 即 intent 等价物，spec/plan 同名配对承载

2. 防复发验证（必须落到自动化用例或回归清单条目，禁止只写「已人工验证」）
   - 自动化用例：templates/_agents/scripts/check-loop.test.mjs 场景 5v 两块 5 断言——`CHECK_LOOP_GIT` 指向不可执行路径 → stderr 响亮出账（进程级去重恰一条）+ 持续异常 fail-closed（伪造拦）+ 无「证据无关」误报；正常 git 零出账 + 行为不变负例；夹具侧 gitRetry/shortSha 防瞬时失败（随 npm test 回归）
   - 稳定性验证：加固前基线 50 轮 8 失败 → fail-loud 全覆盖后 20 轮 0 失败 + P2 收口后 10 轮 0 失败（同宿主压力环境）；CI 六矩阵随每次推送持续观察
   - 回归清单条目：workflow/regression-checklist.md 防复发验证节 2026-10-05-gitout-fail-open 行（c7b6cf5）

3. 规范条目（必须有可追溯的落点）
   - 落点：templates/_agents/scripts/check-loop.mjs spawnGit / linesOf 区块注释互引（spawn 与 fs 基础设施异常 fail-loud 口径，引检查 16 装户先例）；workflow/regression-checklist.md 防复发验证节追加行
   - 引用：commit c7b6cf5 / 4f55c4a；文件:templates/_agents/scripts/check-loop.mjs spawnGit 区块、workflow/regression-checklist.md 防复发验证节
