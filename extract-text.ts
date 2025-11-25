#!/usr/bin/env bun

import { readdir } from "fs/promises";
import { join } from "path";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { getProjectsDir } from "./src";
import { Logger } from "./src";
import type { MessageContent, JSONLRecord } from "./src";

const logger = new Logger('extract-text');

async function* walkDir(dir: string): AsyncGenerator<string> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        yield* walkDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        yield fullPath;
      }
    }
  } catch (error) {
    logger.error(`Failed to read directory: ${dir}`, error as Error);
  }
}

async function* extractTextFromFile(filePath: string): AsyncGenerator<string> {
  const fileStream = createReadStream(filePath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const record: JSONLRecord = JSON.parse(line);

      if (record.message?.content) {
        const content = record.message.content;

        if (typeof content === 'string') {
          if (content.trim()) {
            yield content;
          }
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text?.trim()) {
              yield block.text;
            }
          }
        }
      }
    } catch (error) {
      logger.skippedLine(line, error as Error);
    }
  }
}

async function main() {
  try {
    const projectsDir = getProjectsDir();

    for await (const filePath of walkDir(projectsDir)) {
      for await (const text of extractTextFromFile(filePath)) {
        console.log(text.replace(/\n/g, ' '));
      }
    }
  } catch (error) {
    logger.error('Error extracting text', error as Error);
    process.exitCode = 1;
  }
}

main();
