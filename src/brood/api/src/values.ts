/**
 * The values the API's answers and arguments take, as lists, so the types
 * derive from them and the reference names them from them (#1344): one
 * home for each, with no value typed twice.
 */

/** A classification's states, as the engine's list holds them, which a test keeps equal. */
export const CLASSIFICATION_STATES = [
  "proposed",
  "active",
  "quieted",
  "declined",
] as const;
export type ClassificationState = (typeof CLASSIFICATION_STATES)[number];

/** Why the engine proposed or moved a classification, as the engine's list holds them. */
export const CLASSIFICATION_REASONS = [
  "volume",
  "subdomain_split",
  "relationship",
  "silence",
  "correction_streak",
  "reproposed",
  "filter_missing",
  "restored",
  "kept_out",
  "adopted",
  "by_hand",
] as const;
export type ClassificationReason = (typeof CLASSIFICATION_REASONS)[number];

/** How a week sounded beside the one before; `first` with none to compare. */
export const TONES = ["quieter", "louder", "much the same", "first"] as const;
export type Tone = (typeof TONES)[number];

/** How a week sounded, as a reader is told it, with no number in it: the app's week page and `brood week` both say it. */
export const TONE_TITLES: Record<Tone, string> = {
  quieter: "A quieter week.",
  louder: "A louder week.",
  "much the same": "A week much like the one before.",
  first: "The first week Brood can tell you about.",
};

/** What a sender is, as the app tags it. */
export const SENDER_TAGS = [
  "relationship",
  "filed",
  "quieted",
  "correspondence",
  "mailing",
] as const;
export type SenderTag = (typeof SENDER_TAGS)[number];

/** How much of a sender is meant: everything under its root domain, or the one address. */
export const SENDER_SCOPES = ["domain", "address"] as const;
export type SenderScope = (typeof SENDER_SCOPES)[number];

/** What a classification covers: a domain and everything under it, or one address. */
export const SUBJECT_KINDS = ["domain", "sender"] as const;
/** How a classification is shown in a mailbox. */
export const SHOWN = ["active", "quieted", "left"] as const;
/** Which way a message went. */
export const DIRECTIONS = ["inbound", "outbound"] as const;
/** How the person was addressed on a message. */
export const ADDRESSED = ["to", "cc", "neither"] as const;

/**
 * What an entry on the never-quiet list names: one sender's address, a domain
 * and everything under it, a pattern on an address's local part, or an
 * address copied on a message, which keeps that mail alone in view (#663).
 */
export const KEPT_KINDS = ["address", "domain", "pattern", "copied"] as const;
export type KeptKind = (typeof KEPT_KINDS)[number];

/**
 * What became of one line given to `keep`, or would, as the never-quiet
 * list's paste says it in the app, which a test keeps equal: kept, there
 * already, said twice, not in force since a filter could not change, or
 * refused for what it is.
 */
export const KEEP_OUTCOMES = [
  "added",
  "already_listed",
  "repeated",
  "not_in_force",
  "invalid_address",
  "invalid_domain",
  "invalid_pattern",
  "unrenderable",
] as const;
export type KeepOutcome = (typeof KEEP_OUTCOMES)[number];

/**
 * What became of one line given to `add_relationships`, or would, as the
 * Relationships page's paste says it, which a test keeps equal: a relationship, one
 * already, a domain that names no organisation, one that cannot be read, a
 * site's address, or a line Brood failed on.
 */
export const RELATIONSHIP_OUTCOMES = [
  "added",
  "already",
  "shared",
  "invalid",
  "address",
  "failed",
] as const;
export type RelationshipOutcome = (typeof RELATIONSHIP_OUTCOMES)[number];

/** What came of changing a group or a relationship's place in one. */
export const GROUP_OUTCOMES = ["done", "taken", "not_empty"] as const;
export type GroupOutcome = (typeof GROUP_OUTCOMES)[number];

/** What taking someone off the relationships list does, wherever it is said. */
export const RELATIONSHIP_REMOVAL =
  "Anything already filed stays filed, and a proposal waiting for them is withdrawn. Brood may then quiet them, will not bring them back after a quiet spell, and will not suggest them again.";

/** What came of taking up or dismissing a suggestion. */
export const SUGGESTION_OUTCOMES = ["done", "not_suggested"] as const;
export type SuggestionOutcome = (typeof SUGGESTION_OUTCOMES)[number];

/**
 * What came of restoring a quieted home: active again with its homes moved
 * back, with a home the person renamed or removed left as it is, or with one
 * a later rules pass moves back; or it was not quieted.
 */
export const RESTORE_OUTCOMES = [
  "restored",
  "restored_left",
  "restored_later",
  "not_quieted",
] as const;
export type RestoreOutcome = (typeof RESTORE_OUTCOMES)[number];

/**
 * What came of leaving a quieted home quiet after its sender wrote again:
 * answered; quiet already, answered before or with nothing to answer; or not
 * quieted.
 */
export const LEAVE_QUIET_OUTCOMES = [
  "answered",
  "already",
  "not_quieted",
] as const;
export type LeaveQuietOutcome = (typeof LEAVE_QUIET_OUTCOMES)[number];

/**
 * What came of marking a home batched, or taking the mark off: as asked;
 * already so, or not a home that can be marked; no arrival hours set yet; or
 * a mailbox filing it cannot return mail in batches, or none is filing it.
 */
