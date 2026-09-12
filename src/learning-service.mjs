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
        generationMode: this.#modelClient.runtimeMode === 'demo' ? 'demo' : 'live',
        generatedAt: new Date().toISOString(),
        source: {
          workId: article.workId,
          title: article.title,
          author: article.author,
          url: article.sourceUrl,
          contentMode: article.contentMode || 'live',
          completeness: 'unknown',
        },
        summary: generated.summary,
        logic: generated.logic,
        conditions: generated.conditions,
        cautions: generated.cautions,
        examples: generated.examples,
        questions: generated.questions,
        feedback: mode === 'direct' ? [] : generated.feedback,
        citations: generated.citations,
        action: generated.action,
        challenge: generated.challenge,
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

  async followUp({ workId, question, signal } = {}) {
    const normalizedQuestion = typeof question === 'string' ? question.trim() : '';
    if (!normalizedQuestion) {
      throw new LearningServiceError('追问内容不能为空。', { code: 'QUESTION_REQUIRED', status: 400 });
    }
    if (normalizedQuestion.length > 1000) {
      throw new LearningServiceError('追问内容过长，请缩短到 1000 字以内。', { code: 'QUESTION_TOO_LONG', status: 400 });
    }
    if (!this.#modelClient.configured) throw new ModelNotConfiguredError();
    if (typeof this.#modelClient.followUp !== 'function') {
      throw new LearningServiceError('当前模型不支持继续追问。', { code: 'FOLLOW_UP_UNAVAILABLE', status: 503 });
    }
    if (this.#active >= this.#maxConcurrent) throw new GenerationBusyError();
    this.#active += 1;
    try {
      if (signal?.aborted) throw new LearningServiceError('追问请求已取消。', { code: 'GENERATION_CANCELLED', status: 499 });
      const article = await this.#contentStore.detail(workId);
      if (signal?.aborted) throw new LearningServiceError('追问请求已取消。', { code: 'GENERATION_CANCELLED', status: 499 });
      const generated = await this.#modelClient.followUp({ article, question: normalizedQuestion, signal });
      return Object.freeze({
        workId: article.workId,
        question: normalizedQuestion,
        statements: generated.statements,
        citations: generated.citations,
        generationMode: this.#modelClient.runtimeMode === 'demo' ? 'demo' : 'live',
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof LearningServiceError || error instanceof ModelClientError) throw error;
      throw new LearningServiceError('追问没有完成，请稍后手动重试。', {
        code: error?.code || 'FOLLOW_UP_ERROR', status: error?.status || 502, cause: error,
      });
    } finally {
      this.#active -= 1;
    }
  }

  async checkChallenge({ workId, question, answer, signal } = {}) {
    const normalizedQuestion = typeof question === 'string' ? question.trim() : '';
    const normalizedAnswer = typeof answer === 'string' ? answer.trim() : '';
    if (!normalizedQuestion) throw new LearningServiceError('挑战问题不能为空。', { code: 'CHALLENGE_REQUIRED', status: 400 });
    if (normalizedQuestion.length > 500) throw new LearningServiceError('挑战问题过长，请缩短到 500 字以内。', { code: 'CHALLENGE_TOO_LONG', status: 400 });
    if (!normalizedAnswer) throw new LearningServiceError('请先写下你的挑战回答。', { code: 'CHALLENGE_ANSWER_REQUIRED', status: 400 });
    if (normalizedAnswer.length > 2000) throw new LearningServiceError('挑战回答过长，请缩短到 2000 字以内。', { code: 'CHALLENGE_ANSWER_TOO_LONG', status: 400 });
    if (!this.#modelClient.configured) throw new ModelNotConfiguredError();
    if (typeof this.#modelClient.checkChallenge !== 'function') throw new LearningServiceError('当前模型不支持理解挑战。', { code: 'CHALLENGE_UNAVAILABLE', status: 503 });
    return this.#runBoundGeneration(signal, async (article) => {
      const generated = await this.#modelClient.checkChallenge({ article, question: normalizedQuestion, answer: normalizedAnswer, signal });
      return { workId: article.workId, question: normalizedQuestion, answer: normalizedAnswer, ...generated, generationMode: this.#modelClient.runtimeMode === 'demo' ? 'demo' : 'live', generatedAt: new Date().toISOString() };
    }, workId, '理解挑战');
  }

  async personalizeAction({ workId, scenario, signal } = {}) {
    const normalizedScenario = typeof scenario === 'string' ? scenario.trim() : '';
    if (!normalizedScenario) throw new LearningServiceError('请先写下你想应用的场景。', { code: 'SCENARIO_REQUIRED', status: 400 });
    if (normalizedScenario.length > 1000) throw new LearningServiceError('使用场景过长，请缩短到 1000 字以内。', { code: 'SCENARIO_TOO_LONG', status: 400 });
    if (!this.#modelClient.configured) throw new ModelNotConfiguredError();
    if (typeof this.#modelClient.personalizeAction !== 'function') throw new LearningServiceError('当前模型不支持场景化行动。', { code: 'PERSONALIZE_UNAVAILABLE', status: 503 });
    return this.#runBoundGeneration(signal, async (article) => {
      const action = await this.#modelClient.personalizeAction({ article, scenario: normalizedScenario, signal });
      return { workId: article.workId, scenario: normalizedScenario, action, generationMode: this.#modelClient.runtimeMode === 'demo' ? 'demo' : 'live', generatedAt: new Date().toISOString() };
    }, workId, '场景化行动');
  }

  async #runBoundGeneration(signal, run, workId, label) {
    if (this.#active >= this.#maxConcurrent) throw new GenerationBusyError();
    this.#active += 1;
    try {
      if (signal?.aborted) throw new LearningServiceError(`${label}请求已取消。`, { code: 'GENERATION_CANCELLED', status: 499 });
      const article = await this.#contentStore.detail(workId);
      if (signal?.aborted) throw new LearningServiceError(`${label}请求已取消。`, { code: 'GENERATION_CANCELLED', status: 499 });
      return Object.freeze(await run(article));
    } catch (error) {
      if (error instanceof LearningServiceError || error instanceof ModelClientError) throw error;
      throw new LearningServiceError(`${label}没有完成，请稍后手动重试。`, { code: error?.code || 'GENERATION_ERROR', status: error?.status || 502, cause: error });
    } finally { this.#active -= 1; }
  }
}

export function createLearningService(options) {
  return new LearningService(options);
}
