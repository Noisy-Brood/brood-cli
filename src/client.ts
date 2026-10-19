import {
  API_BASE,
  PROBLEM_CODES,
  PROBLEM_TITLES,
  type Answers,
  type Arguments,
  type Envelope,
  type OperationName,
  type Problem,
} from "./brood/api/src/client.ts";
import { clean, cleaned, isRecord, Refused, Refusal, type Io } from "./io.ts";
import { freshCredentials, refresh } from "./sign-in.ts";
import { VERSION } from "./version.ts";
import type { Credentials } from "./store.ts";

const isProblem = (v: unknown): v is Problem =>
  isRecord(v) &&
  typeof v.status === "number" &&
  typeof v.title === "string" &&
  PROBLEM_CODES.some((c) => c === v.code);

const isEnvelope = (v: unknown): v is Envelope<unknown> =>
  isRecord(v) &&
  isRecord(v.data) &&
  Array.isArray(v.accounts) &&
  v.accounts.every(
    (a) =>
      isRecord(a) &&
      typeof a.id === "string" &&
      isRecord(a.sync) &&
      typeof a.sync.phase === "string" &&
      typeof a.whole === "boolean",
  ) &&
  typeof v.complete === "boolean" &&
  (v.next === undefined || typeof v.next === "string");

/** A problem as the person reads it: what happened, and what to do. */
function refusalOf(problem: Problem, retryAfter: string | null): Refusal {
  switch (problem.code) {
    case "credential_revoked":
      return new Refusal(
        "brood was revoked on your account page, or went unused too long. Allow it again there to carry on.",
      );
    case "insufficient_scope":
      return new Refusal(
        "This session may only read. Run brood logout, then brood login without --read-only.",
      );
    case "rate_limited":
      // The day's rule changes have a reason the server gives; the minute's
      // limit has only its wait.
      return new Refusal(
        problem.detail
          ? `${PROBLEM_TITLES.rate_limited.title}. ${problem.detail}`
          : retryAfter
            ? `${PROBLEM_TITLES.rate_limited.title}. Try again in ${clean(retryAfter)} seconds.`
            : `${PROBLEM_TITLES.rate_limited.title}. Try again in a minute.`,
      );
    case "invalid_argument":
      return new Refusal(
        `${PROBLEM_TITLES.invalid_argument.title}: ${problem.detail ?? "the request"}.`,
      );
    default:
      return new Refusal(
        problem.detail
          ? `${PROBLEM_TITLES[problem.code].title}. ${problem.detail}`
          : `${PROBLEM_TITLES[problem.code].title}.`,
      );
  }
}

async function send(
  io: Io,
  operation: OperationName,
  args: unknown,
  credentials: Credentials,
): Promise<{ status: number; body: unknown; retryAfter: string | null }> {
  let response: Response;
  try {
    response = await io.fetch(`${API_BASE}/${operation}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credentials.access_token}`,
        "content-type": "application/json",
        // DD21 §11: so the gate can refuse a version known to be broken.
        "user-agent": `brood-cli/${VERSION}`,
      },
      body: JSON.stringify(args),
    });
  } catch {
    throw new Refusal(
      "Could not reach Brood. Check the connection and try again.",
    );
  }
  let body: unknown;
  try {
    // Cleaned as it arrives: a sender writes its own address, name and
    // domain, so no printer can be the one that forgot (DD21 §8).
    body = cleaned(await response.json());
  } catch {
    body = null;
  }
  return {
    status: response.status,
    body,
    retryAfter: response.headers.get("retry-after"),
  };
}

/**
 * Calls one operation as the signed-in person. A token Brood refuses as
 * unauthenticated is refreshed once and the call made again, since an
 * access token can lapse between the check and the call.
 */
export async function call<K extends OperationName>(
  io: Io,
  operation: K,
  args: Arguments[K] | ((held: Credentials) => Arguments[K]),
): Promise<Envelope<Answers[K]>> {
  // Arguments may be read from the session, as logging out's refresh token
  // is: after a refresh, it must be the new one that is ended.
  const of = (c: Credentials) => (typeof args === "function" ? args(c) : args);
  let held = await freshCredentials(io);
  let answer = await send(io, operation, of(held), held);
  if (
    answer.status === 401 &&
    isProblem(answer.body) &&
    answer.body.code === "unauthenticated"
  ) {
    held = await refresh(io, held);
    answer = await send(io, operation, of(held), held);
  }
  if (isProblem(answer.body))
    throw new Refused(
      refusalOf(answer.body, answer.retryAfter).message,
      answer.body.code,
    );
  if (answer.status !== 200 || !isEnvelope(answer.body))
    throw new Refusal("Brood's answer could not be read. Try again shortly.");
  // The envelope's shape is checked above, and its data taken as the
  // operation's answer as packages/api types it: the app is built against the
  // same types, and v1 grows only by addition (DD21 §11), so a field this
  // client reads is one the API still sends.
  return answer.body as Envelope<Answers[K]>;
}
