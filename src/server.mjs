import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ContentStore, ContentStoreError } from './content-store.mjs';
import { ResponsesModelClient, ModelClientError, ModelNotConfiguredError, MODEL_DEFAULTS } from './model-client.mjs';
import { LearningService, LearningServiceError } from './learning-service.mjs';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PUBLIC_DIR = path.resolve(ROOT_DIR, '../public');
const STATIC_FILES = new Map([
  ['', 'index.html'],
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/styles.css', 'styles.css'],
  ['/app.js', 'app.js'],
  ['/learning-card.js', 'learning-card.js'],
  ['/favicon.svg', 'favicon.svg'],
]);
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const DEFAULT_MAX_REQUEST_BYTES = 64 * 1024;
const DEFAULT_BODY_TIMEOUT_MS = 15_000;
const DEFAULT_GENERATION_WINDOW_MS = 60_000;
const DEFAULT_MAX_GENERATION_PER_WINDOW = 5;
const DEFAULT_MAX_GENERATION_REQUESTS = 20;

/**
 * Creates the HTTP request listener. Dependencies can be injected for tests;
 * direct execution starts a server bound to HOST/PORT (127.0.0.1:3000 by default).
 */
export function createApp({
  contentStore,
  modelClient,
  learningService,
  publicDir = DEFAULT_PUBLIC_DIR,
  maxRequestBytes = envInteger('MAX_REQUEST_BYTES', DEFAULT_MAX_REQUEST_BYTES),
  bodyTimeoutMs = envInteger('BODY_TIMEOUT_MS', DEFAULT_BODY_TIMEOUT_MS),
  maxConcurrent = envInteger('MAX_GENERATION_CONCURRENT', 2),
  generationWindowMs = envInteger('GENERATION_RATE_WINDOW_MS', DEFAULT_GENERATION_WINDOW_MS),
  maxGenerationPerWindow = envInteger('MAX_GENERATION_PER_WINDOW', DEFAULT_MAX_GENERATION_PER_WINDOW),
  maxGenerationRequests = envInteger('MAX_GENERATION_REQUESTS', DEFAULT_MAX_GENERATION_REQUESTS),
  requireOrigin = envBoolean('REQUIRE_ORIGIN', true),
  allowedOrigin = process.env.ALLOWED_ORIGIN || '',
  generationAuthToken = process.env.GENERATION_AUTH_TOKEN || '',
  requireGenerationAuth = envBoolean('REQUIRE_GENERATION_AUTH', Boolean(generationAuthToken)),
  generationGuard = null,
  now = () => Date.now(),
} = {}) {
  const store = contentStore ?? new ContentStore();
  const model = modelClient ?? new ResponsesModelClient({
    apiKey: process.env.MODEL_API_KEY || process.env.ZHIHU_OPENAI_NEXT_API_KEY || '',
    baseUrl: process.env.MODEL_BASE_URL || MODEL_DEFAULTS.baseUrl,
    model: process.env.MODEL_NAME || MODEL_DEFAULTS.model,
    reasoningEffort: process.env.MODEL_REASONING_EFFORT || MODEL_DEFAULTS.reasoningEffort,
    timeoutMs: envInteger('MODEL_TIMEOUT_MS', MODEL_DEFAULTS.timeoutMs),
    maxOutputTokens: envInteger('MODEL_MAX_OUTPUT_TOKENS', MODEL_DEFAULTS.maxOutputTokens),
  });
  const service = learningService ?? new LearningService({ contentStore: store, modelClient: model, maxConcurrent });
  const safePublicDir = path.resolve(publicDir);
  const requestGuard = generationGuard ?? new GenerationGuard({
    windowMs: generationWindowMs,
    maxPerWindow: maxGenerationPerWindow,
    maxRequests: maxGenerationRequests,
    now,
  });

  const handler = async (req, res) => {
    try {
      await route(req, res, {
        store, model, service, safePublicDir, maxRequestBytes, bodyTimeoutMs, generationGuard: requestGuard,
        requireOrigin, allowedOrigin, generationAuthToken, requireGenerationAuth,
      });
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendError(res, normalizeError(error));
    }
  };
  handler.store = store;
  handler.modelClient = model;
  handler.learningService = service;
  handler.createServer = () => http.createServer((req, res) => { void handler(req, res); });
  return handler;
}