export const BATCH_OUTCOMES = [
  "batched",
  "unbatched",
  "unchanged",
  "no_hours",
  "cannot",
] as const;
export type BatchOutcome = (typeof BATCH_OUTCOMES)[number];

/**
 * Why one of your own filters cannot be taken over as it stands: it matches
 * more than a sender, names no one sender, keeps mail in the inbox, forwards,
 * does more than file, or files under none of your homes, or several.
 */
export const ADOPT_REFUSALS = [
  "matches_more",
  "not_one_sender",
  "keeps_in_inbox",
  "forwards",
  "does_more",
  "no_home",
  "several_homes",
] as const;
export type AdoptRefusalWord = (typeof ADOPT_REFUSALS)[number];

/**
 * What came of taking over one of your own filters: taken over; refused for
 * a reason in `ADOPT_REFUSALS`; gone from the mailbox; no mail from its
 * sender yet; a part of a domain; a sender Brood already files or has
 * quieted; one your never-quiet list keeps in view; one a filter cannot hold
 * exactly; or its mailbox not connected.
 */
export const ADOPT_OUTCOMES = [
  "adopted",
  ...ADOPT_REFUSALS,
  "gone",
  "no_mail",
  "not_root",
  "already_brood",
  "never_quiet",
  "unrenderable",
  "not_connected",
] as const;
export type AdoptOutcome = (typeof ADOPT_OUTCOMES)[number];

/** What one of your own filters does. */
export const OWN_RULE_DOES = [
  "out_of_inbox",
  "trash",
  "read",
  "starred",
  "important",
  "forwards",
] as const;
export type OwnRuleDoesWord = (typeof OWN_RULE_DOES)[number];

/**
 * What came of keeping a sender out of a filing: kept out, its mail coming
 * back; the same, with a filter the hourly reconcile has yet to narrow; a
 * sender with a home of its own, to unhush instead; nothing files it; or an
 * address a filter cannot hold exactly.
 */
export const KEEP_OUT_OUTCOMES = [
  "kept_out",
  "kept_out_pending",
  "own_home",
  "not_filed",
  "unrenderable",
] as const;
export type KeepOutWord = (typeof KEEP_OUT_OUTCOMES)[number];

/**
 * What came of filing what a filter would have filed had it been there
 * already: all of it; some, the hourly rules pass filing the rest; none now,
 * today's allowance being spent, so the pass files it; or none, since it
 * stopped being one to file with.
 */
export const FILE_EXISTING_OUTCOMES = [
  "filed",
  "continues",
  "later",
  "stopped",
] as const;
export type FileExistingOutcome = (typeof FILE_EXISTING_OUTCOMES)[number];

/**
 * What came of changing the rule book's numbers: saved; the same as before,
 * so nothing written; refused with no mailbox connected, where they apply to
 * nothing; or refused as stale, the numbers in force no longer the ones the
 * change was read against.
 */
export const RULE_BOOK_OUTCOMES = [
  "saved",
  "unchanged",
  "no_mailbox",
  "stale",
] as const;
export type RuleBookOutcome = (typeof RULE_BOOK_OUTCOMES)[number];

/**
 * The rule book's numbers by name, in the order the engine's defaults list
 * them. Listed here, since the CLI's public mirror carries figures as plain
 * values alone, and held equal to `DEFAULT_THRESHOLDS` by the API's own list.
 */
export const RULE_BOOK_KEYS = [
  "file.min_events",
  "file.window_days",
  "file.subdomain_split",
  "quiet.silence_days",
  "quiet.correction_streak",
  "surface.reply_window_days",
  "surface.relationship_silence_days",
  "relationship.window_months",
  "relationship.min_active_months",
  "relationship.min_inbound",
  "relationship.inbound_per_reply",
] as const;
export type ThresholdName = (typeof RULE_BOOK_KEYS)[number];

/** A number for each of the rule book's names. */
export type Thresholds = Record<ThresholdName, number>;

/** What came of asking for a declined classification to be proposed again. */
export const REPROPOSE_OUTCOMES = [
  "reproposed",
  "already_proposed",
  "retiring",
  "returning",
  "not_declined",
] as const;
export type ReproposeOutcome = (typeof REPROPOSE_OUTCOMES)[number];

/**
 * What came of asking a sender to stop, as the app's words for it, which a
 * test keeps equal.
 */
export const UNSUBSCRIBE_OUTCOMES = [
  "asked",
  "declined",
  "unreachable",
  "blocked",
  "not_offered",
  "never_quiet",
  "relationship",
  "limited",
] as const;
export type UnsubscribeOutcome = (typeof UNSUBSCRIBE_OUTCOMES)[number];

/** A list of values as the reference writes them: each as code, `or` before the last. */
export const listed = (values: readonly string[]) =>
  values.length < 2
    ? values.map((v) => `\`${v}\``).join("")
    : `${values
        .slice(0, -1)
        .map((v) => `\`${v}\``)
        .join(", ")} or \`${values.at(-1)}\``;

/** How often a person wants the letter of what Brood did, if at all (#609). */
export const LETTER_CHOICES = ["off", "month", "week"] as const;
export type LetterChoice = (typeof LETTER_CHOICES)[number];

/**
 * What came of choosing whether the first proposals' email is wanted:
 * recorded, or sent already, so there was nothing left to change.
 */
export const FIRST_PROPOSALS_OUTCOMES = ["recorded", "sent"] as const;
export type FirstProposalsOutcome = (typeof FIRST_PROPOSALS_OUTCOMES)[number];
