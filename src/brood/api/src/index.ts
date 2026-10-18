import {
  API_ACTS_PER_MINUTE,
  API_CALLS_PER_MINUTE,
  API_PAGE_MAX,
  API_UNUSED_DAYS,
  API_STRETCH_DAYS,
  PORTRAIT_DAYS,
  QUIET_REGULAR_MIN_MONTHS,
  QUIET_REGULAR_MONTHS,
  RETENTION_DAYS,
} from "../../figures/index.ts";

/**
 * The API's one list of operations (DD21 §1): each name, the scope it needs,
 * what it does and what each of its arguments means, and the types and
 * narrowing of its arguments and answer. `apps/web` implements it, behind one
 * gate; the CLI and the MCP server call it, so a client cannot call an
 * operation this list does not have; and the docs' reference is rendered from
 * it (#1344): what an operation is called with is said where it is
 * defined, and its arguments are narrowed by the keys described. It grows
 * by addition within v1 (DD21 §11): an operation is listed here in the
 * change that implements it.
 *
 * Arguments arrive as JSON from outside, so each is narrowed by hand, as
 * conventions/typescript.md asks of a value from an edge, rather than with a
 * schema library, which would be a dependency in the path of every request.
 * The keys an operation accepts are the keys its `arguments` describe, so an
 * argument cannot be accepted without being documented.
 */

/** Where every operation is called, by POST with its arguments in the body (DD21 §2, §3). */
export const API_BASE = "https://app.noisybrood.com/api/v1";

/**
 * Where a client signs in (DD21 §4): Clerk's OAuth server for the production
 * instance, and each client's id there. A client id is not a secret: a public
 * client is known by it alone, and ships it (#1354).
 */
export const SIGN_IN = {
  issuer: "https://clerk.app.noisybrood.com",
  clients: { cli: "P029s9c7VAQInceB" },
} as const;

export * from "./values.ts";
import {
  ADDRESSED,
  CLASSIFICATION_STATES,
  DIRECTIONS,
  SHOWN,
  SUBJECT_KINDS,
  listed,
  type ClassificationReason,
  type ClassificationState,
  type SenderScope,
  type SenderTag,
  type Tone,
} from "./values.ts";

/** DD10 §6's two scopes; `act` covers `read`. */
export type Scope = "read" | "act";

const OWNER =
  "The person whose index to read, by their user id, for a helper they have granted access. Leave it out to read your own.";
const LIMIT = `How many to return, from 1 to ${API_PAGE_MAX}.`;
const CURSOR =
  "Where to carry on from: the `next` of the page before. Leave it out for the first page.";
const SINCE = `The first day of the stretch, as YYYY-MM-DD in UTC. Leave it out for the ${API_STRETCH_DAYS} days ending \`until\`.`;
const UNTIL =
  "The last day of the stretch, as YYYY-MM-DD in UTC, counted whole. Leave it out for today.";