async function route(req, res, ctx) {
  const method = req.method || 'GET';
  const url = new URL(req.url || '/', 'http://localhost');
  if (method === 'OPTIONS') {
    // Same-origin clients may preflight; no permissive CORS headers are emitted.
    res.writeHead(204, { Allow: 'GET, POST, OPTIONS' });
    res.end();
    return;
  }
  if (method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      modelConfigured: Boolean(ctx.model.configured),
      generationMode: ctx.model.runtimeMode === 'demo' ? 'demo' : 'live',
      contentMode: ctx.store.mode,
    });
    return;
  }
  if (method === 'GET' && url.pathname === '/api/knowledge') {
    const items = await ctx.store.list();
    sendJson(res, 200, {
      items: items.map(({ work_id, title, description }) => ({ work_id, title, description })),
      contentMode: ctx.store.mode,
    });
    return;
  }
  const detailMatch = method === 'GET' && url.pathname.match(/^\/api\/knowledge\/([^/]+)$/u);
  if (detailMatch) {
    const workId = decodeURIComponent(detailMatch[1]);
    const article = await ctx.store.detail(workId);
    sendJson(res, 200, {
      workId: article.workId,
      title: article.title,
      author: article.author,
      content: article.content,
      paragraphs: article.paragraphs,
      sourceUrl: article.sourceUrl,
      contentMode: article.contentMode,
      completeness: 'unknown',
    });
    return;
  }
  if (method === 'POST' && url.pathname === '/api/learn') {
    assertGenerationAccess(req, ctx);
    assertJsonContentType(req);
    const payload = await readJsonBody(req, ctx.maxRequestBytes, ctx.bodyTimeoutMs);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new LearningServiceError('请求体必须是 JSON 对象。', { code: 'INVALID_JSON_BODY', status: 400 });
    }
    const allowed = new Set(['workId', 'mode', 'reflection']);
    for (const key of Object.keys(payload)) {
      if (!allowed.has(key)) throw new LearningServiceError(`请求字段 ${key} 不被支持。`, { code: 'INVALID_REQUEST', status: 400 });
    }
    if (typeof payload.workId !== 'string' || payload.workId.trim() === '') {
      throw new LearningServiceError('workId 必须是非空字符串。', { code: 'INVALID_REQUEST', status: 400 });
    }
    if (!['direct', 'reflect'].includes(payload.mode)) {
      throw new LearningServiceError('mode 必须是 direct 或 reflect。', { code: 'INVALID_MODE', status: 400 });
    }
    if (payload.mode === 'reflect' && (typeof payload.reflection !== 'string' || payload.reflection.trim() === '')) {
      throw new LearningServiceError('reflect 模式需要填写非空复述。', { code: 'REFLECTION_REQUIRED', status: 400 });
    }
    assertModelConfigured(ctx);
    const reservation = ctx.generationGuard.reserve(req);
    let committed = false;
    const requestAbort = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) requestAbort.abort(new Error('client disconnected'));
    };
    req.on('aborted', onClose);
    res.on('close', onClose);
    let result;
    try {
      result = await ctx.service.learn({
        workId: payload.workId,
        mode: payload.mode,
        reflection: payload.reflection,
        signal: requestAbort.signal,
      });
      reservation.commit();
      committed = true;
    } finally {
      if (!committed) reservation.release();
      req.off('aborted', onClose);
      res.off('close', onClose);
    }
    sendJson(res, 200, result);
    return;
  }
  if (method === 'POST' && url.pathname === '/api/follow-up') {
    assertGenerationAccess(req, ctx);
    assertJsonContentType(req);
    const payload = await readJsonBody(req, ctx.maxRequestBytes, ctx.bodyTimeoutMs);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new LearningServiceError('请求体必须是 JSON 对象。', { code: 'INVALID_JSON_BODY', status: 400 });
    }
    const allowed = new Set(['workId', 'question']);
    for (const key of Object.keys(payload)) {
      if (!allowed.has(key)) throw new LearningServiceError(`请求字段 ${key} 不被支持。`, { code: 'INVALID_REQUEST', status: 400 });
    }
    if (typeof payload.workId !== 'string' || payload.workId.trim() === '') {
      throw new LearningServiceError('workId 必须是非空字符串。', { code: 'INVALID_REQUEST', status: 400 });
    }
    if (typeof payload.question !== 'string' || payload.question.trim() === '') {
      throw new LearningServiceError('追问内容不能为空。', { code: 'QUESTION_REQUIRED', status: 400 });
    }
    if (payload.question.trim().length > 1000) {
      throw new LearningServiceError('追问内容过长，请缩短到 1000 字以内。', { code: 'QUESTION_TOO_LONG', status: 400 });
    }
    assertModelConfigured(ctx);
    const reservation = ctx.generationGuard.reserve(req);
    let committed = false;
    const requestAbort = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) requestAbort.abort(new Error('client disconnected'));
    };
    req.on('aborted', onClose);
    res.on('close', onClose);
    try {
      const result = await ctx.service.followUp({
        workId: payload.workId,
        question: payload.question,
        signal: requestAbort.signal,
      });
      reservation.commit();
      committed = true;
      sendJson(res, 200, result);
    } finally {
      if (!committed) reservation.release();
      req.off('aborted', onClose);
      res.off('close', onClose);
    }
    return;
  }
  if (method === 'POST' && (url.pathname === '/api/challenge' || url.pathname === '/api/personalize-action')) {
    assertGenerationAccess(req, ctx);
    assertJsonContentType(req);
    const payload = await readJsonBody(req, ctx.maxRequestBytes, ctx.bodyTimeoutMs);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new LearningServiceError('请求体必须是 JSON 对象。', { code: 'INVALID_JSON_BODY', status: 400 });
    }
    const isChallenge = url.pathname === '/api/challenge';
    const allowed = isChallenge ? new Set(['workId', 'question', 'answer']) : new Set(['workId', 'scenario']);
    for (const key of Object.keys(payload)) {
      if (!allowed.has(key)) throw new LearningServiceError(`请求字段 ${key} 不被支持。`, { code: 'INVALID_REQUEST', status: 400 });
    }
    if (typeof payload.workId !== 'string' || payload.workId.trim() === '') {
      throw new LearningServiceError('workId 必须是非空字符串。', { code: 'INVALID_REQUEST', status: 400 });
    }
    if (isChallenge) {
      if (typeof payload.question !== 'string' || payload.question.trim() === '') {
        throw new LearningServiceError('挑战问题不能为空。', { code: 'CHALLENGE_REQUIRED', status: 400 });
      }
      if (typeof payload.answer !== 'string' || payload.answer.trim() === '') {
        throw new LearningServiceError('请先写下你的挑战回答。', { code: 'CHALLENGE_ANSWER_REQUIRED', status: 400 });
      }
      if (payload.answer.trim().length > 2000) {
        throw new LearningServiceError('挑战回答过长，请缩短到 2000 字以内。', { code: 'CHALLENGE_ANSWER_TOO_LONG', status: 400 });
      }
    } else {
      if (typeof payload.scenario !== 'string' || payload.scenario.trim() === '') {
        throw new LearningServiceError('请先写下你想应用的场景。', { code: 'SCENARIO_REQUIRED', status: 400 });
      }
      if (payload.scenario.trim().length > 1000) {
        throw new LearningServiceError('使用场景过长，请缩短到 1000 字以内。', { code: 'SCENARIO_TOO_LONG', status: 400 });
      }
    }
    assertModelConfigured(ctx);
    const reservation = ctx.generationGuard.reserve(req);
    let committed = false;
    const requestAbort = new AbortController();
    const onClose = () => { if (!res.writableEnded) requestAbort.abort(new Error('client disconnected')); };
    req.on('aborted', onClose); res.on('close', onClose);
    try {
      const result = isChallenge
        ? await ctx.service.checkChallenge({ workId: payload.workId, question: payload.question, answer: payload.answer, signal: requestAbort.signal })
        : await ctx.service.personalizeAction({ workId: payload.workId, scenario: payload.scenario, signal: requestAbort.signal });
      reservation.commit();
      committed = true;
      sendJson(res, 200, result);
    } finally {
      if (!committed) reservation.release();
      req.off('aborted', onClose); res.off('close', onClose);
    }
    return;
  }
  if (method === 'GET') {
    await serveStatic(url.pathname, res, ctx.safePublicDir);
    return;
  }
  throw new HttpError(404, 'NOT_FOUND', '请求路径不存在。');
}

