import {
  RELATIONSHIP_REMOVAL,
  RULE_BOOK_KEYS,
  ADOPT_REFUSALS,
  CLASSIFICATION_STATES,
  TONE_TITLES,
  type Answers,
  type Classification,
  type GroupOutcome,
  type RelationshipOutcome,
  type ReproposeOutcome,
  type UnsubscribeOutcome,
  type Envelope,
  type KeepOutcome,
  type Rule,
  type ThresholdName,
  type AdoptOutcome,
  type AdoptRefusalWord,
} from "./brood/api/src/client.ts";
import {
  API_PAGE_MAX,
  API_STRETCH_DAYS,
  PORTRAIT_DAYS,
  PROPOSALS_AT_ONCE,
} from "./brood/figures/index.ts";
import { call } from "./client.ts";
import { clean, Refusal, Refused, type Io } from "./io.ts";
import { day, dim, json, more, rows, state, type Style } from "./out.ts";

/**
 * Each command (DD10 §3): it calls one operation, or for a sender named as a
 * person thinks of it, finds the id first, then prints the answer, after
 * what the person must know to trust it.
 */

export type Options = {
  owner?: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
  state?: string;
  week?: string;
  sender?: string;
  classification?: string;
  group?: string;
  all?: boolean;
  check?: boolean;
  yes?: boolean;
};

type Run = (
  io: Io,
  style: Style,
  options: Options,
  args: string[],
) => Promise<void>;

/** The options a command may be given beyond `--json`, `--no-color` and `--owner`. */
export type OptionName = Exclude<keyof Options, "owner">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * A lookup by name reads every page, so a match on a later one is never
 * missed. This bounds it against an answer that never ends; reaching it is
 * said, never taken as "none".
 */
const LOOKUP_PAGES = 100;

const tooMany = (name: string) =>
  new Refusal(
    `Brood read ${LOOKUP_PAGES} pages looking for ${clean(name)} and stopped. Name it by its id.`,
  );

/** Refuses options a command was given that it takes only in its other form. */
const without = (options: Options, names: OptionName[], form: string) => {
  const given = names.find((n) => options[n] !== undefined);
  if (given) throw new Refusal(`--${given} does not apply to ${form}.`);
};

const owner = (o: Options) => (o.owner === undefined ? {} : { owner: o.owner });
const page = (o: Options) => ({
  ...(o.limit === undefined ? {} : { limit: o.limit }),
  ...(o.cursor === undefined ? {} : { cursor: o.cursor }),
});
const stretch = (o: Options) => ({
  ...(o.since === undefined ? {} : { since: o.since }),
  ...(o.until === undefined ? {} : { until: o.until }),
});

const same = (a: string | null, b: string) =>
  a !== null && a.toLowerCase() === b.toLowerCase();

/** The answer, or for `--json` the answer as given, after its mailboxes' state. */
function shown<T>(
  io: Io,
  style: Style,
  envelope: Envelope<T>,
  print: (data: T) => void,
): void {
  if (style.json) return json(io, envelope);
  state(io, style, envelope);
  print(envelope.data);
  more(io, style, envelope);
}

const one = (args: string[], what: string): string => {
  const [arg, ...rest] = args;
  if (arg === undefined || rest.length) throw new Refusal(`Name one ${what}.`);
  return arg;
};

const none = (args: string[]): void => {
  if (args.length)
    throw new Refusal(
      `It takes no ${args.length === 1 ? "argument" : "arguments"}: ${clean(args.join(" "))}.`,
    );
};

/**
 * A sender's id: given as one, or found over a stretch by its root domain,
 * or by its address under a root many unrelated people share. Such a root
 * is listed one address at a time, each row naming the shared root, so a
 * row with an address is matched by its address alone: matched by its
 * root, one person's mail would be shown as the whole root's. And it is
 * read by its address too, so the read does not widen to the root either.
 */
async function senderOf(
  io: Io,
  options: Options,
  name: string,
  over: { since: string; until?: string },
): Promise<{ sender: string; scope: "domain" | "address" }> {
  if (UUID.test(name)) return { sender: name, scope: "domain" };
  let cursor: string | undefined;
  let whole = true;
  for (let n = 0; n < LOOKUP_PAGES; n++) {
    const answer = await call(io, "list_senders", {
      ...owner(options),
      ...over,
      limit: API_PAGE_MAX,
      ...(cursor ? { cursor } : {}),
    });
    const found = answer.data.senders.find((s) =>
      s.sender_written.address === null
        ? same(s.sender_written.root, name)
        : same(s.sender_written.address, name),
    );
    if (found)
      return {
        sender: found.id,
        scope: found.sender_written.address === null ? "domain" : "address",
      };
    whole &&= answer.complete;
    if (!answer.next)
      throw new Refusal(
        `Brood has no mail from ${clean(name)} from ${over.since}${over.until ? ` to ${over.until}` : ""}${whole ? "" : ", though it has not read every mailbox whole, so the mail may be there"}. Name a sender who wrote to you by its root domain, such as example.com, or under a shared one such as gmail.com, by its address.`,
      );
    cursor = answer.next;
  }
  throw tooMany(name);
}

/** The first day of the `days` ending `until`, or today, as YYYY-MM-DD in UTC. */
function daysBack(io: Io, days: number, until?: string): string {
  const end = until === undefined ? io.now() : Date.parse(`${until}T00:00:00Z`);
  if (
    Number.isNaN(end) ||
    (until !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(until))
  )
    throw new Refusal("--until is a day, as YYYY-MM-DD.");
  return new Date(end - (days - 1) * 86_400_000).toISOString().slice(0, 10);
}

/** The classifications covering a sender, by its id, or by what one covers or its path. */
async function classificationsOf(
  io: Io,
  options: Options,
  name: string,
): Promise<Pick<Classification, "id" | "state" | "sender_written">[]> {
  if (UUID.test(name)) {
    const one = await call(io, "get_classification", {
      ...owner(options),
      id: name,
    });
    return [one.data];
  }
  const found: Classification[] = [];
  let cursor: string | undefined;
  for (let n = 0; n < LOOKUP_PAGES; n++) {
    const answer = await call(io, "list_classifications", {
      ...owner(options),
      limit: API_PAGE_MAX,
      ...(cursor ? { cursor } : {}),
    });
    found.push(
      ...answer.data.classifications.filter(
        (c) =>
          same(c.sender_written.subject, name) ||
          same(c.sender_written.path, name),
      ),
    );
    if (!answer.next) return found;
    cursor = answer.next;
  }
  throw tooMany(name);
}

/** One classification to act on: the one found, or the choice put back to the person. */
async function chosen(
  io: Io,
  style: Style,
  options: Options,
  name: string,
  verb: "hush",
): Promise<string | null>;
async function chosen(
  io: Io,
  style: Style,
  options: Options,
  name: string,
  verb: "unhush",
): Promise<string>;
/**
 * The one classification a name means. For `hush`, none is null, so the
 * sender is filed by hand (#1355); for `unhush`, none is a refusal.
 */
async function chosen(
  io: Io,
  style: Style,
  options: Options,
  name: string,
  verb: "hush" | "unhush",
): Promise<string | null> {
  const all = await classificationsOf(io, options, name);
  const found =
    verb === "unhush"
      ? all.filter((c) => c.state === "active" || c.state === "quieted")
      : all;
  const [only, ...others] = found;
  if (!only) {
    if (verb === "hush" && !UUID.test(name)) return null;
    throw new Refusal(
      verb === "hush"
        ? `Brood has no classification ${clean(name)}.`
        : `Nothing is filed for ${clean(name)}.`,
    );
  }
  if (!others.length) return only.id;
  io.err(`Several classifications cover ${clean(name)}:`);
  rows(
    io,
    found.map((c) => [c.sender_written.path, c.state, dim(style, c.id)]),
    io.err,
  );
  throw new Refusal(`Run brood ${verb} with the id of the one you mean.`);
}

