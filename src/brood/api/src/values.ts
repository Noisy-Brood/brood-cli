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
