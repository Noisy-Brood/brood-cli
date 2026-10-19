import { SIGN_IN } from "./brood/api/src/client.ts";
import { clean, isRecord, Refusal, SessionEnded, type Io } from "./io.ts";
import {
  readCredentials,
  removeCredentials,
  writeCredentials,
  type Credentials,
} from "./store.ts";
import { colorOn } from "./out.ts";
import { depthOf, wrenIn } from "./wren.ts";

/**
 * Signing in with Clerk's device authorization grant (DD10 §6, DD21 §4): a
 * code shown here and approved in a browser, so no secret is ever typed into
 * a terminal. The access token lasts a day; the refresh token beside it gets
 * the next, and Clerk gives a new one each time it is used.
 */

const CLIENT_ID = SIGN_IN.clients.cli;
const TOKEN_URL = `${SIGN_IN.issuer}/oauth/token`;
const DEVICE_URL = `${SIGN_IN.issuer}/oauth/device_authorization`;
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
/** Refreshed this long before it expires, so a call is not made on a token about to lapse. */
const EARLY_MS = 60_000;

async function post(
  io: Io,
  url: string,
  fields: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await io.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });
  } catch {
    throw new Refusal(
      "Could not reach the sign-in service. Check the connection and try again.",
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body: isRecord(body) ? body : {} };
}

/** A token answer as Credentials, or null when it is not one. */
function credentialsOf(
  body: Record<string, unknown>,
  now: number,
): Credentials | null {
  const { access_token, refresh_token, expires_in, scope } = body;
  if (
    typeof access_token !== "string" ||
    typeof refresh_token !== "string" ||
    typeof expires_in !== "number" ||
    typeof scope !== "string"
  )
    return null;
  return {
    access_token,
    refresh_token,
    expires_at: now + expires_in * 1000,
    scope,
  };
}

const acts = (scope: string) => scope.split(" ").includes("act");

export async function login(
  io: Io,
  readOnly: boolean,
  noColor = false,
): Promise<void> {
  if (await readCredentials(io.env))
    throw new Refusal(
      "Already signed in. Run brood logout first, which ends this session.",
    );
  const scope = readOnly ? "read offline_access" : "read act offline_access";
  const started = await post(io, DEVICE_URL, { client_id: CLIENT_ID, scope });
  const { device_code, user_code, verification_uri, expires_in, interval } =
    started.body;
  if (
    typeof device_code !== "string" ||
    typeof user_code !== "string" ||
    typeof verification_uri !== "string" ||
    typeof expires_in !== "number"
  )
    throw new Refusal(
      "The sign-in service would not start a sign-in. Try again shortly.",
    );

  io.err(
    `Open ${clean(verification_uri)} and enter the code ${clean(user_code)}.`,
  );
  io.err("Waiting for you to approve it there.");

  let wait = (typeof interval === "number" ? interval : 5) * 1000;
  const deadline = io.now() + expires_in * 1000;
  while (io.now() < deadline) {
    await io.sleep(wait);
    const answer = await post(io, TOKEN_URL, {
      grant_type: DEVICE_GRANT,
      device_code,
      client_id: CLIENT_ID,
    });
    const error = answer.body.error;
    if (error === "authorization_pending") continue;
    // RFC 8628 §3.5: a client told to slow down waits five seconds longer from then on.
    if (error === "slow_down") {
      wait += 5000;
      continue;
    }
    if (error === "access_denied")
      throw new Refusal("The sign-in was declined.");
    if (error === "expired_token") break;
    const credentials = credentialsOf(answer.body, io.now());
    if (!credentials)
      throw new Refusal(
        "The sign-in service did not finish the sign-in. Run brood login again.",
      );
    await writeCredentials(io.env, credentials);
    const color = colorOn(io, noColor);
    for (const line of wrenIn(color ? depthOf(io.env) : "none")) io.err(line);
    io.err("");
    io.err(
      acts(credentials.scope)
        ? "Signed in. brood can read your index, and hush and unhush senders."
        : "Signed in. brood can read your index, and change nothing.",
    );
    return;
  }
  throw new Refusal(
    "The code expired before it was approved. Run brood login again.",
  );
}

/** The session, refreshed first if its access token is about to expire. */
export async function freshCredentials(io: Io): Promise<Credentials> {
  const stored = await readCredentials(io.env);
  if (!stored) throw new Refusal("Not signed in. Run brood login.");
  return stored.expires_at - EARLY_MS > io.now() ? stored : refresh(io, stored);
}

/** A new access token from the refresh token, kept with the new refresh token Clerk gives. */
export async function refresh(
  io: Io,
  stored: Credentials,
): Promise<Credentials> {
  const answer = await post(io, TOKEN_URL, {
    grant_type: "refresh_token",
    refresh_token: stored.refresh_token,
    client_id: CLIENT_ID,
  });
  const credentials = credentialsOf(answer.body, io.now());
  if (credentials) {
    await writeCredentials(io.env, credentials);
    return credentials;
  }
  if (answer.body.error === "invalid_grant") {
    // The session is over at Clerk, so the file holds nothing that works.
    await removeCredentials(io.env);
    throw new SessionEnded(
      "This session has ended. Run brood login to sign in again.",
    );
  }
  throw new Refusal(
    "The sign-in service would not renew this session. Try again shortly.",
  );
}