const accounts: Run = async (io, style, options, args) => {
  none(args);
  const answer = await call(io, "list_accounts", owner(options));
  shown(io, style, answer, (data) => {
    if (!data.accounts.length) return io.out("No mailbox is connected.");
    const phase = new Map(answer.accounts.map((a) => [a.id, a.sync.phase]));
    rows(
      io,
      data.accounts.map((a) => [
        a.address,
        a.connected ? (phase.get(a.id) ?? "") : "disconnected",
        dim(style, a.id),
      ]),
    );
  });
};

const week: Run = async (io, style, options, args) => {
  none(args);
  const answer = await call(io, "summarise_week", {
    ...owner(options),
    ...(options.week === undefined ? {} : { week: options.week }),
  });
  shown(io, style, answer, (w) => {
    io.out(`The week of ${w.monday} to ${w.sunday}.`);
    io.out(TONE_TITLES[w.tone]);
    const section = (title: string, lines: string[][], empty: string) => {
      io.out("");
      io.out("· · ·");
      io.out("");
      io.out(title);
      if (!lines.length) return io.out(`  ${empty}`);
      rows(
        io,
        lines.map((l) => ["", ...l]),
      );
    };
    section(
      "Wrote most",
      w.loudest.map((s) => [
        s.sender_written.relationship ?? s.sender_written.root,
        dim(style, s.tags.join(", ")),
      ]),
      "No one wrote.",
    );
    section(
      "Wrote for the first time",
      w.first_wrote.map((s) => [s.sender_written.root]),
      "No one new.",
    );
    section(
      "Proposed",
      w.proposed.map((c) => [c.sender_written.path]),
      "Nothing.",
    );
    section(
      "Quieted",
      w.quieted.map((c) => [c.sender_written.path]),
      "Nothing.",
    );
  });
};

const senders: Run = async (io, style, options, args) => {
  if (args.length) {
    without(
      options,
      ["since", "until", "limit", "cursor"],
      "brood senders <name>",
    );
    // Over the days its portrait covers, so a sender with mail in it is found.
    const found = await senderOf(io, options, one(args, "sender"), {
      since: daysBack(io, PORTRAIT_DAYS),
    });
    const answer = await call(io, "get_sender", {
      ...owner(options),
      ...found,
    });
    return shown(io, style, answer, (s) => printSender(io, style, s));
  }
  const answer = await call(io, "list_senders", {
    ...owner(options),
    ...page(options),
    ...stretch(options),
  });
  shown(io, style, answer, (data) => {
    io.err(
      dim(
        style,
        `${data.counted_from} to ${data.counted_to}, counted by the ${data.resolution === "day" ? "day" : "whole month"}.`,
      ),
    );
    if (!data.senders.length) return io.out("No one wrote in that stretch.");
    rows(
      io,
      data.senders.map((s) => [
        s.sender_written.address ?? s.sender_written.root,
        String(s.messages),
        `last ${day(s.last)}`,
      ]),
    );
  });
};

function printSender(io: Io, style: Style, s: Answers["get_sender"]): void {
  const w = s.sender_written;
  io.out(s.scope === "address" ? w.address : (w.relationship ?? w.root));
  io.out(
    `${s.messages} messages in the last ${PORTRAIT_DAYS} days${s.mailing ? ", mostly mailings" : ""}.`,
  );
  io.out(
    s.written_to ? "You have written to it." : "You have not written to it.",
  );
  if (s.first_wrote) io.out(`First wrote ${day(s.first_wrote)}.`);
  if (s.classifications.length) {
    io.out("");
    io.out("Classifications");
    rows(
      io,
      s.classifications.map((c) => [
        "",
        c.sender_written.path,
        c.state,
        dim(style, c.id),
      ]),
    );
  }
  if (s.addresses.length) {
    io.out("");
    io.out("Addresses");
    rows(
      io,
      s.addresses.map((a) => [
        "",
        a.sender_written.address,
        String(a.messages),
        a.never_quiet ? "never quiet" : a.kept_out ? "kept out" : "",
      ]),
    );
    if (s.more_addresses) io.out(dim(style, "  and more."));
  }
}

const events: Run = async (io, style, options, args) => {
  none(args);
  // Over the stretch asked for, so a sender who wrote in it is found.
  const found =
    options.sender === undefined
      ? undefined
      : await senderOf(io, options, options.sender, {
          since: options.since ?? daysBack(io, API_STRETCH_DAYS, options.until),
          ...(options.until === undefined ? {} : { until: options.until }),
        });
  const answer = await call(io, "list_events", {
    ...owner(options),
    ...page(options),
    ...stretch(options),
    ...(found ?? {}),
  });
  shown(io, style, answer, (data) => {
    io.err(dim(style, `Reaching back to ${day(data.retained_from)}.`));
    if (!data.events.length) return io.out("No messages in that stretch.");
    rows(
      io,
      data.events.map((e) => [
        e.at.slice(0, 16).replace("T", " "),
        e.direction === "inbound" ? "from" : "to",
        e.sender_written.address,
        dim(
          style,
          [e.reply && "reply", e.mailing && "mailing"]
            .filter(Boolean)
            .join(", "),
        ),
      ]),
    );
  });
};

const quiet: Run = async (io, style, options, args) => {
  none(args);
  const answer = await call(io, "list_quiet_senders", {
    ...owner(options),
    ...page(options),
  });
  shown(io, style, answer, (data) => {
    io.err(
      dim(
        style,
        `Silent for ${data.silence_days} days or more, after writing most months.`,
      ),
    );
    if (!data.quiet.length) return io.out("No regular sender has gone silent.");
    rows(
      io,
      data.quiet.map((s) => [
        s.sender_written.address ?? s.sender_written.root,
        `last heard ${day(s.last_heard)}`,
      ]),
    );
  });
};

const classifications: Run = async (io, style, options, args) => {
  const path = args.length ? one(args, "path") : undefined;
  const wanted =
    options.state === undefined
      ? undefined
      : CLASSIFICATION_STATES.find((s) => s === options.state);
  if (options.state !== undefined && !wanted)
    throw new Refusal(`--state is one of ${CLASSIFICATION_STATES.join(", ")}.`);
  const answer = await call(io, "list_classifications", {
    ...owner(options),
    ...page(options),
    ...(path ? { path } : {}),
    ...(wanted ? { state: wanted } : {}),
  });
  shown(io, style, answer, (data) => {
    if (!data.classifications.length) return io.out("No classifications.");
    rows(
      io,
      data.classifications.map((c) => [
        c.sender_written.path,
        c.state,
        c.reason ?? "",
        dim(style, c.id),
      ]),
    );
  });
};

const classification: Run = async (io, style, options, args) => {
  const id = one(args, "classification, by its id");
  const answer = await call(io, "get_classification", {
    ...owner(options),
    id,
  });
  shown(io, style, answer, (c) => {
    io.out(c.sender_written.path);
    io.out(
      `${c.state}${c.reason ? `, for ${c.reason}` : ""}. Covers ${c.subject_kind === "domain" ? "everything from" : "the one address"} ${c.sender_written.subject}.`,
    );
    io.out(
      `Proposed ${day(c.proposed_at)}${c.decided_at ? `, decided ${day(c.decided_at)}${c.decided_by === "user" ? " by you" : " by Brood"}` : ""}.`,
    );
    if (c.mailboxes.length) {
      io.out("");
      io.out("Filed in");
      rows(
        io,
        c.mailboxes.map((m) => [
          "",
          m.mailbox,
          `since ${day(m.installed_at)}`,
          m.stranded ? "left behind" : "",
        ]),
      );
    }
  });
};

