#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { text } from "node:stream/consumers";
import { run } from "./main.ts";

process.exitCode = await run(
  {
    fetch: (url, init) => fetch(url, init),
    env: process.env,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    tty: process.stdout.isTTY === true,
    input: () => text(process.stdin),
    read: (path) => readFile(path, "utf8"),
    // Asked on standard error, so an answer piped elsewhere holds none of it.
    ask:
      process.stdin.isTTY && process.stderr.isTTY
        ? async (question) => {
            const terminal = createInterface({
              input: process.stdin,
              output: process.stderr,
            });
            try {
              return await terminal.question(question);
            } finally {
              terminal.close();
            }
          }
        : null,
  },
  process.argv.slice(2),
);
