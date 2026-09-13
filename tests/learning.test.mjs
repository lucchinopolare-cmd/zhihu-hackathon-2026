import assert from 'node:assert/strict';
import test from 'node:test';
import { ResponsesModelClient, ModelClientError, ModelNotConfiguredError, ModelTimeoutError, ModelCancelledError, validateFollowUp, validateGeneratedLearning, validateChallengeCheck } from '../src/model-client.mjs';
import { LearningService } from '../src/learning-service.mjs';

const paragraphs = [{ id: 'p1', text: '闭合一个小任务可以带来完结感。' }, { id: 'p2', text: '行动建议应当由用户自行调整。' }];
const article = { workId: '1', title: '标题', author: '作者', paragraphs, content: paragraphs.map((p) => p.text).join('\n'), sourceUrl: 'https://example.test/1' };

function generated({ feedback = [], quote = paragraphs[0].text } = {}) {
  return {
    summary: [{ text: '先完成一个小任务。', citationIds: ['c1'] }],
    logic: [
      { text: '小任务的结束会带来可感知的完结感。', citationIds: ['c1'] },
      { text: '这种完结感可以成为继续行动的起点。', citationIds: ['c1'] },
    ],
    conditions: [{ text: '适合需要明确边界时。', citationIds: ['c1'] }],
    cautions: [{ text: '这只是当前片段支持的解释，仍需结合个人情况判断。', citationIds: [] }],
    examples: [{ situation: '面对一个迟迟没开始的任务。', application: '先把它拆成十分钟内能结束的一步。' }],
    questions: ['这条建议在什么情况下可能不适用？', '我怎样判断这一步已经完成？'],
    challenge: { question: '为什么要先完成一个小任务？', citationIds: ['c1'] },
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

test('follow-up validation requires a verbatim citation from the current article', () => {
  const value = validateFollowUp({
    statements: [{ text: '原文把小任务的完结感当作行动起点。', citationIds: ['f1'] }],
    citations: [{ id: 'f1', paragraphId: 'p1', quote: '闭合一个小任务可以带来完结感' }],
  }, { paragraphs });
  assert.equal(value.statements[0].text, '原文把小任务的完结感当作行动起点。');
  assert.throws(() => validateFollowUp({
    statements: [{ text: '没有依据的回答。', citationIds: ['f1'] }],
    citations: [{ id: 'f1', paragraphId: 'p1', quote: '原文不存在的句子' }],
  }, { paragraphs }), /逐字找到/);
  assert.throws(() => validateFollowUp({
    statements: [{ text: '没有绑定依据的回答。', citationIds: [] }],
    citations: [{ id: 'f1', paragraphId: 'p1', quote: paragraphs[0].text }],
  }, { paragraphs }), /缺少原文依据/);
  assert.throws(() => validateFollowUp({
    statements: [{ text: '引用编号不存在。', citationIds: ['missing'] }],
    citations: [{ id: 'f1', paragraphId: 'p1', quote: paragraphs[0].text }],
  }, { paragraphs }), /不存在/);
});

test('learning service trims follow-up questions and preserves demo attribution', async () => {
  const contentStore = { detail: async () => article };
  const modelClient = {
    configured: true,
    runtimeMode: 'demo',
    generate: async () => generated(),
    followUp: async ({ question }) => ({
      statements: [{ text: `回答：${question}`, citationIds: ['f1'] }],
      citations: [{ id: 'f1', paragraphId: 'p1', quote: paragraphs[0].text }],
    }),
  };
  const service = new LearningService({ contentStore, modelClient });
  await assert.rejects(service.followUp({ workId: '1', question: '   ' }), { code: 'QUESTION_REQUIRED' });
  const result = await service.followUp({ workId: '1', question: '  为什么？  ' });
  assert.equal(result.question, '为什么？');
  assert.equal(result.generationMode, 'demo');
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

test('classifies provider 403 quota errors without exposing upstream details', async (t) => {
  const cases = [
    {
      name: 'insufficient_quota',
      body: { error: { type: 'insufficient_quota', code: 'insufficient_quota', message: 'Quota exhausted for this account.' } },
      expected: 'MODEL_RATE_LIMITED',
    },
    {
      name: 'invalid_api_key',
      body: { error: { type: 'invalid_request_error', code: 'invalid_api_key', message: 'The API key is invalid.' } },
      expected: 'MODEL_AUTH_ERROR',
    },
  ];
  for (const { name, body, expected } of cases) {
    await t.test(name, async () => {
      const client = new ResponsesModelClient({
        apiKey: 'test-secret-key',
        fetch: async () => new Response(JSON.stringify(body), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      });
      await assert.rejects(
        client.generate({ article, mode: 'direct' }),
        (error) => {
          assert.ok(error instanceof ModelClientError);
          assert.equal(error.code, expected);
          assert.equal(error.status, 503);
          assert.equal(error.message.includes('test-secret-key'), false);
          assert.equal(error.message.includes(body.error.message), false);
          return true;
        },
      );
    });
  }
});

test('falls back to authentication for empty or non-JSON provider 403 responses', async (t) => {
  for (const [name, response] of [
    ['empty', new Response('', { status: 403 })],
    ['non-JSON', new Response('forbidden', { status: 403, headers: { 'content-type': 'text/plain' } })],
  ]) {
    await t.test(name, async () => {
      const client = new ResponsesModelClient({
        apiKey: 'test-secret-key',
        fetch: async () => response,
      });
      await assert.rejects(client.generate({ article, mode: 'direct' }), (error) => {
        assert.equal(error.code, 'MODEL_AUTH_ERROR');
        assert.equal(error.status, 503);
        return true;
      });
    });
  }
});

test('keeps HTTP 429 mapped to the existing rate-limit error', async () => {
  const client = new ResponsesModelClient({
    apiKey: 'test-secret-key',
    fetch: async () => new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    }),
  });
  await assert.rejects(client.generate({ article, mode: 'direct' }), (error) => {
    assert.equal(error.code, 'MODEL_RATE_LIMITED');
    assert.equal(error.status, 503);
    return true;
  });
});

test('challenge validation requires cited feedback and only adds a variant when revisiting', () => {
  const ready = validateChallengeCheck({
    status: 'ready', feedback: [{ text: '覆盖关键点', citationIds: ['c1'] }],
    citations: [{ id: 'c1', paragraphId: 'p1', quote: paragraphs[0].text }], variantQuestion: '',
  }, { paragraphs });
  assert.equal(ready.status, 'ready');
  assert.throws(() => validateChallengeCheck({ ...ready, status: 'ready', variantQuestion: '再答一次' }, { paragraphs }), /不应追加/);
  assert.throws(() => validateChallengeCheck({ ...ready, status: 'revisit', variantQuestion: '' }, { paragraphs }), /必须提供/);
});

test('learning challenge questions have a bounded length', () => {
  const longQuestion = {
    ...generated(),
    challenge: { question: '问'.repeat(501), citationIds: ['c1'] },
  };
  assert.throws(() => validateGeneratedLearning(longQuestion, { paragraphs, mode: 'direct' }), /challenge\.question.*过长/);
});
