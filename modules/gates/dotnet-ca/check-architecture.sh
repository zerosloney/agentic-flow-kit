#!/bin/sh
# check-architecture（agentic-flow-kit · dotnet-ca 门禁模块）：Clean Architecture 红线参考实现
# 红线：Application 禁引用 Infrastructure / 禁 DbContext / EF 模型层解耦（无关系映射/无导航/无 Include）/ 异常详情不透传
# 违例输出到 stderr 并 exit 1；干净无输出 exit 0
#
# 接线（项目一次性）：把本文件复制/引用到 .agents/hooks/ 下并在 .agents/hooks/local-pre-commit 里执行——
#   mkdir -p .agents/hooks && cp <包内路径>/check-architecture.sh .agents/hooks/
#   echo 'sh .agents/hooks/check-architecture.sh' >> .agents/hooks/local-pre-commit
cd "$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "check-architecture: 不在 git 仓库内,门禁 fail-closed,不静默放行" >&2; exit 1; }

# ---- CONFIG：按项目改成你的目录/类型名（其余为通用逻辑，升级只动 CONFIG） ----
APP_DIR="backend/src/YourApp.Application"
API_DIR="backend/src/YourApp.API"
DBCTX_FILE="backend/src/YourApp.Infrastructure/Data/AppDbContext.cs"
DOMAIN_ENTITIES_DIR="backend/src/YourApp.Domain/Entities"
CONTROLLERS_DIR="backend/src/YourApp.API/Controllers"
DBCTX_CLASS="AppDbContext"
INFRA_USING="using YourCompany.YourApp.Infrastructure"
EXEMPT_CTRL="ExemptedController"      # 冒号分隔的豁免 Controller 名（原生 LINQ 等历史豁免）
SHARED_TYPES="Staff,Company"          # 跨模块共享实体名（红线 4.3 白名单）
# -------------------------------------------------------------------------

# 门禁目标存在性：目标缺失时 fail-closed（不静默放行）
require_target() {
  [ -d "$1" ] || [ -f "$1" ] || { echo "check-architecture: 门禁目标缺失（$1）——fail-closed,不静默放行" >&2; exit 1; }
}
require_target "$APP_DIR"
require_target "$API_DIR"
violations=""
exempt_grep=$(printf '%s' "$EXEMPT_CTRL" | tr ':' '|')

# 红线 1：Application csproj 不得引用 Infrastructure 项目
if grep -q "Infrastructure" "$APP_DIR"/*.csproj 2>/dev/null; then
  violations="$violations
- csproj 引用了 Infrastructure 项目（Application 只允许依赖 Domain 与共享层）"
fi

# 红线 2：Application 代码不得出现 DbContext / Infrastructure 命名空间
hits=$(grep -rn -e "$DBCTX_CLASS" -e "$INFRA_USING" "$APP_DIR" --include="*.cs" 2>/dev/null | grep -v -e "/obj/" -e "/bin/")
if [ -n "$hits" ]; then
  violations="$violations
- Application 代码出现 DbContext / Infrastructure 引用：
$hits"
fi

# 红线 3：API 层 Controller 禁直接注入 DbContext（豁免清单内的 Controller 除外）
api_hits=$(grep -rn "$DBCTX_CLASS" "$API_DIR" --include="*.cs" 2>/dev/null | grep -v -e "/obj/" -e "/bin/" -e "$exempt_grep")
if [ -n "$api_hits" ]; then
  violations="$violations
- API 层出现 DbContext 直接引用（应走仓储/服务接口，豁免仅 $EXEMPT_CTRL）：
$api_hits"
fi

# 红线 4.1：DbContext 禁关系映射配置（模型层解耦，关联一律显式 JOIN/分步查询）
require_target "$DBCTX_FILE"
rel_hits=$(grep -nE "HasOne|HasMany|WithOne|WithMany|HasForeignKey|OnDelete" "$DBCTX_FILE" 2>/dev/null)
if [ -n "$rel_hits" ]; then
  violations="$violations
- $DBCTX_CLASS 出现关系映射（模型层已解耦）：
$rel_hits"
fi

# 红线 4.2：Application / API 禁代码级 .Include(（注释里的「原 Include(...)」无前导点，不误报）
inc_hits=$(grep -rnE "\.Include\(" "$APP_DIR" "$API_DIR" --include="*.cs" 2>/dev/null | grep -v -e "/obj/" -e "/bin/")
if [ -n "$inc_hits" ]; then
  violations="$violations
- Application/API 出现 EF Include（导航已移除，明细/参照数据经仓储分步查询或显式 JOIN）：
$inc_hits"
fi

# 红线 4.3：Domain 实体禁导航属性（按实体类名交叉扫描；枚举/标量属性不误伤）
require_target "$DOMAIN_ENTITIES_DIR"
PY_BIN=""
for c in python python3 py; do
    if command -v "$c" >/dev/null 2>&1; then PY_BIN="$c"; break; fi
done
if [ -z "$PY_BIN" ]; then
  violations="$violations
- 红线 4.3 无法执行：未找到 python/python3/py（Domain 导航属性扫描依赖 Python；门禁 fail-closed，不静默放行）"
else
    nav_hits=$(DOMAIN_ENTITIES_DIR="$DOMAIN_ENTITIES_DIR" SHARED_TYPES="$SHARED_TYPES" "$PY_BIN" - <<'PYEOF'
import re, glob, os
from os import environ
d = environ['DOMAIN_ENTITIES_DIR']
shared = {s.strip() for s in environ.get('SHARED_TYPES', '').split(',') if s.strip()}
files = glob.glob(d + '/**/*.cs', recursive=True)
names = set()
for f in files:
    with open(f, encoding='utf-8-sig') as fh:
        names |= set(re.findall(r'public\s+(?:sealed\s+|abstract\s+|partial\s+)*(?:class|record)\s+(\w+)', fh.read()))
hits = []
for f in files:
    with open(f, encoding='utf-8-sig') as fh:
        for i, line in enumerate(fh, 1):
            m = re.match(r'\s*public\s+(?:virtual\s+)?([\w<>,\s\.\?]+?)\s+(\w+)\s*\{', line)
            if not m:
                continue
            typ = m.group(1).strip()
            mm = re.search(r'(?:ICollection|List|IEnumerable|IReadOnlyCollection|IReadOnlyList)<\s*(\w+)\s*>', typ)
            core = mm.group(1) if mm else (typ.rstrip('?') if re.fullmatch(r'\w+\??', typ) else None)
            if core and (core in names or core in shared):
                hits.append(f"{os.path.basename(f)}:{i} {m.group(2)} : {typ}")
if hits:
    print('\n'.join(hits))
PYEOF
    )
fi
if [ -n "$nav_hits" ]; then
  violations="$violations
- Domain 实体出现导航属性（模型层已解耦，关联只保留外键标量列）：
$nav_hits"
fi

# 红线 5：Controller 禁把 InnerException 原文透传进响应体（详情只许进日志）
inner_hits=$(grep -rn "InnerException" "$CONTROLLERS_DIR" --include="*.cs" 2>/dev/null \
  | grep -v -e "/obj/" -e "/bin/" \
  | grep -vE "Log(Warning|Error|Information|Debug|Trace)")
if [ -n "$inner_hits" ]; then
  violations="$violations
- Controller 出现 InnerException 透传进响应（数据库异常统一翻译；详情只许进日志）：
$inner_hits"
fi

if [ -n "$violations" ]; then
  printf '架构红线违例（dotnet-ca 门禁）：\n%s\n' "$violations" >&2
  exit 1
fi
exit 0
