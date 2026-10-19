import type { AccountState, Envelope } from "./brood/api/src/client.ts";
import type { Io } from "./io.ts";

/**
 * How an answer reaches the terminal (DD10 §4): aligned rows for a listing,
 * colour only to dim what is secondary, and nothing printed that was not
 * asked for. `--json` prints the answer as the API gave it, cleaned as
 * everything from outside is.
 */

export type Style = { json: boolean; color: boolean };

/**
 * Whether a terminal may be shown colour: it is one, nothing asked it not
 * to, and NO_COLOR is not set, whatever its value, as no-color.org says.
 */
export const colorOn = (io: Io, noColor: boolean): boolean =>
  io.tty && !noColor && io.env.NO_COLOR === undefined;

export const styleOf = (
  io: Io,
  flags: { json: boolean; noColor: boolean },
): Style => ({
  json: flags.json,
  color: colorOn(io, flags.noColor),
});

export const dim = (style: Style, text: string): string =>
  style.color ? `\u001b[2m${text}\u001b[22m` : text;

/** How wide a cell shows: its characters, without the codes that dim it. */
const width = (cell: string) => [...cell.replace(/\u001b\[\d+m/g, "")].length;

/**
 * Rows as columns, each as wide as its widest cell; the last is left as it
 * is. The cells are already clean: the answer was cleaned as it arrived.
 */
export function rows(io: Io, cells: string[][], line = io.out): void {
  const widths: number[] = [];
  for (const row of cells)
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, width(cell));
    });
  for (const row of cells)
    line(
      row
        .map((cell, i) =>
          i === row.length - 1
            ? cell
            : cell + " ".repeat((widths[i] ?? 0) - width(cell)),
        )
        .join("  ")
        .trimEnd(),
    );
}

/** A day, from a timestamp the API gave. */
export const day = (at: string | null): string => (at ? at.slice(0, 10) : "");

/**
 * Before an answer, what the person must know to trust it (DD21 §8): every
 * mailbox Brood could not read whole. A disconnected one is said too, so its
 * silence is not read as quiet, though it leaves the answer complete.
 */
export function state(io: Io, style: Style, envelope: Envelope<unknown>): void {
  // Each mailbox the answer did not read whole, as the API judges it, a
  // current one too (#1369).
  const unread = envelope.accounts.filter((a: AccountState) => !a.whole);
  for (const a of unread)
    io.err(
      dim(
        style,
        `Mailbox ${a.id}: ${a.sync.phase === "current" ? "current, but not read whole for this answer" : a.sync.phase}${a.sync.last_synced_at ? `, last reached ${day(a.sync.last_synced_at)}` : ""}.`,
      ),
    );
  if (!envelope.complete)
    io.err(
      dim(
        style,
        "This answer is not complete: Brood has not read every connected mailbox whole.",
      ),
    );
}

/** Where a listing carries on, said after it. */
export function more(io: Io, style: Style, envelope: Envelope<unknown>): void {
  if (envelope.next)
    io.err(dim(style, `More: run it again with --cursor ${envelope.next}`));
}

/** The answer as the API gave it, cleaned, for a program to read. */
export const json = (io: Io, envelope: Envelope<unknown>): void =>
  io.out(JSON.stringify(envelope, null, 2));
