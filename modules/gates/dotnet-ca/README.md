# dotnet-ca — Clean Architecture 门禁模块（可选）

Clean Architecture（Application/Domain/Infrastructure/API 分层）红线守卫参考实现，抽自真实项目实战门禁。五条红线：Application 禁引 Infrastructure/DbContext、API Controller 禁直注 DbContext、EF 模型层解耦（无关系映射/无导航属性/无 Include）、InnerException 禁透传响应。

## 接线（一次性，装进项目本地）

已装 agentic-flow-kit 的项目直接：

```sh
npx agentic-flow-kit add-gate dotnet-ca
```

（装 .agents/hooks/check-architecture.sh + 自动接线 local-pre-commit；装后归项目所有，sync 不覆盖。）

手动装法等价于：

```sh
mkdir -p .agents/hooks
cp <包内 modules/gates/dotnet-ca/check-architecture.sh> .agents/hooks/
# .agents/hooks/local-pre-commit（pre-commit 的项目门禁挂载点，没有则新建）：
echo 'sh .agents/hooks/check-architecture.sh' >> .agents/hooks/local-pre-commit
```

然后改脚本头部 `CONFIG` 块的目录/类型名。红线不适用（如不用 EF）的条目自行删除——本模块是参考实现，装进项目后归项目所有。
