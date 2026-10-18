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
  "customer",
  "silence",
  "correction_streak",
  "reproposed",
  "filter_missing",
  "restored",
  "kept_out",
  "adopted",
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
  "customer",
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

/** A list of values as the reference writes them: each as code, `or` before the last. */
export const listed = (values: readonly string[]) =>
  values.length < 2
    ? values.map((v) => `\`${v}\``).join("")
    : `${values
        .slice(0, -1)
        .map((v) => `\`${v}\``)
        .join(", ")} or \`${values.at(-1)}\``;
