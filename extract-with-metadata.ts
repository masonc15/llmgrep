#!/usr/bin/env bun

import { readdir } from "fs/promises";
import { join, basename, dirname } from "path";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { getProjectsDir, Logger } from "./src";
import type { MessageContent, JSONLRecord, TextEntry } from "./src";

const logger = new Logger('extract-metadata');

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

async function* extractTextFromFile(filePath: string): AsyncGenerator<TextEntry> {
  const fileStream = createReadStream(filePath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const fileName = basename(filePath, '.jsonl');
  const parentDir = dirname(filePath);
  const projectPath = basename(parentDir);

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const record: JSONLRecord = JSON.parse(line);

      if (record.message?.content) {
        const content = record.message.content;
        const texts: string[] = [];

        if (typeof content === 'string') {
          if (content.trim()) {
            texts.push(content);
          }
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text?.trim()) {
              texts.push(block.text);
            }
          }
        }

        for (const text of texts) {
          yield {
            text,
            filePath,
            projectPath,
            cwd: record.cwd,
            timestamp: record.timestamp,
            role: record.message.role,
            sessionId: record.sessionId || fileName,
          };
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
      for await (const entry of extractTextFromFile(filePath)) {
        console.log(JSON.stringify(entry));
      }
    }
  } catch (error) {
    logger.error('Error extracting text', error as Error);
    process.exitCode = 1;
  }
}

main();
