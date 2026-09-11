import { validateFollowUp, validateGeneratedLearning } from './model-client.mjs';

const RESPONSES = {
  '9000000000000000001': {
    summary: [
      ['把笼统目标改写成能执行、能观察结果的小实验。', 'p1'],
      ['实验结束后根据记录只调整一个变量，再进行下一轮验证。', 'p5'],
    ],
    logic: [
      ['笼统目标缺少开始条件、具体动作和可回看的结果，因此难以指导行动。', 'p1'],
      ['加入动作、时间边界和观察结果后，学习行为就变得可以执行和检查。', 'p2'],
      ['先记录实际发生的事实，能比笼统评价提供更可用的调整依据。', 'p4'],
      ['一次只改一个变量，才能判断究竟是什么产生了效果。', 'p5'],
    ],
    conditions: [['适合目标已经存在，但启动方式含糊或反复调整却不知道原因的学习任务。', 'p3']],
    cautions: ['小实验能帮助诊断行动问题，但不能证明某种学习方法适合所有人；结果仍需多次观察。'],
    examples: [
      ['准备一场范围很大的考试，不知道今晚从哪里开始。', '把今晚改成二十分钟实验：整理三个概念，并记录一个仍说不清的问题。'],
      ['换了很多学习方法，无法判断哪一个有效。', '下一轮只改变一个条件，例如学习地点，其他条件保持不变。'],
    ],
    questions: ['我现在的目标缺少动作、时间还是结果？', '怎样记录才算得到可用证据？', '下一轮只改哪个变量最值得？'],
    action: ['选一个模糊的学习目标，把它改写成二十分钟内能完成的小实验。', '写清动作、结束时间，并留下一个可查看的结果。', '结束后记录事实，只选择一个变量用于下次调整。'],
    reflection: {
      concepts: [
        [/(?:写清|包含|改成|加入).{0,8}(?:具体)?动作|动作.{0,6}(?:具体|明确)/, '具体动作', 'p2'],
        [/(?:写清|包含|加入).{0,8}(?:时间|分钟|开始)|时间.{0,6}(?:边界|明确)/, '时间边界', 'p2'],
        [/(?:观察|留下|检查).{0,8}结果|结果.{0,6}(?:观察|验证|检查)/, '观察结果', 'p2'],
        [/(?:先|需要|应该|应当).{0,6}记录.{0,6}(?:事实|发生)|记录.{0,6}(?:事实|实际发生)/, '记录事实', 'p4'],
        [/(?:只|一次).{0,5}(?:改|调整).{0,4}(?:一个|单个)变量|变量.{0,6}(?:只改一个|单独调整)/, '单变量调整', 'p5'],
      ],
      contradiction: /(?:不(?:用|要|必|需|应该|应当)|无需|跳过|省略).{0,8}(?:具体|记录|观察|验证|时间|结果)|目标.{0,4}(?:越)?模糊|一次.{0,5}(?:改|调整).{0,5}(?:多个|所有)|(?:直接|足以).{0,6}证明.{0,8}(?:适合所有|一定有效)|(?:一定|必然|肯定).{0,6}(?:有效|成功)/,
      anchor: 'p2',
    },
    followUp: {
      challenge: ['材料没有声称这种方法适用于所有任务；它只把小实验定位为尽快获得证据的工具，并明确拆小不等于降低要求。材料之外的前提仍需另行判断。', 'p3'],
      rules: [
        [/事实|记录|证据/, '材料建议实验结束后先记录实际发生的事实，再解释原因。可以据此写下完成数量、卡住位置等可观察结果。', 'p4'],
        [/变量|下一步|调整/, '材料建议下一步只改一个变量，避免同时改动过多而无法判断效果来自哪里。', 'p5'],
        [/动作|时间|结果|目标/, '材料把可验证的小实验拆成具体动作、时间边界和观察结果；可以逐项检查当前目标缺少哪一部分。', 'p2'],
      ],
      fallback: ['当前材料不能直接回答这个问题；它提供的可核对起点是把目标写成具体动作、时间边界和观察结果，再用一次行动收集证据。', 'p2'],
    },
  },
  '9000000000000000002': {
    summary: [
      ['复盘时先分开可观察事实、可能解释和下一步行动。', 'p1'],
      ['下一步应针对一个解释做可验证的改动。', 'p4'],
    ],
    logic: [
      ['把事实和评价混在一起，会过早把一次结果变成对自己的结论。', 'p1'],
      ['先记录时间、数量和卡住的位置，才能获得可核对的材料。', 'p2'],
      ['保留多个解释，再用下一次行动检验其中一个解释，能减少武断归因。', 'p3'],
    ],
    conditions: [['适合已经发生了具体学习行为，并且能回忆基本时间、数量或中断点的复盘。', 'p2']],
    cautions: ['可观察记录仍可能不完整；一次实验只能提供线索，不能直接证明唯一原因。'],
    examples: [
      ['原计划做二十道题，最后只做了十二道。', '先记录卡住的题型和时长，再提出“前置知识不足”等候选解释。'],
      ['学习开始时间比计划晚四十分钟。', '下一次只改变一个可能因素，例如把手机放到另一个房间。'],
    ],
    questions: ['这句话里哪些是事实，哪些是评价？', '还有哪些解释同样符合已有事实？', '下一步怎样只检验一个解释？'],
    action: ['选一次最近的学习经历，分别写一条事实、一条候选解释和一个下一步。', '事实包含至少一个可观察的时间、数量或行为。', '下一次结束后检查这个解释是否得到更多支持。'],
    reflection: {
      concepts: [
        [/(?:先|需要|应该|应当|尽量).{0,8}(?:记录|区分).{0,8}(?:可观察)?事实|(?:事实|记录).{0,8}(?:可观察|时间|数量|行为)/, '可观察事实', 'p2'],
        [/(?:保留|列出|考虑|提出).{0,8}(?:多个|候选).{0,6}(?:解释|原因)|(?:解释|原因).{0,8}(?:多个|候选)/, '候选解释', 'p3'],
        [/(?:下一步|行动).{0,8}(?:检验|验证|改变|改动)|(?:检验|验证).{0,8}(?:解释|原因)/, '可验证的下一步', 'p4'],
      ],
      contradiction: /(?:不(?:用|要|必|需|应该|应当)|无需|跳过|省略).{0,8}(?:记录|事实|区分|验证|检验)|(?:应该|应当|可以|要)?(?:立刻|直接|马上).{0,6}(?:评价|下结论|证明|说明)|(?:唯一|只有一个|必然|肯定|一定).{0,8}(?:原因|解释|结论)|(?:原因|解释).{0,8}(?:唯一|只有一个|必然|肯定|一定)/,
      anchor: 'p1',
    },
    followUp: {
      challenge: ['材料没有用一次复盘证明某个唯一原因；它建议保留多个候选解释，再让下一步行动检验其中一个解释。', 'p3'],
      rules: [
        [/事实|记录|评价/, '材料把可观察的时间、数量和行为当作事实记录；对自己的评价应先与这些记录分开。', 'p2'],
        [/解释|原因|候选/, '材料建议保留多个候选解释，不要立刻选择最责备自己的答案。', 'p3'],
        [/下一步|行动|验证|检验/, '材料建议让下一步对应一个可验证的解释，并且一次只改变一个可能因素。', 'p4'],
      ],
      fallback: ['当前材料不能直接回答这个问题；它提供的可核对起点是先区分事实与解释，再用下一步行动检验一个候选解释。', 'p1'],
    },
  },
};

