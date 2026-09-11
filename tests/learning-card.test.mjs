import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLearningCard, buildLearningCardDocx, downloadLearningCard } from '../public/learning-card.js';

const article = { workId: 'w-1', title: '标题 / <危险>', author: '作者', sourceUrl: 'https://example.com/a' };
const result = {
  workId: 'w-1', mode: 'direct', generatedAt: '2026-09-11T10:00:00+08:00',
  source: { workId: 'w-1', title: article.title, author: article.author, url: article.sourceUrl, completeness: 'unknown' },
  summary: [{ text: '观点 *重点* <tag>', citationIds: ['c1'] }],
  logic: [
    { text: '先观察问题', citationIds: ['c1'] },
    { text: '再形成行动', citationIds: ['c1'] },
  ],
  conditions: [{ text: '条件', citationIds: ['c1'] }], cautions: [], feedback: [],
  examples: [{ situation: '遇到难题', application: '先做最小一步' }],
  questions: ['哪里可能不成立？', '怎样用到我的情况？'],
  citations: [{ id: 'c1', paragraphId: 'p-2', quote: '原文 [片段] <安全>' }],
  action: { task: '试做一步', completion: '看到结果', review: '明天回顾' },
};

test('direct export attributes AI output and does not invent user reflection', () => {
  const card = buildLearningCard({ article, result });
  assert.match(card, /AI 直接讲解/);
  assert.match(card, /AI 行动建议/);
  assert.match(card, /作者的论证步骤/);
  assert.match(card, /AI 构造的具体场景/);
  assert.match(card, /AI 建议的继续追问/);
  assert.doesNotMatch(card, /我的行动/);
  assert.doesNotMatch(card, /用户原始复述/);
  assert.match(card, /生成时间：2026-09-11/);
});

test('reflect export preserves original and optional unverified revision', () => {
  const reflect = { ...result, mode: 'reflect' };
  const card = buildLearningCard({ article, result: reflect, reflection: '我的原始复述', revision: '我后来改的说法' });
  assert.match(card, /用户原始复述/);
  assert.match(card, /我的原始复述/);
  assert.match(card, /用户未重新核对的修订/);
  assert.doesNotMatch(card, /AI 反馈/);
});

test('edited action has explicit user label and remains pending', () => {
  const card = buildLearningCard({ article, result, task: '我的新行动', completion: '我检查完成' });
  assert.match(card, /AI 行动建议/);
  assert.match(card, /用户编辑的行动建议（待尝试）/);
  assert.match(card, /我的新行动/);
});

test('export preserves cited follow-up turns and rejects a mixed article', () => {
  const followUps = [{
    workId: article.workId,
    question: '这在什么情况下成立？',
    statements: [{ text: '先确认当前条件。', citationIds: ['f1'] }],
    citations: [{ id: 'f1', paragraphId: 'p-3', quote: '追问所用原文' }],
  }];
  const card = buildLearningCard({ article, result, followUps });
  assert.match(card, /继续追问记录/);
  assert.match(card, /这在什么情况下成立/);
  assert.match(card, /追问所用原文/);
  assert.throws(() => buildLearningCard({ article, result, followUps: [{ ...followUps[0], workId: 'other' }] }), /workId/);
});

test('escapes text, validates citations, and rejects mixed articles', () => {
  const card = buildLearningCard({ article, result });
  assert.match(card, /&lt;危险&gt;/);
  assert.ok(card.includes('原文 \\[片段\\]'));
  assert.throws(() => buildLearningCard({ article: { ...article, workId: 'other' }, result }), /workId/);
  assert.throws(() => buildLearningCard({ article, result: { ...result, summary: [{ text: 'bad', citationIds: ['missing'] }] } }), /引用不存在/);
});

test('bad source URL is plain text and filename is Windows safe', () => {
  const bad = buildLearningCard({ article: { ...article, sourceUrl: 'javascript:alert(1)' }, result: { ...result, source: { ...result.source, url: 'javascript:alert(1)' } } });
  assert.match(bad, /javascript/);
  assert.doesNotMatch(bad, /<javascript:/i);
  assert.match(downloadLearningCard({ article, result }), /^知行小课-标题 危险\.docx$/);
});

test('Word export is a styled Office document with the same source attribution', () => {
  const docx = buildLearningCardDocx({ article, result });
  assert.ok(docx instanceof Uint8Array);
  assert.deepEqual([...docx.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const xmlText = new TextDecoder().decode(docx);
  assert.match(xmlText, /word\/document\.xml/);
  assert.match(xmlText, /word\/styles\.xml/);
  assert.match(xmlText, /AI 直接讲解/);
  assert.match(xmlText, /作者的论证步骤/);
  assert.match(xmlText, /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
});

test('Word export preserves demo attribution and reflection feedback labels', () => {
  const reflected = { ...result, mode: 'reflect', generationMode: 'demo',
    source: { ...result.source, contentMode: 'demo' },
    feedback: [{ kind: 'missing', text: '还可以补充适用条件。', citationIds: ['c1'] }] };
  const output = new TextDecoder().decode(buildLearningCardDocx({ article, result: reflected, reflection: '我的理解' }));
  assert.match(output, /开发演示预设回答（不代表赛事模型已接通）/);
  assert.match(output, /【可以补充】还可以补充适用条件。/);
});