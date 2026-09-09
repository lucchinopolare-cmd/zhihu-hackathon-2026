const API_ORIGIN = 'https://api.zhihu.com';
const KNOWLEDGE_PATH = '/km-indep-home/hackathon/v2/knowledge';

export const KNOWLEDGE_LIST_URL = `${API_ORIGIN}${KNOWLEDGE_PATH}/list`;
export const DEFAULT_TIMEOUT_MS = 8_000;
export const DEFAULT_MAX_BODY_BYTES = 1_000_000;

const WORK_ID_PATTERN = /^[0-9]+$/;
const UTF8 = new TextEncoder();

export class ZhihuKnowledgeError extends Error {
  constructor(message, { code = 'ZHIHU_KNOWLEDGE_ERROR', cause, ...details } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = this.constructor.name;
    this.code = code;
    Object.assign(this, details);
  }
}

export class InvalidWorkIdError extends ZhihuKnowledgeError {
  constructor(workId) {
    super('work_id must be a non-empty decimal string from the fetched list.', {
      code: 'INVALID_WORK_ID',
      workId,
    });
  }
}

export class UnknownWorkIdError extends ZhihuKnowledgeError {
  constructor(workId) {
    super('work_id is not present in this client instance\'s fetched list.', {
      code: 'UNKNOWN_WORK_ID',
      workId,
    });
  }
}

export class TimeoutError extends ZhihuKnowledgeError {
  constructor(timeoutMs, cause) {
    super(`Zhihu knowledge request timed out after ${timeoutMs} ms.`, {
      code: 'REQUEST_TIMEOUT',
      timeoutMs,
      cause,
    });
  }
}

export class NetworkError extends ZhihuKnowledgeError {
  constructor(cause) {
    super('Zhihu knowledge request failed before a response was received.', {
      code: 'NETWORK_ERROR',
      cause,
    });
  }
}

export class HttpStatusError extends ZhihuKnowledgeError {
  constructor({ status, statusText, bodyPreview }) {
    super(`Zhihu knowledge API returned HTTP ${status}${statusText ? ` ${statusText}` : ''}.`, {
      code: 'HTTP_STATUS',
      status,
      statusText,
      bodyPreview,
    });
  }
}

export class BodyTooLargeError extends ZhihuKnowledgeError {
  constructor(maxBodyBytes) {
    super(`Zhihu knowledge response exceeded the ${maxBodyBytes}-byte limit.`, {
      code: 'BODY_TOO_LARGE',
      maxBodyBytes,
    });
  }
}

export class NonJsonResponseError extends ZhihuKnowledgeError {
  constructor(contentType) {
    super('Zhihu knowledge API returned a successful response without a JSON content type.', {
      code: 'NON_JSON_RESPONSE',
      contentType,
    });
  }
}

export class InvalidJsonError extends ZhihuKnowledgeError {
  constructor(cause) {
    super('Zhihu knowledge API returned invalid JSON.', {
      code: 'INVALID_JSON',
      cause,
    });
  }
}

export class SchemaError extends ZhihuKnowledgeError {
  constructor(message, { field, value } = {}) {
    super(message, { code: 'INVALID_RESPONSE_SCHEMA', field, value });
  }
}

/**
 * A small, credential-free client for the two black-hackathon knowledge endpoints.
 * It intentionally has no retry policy and never adds Authorization headers.
 */
export class ZhihuKnowledgeClient {
  #fetch;
  #timeoutMs;
  #maxBodyBytes;
  #list;
  #listPromise;
  #knownWorkIds = new Set();
  #details = new Map();
  #detailPromises = new Map();

