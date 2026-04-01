/**
 * Spawns server-http.js on 127.0.0.1, runs server-http.test.js, then stops the server.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = String(process.env.MCP_HTTP_PORT || '34567');

function spawnServer() {
  return spawn(process.execPath, ['server-http.js'], {
    cwd: __dirname,
    env: { ...process.env, MCP_HTTP_HOST: '127.0.0.1', MCP_HTTP_PORT: port },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitReady() {
  const url = `http://127.0.0.1:${port}/mcp`;
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { method: 'GET' });
      if (r.status === 405) {
        return;
      }
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Timeout waiting for server-http.js to listen');
}

const server = spawnServer();
let log = '';
server.stderr.on('data', (chunk) => {
  log += chunk.toString();
});
server.stdout.on('data', (chunk) => {
  log += chunk.toString();
});

let exitCode = 1;
try {
  await waitReady();
  exitCode = await new Promise((resolve) => {
    const test = spawn(process.execPath, ['server-http.test.js'], {
      cwd: __dirname,
      env: {
        ...process.env,
        MCP_HTTP_TEST_URL: `http://127.0.0.1:${port}/mcp`,
      },
      stdio: 'inherit',
    });
    test.on('exit', (c) => {
      resolve(c === 0 ? 0 : 1);
    });
  });
} catch (e) {
  console.error(e.message);
  if (log.trim()) {
    console.error('Server output:\n', log);
  }
  exitCode = 1;
} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 400));
}

process.exit(exitCode);
