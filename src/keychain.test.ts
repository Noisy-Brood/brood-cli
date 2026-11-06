import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  linuxKeychain,
  MAC_LINE_MAX,
  macKeychain,
  type Keychain,
  type Run,
} from "./keychain.ts";
import {
  credentialsPath,
  readCredentials,
  removeCredentials,
  writeCredentials,
  type Credentials,
} from "./store.ts";

/**
 * The session in the OS keychain (DD10 §6, #1366): the secret reaches
 * `security` and `secret-tool` on standard input alone, never their command
 * line, where `ps` would show it; any failure is no keychain, and the file
 * is used; and a session in the keychain is preferred, a file left from
 * before moved into it.
 */

const SESSION: Credentials = {
  access_token: "access-one",
  refresh_token: "refresh-one",
  expires_at: 1_800_000_000_000,
  scope: "read act offline_access",
};

/** A command runner that records each call and answers what the case says. */
const recorder = (
  answer: (
    cmd: string,
    args: readonly string[],
  ) => { status: number; stdout?: string },
) => {
  const calls: { cmd: string; args: readonly string[]; input: string }[] = [];
  const run: Run = async (cmd, args, input) => {
    calls.push({ cmd, args, input: input ?? "" });
    const a = answer(cmd, args);
    return { status: a.status, stdout: a.stdout ?? "" };
  };
  return { calls, run };
};

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

describe("the keychain's commands (#1366)", () => {
  for (const [name, make] of [
    ["macOS", macKeychain],
    ["Linux", linuxKeychain],
  ] as const) {
    it(`${name}: writes the session on standard input, never on the command line`, async () => {
      const r = recorder(() => ({ status: 0 }));
      assert.equal(await make(r.run).write(JSON.stringify(SESSION)), true);
      const [call] = r.calls;
      for (const arg of call!.args) {
        assert.ok(!arg.includes("refresh-one"), `the token is in ${arg}`);
        assert.ok(
          !arg.includes(b64(JSON.stringify(SESSION))),
          `the session is in ${arg}`,
        );
      }
      assert.ok(call!.input.includes(b64(JSON.stringify(SESSION))));
    });

    it(`${name}: reads it back, and answers none, or not kept, on any failure`, async () => {
      const held = recorder(() => ({
        status: 0,
        stdout: `${b64(JSON.stringify(SESSION))}\n`,
      }));
      assert.equal(await make(held.run).read(), JSON.stringify(SESSION));
      const failing = recorder(() => ({ status: 44 }));
      assert.equal(await make(failing.run).read(), null);
      assert.equal(await make(failing.run).write("x"), false);
      const absent: Run = async () => ({ status: null, stdout: "" });
      assert.equal(await make(absent).read(), null);
      assert.equal(await make(absent).write("x"), false);
    });
  }

  it("reads a value that is not base64 as there but unreadable, and counts security's not-found as removed", async () => {
    const junk = recorder(() => ({ status: 0, stdout: "not base64!\n" }));
    assert.equal(await macKeychain(junk.run).read(), "");
    assert.equal(await linuxKeychain(junk.run).read(), "");
    const notFound = recorder(() => ({ status: 44 }));
    assert.equal(await macKeychain(notFound.run).remove(), true);
    const refusing = recorder(() => ({ status: 1 }));
    assert.equal(await macKeychain(refusing.run).remove(), false);
    assert.equal(await linuxKeychain(refusing.run).remove(), false);
  });

  it("macOS: never hands security a session longer than it keeps whole", async () => {
    const r = recorder(() => ({ status: 0 }));
    assert.equal(
      await macKeychain(r.run).write("x".repeat(MAC_LINE_MAX)),
      false,
    );
    assert.deepEqual(r.calls, []);
  });

  it("macOS: hands security -i one command, with no character that could end it", async () => {
    const r = recorder(() => ({ status: 0 }));
    await macKeychain(r.run).write('{"a":"line\\nbreak and \\"quotes\\""}');
    const [call] = r.calls;
    assert.deepEqual(call!.args, ["-i"]);
    assert.equal(call!.input.split("\n").filter(Boolean).length, 1);
    assert.match(call!.input, /-w [A-Za-z0-9+/]+={0,2}\n$/);
  });
});

/** A keychain held in memory, refusing to keep anything when told. */
const memory = (refuse = false) => {
  let held: string | null = null;
  const keychain: Keychain = {
    read: async () => held,
    write: async (s) => {
      if (refuse) return false;
      held = s;
      return true;
    },
    remove: async () => ((held = null), true),
  };
  return { keychain, held: () => held, set: (s: string | null) => (held = s) };
};