export const OPERATIONS = {
  describe_index: {
    scope: "read",
    cli: null,
    mcp: "describe_index",
    description:
      "What Brood's index holds and never holds, and the state of each mailbox it reads. Call it first: it says whether answers can be trusted to be whole.",
    arguments: { owner: OWNER },
  },
  list_accounts: {
    scope: "read",
    cli: "brood accounts",
    mcp: null,
    description:
      "The mailboxes connected to Brood, each with its address and whether Brood can still read it.",
    arguments: { owner: OWNER },
  },
  summarise_week: {
    scope: "read",
    cli: "brood week",
    mcp: "summarise_week",
    description:
      "One finished week, Monday to Sunday in UTC: how it compared with the week before, who wrote most, who wrote for the first time, and the classifications Brood proposed and quieted.",
    arguments: {
      owner: OWNER,
      week: `The week's Monday, as YYYY-MM-DD, finished and within the last ${PORTRAIT_DAYS} days. Leave it out for the most recent finished week.`,
    },
  },
  get_sender: {
    scope: "read",
    cli: "brood senders <address|domain>",
    mcp: "get_sender",
    description:
      "One sender: how much it writes, by week and by month, its addresses and what files each, whether you have written to it, and the classifications that cover it.",
    arguments: {
      owner: OWNER,
      sender: "The sender's id, as another answer gave it.",
      scope:
        "`domain`, the default, for everything from the sender's domain, or `address` for the one address.",
    },
  },
  list_classifications: {
    scope: "read",
    cli: "brood classifications [<path>]",
    mcp: "list_classifications",
    description:
      "Classifications, oldest proposed first: where Brood files mail, what each covers, and what was decided about it.",
    arguments: {
      owner: OWNER,
      state: `Only those in this state, one of ${listed(CLASSIFICATION_STATES)}. Leave it out for all of them.`,
      path: "Only this path and the paths inside it, such as `external` for `external/stripe`.",
      limit: LIMIT,
      cursor: CURSOR,
    },
  },
  get_classification: {
    scope: "read",
    cli: "brood classification <id>",
    mcp: "get_classification",
    description:
      "One classification: what it covers, the classifications around it, the mailboxes it files in, what it filed by week, and the messages moved out of it.",
    arguments: {
      owner: OWNER,
      id: "The classification's id, as another answer gave it.",
    },
  },
  list_senders: {
    scope: "read",
    cli: "brood senders",
    mcp: "list_senders",
    description: `Who wrote over a stretch of time, by root domain (by address under a mail provider's domain or your own), most messages first, each with when it first and last wrote within it. Inside the last ${RETENTION_DAYS} days the counts are by the day; a stretch reaching further back is counted by the whole month, and the answer says which in \`resolution\`.`,
    arguments: {
      owner: OWNER,
      since: SINCE,
      until: UNTIL,
      limit: LIMIT,
      cursor: CURSOR,
    },
  },
  list_events: {
    scope: "read",
    cli: "brood events",
    mcp: "list_events",
    description: `Messages that arrived or were sent, newest first: when, which way, and the facts about each, never what it said. The index keeps ${RETENTION_DAYS} days of them; \`retained_from\` says how far back this answer could reach.`,
    arguments: {
      owner: OWNER,
      since: SINCE,
      until: UNTIL,
      sender:
        "Only messages from or to this sender, by the id another answer gave it.",
      scope:
        "With `sender`: `domain`, the default, for everything from the sender's root domain, or `address` for the one address. Under a mail provider's domain or your own, `domain` is the one address too, since everyone on it is someone else.",
      limit: LIMIT,
      cursor: CURSOR,
    },
  },
  list_quiet_senders: {
    scope: "read",
    cli: "brood quiet",
    mcp: "list_quiet_senders",
    description: `Senders that have gone silent, by root domain (by address under a mail provider's domain or your own), most recently silent first: each wrote in at least ${QUIET_REGULAR_MIN_MONTHS} of the ${QUIET_REGULAR_MONTHS} months up to its last message, and nothing since for the silence window the answer names in \`silence_days\`.`,
    arguments: { owner: OWNER, limit: LIMIT, cursor: CURSOR },
  },
  list_rules: {
    scope: "read",
    cli: "brood rules",
    mcp: "list_rules",
    description:
      "The filters Brood installed in each mailbox, oldest first: what each files, the senders it leaves out, and whether it is still in place.",
    arguments: {
      owner: OWNER,
      classification: "Only the rules of this classification, by its id.",
      limit: LIMIT,
      cursor: CURSOR,
    },
  },
  get_rule: {
    scope: "read",
    cli: "brood rules <id>",
    mcp: "get_rule",
    description:
      "One filter Brood installed: what it files, the senders it leaves out, and whether it is still in place.",
    arguments: {
      owner: OWNER,
      id: "The rule's id, as another answer gave it.",
    },
  },
  hush: {
    scope: "act",
    cli: "brood hush",
    mcp: null,
    description:
      "Files a classification Brood proposed out of your inbox: Brood installs its filter in each mailbox its mail arrived in, and files what is already there. One you declined or undid is proposed again, then filed; one that took over a filter of your own is not Brood's to hush. Brood never files a sender your never-quiet list keeps in view. Hushing one already filed answers its rules.",
    arguments: {
      owner: OWNER,
      classification: "The classification's id, as another answer gave it.",
    },
  },
  unhush: {
    scope: "act",
    cli: "brood unhush",
    mcp: null,
    description:
      "Undoes a filing: Brood removes its filters, declines it, and brings its mail back to your inbox, the first of it at once and the rest within the hour. One that took over a filter of your own puts your filter back instead, and moves no mail. Unhushing one not filed changes nothing.",
    arguments: {
      owner: OWNER,
      classification: "The classification's id, as another answer gave it.",
    },
  },
  end_session: {
    scope: "read",
    cli: "brood logout",
    mcp: null,
    description:
      "Ends this client's session: its refresh token stops working, so no new access token can be had from it. An access token already issued lasts until it expires, within a day; to shut a program out at once, revoke it on the account page. The client stays allowed, so signing in again starts a new session. The answer reads no mailbox.",
    arguments: {
      refresh_token:
        "The client's own refresh token, passed to the sign-in service to end, and never kept.",
    },
  },
} as const satisfies Record<
  string,
  {
    /** The CLI command that will call it (DD10 §3), or null for none. */
    cli: string | null;
    description: string;
    arguments: Record<string, string>;
  } & (
    | {
        scope: "read";
        /** The MCP tool that will call it (DD8 §2), or null. */ mcp:
          string | null;
      }
    // An operation that acts has no MCP tool, ever (DD8 §3): the type holds it.
    | { scope: "act"; mcp: null }
  )