function printRule(io: Io, style: Style, r: Rule): void {
  const w = r.sender_written;
  rows(io, [
    [
      w.path ?? "",
      `${w.from.kind === "domain" ? "everything from" : "the address"} ${w.from.value}`,
    ],
    [
      "",
      `in ${r.mailbox}, since ${day(r.installed_at)}${r.stranded ? ", left behind" : ""}`,
    ],
    ...(w.exclude.length ? [["", `leaves out ${w.exclude.join(", ")}`]] : []),
    ...(w.exclude_cc.length
      ? [["", `leaves out, when copied, ${w.exclude_cc.join(", ")}`]]
      : []),
    ["", dim(style, r.id)],
  ]);
}

const rules: Run = async (io, style, options, args) => {
  if (args[0] === "file") {
    without(options, ["classification", "limit", "cursor"], "brood rules file");
    const rule = anId(args.slice(1), "rule, by its id", "brood rules");
    return shown(
      io,
      style,
      await call(io, "file_existing", { ...owner(options), rule }),
      (f) =>
        io.out(
          `${FILED_EXISTING[f.outcome]}${f.filed ? ` ${f.filed === 1 ? "One message" : `${f.filed} messages`} filed so far.` : ""}`,
        ),
    );
  }
  if (args.length) {
    without(options, ["classification", "limit", "cursor"], "brood rules <id>");
    const answer = await call(io, "get_rule", {
      ...owner(options),
      id: one(args, "rule, by its id"),
    });
    return shown(io, style, answer, (r) => printRule(io, style, r));
  }
  const answer = await call(io, "list_rules", {
    ...owner(options),
    ...page(options),
    ...(options.classification === undefined
      ? {}
      : { classification: options.classification }),
  });
  shown(io, style, answer, (data) => {
    if (!data.rules.length) return io.out("Brood has installed no filters.");
    rows(
      io,
      data.rules.map((r) => [
        r.sender_written.path ?? "",
        r.mailbox,
        r.stranded ? "left behind" : "",
        dim(style, r.id),
      ]),
    );
  });
};

const hush: Run = async (io, style, options, args) => {
  const name = one(
    args,
    "sender, by its root domain or address, or a classification by its id",
  );
  const id = await chosen(io, style, options, name, "hush");
  // None proposed: the sender itself, found over the days its portrait
  // covers, as brood senders finds one, and filed by hand (DD21 §5, #1355).
  let answer: Envelope<Answers["hush"]>;
  try {
    answer = await call(io, "hush", {
      ...owner(options),
      ...(id !== null
        ? { classification: id }
        : {
            sender: (
              await senderOf(io, options, name, {
                since: daysBack(io, PORTRAIT_DAYS),
              })
            ).sender,
          }),
    });
  } catch (error) {
    // A sender the engine would never file, said as why rather than as an
    // argument refused.
    if (
      id === null &&
      error instanceof Refused &&
      error.code === "invalid_argument"
    )
      throw new Refusal(
        `Brood does not file ${clean(name)} by hand: it is a relationship's, someone you write to or a colleague, one of your own filters already acts on it, or its address is one a filter cannot hold exactly.`,
      );
    throw error;
  }
  shown(io, style, answer, (h) => {
    const what = h.sender_written.subject;
    io.out(
      h.already
        ? `${what} was filed already.`
        : `Filed ${what} out of your inbox, under ${h.sender_written.path}.`,
    );
    if (!same(what, name) && !UUID.test(name))
      io.out(
        `Brood files ${clean(name)} address by address, since you write to someone there or it is shared, so only ${what} is filed.`,
      );
    if (h.failed.length)
      io.out(
        `Brood could not install its filter in ${h.failed.length === 1 ? "one mailbox" : `${h.failed.length} mailboxes`}: ${h.failed.join(", ")}.`,
      );
  });
};

const unhush: Run = async (io, style, options, args) => {
  const name = one(
    args,
    "sender, by its root domain or address, or a classification by its id",
  );
  const id = await chosen(io, style, options, name, "unhush");
  const answer = await call(io, "unhush", {
    ...owner(options),
    classification: id,
  });
  shown(io, style, answer, (u) => {
    if (u.outcome === "not_filed")
      return io.out(`Nothing to undo: ${clean(name)} is not filed.`);
    io.out(
      u.handed_back
        ? "Your own filter is back as it was, and your mail stays where it is."
        : "Undone. Its mail is coming back to your inbox, the first of it now and the rest within the hour.",
    );
  });
};

/** The operations that add a list one a line, checked first: what `paste` runs. */
type Paste = "keep" | "add_relationships";
type PasteBody = { owner?: string; lines: string; check?: boolean };

/** How one list's paste is said: its command, its words, and its sentences. */
type PasteSpec<K extends Paste> = {
  command: string;
  /** What the list holds, for a file that holds none. */
  holds: string;
  send: (io: Io, body: PasteBody) => Promise<Envelope<Answers[K]>>;
  /** Each line, and what became of it in words, as rows. */
  told: (answer: Answers[K], style: Style) => string[][];
  question: (fresh: number) => string;
  nothingNew: string;
  /** Whether the lines are said again after an add the person was asked about. */
  again: (answer: Answers[K]) => boolean;
  said: (io: Io, answer: Answers[K]) => void;
};

const many = (n: number) => (n === 1 ? "one" : String(n));

/**
 * `brood keep add` and `brood relationships add`: the app's paste, checked first
 * and added on a yes. A list read from standard input leaves nobody to ask
 * there, so it is added only with `--yes`; `--check` stops at the check.
 */
async function paste<K extends Paste>(
  io: Io,
  style: Style,
  options: Options,
  args: string[],
  spec: PasteSpec<K>,
): Promise<void> {
  if (args.length > 1)
    throw new Refusal("Name one file, or none for standard input.");
  noCheckAndYes(options);
  without(options, ["limit", "cursor"], spec.command);
  const [file] = args;
  let given: string;
  try {
    given = file === undefined ? await io.input() : await io.read(file);
  } catch (e) {
    // The code alone, such as ENOENT: the path is the person's own, said back cleaned.
    const code =
      e instanceof Error && "code" in e && typeof e.code === "string"
        ? ` (${e.code})`
        : "";
    throw new Refusal(
      `brood could not read ${file === undefined ? "standard input" : clean(file)}${code}.`,
    );
  }
  if (!given.trim())
    throw new Refusal(
      `${file === undefined ? "Standard input" : clean(file)} holds no ${spec.holds}.`,
    );
  const lines = (a: Answers[K]) => rows(io, spec.told(a, style));
  const body = { ...owner(options), lines: given };
  if (options.yes)
    return shown(io, style, await spec.send(io, body), (a) => {
      lines(a);
      spec.said(io, a);
    });
  const asking = file === undefined ? null : io.ask;
  if (!options.check && (style.json || asking === null))
    throw new Refusal(
      style.json
        ? "With --json, give --check to see what would be added, or --yes to add it."
        : file === undefined
          ? "brood cannot ask while it reads the list from standard input: give --yes to add it, or --check to see what would be added."
          : "Nobody is at a terminal to ask: give --yes to add the list, or --check to see what would be added.",
    );
  const checked = await spec.send(io, { ...body, check: true });
  shown(io, style, checked, lines);
  if (options.check || asking === null) return;
  const fresh = checked.data.lines.filter(
    (l: Answers[K]["lines"][number]) => l.outcome === "added",
  ).length;
  if (fresh === 0) return io.out(spec.nothingNew);
  const yes = await asking(`${spec.question(fresh)} [y/N] `);
  if (!isYes(yes)) return io.out("Nothing added.");
  shown(io, style, await spec.send(io, body), (a) => {
    if (spec.again(a)) lines(a);
    spec.said(io, a);
  });
}

