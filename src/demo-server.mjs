import { ContentStore } from './content-store.mjs';
import { DemoModelClient } from './demo-model-client.mjs';
import { startServer } from './server.mjs';

const port = positiveInteger(process.env.PORT, 3001);
const host = process.env.HOST || '127.0.0.1';

const server = startServer({
  contentStore: new ContentStore({ mode: 'demo' }),
  modelClient: new DemoModelClient(),
  host,
  port,
});

try {
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  console.log(`Development demo listening at http://${host}:${port}`);
} catch (error) {
  const reason = error?.code === 'EADDRINUSE'
    ? `port ${port} is already in use`
    : error?.message || 'unknown startup error';
  console.error(`Unable to start development demo: ${reason}.`);
  process.exitCode = 1;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
