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
  INTERACTIVE_TOP_K,
  MAX_RESULTS_DISPLAY,
  TRUNCATE_PREVIEW_LENGTH,
  DISTANCE_THRESHOLDS,
  AUTO_REFINE_MAX_ATTEMPTS,
  OPTIMAL_RESULT_MIN,
  BINARY_SEARCH_PRECISION,
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

Options:
  --max-distance <num>  Maximum cosine distance threshold (0.0-1.0)
                        Recommended values based on testing:
                        - 0.4 for precision (fewer, more relevant results)
                        - 0.5 for recall (more results, broader matches)
  --top-k <number>      Max results (default: ${INTERACTIVE_TOP_K}, warns if >${MAX_RESULTS_DISPLAY})
  --debug               Enable debug logging
  -h, --help           Show this help message

Examples:
  bun run interactive-search.ts "authentication methods"
  bun run interactive-search.ts "bug fixes" --max-distance 0.4
  bun run interactive-search.ts "react hooks" --max-distance 0.5
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

async function handleTooManyResults(
  resultCount: number,
  query: string,
  entries: TextEntry[],
  tempFile: string
): Promise<void> {
  console.log(`\nToo many results (${resultCount}).`);

  let choice: string | number;
  try {
    choice = await select({
      message: 'How would you like to refine your search?',
      choices: [
        {
          name: 'Auto - Automatically find optimal distance (recommended)',
          value: 'auto',
          description: 'Tries distances from 0.3 to 0.5 until results fit',
        },
        {
          name: 'Distance 0.3 - Very specific (exact matches)',
          value: 0.3,
          description: 'Most restrictive, fewest results',
        },
        {
          name: 'Distance 0.4 - Precision (recommended)',
          value: 0.4,
          description: 'Good balance of relevance and results',
        },
        {
          name: 'Distance 0.5 - Recall (broader)',
          value: 0.5,
          description: 'More results, broader matches',
        },
        {
          name: 'Cancel',
          value: 'cancel',
          description: 'Exit search',
        },
      ],
    });
  } catch (error) {
    if (error instanceof ExitPromptError) {
      console.log('\n\nSearch cancelled.');
      return;
    }
    throw error;
  }

  if (choice === 'cancel') {
    console.log('\nSearch cancelled.');
    return;
  }

  if (choice === 'auto') {
    return await autoRefineSearch(query, entries, tempFile);
  }

  console.log(`\nSearching with distance ${choice}...`);
  const results = await performSearch(tempFile, query, { maxDistance: choice as number });

  if (results.length === 0) {
    console.log('No results found with this distance. Try a higher value.');
    return await handleTooManyResults(0, query, entries, tempFile);
  }

  if (results.length > MAX_RESULTS_DISPLAY) {
    console.log(`\nStill too many results (${results.length}).`);
    return await handleTooManyResults(results.length, query, entries, tempFile);
  }

  await displayResultsAndCopy(results, entries, query, tempFile, choice as number);
}

async function autoRefineSearch(
  query: string,
  entries: TextEntry[],
  tempFile: string,
  maxAttempts: number = AUTO_REFINE_MAX_ATTEMPTS
): Promise<void> {
  console.log('\nAuto-refining search...\n');

  let attempt = 0;
  let lastGoodDistance: number | null = null;
  let lastGoodCount = 0;

  for (const distance of DISTANCE_THRESHOLDS) {
    if (attempt++ >= maxAttempts) {
      console.log('\nMax refinement attempts reached.');
      if (lastGoodDistance) {
        console.log(`Using best result with ${lastGoodCount} matches at distance ${lastGoodDistance}.\n`);
        const results = await performSearch(tempFile, query, { maxDistance: lastGoodDistance });
        await displayResultsAndCopy(results, entries, query, tempFile, lastGoodDistance);
        return;
      }
      console.log('Please try a more specific query.');
      return;
    }

    console.log(`  Trying distance ${distance}...`);
    const results = await performSearch(tempFile, query, { maxDistance: distance });

    if (results.length === 0) {
      console.log(`    No results, trying broader...`);
      continue;
    }

    if (results.length <= MAX_RESULTS_DISPLAY) {
      console.log(`    Found ${results.length} results!\n`);
      await displayResultsAndCopy(results, entries, query, tempFile, distance);
      return;
    }

    console.log(`    Too many (${results.length}), trying stricter...`);

    if (lastGoodDistance !== null && lastGoodCount < MAX_RESULTS_DISPLAY) {
      console.log(`  Detected jump from ${lastGoodCount} to ${results.length} results.`);
      console.log(`  Fine-tuning between ${lastGoodDistance} and ${distance}...\n`);

      const refined = await binarySearchDistance(
        query,
        entries,
        tempFile,
        lastGoodDistance,
        distance,
        maxAttempts - attempt
      );

      if (refined) {
        return;
      }
    }

    if (results.length <= MAX_RESULTS_DISPLAY) {
      lastGoodDistance = distance;
      lastGoodCount = results.length;
    }
  }

  if (lastGoodDistance) {
    console.log(`\nUsing best result with ${lastGoodCount} matches at distance ${lastGoodDistance}.\n`);
    const results = await performSearch(tempFile, query, { maxDistance: lastGoodDistance });
    await displayResultsAndCopy(results, entries, query, tempFile, lastGoodDistance);
    return;
  }

  console.log('\nCould not find a good distance threshold automatically.');
  console.log('Try refining your query or using a manual distance setting.');
}

