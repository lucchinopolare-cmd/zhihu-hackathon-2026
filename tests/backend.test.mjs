import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';

function makeStore() {
  const article = {
    workId: '1', title: '测试文章', author: '作者', content: '第一段。\n第二段。',
    paragraphs: [{ id: 'p1', text: '第一段。' }, { id: 'p2', text: '第二段。' }],
    sourceUrl: 'https://www.zhihu.com/knowledge/1', contentMode: 'sample',
  };
  return {
    mode: 'sample',
    list: async () => [{ work_id: '1', title: '测试文章', description: '摘要' }],
    detail: async (id) => id === '1' ? article : (() => { const e = new Error('missing'); e.status = 404; e.code = 'UNKNOWN_WORK_ID'; throw e; })(),
  };
}

async function withServer(app, fn) {
  const server = http.createServer((req, res) => { void app(req, res); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try { return await fn(`http://127.0.0.1:${port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('health, knowledge and detail honor public contract', async () => {
  const modelClient = { configured: false, generate: async () => { throw new Error('unused'); } };
  const app = createApp({ contentStore: makeStore(), modelClient });
  await withServer(app, async (base) => {
    const health = await fetch(`${base}/api/health`);
    assert.deepEqual(await health.json(), { ok: true, modelConfigured: false, generationMode: 'live', contentMode: 'sample' });
    const list = await fetch(`${base}/api/knowledge`);
    assert.deepEqual(await list.json(), { items: [{ work_id: '1', title: '测试文章', description: '摘要' }], contentMode: 'sample' });
    const detail = await fetch(`${base}/api/knowledge/1`);
    assert.deepEqual(await detail.json(), {
      workId: '1', title: '测试文章', author: '作者', content: '第一段。\n第二段。',
      paragraphs: [{ id: 'p1', text: '第一段。' }, { id: 'p2', text: '第二段。' }],
      sourceUrl: 'https://www.zhihu.com/knowledge/1', contentMode: 'sample', completeness: 'unknown',
    });
  });
});

test('learn validates JSON, same origin, and reports missing model without exposing key', async () => {
  const app = createApp({ contentStore: makeStore(), modelClient: { configured: false, generate: async () => {} } });
  await withServer(app, async (base) => {
    const missingType = await fetch(`${base}/api/learn`, { method: 'POST', headers: { origin: base }, body: '{}' });
    assert.equal(missingType.status, 415);
    const crossOrigin = await fetch(`${base}/api/learn`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ workId: '1', mode: 'direct' }),
    });
    assert.equal(crossOrigin.status, 403);
    const missingOrigin = await fetch(`${base}/api/learn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workId: '1', mode: 'direct' }),
    });
    assert.equal(missingOrigin.status, 403);
    assert.equal((await missingOrigin.json()).error.code, 'ORIGIN_REQUIRED');
    const body = await fetch(`${base}/api/learn`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ workId: '1', mode: 'direct' }),
    });
    assert.equal(body.status, 503);
    const payload = await body.json();
    assert.equal(payload.error.code, 'MODEL_NOT_CONFIGURED');
    assert.equal(JSON.stringify(payload).includes('Bearer'), false);
  });
});

test('generation endpoints enforce per-origin frequency and cumulative request limits', async () => {
  let now = 0;
  const service = {
    learn: async ({ workId, mode }) => ({ workId, mode }),
    followUp: async () => ({ workId: '1' }),
  };
  const app = createApp({
    contentStore: makeStore(),
    modelClient: { configured: true, runtimeMode: 'demo' },
    learningService: service,
    generationWindowMs: 1000,
    maxGenerationPerWindow: 1,
    maxGenerationRequests: 2,
    now: () => now,
  });
  await withServer(app, async (base) => {
    const options = { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ workId: '1', mode: 'direct' }) };
    const first = await fetch(`${base}/api/learn`, options);
    assert.equal(first.status, 200);
    const tooFast = await fetch(`${base}/api/learn`, options);
    assert.equal(tooFast.status, 429);
    assert.equal((await tooFast.json()).error.code, 'GENERATION_RATE_LIMITED');
    assert.ok(Number(tooFast.headers.get('retry-after')) >= 1);
    now = 1001;
    const second = await fetch(`${base}/api/learn`, options);
    assert.equal(second.status, 200);
    now = 2002;
    const overBudget = await fetch(`${base}/api/learn`, options);
    assert.equal(overBudget.status, 429);
    assert.equal((await overBudget.json()).error.code, 'GENERATION_BUDGET_EXCEEDED');
  });
});

