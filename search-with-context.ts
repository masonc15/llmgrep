#!/usr/bin/env bun

import { spawn } from "child_process";
import { join } from "path";
import { createWriteStream } from "fs";
import { createInterface } from "readline";
import {
  parseArgs,
  validateSearchOptions,
  getGlobalTempManager,
  parseSearchOutput,
  Logger,
  setDebugMode,
  DEFAULT_TOP_K,
  DEFAULT_CONTEXT,
  TRUNCATE_TEXT_LENGTH,
  THRESHOLD_STRICT,
  THRESHOLD_PRECISE,
  THRESHOLD_BROAD,
} from "./src";
import type { SearchOptions, TextEntry } from "./src";

const logger = new Logger('search-context');
const tempManager = getGlobalTempManager();

function printHelp() {
  console.log(`
llmgrep - Semantic search across your Claude conversation history

Usage: bun run search-with-context.ts <query> [options]

Arguments:
  <query>               Search query (semantic matching)

Threshold Options:
  --strict, -s          Very specific matches only (distance < ${THRESHOLD_STRICT})
  --precise, -p         High quality matches (distance < ${THRESHOLD_PRECISE})
  --broad, -b           Cast a wider net (distance < ${THRESHOLD_BROAD})
  --max-distance, -m    Custom distance threshold (0.0-1.0)
  --top-k <number>      Number of results to return (default: ${DEFAULT_TOP_K})

Other Options:
  --context <number>    Lines of context before/after match (default: ${DEFAULT_CONTEXT})
  --debug               Enable debug logging
  -h, --help            Show this help message

Examples:
  bun run search-with-context.ts "authentication methods" --strict
  bun run search-with-context.ts "bug in user registration" -m 0.3
  bun run search-with-context.ts "react hooks" --broad
`);
}

async function extractMetadata(): Promise<{ entries: TextEntry[]; tempFile: string }> {
  const extractScript = join(import.meta.dir, 'extract-with-metadata.ts');
  const tempFile = await tempManager.create('llmgrep-context');

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
): Promise<Array<{ lineNumber: number; distance: number }>> {
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

function formatResult(entry: TextEntry, distance: number, index: number) {
  const date = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'Unknown date';
  const role = entry.role ? entry.role.toUpperCase() : 'UNKNOWN';
  const project = entry.projectPath.replace(/-/g, '/');

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Result ${index + 1} - Distance: ${distance.toFixed(4)}`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Project: ${project}`);
  console.log(`Role: ${role}`);
  console.log(`Date: ${date}`);
  console.log(`Session: ${entry.sessionId}`);
  console.log(`${'-'.repeat(80)}`);

  const text = entry.text.length > TRUNCATE_TEXT_LENGTH
    ? entry.text.substring(0, TRUNCATE_TEXT_LENGTH) + '...'
    : entry.text;
  console.log(text);
  console.log('');
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

  console.log('Extracting text from Claude projects...');
  const { entries, tempFile } = await extractMetadata();
  console.log(`Found ${entries.length} text entries across all conversations.\n`);

  console.log(`Searching for: "${query}"\n`);
  const results = await performSearch(tempFile, query, options);

  if (results.length === 0) {
    console.log('No results found.');
    return;
  }

  console.log(`Found ${results.length} result(s):\n`);

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    const entry = entries[result.lineNumber];
    if (entry) {
      formatResult(entry, result.distance, i);
    }
  }
}

main();
