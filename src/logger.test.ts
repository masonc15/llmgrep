// src/logger.test.ts
import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Logger, setDebugMode, isDebugMode } from "./logger";

describe("Logger", () => {
  let consoleErrorSpy: ReturnType<typeof spyOn>;
  let consoleWarnSpy: ReturnType<typeof spyOn>;
  let consoleLogSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {});
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleLogSpy.mockRestore();
    setDebugMode(false);
  });

  test("logs errors always", () => {
    const logger = new Logger("test");
    logger.error("error message");
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  test("logs warnings always", () => {
    const logger = new Logger("test");
    logger.warn("warning message");
    expect(consoleWarnSpy).toHaveBeenCalled();
  });

  test("skips debug messages when debug mode off", () => {
    setDebugMode(false);
    const logger = new Logger("test");
    logger.debug("debug message");
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  test("logs debug messages when debug mode on", () => {
    setDebugMode(true);
    const logger = new Logger("test");
    logger.debug("debug message");
    expect(consoleLogSpy).toHaveBeenCalled();
  });

  test("logs skipped JSON parse errors in debug mode", () => {
    setDebugMode(true);
    const logger = new Logger("parser");
    logger.skippedLine("invalid json", new Error("parse error"));
    expect(consoleLogSpy).toHaveBeenCalled();
  });

  test("does not log skipped lines in normal mode", () => {
    setDebugMode(false);
    const logger = new Logger("parser");
    logger.skippedLine("invalid json", new Error("parse error"));
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});

describe("debug mode", () => {
  afterEach(() => {
    setDebugMode(false);
  });

  test("isDebugMode returns false by default", () => {
    expect(isDebugMode()).toBe(false);
  });

  test("setDebugMode changes state", () => {
    setDebugMode(true);
    expect(isDebugMode()).toBe(true);
  });
});
