import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_BASE, SIGN_IN, type AccountState } from "./brood/api/src/client.ts";
import type { Io } from "./io.ts";
import { writeCredentials, type Credentials } from "./store.ts";

/**
 * A stand-in for Clerk and the API: each case lists the requests it expects,
 * by method and URL, and the answer each gets in turn. A request no case
 * listed fails loudly, so a command cannot call something unnoticed.
 */

export const TOKEN_URL = `${SIGN_IN.issuer}/oauth/token`;
export const DEVICE_URL = `${SIGN_IN.issuer}/oauth/device_authorization`;
export const api = (operation: string) => `${API_BASE}/${operation}`;

export type Sent = {
  url: string;
  headers: Record<string, string>;
  body: string;
};

type Answer = (sent: Sent) => Response;

export const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

export const problem = (status: number, code: string, detail?: string) =>
  json(status, {
    type: "about:blank",
    title: code,
    status,
    code,
    ...(detail ? { detail } : {}),
  });

export const ACCOUNT: AccountState = {
  id: "acc-1",
  sync: {
    phase: "current",
    indexed_through: "2026-07-01",
    last_synced_at: "2026-10-18T08:00:00Z",
  },
  whole: true,
};

export const envelope = (
  data: unknown,
  more: { next?: string; accounts?: AccountState[]; complete?: boolean } = {},
) =>
  json(200, {
    data,
    accounts: more.accounts ?? [ACCOUNT],
    complete: more.complete ?? true,
    ...(more.next ? { next: more.next } : {}),
  });

export type Stand = {
  io: Io;
  sent: Sent[];
  out: string[];
  err: string[];
  slept: number[];
  dir: string;
  /** Moves the clock on. */
  advance: (ms: number) => void;
};

export const NOW = Date.parse("2026-10-18T09:00:00Z");

export function standIn(routes: Record<string, Answer[]>): Stand {
  const dir = mkdtempSync(join(tmpdir(), "brood-cli-"));
  const queues = new Map(Object.entries(routes).map(([k, v]) => [k, [...v]]));
  const sent: Sent[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const slept: number[] = [];
  let now = NOW;
  const io: Io = {
    async fetch(url, init) {
      const headers = Object.fromEntries(new Headers(init.headers).entries());
      const body = typeof init.body === "string" ? init.body : "";
      const s = { url, headers, body };
      sent.push(s);
      const next = queues.get(url)?.shift();
      if (!next) throw new Error(`stand-in: no answer listed for ${url}`);
      return next(s);
    },
    env: { XDG_CONFIG_HOME: dir },
    now: () => now,
    async sleep(ms) {
      slept.push(ms);
      now += ms;
    },
    out: (line) => void out.push(line),
    err: (line) => void err.push(line),
    tty: false,
  };
  return { io, sent, out, err, slept, dir, advance: (ms) => void (now += ms) };
}

export const SESSION: Credentials = {
  access_token: "access-one",
  refresh_token: "refresh-one",
  expires_at: NOW + 3_600_000,
  scope: "read act offline_access",
};

/** A stand-in already signed in. */
export async function signedIn(
  routes: Record<string, Answer[]>,
  session: Credentials = SESSION,
): Promise<Stand> {
  const stand = standIn(routes);
  await writeCredentials(stand.io.env, session);
  return stand;
}

export const tokens = (n: string, scope = "read act offline_access") =>
  json(200, {
    access_token: `access-${n}`,
    refresh_token: `refresh-${n}`,
    expires_in: 86400,
    scope,
    token_type: "bearer",
  });
