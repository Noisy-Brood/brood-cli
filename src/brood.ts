#!/usr/bin/env node
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
  },
  process.argv.slice(2),
);