  constructor({ fetch = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, maxBodyBytes = DEFAULT_MAX_BODY_BYTES } = {}) {
    if (typeof fetch !== 'function') {
      throw new TypeError('fetch must be a function.');
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError('timeoutMs must be a positive safe integer.');
    }
    if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) {
      throw new TypeError('maxBodyBytes must be a positive safe integer.');
    }
    this.#fetch = fetch;
    this.#timeoutMs = timeoutMs;
    this.#maxBodyBytes = maxBodyBytes;
  }

  /** Returns the cached list after its first successful fetch. */
  async list() {
    if (this.#list !== undefined) {
      return this.#list;
    }
    if (this.#listPromise !== undefined) {
      return this.#listPromise;
    }

    const pending = this.#loadList();
    this.#listPromise = pending;
    try {
      const list = await pending;
      this.#list = list;
      return list;
    } finally {
      if (this.#listPromise === pending) {
        this.#listPromise = undefined;
      }
    }
  }

  /**
   * Reads one detail only after the id has been observed in this instance's list.
   * Concurrent requests for the same id share one fetch and successful details cache.
   */
  async detail(workId) {
    const safeWorkId = assertSafeWorkId(workId);
    await this.list();
    if (!this.#knownWorkIds.has(safeWorkId)) {
      throw new UnknownWorkIdError(safeWorkId);
    }
    if (this.#details.has(safeWorkId)) {
      return this.#details.get(safeWorkId);
    }
    if (this.#detailPromises.has(safeWorkId)) {
      return this.#detailPromises.get(safeWorkId);
    }

    const pending = this.#loadDetail(safeWorkId);
    this.#detailPromises.set(safeWorkId, pending);
    try {
      const detail = await pending;
      this.#details.set(safeWorkId, detail);
      return detail;
    } finally {
      if (this.#detailPromises.get(safeWorkId) === pending) {
        this.#detailPromises.delete(safeWorkId);
      }
    }
  }

  /** Clears successful, per-instance cache entries. It does not retry or cancel requests. */
  clearCache() {
    this.#list = undefined;
    this.#knownWorkIds.clear();
    this.#details.clear();
  }

  async #loadList() {
    const payload = await this.#requestJson(KNOWLEDGE_LIST_URL);
    const list = validateList(payload);
    this.#knownWorkIds = new Set(list.map((item) => item.work_id));
    return list;
  }

  async #loadDetail(workId) {
    const url = `${API_ORIGIN}${KNOWLEDGE_PATH}/${encodeURIComponent(workId)}`;
    const payload = await this.#requestJson(url);
    return validateDetail(payload, workId);
  }

  async #requestJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response;
    try {
      response = await this.#fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new TimeoutError(this.#timeoutMs, error);
      }
      throw new NetworkError(error);
    } finally {
      clearTimeout(timer);
    }

    if (!isResponseLike(response)) {
      throw new NetworkError(new TypeError('fetch did not return a Response-like object.'));
    }
    if (!response.ok) {
      throw new HttpStatusError({
        status: response.status,
        statusText: response.statusText,
        bodyPreview: await readTextPreview(response, 512),
      });
    }

    const contentType = getHeader(response, 'content-type');
    if (!isJsonContentType(contentType)) {
      throw new NonJsonResponseError(contentType);
    }
    const text = await readTextLimited(response, this.#maxBodyBytes);
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new InvalidJsonError(error);
    }
  }
}

/**
 * Reports a display-only truncation signal. It cannot prove that a supplied body
 * is complete, and it deliberately never returns the body itself.
 */
export function contentTailSignal(content) {
  if (typeof content !== 'string') {
    throw new TypeError('content must be a string.');
  }
  const trimmed = content.trimEnd();
  const hasTerminalPunctuation = /[。！？；…]$/u.test(trimmed);
  if (content.length === 3_000 && !hasTerminalPunctuation) {
    return 'possible';
  }
  if (!hasTerminalPunctuation) {
    return 'weak';
  }
  return 'none';
}

function assertSafeWorkId(workId) {
  if (typeof workId !== 'string' || !WORK_ID_PATTERN.test(workId)) {
    throw new InvalidWorkIdError(workId);
  }
  return workId;
}