test('follow-up validates requests and returns a cited answer', async () => {
  const modelClient = {
    configured: true,
    runtimeMode: 'demo',
    generate: async () => { throw new Error('unused'); },
    followUp: async ({ question }) => ({
      statements: [{ text: `针对“${question}”的回答。`, citationIds: ['f1'] }],
      citations: [{ id: 'f1', paragraphId: 'p1', quote: '第一段。' }],
    }),
  };
  const app = createApp({ contentStore: makeStore(), modelClient });
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/follow-up`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ workId: '1', question: '这是什么意思？' }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.workId, '1');
    assert.equal(result.question, '这是什么意思？');
    assert.equal(result.generationMode, 'demo');
    assert.equal(result.statements[0].citationIds[0], 'f1');
    assert.equal(result.citations[0].quote, '第一段。');

    const empty = await fetch(`${base}/api/follow-up`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ workId: '1', question: ' ' }),
    });
    assert.equal(empty.status, 400);
    assert.equal((await empty.json()).error.code, 'QUESTION_REQUIRED');

    const extra = await fetch(`${base}/api/follow-up`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ workId: '1', question: '问题', history: [] }),
    });
    assert.equal(extra.status, 400);
    assert.equal((await extra.json()).error.code, 'INVALID_REQUEST');
  });
});

test('challenge and scenario action endpoints keep inputs scoped to the selected article', async () => {
  const modelClient = {
    configured: true,
    runtimeMode: 'demo',
    generate: async () => { throw new Error('unused'); },
    checkChallenge: async ({ question, answer }) => ({
      status: 'ready', feedback: [{ text: `核对：${question}/${answer}`, citationIds: ['c1'] }],
      citations: [{ id: 'c1', paragraphId: 'p1', quote: '第一段。' }], variantQuestion: '',
    }),
    personalizeAction: async ({ scenario }) => ({ task: `用于${scenario}`, completion: '看到结果', review: '明天回顾' }),
  };
  const app = createApp({ contentStore: makeStore(), modelClient });
  await withServer(app, async (base) => {
    const challenge = await fetch(`${base}/api/challenge`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ workId: '1', question: '问题', answer: '回答' }) });
    assert.equal(challenge.status, 200);
    assert.equal((await challenge.json()).generationMode, 'demo');
    const action = await fetch(`${base}/api/personalize-action`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ workId: '1', scenario: '下周复习' }) });
    assert.equal(action.status, 200);
    assert.equal((await action.json()).action.task, '用于下周复习');
    const empty = await fetch(`${base}/api/challenge`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ workId: '1', question: '问题', answer: ' ' }) });
    assert.equal(empty.status, 400);
    assert.equal((await empty.json()).error.code, 'CHALLENGE_ANSWER_REQUIRED');
  });
});

test('static allowlist prevents traversal and does not expose source files', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'zhihu-public-'));
  try {
    await writeFile(path.join(temp, 'index.html'), 'ok');
    const app = createApp({ contentStore: makeStore(), modelClient: { configured: false, generate: async () => {} }, publicDir: temp });
    await withServer(app, async (base) => {
      const root = await fetch(`${base}/`);
      assert.equal(root.status, 200);
      assert.equal(await root.text(), 'ok');
      assert.equal((await fetch(`${base}/../sources/knowledge-list-2026-09-09.json`)).status, 404);
      assert.equal((await fetch(`${base}/src/server.mjs`)).status, 404);
    });
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('request body limit rejects oversized payload', async () => {
  const app = createApp({ contentStore: makeStore(), modelClient: { configured: false, generate: async () => {} }, maxRequestBytes: 32 });
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/learn`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ workId: '1', mode: 'reflect', reflection: 'x'.repeat(100) }),
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, 'REQUEST_TOO_LARGE');
  });
});

test('an empty live list is returned as an honest empty state', async () => {
  const contentStore = {
    mode: 'live',
    list: async () => [],
    detail: async () => { throw new Error('unused'); },
  };
  const modelClient = { configured: false, generate: async () => { throw new Error('unused'); } };
  const app = createApp({ contentStore, modelClient });
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/knowledge`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [], contentMode: 'live' });
  });
});
