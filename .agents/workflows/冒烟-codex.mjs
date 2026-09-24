// 冒烟校准件——最小 workflow：单 agent（codex，只读侦察）+ 单 gate，验证 provider 链路与留痕落账。
// 跑法：node .agents/scripts/wf-run.mjs .agents/workflows/冒烟-codex.mjs
export default {
  name: '冒烟-codex',
  description: '最小 workflow：验证 provider 无头会话、门禁与 delegations 留痕链路',
  provider: 'codex',
  concurrency: 1,
  async run(wf) {
    const r = await wf.agent('implementer', '只读侦察：读取仓库根 package.json，报告 name 字段值与 bin.flow-kit 指向的文件路径。不要修改任何文件。', {
      accept: '输出同时包含 agentic-flow-kit 与 bin/flow-kit.mjs',
    });
    wf.gate('node --eval "console.log(41+1)"');
    return { agent: r.ok, blocker: r.blocker };
  },
};
