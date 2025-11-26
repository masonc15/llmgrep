#!/usr/bin/env bun

import { spawn } from "child_process";
import { join } from "path";
import { createWriteStream } from "fs";
import { createInterface } from "readline";
import {
  parseArgs,
  validateSearchOptions,
  getGlobalTempManager,
  filterByDateRange,
  Logger,
  setDebugMode,
  createSpinner,
  DEFAULT_TOP_K,
  DEFAULT_CONTEXT,
  THRESHOLD_STRICT,
  THRESHOLD_PRECISE,
  THRESHOLD_BROAD,
} from "./src";
import type { TextEntry } from "./src";

const logger = new Logger('llmgrep');
const tempManager = getGlobalTempManager();

// Scale timeout based on entry count: ~5 seconds per 1000 entries, minimum 2 minutes
function calculateTimeout(entryCount: number): number {
  const baseTimeout = 120000; // 2 minutes minimum
  const perThousand = 5000; // 5 seconds per 1000 entries
  return Math.max(baseTimeout, Math.ceil(entryCount / 1000) * perThousand);
}

function printHelp() {
  console.log(`
llmgrep - Semantic search across your Claude conversation history

Usage: llmgrep <query> [options]

Arguments:
  <query>               Search query (semantic matching)

Threshold Options:
  --strict, -s          Very specific matches only (distance < ${THRESHOLD_STRICT})
  --precise, -p         High quality matches (distance < ${THRESHOLD_PRECISE})
  --broad, -b           Cast a wider net (distance < ${THRESHOLD_BROAD})
  --max-distance, -m    Custom distance threshold (0.0-1.0)
  --top-k <number>      Number of results to return (default: ${DEFAULT_TOP_K})

Filter Options:
  --after <date>        Only results after YYYY-MM-DD
  --before <date>       Only results before YYYY-MM-DD

Other Options:
  --context <number>    Lines of context before/after match (default: ${DEFAULT_CONTEXT})
  --debug               Enable debug logging
  -h, --help            Show this help message

Examples:
  llmgrep "authentication methods" --strict
  llmgrep "bug in user registration" -m 0.3
  llmgrep "react hooks" --broad
  llmgrep "refactoring" --after 2025-01-01
`);
}

async function extractWithMetadata(): Promise<TextEntry[]> {
  const extractScript = join(import.meta.dir, 'extract-with-metadata.ts');

  return new Promise((resolve, reject) => {
    const entries: TextEntry[] = [];

    const extract = spawn('bun', ['run', extractScript], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const rl = createInterface({
      input: extract.stdout,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      try {
        const entry: TextEntry = JSON.parse(line);
        entries.push(entry);
      } catch (error) {
        logger.debug(`Skipped invalid line: ${line.substring(0, 50)}`);
      }
    });

    extract.stderr.on('data', (data) => {
      logger.debug(`Extraction stderr: ${data}`);
    });

    extract.on('error', reject);

    extract.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Extraction failed with code ${code}`));
        return;
      }
      resolve(entries);
    });
  });
}

async function writeEntriesToTempFile(entries: TextEntry[]): Promise<string> {
  const tempFile = await tempManager.create('llmgrep');
  const writeStream = createWriteStream(tempFile);

  for (const entry of entries) {
    // Flatten text to single line for search
    writeStream.write(entry.text.replace(/\n/g, ' ') + '\n');
  }

  writeStream.end();
  await new Promise((resolve) => writeStream.on('finish', resolve));

  return tempFile;
}

async function performSearch(
  tempFile: string,
  query: string,
  context: number,
  topK?: number,
  maxDistance?: number,
  timeout?: number
): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const searchArgs = [query, tempFile, '-n', context.toString()];

    if (maxDistance !== undefined) {
      searchArgs.push('-m', maxDistance.toString());
    } else {
      searchArgs.push('--top-k', (topK ?? DEFAULT_TOP_K).toString());
    }

    const search = spawn('search', searchArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeoutId = timeout ? setTimeout(() => {
      timedOut = true;
      search.kill();
    }, timeout) : null;

    search.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    search.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    search.on('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(new Error(`Search command failed: ${error.message}\nMake sure "search" is installed (npm install -g @llamaindex/semtools)`));
    });

    search.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
        timedOut,
      });
    });
  });
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

  // Phase 1: Extract text with metadata
  const extractSpinner = createSpinner('Extracting conversations...').start();

  let allEntries: TextEntry[];

  try {
    allEntries = await extractWithMetadata();
    extractSpinner.succeed(`Found ${allEntries.length.toLocaleString()} text entries`);
  } catch (error) {
    extractSpinner.fail('Extraction failed');
    logger.error('Extraction failed', error as Error);
    process.exitCode = 1;
    return;
  }

  // Phase 2: Apply date filters if specified
  const hasDateFilter = options.afterDate || options.beforeDate;
  let entries = allEntries;

  if (hasDateFilter) {
    entries = filterByDateRange(allEntries, options.afterDate, options.beforeDate);
    const filtered = allEntries.length - entries.length;
    if (filtered > 0) {
      console.log(`  Filtered to ${entries.length.toLocaleString()} entries (${filtered.toLocaleString()} excluded by date)`);
    }
  }

  if (entries.length === 0) {
    console.log('\nNo entries match the specified date range.');
    return;
  }

  // Phase 3: Write filtered entries to temp file
  const tempFile = await writeEntriesToTempFile(entries);

  // Phase 4: Compute embeddings and search
  const timeout = calculateTimeout(entries.length);
  const timeoutMinutes = Math.ceil(timeout / 60000);

  let searchMessage = 'Computing embeddings...';
  if (entries.length > 5000) {
    searchMessage = `Computing embeddings for ${entries.length.toLocaleString()} entries (may take ${timeoutMinutes}+ min)...`;
  }

  const searchSpinner = createSpinner(searchMessage).start();

  try {
    const result = await performSearch(
      tempFile,
      query,
      options.context ?? DEFAULT_CONTEXT,
      options.topK,
      options.maxDistance,
      timeout
    );

    if (result.timedOut) {
      searchSpinner.fail(`Search timed out after ${timeoutMinutes} minutes`);
      console.error('\nTip: Use --after YYYY-MM-DD to limit search to recent conversations');
      process.exitCode = 1;
      return;
    }

    if (result.exitCode !== 0) {
      searchSpinner.fail('Search failed');
      if (result.stderr) {
        console.error(result.stderr);
      }
      console.error('Make sure "search" command is installed (npm install -g @llamaindex/semtools)');
      process.exitCode = result.exitCode;
      return;
    }

    searchSpinner.succeed('Search complete');

    // Output results
    if (result.stdout) {
      console.log('');
      console.log(result.stdout);
    } else {
      console.log('\nNo results found.');
    }
  } catch (error) {
    searchSpinner.fail('Search failed');
    logger.error('Search failed', error as Error);
    process.exitCode = 1;
  }
}

main();