/** A paste's lines as rows, each outcome in words; `to add` for `added` in a check. */
const told = <O extends string>(
  a: { checked: boolean; lines: { line: number; text: string; outcome: O }[] },
  words: Record<O, string>,
  style: Style,
): string[][] =>
  a.lines.map((l) => [
    dim(style, `line ${l.line}`),
    l.text,
    a.checked && l.outcome === "added" ? "to add" : words[l.outcome],
  ]);

const added = (a: { lines: { outcome: string }[] }) =>
  a.lines.filter((l) => l.outcome === "added").length;

/** What became of a line given to `keep`, in words. */
const KEPT: Record<KeepOutcome, string> = {
  added: "added",
  already_listed: "already kept",
  repeated: "repeats an earlier line",
  not_in_force: "not added",
  invalid_address: "refused: not an address",
  invalid_domain: "refused: not a domain",
  invalid_pattern: "refused: not a pattern",
  unrenderable: "refused: a filter cannot hold it exactly",
};

/** What became of a line given to `add_relationships`, in words. */
const NAMED: Record<RelationshipOutcome, string> = {
  added: "added",
  already: "a relationship already",
  shared: "refused: a mail provider's domain or your own",
  invalid: "refused: no domain Brood can read",
  address: "refused: a site's address, so write its domain",
  failed: "not added: Brood failed on it, so try it again",
};

const KEEP: PasteSpec<"keep"> = {
  command: "brood keep add",
  holds: "addresses or domains",
  send: (io, body) => call(io, "keep", body),
  told: (k, style) => told(k, KEPT, style),
  question: (n) => `Keep ${many(n)}?`,
  nothingNew: "Nothing new to keep.",
  again: (k) => !k.in_force,
  said(io, k) {
    if (!k.in_force)
      return io.out(
        "Nothing was added: one of Brood's filters could not change, and the list holds only what every filter keeps. Try again later.",
      );
    io.out(
      added(k) === 0
        ? "Nothing new to keep."
        : `Kept ${many(added(k))}. Brood never files their mail.`,
    );
  },
};

/** The relationships' paste, into the one group the command line named. */
const placedIn = (group: string): PasteSpec<"add_relationships"> => ({
  command: "brood relationships add",
  holds: "relationships",
  send: (io, body) => call(io, "add_relationships", { ...body, group }),
  told: (c, style) => told(c, NAMED, style),
  question: (n) =>
    `Add ${n === 1 ? "one relationship" : `${n} relationships`} to ${clean(group)}?`,
  nothingNew: "No new relationships to add.",
  again: (c) => c.lines.some((l) => l.outcome === "failed"),
  said(io, c) {
    const n = added(c);
    if (n === 0) return io.out("No new relationships were added.");
    io.out(
      `Added ${n === 1 ? "one relationship" : `${n} relationships`}. Brood proposes a home for their mail ${c.later ? "shortly" : "now, among your proposals"}.`,
    );
  },
});

const isYes = (answer: string) => /^y(es)?$/i.test(answer.trim());

/**
 * Whether the person agreed to what was just shown: `--yes`, or a yes at a
 * terminal. With nobody to ask, it is refused rather than assumed.
 */
async function agreed(
  io: Io,
  style: Style,
  options: Options,
  question: string,
  /** Whether the command takes --check, so the refusal names it. */
  checkable = true,
): Promise<boolean> {
  if (options.yes) return true;
  if (style.json || io.ask === null)
    throw new Refusal(
      checkable
        ? style.json
          ? "With --json, give --check to see what would happen, or --yes to do it."
          : "Nobody is at a terminal to ask: give --yes to do it, or --check to see what would happen."
        : style.json
          ? "With --json, give --yes to do it."
          : "Nobody is at a terminal to ask: give --yes to do it.",
    );
  const yes = await io.ask(`${question} [y/N] `);
  if (isYes(yes)) return true;
  io.out("Nothing changed.");
  return false;
}

/**
 * What is about to happen, shown first. With --json only the answer is
 * printed, so a preview is the whole output of --check and nothing otherwise.
 */
function previewed<T>(
  io: Io,
  style: Style,
  options: Options,
  answer: Envelope<T>,
  print: () => void,
): void {
  if (!style.json) return print();
  if (options.check) json(io, answer);
}

const noCheckAndYes = (options: Options) => {
  if (options.check && options.yes)
    throw new Refusal("--check and --yes ask for opposite things: give one.");
};

const anId = (args: string[], what: string, listedBy: string): string => {
  const id = one(args, what);
  if (!UUID.test(id))
    throw new Refusal(`${clean(id)} is not an id: ${listedBy} lists them.`);
  return id;
};

/** `brood proposals file`: the ones named, or with `--all` those Brood marks. */
async function fileProposals(
  io: Io,
  style: Style,
  options: Options,
  args: string[],
): Promise<void> {
  noCheckAndYes(options);
  if (options.all && args.length)
    throw new Refusal("Name proposals or give --all, not both.");
  if (args.length > PROPOSALS_AT_ONCE)
    throw new Refusal(`Name at most ${PROPOSALS_AT_ONCE} at once.`);
  if (!options.all && args.length === 0)
    throw new Refusal(
      "Name the proposals to file, by id, or give --all for those marked ready.",
    );
  const listed = await call(io, "list_proposals", { ...owner(options) });
  const { proposals } = listed.data;
  const named = args.map((id) => {
    const found = proposals.find((p) => p.id === id);
    if (!found) throw new Refusal(`${clean(id)} is not among the proposals.`);
    return found;
  });
  const ready = proposals.filter((p) => p.plain);
  const picked = options.all ? ready.slice(0, PROPOSALS_AT_ONCE) : named;
  if (picked.length === 0)
    return shown(io, style, listed, () => io.out("Nothing to file."));
  previewed(io, style, options, listed, () => {
    rows(
      io,
      picked.map((p) => [p.sender_written.subject, p.sender_written.path]),
    );
    if (options.all && ready.length > picked.length)
      io.out(
        `${ready.length - picked.length} more stay proposals, for another --all.`,
      );
  });
  if (options.check) return;
  const n = picked.length;
  if (
    !(await agreed(
      io,
      style,
      options,
      `File ${n === 1 ? "this one" : `these ${n}`} out of your inbox?`,
    ))
  )
    return;
  shown(
    io,
    style,
    await call(io, "file_proposals", {
      ...owner(options),
      classifications: picked.map((p) => p.id),
      ...(options.all ? { plain: true } : {}),
    }),
    (f) => {
      io.out(`Filed ${f.filed}.`);
      if (f.partly)
        io.out(`${f.partly} filed, with a filter missing from some mailbox.`);
      if (f.refused) io.out(`${f.refused} refused, and not filed.`);
      if (f.left) io.out(`${f.left} not reached in time, and still proposals.`);
    },
  );
}