>;

/**
 * Which clients a reader can have yet. The reference names an operation's
 * command or tool only once its client can be installed: the CLI is built
 * and runs from the repository, and becomes true when it is published
 * (#1367); the MCP server is not built (#297). So the reference never points
 * a reader at a client they cannot have.
 */
export const CLIENTS_BUILT = { cli: false, mcp: false } as const;

export type OperationName = keyof typeof OPERATIONS;

/** Every operation's name, in the list's order, for a reader that walks them all. */
// The keys of a literal object whose keys are known: `Object.keys` types them
// as string, and they are exactly OperationName (conventions/typescript.md).
export const OPERATION_NAMES = Object.keys(OPERATIONS) as OperationName[];

export const isOperation = (name: string): name is OperationName =>
  Object.hasOwn(OPERATIONS, name);

/** A narrowing's answer: the value, or the argument that failed, never its value. */
export type Narrowed<T> =
  { ok: true; value: T } | { ok: false; argument: string };

const ok = <T>(value: T): Narrowed<T> => ({ ok: true, value });
const fail = (argument: string): { ok: false; argument: string } => ({
  ok: false,
  argument,
});

/** What every operation may take: whose index (D23 §5). None means the caller's own. */
export type OwnerArgument = { owner?: string };

/** A listing's page (DD21 §6): how many, and where to carry on from. */
export type PageArguments = { limit?: number; cursor?: string };

export type Arguments = {
  describe_index: OwnerArgument;
  list_accounts: OwnerArgument;
  summarise_week: OwnerArgument & { week?: string };
  get_sender: OwnerArgument & { sender: string; scope?: SenderScope };
  list_classifications: OwnerArgument &
    PageArguments & { state?: ClassificationState; path?: string };
  get_classification: OwnerArgument & { id: string };
  list_senders: OwnerArgument & PageArguments & Stretch;
  list_events: OwnerArgument &
    PageArguments &
    Stretch & { sender?: string; scope?: SenderScope };
  list_quiet_senders: OwnerArgument & PageArguments;
  list_rules: OwnerArgument & PageArguments & { classification?: string };
  get_rule: OwnerArgument & { id: string };
  end_session: { refresh_token: string };
  hush: OwnerArgument & { classification: string };
  unhush: OwnerArgument & { classification: string };
};

/** A stretch of whole UTC days, each as YYYY-MM-DD, both counted. */
export type Stretch = { since?: string; until?: string };