function validateList(payload) {
  if (!Array.isArray(payload)) {
    throw new SchemaError('Knowledge list response must be a JSON array.', { field: 'root', value: payload });
  }
  const seen = new Set();
  const list = payload.map((item, index) => {
    if (!isRecord(item)) {
      throw new SchemaError('Each knowledge list item must be a JSON object.', { field: `[${index}]`, value: item });
    }
    const workId = item.work_id;
    try {
      assertSafeWorkId(workId);
    } catch {
      throw new SchemaError('Each knowledge list item must have a decimal-string work_id.', {
        field: `[${index}].work_id`,
        value: workId,
      });
    }
    if (seen.has(workId)) {
      throw new SchemaError('Knowledge list contains a duplicate work_id.', { field: `[${index}].work_id`, value: workId });
    }
    seen.add(workId);
    validateKnownListFields(item, index);
    return freezeJson(item);
  });
  return Object.freeze(list);
}

function validateDetail(payload, requestedWorkId) {
  if (!isRecord(payload)) {
    throw new SchemaError('Knowledge detail response must be a JSON object.', { field: 'root', value: payload });
  }
  if (payload.work_id !== requestedWorkId || !WORK_ID_PATTERN.test(payload.work_id)) {
    throw new SchemaError('Knowledge detail work_id must match the requested decimal-string id.', {
      field: 'work_id',
      value: payload.work_id,
    });
  }
  if (typeof payload.content !== 'string') {
    throw new SchemaError('Knowledge detail response must contain string content.', {
      field: 'content',
      value: payload.content,
    });
  }
  validateKnownDetailFields(payload);
  return freezeJson(payload);
}

function validateKnownListFields(item, index) {
  for (const field of ['title', 'artwork', 'tab_artwork', 'description']) {
    if (field in item && typeof item[field] !== 'string') {
      throw new SchemaError('Known list text fields must be strings when present.', {
        field: `[${index}].${field}`,
        value: item[field],
      });
    }
  }
  validateLabels(item.labels, `[${index}].labels`);
}

function validateKnownDetailFields(item) {
  for (const field of ['chapter_name', 'author_avatar', 'author_name', 'introduction']) {
    if (field in item && typeof item[field] !== 'string') {
      throw new SchemaError('Known detail text fields must be strings when present.', {
        field,
        value: item[field],
      });
    }
  }
  validateLabels(item.labels, 'labels');
}

function validateLabels(labels, field) {
  if (labels === undefined) {
    return;
  }
  if (!Array.isArray(labels) || labels.some((label) => typeof label !== 'string')) {
    throw new SchemaError('labels must be an array of strings when present.', { field, value: labels });
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function freezeJson(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) {
    freezeJson(child, seen);
  }
  return Object.freeze(value);
}

function isResponseLike(response) {
  return response !== null && typeof response === 'object'
    && typeof response.ok === 'boolean' && typeof response.status === 'number';
}

function getHeader(response, name) {
  return response.headers?.get?.(name) ?? '';
}

function isJsonContentType(contentType) {
  return /(?:^|\/)json(?:;|$)|\+json(?:;|$)/i.test(contentType);
}

async function readTextLimited(response, maxBytes) {
  const contentLength = Number.parseInt(getHeader(response, 'content-length'), 10);
  if (Number.isSafeInteger(contentLength) && contentLength > maxBytes) {
    throw new BodyTooLargeError(maxBytes);
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (UTF8.encode(text).byteLength > maxBytes) {
      throw new BodyTooLargeError(maxBytes);
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new BodyTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function readTextPreview(response, maxBytes) {
  try {
    if (!response.body || typeof response.body.getReader !== 'function') {
      return (await response.text()).slice(0, maxBytes);
    }
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
      while (totalBytes < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        const remaining = maxBytes - totalBytes;
        chunks.push(value.slice(0, remaining));
        totalBytes += Math.min(value.byteLength, remaining);
        if (value.byteLength > remaining) break;
      }
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}