const REPROPOSED: Record<ReproposeOutcome, string> = {
  reproposed: "It is back among the proposals.",
  already_proposed: "It is among the proposals already.",
  retiring: "Not yet: Brood has yet to remove its filters.",
  returning: "Not yet: its mail is still coming back.",
  not_declined: "It is not declined, so there is nothing to propose again.",
};

/** `brood proposals`, and filing, declining or proposing one again. */
const proposals: Run = async (io, style, options, args) => {
  const [verb, ...rest] = args;
  if (verb === "file") return fileProposals(io, style, options, rest);
  without(
    options,
    ["all", "check", "yes"],
    `brood proposals ${verb ?? ""}`.trim(),
  );
  if (verb === undefined) {
    const answer = await call(io, "list_proposals", { ...owner(options) });
    return shown(io, style, answer, (a) => {
      if (a.proposals.length === 0) return io.out("Nothing proposed.");
      rows(
        io,
        a.proposals.map((p) => [
          p.sender_written.subject,
          p.sender_written.path,
          p.plain ? "ready" : "",
          p.reason ?? "",
          dim(style, p.id),
        ]),
      );
    });
  }
  if (verb === "decline") {
    const classification = anId(rest, "proposal, by its id", "brood proposals");
    return shown(
      io,
      style,
      await call(io, "decline_proposal", {
        ...owner(options),
        classification,
      }),
      (d) =>
        io.out(
          d.outcome === "declined"
            ? "Declined. Brood will not propose it again."
            : "It is no longer a proposal.",
        ),
    );
  }
  if (verb === "again") {
    const classification = anId(
      rest,
      "classification, by its id",
      "brood classifications --state declined",
    );
    return shown(
      io,
      style,
      await call(io, "propose_again", { ...owner(options), classification }),
      (a) => io.out(REPROPOSED[a.outcome]),
    );
  }
  throw new Refusal(
    `brood proposals takes file, decline or again, not ${clean(verb)}.`,
  );
};

const ASKED: Record<UnsubscribeOutcome, string> = {
  asked: "Asked. The sender accepted.",
  declined: "Asked, and the sender did not accept.",
  unreachable: "The sender's address gave no answer.",
  blocked: "Not sent: Brood does not contact that address.",
  not_offered:
    "Not sent: its mailing no longer offers a one-click unsubscribe.",
  never_quiet: "Not sent: it is on your never-quiet list.",
  relationship: "Not sent: it is one of your relationships.",
  limited: "Not sent: today's allowance is spent. Try again tomorrow.",
};

/** `brood unsubscribe`: who can be asked, one asked now, or several in turn. */
const unsubscribeCommand: Run = async (io, style, options, args) => {
  noCheckAndYes(options);
  if (options.all && args.length)
    throw new Refusal("Name senders or give --all, not both.");
  const listed = await call(io, "list_unsubscribable", { ...owner(options) });
  const { senders } = listed.data;
  if (args.length === 0 && !options.all) {
    without(options, ["check", "yes"], "brood unsubscribe with no sender");
    return shown(io, style, listed, (a) => {
      if (a.senders.length === 0)
        return io.out("Nobody Brood can ask just now.");
      rows(
        io,
        a.senders.map((s) => [s.sender_written.address, String(s.recent)]),
      );
      if (a.more) io.out("These are the busiest, and there are more.");
    });
  }
  const named = args.map((name) => {
    const found = senders.find(
      (s) => s.id === name || same(s.sender_written.address, name),
    );
    if (!found)
      throw new Refusal(
        `Brood cannot ask ${clean(name)} just now: brood unsubscribe lists who it can.`,
      );
    return found;
  });
  const picked = options.all ? senders : named;
  if (picked.length === 0)
    return shown(io, style, listed, () =>
      io.out("Nobody Brood can ask just now."),
    );
  previewed(io, style, options, listed, () => {
    rows(
      io,
      picked.map((s) => [s.sender_written.address, String(s.recent)]),
    );
    if (options.all && listed.data.more)
      io.out("These are the busiest, and only these are asked.");
  });
  if (options.check) return;
  const [only] = picked;
  if (only && picked.length === 1 && !options.all) {
    if (
      !(await agreed(
        io,
        style,
        options,
        `Ask ${clean(only.sender_written.address)} to stop? This cannot be taken back.`,
      ))
    )
      return;
    return shown(
      io,
      style,
      await call(io, "unsubscribe", { ...owner(options), sender: only.id }),
      (u) => io.out(ASKED[u.outcome]),
    );
  }
  if (
    !(await agreed(
      io,
      style,
      options,
      `Ask these ${picked.length} to stop, in turn over the coming days? This cannot be taken back.`,
    ))
  )
    return;
  shown(
    io,
    style,
    await call(io, "choose_unsubscribes", {
      ...owner(options),
      senders: picked.map((s) => s.id),
    }),
    (c) => io.out(`Chose ${c.chosen}. Brood asks them in turn.`),
  );
};

type Relationships = Answers["list_relationships"];

const relationshipsNow = (io: Io, options: Options) =>
  call(io, "list_relationships", { ...owner(options) });

const written = (r: Relationships["relationships"][number]["sender_written"]) =>
  [...r.domains, ...r.addresses].join(", ");

/** One of `list`, by its id, its name, or a domain or address it covers. */
function named<
  T extends {
    id: string;
    sender_written: { name: string; domains: string[]; addresses: string[] };
  },
>(list: readonly T[], name: string, what: string): T {
  const found = list.filter(
    (r) =>
      r.id === name ||
      same(r.sender_written.name, name) ||
      [...r.sender_written.domains, ...r.sender_written.addresses].some((d) =>
        same(d, name),
      ),
  );
  if (found.length === 0)
    throw new Refusal(`${clean(name)} is not among your ${what}.`);
  if (found.length > 1)
    throw new Refusal(`Several match ${clean(name)}: name one by its id.`);
  return found[0]!;
}

const GROUP_SAID: Record<GroupOutcome, string> = {
  done: "Done.",
  taken: "Another of your groups has that name.",
  not_empty: "That group still has people in it. Move them first.",
};

