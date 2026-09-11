import { downloadLearningCard } from './learning-card.js';

const $ = (id) => document.getElementById(id);
const state = {
  items: [], selectedId: null, article: null, drafts: new Map(),
  detailController: null, generationController: null, selectionVersion: 0,
  generationVersion: 0, loading: false, expanded: false, retry: null,
};
const ui = {
  status: $('api-status'), picker: $('article-picker'), list: $('article-list'), search: $('article-search'),
  title: $('article-title'), meta: $('source-meta'), content: $('article-content'), range: $('content-range'),
  direct: $('direct-tab'), reflect: $('reflect-tab'), directPanel: $('direct-panel'), reflectPanel: $('reflect-panel'),
  result: $('result-panel'), resultBody: $('result-body'), reflection: $('reflection'), revision: $('revision'),
  task: $('action-task'), completion: $('action-completion'), review: $('action-review'),
  error: $('error-panel'), generate: $('direct-generate'), check: $('reflect-generate'), regenerate: $('regenerate'),
  progress: $('generation-progress'), expand: $('expand-source'), note: $('session-note'),
};

function draft() {
  if (!state.selectedId) return null;
  if (!state.drafts.has(state.selectedId)) state.drafts.set(state.selectedId, { mode: 'direct', reflection: '', direct: null, reflect: null });
  return state.drafts.get(state.selectedId);
}
function entry() { const d = draft(); return d ? d[d.mode] : null; }
function setStatus(message, kind = '') { ui.status.textContent = message; ui.status.className = `status-dot ${kind}`; }
function clearError() { ui.error.hidden = true; state.retry = null; }
function showError(title, message, retry = null) {
  $('error-title').textContent = title;
  $('error-message').textContent = message;
  ui.error.hidden = false;
  state.retry = retry;
  $('retry').hidden = !retry;
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  let body;
  try { body = await response.json(); } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('服务返回的内容无法读取，请稍后重试。');
  }
  if (!response.ok) throw new Error(body?.error?.message || `暂时无法完成请求（${response.status}），请稍后重试。`);
  return body;
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function renderPicker() {
  const query = ui.search.value.trim().toLocaleLowerCase();
  const matches = state.items.filter((item) => `${item.title} ${item.description || ''}`.toLocaleLowerCase().includes(query));
  ui.list.replaceChildren();
  if (!matches.length) ui.list.append(element('p', '没有匹配内容，换个词试试。', 'muted-note'));
  for (const item of matches) {
    const button = element('button', undefined, 'article-choice');
    button.type = 'button';
    button.dataset.workId = item.work_id;
    button.setAttribute('aria-pressed', String(item.work_id === state.selectedId));
    button.append(element('strong', item.title || '未命名内容'));
    const description = item.description || '知乎知识内容';
    button.append(element('small', description.length > 95 ? `${description.slice(0, 95)}…` : description));
    button.addEventListener('click', () => { ui.picker.close(); selectArticle(item.work_id); });
    ui.list.append(button);
  }
}

async function loadList() {
  clearError();
  setStatus('正在读取内容');
  ui.generate.disabled = ui.check.disabled = true;
  try {
    const body = await api('/api/knowledge');
    state.items = Array.isArray(body.items) ? body.items : [];
    renderPicker();
    if (!state.items.length) {
      ui.title.textContent = '当前没有可读内容';
      ui.content.replaceChildren(element('p', '内容库暂时为空，可以稍后重试。'));
      ui.meta.textContent = '等待内容更新';
      ui.range.textContent = '';
      showError('内容库暂时为空', '还没有可供阅读的内容，请稍后再试。', loadList);
      setStatus('暂无内容');
      return;
    }
    // Prefer the documented example only when it is present in the actual list.
    const preferred = state.items.find((item) => item.title?.includes('小胜')) || state.items[0];
    await selectArticle(preferred.work_id);
  } catch (error) {
    setStatus('内容暂不可用', 'error');
    ui.title.textContent = '内容还没有加载出来';
    ui.meta.textContent = '可以稍后重试';
    ui.content.replaceChildren(element('p', '当前无法读取知乎知识内容。'));
    ui.range.textContent = '';
    showError('暂时无法读取内容', error.message, loadList);
  }
}

function cancelGeneration(notify = false) {
  const wasLoading = state.loading;
  state.generationVersion += 1;
  state.generationController?.abort();
  state.generationController = null;
  state.loading = false;
  ui.progress.hidden = true;
  if (notify && wasLoading) {
    setStatus('已取消等待');
    ui.note.textContent = '已取消本次等待，原有输入和学习卡仍保留。';
  }
}

