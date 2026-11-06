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
import type { Keychain } from "./keychain.ts";

/**
 * Where the session is kept between commands (DD10 §6): the OS keychain where
 * one answers (#1366), and otherwise a file only its owner can read, at
 * `${XDG_CONFIG_HOME:-~/.config}/brood/credentials.json`; never an
 * environment variable. A session kept in the file before a keychain was
 * used is read from there, and moves to the keychain the next time it is
 * written.
 */

export type Credentials = {
  access_token: string;
  refresh_token: string;
  /** When the access token expires, in milliseconds since the epoch. */
  expires_at: number;
  scope: string;
};

export type StoreEnv = { XDG_CONFIG_HOME?: string; HOME?: string };

/** Where the session can be kept: the keychain, if there is one, and the file's place. */
export type Store = { env: StoreEnv; keychain: Keychain | null };

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

/** The stored session, or null when there is none: the keychain's, else the file's. */
export async function readCredentials(
  store: Store,
): Promise<Credentials | null> {
  const held = await store.keychain?.read();
  if (held != null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(held);
    } catch {
      parsed = null;
    }
    if (isCredentials(parsed)) return parsed;
    // Brood's own item, unreadable, such as one a keychain cut short: it can
    // open nothing, and refusing over it would refuse logout too. Removed, and
    // the file, if any, is the session; one that will not go is said.
    if (!(await store.keychain?.remove())) throw new Refusal(STUCK);
  }
  return readFileCredentials(store.env);
}

async function readFileCredentials(env: StoreEnv): Promise<Credentials | null> {
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

/**
 * Writes the session to the keychain, read back to be sure it took, and then
 * removes any file an earlier session left; with no keychain, or one that did
 * not keep it, to the file, whole or not at all.
 */
export async function writeCredentials(
  store: Store,
  credentials: Credentials,
): Promise<void> {
  const secret = JSON.stringify(credentials);
  if (store.keychain) {
    if (
      (await store.keychain.write(secret)) &&
      (await store.keychain.read()) === secret
    ) {
      await removeFileCredentials(store.env);
      return;
    }
    // Whatever it kept, an older session or part of this one, would be read
    // ahead of the file: it goes first, or the file is not written, since a
    // session read past would be no session at all.
    if (!(await gone(store.keychain))) throw new Refusal(STUCK);
  }
  await writeFileCredentials(store.env, credentials);
}

async function writeFileCredentials(
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

/** Forgets the session: in the keychain, and in any file it was ever kept in. */
export async function removeCredentials(store: Store): Promise<void> {
  await removeFileCredentials(store.env);
  if (store.keychain && !(await gone(store.keychain))) throw new Refusal(STUCK);
}

/**
 * Whether the keychain holds nothing brood would read ahead of its file:
 * its item removed, or none it will show. One it cannot reach, with no
 * `secret-tool` or no Secret Service running, shows none, and reads fall
 * back to the file too, so nothing there can shadow it (review of #1676).
 */
const gone = async (keychain: Keychain): Promise<boolean> =>
  (await keychain.remove()) || (await keychain.read()) === null;

/** What brood says when the keychain will not let go of its item. */
const STUCK =
  "Your keychain holds a brood session it will not let go of. Unlock the keychain, or delete the item named brood (com.noisybrood.cli), then run brood login.";

/**
 * The file, and any draft of it a run that stopped between writing and
 * renaming left behind, which holds a token too.
 */
async function removeFileCredentials(env: StoreEnv): Promise<void> {
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
