// 示例 workflow——并行实现两个域 → 汇聚过测试 → 独立评审（链式收尾）。
// 这是格式示例：任务/授权文件/门禁请按实际 plan 改写；确认前只可 --dry-run。
export default {
  name: '示例-并行实现评审',
  description: '两域并行实现 → 汇聚过测试门 → 独立评审（示例，按 plan 改写后使用）',
  provider: 'zcode',
  concurrency: 2,
  async run(wf) {
    const [be, fe] = await wf.parallel([
      () => wf.agent('implementer', '实现后端改动（示例占位，按 plan 任务改写）', {
        files: ['src/api/**'],
        accept: '项目测试命令通过',
        context: ['workflow/plans/对应-plan.md'],
      }),
      () => wf.agent('implementer', '实现前端改动（示例占位，按 plan 任务改写）', {
        files: ['web/**'],
        accept: '项目构建命令通过',
      }),
    ]);
    if (!be.ok || !fe.ok) {
      wf.log(`实现阶段有失败（be=${be.ok} fe=${fe.ok}），跳过后续门禁与评审`);
      return { be, fe, review: 'skipped' };
    }
    wf.gate('npm test');
    const review = await wf.agent('independent-reviewer', '独立评审两域改动是否符合 plan 与验收判据', {
      context: ['workflow/plans/对应-plan.md'],
    });
    return { be: be.ok, fe: fe.ok, review: review.ok };
  },
};