async function selectArticle(workId) {
  const previous = state.selectedId;
  const version = ++state.selectionVersion;
  state.detailController?.abort();
  const controller = new AbortController();
  state.detailController = controller;
  cancelGeneration();
  state.selectedId = workId;
  state.article = null;
  state.expanded = false;
  clearError();
  ui.title.textContent = '正在打开内容…';
  ui.meta.textContent = '读取中';
  ui.range.textContent = '';
  ui.content.replaceChildren(element('p', '正在读取正文片段', 'loading-line'));
  ui.expand.hidden = true;
  renderMode();
  if (previous && previous !== workId) ui.note.textContent = '上一篇的输入和结果已保留，切回即可继续。刷新页面会清空草稿。';
  try {
    const article = await api(`/api/knowledge/${encodeURIComponent(workId)}`, { signal: controller.signal });
    if (version !== state.selectionVersion) return;
    if (article.workId !== workId) throw new Error('收到的内容与所选文章不一致，请重新打开。');
    state.article = article;
    ui.title.textContent = article.title || '未命名内容';
    ui.meta.textContent = `${article.author || '作者未提供'} · 知乎知识`;
    ui.range.textContent = article.contentMode === 'sample' ? '本机历史样本' : '当前可读片段';
    $('completeness-note').textContent = '正文可能不完整';
    renderSource();
    renderMode();
    setStatus(article.contentMode === 'sample' ? '正在阅读历史样本' : '内容已就绪', 'ready');
    if (!article.paragraphs?.length) showError('这篇内容暂时没有正文', '可以换一篇内容继续阅读。');
  } catch (error) {
    if (version !== state.selectionVersion || error.name === 'AbortError') return;
    ui.title.textContent = '这篇内容暂时打不开';
    ui.meta.textContent = '读取失败';
    ui.content.replaceChildren(element('p', '请重试，或通过“换一篇内容”选择其他文章。'));
    setStatus('内容读取失败', 'error');
    showError('这篇内容暂时打不开', error.message, () => selectArticle(workId));
  }
}

function renderSource(highlight = null) {
  const paragraphs = state.article?.paragraphs || [];
  ui.content.replaceChildren();
  const visible = state.expanded ? paragraphs : paragraphs.slice(0, 4);
  for (const paragraph of visible) {
    const p = element('p');
    p.dataset.paragraphId = paragraph.id;
    if (highlight?.paragraphId === paragraph.id && paragraph.text.includes(highlight.quote)) {
      const at = paragraph.text.indexOf(highlight.quote);
      p.append(document.createTextNode(paragraph.text.slice(0, at)), element('mark', highlight.quote), document.createTextNode(paragraph.text.slice(at + highlight.quote.length)));
    } else p.textContent = paragraph.text;
    ui.content.append(p);
  }
  if (!paragraphs.length) ui.content.append(element('p', '当前没有可读正文。'));
  ui.expand.hidden = paragraphs.length <= 4;
  ui.expand.textContent = state.expanded ? '收起正文片段' : '展开全部可读片段';
  ui.expand.setAttribute('aria-expanded', String(state.expanded));
}

function highlightCitation(citationId) {
  const citation = entry()?.data.citations.find((item) => item.id === citationId);
  if (!citation) return;
  state.expanded = true;
  renderSource(citation);
  const paragraph = Array.from(ui.content.children).find((p) => p.dataset.paragraphId === citation.paragraphId);
  paragraph?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
  ui.note.textContent = `已定位原文依据：${citation.quote}`;
}

function switchMode(mode) {
  if (!draft()) return;
  cancelGeneration();
  draft().mode = mode;
  clearError();
  renderMode();
}

function renderMode() {
  const d = draft();
  const direct = !d || d.mode === 'direct';
  const current = state.article ? entry() : null;
  ui.direct.classList.toggle('active', direct);
  ui.reflect.classList.toggle('active', !direct);
  ui.direct.setAttribute('aria-pressed', String(direct));
  ui.reflect.setAttribute('aria-pressed', String(!direct));
  ui.directPanel.hidden = !direct || Boolean(current);
  ui.reflectPanel.hidden = direct;
  ui.result.hidden = !current;
  ui.reflection.value = d?.reflection || '';
  $('mode-label').textContent = direct ? '直接 AI' : '自行复述';
  if (current) renderResult(current);
  updateControls();
}

function updateControls() {
  const disabled = state.loading || !state.article?.paragraphs?.length;
  ui.generate.disabled = ui.check.disabled = ui.regenerate.disabled = disabled;
  ui.generate.textContent = state.loading ? '正在阅读…' : 'AI 帮我读懂';
  ui.check.textContent = state.loading ? '正在核对…' : '帮我核对';
  ui.progress.hidden = !state.loading;
  ui.progress.setAttribute('aria-busy', String(state.loading));
  const current = entry();
  $('reflection-changed').hidden = !current || draft()?.mode !== 'reflect' || draft().reflection.trim() === current.reflection;
}

function renderStatements(title, statements, feedback = false) {
  if (!statements?.length) return;
  const section = element('section', undefined, 'result-section');
  section.append(element('h4', title));
  const kinds = { accurate: '理解到位', missing: '可以补充', overreach: '超出依据', uncertain: '仍需辨别' };
  for (const statement of statements) {
    const p = element('p', undefined, 'statement');
    if (feedback) p.append(element('span', kinds[statement.kind] || '反馈', `feedback-label ${statement.kind}`));
    p.append(document.createTextNode(statement.text));
    for (const id of statement.citationIds || []) {
      const citation = entry().data.citations.find((item) => item.id === id);
      if (!citation) continue;
      const number = entry().data.citations.indexOf(citation) + 1;
      const button = element('button', `依据 ${number}`, 'citation');
      button.type = 'button';
      button.setAttribute('aria-label', `查看原文依据 ${number}：${citation.quote}`);
      button.addEventListener('click', () => highlightCitation(id));
      p.append(button);
    }
    section.append(p);
  }
  ui.resultBody.append(section);
}

