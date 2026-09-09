import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  KNOWLEDGE_LIST_URL,
  ZhihuKnowledgeClient,
  contentTailSignal,
} from '../src/zhihu-knowledge.mjs';

const SAMPLE_WORK_ID = '1523701957479239680';
const rootUrl = new URL('../', import.meta.url);

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
} else {
  try {
    const report = options.live ? await probeLive(options.workId) : await probeOffline(options.workId);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`probe failed: ${formatError(error)}\n`);
    process.exitCode = 1;
  }
}

async function probeOffline(workId) {
  const selectedWorkId = workId ?? SAMPLE_WORK_ID;
  const [listText, detailText] = await Promise.all([
    readFile(new URL('../sources/knowledge-list-2026-09-09.json', rootUrl), 'utf8'),
    readFile(new URL('../sources/knowledge-detail-1523701957479239680.json', rootUrl), 'utf8'),
  ]);
  const listPayload = JSON.parse(listText);
  const detailPayload = JSON.parse(detailText);
  if (selectedWorkId !== SAMPLE_WORK_ID) {
    throw new Error(`offline sample only contains detail for work_id ${SAMPLE_WORK_ID}. Use --live --id <work_id> for another item.`);
  }
  const client = new ZhihuKnowledgeClient({
    fetch: createOfflineFetch(listPayload, detailPayload),
  });
  return buildReport('offline', client, selectedWorkId);
}

async function probeLive(workId) {
  const selectedWorkId = workId ?? SAMPLE_WORK_ID;
  const client = new ZhihuKnowledgeClient();
  return buildReport('live', client, selectedWorkId);
}

async function buildReport(mode, client, workId) {
  const list = await client.list();
  const selected = list.find((item) => item.work_id === workId);
  if (!selected) {
    throw new Error(`selected work_id ${workId} was not returned by the list; no detail request was made.`);
  }
  const detail = await client.detail(workId);
  return {
    mode,
    listCount: list.length,
    selected: {
      workId: selected.work_id,
      title: selected.title ?? null,
      labels: selected.labels ?? null,
    },
    detail: {
      workId: detail.work_id,
      chapterName: detail.chapter_name ?? null,
      authorName: detail.author_name ?? null,
      contentCharacters: detail.content.length,
      contentCompleteness: 'unknown',
      contentTailTruncationSignal: contentTailSignal(detail.content),
    },
  };
}

function createOfflineFetch(listPayload, detailPayload) {
  const detailUrl = `https://api.zhihu.com/km-indep-home/hackathon/v2/knowledge/${encodeURIComponent(detailPayload.work_id)}`;
  return async (url) => {
    if (url === KNOWLEDGE_LIST_URL) {
      return jsonResponse(listPayload);
    }
    if (url === detailUrl) {
      return jsonResponse(detailPayload);
    }
    return new Response(JSON.stringify({ error: 'offline fixture not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  };
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function parseArgs(args) {
  const options = { live: false, help: false, workId: undefined };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--live') {
      options.live = true;
    } else if (arg === '--id') {
      options.workId = args[index + 1];
      index += 1;
      if (options.workId === undefined) throw new Error('--id requires a work_id.');
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  const scriptPath = fileURLToPath(import.meta.url);
  process.stdout.write(
    `Usage: node ${scriptPath} [--live] [--id <work_id>]\n\n`
    + 'Without --live, only the checked-in local list/detail samples are read.\n'
    + '--live makes at most one list request and one selected-detail request.\n',
  );
}

function formatError(error) {
  if (error && typeof error === 'object') {
    return `${error.name ?? 'Error'}${error.code ? ` (${error.code})` : ''}: ${error.message ?? 'unknown failure'}`;
  }
  return String(error);
}