async function serveStatic(pathname, res, publicDir) {
  const filename = STATIC_FILES.get(pathname);
  if (!filename) throw new HttpError(404, 'NOT_FOUND', '请求路径不存在。');
  const target = path.resolve(publicDir, filename);
  if (!target.startsWith(`${publicDir}${path.sep}`) && target !== publicDir) {
    throw new HttpError(404, 'NOT_FOUND', '请求路径不存在。');
  }
  let body;
  try {
    body = await readFile(target);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new HttpError(404, 'NOT_FOUND', '页面资源暂不可用。');
    throw new HttpError(500, 'STATIC_ERROR', '页面资源读取失败。', error);
  }
  const ext = path.extname(filename);
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(body);
}

function assertSameOrigin(req, { requireOrigin = true, allowedOrigin = '' } = {}) {
  const origin = req.headers?.origin;
  if (!origin) {
    if (requireOrigin) throw new HttpError(403, 'ORIGIN_REQUIRED', '生成请求必须带有同源 Origin。');
    return;
  }
  let parsed;
  try { parsed = new URL(origin); } catch { throw new HttpError(403, 'CROSS_ORIGIN_FORBIDDEN', '仅允许同源请求。'); }
  if (allowedOrigin && origin !== allowedOrigin) {
    throw new HttpError(403, 'CROSS_ORIGIN_FORBIDDEN', '仅允许配置的应用来源发起请求。');
  }
  const host = req.headers?.host;
  if (!host || parsed.host !== host || !['http:', 'https:'].includes(parsed.protocol)) {
    throw new HttpError(403, 'CROSS_ORIGIN_FORBIDDEN', '仅允许同源请求。');
  }
}