/** `brood relationships`, and accepting, dismissing, moving or removing one. */
async function relationshipVerbs(
  io: Io,
  style: Style,
  options: Options,
  verb: string | undefined,
  args: string[],
): Promise<void> {
  const form = `brood relationships ${verb ?? ""}`.trim();
  if (verb === undefined) {
    without(options, ["group", "check", "yes"], form);
    none(args);
    const answer = await relationshipsNow(io, options);
    return shown(io, style, answer, (a) => {
      const inGroup = new Map(a.groups.map((g) => [g.id, g.name]));
      if (a.relationships.length === 0 && a.suggestions.length === 0)
        return io.out("No relationships yet.");
      rows(
        io,
        a.relationships.map((r) => [
          r.sender_written.name,
          written(r.sender_written),
          clean((r.group && inGroup.get(r.group)) ?? "no group"),
          dim(style, r.id),
        ]),
      );
      if (a.suggestions.length) {
        io.out("Brood suggests:");
        rows(
          io,
          a.suggestions.map((r) => [
            r.sender_written.name,
            written(r.sender_written),
            dim(style, r.id),
          ]),
        );
      }
    });
  }
  if (!["accept", "dismiss", "move", "remove"].includes(verb))
    throw new Refusal(
      `brood relationships takes add, accept, dismiss, move or remove, not ${clean(verb)}.`,
    );
  const who = one(args, "relationship, by its id, name or domain");
  const listed = await relationshipsNow(io, options);
  const now = listed.data;
  if (verb === "accept" || verb === "move") {
    without(options, ["check", "yes"], form);
    if (options.group === undefined)
      throw new Refusal(
        `${form} needs --group <name>: the group they join, made if it is new.`,
      );
    const relationship = named(
      verb === "accept" ? now.suggestions : now.relationships,
      who,
      verb === "accept" ? "suggestions" : "relationships",
    ).id;
    const body = { ...owner(options), relationship, group: options.group };
    if (verb === "accept")
      return shown(io, style, await call(io, "accept_suggestion", body), (a) =>
        io.out(
          a.outcome === "done"
            ? `Added. Brood proposes a home for their mail ${a.later ? "shortly" : "now, among your proposals"}.`
            : "It is no longer a suggestion.",
        ),
      );
    return shown(io, style, await call(io, "move_relationship", body), (m) =>
      io.out(GROUP_SAID[m.outcome]),
    );
  }
  if (verb === "dismiss") {
    without(options, ["group", "check", "yes"], form);
    return shown(
      io,
      style,
      await call(io, "dismiss_suggestion", {
        ...owner(options),
        relationship: named(now.suggestions, who, "suggestions").id,
      }),
      (d) =>
        io.out(
          d.outcome === "done"
            ? "Set aside. Brood will not suggest them again."
            : "It is no longer a suggestion.",
        ),
    );
  }
  if (verb === "remove") {
    without(options, ["group"], form);
    noCheckAndYes(options);
    const r = named(now.relationships, who, "relationships");
    previewed(io, style, options, listed, () => {
      rows(io, [[r.sender_written.name, written(r.sender_written)]]);
      io.out(RELATIONSHIP_REMOVAL);
    });
    if (options.check) return;
    if (
      !(await agreed(
        io,
        style,
        options,
        `Remove ${clean(r.sender_written.name)}?`,
      ))
    )
      return;
    return shown(
      io,
      style,
      await call(io, "remove_relationship", {
        ...owner(options),
        relationship: r.id,
      }),
      (m) => io.out(GROUP_SAID[m.outcome]),
    );
  }
}

/** `brood groups`, and adding, renaming, removing or setting one. */
const groups: Run = async (io, style, options, args) => {
  const [verb, ...rest] = args;
  if (verb === undefined) {
    none(rest);
    return shown(io, style, await relationshipsNow(io, options), (a) => {
      if (a.groups.length === 0) return io.out("No groups yet.");
      rows(
        io,
        a.groups.map((g) => [
          clean(g.name),
          g.comes_back ? "comes back" : "stays filed",
          dim(style, g.id),
        ]),
      );
    });
  }
  if (verb === "add") {
    const name = one(rest, "name for the group");
    return shown(
      io,
      style,
      await call(io, "add_group", { ...owner(options), name }),
      (g) => io.out(GROUP_SAID[g.outcome]),
    );
  }
  const [name, ...more] = rest;
  if (name === undefined)
    throw new Refusal(`Name the group to ${clean(verb)}.`);
  if (!["rename", "comes-back", "remove"].includes(verb))
    throw new Refusal(
      `brood groups takes add, rename, comes-back or remove, not ${clean(verb)}.`,
    );
  const { groups: all } = (await relationshipsNow(io, options)).data;
  const found = all.find((g) => g.id === name || same(g.name, name));
  if (!found) throw new Refusal(`${clean(name)} is not one of your groups.`);
  const group = found.id;
  if (verb === "rename") {
    const to = one(more, "new name");
    return shown(
      io,
      style,
      await call(io, "rename_group", { ...owner(options), group, name: to }),
      (g) => io.out(GROUP_SAID[g.outcome]),
    );
  }
  if (verb === "comes-back") {
    const setting = one(more, "setting, on or off");
    if (setting !== "on" && setting !== "off")
      throw new Refusal("brood groups comes-back takes on or off.");
    return shown(
      io,
      style,
      await call(io, "set_group_comes_back", {
        ...owner(options),
        group,
        comes_back: setting === "on",
      }),
      (g) => io.out(GROUP_SAID[g.outcome]),
    );
  }
  none(more);
  return shown(
    io,
    style,
    await call(io, "remove_group", { ...owner(options), group }),
    (g) => io.out(GROUP_SAID[g.outcome]),
  );
};

/** `brood relationships add`, a list of them into one group. */
const relationships: Run = async (io, style, options, args) => {
  const [verb, ...rest] = args;
  if (verb === undefined || verb !== "add")
    return relationshipVerbs(io, style, options, verb, rest);
  if (options.group === undefined)
    throw new Refusal(
      "brood relationships add needs --group <name>: the group they join, made if it is new.",
    );
  return paste(io, style, options, rest, placedIn(options.group));
};

/** `brood keep`, the never-quiet list; `brood keep add`, a list added to it. */
const keep: Run = async (io, style, options, args) => {
  const [verb, ...rest] = args;
  if (verb === "add") return paste(io, style, options, rest, KEEP);
  if (verb !== undefined)
    throw new Refusal(`brood keep takes add, or nothing: not ${clean(verb)}.`);
  without(options, ["check", "yes"], "brood keep");
  const answer = await call(io, "list_kept", {
    ...owner(options),
    ...page(options),
  });
  shown(io, style, answer, (data) => {
    if (!data.kept.length) io.out("Nothing of your own is on the list.");
    rows(
      io,
      data.kept.map((k) => [
        k.value,
        k.kind,
        k.last_wrote ? `last wrote ${day(k.last_wrote)}` : "",
      ]),
    );
    if (!data.seeds.length) return;
    io.out("");
    io.out("Kept for everyone:");
    rows(
      io,
      data.seeds.map((s) => [s.value, dim(style, s.why)]),
    );
  });
};

/**
 * The one classification in `state` a name means: by its id, or what it
 * covers, or its path. Several are put back to the person, as `chosen` does.
 */
async function homeIn(
  io: Io,
  style: Style,
  options: Options,
  name: string,
  state: "active" | "quieted",
  form: string,
): Promise<string> {
  const found = (await classificationsOf(io, options, name)).filter(
    (c) => c.state === state,
  );
  const [only, ...others] = found;
  if (!only)
    throw new Refusal(
      state === "quieted"
        ? `Nothing quieted is ${clean(name)}.`
        : `Nothing filed is ${clean(name)}.`,
    );
  if (!others.length) return only.id;
  io.err(`Several classifications cover ${clean(name)}:`);
  rows(
    io,
    found.map((c) => [c.sender_written.path, c.state, dim(style, c.id)]),
    io.err,
  );
  throw new Refusal(`Run ${form} with the id of the one you mean.`);
}

const RESTORED: Record<Answers["restore_quieted"]["outcome"], string> = {
  restored:
    "Brought back. Brood files it again, and its home is back in place.",
  restored_left:
    "Brought back. Brood files it again; a home you renamed or removed is left as it is.",
  restored_later:
    "Brought back. Brood files it again, and moves its home back at the next rules pass.",
  not_quieted: "It is not quieted, so nothing changed.",
};

