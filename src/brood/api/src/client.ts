import { APP_ORIGIN } from "./origin.ts";
import type {
  ADDRESSED,
  ClassificationReason,
  ClassificationState,
  DIRECTIONS,
  SenderScope,
  SenderTag,
  SHOWN,
  SUBJECT_KINDS,
  Tone,
} from "./values.ts";

/**
 * What a client of the API needs, and nothing of how the app answers (#1408):
 * where to call and sign in, each operation's arguments and answer, and the
 * problems a client branches on. The CLI imports this alone, so its public
 * mirror carries it alone; the operations' descriptions, the arguments'
 * narrowing and when each problem is answered are the app's half of this
 * package, which re-exports this.
 */

export * from "./values.ts";

/** Where every operation is called, by POST with its arguments in the body (DD21 §2, §3). */
export const API_BASE = `${APP_ORIGIN}/api/v1`;

/**
 * Where a client signs in (DD21 §4): Clerk's OAuth server for the production
 * instance, and each client's id there. A client id is not a secret: a public
 * client is known by it alone, and ships it (#1354).
 */
export const SIGN_IN = {
  issuer: "https://clerk.app.noisybrood.com",
  clients: { cli: "P029s9c7VAQInceB" },
} as const;

/** Every operation's name. */
export type OperationName = keyof Answers;

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

/**
 * A mailbox's state, as the index has it (DD21 §8): how far it has been
 * read, and when it was last synced.
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
  /** Whether Brood reads any mailbox for the person (#297). */
  mailbox_connected: boolean;
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
 * Each problem's status and title (DD21 §8, RFC 9457), which a client shows
 * and branches on.
 */
export const PROBLEM_TITLES: Record<
  ProblemCode,
  { status: number; title: string }
> = {
  invalid_argument: { status: 400, title: "An argument is not valid" },
  unauthenticated: { status: 401, title: "Not signed in" },
  credential_revoked: { status: 401, title: "This credential was revoked" },
  insufficient_scope: { status: 403, title: "This credential may not do that" },
  plan_required: { status: 403, title: "This needs Pro" },
  not_found: { status: 404, title: "Not found" },
  mailbox_unreachable: {
    status: 409,
    title: "Brood cannot reach this mailbox",
  },
  never_quiet: {
    status: 409,
    title: "Your never-quiet list keeps this in view",
  },
  in_progress: { status: 409, title: "Brood is still undoing this" },
  rate_limited: { status: 429, title: "Too many calls" },
  internal: { status: 500, title: "Something went wrong" },
};

export type Problem = {
  type: string;
  title: string;
  status: number;
  code: ProblemCode;
  detail?: string;
};
