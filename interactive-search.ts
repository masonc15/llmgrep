#!/usr/bin/env bun

import { spawn } from "child_process";
import { join } from "path";
import { createWriteStream } from "fs";
import { createInterface } from "readline";
import { select } from "@inquirer/prompts";
import { ExitPromptError } from "@inquirer/core";
import { extractConversation } from "./extract-conversation";
import {
  parseArgs,
  validateSearchOptions,
  truncate,
  getGlobalTempManager,
  parseSearchOutput,
  attachEntries,
  sortByDistance,
  Logger,
  setDebugMode,
  distanceToPercent,
  createVisualBar,
  filterByDateRange,
  INTERACTIVE_TOP_K,
  MAX_RESULTS_DISPLAY,
  TRUNCATE_PREVIEW_LENGTH,
  DEFAULT_DISTANCE,
  DEFAULT_LIMIT,
  EXPANDED_DISTANCE,
  THRESHOLD_STRICT,
  THRESHOLD_PRECISE,
  THRESHOLD_BROAD,
} from "./src";
import type { SearchOptions, TextEntry, SearchResult } from "./src";

const logger = new Logger('interactive-search');
const tempManager = getGlobalTempManager();

function printHelp() {
  console.log(`
llmgrep (Interactive) - Search and copy conversations to clipboard

Usage: bun run interactive-search.ts <query> [options]

Arguments:
  <query>               Search query (semantic matching)

Threshold Options:
  --strict, -s          Very specific matches only (distance < ${THRESHOLD_STRICT})
  --precise, -p         High quality matches (distance < ${THRESHOLD_PRECISE}) [default]
  --broad, -b           Cast a wider net (distance < ${THRESHOLD_BROAD})
  --max-distance, -m    Custom distance threshold (0.0-1.0)

Filter Options:
  --after <date>        Only results after YYYY-MM-DD
  --before <date>       Only results before YYYY-MM-DD
  --limit, -l <n>       Max results to display (default: ${DEFAULT_LIMIT})

Other Options:
  --debug               Enable debug logging
  -h, --help            Show this help message

Examples:
  bun run interactive-search.ts "authentication"
  bun run interactive-search.ts "bug fixes" --strict
  bun run interactive-search.ts "react hooks" --broad
  bun run interactive-search.ts "refactoring" --after 2025-01-01
`);
}

async function extractMetadata(): Promise<{ entries: TextEntry[]; tempFile: string }> {
  const extractScript = join(import.meta.dir, 'extract-with-metadata.ts');
  const tempFile = await tempManager.create('llmgrep');

  return new Promise((resolve, reject) => {
    const entries: TextEntry[] = [];
    const textLines: string[] = [];

    const extract = spawn('bun', ['run', extractScript], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    const rl = createInterface({
      input: extract.stdout,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      try {
        const entry: TextEntry = JSON.parse(line);
        entries.push(entry);
        textLines.push(entry.text.replace(/\n/g, ' '));
      } catch (error) {
        logger.skippedLine(line, error as Error);
      }
    });

    extract.on('error', reject);

    extract.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error(`Extraction failed with code ${code}`));
        return;
      }

      const writeStream = createWriteStream(tempFile);
      for (const line of textLines) {
        writeStream.write(line + '\n');
      }
      writeStream.end();

      await new Promise((resolveWrite) => writeStream.on('finish', resolveWrite));
      resolve({ entries, tempFile });
    });
  });
}

async function performSearch(
  tempFile: string,
  query: string,
  options: SearchOptions
): Promise<SearchResult[]> {
  return new Promise((resolve, reject) => {
    const searchArgs = [query, tempFile, '-n', '0'];

    if (options.maxDistance !== undefined) {
      searchArgs.push('-m', options.maxDistance.toString());
    } else {
      searchArgs.push('--top-k', options.topK!.toString());
    }

    const search = spawn('search', searchArgs, {
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    let output = '';
    search.stdout.on('data', (data) => {
      output += data.toString();
    });

    search.on('error', () => {
      reject(new Error('Make sure "search" command is installed (npm install -g @llamaindex/semtools)'));
    });

    search.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Search failed with code ${code}`));
        return;
      }

      resolve(parseSearchOutput(output));
    });
  });
}

async function copyToClipboard(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let command: string;
    let args: string[] = [];

    if (process.platform === 'darwin') {
      command = 'pbcopy';
    } else if (process.platform === 'win32') {
      command = 'clip';
    } else {
      command = 'xclip';
      args = ['-selection', 'clipboard'];
    }

    const proc = spawn(command, args, {
      stdio: ['pipe', 'ignore', 'inherit'],
    });

    proc.stdin.write(text);
    proc.stdin.end();

    proc.on('error', (error) => {
      reject(new Error(`Failed to copy to clipboard: ${error.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error('Failed to copy to clipboard'));
      }
    });
  });
}

