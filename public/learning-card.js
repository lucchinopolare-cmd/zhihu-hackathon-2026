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
  const generationLabel = result.generationMode === 'demo'
    ? '开发演示预设回答（不代表赛事模型已接通）'
    : 'AI 生成';
  if (!nonEmpty(result.generatedAt)) throw new TypeError('缺少结果生成时间');
  const header = [`# ${text(article.title || '学习卡')}`, '', `- 来源作者：${text(source.author || article.author || '未知')}`,
    `- work_id：${text(article.workId)}`, `- 来源：${safeUrl(source.url || article.sourceUrl || '')}`,
    `- 内容类型：${source.contentMode === 'demo' ? '项目原创开发演示材料（非知乎正式内容）' : source.contentMode === 'sample' ? '本机历史样本' : '知乎赛事内容（基于当前可读片段）'}`,
    `- 生成方式：${text(modeLabel)}`, `- 生成来源：${text(generationLabel)}`, `- 生成时间：${text(result.generatedAt)}`,
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
  const docx = buildLearningCardDocx(args);
  const filename = `知行小课-${safeFilePart(args.article.title)}.docx`;
  if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof document === 'undefined') return filename;
  const blob = new Blob([docx], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

/**
 * Builds a small, dependency-free Word document. The package uses stored ZIP
 * entries so it can be created in the browser without a server or a bundler.
 */
export function buildLearningCardDocx(args = {}) {
  buildLearningCard(args); // Reuse the existing content validator before creating the OOXML package.
  const { article, result, reflection = '', revision = '', followUps = [], task, completion, review } = args;
  const index = citationIndex(result);
  const source = result.source ?? article;
  const modeLabel = result.mode === 'reflect' ? '用户复述后 AI 核对' : 'AI 直接讲解';
  const generationLabel = result.generationMode === 'demo'
    ? '开发演示预设回答（不代表赛事模型已接通）'
    : 'AI 生成';
  const contentType = source.contentMode === 'demo'
    ? '项目原创开发演示材料（非知乎正式内容）'
    : source.contentMode === 'sample' ? '本机历史样本' : '知乎赛事内容（基于当前可读片段）';
  const blocks = [];
  blocks.push(docTitle(article.title || '学习卡'));
  blocks.push(docSubtitle(`知行小课 · ${modeLabel}`));
  blocks.push(callout(`这张卡保留${generationLabel === 'AI 生成' ? ' AI 生成' : '开发演示'}标识和原文依据，行动建议仍是“待尝试”，不表示已经完成。`, 'EAF2FF'));
  blocks.push(metadataTable([
    ['来源作者', source.author || article.author || '未知'],
    ['work_id', article.workId],
    ['来源', source.url || article.sourceUrl || '未提供'],
    ['内容类型', contentType],
    ['生成方式', modeLabel],
    ['生成来源', generationLabel],
    ['生成时间', result.generatedAt],
    ['内容完整性', '未知（基于当前可读片段）'],
  ]));
  blocks.push(docSection('核心观点', result.summary, index));
  blocks.push(docSection('作者的论证步骤', result.logic, index));
  blocks.push(docSection('适用条件', result.conditions, index));
  blocks.push(docSection('AI 的批判性提醒', result.cautions, index));
  if (Array.isArray(result.examples) && result.examples.length) {
    blocks.push(sectionHeading('AI 构造的具体场景'));
    for (const example of result.examples) {
      blocks.push(docBullet(`情境：${example.situation}`));
      blocks.push(docBullet(`用法：${example.application}`, 1));
    }
  }
  if (Array.isArray(result.questions) && result.questions.length) {
    blocks.push(sectionHeading('AI 建议的继续追问'));
    blocks.push(...result.questions.map((question) => docBullet(question)));
  }
  if (Array.isArray(followUps) && followUps.length) {
    blocks.push(sectionHeading('继续追问记录'));
    for (const turn of followUps) {
      blocks.push(docParagraph(`问：${turn.question}`, { bold: true }));
      const turnIndex = citationIndex(turn);
      for (const statement of turn.statements || []) blocks.push(docBullet(`${statement.text}${docxCitationRefs(statement.citationIds, turnIndex)}`, 1));
      for (const [citationIndexValue, citation] of (turn.citations || []).entries()) {
        blocks.push(docQuote(`[${citationIndexValue + 1}]（段落：${citation.paragraphId || '未提供'}）${citation.quote}`));
      }
    }
  }
  if (result.mode === 'reflect') {
    if (nonEmpty(reflection)) blocks.push(sectionHeading('用户原始复述'), docQuote(reflection));
    if (nonEmpty(revision)) blocks.push(sectionHeading('用户未重新核对的修订'), docQuote(revision));
    blocks.push(docFeedbackSection('AI 核对反馈', result.feedback, index));
  }
  if (Array.isArray(result.citations) && result.citations.length) {
    blocks.push(sectionHeading('原文依据'));
    for (const [citationIndexValue, citation] of result.citations.entries()) {
      blocks.push(docQuote(`[${citationIndexValue + 1}]（引用 ID：${citation.id}；段落：${citation.paragraphId || '未提供'}）${citation.quote}`));
    }
  }
  blocks.push(sectionHeading('AI 行动建议（待尝试）'));
  blocks.push(actionTable(result.action));
  const edited = { task, completion, review };
  const hasEdited = ['task', 'completion', 'review'].some((key) => nonEmpty(edited[key]) && nonEmpty(edited[key]) !== nonEmpty(result.action?.[key]));
  if (hasEdited) {
    blocks.push(sectionHeading('用户编辑的行动建议（待尝试）'));
    blocks.push(actionTable(edited));
  }
  blocks.push(callout(`“待尝试”不表示行动已经完成；卡片保留${generationLabel === 'AI 生成' ? ' AI 生成' : '开发演示预设回答'}标识。`, 'FFF4D8'));

  const documentXml = `${XML_HEADER}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${blocks.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`;
  return zipStore([
    ['[Content_Types].xml', contentTypesXml()],
    ['_rels/.rels', rootRelsXml()],
    ['word/document.xml', documentXml],
    ['word/styles.xml', stylesXml()],
    ['word/numbering.xml', numberingXml()],
    ['word/_rels/document.xml.rels', documentRelsXml()],
    ['docProps/core.xml', corePropsXml(article.title || '学习卡')],
    ['docProps/app.xml', appPropsXml()],
  ]);
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function xml(value) {
  const valid = [...String(value ?? '')].filter((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d
      || (codePoint >= 0x20 && codePoint <= 0xd7ff)
      || (codePoint >= 0xe000 && codePoint <= 0xfffd)
      || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
  }).join('');
  return valid.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function docTitle(value) {
  return `<w:p><w:pPr><w:pStyle w:val="Title"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:color w:val="1D4ED8"/><w:b/><w:sz w:val="34"/></w:rPr><w:t>${xml(value)}</w:t></w:r></w:p>`;
}

function docSubtitle(value) {
  return `<w:p><w:pPr><w:pStyle w:val="Subtitle"/><w:jc w:val="center"/></w:pPr><w:r><w:t>${xml(value)}</w:t></w:r></w:p>`;
}

function sectionHeading(value) {
  return `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:keepNext/></w:pPr><w:r><w:t>${xml(value)}</w:t></w:r></w:p>`;
}

function docParagraph(value, { bold = false, indent = 0 } = {}) {
  const pPr = indent ? `<w:ind w:left="${indent * 360}"/>` : '';
  const rPr = bold ? '<w:b/>' : '';
  return `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${xml(value)}</w:t></w:r></w:p>`;
}

function docBullet(value, indent = 0) {
  return `<w:p><w:pPr><w:pStyle w:val="ListBullet"/><w:numPr><w:ilvl w:val="${indent}"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${xml(value)}</w:t></w:r></w:p>`;
}

function docQuote(value) {
  return `<w:p><w:pPr><w:pStyle w:val="Quote"/><w:shd w:fill="F5F7FB"/></w:pPr><w:r><w:t xml:space="preserve">${xml(value)}</w:t></w:r></w:p>`;
}

function docSection(title, items, index) {
  if (!Array.isArray(items) || !items.length) return '';
  return sectionHeading(title) + items.filter(Boolean).map((item) => docBullet(`${item.text}${docxCitationRefs(item.citationIds, index)}`)).join('');
}

function docFeedbackSection(title, items, index) {
  if (!Array.isArray(items) || !items.length) return '';
  const labels = { accurate: '理解到位', missing: '可以补充', overreach: '超出依据', uncertain: '仍需辨别' };
  return sectionHeading(title) + items.filter(Boolean).map((item) => docBullet(`【${labels[item.kind] || '反馈'}】${item.text}${docxCitationRefs(item.citationIds, index)}`)).join('');
}

function docxCitationRefs(ids, index) {
  if (!Array.isArray(ids) || !ids.length) return '';
  return ids.map((id) => {
    const entry = index.get(String(id));
    if (!entry) throw new Error(`观点引用不存在：${id}`);
    return ` [${entry.number}]`;
  }).join('');
}

function callout(value, fill) {
  return `<w:p><w:pPr><w:shd w:fill="${fill}"/><w:spacing w:before="100" w:after="100"/></w:pPr><w:r><w:rPr><w:color w:val="334155"/></w:rPr><w:t xml:space="preserve">${xml(value)}</w:t></w:r></w:p>`;
}

function metadataTable(rows) {
  const tableRows = rows.map(([label, value]) => `<w:tr><w:tc><w:tcPr><w:shd w:fill="DDE7FF"/></w:tcPr>${docParagraph(label, { bold: true })}</w:tc><w:tc>${docParagraph(value)}</w:tc></w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>${tableRows}</w:tbl><w:p/>`;
}

function actionTable(action = {}) {
  return metadataTable([
    ['行动', action.task || '未提供'],
    ['完成标志', action.completion || '未提供'],
    ...(nonEmpty(action.review) ? [['回顾安排', action.review]] : []),
  ]);
}

function contentTypesXml() {
  return `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

function rootRelsXml() {
  return `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function documentRelsXml() {
  return `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`;
}

function stylesXml() {
  return `${XML_HEADER}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="80"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="64748B"/><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="1D4ED8"/><w:sz w:val="27"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360" w:right="360"/><w:spacing w:before="80" w:after="80"/></w:pPr><w:rPr><w:color w:val="475569"/><w:i/></w:rPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style></w:styles>`;
}

function numberingXml() {
  return `${XML_HEADER}<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="○"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1080" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
}

function corePropsXml(title) {
  return `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:creator>知行小课</dc:creator><cp:lastModifiedBy>知行小课</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2026-09-11T00:00:00Z</dcterms:created></cp:coreProperties>`;
}

function appPropsXml() {
  return `${XML_HEADER}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>知行小课</Application></Properties>`;
}

function zipStore(files) {
  const encoder = new TextEncoder();
  const entries = files.map(([name, content]) => {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    return { nameBytes, data, crc: crc32(data) };
  });
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const local = new Uint8Array(30 + entry.nameBytes.length + entry.data.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true); view.setUint32(14, entry.crc, true); view.setUint32(18, entry.data.length, true); view.setUint32(22, entry.data.length, true);
    view.setUint16(26, entry.nameBytes.length, true); local.set(entry.nameBytes, 30); local.set(entry.data, 30 + entry.nameBytes.length);
    localParts.push(local);
    const central = new Uint8Array(46 + entry.nameBytes.length); const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true); centralView.setUint16(4, 20, true); centralView.setUint16(6, 20, true); centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true); centralView.setUint32(16, entry.crc, true); centralView.setUint32(20, entry.data.length, true); centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, entry.nameBytes.length, true); centralView.setUint32(42, offset, true); central.set(entry.nameBytes, 46); centralParts.push(central);
    offset += local.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22); const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, entries.length, true); endView.setUint16(10, entries.length, true); endView.setUint32(12, centralSize, true); endView.setUint32(16, offset, true);
  return concatBytes([...localParts, ...centralParts, end]);
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0); const output = new Uint8Array(total); let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

const CRC_TABLE = (() => { const table = new Uint32Array(256); for (let index = 0; index < 256; index += 1) { let value = index; for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1; table[index] = value >>> 0; } return table; })();

function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }
