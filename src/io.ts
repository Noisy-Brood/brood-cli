import type { ProblemCode } from "./brood/api/src/client.ts";
import type { StoreEnv } from "./store.ts";

/**
 * What a command reaches outside itself, passed in so a test hands it
 * stand-ins: the network, the environment, the clock and the terminal.
 */
export type Io = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  env: StoreEnv & { NO_COLOR?: string; COLORTERM?: string; TERM?: string };
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** A line for the answer, on standard output. */
  out: (line: string) => void;
  /** A line about the session or a refusal, on standard error. */
  err: (line: string) => void;
  /** Whether standard output is a terminal, so it may be dimmed. */
  tty: boolean;
};

/** A refusal said to the person in a sentence, with nothing else printed. */
export class Refusal extends Error {}

/** The session is over at Clerk, and its file is gone. */
export class SessionEnded extends Refusal {}

/** Brood refused the call, with the status it answered. */
export class Refused extends Refusal {
  readonly code: ProblemCode;
  constructor(message: string, code: ProblemCode) {
    super(message);
    this.code = code;
  }
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Built from code points: Prettier writes a `\u` escape in a pattern
// literal as the character itself, which leaves invisible characters in
// the source, and a line separator breaks the literal (voice.md).
const UNSAFE = new RegExp(
  `[${(
    [
      [0x00, 0x1f],
      [0x7f, 0x9f],
      [0x061c],
      [0x200b],
      [0x200e, 0x200f],
      [0x2028, 0x202e],
      [0x2060],
      [0x2066, 0x2069],
      [0xfeff],
    ] as const
  )
    .map((range) =>
      range.map((c) => `\\u${c.toString(16).padStart(4, "0")}`).join("-"),
    )
    .join("")}]`,
  "gu",
);

/**
 * Text from outside brood, made safe to print. A sender writes its own
 * address, name and domain (DD21 §8), and a control character or a
 * direction override in one would let it rewrite the terminal or disguise
 * what is shown, so every one is removed: the C0 and C1 controls, every
 * direction mark and override, the line and paragraph separators, and the
 * zero-width space, word joiner and byte order mark, which can make two
 * names look alike. The zero-width joiner and non-joiner stay, since some
 * scripts need them to spell a name.
 */
export const clean = (text: string): string => text.replace(UNSAFE, "");

/** Every string in a value from outside, cleaned, so nothing printed from it can be missed. */
export const cleaned = (value: unknown): unknown =>
  typeof value === "string"
    ? clean(value)
    : Array.isArray(value)
      ? value.map(cleaned)
      : typeof value === "object" && value !== null
        ? Object.fromEntries(
            Object.entries(value).map(([k, v]) => [clean(k), cleaned(v)]),
          )
        : value;