/** An opaque id: what an `owner` may be, and nothing else. */
const OPAQUE = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A cursor is Brood's own encoding; nothing longer or stranger is one. */
const CURSOR_SHAPE = /^[A-Za-z0-9_-]{1,4096}$/;
/**
 * A path as the app builds one: `external/` and a root's name, a domain, or
 * a sender's whole address, whose local part may hold almost anything. So
 * any printable text, no control character, up to the longest it can be.
 */
const PATH = /^[^\u0000-\u001f\u007f]{1,512}$/u;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A token as an OAuth server issues one: printable, with no space, and bounded. */
const TOKEN = /^[\x21-\x7e]{1,4096}$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The body's fields, or the first key it has that the operation does not describe. */
function fieldsOf(
  body: unknown,
  operation: OperationName,
): Narrowed<Record<string, unknown>> {
  if (body === undefined || body === null) return ok({});
  if (!isRecord(body)) return fail("body");
  const known = Object.keys(OPERATIONS[operation].arguments);
  for (const key of Object.keys(body))
    if (!known.includes(key)) return fail(key);
  return ok(body);
}

function ownerOf(f: Record<string, unknown>): Narrowed<OwnerArgument> {
  const owner = f.owner;
  if (owner === undefined) return ok({});
  return typeof owner === "string" && OPAQUE.test(owner)
    ? ok({ owner })
    : fail("owner");
}

function pageOf(f: Record<string, unknown>): Narrowed<PageArguments> {
  const { limit, cursor } = f;
  if (
    limit !== undefined &&
    !(
      typeof limit === "number" &&
      Number.isInteger(limit) &&
      limit >= 1 &&
      limit <= API_PAGE_MAX
    )
  )
    return fail("limit");
  if (
    cursor !== undefined &&
    !(typeof cursor === "string" && CURSOR_SHAPE.test(cursor))
  )
    return fail("cursor");
  return ok({
    ...(limit === undefined ? {} : { limit }),
    ...(cursor === undefined ? {} : { cursor }),
  });
}

/** A day as YYYY-MM-DD that exists. */
const isDay = (v: unknown): v is string => {
  if (typeof v !== "string" || !DAY.test(v)) return false;
  const day = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === v;
};

/** `since` and `until` as days that exist, `since` not after `until`. */
function stretchOf(f: Record<string, unknown>): Narrowed<Stretch> {
  const { since, until } = f;
  if (since !== undefined && !isDay(since)) return fail("since");
  if (until !== undefined && !isDay(until)) return fail("until");
  if (isDay(since) && isDay(until) && since > until) return fail("since");
  return ok({
    ...(isDay(since) ? { since } : {}),
    ...(isDay(until) ? { until } : {}),
  });
}

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && UUID.test(v);

/** Only the owner: the operations that take nothing else. */
const ownerOnly =
  (operation: "describe_index" | "list_accounts") =>
  (body: unknown): Narrowed<OwnerArgument> => {
    const f = fieldsOf(body, operation);
    return f.ok ? ownerOf(f.value) : f;
  };

/** An owner and a classification's id: what acting on one takes. */
const classificationOnly =
  (operation: "hush" | "unhush") =>
  (body: unknown): Narrowed<OwnerArgument & { classification: string }> => {
    const f = fieldsOf(body, operation);
    if (!f.ok) return f;
    const owner = ownerOf(f.value);
    if (!owner.ok) return owner;
    const classification = f.value.classification;
    return isUuid(classification)
      ? ok({ ...owner.value, classification })
      : fail("classification");
  };

