import assert from 'node:assert/strict';
import test from 'node:test';
import { ResponsesModelClient, ModelNotConfiguredError, ModelTimeoutError, ModelCancelledError, validateGeneratedLearning } from '../src/model-client.mjs';
import { LearningService } from '../src/learning-service.mjs';

const paragraphs = [{ id: 'p1', text: '闭合一个小任务可以带来完结感。' }, { id: 'p2', text: '行动建议应当由用户自行调整。' }];
const article = { workId: '1', title: '标题', author: '作者', paragraphs, content: paragraphs.map((p) => p.text).join('\n'), sourceUrl: 'https://example.test/1' };

function generated({ feedback = [], quote = paragraphs[0].text } = {}) {
  return {
    summary: [{ text: '先完成一个小任务。', citationIds: ['c1'] }],
    conditions: [{ text: '适合需要明确边界时。', citationIds: ['c1'] }],
    cautions: [],
    feedback,
    citations: [{ id: 'c1', paragraphId: 'p1', quote }],
    action: { task: '选一个小任务并完成它', completion: '记录完成结果', review: '回顾下一步' },
  };
}

test('strict result validation rejects wrong quotes and invalid citation ids', () => {
  assert.throws(() => validateGeneratedLearning(generated({ quote: '正文没有这句话' }), { paragraphs, mode: 'direct' }), /逐字找到/);
  const invalidId = generated();
  invalidId.summary[0].citationIds = ['missing'];
  assert.throws(() => validateGeneratedLearning(invalidId, { paragraphs, mode: 'direct' }), /不存在/);
});

test('direct and reflect feedback rules stay distinct', () => {
  assert.throws(() => validateGeneratedLearning(generated({ feedback: [{ kind: 'accurate', text: '准确', citationIds: ['c1'] }] }), { paragraphs, mode: 'direct' }), /混入/);
  assert.throws(() => validateGeneratedLearning(generated(), { paragraphs, mode: 'reflect' }), /实质反馈/);
  const value = validateGeneratedLearning(generated({ feedback: [{ kind: 'missing', text: '遗漏了条件', citationIds: ['c1'] }] }), { paragraphs, mode: 'reflect' });
  assert.equal(value.feedback[0].kind, 'missing');
});

test('conditions and reflection feedback require verifiable citations', () => {
  const conditionWithoutCitation = generated();
  conditionWithoutCitation.conditions[0].citationIds = [];
  assert.throws(
    () => validateGeneratedLearning(conditionWithoutCitation, { paragraphs, mode: 'direct' }),
    /conditions\[0\].*缺少原文依据/,
  );

  const feedbackWithoutCitation = generated({ feedback: [{ kind: 'accurate', text: '准确', citationIds: [] }] });
  assert.throws(
    () => validateGeneratedLearning(feedbackWithoutCitation, { paragraphs, mode: 'reflect' }),
    /feedback\[0\].*缺少原文依据/,
  );
});

test('learning service requires reflection and preserves generated mode', async () => {
  const contentStore = { detail: async () => article };
  const calls = [];
  const modelClient = { configured: true, generate: async (input) => { calls.push(input); return validateGeneratedLearning(generated({ feedback: input.mode === 'reflect' ? [{ kind: 'accurate', text: '准确', citationIds: ['c1'] }] : [] }), { paragraphs, mode: input.mode }); } };
  const service = new LearningService({ contentStore, modelClient });
  await assert.rejects(service.learn({ workId: '1', mode: 'reflect', reflection: ' ' }), { code: 'REFLECTION_REQUIRED' });
  const direct = await service.learn({ workId: '1', mode: 'direct' });
  assert.equal(direct.mode, 'direct');
  assert.deepEqual(direct.feedback, []);
  const reflect = await service.learn({ workId: '1', mode: 'reflect', reflection: '我会先完成小任务' });
  assert.equal(reflect.mode, 'reflect');
  assert.equal(reflect.feedback.length, 1);
  assert.equal(calls[0].reflection, undefined);
  assert.equal(calls[1].reflection, '我会先完成小任务');
});

test('model client timeout and caller cancellation are distinguishable', async () => {
  const timeoutClient = new ResponsesModelClient({ apiKey: 'test-key', timeoutMs: 10, fetch: async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) });
  await assert.rejects(timeoutClient.generate({ article, mode: 'direct' }), ModelTimeoutError);

  const controller = new AbortController();
  const cancelledClient = new ResponsesModelClient({ apiKey: 'test-key', timeoutMs: 1000, fetch: async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    controller.signal.addEventListener('abort', () => controller.signal.aborted && options.signal.aborted, { once: true });
  }) });
  const pending = cancelledClient.generate({ article, mode: 'direct', signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, ModelCancelledError);
});

test('unconfigured model fails before any network call', async () => {
  const client = new ResponsesModelClient({ apiKey: '', fetch: async () => { throw new Error('must not call'); } });
  await assert.rejects(client.generate({ article, mode: 'direct' }), ModelNotConfiguredError);
});
