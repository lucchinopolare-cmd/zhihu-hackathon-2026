const DEMO_ARTICLES = [
  {
    work_id: '9000000000000000001',
    title: '把学习目标变成可验证的小实验',
    description: '用一个有时间边界、能观察结果的小实验，替代笼统的“我要更努力”。',
    chapter_name: '把学习目标变成可验证的小实验',
    author_name: '知行小课项目组（开发演示）',
    introduction: '项目原创开发材料，不是知乎赛事正式内容。',
    content: [
      '学习计划常常不是败在目标太小，而是败在目标无法验证。“我要认真学习”听起来正确，却没有告诉我们何时开始、做什么，也没有留下可以回看的结果。',
      '一个可验证的小实验至少包含三个部分：具体动作、时间边界和观察结果。比如“今晚八点，用二十分钟整理这一章的三个核心概念，并写下仍然说不清的问题”。',
      '把任务拆小不等于不断降低要求。小实验的作用是尽快获得证据：这个方法是否帮助理解，当前阻力来自知识缺口、环境干扰，还是任务本身定义不清。',
      '实验结束后，先记录实际发生了什么，再解释原因。完成了两项、第三项卡住，比一句“我今天状态不好”更能帮助下一次调整。',
      '下一步只改一个变量：缩短时间、换一个环境，或先补一个前置概念。一次改动过多，就很难知道究竟是什么产生了效果。',
    ].join('\n'),
  },
  {
    work_id: '9000000000000000002',
    title: '复盘时，先区分事实、解释和下一步',
    description: '把复盘写成可核对的记录，避免用一次结果给自己下结论。',
    chapter_name: '复盘时，先区分事实、解释和下一步',
    author_name: '知行小课项目组（开发演示）',
    introduction: '项目原创开发材料，不是知乎赛事正式内容。',
    content: [
      '很多复盘把事实和评价写在同一句话里，例如“我又拖延了，所以我没有自制力”。前半句还需要具体记录，后半句已经是对自己的解释。',
      '事实应当尽量能被观察：原计划九点开始，实际九点四十开始；二十道题完成了十二道；在第三类题型上连续停留了十五分钟。',
      '解释可以有多个候选，而不是立刻选一个最责备自己的答案。开始晚可能来自估时错误、前一项任务超时、环境打断，也可能确实是回避困难。',
      '下一步应当对应一个可以验证的解释。如果怀疑前置知识不足，就先做五道基础题；如果怀疑手机干扰，就只改变学习时手机的位置。',
      '复盘的价值不是证明过去做得好或不好，而是让下一次行动比这一次多一个可检验的改动。',
    ].join('\n'),
  },
];

const byId = new Map(DEMO_ARTICLES.map((article) => [article.work_id, deepFreeze({ ...article })]));

export const DEMO_KNOWLEDGE_LIST = Object.freeze(DEMO_ARTICLES.map(({ work_id, title, description }) => Object.freeze({
  work_id,
  title,
  description,
})));

export function getDemoKnowledgeDetail(workId) {
  return byId.get(workId);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
