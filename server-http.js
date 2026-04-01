/**
 * Remote MCP via Streamable HTTP (MCP spec). Exposes the same tools as server.js at POST /mcp.
 *
 * Env:
 *   PORT — many hosts set this (e.g. Render, Railway); used if set
 *   MCP_HTTP_PORT — listen port (default 3333 if PORT unset)
 *   MCP_HTTP_HOST — bind address (default 0.0.0.0; use 127.0.0.1 for local-only)
 *
 * Put HTTPS + auth in front (reverse proxy or tunnel) before exposing to the internet.
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { createMcpAppStoreServer } from './server.js';

const port = Number(process.env.PORT || process.env.MCP_HTTP_PORT || 3333);
const host = process.env.MCP_HTTP_HOST || '0.0.0.0';

const app = createMcpExpressApp({ host });

const jsonRpcError = (res, status, message) => {
  if (!res.headersSent) {
    res.status(status).json({
      jsonrpc: '2.0',
      error: { code: -32000, message },
      id: null,
    });
  }
};

app.post('/mcp', async (req, res) => {
  let server;
  let transport;
  try {
    server = createMcpAppStoreServer();
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close();
    });
  } catch (error) {
    console.error('MCP HTTP error:', error);
    jsonRpcError(res, 500, 'Internal server error');
    if (transport) {
      transport.close().catch(() => {});
    }
    if (server) {
      server.close();
    }
  }
});

app.get('/mcp', (_req, res) => {
  jsonRpcError(res, 405, 'Method not allowed.');
});

app.delete('/mcp', (_req, res) => {
  jsonRpcError(res, 405, 'Method not allowed.');
});

app.listen(port, host, () => {
  console.error(
    `App Store Scraper MCP (Streamable HTTP) listening on http://${host}:${port}/mcp`,
  );
});
