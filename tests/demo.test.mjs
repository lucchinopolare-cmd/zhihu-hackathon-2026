import assert from 'node:assert/strict';
import test from 'node:test';
import { ContentStore } from '../src/content-store.mjs';
import { DemoModelClient } from '../src/demo-model-client.mjs';
import { LearningService } from '../src/learning-service.mjs';

test('bundled demo content is original, self-contained and never calls the live client', async () => {
  const client = {
    list: async () => { throw new Error('demo must not call live list'); },
    detail: async () => { throw new Error('demo must not call live detail'); },
  };
  const store = new ContentStore({ mode: 'demo', client });
  const list = await store.list();
  assert.equal(list.length, 2);
  assert.match(list[0].title, /学习目标/);
  const article = await store.detail(list[0].work_id);
  assert.equal(article.contentMode, 'demo');
  assert.match(article.author, /开发演示/);
  assert.match(article.sourceUrl, /非知乎正式内容/);
  assert.ok(article.paragraphs.length >= 5);
});

test('demo model follows the same cited learning and follow-up contract', async () => {
  const store = new ContentStore({ mode: 'demo' });
  const modelClient = new DemoModelClient();
  const service = new LearningService({ contentStore: store, modelClient });
  const items = await store.list();
  for (const item of items) {
    const result = await service.learn({ workId: item.work_id, mode: 'direct' });
    assert.equal(result.generationMode, 'demo');
    assert.equal(result.source.contentMode, 'demo');
    assert.ok(result.logic.length >= 3);
    assert.ok(result.logic.every((statement) => statement.citationIds.length > 0));
    const reflect = await service.learn({ workId: item.work_id, mode: 'reflect', reflection: '我理解为先记录事实，再决定下一步。' });
    assert.ok(reflect.feedback.every((statement) => statement.citationIds.length > 0));
    const followUp = await service.followUp({ workId: item.work_id, question: result.questions[0] });
    assert.equal(followUp.generationMode, 'demo');
    assert.ok(followUp.statements.every((statement) => statement.citationIds.length > 0));
    assert.ok(followUp.citations[0].quote.length > 0);
  }
});

test('demo reflection never marks a contradictory paraphrase as accurate', async () => {
  const store = new ContentStore({ mode: 'demo' });
  const service = new LearningService({ contentStore: store, modelClient: new DemoModelClient() });
  const result = await service.learn({
    workId: '9000000000000000002',
    mode: 'reflect',
    reflection: '这直接证明我没有自制力，而且不要记录事实。',
  });
  assert.equal(result.feedback[0].kind, 'uncertain');
  assert.match(result.feedback[0].text, /与材料主张方向相反/);

  const phrasingVariant = await service.learn({
    workId: '9000000000000000002',
    mode: 'reflect',
    reflection: '不需要记录事实，应该立刻评价自己失败，而且唯一原因就是懒。',
  });
  assert.notEqual(phrasingVariant.feedback[0].kind, 'accurate');

  for (const reflection of [
    '写清具体动作和时间边界，但不观察结果。',
    '写清动作、时间和结果，但不能验证。',
    '先记录事实，但下一步不能检验任何解释。',
  ]) {
    const workId = reflection.startsWith('先记录') ? '9000000000000000002' : '9000000000000000001';
    const negated = await service.learn({ workId, mode: 'reflect', reflection });
    assert.notEqual(negated.feedback[0].kind, 'accurate', reflection);
  }

  const supported = await service.learn({
    workId: '9000000000000000002',
    mode: 'reflect',
    reflection: '先记录可观察事实，保留多个候选解释，再用下一步行动检验。',
  });
  assert.equal(supported.feedback[0].kind, 'accurate');
});

test('demo follow-up answers are specific to the selected article', async () => {
  const store = new ContentStore({ mode: 'demo' });
  const service = new LearningService({ contentStore: store, modelClient: new DemoModelClient() });
  const result = await service.followUp({ workId: '9000000000000000002', question: '这个解释一定成立吗？' });
  assert.match(result.statements[0].text, /多个候选解释/);
  assert.doesNotMatch(result.statements[0].text, /小实验|降低要求/);
  assert.equal(result.citations[0].paragraphId, 'p3');
  assert.match(result.citations[0].quote, /解释可以有多个候选/);
});