async function binarySearchDistance(
  query: string,
  entries: TextEntry[],
  tempFile: string,
  minDistance: number,
  maxDistance: number,
  remainingAttempts: number
): Promise<boolean> {
  let left = minDistance;
  let right = maxDistance;
  let bestDistance = minDistance;
  let bestCount = 0;
  let attempts = 0;

  while (attempts < remainingAttempts && right - left > BINARY_SEARCH_PRECISION) {
    const mid = (left + right) / 2;
    attempts++;

    console.log(`    Testing distance ${mid.toFixed(2)}...`);
    const results = await performSearch(tempFile, query, { maxDistance: mid });

    if (results.length === 0) {
      console.log(`      No results, going higher...`);
      left = mid;
      continue;
    }

    if (results.length <= MAX_RESULTS_DISPLAY) {
      console.log(`      Good! ${results.length} results.`);
      bestDistance = mid;
      bestCount = results.length;

      if (results.length >= OPTIMAL_RESULT_MIN) {
        console.log(`    Found optimal: ${results.length} results at distance ${bestDistance.toFixed(2)}!\n`);
        await displayResultsAndCopy(results, entries, query, tempFile, bestDistance);
        return true;
      }

      left = mid;
    } else {
      console.log(`      Too many (${results.length}), going lower...`);
      right = mid;
    }
  }

  if (bestCount > 0) {
    console.log(`    Found ${bestCount} results at distance ${bestDistance.toFixed(2)}!\n`);
    const results = await performSearch(tempFile, query, { maxDistance: bestDistance });
    await displayResultsAndCopy(results, entries, query, tempFile, bestDistance);
    return true;
  }

  return false;
}

async function displayResultsAndCopy(
  results: SearchResult[],
  entries: TextEntry[],
  query: string,
  tempFile?: string,
  currentDistance?: number
): Promise<void> {
  const resultsWithEntries = sortByDistance(attachEntries(results, entries));

  console.log(`Found ${resultsWithEntries.length} result(s).`);
  console.log(`Select one to copy the full conversation to clipboard:\n`);

  const groupedByCwd = resultsWithEntries.reduce((groups, result) => {
    const cwd = result.entry?.cwd || 'Unknown';
    if (!groups[cwd]) {
      groups[cwd] = [];
    }
    groups[cwd].push(result);
    return groups;
  }, {} as Record<string, typeof resultsWithEntries>);

  const choices: Array<{ name: string; value: number; disabled?: boolean; description?: string }> = [];
  const cwds = Object.keys(groupedByCwd).sort();

  cwds.forEach((cwd) => {
    const cwdShort = cwd.split('/').slice(-2).join('/');
    choices.push({
      name: `\n------- ${cwdShort} -------`,
      value: -2,
      disabled: true,
    });

    groupedByCwd[cwd]!.forEach((result) => {
      const entry = result.entry;
      if (!entry) return;

      const date = entry.timestamp ? new Date(entry.timestamp).toLocaleDateString() : 'Unknown';
      const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const preview = truncate(entry.text, TRUNCATE_PREVIEW_LENGTH);

      choices.push({
        name: `  ${date} ${time} | ${entry.role?.toUpperCase() || 'N/A'} [${(result.distance * 100).toFixed(1)}%]\n    ${preview}`,
        value: resultsWithEntries.indexOf(result),
        description: `Full path: ${entry.cwd || 'N/A'} | Distance: ${result.distance.toFixed(4)}`,
      });
    });
  });

  if (resultsWithEntries.length < MAX_RESULTS_DISPLAY && tempFile && currentDistance && currentDistance < 0.6) {
    choices.push({
      name: '\nGo Broader - Search with higher distance threshold',
      value: -3,
      description: `Try distance ${(currentDistance + 0.1).toFixed(1)} for more results`,
    });
  }

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

  if (selectedIndex === -3 && tempFile && currentDistance) {
    const newDistance = currentDistance + 0.1;
    console.log(`\nSearching with broader distance ${newDistance.toFixed(1)}...`);
    const newResults = await performSearch(tempFile, query, { maxDistance: newDistance });

    if (newResults.length === 0) {
      console.log('No additional results found.');
      return await displayResultsAndCopy(results, entries, query, tempFile, currentDistance);
    }

    if (newResults.length > MAX_RESULTS_DISPLAY) {
      return await handleTooManyResults(newResults.length, query, entries, tempFile);
    }

    return await displayResultsAndCopy(newResults, entries, query, tempFile, newDistance);
  }

  const selected = resultsWithEntries[selectedIndex];
  if (!selected?.entry) {
    logger.error('Selected result has no entry attached');
    return;
  }

  console.log('\nExtracting full conversation...');

  try {
    const conversation = await extractConversation(selected.entry.filePath, selected.entry.sessionId!);
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

  const { query, options } = parseArgs(args, { topK: INTERACTIVE_TOP_K });

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

  const resultsWithEntries = sortByDistance(attachEntries(results, entries));

  console.log(`Found ${resultsWithEntries.length} result(s).`);

  if (resultsWithEntries.length > MAX_RESULTS_DISPLAY) {
    return await handleTooManyResults(resultsWithEntries.length, query, entries, tempFile);
  }

  await displayResultsAndCopy(resultsWithEntries, entries, query, tempFile);
}

main();