/** `brood quieted`, and bringing one back or leaving it quiet. */
const quieted: Run = async (io, style, options, args) => {
  const [verb, ...rest] = args;
  if (verb === undefined) {
    const answer = await call(io, "list_classifications", {
      ...owner(options),
      ...page(options),
      state: "quieted",
    });
    return shown(io, style, answer, (data) => {
      if (!data.classifications.length) return io.out("Nothing is quieted.");
      rows(
        io,
        data.classifications.map((c) => [
          c.sender_written.path,
          c.decided_at ? `quieted ${day(c.decided_at)}` : "",
          dim(style, c.id),
        ]),
      );
    });
  }
  if (verb !== "restore" && verb !== "leave")
    throw new Refusal(
      `brood quieted takes restore or leave, not ${clean(verb)}.`,
    );
  without(options, ["limit", "cursor"], `brood quieted ${verb}`);
  const name = one(rest, "quieted home, by what it covers, its path or its id");
  const classification = await homeIn(
    io,
    style,
    options,
    name,
    "quieted",
    `brood quieted ${verb}`,
  );
  const body = { ...owner(options), classification };
  if (verb === "restore")
    return shown(io, style, await call(io, "restore_quieted", body), (r) =>
      io.out(RESTORED[r.outcome]),
    );
  return shown(io, style, await call(io, "leave_quiet", body), (l) =>
    io.out(
      l.outcome === "not_quieted"
        ? "It is not quieted, so nothing changed."
        : "Left quiet.",
    ),
  );
};

const BATCHED: Record<Answers["set_batched"]["outcome"], string> = {
  batched: "Batched. Its mail comes back to your inbox at your arrival hours.",
  unbatched: "No longer batched.",
  unchanged: "It was already so, or is not a home that can be batched.",
  no_hours:
    "Set your arrival hours on the account page first: they are when batched mail comes back.",
  cannot:
    "A mailbox filing it cannot return mail in batches, or nothing files it now.",
};

/** `brood batch <home> on|off`. */
const batch: Run = async (io, style, options, args) => {
  const [name, setting, ...rest] = args;
  if (name === undefined || setting === undefined || rest.length)
    throw new Refusal("brood batch takes a home and on or off.");
  if (setting !== "on" && setting !== "off")
    throw new Refusal("brood batch takes on or off.");
  const classification = await homeIn(
    io,
    style,
    options,
    name,
    "active",
    "brood batch",
  );
  shown(
    io,
    style,
    await call(io, "set_batched", {
      ...owner(options),
      classification,
      batched: setting === "on",
    }),
    (b) => io.out(BATCHED[b.outcome]),
  );
};

const CANNOT_ADOPT: Record<AdoptRefusalWord, string> = {
  matches_more: "it matches more than a sender",
  not_one_sender: "it names no one sender",
  keeps_in_inbox: "it leaves mail in the inbox",
  forwards: "it forwards",
  does_more: "it does more than file",
  no_home: "it files under none of your homes",
  several_homes: "it files under several homes",
};

const isAdoptRefusal = (o: AdoptOutcome): o is AdoptRefusalWord =>
  (ADOPT_REFUSALS as readonly string[]).includes(o);

const ADOPTED: Record<Exclude<AdoptOutcome, AdoptRefusalWord>, string> = {
  adopted:
    "Taken over. Brood files that sender as your filter did, and brood unhush puts your filter back.",
  gone: "That filter is no longer in the mailbox.",
  no_mail: "Brood has no mail from its sender yet.",
  not_root: "It names a part of a domain, which Brood does not file by.",
  already_brood: "Brood already files or has quieted that sender.",
  never_quiet: "Your never-quiet list keeps that sender in view.",
  unrenderable: "Its sender is not one a filter of Brood's can hold exactly.",
  not_connected: "That mailbox is not connected.",
};

const adoptedSaid = (o: AdoptOutcome) =>
  isAdoptRefusal(o)
    ? `Brood cannot take it over: ${CANNOT_ADOPT[o]}.`
    : ADOPTED[o];

/** `brood own-rules`, your filters read now; `adopt <mailbox> <id>` takes one over. */
const ownRules: Run = async (io, style, options, args) => {
  const [verb, ...rest] = args;
  if (verb === undefined) {
    without(options, ["yes"], "brood own-rules");
    const answer = await call(io, "list_own_rules", owner(options));
    return shown(io, style, answer, (a) => {
      if (!a.mailboxes.length) return io.out("No mailbox is connected.");
      for (const m of a.mailboxes) {
        io.out(clean(m.mailbox));
        if (m.rules === null) {
          io.out("  Brood could not read its filters just now.");
          continue;
        }
        if (!m.rules.shown.length)
          io.out("  No filter of yours names one sender.");
        rows(
          io,
          m.rules.shown.map((f) => [
            "",
            clean(f.sender.value),
            clean(f.under.join(", ")),
            f.cannot_adopt ? CANNOT_ADOPT[f.cannot_adopt] : "can be taken over",
            dim(style, f.id),
          ]),
        );
        if (m.rules.unreadable)
          io.out(
            `  ${m.rules.unreadable === 1 ? "One more names" : `${m.rules.unreadable} more name`} no one sender.`,
          );
        for (const l of m.rules.left_behind)
          io.out(`  ${clean(l.by)} left ${l.homes.map(clean).join(", ")}.`);
      }
    });
  }
  if (verb !== "adopt")
    throw new Refusal(`brood own-rules takes adopt, not ${clean(verb)}.`);
  const [mailbox, rule, ...more] = rest;
  if (mailbox === undefined || rule === undefined || more.length)
    throw new Refusal(
      "brood own-rules adopt takes a mailbox and a filter's id, as brood own-rules lists them.",
    );
  const { accounts } = (await call(io, "list_accounts", owner(options))).data;
  const account = accounts.find(
    (a) => a.id === mailbox || same(a.address, mailbox),
  );
  if (!account)
    throw new Refusal(`${clean(mailbox)} is not one of your mailboxes.`);
  if (
    !(await agreed(
      io,
      style,
      options,
      `Take over filter ${clean(rule)} in ${clean(account.address)}, so Brood files its sender?`,
      false,
    ))
  )
    return;
  shown(
    io,
    style,
    await call(io, "adopt_rule", {
      ...owner(options),
      account: account.id,
      rule,
    }),
    (a) => io.out(adoptedSaid(a.outcome)),
  );
};

/**
 * One address and its sender id, found in its root's portrait as its page
 * finds it: the root by a row of `list_senders` it is under, then the
 * address among the root's.
 */
async function addressOf(
  io: Io,
  options: Options,
  address: string,
): Promise<Answers["get_sender"]["addresses"][number]> {
  const at = address.lastIndexOf("@");
  if (at <= 0)
    throw new Refusal(
      `${clean(address)} is not an address: name the one to keep out, such as alerts@example.com.`,
    );
  const domain = address.slice(at + 1).toLowerCase();
  const since = daysBack(io, PORTRAIT_DAYS);
  let cursor: string | undefined;
  for (let n = 0; n < LOOKUP_PAGES; n++) {
    const answer = await call(io, "list_senders", {
      ...owner(options),
      since,
      limit: API_PAGE_MAX,
      ...(cursor ? { cursor } : {}),
    });
    const row = answer.data.senders.find(({ sender_written: w }) =>
      w.address === null
        ? domain === w.root.toLowerCase() ||
          domain.endsWith(`.${w.root.toLowerCase()}`)
        : same(w.address, address),
    );
    if (row) {
      const portrait = (
        await call(io, "get_sender", { ...owner(options), sender: row.id })
      ).data;
      const found = portrait.addresses.find((a) =>
        same(a.sender_written.address, address),
      );
      if (found) return found;
      throw new Refusal(
        portrait.more_addresses
          ? `${clean(address)} is not among the addresses Brood lists for ${clean(row.sender_written.root)}.`
          : `Brood has no mail from ${clean(address)} from ${since}.`,
      );
    }
    if (!answer.next)
      throw new Refusal(
        `Brood has no mail from ${clean(address)} from ${since}.`,
      );
    cursor = answer.next;
  }
  throw tooMany(address);
}