async function displayResultsAndCopy(
  results: SearchResult[],
  entries: TextEntry[],
  query: string,
  tempFile?: string
): Promise<void> {
  // Results are already sorted and limited by caller
  const homeDir = process.env.HOME || '';

  // Display results with visual bars
  results.forEach((result, index) => {
    const entry = result.entry;
    if (!entry) return;

    const percent = distanceToPercent(result.distance);
    const bar = createVisualBar(percent);

    // Format date
    const date = entry.timestamp
      ? new Date(entry.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '       ';

    // Format folder - extract meaningful part from projectPath or cwd
    let folder = entry.projectPath || entry.cwd || '';
    if (folder.includes('Users-')) {
      folder = '(home)';
    } else {
      // Get last meaningful segment
      folder = folder.split('-').slice(-2).join('/').substring(0, 16);
    }

    // Preview
    const preview = truncate(entry.text.replace(/\n/g, ' '), 50);

    console.log(` ${bar} ${String(percent).padStart(3)}%  ${date.padEnd(7)} ${folder.padEnd(16)}  "${preview}"`);
  });

  console.log('');

  // Build choices for selection
  const choices: Array<{ name: string; value: number; description?: string }> = results.map((result, index) => {
    const entry = result.entry;
    if (!entry) return { name: 'Unknown', value: index };

    const percent = distanceToPercent(result.distance);
    const date = entry.timestamp
      ? new Date(entry.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'Unknown';
    const preview = truncate(entry.text.replace(/\n/g, ' '), 60);

    return {
      name: `${String(percent).padStart(3)}% | ${date} | ${preview}`,
      value: index,
      description: entry.cwd || entry.projectPath,
    };
  });

  choices.push({
    name: 'Cancel',
    value: -1,
    description: 'Exit without copying',
  });

  let selectedIndex: number;
  try {
    selectedIndex = await select({
      message: 'Select a result to copy the full conversation:',
      choices,
      pageSize: 15,
    });
  } catch (error) {
    if (error instanceof ExitPromptError) {
      console.log('\n\nCancelled.');
      return;
    }
    throw error;
  }

  if (selectedIndex === -1) {
    console.log('\nCancelled.');
    return;
  }

  const selected = results[selectedIndex];
  if (!selected?.entry) {
    logger.error('Selected result has no entry attached');
    return;
  }

  console.log('\nExtracting full conversation...');

  try {
    const conversation = await extractConversation(selected.entry.filePath);
    await copyToClipboard(conversation);

    console.log('\nFull conversation copied to clipboard!');
    console.log(`\nConversation details:`);
    console.log(`  Project: ${selected.entry.projectPath.replace(/-/g, '/')}`);
    console.log(`  Session: ${selected.entry.sessionId}`);
    console.log(`  File: ${selected.entry.filePath}`);
  } catch (error) {
    logger.error('Failed to extract conversation', error as Error);
  }
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

  // Default to --precise (DEFAULT_DISTANCE) instead of top-k
  const { query, options } = parseArgs(args, {
    maxDistance: DEFAULT_DISTANCE,
    limit: DEFAULT_LIMIT,
  });

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

  console.log('Extracting text from Claude projects...');
  const { entries: allEntries, tempFile } = await extractMetadata();

  // Apply date filtering
  const entries = filterByDateRange(allEntries, options.afterDate, options.beforeDate);
  const filtered = allEntries.length !== entries.length;

  if (filtered) {
    console.log(`Found ${entries.length} entries (filtered from ${allEntries.length} by date range).\n`);
  } else {
    console.log(`Found ${entries.length} text entries across all conversations.\n`);
  }

  console.log(`Searching for: "${query}"\n`);
  let results = await performSearch(tempFile, query, options);

  // Filter results to only include entries that passed date filter
  if (filtered) {
    const entryIndices = new Set(entries.map((_, i) => i));
    results = results.filter(r => entryIndices.has(r.lineNumber));
  }

  // Auto-expand if no results
  if (results.length === 0) {
    const currentDistance = options.maxDistance ?? DEFAULT_DISTANCE;
    if (currentDistance < EXPANDED_DISTANCE) {
      console.log(`⚠ No results at distance ${currentDistance.toFixed(2)}. Expanding search...`);
      results = await performSearch(tempFile, query, { maxDistance: EXPANDED_DISTANCE });
      if (filtered) {
        const entryIndices = new Set(entries.map((_, i) => i));
        results = results.filter(r => entryIndices.has(r.lineNumber));
      }
      if (results.length > 0) {
        console.log(`\nFound ${results.length} results (expanded to --broad):\n`);
        console.log('Tip: These are weaker matches. Try a different query for better results.\n');
      }
    }
  }

  if (results.length === 0) {
    console.log('No results found.');
    return;
  }

  const resultsWithEntries = sortByDistance(attachEntries(results, entries));

  // Apply limit
  const limit = options.limit ?? DEFAULT_LIMIT;
  const limitedResults = resultsWithEntries.slice(0, limit);

  if (resultsWithEntries.length > limit) {
    console.log(`Found ${resultsWithEntries.length} results (showing top ${limit}):\n`);
  } else {
    console.log(`Found ${resultsWithEntries.length} result(s):\n`);
  }

  await displayResultsAndCopy(limitedResults, entries, query, tempFile);
}

main();
