import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Refusal } from "./io.ts";

/**
 * Where the session is kept between commands (DD10 §6): a file only its owner
 * can read, at `${XDG_CONFIG_HOME:-~/.config}/brood/credentials.json`, never
 * an environment variable. The OS keychain, where one exists, is #1366.
 */

export type Credentials = {
  access_token: string;
  refresh_token: string;
  /** When the access token expires, in milliseconds since the epoch. */
  expires_at: number;
  scope: string;
};

export type StoreEnv = { XDG_CONFIG_HOME?: string; HOME?: string };

export const credentialsPath = (env: StoreEnv): string =>
  join(
    env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config"),
    "brood",
    "credentials.json",
  );

const isCredentials = (v: unknown): v is Credentials =>
  typeof v === "object" &&
  v !== null &&
  "access_token" in v &&
  typeof v.access_token === "string" &&
  "refresh_token" in v &&
  typeof v.refresh_token === "string" &&
  "expires_at" in v &&
  typeof v.expires_at === "number" &&
  "scope" in v &&
  typeof v.scope === "string";

/** The stored session, or null when there is none. */
export async function readCredentials(
  env: StoreEnv,
): Promise<Credentials | null> {
  const path = credentialsPath(env);
  let mode: number;
  try {
    mode = (await stat(path)).mode;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
  // As ssh does with a key: a file others can read is refused, not used.
  // Not on Windows, where Node reports every file as readable by all: there
  // the file sits in the person's own profile, under its ACL (DD10 §6).
  if (process.platform !== "win32" && mode & 0o077)
    throw new Refusal(
      `${path} can be read by others. Delete it and run brood login again.`,
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    parsed = null;
  }
  if (!isCredentials(parsed))
    throw new Refusal(
      `${path} is not a session brood wrote. Delete it and run brood login again.`,
    );
  return parsed;
}

/** Writes the session where only its owner can read it, whole or not at all. */
export async function writeCredentials(
  env: StoreEnv,
  credentials: Credentials,
): Promise<void> {
  const path = credentialsPath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // A name no earlier run left behind, created afresh ("wx"), so the mode
  // it is given is the mode it has; a reused draft keeps its old bits.
  const draft = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(draft, JSON.stringify(credentials), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(draft, path);
  } finally {
    // Gone once renamed; a draft a failed write left is removed with it.
    await rm(draft, { force: true });
  }
}

/**
 * Forgets the session: the file, and any draft of it a run that stopped
 * between writing and renaming left behind, which holds a token too.
 */
export async function removeCredentials(env: StoreEnv): Promise<void> {
  const path = credentialsPath(env);
  const draft = `${basename(path)}.`;
  let names: string[] = [];
  try {
    names = await readdir(dirname(path));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  for (const name of names)
    if (name.startsWith(draft) && name.endsWith(".tmp"))
      await rm(join(dirname(path), name), { force: true });
  await rm(path, { force: true });
}