/** Each operation's arguments, narrowed. */
export const ARGUMENTS: {
  [K in OperationName]: (body: unknown) => Narrowed<Arguments[K]>;
} = {
  describe_index: ownerOnly("describe_index"),
  list_accounts: ownerOnly("list_accounts"),
  summarise_week(body) {
    const f = fieldsOf(body, "summarise_week");
    if (!f.ok) return f;
    const owner = ownerOf(f.value);
    if (!owner.ok) return owner;
    const week = f.value.week;
    if (week === undefined) return ok(owner.value);
    return typeof week === "string" && DAY.test(week)
      ? ok({ ...owner.value, week })
      : fail("week");
  },
  get_sender(body) {
    const f = fieldsOf(body, "get_sender");
    if (!f.ok) return f;
    const owner = ownerOf(f.value);
    if (!owner.ok) return owner;
    const { sender, scope = "domain" } = f.value;
    if (!isUuid(sender)) return fail("sender");
    if (scope !== "domain" && scope !== "address") return fail("scope");
    return ok({ ...owner.value, sender, scope });
  },
  list_classifications(body) {
    const f = fieldsOf(body, "list_classifications");
    if (!f.ok) return f;
    const owner = ownerOf(f.value);
    if (!owner.ok) return owner;
    const page = pageOf(f.value);
    if (!page.ok) return page;
    const { state, path } = f.value;
    const known = CLASSIFICATION_STATES.find((s) => s === state);
    if (state !== undefined && known === undefined) return fail("state");
    if (path !== undefined && !(typeof path === "string" && PATH.test(path)))
      return fail("path");
    return ok({
      ...owner.value,
      ...page.value,
      ...(known === undefined ? {} : { state: known }),
      ...(typeof path === "string" ? { path } : {}),
    });
  },
  get_classification(body) {
    const f = fieldsOf(body, "get_classification");
    if (!f.ok) return f;
    const owner = ownerOf(f.value);
    if (!owner.ok) return owner;
    const id = f.value.id;
    return isUuid(id) ? ok({ ...owner.value, id }) : fail("id");
  },
  list_senders(body) {
    const f = fieldsOf(body, "list_senders");
    if (!f.ok) return f;
    const owner = ownerOf(f.value);
    if (!owner.ok) return owner;
    const page = pageOf(f.value);
    if (!page.ok) return page;
    const stretch = stretchOf(f.value);
    return stretch.ok
      ? ok({ ...owner.value, ...page.value, ...stretch.value })
      : stretch;
  },
  list_events(body) {
    const f = fieldsOf(body, "list_events");
    if (!f.ok) return f;
    const owner = ownerOf(f.value);
    if (!owner.ok) return owner;
    const page = pageOf(f.value);
    if (!page.ok) return page;
    const stretch = stretchOf(f.value);
    if (!stretch.ok) return stretch;
    const { sender, scope } = f.value;
    if (sender !== undefined && !isUuid(sender)) return fail("sender");
    if (scope !== undefined && scope !== "domain" && scope !== "address")
      return fail("scope");
    if (scope !== undefined && sender === undefined) return fail("scope");
    return ok({
      ...owner.value,
      ...page.value,
      ...stretch.value,
      ...(sender === undefined ? {} : { sender }),
      ...(scope === undefined ? {} : { scope }),
    });
  },
  list_quiet_senders(body) {
    const f = fieldsOf(body, "list_quiet_senders");
    if (!f.ok) return f;
    const owner = ownerOf(f.value);
    if (!owner.ok) return owner;
    const page = pageOf(f.value);
    return page.ok ? ok({ ...owner.value, ...page.value }) : page;
  },
  list_rules(body) {
    const f = fieldsOf(body, "list_rules");
    if (!f.ok) return f;
    const owner = ownerOf(f.value);
    if (!owner.ok) return owner;
    const page = pageOf(f.value);
    if (!page.ok) return page;
    const classification = f.value.classification;
    if (classification !== undefined && !isUuid(classification))
      return fail("classification");
    return ok({
      ...owner.value,
      ...page.value,
      ...(classification === undefined ? {} : { classification }),
    });
  },
  get_rule(body) {
    const f = fieldsOf(body, "get_rule");
    if (!f.ok) return f;
    const owner = ownerOf(f.value);
    if (!owner.ok) return owner;
    const id = f.value.id;
    return isUuid(id) ? ok({ ...owner.value, id }) : fail("id");
  },
  hush: classificationOnly("hush"),
  unhush: classificationOnly("unhush"),
  end_session(body) {
    const f = fieldsOf(body, "end_session");
    if (!f.ok) return f;
    const token = f.value.refresh_token;
    return typeof token === "string" && TOKEN.test(token)
      ? ok({ refresh_token: token })
      : fail("refresh_token");
  },
};

