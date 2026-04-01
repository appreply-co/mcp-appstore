/**
 * Smoke test: Streamable HTTP MCP — list tools (and optional search_app call).
 *
 * Usage: start server first, e.g.
 *   MCP_HTTP_HOST=127.0.0.1 MCP_HTTP_PORT=34567 node server-http.js
 * then:
 *   MCP_HTTP_TEST_URL=http://127.0.0.1:34567/mcp node server-http.test.js
 *
 * Or: npm run test:http (starts server, runs test, exits).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const baseUrl = process.env.MCP_HTTP_TEST_URL || 'http://127.0.0.1:34567/mcp';

async function run() {
  const transport = new StreamableHTTPClientTransport(new URL(baseUrl));
  const client = new Client(
    { name: 'server-http-test', version: '1.0.0' },
    { capabilities: {} },
  );

  await client.connect(transport);

  const { tools } = await client.listTools();
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error('Expected non-empty tools list');
  }

  const names = new Set(tools.map((t) => t.name));
  for (const required of ['search_app', 'fetch_reviews', 'get_app_details']) {
    if (!names.has(required)) {
      throw new Error(`Missing tool: ${required}`);
    }
  }

  console.log(`OK: ${tools.length} tools (including search_app, fetch_reviews, get_app_details)`);

  if (process.env.MCP_HTTP_TEST_CALL === '1') {
    const result = await client.callTool({
      name: 'search_app',
      arguments: { term: 'vivaldi', platform: 'android', num: 1 },
    });
    const text = result.content?.find((c) => c.type === 'text')?.text;
    if (!text || result.isError) {
      throw new Error(`search_app failed: ${JSON.stringify(result)}`);
    }
    console.log('OK: search_app returned data');
  }

  await transport.close();
  await client.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