function assertGenerationAccess(req, ctx) {
  assertSameOrigin(req, ctx);
  if (!ctx.requireGenerationAuth) return;
  const authorization = String(req.headers?.authorization || '');
  const expected = `Bearer ${ctx.generationAuthToken}`;
  const actualBytes = Buffer.from(authorization);
  const expectedBytes = Buffer.from(expected);
  if (!ctx.generationAuthToken || actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    throw new HttpError(401, 'GENERATION_AUTH_REQUIRED', '生成请求需要有效的访问凭证。');
  }
}

function assertModelConfigured(ctx) {
  const configured = ctx.service.modelConfigured ?? ctx.model.configured;
  if (!configured) throw new ModelNotConfiguredError();
}

class GenerationGuard {
  #windowMs;
  #maxPerWindow;
  #maxRequests;
  #now;
  #total = 0;
  #reserved = 0;
  #clients = new Map();

  constructor({ windowMs, maxPerWindow, maxRequests, now = () => Date.now() } = {}) {
    if (![windowMs, maxPerWindow, maxRequests].every((value) => Number.isSafeInteger(value) && value > 0)) {
      throw new TypeError('generation limits must be positive integers.');
    }
    this.#windowMs = windowMs;
    this.#maxPerWindow = maxPerWindow;
    this.#maxRequests = maxRequests;
    this.#now = now;
  }