/**
 * A mailbox's state, as the index has it (DD21 §8): `phase` and
 * `indexed_through` are `sync_state`'s, `last_synced_at` the account's.
 */
export type SyncState = {
  phase: string;
  indexed_through: string | null;
  last_synced_at: string | null;
};

export type AccountState = {
  id: string;
  sync: SyncState;
  /** Whether this answer read the mailbox whole (DD21 §8, #1369). */
  whole: boolean;
};

/**
 * Every answer: the data, the state of each mailbox it read, whether it is
 * complete (DD21 §8), and for a listing with more to give, the cursor that
 * carries on (§6). An answer over several mailboxes carries each, and is
 * complete only when every connected one is, so silence is never read as
 * quiet.
 */
export type Envelope<T> = {
  data: T;
  accounts: AccountState[];
  complete: boolean;
  next?: string;
};

/*
 * Text a sender wrote, or that Brood derived from what one wrote, sits under
 * `sender_written` in every answer, and nothing else does (DD21 §8, DD8 §3):
 * an address, a domain, a root, a display name, and a classification's path,
 * which is built from a domain. A client, and an agent above all, treats
 * everything there as untrusted input. A customer's name sits there too: a
 * customer added without one is named after its root domain.
 */

/** What the index holds and never holds, for a client orienting itself (DD8 §2). */
export type DescribeIndex = {
  holds: readonly string[];
  never_holds: readonly string[];
};

/** The person's mailboxes; the address is their own, not a sender's. */
export type ListAccounts = {
  accounts: { id: string; address: string; connected: boolean }[];
};

export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/** A classification, as a listing gives it. */
export type Classification = {
  id: string;
  state: ClassificationState;
  /**
   * The engine's reason for its current state: why it was proposed, or why
   * it last moved (quieted for silence, restored, adopted). The reason it
   * was first proposed is not kept once it moves.
   */
  reason: ClassificationReason | null;
  /** What it covers: a domain and everything under it, or one sender's address. */
  subject_kind: SubjectKind;
  proposed_at: string;
  decided_at: string | null;
  decided_by: "user" | "engine" | null;
  sender_written: { path: string; subject: string };
};

/** A classification beside another, by path. */
export type ClassificationLink = {
  id: string;
  state: ClassificationState;
  sender_written: { path: string };
};

export type SummariseWeek = {
  monday: string;
  sunday: string;
  tone: Tone;
  /** Who wrote most, largest first, each as a share of the largest. */
  loudest: {
    share: number;
    tags: readonly SenderTag[];
    sender_written: {
      root: string;
      roots: readonly string[];
      customer: string | null;
    };
  }[];
  first_wrote: { sender_written: { root: string } }[];
  proposed: WeekClassification[];
  quieted: WeekClassification[];
};

export type WeekClassification = {
  subject_kind: SubjectKind | null;
  sender_written: { path: string; subject: string | null };
};

export type GetSender = {
  id: string;
  scope: SenderScope;
  /** Inbound messages over the last `PORTRAIT_DAYS` days. */
  messages: number;
  /** Whether most of it declared itself a mailing. */
  mailing: boolean;
  written_to: boolean;
  first_wrote: string | null;
  weeks: { start: string; messages: number }[];
  months: { month: string; messages: number }[];
  classifications: (ClassificationLink & { subject_kind: SubjectKind })[];
  addresses: {
    id: string;
    messages: number;
    last: string | null;
    never_quiet: boolean;
    kept_out: boolean;
    filing: {
      mailbox: string;
      classification: ClassificationLink | null;
    }[];
    sender_written: { address: string; domain: string; names: string[] };
  }[];
  more_addresses: boolean;
  sender_written: {
    address: string;
    domain: string;
    root: string;
    roots: string[];
    customer: string | null;
    never_quiet_roots: string[];
    never_quiet_addresses: string[];
  };
};

