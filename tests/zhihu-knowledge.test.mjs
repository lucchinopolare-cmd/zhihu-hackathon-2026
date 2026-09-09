import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BodyTooLargeError,
  HttpStatusError,
  InvalidJsonError,
  InvalidWorkIdError,
  NonJsonResponseError,
  SchemaError,
  UnknownWorkIdError,
  ZhihuKnowledgeClient,
} from '../src/zhihu-knowledge.mjs';

const ID = '1523701957479239680';
const OTHER_ID = '1547987528036315136';

function listPayload() {
  return [{
    work_id: ID,
    title: 'Example',
    description: 'Description',
    labels: ['raw-label'],
    unrecognized_from_server: { retained: true },
  }];
}

function detailPayload(id = ID) {
  return {
    work_id: id,
    chapter_name: 'Example chapter',
    author_name: 'Example author',
    labels: ['raw-label'],
    content: 'A supplied fragment.',
    unrecognized_from_server: ['retained'],
  };
}

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers ?? {}) },
  });
}

test('caches and de-duplicates concurrent list and detail fetches per instance', async () => {
  let listCalls = 0;
  let detailCalls = 0;
  const client = new ZhihuKnowledgeClient({
    fetch: async (url, options) => {
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.headers['X-OAuth-Token'], undefined);
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (url.endsWith('/list')) {
        listCalls += 1;
        return jsonResponse(listPayload());
      }
      detailCalls += 1;
      return jsonResponse(detailPayload());
    },
  });

  const [firstList, secondList] = await Promise.all([client.list(), client.list()]);
  assert.strictEqual(firstList, secondList);
  assert.equal(listCalls, 1);
  assert.deepEqual(firstList[0].unrecognized_from_server, { retained: true });

  const [firstDetail, secondDetail] = await Promise.all([client.detail(ID), client.detail(ID)]);
  assert.strictEqual(firstDetail, secondDetail);
  assert.equal(listCalls, 1);
  assert.equal(detailCalls, 1);
  assert.deepEqual(firstDetail.unrecognized_from_server, ['retained']);
  assert.equal(Object.isFrozen(firstDetail), true);
});

test('rejects invalid ids and ids absent from the fetched list without a detail fetch', async () => {
  let detailCalls = 0;
  const client = new ZhihuKnowledgeClient({
    fetch: async (url) => {
      if (url.endsWith('/list')) return jsonResponse(listPayload());
      detailCalls += 1;
      return jsonResponse(detailPayload());
    },
  });

  await assert.rejects(client.detail('../etc/passwd'), InvalidWorkIdError);
  await assert.rejects(client.detail(1523701957479239680), InvalidWorkIdError);
  await assert.rejects(client.detail(OTHER_ID), UnknownWorkIdError);
  assert.equal(detailCalls, 0);
});

test('surfaces HTTP, non-JSON, malformed JSON, oversized and malformed-field responses', async (t) => {
  await t.test('HTTP status', async () => {
    const client = new ZhihuKnowledgeClient({
      fetch: async () => jsonResponse({ error: 'unavailable' }, { status: 503, statusText: 'Unavailable' }),
    });
    await assert.rejects(client.list(), HttpStatusError);
  });

  await t.test('successful non-JSON response', async () => {
    const client = new ZhihuKnowledgeClient({
      fetch: async () => new Response('<html>not json</html>', { headers: { 'content-type': 'text/html' } }),
    });
    await assert.rejects(client.list(), NonJsonResponseError);
  });

  await t.test('malformed JSON', async () => {
    const client = new ZhihuKnowledgeClient({
      fetch: async () => new Response('{not-json', { headers: { 'content-type': 'application/json' } }),
    });
    await assert.rejects(client.list(), InvalidJsonError);
  });

  await t.test('oversized success body', async () => {
    const client = new ZhihuKnowledgeClient({
      maxBodyBytes: 20,
      fetch: async () => jsonResponse(listPayload()),
    });
    await assert.rejects(client.list(), BodyTooLargeError);
  });

  await t.test('numeric work_id is a schema error, never converted with Number', async () => {
    const client = new ZhihuKnowledgeClient({
      fetch: async () => jsonResponse([{ work_id: 1523701957479239680, title: 'bad' }]),
    });
    await assert.rejects(client.list(), SchemaError);
  });
});