function renderResult(current) {
  const result = current.data;
  const reflect = result.mode === 'reflect';
  $('result-eyebrow').textContent = reflect ? 'AI 核对 · 对照当前原文' : 'AI 讲解 · 对照当前原文';
  $('result-title').textContent = reflect ? '把你的理解与原文对照' : '先抓住这段内容的重点';
  ui.regenerate.hidden = reflect;
  ui.resultBody.replaceChildren();
  if (reflect) {
    const original = element('details', undefined, 'original-reflection');
    original.append(element('summary', '本次提交的复述'), element('p', current.reflection));
    ui.resultBody.append(original);
  }
  renderStatements('核心观点', result.summary);
  renderStatements('适用条件', result.conditions);
  renderStatements('需要留意', result.cautions);
  renderStatements('给你的反馈', result.feedback, true);
  $('revision-panel').hidden = !reflect;
  ui.revision.value = current.revision;
  ui.task.value = current.task;
  ui.completion.value = current.completion;
  ui.review.value = current.review;
  $('generation-note').textContent = 'AI 生成，可直接导出，也可修改后再带走。';
}

async function generate() {
  if (!state.article || state.loading || !state.article.paragraphs?.length) return;
  const d = draft();
  const workId = state.article.workId;
  const mode = d.mode;
  const reflection = mode === 'reflect' ? d.reflection.trim() : '';
  if (mode === 'reflect' && !reflection) {
    showError('先写一点你的理解', '也可以点击“AI 帮我读懂”，跳过复述直接生成。');
    ui.reflection.focus();
    return;
  }
  clearError();
  const version = ++state.generationVersion;
  const controller = new AbortController();
  state.generationController = controller;
  state.loading = true;
  updateControls();
  setStatus('正在整理讲解');
  try {
    const data = await api('/api/learn', {
      method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workId, mode, ...(mode === 'reflect' ? { reflection } : {}) }),
    });
    if (version !== state.generationVersion || workId !== state.selectedId || mode !== draft()?.mode) return;
    if (data.workId !== workId || data.mode !== mode) throw new Error('返回结果与当前内容不一致，请重新生成。');
    d[mode] = { data, reflection, revision: '', task: data.action.task, completion: data.action.completion, review: data.action.review || '' };
    renderMode();
    setStatus('讲解已生成', 'ready');
  } catch (error) {
    if (version !== state.generationVersion || error.name === 'AbortError') return;
    showError('这次生成没有完成', error.message, generate);
    setStatus('生成未完成', 'error');
  } finally {
    if (version === state.generationVersion) {
      state.loading = false;
      state.generationController = null;
      updateControls();
    }
  }
}

ui.direct.addEventListener('click', () => switchMode('direct'));
ui.reflect.addEventListener('click', () => switchMode('reflect'));
ui.reflection.addEventListener('input', () => { if (draft()) draft().reflection = ui.reflection.value; updateControls(); });
for (const [input, field] of [[ui.revision, 'revision'], [ui.task, 'task'], [ui.completion, 'completion'], [ui.review, 'review']]) {
  input.addEventListener('input', () => { if (entry()) entry()[field] = input.value; });
}
for (const button of [ui.generate, ui.check, ui.regenerate]) button.addEventListener('click', generate);
$('cancel-generation').addEventListener('click', () => { cancelGeneration(true); updateControls(); });
$('export-card').addEventListener('click', () => {
  const current = entry();
  if (!state.article || !current) return;
  if (!current.task.trim() || !current.completion.trim()) {
    showError('行动卡还缺一点内容', '请保留行动和完成标志，再导出学习卡。');
    (!current.task.trim() ? ui.task : ui.completion).focus();
    return;
  }
  try {
    downloadLearningCard({ article: state.article, result: current.data, ...current });
    ui.note.textContent = '学习卡已导出。行动仍标为待尝试，可以按自己的情况修改。';
    clearError();
  } catch (error) { showError('学习卡暂时无法导出', error.message); }
});
ui.expand.addEventListener('click', () => { state.expanded = !state.expanded; renderSource(); });
$('change-article').addEventListener('click', () => { renderPicker(); ui.picker.showModal(); ui.search.focus(); });
$('close-picker').addEventListener('click', () => ui.picker.close());
ui.picker.addEventListener('click', (event) => {
  if (event.target !== ui.picker) return;
  const r = ui.picker.getBoundingClientRect();
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) ui.picker.close();
});
ui.search.addEventListener('input', renderPicker);
$('retry').addEventListener('click', () => { const retry = state.retry; if (retry) retry(); });
renderMode();
loadList();