export type ListClassifications = { classifications: Classification[] };

export type GetClassification = Classification & {
  parent: ClassificationLink | null;
  children: ClassificationLink[];
  mailboxes: {
    mailbox: string;
    installed_at: string;
    shown: (typeof SHOWN)[number];
    filed_existing: number | null;
    stranded: boolean;
  }[];
  /** What it filed, a whole week each, Monday to Sunday in UTC, oldest first. */
  weeks: { start: string; messages: number }[];
  moved_out: {
    at: string;
    sender_id: string;
    sender_written: { address: string };
  }[];
  moved_out_count: number;
};

export type ListSenders = {
  /** `day` inside the retention window, `month` for a stretch reaching past it. */
  resolution: "day" | "month";
  /** The days counted: the stretch asked for, widened to whole months when by the month. */
  counted_from: string;
  counted_to: string;
  senders: {
    /** The sender of its root that wrote most in the stretch, for `get_sender`. */
    id: string;
    messages: number;
    first: string | null;
    last: string | null;
    /** Its root, and under a root many unrelated people share, the one address counted. */
    sender_written: { root: string; address: string | null };
  }[];
};

export type ListEvents = {
  /** How far back the answer could reach: the stretch's start, or the retention window's, whichever is later. */
  retained_from: string;
  events: {
    id: string;
    at: string;
    direction: (typeof DIRECTIONS)[number];
    /** The connected mailbox it arrived in or was sent from, by its id in `accounts`. */
    account: string;
    sender_id: string;
    reply: boolean;
    /** Whether it declared itself a mailing, with a List-Unsubscribe header. */
    mailing: boolean;
    one_click: boolean | null;
    recipients: number;
    addressed: (typeof ADDRESSED)[number] | null;
    sender_written: { address: string; domain: string };
  }[];
};

export type ListQuietSenders = {
  /** The silence window the answer used, the person's own if they set one. */
  silence_days: number;
  quiet: {
    /** The sender of its root that wrote most, for `get_sender`. */
    id: string;
    last_heard: string;
    /** Its root, and under a root many unrelated people share, the one address counted. */
    sender_written: { root: string; address: string | null };
  }[];
};

/** A filter Brood installed. Never the provider's own id for it. */
export type Rule = {
  id: string;
  classification_id: string;
  /** The mailbox it is installed in: the person's own address. */
  mailbox: string;
  installed_at: string;
  /** How its classification is shown there: as confirmed, quieted, or as the person left it. */
  shown: (typeof SHOWN)[number] | null;
  /** Left in a mailbox Brood could not remove it from. */
  stranded: boolean;
  /** Messages already there that it moved when installed; null until that finished. */
  filed_existing: number | null;
  sender_written: {
    path: string | null;
    /** What it files: everything from a domain, or one address. */
    from: { kind: SenderScope; value: string };
    /** Addresses and domains it leaves out: the never-quiet list's, and those kept out. */
    exclude: string[];
    /** Addresses it leaves out when copied on a message. */
    exclude_cc: string[];
  };
};

export type ListRules = { rules: Rule[] };

/** A session ended. */
export type EndSession = { ended: true };

/** A classification hushed: filed, with the rule in each mailbox. */
export type Hush = {
  id: string;
  state: "active" | "quieted";
  /** Whether it was filed already, so nothing was installed. */
  already: boolean;
  rules: { id: string; account: string }[];
  /** Mailboxes where its filter could not be installed; the rest are filed. */
  failed: string[];
};

/** A classification unhushed, or one that was not filed. */
export type Unhush = {
  id: string;
  /** `undone`, or `not_filed` where there was nothing to undo. */
  outcome: "undone" | "not_filed";
  /** The mailboxes its mail is coming back to. */
  returning: string[];
  /** Whether it had taken over a filter of your own, now put back as yours, with your mail where it is. */
  handed_back: boolean;
  /** Mailboxes whose filter was already gone, so Brood's label stays on the mail there. */
  home_left: number;
};

