---
状态: approved
级别: L1
模块: pipeline
确认指纹: 9ea9f3367f31445b
---
# PLAN — host-gates-p1

对应入口：../incidents/2026-09-27-host-gates-p1.md

## 改动面

- `modules/gates/dotnet-ca/check-architecture.sh`：①豁免清单冒号拆多 `-e`（`set --` + IFS，BRE 无 `|` 交替——P1-B1）；②红线 5 前 `require_target "$CONTROLLERS_DIR"`（fail-closed——P1-B3）；③红线 1 csproj 存在性检查（glob 展开失败不再静默放行——随 B3）
- `modules/hosts/trae/hooks/pre-shell-check.cjs`：强推检测 token 化（`push` + `--force`/`-f`/`+refspec` 任一 token 即拦；`--force-with-lease` 精确 token 不匹配仍放行——P1-B2）；runGate 补 `e.status === 127`「未装」分支（P2-B4 rider，与 ENOENT 分支并存）
- `modules/hosts/trae/hooks/post-edit-check.cjs`：同 127 分支（rider）
- 测试：新增 `src/gate-dotnet-ca.test.mjs`（fixture 临时 git 仓：豁免多值生效 / CONTROLLERS_DIR 缺失 fail-closed / csproj 缺失 fail-closed）+ `src/trae-hooks.test.mjs`（stdin JSON：换序强推拦 / `+main` 拦 / `--force-with-lease` 放行 / 127 未装区分）；`src/run-tests.mjs` nodeSuites 注册两套件

## 验证方式

- 静态门：npm test 全绿（含两新套件）；node --check 两 .cjs；sh -n check-architecture.sh
- 实测：fixture 探针——旧代码豁免失效复现（`grep -v -e "CtrlA|CtrlB"` 行保留）→ 新代码两豁免均生效；`git push origin main --force` 旧代码漏拦 → 新代码 deny
- 回归：doctor 0 FAIL、check-loop advisory 不增