const KEPT_OUT: Record<Answers["keep_out"]["outcome"], string> = {
  kept_out:
    "Kept out. Brood will not file it again, and its mail is coming back to your inbox, the first of it now and the rest within the hour.",
  kept_out_pending:
    "Kept out, and its mail is coming back. Brood narrows the filter itself within the hour; until then new mail from it may still be filed.",
  own_home: "It has a home of its own: brood unhush undoes that.",
  not_filed: "Nothing files it now.",
  unrenderable:
    "Its address is not one a filter can leave out exactly, so nothing changed.",
};

/** `brood keep-out <address>`: one address out of its domain's filing. */
const keepOutCommand: Run = async (io, style, options, args) => {
  const found = await addressOf(io, options, one(args, "address"));
  const filed = found.filing.flatMap((f) =>
    f.classification ? [f.classification.sender_written.path] : [],
  );
  if (!filed.length)
    throw new Refusal(
      `Nothing files ${clean(found.sender_written.address)} now.`,
    );
  if (
    !(await agreed(
      io,
      style,
      options,
      `Keep ${clean(found.sender_written.address)} out of ${[...new Set(filed)].map(clean).join(", ")}, and bring its mail back?`,
      false,
    ))
  )
    return;
  shown(
    io,
    style,
    await call(io, "keep_out", { ...owner(options), sender: found.id }),
    (k) => io.out(KEPT_OUT[k.outcome]),
  );
};

const FILED_EXISTING: Record<Answers["file_existing"]["outcome"], string> = {
  filed: "Filed what was already there.",
  continues: "Filing what was already there; the hourly pass files the rest.",
  later: "Today's filing is spent; the hourly pass files it.",
  stopped: "It no longer files, so nothing more was moved.",
};

const RULE_BOOK_SAID: Record<Answers["reset_rule_book"]["outcome"], string> = {
  saved: "Saved. Brood decides by them from its next run.",
  unchanged: "They were already so, so nothing changed.",
  no_mailbox:
    "Connect a mailbox first: with none, the numbers apply to nothing.",
  stale:
    "The numbers changed since this was checked, so nothing was saved. Run it again.",
};

/** `name=value`, each a rule book number, as `brood rule-book set` takes them. */
function numbersOf(args: string[]): Partial<Record<ThresholdName, number>> {
  if (!args.length)
    throw new Refusal(
      `Name a number to change, as name=value: ${RULE_BOOK_KEYS.join(", ")}.`,
    );
  const numbers: Partial<Record<ThresholdName, number>> = {};
  for (const arg of args) {
    const parts = arg.split("=");
    if (parts.length !== 2)
      throw new Refusal(
        `${clean(arg)} is not name=value, as quiet.silence_days=60.`,
      );
    const [name = "", value = ""] = parts;
    const key = RULE_BOOK_KEYS.find((k) => k === name);
    if (!key)
      throw new Refusal(
        `${clean(name)} is not one of the rule book's numbers: ${RULE_BOOK_KEYS.join(", ")}.`,
      );
    if (!/^\d+$/.test(value))
      throw new Refusal(`${key} takes a whole number, as ${key}=60.`);
    numbers[key] = Number(value);
  }
  return numbers;
}

const differences = (d: Answers["set_rule_book"]["sender_written"]) => {
  if (d === null) return [];
  const said = (
    which: NonNullable<typeof d>["more"],
    would: string,
  ): string[] => [
    ...which.homes.map((p) => `${would} propose ${clean(p)}`),
    ...which.quieted.map((p) => `${would} quiet ${clean(p)}`),
    ...which.declined.map((p) => `${would} stop filing ${clean(p)}`),
    ...which.relationships.map((p) => `${would} suggest ${clean(p)}`),
  ];
  return [...said(d.more, "would"), ...said(d.fewer, "would no longer")];
};

/** `brood rule-book`, and changing its numbers or putting them back. */
const ruleBook: Run = async (io, style, options, args) => {
  const [verb, ...rest] = args;
  if (verb === undefined) {
    without(options, ["check", "yes"], "brood rule-book");
    return shown(
      io,
      style,
      await call(io, "get_rule_book", owner(options)),
      (b) => {
        rows(
          io,
          RULE_BOOK_KEYS.map((k) => [
            k,
            String(b.numbers[k]),
            b.numbers[k] === b.defaults[k]
              ? ""
              : dim(style, `default ${b.defaults[k]}`),
          ]),
        );
        if (b.ignored.length)
          io.out(
            `Brood could not use your ${b.ignored.join(", ")}, so the default stands in.`,
          );
        if (!b.can_change) io.out("Changing them is Pro's.");
      },
    );
  }
  if (verb === "reset") {
    without(options, ["check"], "brood rule-book reset");
    none(rest);
    if (
      !(await agreed(
        io,
        style,
        options,
        "Put every number back to its default?",
        false,
      ))
    )
      return;
    return shown(
      io,
      style,
      await call(io, "reset_rule_book", owner(options)),
      (r) => io.out(RULE_BOOK_SAID[r.outcome]),
    );
  }
  if (verb !== "set")
    throw new Refusal(
      `brood rule-book takes set or reset, not ${clean(verb)}.`,
    );
  noCheckAndYes(options);
  const numbers = numbersOf(rest);
  const checked = await call(io, "set_rule_book", {
    ...owner(options),
    numbers,
    check: true,
  });
  previewed(io, style, options, checked, () => {
    const said = differences(checked.data.sender_written);
    if (!said.length) io.out("Brood would decide nothing differently today.");
    else for (const line of said) io.out(`Brood ${line}.`);
  });
  if (options.check) return;
  const inForce = checked.data.in_force;
  if (inForce === null) throw new Refusal("Brood did not check the change.");
  if (!(await agreed(io, style, options, "Save these numbers?"))) return;
  shown(
    io,
    style,
    await call(io, "set_rule_book", {
      ...owner(options),
      numbers,
      in_force: inForce,
    }),
    (r) => io.out(RULE_BOOK_SAID[r.outcome ?? "saved"]),
  );
};

/** Each command, and the options it takes, so one it does not is refused rather than ignored. */
export const COMMANDS: Record<string, { run: Run; takes: OptionName[] }> = {
  accounts: { run: accounts, takes: [] },
  week: { run: week, takes: ["week"] },
  senders: { run: senders, takes: ["since", "until", "limit", "cursor"] },
  events: {
    run: events,
    takes: ["since", "until", "limit", "cursor", "sender"],
  },
  quiet: { run: quiet, takes: ["limit", "cursor"] },
  classifications: {
    run: classifications,
    takes: ["state", "limit", "cursor"],
  },
  classification: { run: classification, takes: [] },
  rules: { run: rules, takes: ["classification", "limit", "cursor"] },
  hush: { run: hush, takes: [] },
  unhush: { run: unhush, takes: [] },
  keep: { run: keep, takes: ["check", "yes", "limit", "cursor"] },
  relationships: { run: relationships, takes: ["group", "check", "yes"] },
  groups: { run: groups, takes: [] },
  quieted: { run: quieted, takes: ["limit", "cursor"] },
  batch: { run: batch, takes: [] },
  "own-rules": { run: ownRules, takes: ["yes"] },
  "keep-out": { run: keepOutCommand, takes: ["yes"] },
  "rule-book": { run: ruleBook, takes: ["check", "yes"] },
  proposals: { run: proposals, takes: ["all", "check", "yes"] },
  unsubscribe: { run: unsubscribeCommand, takes: ["all", "check", "yes"] },
};