export type Answers = {
  describe_index: DescribeIndex;
  list_accounts: ListAccounts;
  summarise_week: SummariseWeek;
  get_sender: GetSender;
  list_classifications: ListClassifications;
  get_classification: GetClassification;
  list_senders: ListSenders;
  list_events: ListEvents;
  list_quiet_senders: ListQuietSenders;
  list_rules: ListRules;
  get_rule: Rule;
  end_session: EndSession;
  hush: Hush;
  unhush: Unhush;
};

/** The codes a problem carries, which clients branch on (DD21 §8, RFC 9457). */
export const PROBLEM_CODES = [
  "invalid_argument",
  "unauthenticated",
  "credential_revoked",
  "insufficient_scope",
  "plan_required",
  "not_found",
  "mailbox_unreachable",
  "never_quiet",
  "in_progress",
  "rate_limited",
  "internal",
] as const;

export type ProblemCode = (typeof PROBLEM_CODES)[number];

/**
 * Each problem's status, its title, and when it is answered (DD21 §8): what
 * the app answers with and what the reference says, from one table.
 */
export const PROBLEMS: Record<
  ProblemCode,
  {
    status: number;
    title: string;
    when: string;
    /** Answered only by an operation that acts on a mailbox. */
    acting?: true;
  }
> = {
  invalid_argument: {
    status: 400,
    title: "An argument is not valid",
    when: "An argument, the body, or a cursor is not one the operation takes. `detail` names which, never its value.",
  },
  unauthenticated: {
    status: 401,
    title: "Not signed in",
    when: "No token, one that fails verification, or one whose person has deleted their account. `WWW-Authenticate` says how to sign in.",
  },
  credential_revoked: {
    status: 401,
    title: "This credential was revoked",
    when: `Unused for ${API_UNUSED_DAYS} days, or revoked. Signing in again does not undo it.`,
  },
  insufficient_scope: {
    status: 403,
    title: "This credential may not do that",
    when: "The token lacks the operation's scope. `WWW-Authenticate` names the scope it needs.",
  },
  plan_required: {
    status: 403,
    title: "This needs Pro",
    when: "Hushing on an account without Pro. Unhushing never needs it.",
    acting: true,
  },
  not_found: {
    status: 404,
    title: "Not found",
    when: "The operation, or the sender, classification or rule, is not this person's. Another person's is answered the same way, so the two cannot be told apart.",
  },
  mailbox_unreachable: {
    status: 409,
    title: "Brood cannot reach this mailbox",
    when: "Hushing found no mailbox to install in: none connected that the classification's mail arrived in, or every one refused.",
    acting: true,
  },
  never_quiet: {
    status: 409,
    title: "Your never-quiet list keeps this in view",
    when: "Hushing a classification that your never-quiet list keeps in view. Brood never files mail the list keeps, whatever asks it to.",
  },
  in_progress: {
    status: 409,
    title: "Brood is still undoing this",
    when: "Hushing a classification whose earlier filter Brood is still removing, or whose mail it is still bringing back. Try again within the hour.",
  },
  rate_limited: {
    status: 429,
    title: "Too many calls",
    when: `More than ${API_CALLS_PER_MINUTE} calls in a minute from one credential, or ${API_ACTS_PER_MINUTE} that act on a mailbox; or, for \`unhush\`, the day's allowance of rule changes spent, which comes back at midnight UTC, as the app's undo shares it. \`Retry-After\` says when to call again.`,
  },
  internal: {
    status: 500,
    title: "Something went wrong",
    when: "Anything else. Nothing from inside Brood reaches `detail`.",
  },
};

export type Problem = {
  type: string;
  title: string;
  status: number;
  code: ProblemCode;
  detail?: string;
};
export { ANSWER_FIELDS, ENVELOPE_FIELDS, type Docs } from "./fields.ts";
