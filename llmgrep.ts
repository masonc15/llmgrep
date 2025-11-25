#!/usr/bin/env bun

import { join } from "path";
import {
  parseArgs,
  validateSearchOptions,
  pipeProcesses,
  Logger,
  setDebugMode,
  DEFAULT_TOP_K,
  DEFAULT_CONTEXT,
} from "./src";

const logger = new Logger('llmgrep');
const SEARCH_TIMEOUT = 120000; // 2 minutes

function printHelp() {
  console.log(`
llmgrep - Semantic search across your Claude conversation history

Usage: llmgrep <query> [options]

Arguments:
  <query>               Search query (semantic matching)

Options:
  --top-k <number>      Number of results to return (default: ${DEFAULT_TOP_K})
  --max-distance <num>  Maximum cosine distance threshold (0.0+)
  --context <number>    Lines of context before/after match (default: ${DEFAULT_CONTEXT})
  --debug               Enable debug logging
  -h, --help           Show this help message

Examples:
  llmgrep "authentication methods" --top-k 5
  llmgrep "bug in user registration" --max-distance 0.3
  llmgrep "react hooks" --context 5
`);
}

async function main() {
  const args = process.argv.slice(2);

  // Check for debug flag
  if (args.includes('--debug')) {
    setDebugMode(true);
    args.splice(args.indexOf('--debug'), 1);
  }

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  if (args.length === 0) {
    console.error('Error: Query is required\n');
    printHelp();
    process.exitCode = 1;
    return;
  }

  const { query, options } = parseArgs(args);

  if (!query) {
    console.error('Error: Query is required\n');
    printHelp();
    process.exitCode = 1;
    return;
  }

  try {
    validateSearchOptions(options);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}\n`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  // Build search command arguments
  const searchArgs = [query, '-n', options.context!.toString()];

  if (options.maxDistance !== undefined) {
    searchArgs.push('-m', options.maxDistance.toString());
  } else {
    searchArgs.push('--top-k', options.topK!.toString());
  }

  const extractScript = join(import.meta.dir, 'extract-text.ts');

  try {
    const result = await pipeProcesses({
      source: { cmd: ['bun', 'run', extractScript] },
      sink: { cmd: ['search', ...searchArgs] },
      timeout: SEARCH_TIMEOUT,
    });

    if (result.timedOut) {
      logger.error('Search timed out after 2 minutes');
      process.exitCode = 1;
      return;
    }

    if (result.sourceExitCode !== 0) {
      logger.error(`Extraction failed with code ${result.sourceExitCode}`);
      process.exitCode = 1;
      return;
    }

    if (result.exitCode !== 0) {
      logger.error(`Search failed with code ${result.exitCode}`);
      console.error('Make sure "search" command is installed (npm install -g @llamaindex/semtools)');
      process.exitCode = result.exitCode;
      return;
    }

    // Output results
    if (result.stdout) {
      console.log(result.stdout);
    }
  } catch (error) {
    logger.error('Search failed', error as Error);
    process.exitCode = 1;
  }
}

main();