const place = () => {
  const dir = mkdtempSync(join(tmpdir(), "brood-keychain-"));
  return { XDG_CONFIG_HOME: dir };
};

describe("the session in the keychain (DD10 §6, #1366)", () => {
  it("is written to the keychain, and no file is left", async () => {
    const env = place();
    const k = memory();
    await writeCredentials({ env, keychain: k.keychain }, SESSION);
    assert.equal(k.held(), JSON.stringify(SESSION));
    assert.equal(existsSync(credentialsPath(env)), false);
    assert.deepEqual(
      await readCredentials({ env, keychain: k.keychain }),
      SESSION,
    );
  });

  it("moves a session a file kept before into the keychain the next time it is written", async () => {
    const env = place();
    await writeCredentials({ env, keychain: null }, SESSION);
    const k = memory();
    // Read from the file while the keychain holds nothing.
    assert.deepEqual(
      await readCredentials({ env, keychain: k.keychain }),
      SESSION,
    );
    await writeCredentials({ env, keychain: k.keychain }, SESSION);
    assert.equal(existsSync(credentialsPath(env)), false);
    assert.equal(k.held(), JSON.stringify(SESSION));
  });

  it("falls back to the file when the keychain does not keep it", async () => {
    const env = place();
    const k = memory(true);
    await writeCredentials({ env, keychain: k.keychain }, SESSION);
    assert.equal(existsSync(credentialsPath(env)), true);
    assert.deepEqual(
      await readCredentials({ env, keychain: k.keychain }),
      SESSION,
    );
  });

  it("falls back to the file when what the keychain kept does not read back", async () => {
    const env = place();
    const liar: Keychain = {
      read: async () => null,
      write: async () => true,
      remove: async () => true,
    };
    await writeCredentials({ env, keychain: liar }, SESSION);
    assert.equal(existsSync(credentialsPath(env)), true);
  });

  it("removes an item of brood's that does not read as a session, and reads the file's", async () => {
    const env = place();
    await writeCredentials({ env, keychain: null }, SESSION);
    const k = memory();
    k.set('{"access_token":"cut sho');
    assert.deepEqual(
      await readCredentials({ env, keychain: k.keychain }),
      SESSION,
    );
    assert.equal(k.held(), null);
  });

  it("clears what the keychain kept when it reads back different, and writes the file", async () => {
    const env = place();
    const k = memory();
    k.set("an older session");
    const cuts: Keychain = {
      ...k.keychain,
      // Keeps part of it, as security -i does past its line length.
      write: async (secret) => (k.set(secret.slice(0, 10)), true),
    };
    await writeCredentials({ env, keychain: cuts }, SESSION);
    assert.equal(k.held(), null);
    assert.deepEqual(await readCredentials({ env, keychain: cuts }), SESSION);
  });

  it("writes no file, and says so, when the keychain will not give up an old item (review of #1676)", async () => {
    const env = place();
    const stuck: Keychain = {
      read: async () => JSON.stringify({ ...SESSION, refresh_token: "old" }),
      write: async () => false,
      remove: async () => false,
    };
    await assert.rejects(
      writeCredentials({ env, keychain: stuck }, SESSION),
      /holds a brood session it will not let go of/,
    );
    assert.equal(existsSync(credentialsPath(env)), false);
  });

  it("writes the file where no keychain answers at all, as on a Linux server with no keyring (review of #1676)", async () => {
    const env = place();
    const none: Keychain = {
      read: async () => null,
      write: async () => false,
      remove: async () => false,
    };
    await writeCredentials({ env, keychain: none }, SESSION);
    assert.deepEqual(await readCredentials({ env, keychain: none }), SESSION);
    await removeCredentials({ env, keychain: none });
    assert.equal(existsSync(credentialsPath(env)), false);
  });

  it("forgets the session in the keychain and in any file", async () => {
    const env = place();
    const k = memory();
    await writeCredentials({ env, keychain: k.keychain }, SESSION);
    mkdirSync(join(env.XDG_CONFIG_HOME, "brood"), { recursive: true });
    writeFileSync(credentialsPath(env), JSON.stringify(SESSION), {
      mode: 0o600,
    });
    await removeCredentials({ env, keychain: k.keychain });
    assert.equal(k.held(), null);
    assert.equal(existsSync(credentialsPath(env)), false);
    assert.equal(await readCredentials({ env, keychain: k.keychain }), null);
  });
});