export class DemoModelClient {
  get configured() { return true; }
  get runtimeMode() { return 'demo'; }

  async generate({ article, mode, reflection }) {
    const template = RESPONSES[article?.workId];
    if (!template) throw new Error('开发演示模型没有这篇材料的预设结果。');
    const citations = [];
    const citationByParagraph = new Map();
    const cited = (items) => items.map(([text, paragraphId]) => {
      let citationId = citationByParagraph.get(paragraphId);
      if (!citationId) {
        const paragraph = article.paragraphs.find((item) => item.id === paragraphId);
        if (!paragraph) throw new Error(`开发演示材料缺少段落 ${paragraphId}。`);
        citationId = `c${citations.length + 1}`;
        citationByParagraph.set(paragraphId, citationId);
        citations.push({ id: citationId, paragraphId, quote: excerpt(paragraph.text) });
      }
      return { text, citationIds: [citationId] };
    });
    const feedback = mode === 'reflect'
      ? buildReflectionFeedback(template, String(reflection), cited)
      : [];
    return validateGeneratedLearning({
      summary: cited(template.summary),
      logic: cited(template.logic),
      conditions: cited(template.conditions),
      cautions: template.cautions.map((text) => ({ text, citationIds: [] })),
      examples: template.examples.map(([situation, application]) => ({ situation, application })),
      questions: [...template.questions],
      feedback,
      citations,
      action: { task: template.action[0], completion: template.action[1], review: template.action[2] },
    }, { paragraphs: article.paragraphs, mode });
  }