  reserve(req) {
    const current = this.#now();
    this.#prune(current);
    if (this.#total + this.#reserved >= this.#maxRequests) {
      throw new HttpError(429, 'GENERATION_BUDGET_EXCEEDED', '本服务的累计 AI 生成额度已用尽，请稍后由维护者重置或提高上限。');
    }
    const key = `${req.socket?.remoteAddress || 'unknown'}|${req.headers?.origin || 'no-origin'}`;
    const previous = this.#clients.get(key);
    const state = !previous || current - previous.windowStart >= this.#windowMs
      ? { windowStart: current, count: 0 }
      : previous;
    if (state.count >= this.#maxPerWindow) {
      const retryAfter = Math.max(1, Math.ceil((state.windowStart + this.#windowMs - current) / 1000));
      throw new HttpError(429, 'GENERATION_RATE_LIMITED', '请求过于频繁，请稍后再试。', { retryAfter });
    }
    state.count += 1;
    this.#clients.set(key, state);
    this.#reserved += 1;
    let settled = false;
    return {
      commit: () => {
        if (settled) return;
        settled = true;
        this.#reserved -= 1;
        this.#total += 1;
      },
      release: () => {
        if (settled) return;
        settled = true;
        this.#reserved -= 1;
        state.count = Math.max(0, state.count - 1);
        if (state.count === 0) this.#clients.delete(key);
      },
    };
  }

  #prune(current) {
    for (const [clientKey, clientState] of this.#clients) {
      if (current - clientState.windowStart >= this.#windowMs * 2) this.#clients.delete(clientKey);
    }
  }
}

function assertJsonContentType(req) {
  const type = String(req.headers?.['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', '请使用 application/json 请求体。');
}

async function readJsonBody(req, maxBytes, timeoutMs) {
  const contentLength = Number.parseInt(req.headers?.['content-length'] || '', 10);
  if (Number.isSafeInteger(contentLength) && contentLength > maxBytes) {
    throw new HttpError(413, 'REQUEST_TOO_LARGE', '请求体过大，请缩短输入后重试。');
  }
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      req.destroy?.();
      reject(new HttpError(408, 'REQUEST_TIMEOUT', '读取请求超时，请稍后重试。'));
    }, timeoutMs);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      total += Buffer.byteLength(chunk);
      if (total > maxBytes) finish(new HttpError(413, 'REQUEST_TOO_LARGE', '请求体过大，请缩短输入后重试。'));
      else chunks.push(Buffer.from(chunk));
    });
    req.on('end', () => {
      if (settled) return;
      let value;
      try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch (error) { finish(new HttpError(400, 'INVALID_JSON_BODY', '请求体不是有效 JSON。', error)); return; }
      finish(null, value);
    });
    req.on('error', (error) => finish(new HttpError(400, 'REQUEST_READ_ERROR', '请求体读取失败。', error)));
    req.on('aborted', () => finish(new HttpError(400, 'REQUEST_ABORTED', '请求已中止。')));
  });
}

class HttpError extends Error {
  constructor(status, code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.status = status;
    this.code = code;
  }
}

function normalizeError(error) {
  if (error instanceof HttpError) return error;
  if (error instanceof ContentStoreError || error instanceof LearningServiceError || error instanceof ModelClientError) return error;
  return new HttpError(error?.status >= 400 && error.status < 600 ? error.status : 502, error?.code || 'INTERNAL_ERROR', '服务暂时不可用，请稍后重试。', error);
}

function sendError(res, error) {
  const headers = {};
  if (error.code === 'GENERATION_RATE_LIMITED' && Number.isSafeInteger(error.cause?.retryAfter)) {
    headers['Retry-After'] = String(error.cause.retryAfter);
  }
  sendJson(res, error.status || 500, { error: { code: error.code || 'INTERNAL_ERROR', message: error.message || '服务暂时不可用，请稍后重试。' } }, headers);
}

function sendJson(res, status, value, extraHeaders = {}) {
  if (res.headersSent) return;
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extraHeaders });
  res.end(body);
}

function envInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function envBoolean(name, fallback) {
  const value = String(process.env[name] || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return fallback;
}

export function startServer(options = {}) {
  const app = createApp(options);
  const server = app.createServer();
  const host = options.host || process.env.HOST || '127.0.0.1';
  const port = options.port || envInteger('PORT', 3000);
  server.listen(port, host);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startServer();
}
