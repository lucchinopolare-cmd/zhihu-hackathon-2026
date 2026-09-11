import { ModelClientError, ModelNotConfiguredError } from './model-client.mjs';

export class LearningServiceError extends Error {
  constructor(message, { code = 'LEARNING_ERROR', status = 500, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
  }
}

export class GenerationBusyError extends LearningServiceError {
  constructor() {
    super('当前生成请求较多，请稍后再试。', { code: 'GENERATION_BUSY', status: 429 });
  }
}

/** Coordinates content retrieval, model generation and the public learning DTO. */
export class LearningService {
  #contentStore;
  #modelClient;
  #maxConcurrent;
  #active = 0;

  constructor({ contentStore, modelClient, maxConcurrent = 2 } = {}) {
    if (!contentStore || typeof contentStore.detail !== 'function') throw new TypeError('contentStore is required.');
    if (!modelClient || typeof modelClient.generate !== 'function') throw new TypeError('modelClient is required.');
    if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent <= 0) throw new TypeError('maxConcurrent must be positive.');
    this.#contentStore = contentStore;
    this.#modelClient = modelClient;
    this.#maxConcurrent = maxConcurrent;
  }

  get modelConfigured() {
    return Boolean(this.#modelClient.configured);
  }

  async learn({ workId, mode, reflection, signal } = {}) {
    if (mode !== 'direct' && mode !== 'reflect') {
      throw new LearningServiceError('mode 必须是 direct 或 reflect。', { code: 'INVALID_MODE', status: 400 });
    }
    if (mode === 'reflect' && (typeof reflection !== 'string' || reflection.trim() === '')) {
      throw new LearningServiceError('reflect 模式需要填写非空复述。', { code: 'REFLECTION_REQUIRED', status: 400 });
    }
    if (!this.#modelClient.configured) throw new ModelNotConfiguredError();
    if (this.#active >= this.#maxConcurrent) throw new GenerationBusyError();
    this.#active += 1;
    try {
      if (signal?.aborted) throw new LearningServiceError('生成请求已取消。', { code: 'GENERATION_CANCELLED', status: 499 });
      const article = await this.#contentStore.detail(workId);
      if (signal?.aborted) throw new LearningServiceError('生成请求已取消。', { code: 'GENERATION_CANCELLED', status: 499 });
      const generated = await this.#modelClient.generate({
        article,
        mode,
        reflection: mode === 'reflect' ? reflection.trim() : undefined,
        signal,
      });
      const result = {
        workId: article.workId,
        mode,
        generatedAt: new Date().toISOString(),
        source: {
          workId: article.workId,
          title: article.title,
          author: article.author,
          url: article.sourceUrl,
          completeness: 'unknown',
        },
        summary: generated.summary,
        conditions: generated.conditions,
        cautions: generated.cautions,
        feedback: mode === 'direct' ? [] : generated.feedback,
        citations: generated.citations,
        action: generated.action,
      };
      if (!result.summary.length || !result.action.task || !result.action.completion) {
        throw new LearningServiceError('模型结果不完整，未向用户展示。', { code: 'MODEL_INVALID_RESPONSE', status: 502 });
      }
      return Object.freeze(result);
    } catch (error) {
      if (error instanceof LearningServiceError || error instanceof ModelClientError) throw error;
      const status = error?.status || (error?.code === 'MODEL_NOT_CONFIGURED' ? 503 : 502);
      throw new LearningServiceError('生成学习结果失败，请稍后手动重试。', { code: error?.code || 'LEARNING_ERROR', status, cause: error });
    } finally {
      this.#active -= 1;
    }
  }
}

export function createLearningService(options) {
  return new LearningService(options);
}
