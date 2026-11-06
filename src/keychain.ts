import { spawn } from "node:child_process";

/**
 * The OS keychain, where one exists: macOS's `security` and a Linux
 * desktop's `secret-tool`, the secret on standard input alone. Why, and what
 * was checked, is DD10 §6 (#1366). Every answer but success is null or
 * false, so the store falls back to its file: a keychain that is locked,
 * missing, slow or refusing is no keychain here.
 */
export type Keychain = {
  /** The item, `""` for one that is not base64, or null for none or no answer. */
  read: () => Promise<string | null>;
  /** Whether the keychain kept it. */
  write: (secret: string) => Promise<boolean>;
  /** Whether brood's item is gone: removed, or never there. */
  remove: () => Promise<boolean>;
};

/** A command's exit status and standard output, given its standard input. */
export type Run = (
  command: string,
  args: readonly string[],
  input?: string,
) => Promise<{ status: number | null; stdout: string }>;

/**
 * The longest command line handed to `security -i`, with room to spare: past
 * about 4,000 characters it cuts the line and keeps what it read (DD10 §6).
 * The line is the session in base64 and the command around it, so a session
 * past about 2,500 characters goes to the file.
 */
export const MAC_LINE_MAX = 3_500;

/** How long a keychain command may take: a locked keyring waiting on a desktop prompt is no keychain. */
export const KEYCHAIN_TIMEOUT_MS = 5_000;

/** Where the session is kept in the keychain: the item's service and account. */
export const SERVICE = "com.noisybrood.cli";
export const ACCOUNT = "session";

/**
 * The session as the keychain holds it: base64, so no character in it can
 * end `security -i`'s command line or need quoting there.
 */
const encode = (secret: string) =>
  Buffer.from(secret, "utf8").toString("base64");
// An item brood cannot decode is still brood's: "" says it is there, so the
// store removes it rather than taking it for none.
const decode = (held: string) => {
  const text = held.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return "";
  return Buffer.from(text, "base64").toString("utf8");
};

/** macOS's login keychain, through `security`. */
export const macKeychain = (run: Run): Keychain => ({
  async read() {
    const r = await run("security", [
      "find-generic-password",
      "-a",
      ACCOUNT,
      "-s",
      SERVICE,
      "-w",
    ]);
    return r.status === 0 ? decode(r.stdout) : null;
  },
  async write(secret) {
    const line = `add-generic-password -U -a ${ACCOUNT} -s ${SERVICE} -l brood -w ${encode(secret)}\n`;
    if (line.length > MAC_LINE_MAX) return false;
    const r = await run("security", ["-i"], line);
    return r.status === 0;
  },
  async remove() {
    const r = await run("security", [
      "delete-generic-password",
      "-a",
      ACCOUNT,
      "-s",
      SERVICE,
    ]);
    // 44 is security's "not found": nothing there is gone too.
    return r.status === 0 || r.status === 44;
  },
});

/** A Linux desktop's Secret Service, through `secret-tool`. */
export const linuxKeychain = (run: Run): Keychain => {
  const attributes = ["service", SERVICE, "account", ACCOUNT];
  return {
    async read() {
      const r = await run("secret-tool", ["lookup", ...attributes]);
      return r.status === 0 ? decode(r.stdout) : null;
    },
    async write(secret) {
      const r = await run(
        "secret-tool",
        ["store", "--label=brood", ...attributes],
        encode(secret),
      );
      return r.status === 0;
    },
    async remove() {
      const r = await run("secret-tool", ["clear", ...attributes]);
      return r.status === 0;
    },
  };
};

/**
 * Runs a command with its input on standard input and nothing on its command
 * line but what is given; a command that cannot start answers a null status.
 * Its standard error is dropped: a keychain's complaint can echo what it was
 * handed.
 */
export const runCommand: Run = (command, args, input) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "ignore"],
      // Killed past it, which closes with a null status: no keychain.
      timeout: KEYCHAIN_TIMEOUT_MS,
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.on("error", () => resolve({ status: null, stdout: "" }));
    child.on("close", (status) => resolve({ status, stdout }));
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });

/** The keychain this machine has, or null for none brood can use. */
export function keychainFor(
  platform: NodeJS.Platform,
  run: Run = runCommand,
): Keychain | null {
  if (platform === "darwin") return macKeychain(run);
  if (platform === "linux") return linuxKeychain(run);
  return null;
}