  async followUp({ article, question }) {
    const template = RESPONSES[article?.workId];
    if (!template) throw new Error('开发演示模型没有这篇材料的预设结果。');
    const normalized = String(question).trim();
    const challenge = /不成立|不适用|一定|所有|唯一|证明/.test(normalized);
    const [answer, paragraphId] = challenge
      ? template.followUp.challenge
      : template.followUp.rules.find(([pattern]) => pattern.test(normalized))?.slice(1) || template.followUp.fallback;
    const paragraph = article.paragraphs.find((item) => item.id === paragraphId);
    if (!paragraph) throw new Error(`开发演示材料缺少段落 ${paragraphId}。`);
    return validateFollowUp({
      statements: [{ text: answer, citationIds: ['f1'] }],
      citations: [{ id: 'f1', paragraphId: paragraph.id, quote: excerpt(paragraph.text) }],
    }, { paragraphs: article.paragraphs });
  }
}

function buildReflectionFeedback(template, reflection, cited) {
  const config = template.reflection;
  // Keep the deterministic demo conservative: any negation can reverse a nearby keyword.
  if (/[不没未无别勿]|不能|不可|无需|跳过|省略/.test(reflection) || config.contradiction.test(reflection)) {
    const reference = cited([['这处复述含有与材料主张方向相反或需要进一步辨别的表述；请先回到原文区分材料说了什么，再保留自己的质疑。', config.anchor]])[0];
    return [{ kind: 'uncertain', text: reference.text, citationIds: reference.citationIds }];
  }
  const matches = config.concepts.filter(([pattern]) => pattern.test(reflection));
  if (matches.length >= 2) {
    const labels = [...new Set(matches.map(([, label]) => label))];
    const references = cited(matches.map(([, , paragraphId]) => ['', paragraphId]));
    return [{
      kind: 'accurate',
      text: `你的复述抓住了“${labels.join('、')}”这些材料要点，可以继续说明它们之间的关系。`,
      citationIds: [...new Set(references.flatMap((item) => item.citationIds))],
    }];
  }
  if (matches.length === 1) {
    const [, label, paragraphId] = matches[0];
    const reference = cited([['', paragraphId]])[0];
    return [{
      kind: 'missing',
      text: `你提到了“${label}”，还可以补上材料中的其他关键步骤和它们之间的关系。`,
      citationIds: reference.citationIds,
    }];
  }
  const reference = cited([['', config.anchor]])[0];
  return [{
    kind: 'uncertain',
    text: '这段复述暂时没有出现材料的关键区分，建议对照原文补充后再判断。',
    citationIds: reference.citationIds,
  }];
}

function excerpt(text) {
  return text.slice(0, Math.min(72, text.length));
}
