import { parseArgs } from "node:util";
import { call } from "./client.ts";
import { COMMANDS, type OptionName, type Options } from "./commands.ts";
import { Refused, Refusal, SessionEnded, type Io } from "./io.ts";
import { colorOn, styleOf } from "./out.ts";
import { login } from "./sign-in.ts";
import { readCredentials, removeCredentials } from "./store.ts";
import { VERSION } from "./version.ts";
import { depthOf, wrenIn } from "./wren.ts";

/**
 * `brood`, the command line over Brood's index (DD10): it answers questions
 * about a mailbox without opening one, and changes it only by `hush` and
 * `unhush`. Bare `brood` prints this help, never a report (DD10 §3), so it is
 * never a status glanced at, under the wren.
 */

const HELP = `brood answers questions about your mailbox from Brood's index. It never reads a message.

Observing
  brood week                        one finished week, beside the week before
  brood senders                     who wrote, most first
  brood senders <domain|address>    one sender
  brood events [--sender <name>]    messages that arrived or were sent, newest first
  brood quiet                       senders that have gone silent

Structure
  brood classifications [<path>]    what Brood has decided, and its state
  brood classification <id>         one, with the reason for its state
  brood rules [<id>]                the filters Brood installed

Suppression, the two that change your mailbox
  brood hush <domain|address|id>    file what Brood proposed for a sender
  brood unhush <domain|address|id>  undo the filing

Accounts and session
  brood accounts                    your mailboxes, and whether Brood can read them
  brood login [--read-only]         sign in, by a code you approve in a browser
  brood logout                      end this session
  brood version

Options
  --json                 the answer as the API gives it
  --since, --until       a stretch of whole days, as YYYY-MM-DD in UTC
  --limit <n>            how many to show
  --cursor <next>        carry on a listing from where it stopped
  --state <state>        classifications in one state
  --week <monday>        brood week for an earlier week
  --classification <id>  brood rules for one classification
  --owner <user id>      the index of someone who granted you access
  --no-color             no dimming, as NO_COLOR also asks`;

async function logout(io: Io): Promise<void> {
  if (!(await readCredentials(io.env))) return io.err("Not signed in.");
  try {
    await call(io, "end_session", (held) => ({
      refresh_token: held.refresh_token,
    }));
  } catch (error) {
    // Forgotten only when nothing is left to end: a session Clerk has ended,
    // or a program Brood refuses as revoked, whose file would otherwise leave
    // login refusing too. Anything else, Brood unreachable or failing, or
    // refusing a token just renewed, may leave the session live at Clerk,
    // so the file stays and logging out again can end it.
    const over =
      error instanceof SessionEnded ||
      (error instanceof Refused && error.code === "credential_revoked");
    if (!over) throw error;
  }
  await removeCredentials(io.env);
  io.err("Signed out. This session can no longer be renewed.");
}

const OPTION_NAMES: OptionName[] = [
  "since",
  "until",
  "limit",
  "cursor",
  "state",
  "week",
  "sender",
  "classification",
];

/** Runs one command line, and answers its exit status. */
export async function run(io: Io, argv: string[]): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: "boolean", default: false },
        "no-color": { type: "boolean", default: false },
        "read-only": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        since: { type: "string" },
        until: { type: "string" },
        limit: { type: "string" },
        cursor: { type: "string" },
        state: { type: "string" },
        week: { type: "string" },
        sender: { type: "string" },
        classification: { type: "string" },
        owner: { type: "string" },
      },
    });
    const [command, ...args] = positionals;
    const empty = Object.entries(values).find(([, v]) => v === "");
    if (empty) throw new Refusal(`--${empty[0]} needs a value.`);
    // An option a command does not take is refused, never ignored: a flag
    // with nothing behind it looks like a filter that was applied (DD10 §3).
    const takes = (names: OptionName[], readOnly = false) => {
      const given = OPTION_NAMES.find(
        (n) => values[n] !== undefined && !names.includes(n),
      );
      if (given)
        throw new Refusal(`--${given} does not apply to brood ${command}.`);
      if (values["read-only"] && !readOnly)
        throw new Refusal(`--read-only applies to brood login alone.`);
    };
    // The session commands read no index, so neither whose nor how to print.
    const session = (colors = false) => {
      if (args.length)
        throw new Refusal(`brood ${command} takes no arguments.`);
      const given = (["owner", "json"] as const).find((n) =>
        n === "json" ? values.json : values.owner !== undefined,
      );
      if (given)
        throw new Refusal(`--${given} does not apply to brood ${command}.`);
      if (values["no-color"] && !colors)
        throw new Refusal(`--no-color does not apply to brood ${command}.`);
    };
    if (command === undefined || command === "help" || values.help) {
      const color = colorOn(io, values["no-color"]);
      for (const line of wrenIn(color ? depthOf(io.env) : "none")) io.out(line);
      io.out("");
      io.out(HELP);
      return 0;
    }
    if (command === "version") {
      takes([]);
      session();
      io.out(VERSION);
      return 0;
    }
    if (command === "login") {
      takes([], true);
      session(true);
      await login(io, values["read-only"], values["no-color"]);
      return 0;
    }
    if (command === "logout") {
      takes([]);
      session();
      await logout(io);
      return 0;
    }
    const runs = Object.hasOwn(COMMANDS, command)
      ? COMMANDS[command]
      : undefined;
    if (!runs)
      throw new Refusal(`brood has no command ${command}. Run brood help.`);
    takes(runs.takes);
    const limit = values.limit === undefined ? undefined : Number(values.limit);
    if (limit !== undefined && !Number.isInteger(limit))
      throw new Refusal("--limit is a whole number.");
    const options: Options = {
      ...(values.owner === undefined ? {} : { owner: values.owner }),
      ...(values.since === undefined ? {} : { since: values.since }),
      ...(values.until === undefined ? {} : { until: values.until }),
      ...(limit === undefined ? {} : { limit }),
      ...(values.cursor === undefined ? {} : { cursor: values.cursor }),
      ...(values.state === undefined ? {} : { state: values.state }),
      ...(values.week === undefined ? {} : { week: values.week }),
      ...(values.sender === undefined ? {} : { sender: values.sender }),
      ...(values.classification === undefined
        ? {}
        : { classification: values.classification }),
    };
    await runs.run(
      io,
      styleOf(io, { json: values.json, noColor: values["no-color"] }),
      options,
      args,
    );
    return 0;
  } catch (error) {
    if (error instanceof Refusal) {
      io.err(error.message);
      return 1;
    }
    // parseArgs refuses an option it does not know, or one missing its value.
    if (
      error instanceof TypeError &&
      "code" in error &&
      typeof error.code === "string" &&
      error.code.startsWith("ERR_PARSE_ARGS")
    ) {
      io.err(`${error.message}. Run brood help.`);
      return 1;
    }
    throw error;
  }
}
