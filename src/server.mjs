import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ContentStore, ContentStoreError } from './content-store.mjs';
import { ResponsesModelClient, ModelClientError, MODEL_DEFAULTS } from './model-client.mjs';
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

  const handler = async (req, res) => {
    try {
      await route(req, res, { store, model, service, safePublicDir, maxRequestBytes, bodyTimeoutMs });
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
    assertSameOrigin(req);
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
    } finally {
      req.off('aborted', onClose);
      res.off('close', onClose);
    }
    sendJson(res, 200, result);
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
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(body);
}

function assertSameOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return;
  let parsed;
  try { parsed = new URL(origin); } catch { throw new HttpError(403, 'CROSS_ORIGIN_FORBIDDEN', '仅允许同源请求。'); }
  const host = req.headers?.host;
  if (!host || parsed.host !== host || !['http:', 'https:'].includes(parsed.protocol)) {
    throw new HttpError(403, 'CROSS_ORIGIN_FORBIDDEN', '仅允许同源请求。');
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
  sendJson(res, error.status || 500, { error: { code: error.code || 'INTERNAL_ERROR', message: error.message || '服务暂时不可用，请稍后重试。' } });
}

function sendJson(res, status, value) {
  if (res.headersSent) return;
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

function envInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
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
