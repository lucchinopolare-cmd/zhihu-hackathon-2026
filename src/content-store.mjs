import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ZhihuKnowledgeClient } from './zhihu-knowledge.mjs';

const WORK_ID_PATTERN = /^[0-9]+$/;
const DEFAULT_SAMPLE_LIST = 'knowledge-list-2026-09-09.json';

export class ContentStoreError extends Error {
  constructor(message, { code = 'CONTENT_ERROR', status = 502, cause, workId } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
    this.workId = workId;
  }
}

/**
 * Provides normalized Zhihu knowledge data. Live mode delegates to the existing
 * credential-free client; sample mode reads only files explicitly present in
 * sources/ and fails when a requested fixture is absent.
 */
export class ContentStore {
  #mode;
  #client;
  #sourcesDir;
  #sampleListFile;
  #list;
  #listPromise;
  #details = new Map();
  #detailPromises = new Map();

  constructor({ mode = process.env.ZHIHU_CONTENT_MODE || 'live', client, sourcesDir, sampleListFile = DEFAULT_SAMPLE_LIST } = {}) {
    if (mode !== 'live' && mode !== 'sample') {
      throw new TypeError('content mode must be live or sample.');
    }
    this.#mode = mode;
    this.#client = client ?? new ZhihuKnowledgeClient();
    this.#sourcesDir = path.resolve(sourcesDir ?? path.join(process.cwd(), 'sources'));
    this.#sampleListFile = sampleListFile;
  }

  get mode() { return this.#mode; }

  async list() {
    if (this.#list) return this.#list;
    if (this.#listPromise) return this.#listPromise;
    const pending = (async () => {
      const raw = this.#mode === 'sample' ? await this.#readSampleList() : await this.#client.list();
      if (!Array.isArray(raw)) throw new ContentStoreError('知识列表格式无效。', { code: 'CONTENT_SCHEMA', status: 502 });
      const items = raw.map((item, index) => {
        const workId = item?.work_id;
        if (typeof workId !== 'string' || !WORK_ID_PATTERN.test(workId)) {
          throw new ContentStoreError(`知识列表第 ${index + 1} 项缺少有效 work_id。`, { code: 'CONTENT_SCHEMA', status: 502 });
        }
        return Object.freeze({
          work_id: workId,
          title: typeof item.title === 'string' ? item.title : '',
          description: typeof item.description === 'string' ? item.description : '',
        });
      });
      this.#list = Object.freeze(items);
      return this.#list;
    })();
    this.#listPromise = pending;
    try { return await pending; }
    finally { if (this.#listPromise === pending) this.#listPromise = undefined; }
  }

  async detail(workId) {
    if (typeof workId !== 'string' || !WORK_ID_PATTERN.test(workId)) {
      throw new ContentStoreError('work_id 必须是列表中的数字字符串。', { code: 'INVALID_WORK_ID', status: 400, workId });
    }
    const known = await this.list();
    if (!known.some((item) => item.work_id === workId)) {
      throw new ContentStoreError('未找到该知识内容。', { code: 'UNKNOWN_WORK_ID', status: 404, workId });
    }
    if (this.#details.has(workId)) return this.#details.get(workId);
    if (this.#detailPromises.has(workId)) return this.#detailPromises.get(workId);
    const pending = (async () => {
      let raw;
      try {
        raw = this.#mode === 'sample' ? await this.#readSampleDetail(workId) : await this.#client.detail(workId);
      } catch (error) {
        if (error?.code === 'UNKNOWN_WORK_ID') {
          throw new ContentStoreError('未找到该知识内容。', { code: 'UNKNOWN_WORK_ID', status: 404, workId, cause: error });
        }
        if (error?.code === 'INVALID_WORK_ID') {
          throw new ContentStoreError('work_id 必须是列表中的数字字符串。', { code: 'INVALID_WORK_ID', status: 400, workId, cause: error });
        }
        throw error;
      }
      const item = normalizeDetail(raw, workId, this.#mode);
      this.#details.set(workId, item);
      return item;
    })();
    this.#detailPromises.set(workId, pending);
    try { return await pending; }
    finally { if (this.#detailPromises.get(workId) === pending) this.#detailPromises.delete(workId); }
  }

  clearCache() {
    this.#list = undefined;
    this.#listPromise = undefined;
    this.#details.clear();
    this.#detailPromises.clear();
    this.#client.clearCache?.();
  }

  async #readSampleList() {
    const filename = path.basename(this.#sampleListFile);
    if (filename !== this.#sampleListFile || filename !== DEFAULT_SAMPLE_LIST && !filename.startsWith('knowledge-list-')) {
      throw new ContentStoreError('sample 列表文件名无效。', { code: 'CONTENT_SAMPLE_MISSING', status: 503 });
    }
    return readJson(path.join(this.#sourcesDir, filename));
  }

  async #readSampleDetail(workId) {
    try {
      return await readJson(path.join(this.#sourcesDir, `knowledge-detail-${workId}.json`));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new ContentStoreError('sample 模式缺少所请求的知识详情文件。', {
          code: 'CONTENT_SAMPLE_MISSING', status: 503, workId, cause: error,
        });
      }
      throw error;
    }
  }
}

function normalizeDetail(raw, workId, mode) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.work_id !== workId || typeof raw.content !== 'string') {
    throw new ContentStoreError('知识详情格式无效。', { code: 'CONTENT_SCHEMA', status: 502, workId });
  }
  const title = typeof raw.chapter_name === 'string' ? raw.chapter_name : '';
  const author = typeof raw.author_name === 'string' ? raw.author_name : '';
  if (!title || !author) throw new ContentStoreError('知识详情缺少标题或作者。', { code: 'CONTENT_SCHEMA', status: 502, workId });
  const paragraphs = splitParagraphs(raw.content);
  if (paragraphs.length === 0) throw new ContentStoreError('知识详情正文为空。', { code: 'CONTENT_EMPTY', status: 502, workId });
  return Object.freeze({
    workId,
    title,
    author,
    content: raw.content,
    paragraphs: Object.freeze(paragraphs.map((text, index) => Object.freeze({ id: `p${index + 1}`, text }))),
    sourceUrl: `https://api.zhihu.com/km-indep-home/hackathon/v2/knowledge/${encodeURIComponent(workId)}`,
    contentMode: mode,
  });
}

function splitParagraphs(content) {
  return content
    .replace(/\r\n?/g, '\n')
    .split(/\n+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

async function readJson(filename) {
  try {
    return JSON.parse(await readFile(filename, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new ContentStoreError('sample 模式缺少本机数据文件。', { code: 'CONTENT_SAMPLE_MISSING', status: 503, cause: error });
    }
    if (error instanceof SyntaxError) {
      throw new ContentStoreError('sample 数据文件不是有效 JSON。', { code: 'CONTENT_SCHEMA', status: 503, cause: error });
    }
    throw new ContentStoreError('读取知识内容失败。', { code: 'CONTENT_READ_ERROR', status: 503, cause: error });
  }
}

export function normalizeKnowledgeDetail(raw, workId, mode = 'live') {
  return normalizeDetail(raw, workId, mode);
}
