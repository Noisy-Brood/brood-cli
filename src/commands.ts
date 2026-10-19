import {
  CLASSIFICATION_STATES,
  TONE_TITLES,
  type Answers,
  type Classification,
  type Envelope,
  type Rule,
} from "./brood/api/src/client.ts";
import { API_PAGE_MAX, API_STRETCH_DAYS, PORTRAIT_DAYS } from "./brood/figures/index.ts";
import { call } from "./client.ts";
import { clean, Refusal, type Io } from "./io.ts";
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
  verb: "hush" | "unhush",
): Promise<string> {
  const all = await classificationsOf(io, options, name);
  const found =
    verb === "unhush"
      ? all.filter((c) => c.state === "active" || c.state === "quieted")
      : all;
  const [only, ...others] = found;
  if (!only)
    throw new Refusal(
      verb === "hush"
        ? `Brood has proposed nothing for ${clean(name)}.`
        : `Nothing is filed for ${clean(name)}.`,
    );
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
        s.sender_written.customer ?? s.sender_written.root,
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
  io.out(s.scope === "address" ? w.address : (w.customer ?? w.root));
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
  const answer = await call(io, "hush", {
    ...owner(options),
    classification: id,
  });
  shown(io, style, answer, (h) => {
    io.out(
      h.already
        ? `${clean(name)} was filed already.`
        : `Filed ${clean(name)} out of your inbox.`,
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
};
