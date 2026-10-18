import assert from "node:assert/strict";
import { chmodSync, existsSync, statSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { run } from "./main.ts";
import {
  DEVICE_URL,
  NOW,
  SESSION,
  TOKEN_URL,
  api,
  envelope,
  json,
  problem,
  signedIn,
  standIn,
  tokens,
} from "./stand-in.test-support.ts";
import { credentialsPath, readCredentials } from "./store.ts";

/**
 * Signing in, staying signed in and signing out (DD10 §6, #1339): the
 * device grant as Clerk answers it, the session kept where only its owner
 * can read it, refreshed before it lapses, and ended at Brood on logout.
 */

const started = () =>
  json(200, {
    device_code: "device-1",
    user_code: "ABCD-EFGH",
    verification_uri: "https://accounts.example.test/device",
    expires_in: 600,
    interval: 5,
  });

describe("brood login (#1339)", () => {
  it("shows the code, waits as Clerk asks, and keeps the session where only its owner can read it", async () => {
    const s = standIn({
      [DEVICE_URL]: [started],
      [TOKEN_URL]: [
        () => json(400, { error: "authorization_pending" }),
        () => json(400, { error: "slow_down" }),
        () => tokens("one"),
      ],
    });
    assert.equal(await run(s.io, ["login"]), 0);
    assert.match(s.sent[0]!.body, /scope=read\+act\+offline_access/);
    assert.ok(
      s.err.some(
        (l) =>
          l.includes("ABCD-EFGH") &&
          l.includes("https://accounts.example.test/device"),
      ),
    );
    // RFC 8628: slow_down adds five seconds to every wait after it.
    assert.deepEqual(s.slept, [5000, 5000, 10000]);
    const stored = await readCredentials(s.io.env);
    assert.equal(stored?.refresh_token, "refresh-one");
    assert.equal(stored?.expires_at, NOW + 20_000 + 86_400_000);
    assert.equal(statSync(credentialsPath(s.io.env)).mode & 0o777, 0o600);
    assert.ok(s.err.some((l) => l.includes("hush and unhush")));
    assert.ok(
      ![...s.out, ...s.err].some(
        (l) => l.includes("refresh-one") || l.includes("access-one"),
      ),
    );
  });

  it("asks for read alone with --read-only, and says it can change nothing", async () => {
    const s = standIn({
      [DEVICE_URL]: [started],
      [TOKEN_URL]: [() => tokens("one", "read offline_access")],
    });
    assert.equal(await run(s.io, ["login", "--read-only"]), 0);
    assert.match(s.sent[0]!.body, /scope=read\+offline_access(&|$)/);
    assert.ok(s.err.some((l) => l.includes("change nothing")));
  });

  it("refuses while signed in, so no session is left running unseen", async () => {
    const s = await signedIn({});
    assert.equal(await run(s.io, ["login"]), 1);
    assert.deepEqual(s.sent, []);
    assert.ok(s.err.some((l) => l.includes("brood logout first")));
  });

  it("says so when the code expires, and keeps nothing", async () => {
    const s = standIn({
      [DEVICE_URL]: [started],
      [TOKEN_URL]: [() => json(400, { error: "expired_token" })],
    });
    assert.equal(await run(s.io, ["login"]), 1);
    assert.ok(s.err.some((l) => l.includes("expired before it was approved")));
    assert.equal(await readCredentials(s.io.env), null);
  });

  it("says so when the sign-in is declined", async () => {
    const s = standIn({
      [DEVICE_URL]: [started],
      [TOKEN_URL]: [() => json(400, { error: "access_denied" })],
    });
    assert.equal(await run(s.io, ["login"]), 1);
    assert.ok(s.err.some((l) => l.includes("declined")));
  });
});

describe("the stored session (#1339)", () => {
  it("refuses a file others can read, rather than use it", async () => {
    const s = await signedIn({});
    chmodSync(credentialsPath(s.io.env), 0o644);
    assert.equal(await run(s.io, ["accounts"]), 1);
    assert.ok(s.err.some((l) => l.includes("can be read by others")));
    assert.deepEqual(s.sent, []);
  });

  it("refuses a file brood did not write", async () => {
    const s = await signedIn({});
    writeFileSync(credentialsPath(s.io.env), "{}", { mode: 0o600 });
    assert.equal(await run(s.io, ["accounts"]), 1);
    assert.ok(s.err.some((l) => l.includes("not a session brood wrote")));
  });

  it("is renewed before a call when its access token is about to lapse, keeping the new refresh token", async () => {
    const s = await signedIn(
      {
        [TOKEN_URL]: [() => tokens("two")],
        [api("list_accounts")]: [() => envelope({ accounts: [] })],
      },
      { ...SESSION, expires_at: NOW + 30_000 },
    );
    assert.equal(await run(s.io, ["accounts"]), 0);
    assert.match(
      s.sent[0]!.body,
      /grant_type=refresh_token&refresh_token=refresh-one/,
    );
    assert.equal(s.sent[1]!.headers.authorization, "Bearer access-two");
    assert.equal(
      (await readCredentials(s.io.env))?.refresh_token,
      "refresh-two",
    );
  });

  it("is renewed once when Brood finds the token lapsed, and the call made again", async () => {
    const s = await signedIn({
      [TOKEN_URL]: [() => tokens("two")],
      [api("list_accounts")]: [
        () => problem(401, "unauthenticated"),
        () => envelope({ accounts: [] }),
      ],
    });
    assert.equal(await run(s.io, ["accounts"]), 0);
    assert.equal(
      s.sent.filter((x) => x.url === api("list_accounts")).length,
      2,
    );
    assert.equal(s.sent.at(-1)!.headers.authorization, "Bearer access-two");
  });

  it("is renewed only once, then the refusal is said", async () => {
    const s = await signedIn({
      [TOKEN_URL]: [() => tokens("two")],
      [api("list_accounts")]: [
        () => problem(401, "unauthenticated"),
        () => problem(401, "unauthenticated"),
      ],
    });
    assert.equal(await run(s.io, ["accounts"]), 1);
    assert.ok(s.err.some((l) => l.includes("Not signed in")));
  });

  it("is removed once Clerk says it has ended", async () => {
    const s = await signedIn(
      { [TOKEN_URL]: [() => json(400, { error: "invalid_grant" })] },
      { ...SESSION, expires_at: NOW },
    );
    assert.equal(await run(s.io, ["accounts"]), 1);
    assert.ok(s.err.some((l) => l.includes("brood login to sign in again")));
    assert.equal(existsSync(credentialsPath(s.io.env)), false);
  });

  it("names the version it is, for the gate", async () => {
    const s = await signedIn({
      [api("list_accounts")]: [() => envelope({ accounts: [] })],
    });
    await run(s.io, ["accounts"]);
    assert.match(
      s.sent[0]!.headers["user-agent"] ?? "",
      /^brood-cli\/\d+\.\d+\.\d+$/,
    );
  });
});

describe("brood logout (#1339)", () => {
  it("ends the session at Brood with its refresh token, then forgets it", async () => {
    const s = await signedIn({
      [api("end_session")]: [() => envelope({ ended: true }, { accounts: [] })],
    });
    assert.equal(await run(s.io, ["logout"]), 0);
    assert.deepEqual(JSON.parse(s.sent[0]!.body), {
      refresh_token: "refresh-one",
    });
    assert.equal(existsSync(credentialsPath(s.io.env)), false);
  });

  it("ends the refresh token it holds after a renewal, not the one renewed away", async () => {
    const s = await signedIn({
      [TOKEN_URL]: [() => tokens("two")],
      [api("end_session")]: [
        () => problem(401, "unauthenticated"),
        () => envelope({ ended: true }, { accounts: [] }),
      ],
    });
    assert.equal(await run(s.io, ["logout"]), 0);
    assert.deepEqual(JSON.parse(s.sent.at(-1)!.body), {
      refresh_token: "refresh-two",
    });
  });

  it("keeps the session when Brood could not end it, and says so", async () => {
    const s = await signedIn({
      [api("end_session")]: [() => problem(500, "internal")],
    });
    assert.equal(await run(s.io, ["logout"]), 1);
    assert.equal(existsSync(credentialsPath(s.io.env)), true);
    assert.ok(!s.err.some((l) => l.includes("Signed out")));
  });

  it("signs out when the session had already ended at Clerk", async () => {
    const s = await signedIn(
      { [TOKEN_URL]: [() => json(400, { error: "invalid_grant" })] },
      { ...SESSION, expires_at: NOW },
    );
    assert.equal(await run(s.io, ["logout"]), 0);
    assert.ok(s.err.some((l) => l.includes("Signed out")));
  });
});

describe("a revoked program (#1339)", () => {
  it("can log out, and so sign in again, rather than be locked out of both", async () => {
    const s = await signedIn({
      [api("end_session")]: [() => problem(401, "credential_revoked")],
    });
    assert.equal(await run(s.io, ["logout"]), 0);
    assert.equal(existsSync(credentialsPath(s.io.env)), false);
    assert.ok(s.err.some((l) => l.startsWith("Signed out")));
  });
});

describe("signing in, finished (#1339)", () => {
  it("shows the wren once, on standard error, beside the sentence saying what brood may do", async () => {
    const { wrenArt } = await import("./wren.ts");
    const s = standIn({
      [DEVICE_URL]: [started],
      [TOKEN_URL]: [() => tokens("one")],
    });
    await run(s.io, ["login"]);
    const at = s.err.indexOf(wrenArt()[0]!);
    assert.ok(at > 0);
    assert.deepEqual(s.err.slice(at, at + wrenArt().length), wrenArt());
    assert.deepEqual(s.out, []);
  });
});

describe("a renewed session Brood still refuses (#1339)", () => {
  it("is kept, since its new refresh token may be live at Clerk and nothing ended it", async () => {
    const s = await signedIn({
      [TOKEN_URL]: [() => tokens("two")],
      [api("end_session")]: [
        () => problem(401, "unauthenticated"),
        () => problem(401, "unauthenticated"),
      ],
    });
    assert.equal(await run(s.io, ["logout"]), 1);
    assert.equal(
      (await readCredentials(s.io.env))?.refresh_token,
      "refresh-two",
    );
    assert.ok(!s.err.some((l) => l.startsWith("Signed out")));
  });
});

describe("signing in without colour (#1339)", () => {
  it("draws the wren uncoloured with --no-color", async () => {
    const s = standIn({
      [DEVICE_URL]: [started],
      [TOKEN_URL]: [() => tokens("one")],
    });
    s.io.tty = true;
    s.io.env.COLORTERM = "truecolor";
    assert.equal(await run(s.io, ["login", "--no-color"]), 0);
    assert.ok(!s.err.some((l) => l.includes("\u001b")));
  });
});

describe("forgetting the session (#1339)", () => {
  it("removes a draft a stopped write left beside the file, which holds a token too", async () => {
    const { readdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    const s = await signedIn({
      [api("end_session")]: [() => envelope({ ended: true }, { accounts: [] })],
    });
    const path = credentialsPath(s.io.env);
    writeFileSync(`${path}.left-by-a-crash.tmp`, "refresh-stale", {
      mode: 0o600,
    });
    assert.equal(await run(s.io, ["logout"]), 0);
    assert.deepEqual(readdirSync(dirname(path)), []);
  });
});
