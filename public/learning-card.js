const WINDOWS_RESERVED = /[<>:"/\\|?*\u0000-\u001f]/g;

function text(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    .replace(/([\\`*_{}\[\]()#+.!|~])/g, '\\$1');
}

function nonEmpty(value) { return String(value ?? '').trim(); }

function html(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeUrl(value) {
  const url = nonEmpty(value);
  if (!/^https:\/\/[^\s<>"']+$/i.test(url)) return text(url);
  return `<${html(url)}>`;
}

function safeFilePart(value) {
  const cleaned = String(value ?? '').replace(WINDOWS_RESERVED, '').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim();
  return (cleaned || '学习卡').slice(0, 80);
}

function assertInput(article, result) {
  if (!article || !nonEmpty(article.workId)) throw new TypeError('缺少文章 workId');
  if (!result || !nonEmpty(result.workId)) throw new TypeError('缺少结果 workId');
  if (String(article.workId) !== String(result.workId)) throw new Error(`文章与结果 workId 不匹配：${article.workId} !== ${result.workId}`);
  if (result.source?.workId != null && String(result.source.workId) !== String(article.workId)) throw new Error('结果来源与文章 workId 不匹配');
  if (!['direct', 'reflect'].includes(result.mode)) throw new TypeError('结果 mode 必须是 direct 或 reflect');
}

function citationIndex(result) {
  const map = new Map();
  (Array.isArray(result.citations) ? result.citations : []).forEach((citation, index) => {
    if (!citation?.id) throw new Error('引用缺少 id');
    if (map.has(String(citation.id))) throw new Error(`引用 id 重复：${citation.id}`);
    map.set(String(citation.id), { citation, number: index + 1 });
  });
  return map;
}

function citationRefs(ids, index) {
  if (!Array.isArray(ids) || !ids.length) return '';
  return ids.map((id) => {
    const entry = index.get(String(id));
    if (!entry) throw new Error(`观点引用不存在：${id}`);
    return ` [${entry.number}]`;
  }).join('');
}

function section(title, items, index) {
  if (!Array.isArray(items) || !items.length) return '';
  const lines = items.filter(Boolean).map((item) => `- ${text(item.text)}${citationRefs(item.citationIds, index)}`);
  return lines.length ? `## ${title}\n${lines.join('\n')}\n\n` : '';
}

function actionLines(label, action) {
  if (!action) return '';
  const task = nonEmpty(action.task), completion = nonEmpty(action.completion), review = nonEmpty(action.review);
  if (!task && !completion && !review) return '';
  return `## ${label}\n- 行动：${text(task || '未提供')}\n- 完成标志：${text(completion || '未提供')}\n${review ? `- 回顾安排：${text(review)}\n` : ''}\n`;
}

function followUpSections(followUps, articleWorkId) {
  if (!Array.isArray(followUps) || !followUps.length) return '';
  const turns = followUps.map((turn, turnIndex) => {
    if (String(turn?.workId) !== String(articleWorkId)) throw new Error(`追问与文章 workId 不匹配：${turn?.workId} !== ${articleWorkId}`);
    const index = citationIndex(turn);
    const statements = Array.isArray(turn.statements) ? turn.statements : [];
    if (!nonEmpty(turn.question) || !statements.length) throw new Error(`第 ${turnIndex + 1} 条追问不完整`);
    const answer = statements.map((statement) => `  - ${text(statement.text)}${citationRefs(statement.citationIds, index)}`).join('\n');
    const citations = turn.citations.map((citation, citationIndexValue) => `  - [${citationIndexValue + 1}]（段落：${text(citation.paragraphId || '未提供')}）${text(citation.quote)}`).join('\n');
    return `- 问：${text(turn.question)}\n${answer}\n${citations}`;
  });
  return `## 继续追问记录\n${turns.join('\n')}\n\n`;
}

export function buildLearningCard({ article, result, reflection = '', revision = '', followUps = [], task, completion, review } = {}) {
  assertInput(article, result);
  const index = citationIndex(result);
  const source = result.source ?? article;
  const modeLabel = result.mode === 'reflect' ? '用户复述后 AI 核对' : 'AI 直接讲解';
  if (!nonEmpty(result.generatedAt)) throw new TypeError('缺少结果生成时间');
  const header = [`# ${text(article.title || '学习卡')}`, '', `- 来源作者：${text(source.author || article.author || '未知')}`,
    `- work_id：${text(article.workId)}`, `- 来源：${safeUrl(source.url || article.sourceUrl || '')}`,
    `- 内容类型：${source.contentMode === 'demo' ? '项目原创开发演示材料（非知乎正式内容）' : source.contentMode === 'sample' ? '本机历史样本' : '知乎赛事内容（基于当前可读片段）'}`,
    `- 生成方式：${text(modeLabel)}`, `- 生成时间：${text(result.generatedAt)}`,
    '- 内容完整性：未知（基于当前可读片段）', ''].join('\n');
  const body = [section('核心观点', result.summary, index), section('适用条件', result.conditions, index), section('AI 的批判性提醒', result.cautions, index)];
  body.splice(1, 0, section('作者的论证步骤', result.logic, index));
  if (Array.isArray(result.examples) && result.examples.length) {
    body.push(`## AI 构造的具体场景\n${result.examples.map((example) => `- 情境：${text(example.situation)}\n  - 用法：${text(example.application)}`).join('\n')}\n\n`);
  }
  if (Array.isArray(result.questions) && result.questions.length) {
    body.push(`## AI 建议的继续追问\n${result.questions.map((question) => `- ${text(question)}`).join('\n')}\n\n`);
  }
  body.push(followUpSections(followUps, article.workId));
  if (result.mode === 'reflect') {
    if (nonEmpty(reflection)) body.push(`## 用户原始复述\n${text(reflection)}\n\n`);
    if (nonEmpty(revision)) body.push(`## 用户未重新核对的修订\n${text(revision)}\n\n`);
    body.push(section('AI 核对反馈', result.feedback, index));
  } else body.push(section('AI 反馈', result.feedback, index));
  if (Array.isArray(result.citations) && result.citations.length) body.push(`## 原文依据\n${result.citations.map((c, i) => `- [${i + 1}]（引用 ID：${text(c.id)}；段落：${text(c.paragraphId || '未提供')}）${text(c.quote)}`).join('\n')}\n\n`);
  const aiAction = result.action;
  body.push(actionLines('AI 行动建议（待尝试）', aiAction));
  const edited = { task, completion, review };
  const hasEdited = ['task', 'completion', 'review'].some((key) => nonEmpty(edited[key]) && nonEmpty(edited[key]) !== nonEmpty(aiAction?.[key]));
  if (hasEdited) body.push(actionLines('用户编辑的行动建议（待尝试）', edited));
  body.push('> “待尝试”不表示行动已经完成；卡片保留 AI 生成标识。\n');
  return header + '\n' + body.join('');
}

export function downloadLearningCard(args = {}) {
  const markdown = buildLearningCard(args);
  const filename = `知行小课-${safeFilePart(args.article.title)}.md`;
  if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof document === 'undefined') return filename;
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}
