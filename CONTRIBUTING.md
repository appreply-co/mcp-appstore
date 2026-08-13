# Contributing to mcp-appstore

Thanks for contributing! This document outlines the process for contributing to
this MCP server.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR-USERNAME/mcp-appstore.git`
3. Install dependencies: `npm install`
4. Start the server: `npm start`

There is no build step — the server runs directly from source.

## Development Process

1. Create a new branch for your changes
2. Make your changes
3. Run `npm run lint` to ensure code style compliance
4. Run `npm test` to verify all tools still work
5. Submit a pull request

`npm test` exercises every tool against the live App Store and Google Play, so it
requires network access and can be affected by store rate limiting. To test the
HTTP transport as well, run `npm run test:http`.

## Pull Request Guidelines

- Follow the existing code style — plain JavaScript, ES modules, no TypeScript
- Keep changes focused and atomic
- Update the README when you change a tool's parameters or response shape
- Update the zod `.describe()` text when you change what a parameter accepts;
  that text is what the model reads
- Provide a clear description of changes

## Data Accuracy

This server feeds data to language models, which present it to people as
research. Accuracy rules are therefore stricter than usual:

- Never return generated or placeholder values without flagging them in the
  response itself. `get_keyword_scores` is currently synthetic and is marked
  `dataSource: "synthetic"`.
- If a store does not expose a field, omit it or state the limitation — do not
  substitute an approximation that reads as measured.

## Code of Conduct

This project follows our [Code of Conduct](CODE_OF_CONDUCT.md). Please review it
before contributing.

## Reporting Issues

- Use the [GitHub issue tracker](https://github.com/appreply-co/mcp-appstore/issues)
- Include the tool name, the arguments you passed, and the response you got
- Note the platform (`ios` / `android`) and `country`, since behavior differs
