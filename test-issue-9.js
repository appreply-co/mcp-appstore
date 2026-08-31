/**
 * Reproduce GitHub issue #9 examples via MCP stdio client.
 * https://github.com/appreply-co/mcp-appstore/issues/9
 */
import { Client } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from './node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const ISSUE_EXAMPLES = [
  {
    label: 'Android (was failing)',
    arguments: {
      keyword: 'pill reminder',
      platform: 'android',
      num: 5
    }
  },
  {
    label: 'iOS (control)',
    arguments: {
      keyword: 'pill reminder',
      platform: 'ios',
      num: 5
    }
  }
];

async function runExample(client, { label, arguments: args }) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(label);
  console.log('Request:', JSON.stringify(args, null, 2));
  console.log('='.repeat(60));

  const result = await client.callTool({
    name: 'analyze_top_keywords',
    arguments: args
  });

  const data = JSON.parse(result.content[0].text);

  if (data.error) {
    console.log('Result: ERROR');
    console.log(JSON.stringify(data, null, 2));
    return false;
  }

  console.log('Result: SUCCESS');
  console.log(`Keyword: ${data.query.keyword}`);
  console.log(`Platform: ${data.query.platform} (${data.query.country}/${data.query.lang})`);
  console.log(`Top apps (${data.observed.topApps.length}):`);
  data.observed.topApps.forEach((app, i) => {
    console.log(
      `  ${i + 1}. ${app.title} (${app.developer}) — score ${app.score ?? 'n/a'} [${app.dataCompleteness}]`
    );
  });
  if (data.observed.detailFetchFailures.length > 0) {
    console.log('Detail fetch failures:', JSON.stringify(data.observed.detailFetchFailures, null, 2));
  }
  console.log('Calculated:', JSON.stringify(data.calculated, null, 2));
  console.log('Unavailable:', JSON.stringify(data.unavailable, null, 2));
  return true;
}

const transport = new StdioClientTransport({
  command: 'node',
  args: ['server.js']
});

const client = new Client({ name: 'issue-9-test', version: '1.0.0' });

try {
  await client.connect(transport);
  console.log('Connected to mcp-appstore MCP server\n');

  let passed = 0;
  for (const example of ISSUE_EXAMPLES) {
    const ok = await runExample(client, example);
    if (ok) passed++;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Done: ${passed}/${ISSUE_EXAMPLES.length} examples succeeded`);
  console.log('='.repeat(60));

  if (passed !== ISSUE_EXAMPLES.length) {
    process.exit(1);
  }
} finally {
  await client.close();
}
