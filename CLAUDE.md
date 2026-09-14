# mcp-appstore — agent guide

An MCP server exposing Google Play and Apple App Store data (search, app metadata,
reviews, pricing, developer portfolios) for App Store Optimization work.

## Commands

```
npm start            # stdio server (what MCP clients launch)
npm run start:http   # Streamable HTTP server on MCP_HTTP_PORT (default 3333)
npm test             # end-to-end tool suite against the live stores
npm run test:http    # spawn the HTTP server, smoke-test it, shut it down
npm run demo         # human-readable walkthrough of the tools
```

`npm test` and `npm run demo` hit the real stores — they need network access and
are subject to store rate limiting. There is no build step; the server runs
directly from source.

## Layout

- `server.js` — the whole server: every tool is registered here via `server.tool()`,
  and `createMcpAppStoreServer()` builds a fresh instance per stdio process or HTTP request.
- `ios-app-store-client.js` — memoized Apple App Store client.
- `server-http.js` — Streamable HTTP transport wrapper around the same server.
- `test.js`, `server-http.test.js` — plain Node scripts, not a test framework.

## Code style

- **Plain JavaScript, ES modules** (`"type": "module"`). No TypeScript, no build.
- 2-space indentation, semicolons, double quotes in `server.js`.
- Tool parameters are described with zod `.describe()` — the text reaches the model,
  so it must state real bounds and real limitations.
- Every tool returns `{ content: [{ type: "text", text: JSON.stringify(...) }] }`
  and catches its own errors, returning `isError: true` rather than throwing.

## Rules that are easy to get wrong

- **Never present synthetic data as measured.** `get_keyword_scores` returns
  placeholder numbers generated from the keyword string; it is flagged with
  `dataSource: "synthetic"` and a `warning` field, and its `.describe()` text says so.
  Do not remove those markers without replacing the generator with real store data.
- **Bound every `num` parameter** with `.min()/.max()` in the schema, not only in the
  description. Several tools fan out one store request per result, so an unbounded
  count turns a single call into hundreds of requests.
- **Keep the two platforms honest.** iOS and Android return different field shapes;
  where a value does not exist on a platform, omit it or say so rather than
  substituting something that looks equivalent.
- **`await` inside `try`.** Returning an un-awaited promise from a `try` block means
  the `catch` never runs and one failed item rejects the whole `Promise.all`.
