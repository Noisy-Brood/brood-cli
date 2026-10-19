import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { run } from "./main.ts";
import {
  ACCOUNT,
  api,
  envelope,
  problem,
  signedIn,
  standIn,
} from "./stand-in.test-support.ts";
import { DARK_BARN } from "./brood/tokens/dark.ts";

/**
 * The commands (DD10 §3, #1339): what each prints, that nothing a sender
 * wrote reaches the terminal unclean, that an answer Brood could not read
 * whole says so first, and how hush and unhush find the one classification
 * a sender's name means.
 */

const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const senders = (
  rows: { root: string; address?: string | null; messages: number }[],
) => ({
  resolution: "day",
  counted_from: "2026-09-18",
  counted_to: "2026-10-17",
  senders: rows.map((r, i) => ({
    id: ID(i + 1),
    messages: r.messages,
    first: "2026-09-20T10:00:00Z",
    last: "2026-10-16T10:00:00Z",
    sender_written: { root: r.root, address: r.address ?? null },
  })),
});

const classification = (
  n: number,
  subject: string,
  state: string,
  path = `external/${subject}`,
) => ({
  id: ID(n),
  state,
  reason: "volume",
  subject_kind: "domain",
  proposed_at: "2026-10-01T00:00:00Z",
  decided_at: null,
  decided_by: null,
  sender_written: { path, subject },
});

describe("reading the index (#1339)", () => {
  it("lists senders as rows, most first, and says how they were counted", async () => {
    const s = await signedIn({
      [api("list_senders")]: [
        () =>
          envelope(
            senders([
              { root: "stripe.com", messages: 41 },
              { root: "linear.app", messages: 28 },
            ]),
          ),
      ],
    });
    assert.equal(await run(s.io, ["senders"]), 0);
    assert.deepEqual(s.out, [
      "stripe.com  41  last 2026-10-16",
      "linear.app  28  last 2026-10-16",
    ]);
    assert.ok(s.err.some((l) => l.includes("counted by the day")));
  });

  it("prints nothing a sender wrote that could rewrite the terminal", async () => {
    const s = await signedIn({
      [api("list_senders")]: [
        () =>
          envelope(senders([{ root: "evil\u001b[2J‮.example", messages: 1 }])),
      ],
    });
    await run(s.io, ["senders"]);
    assert.equal(s.out[0], "evil[2J.example  1  last 2026-10-16");
  });

  it("says first when a mailbox was not read whole, before the answer", async () => {
    const stalled = {
      id: "acc-2",
      sync: {
        phase: "stalled",
        indexed_through: null,
        last_synced_at: "2026-10-10T00:00:00Z",
      },
      whole: false,
    };
    const s = await signedIn({
      [api("list_senders")]: [
        () =>
          envelope(senders([]), {
            accounts: [ACCOUNT, stalled],
            complete: false,
          }),
      ],
    });
    await run(s.io, ["senders"]);
    assert.ok(
      s.err.some(
        (l) => l === "Mailbox acc-2: stalled, last reached 2026-10-10.",
      ),
    );
    assert.ok(s.err.some((l) => l.includes("not complete")));
    assert.ok(!s.err.some((l) => l.startsWith("Mailbox acc-1")));
  });

  it("prints the answer as the API gave it with --json", async () => {
    const s = await signedIn({
      [api("list_senders")]: [
        () =>
          envelope(senders([{ root: "stripe.com", messages: 41 }]), {
            next: "abc",
          }),
      ],
    });
    await run(s.io, ["senders", "--json"]);
    const printed = JSON.parse(s.out.join("\n"));
    assert.equal(printed.next, "abc");
    assert.equal(printed.data.senders[0].messages, 41);
    assert.deepEqual(s.err, []);
  });

  it("passes the stretch and the page on, and says where a listing carries on", async () => {
    const s = await signedIn({
      [api("list_senders")]: [() => envelope(senders([]), { next: "abc" })],
    });
    await run(s.io, [
      "senders",
      "--since",
      "2026-10-01",
      "--until",
      "2026-10-07",
      "--limit",
      "5",
      "--cursor",
      "xyz",
    ]);
    assert.deepEqual(JSON.parse(s.sent[0]!.body), {
      limit: 5,
      cursor: "xyz",
      since: "2026-10-01",
      until: "2026-10-07",
    });
    assert.ok(s.err.some((l) => l.includes("--cursor abc")));
  });

  it("finds one sender by its root domain, then reads it by its id", async () => {
    const s = await signedIn({
      [api("list_senders")]: [
        () =>
          envelope(
            senders([
              { root: "linear.app", messages: 2 },
              { root: "stripe.com", messages: 41 },
            ]),
          ),
      ],
      [api("get_sender")]: [
        () =>
          envelope({
            id: ID(2),
            scope: "domain",
            messages: 41,
            mailing: true,
            written_to: false,
            first_wrote: "2026-01-02T00:00:00Z",
            weeks: [],
            months: [],
            classifications: [],
            addresses: [],
            more_addresses: false,
            sender_written: {
              address: "receipts@stripe.com",
              domain: "stripe.com",
              root: "stripe.com",
              roots: ["stripe.com"],
              customer: null,
              never_quiet_roots: [],
              never_quiet_addresses: [],
            },
          }),
      ],
    });
    assert.equal(await run(s.io, ["senders", "Stripe.com"]), 0);
    assert.deepEqual(JSON.parse(s.sent[1]!.body), {
      sender: ID(2),
      scope: "domain",
    });
    assert.equal(s.out[0], "stripe.com");
  });

  it("says when Brood has no mail from a sender named", async () => {
    const s = await signedIn({
      [api("list_senders")]: [() => envelope(senders([]))],
    });
    assert.equal(await run(s.io, ["senders", "nobody.example"]), 1);
    assert.ok(
      s.err.some((l) => l.startsWith("Brood has no mail from nobody.example")),
    );
  });

  it("refuses a state classifications do not have, before calling", async () => {
    const s = await signedIn({});
    assert.equal(await run(s.io, ["classifications", "--state", "gone"]), 1);
    assert.deepEqual(s.sent, []);
  });

  it("says a problem's title and what failed", async () => {
    const s = await signedIn({
      [api("get_rule")]: [() => problem(404, "not_found")],
    });
    assert.equal(await run(s.io, ["rules", ID(9)]), 1);
    assert.deepEqual(s.err, ["Not found."]);
  });
});

describe("hush and unhush (#1339, DD10 §3)", () => {
  it("hushes the one classification covering a sender named by its domain", async () => {
    const s = await signedIn({
      [api("list_classifications")]: [
        () =>
          envelope({
            classifications: [
              classification(1, "linear.app", "proposed"),
              classification(2, "stripe.com", "proposed"),
            ],
          }),
      ],
      [api("hush")]: [
        () =>
          envelope({
            id: ID(2),
            state: "active",
            already: false,
            rules: [{ id: ID(7), account: "acc-1" }],
            failed: [],
          }),
      ],
    });
    assert.equal(await run(s.io, ["hush", "stripe.com"]), 0);
    assert.deepEqual(JSON.parse(s.sent[1]!.body), { classification: ID(2) });
    assert.deepEqual(s.out, ["Filed stripe.com out of your inbox."]);
  });

  it("lists the choices when several cover the name, and acts on none", async () => {
    const s = await signedIn({
      [api("list_classifications")]: [
        () =>
          envelope({
            classifications: [
              classification(1, "stripe.com", "proposed"),
              classification(
                2,
                "stripe.com",
                "declined",
                "external/stripe/billing",
              ),
            ],
          }),
      ],
    });
    assert.equal(await run(s.io, ["hush", "stripe.com"]), 1);
    assert.ok(!s.sent.some((x) => x.url === api("hush")));
    assert.ok(
      s.err.some(
        (l) => l.includes("external/stripe/billing") && l.includes(ID(2)),
      ),
    );
    // Off standard output, so --json there stays JSON.
    assert.deepEqual(s.out, []);
    assert.ok(s.err.some((l) => l.includes("with the id of the one you mean")));
  });

  it("says Brood proposed nothing for a sender it has no classification of", async () => {
    const s = await signedIn({
      [api("list_classifications")]: [() => envelope({ classifications: [] })],
    });
    assert.equal(await run(s.io, ["hush", "stripe.com"]), 1);
    assert.deepEqual(s.err, ["Brood has proposed nothing for stripe.com."]);
  });

  it("reads every page before choosing, so a match on a later page is not missed", async () => {
    const s = await signedIn({
      [api("list_classifications")]: [
        () =>
          envelope(
            { classifications: [classification(1, "linear.app", "proposed")] },
            { next: "p2" },
          ),
        () =>
          envelope({
            classifications: [classification(2, "stripe.com", "proposed")],
          }),
      ],
      [api("hush")]: [
        () =>
          envelope({
            id: ID(2),
            state: "active",
            already: true,
            rules: [],
            failed: [],
          }),
      ],
    });
    assert.equal(await run(s.io, ["hush", "stripe.com"]), 0);
    assert.equal(JSON.parse(s.sent[1]!.body).cursor, "p2");
    assert.deepEqual(s.out, ["stripe.com was filed already."]);
  });

  it("unhushes only what is filed, leaving a proposal of the same sender aside", async () => {
    const s = await signedIn({
      [api("list_classifications")]: [
        () =>
          envelope({
            classifications: [
              classification(1, "stripe.com", "proposed"),
              classification(
                2,
                "stripe.com",
                "active",
                "external/stripe/billing",
              ),
            ],
          }),
      ],
      [api("unhush")]: [
        () =>
          envelope({
            id: ID(2),
            outcome: "undone",
            returning: ["acc-1"],
            handed_back: false,
            home_left: 0,
          }),
      ],
    });
    assert.equal(await run(s.io, ["unhush", "stripe.com"]), 0);
    assert.deepEqual(JSON.parse(s.sent[1]!.body), { classification: ID(2) });
    assert.ok(s.out[0]!.startsWith("Undone."));
  });

  it("says a session that may only read cannot hush, and how to change it", async () => {
    const s = await signedIn({
      [api("list_classifications")]: [
        () =>
          envelope({
            classifications: [classification(1, "stripe.com", "proposed")],
          }),
      ],
      [api("hush")]: [() => problem(403, "insufficient_scope")],
    });
    assert.equal(await run(s.io, ["hush", "stripe.com"]), 1);
    assert.ok(s.err.some((l) => l.includes("without --read-only")));
  });
});

describe("the command line itself (#1339)", () => {
  it("prints help for bare brood, never a report, and reads nothing", async () => {
    const s = standIn({});
    assert.equal(await run(s.io, []), 0);
    assert.ok(s.out.some((l) => /never reads a message/.test(l)));
    assert.deepEqual(s.sent, []);
  });

  it("refuses an option it does not know, before anything is sent", async () => {
    const s = await signedIn({});
    assert.equal(await run(s.io, ["senders", "--everything"]), 1);
    assert.ok(s.err.some((l) => l.includes("brood help")));
    assert.deepEqual(s.sent, []);
  });

  it("refuses a command it does not have", async () => {
    const s = standIn({});
    assert.equal(await run(s.io, ["status"]), 1);
    assert.deepEqual(s.err, ["brood has no command status. Run brood help."]);
  });
});

const hostile = "evil\u001b]0;owned\u0007\u202e.example";

const sender = (customer: string | null) => ({
  id: ID(2),
  scope: "domain",
  messages: 4,
  mailing: false,
  written_to: true,
  first_wrote: null,
  weeks: [],
  months: [],
  classifications: [
    {
      id: ID(3),
      state: "active",
      subject_kind: "domain",
      sender_written: { path: `external/${hostile}` },
    },
  ],
  addresses: [],
  more_addresses: false,
  sender_written: {
    address: "a@x.example",
    domain: "x.example",
    root: "x.example",
    roots: ["x.example"],
    customer,
    never_quiet_roots: [],
    never_quiet_addresses: [],
  },
});

describe("what reaches the terminal (#1339)", () => {
  it("cleans what a sender wrote wherever it is printed, not only in rows", async () => {
    const s = await signedIn({
      [api("get_sender")]: [() => envelope(sender(hostile))],
    });
    assert.equal(await run(s.io, ["senders", ID(2)]), 0);
    assert.equal(s.out[0], "evil]0;owned.example");
    assert.ok(
      ![...s.out, ...s.err].some((l) => /[\u0000-\u001f\u202e]/.test(l)),
    );
  });

  it("cleans a classification's path and subject", async () => {
    const s = await signedIn({
      [api("get_classification")]: [
        () =>
          envelope({
            ...classification(1, hostile, "active"),
            parent: null,
            children: [],
            mailboxes: [],
            weeks: [],
            moved_out: [],
            moved_out_count: 0,
          }),
      ],
    });
    assert.equal(await run(s.io, ["classification", ID(1)]), 0);
    assert.ok(
      ![...s.out, ...s.err].some((l) => /[\u0000-\u001f\u202e]/.test(l)),
    );
  });

  it("dims on a terminal with the codes whole, and aligns columns by what shows", async () => {
    const s = await signedIn({
      [api("list_classifications")]: [
        () =>
          envelope({
            classifications: [
              classification(1, "a.example", "active"),
              classification(2, "longer.example", "proposed"),
            ],
          }),
      ],
    });
    s.io.tty = true;
    assert.equal(await run(s.io, ["classifications"]), 0);
    assert.equal(
      s.out[0],
      `external/a.example       active    volume  \u001b[2m${ID(1)}\u001b[22m`,
    );
    assert.equal(
      s.out[1],
      `external/longer.example  proposed  volume  \u001b[2m${ID(2)}\u001b[22m`,
    );
  });

  it("does not dim when NO_COLOR is set", async () => {
    const s = await signedIn({
      [api("list_classifications")]: [
        () =>
          envelope({
            classifications: [classification(1, "a.example", "active")],
          }),
      ],
    });
    s.io.tty = true;
    s.io.env.NO_COLOR = "1";
    await run(s.io, ["classifications"]);
    assert.ok(!s.out[0]!.includes("\u001b"));
  });
});

describe("options a command does not take (#1339)", () => {
  it("refuses them before anything is sent, rather than print an unfiltered answer", async () => {
    for (const argv of [
      ["quiet", "--since", "2026-09-01"],
      ["classifications", "--until", "2026-09-01"],
      ["week", "--limit", "5"],
      ["senders", "--state", "quieted"],
      ["senders", "stripe.com", "--since", "2026-09-01"],
      ["rules", ID(1), "--limit", "3"],
      ["accounts", "--read-only"],
    ]) {
      const s = await signedIn({});
      assert.equal(await run(s.io, argv), 1, argv.join(" "));
      assert.match(
        s.err[0] ?? "",
        /does not apply to|applies to brood login alone/,
        argv.join(" "),
      );
      assert.deepEqual(s.sent, [], argv.join(" "));
    }
  });
});

describe("a lookup by name (#1339)", () => {
  it("reads past ten pages, so a sender on a later one is found", async () => {
    const pages = Array.from(
      { length: 12 },
      (_, i) => () =>
        envelope(
          senders(
            i === 11
              ? [{ root: "late.example", messages: 1 }]
              : [{ root: `p${i}.example`, messages: 1 }],
          ),
          i === 11 ? {} : { next: `c${i}` },
        ),
    );
    const s = await signedIn({
      [api("list_senders")]: pages,
      [api("get_sender")]: [() => envelope(sender(null))],
    });
    assert.equal(await run(s.io, ["senders", "late.example"]), 0);
    assert.equal(
      s.sent.filter((x) => x.url === api("list_senders")).length,
      12,
    );
  });
});

describe("a limit reached (#1339)", () => {
  it("says the server's reason when the day's allowance is spent", async () => {
    const s = await signedIn({
      [api("list_classifications")]: [
        () =>
          envelope({
            classifications: [classification(1, "stripe.com", "active")],
          }),
      ],
      [api("unhush")]: [
        () =>
          problem(
            429,
            "rate_limited",
            "Today's rule changes are spent; they come back at midnight UTC.",
          ),
      ],
    });
    assert.equal(await run(s.io, ["unhush", "stripe.com"]), 1);
    assert.deepEqual(s.err, [
      "Too many calls. Today's rule changes are spent; they come back at midnight UTC.",
    ]);
  });

  it("says when to call again, and reads as a sentence with no wait given", async () => {
    const s = await signedIn({
      [api("list_accounts")]: [() => problem(429, "rate_limited")],
    });
    assert.equal(await run(s.io, ["accounts"]), 1);
    assert.deepEqual(s.err, ["Too many calls. Try again in a minute."]);
  });
});

describe("rows (#1339)", () => {
  it("pads a dimmed cell by what shows, not by its codes", async () => {
    const { rows, dim } = await import("./out.ts");
    const s = standIn({});
    const style = { json: false, color: true };
    rows(s.io, [
      [dim(style, "ab"), "x"],
      ["abcd", "y"],
    ]);
    assert.deepEqual(s.out, ["\u001b[2mab\u001b[22m    x", "abcd  y"]);
  });
});

describe("a sender under a shared root (#1339)", () => {
  const shared = () =>
    envelope(
      senders([
        { root: "gmail.com", address: "ann@gmail.com", messages: 9 },
        { root: "gmail.com", address: "bob@gmail.com", messages: 3 },
      ]),
    );

  it("is found by its address, its own row", async () => {
    const s = await signedIn({
      [api("list_senders")]: [shared],
      [api("get_sender")]: [() => envelope(sender(null))],
    });
    assert.equal(await run(s.io, ["senders", "bob@gmail.com"]), 0);
    assert.deepEqual(JSON.parse(s.sent[1]!.body), {
      sender: ID(2),
      scope: "address",
    });
  });

  it("is never stood in for by the shared root, which would show one person as all of it", async () => {
    const s = await signedIn({ [api("list_senders")]: [shared] });
    assert.equal(await run(s.io, ["senders", "gmail.com"]), 1);
    assert.ok(!s.sent.some((x) => x.url === api("get_sender")));
    assert.ok(s.err[0]!.includes("by its address"));
  });
});

describe("the stretch a lookup reads (#1339)", () => {
  it("is the one asked for, for --sender", async () => {
    const s = await signedIn({
      [api("list_senders")]: [
        () => envelope(senders([{ root: "acme.example", messages: 2 }])),
      ],
      [api("list_events")]: [
        () => envelope({ retained_from: "2026-06-20T00:00:00Z", events: [] }),
      ],
    });
    assert.equal(
      await run(s.io, [
        "events",
        "--sender",
        "acme.example",
        "--since",
        "2026-07-01",
        "--until",
        "2026-07-31",
      ]),
      0,
    );
    const lookup = JSON.parse(s.sent[0]!.body);
    assert.equal(lookup.since, "2026-07-01");
    assert.equal(lookup.until, "2026-07-31");
  });

  it("is the portrait's days, for one sender", async () => {
    const s = await signedIn({
      [api("list_senders")]: [
        () => envelope(senders([{ root: "acme.example", messages: 2 }])),
      ],
      [api("get_sender")]: [() => envelope(sender(null))],
    });
    await run(s.io, ["senders", "acme.example"]);
    // NOW is 2026-10-18; ninety days ending it begin on 2026-07-21.
    assert.equal(JSON.parse(s.sent[0]!.body).since, "2026-07-21");
  });
});

describe("the session commands' options (#1339)", () => {
  it("refuses --json and --owner, which they would ignore", async () => {
    for (const argv of [
      ["login", "--json"],
      ["logout", "--owner", "u_x"],
      ["version", "--json"],
    ]) {
      const s = standIn({});
      assert.equal(await run(s.io, argv), 1, argv.join(" "));
      assert.match(s.err[0] ?? "", /does not apply to brood/);
      assert.deepEqual(s.sent, []);
    }
  });
});

describe("the wren (#1339, the brand bible's terminal register)", () => {
  const isWren = (lines: string[]) =>
    lines.filter((l) => /@{4,}/.test(l)).length >= 5;

  it("heads help, in plain ASCII, drawn from the mark", async () => {
    const { wrenArt } = await import("./wren.ts");
    const art = wrenArt();
    assert.ok(isWren(art));
    assert.ok(art.every((l) => /^[\x20-\x7e]*$/.test(l)));
    assert.ok(art.every((l) => l.length <= 32));
    const s = standIn({});
    await run(s.io, ["help"]);
    assert.deepEqual(s.out.slice(0, art.length), art);
  });

  it("is on no answer, so it never stands between a question and the reply", async () => {
    const s = await signedIn({
      [api("list_senders")]: [
        () => envelope(senders([{ root: "stripe.com", messages: 41 }])),
      ],
    });
    await run(s.io, ["senders"]);
    assert.ok(!isWren([...s.out, ...s.err]));
  });
});

describe("what clean removes (#1339)", () => {
  it("removes each control, direction mark, separator and invisible spacer, and keeps the joiners", async () => {
    const { clean } = await import("./io.ts");
    const removed = {
      escape: 0x1b,
      "next line (C1)": 0x85,
      "arabic letter mark": 0x061c,
      "zero-width space": 0x200b,
      "left-to-right mark": 0x200e,
      "right-to-left mark": 0x200f,
      "line separator": 0x2028,
      "paragraph separator": 0x2029,
      "right-to-left override": 0x202e,
      "word joiner": 0x2060,
      "right-to-left isolate": 0x2067,
      "byte order mark": 0xfeff,
    };
    for (const [name, code] of Object.entries(removed))
      assert.equal(clean(`a${String.fromCodePoint(code)}b`), "ab", name);
    for (const [name, code] of Object.entries({
      "zero-width non-joiner": 0x200c,
      "zero-width joiner": 0x200d,
    }))
      assert.equal(clean(`a${String.fromCodePoint(code)}b`).length, 3, name);
  });
});

describe("an address under a shared root, read (#1339)", () => {
  it("is read by its address for events too, never widened to the root", async () => {
    const s = await signedIn({
      [api("list_senders")]: [
        () =>
          envelope(
            senders([
              { root: "gmail.com", address: "bob@gmail.com", messages: 3 },
            ]),
          ),
      ],
      [api("list_events")]: [
        () => envelope({ retained_from: "2026-09-19T00:00:00Z", events: [] }),
      ],
    });
    assert.equal(await run(s.io, ["events", "--sender", "bob@gmail.com"]), 0);
    const asked = JSON.parse(s.sent[1]!.body);
    assert.equal(asked.sender, ID(1));
    assert.equal(asked.scope, "address");
  });
});

describe("an option given empty (#1339)", () => {
  it("is refused, never taken as not given", async () => {
    for (const argv of [
      ["events", "--sender="],
      ["accounts", "--owner="],
    ]) {
      const s = await signedIn({});
      assert.equal(await run(s.io, argv), 1, argv.join(" "));
      assert.match(s.err[0] ?? "", /needs a value/);
      assert.deepEqual(s.sent, []);
    }
  });
});

describe("the session commands' arguments (#1339)", () => {
  it("are refused, since they take none", async () => {
    for (const argv of [
      ["logout", "now"],
      ["login", "extra"],
      ["version", "extra"],
    ]) {
      const s = await signedIn({});
      assert.equal(await run(s.io, argv), 1, argv.join(" "));
      assert.match(s.err[0] ?? "", /takes no arguments/);
      assert.deepEqual(s.sent, []);
    }
  });
});

describe("the wren's colour (#1339)", () => {
  const BARN_TRUE = "\u001b[38;2;";

  it("is Barn on a terminal that shows true colour, read from the dark scheme", async () => {
    const rgb = [1, 3, 5]
      .map((i) => parseInt(DARK_BARN.slice(i, i + 2), 16))
      .join(";");
    const s = standIn({});
    s.io.tty = true;
    s.io.env.COLORTERM = "truecolor";
    await run(s.io, ["help"]);
    assert.ok(s.out[0]!.startsWith(`${BARN_TRUE}${rgb}m`));
    assert.ok(s.out[0]!.endsWith("\u001b[39m"));
    // The help's words stay the terminal's own colour.
    assert.ok(
      !s.out
        .find((l) => l.includes("never reads a message"))!
        .includes("\u001b"),
    );
  });

  it("is the nearest the 256-colour cube has, where that is all a terminal shows", async () => {
    const s = standIn({});
    s.io.tty = true;
    s.io.env.TERM = "xterm-256color";
    await run(s.io, ["help"]);
    assert.match(s.out[0]!, /^\u001b\[38;5;\d+m/);
  });

  it("is left out when NO_COLOR is set, with --no-color, or when not a terminal", async () => {
    const { wrenArt } = await import("./wren.ts");
    for (const [tty, env, argv] of [
      [true, { NO_COLOR: "1", COLORTERM: "truecolor" }, ["help"]],
      [true, { COLORTERM: "truecolor" }, ["help", "--no-color"]],
      [false, { COLORTERM: "truecolor" }, ["help"]],
    ] as const) {
      const s = standIn({});
      s.io.tty = tty;
      Object.assign(s.io.env, env);
      await run(s.io, [...argv]);
      assert.deepEqual(
        s.out.slice(0, wrenArt().length),
        wrenArt(),
        argv.join(" "),
      );
    }
  });
});

describe("Copilot's round (#1339)", () => {
  it("counts a lookup's start back from --until when no --since is given", async () => {
    const s = await signedIn({
      [api("list_senders")]: [
        () => envelope(senders([{ root: "acme.example", messages: 2 }])),
      ],
      [api("list_events")]: [
        () => envelope({ retained_from: "2026-07-02T00:00:00Z", events: [] }),
      ],
    });
    assert.equal(
      await run(s.io, [
        "events",
        "--sender",
        "acme.example",
        "--until",
        "2026-07-31",
      ]),
      0,
    );
    const lookup = JSON.parse(s.sent[0]!.body);
    assert.equal(lookup.until, "2026-07-31");
    assert.equal(lookup.since, "2026-07-02");
  });

  it("takes NO_COLOR set empty as set", async () => {
    const s = await signedIn({
      [api("list_classifications")]: [
        () =>
          envelope({
            classifications: [classification(1, "a.example", "active")],
          }),
      ],
    });
    s.io.tty = true;
    s.io.env.NO_COLOR = "";
    await run(s.io, ["classifications"]);
    assert.ok(!s.out[0]!.includes("\u001b"));
  });

  it("says a lookup found nothing in an index not read whole, rather than that there is none", async () => {
    const s = await signedIn({
      [api("list_senders")]: [() => envelope(senders([]), { complete: false })],
    });
    assert.equal(await run(s.io, ["senders", "acme.example"]), 1);
    assert.ok(s.err.some((l) => l.includes("not read every mailbox whole")));
  });

  it("shows what a rule leaves out when copied", async () => {
    const s = await signedIn({
      [api("get_rule")]: [
        () =>
          envelope({
            id: ID(7),
            classification_id: ID(1),
            mailbox: "me@example.test",
            installed_at: "2026-10-01T00:00:00Z",
            shown: "active",
            stranded: false,
            filed_existing: 3,
            sender_written: {
              path: "external/stripe",
              from: { kind: "domain", value: "stripe.com" },
              exclude: [],
              exclude_cc: ["boss@example.test"],
            },
          }),
      ],
    });
    await run(s.io, ["rules", ID(7)]);
    assert.ok(
      s.out.some(
        (l) => l.includes("when copied") && l.includes("boss@example.test"),
      ),
    );
  });

  it("refuses --no-color where nothing is coloured, and honours it at login", async () => {
    for (const argv of [
      ["logout", "--no-color"],
      ["version", "--no-color"],
    ]) {
      const s = await signedIn({});
      assert.equal(await run(s.io, argv), 1, argv.join(" "));
      assert.match(s.err[0] ?? "", /--no-color does not apply/);
    }
  });
});

describe("a malformed --until (#1339)", () => {
  it("is refused in a sentence, before anything is sent", async () => {
    const s = await signedIn({});
    assert.equal(
      await run(s.io, [
        "events",
        "--sender",
        "acme.example",
        "--until",
        "2026-7-31",
      ]),
      1,
    );
    assert.deepEqual(s.err, ["--until is a day, as YYYY-MM-DD."]);
    assert.deepEqual(s.sent, []);
  });
});

describe("a mailbox current and not read whole (#1369)", () => {
  it("is named, so the person knows which one an incomplete answer is missing", async () => {
    const short = { ...ACCOUNT, id: "acc-3", whole: false };
    const s = await signedIn({
      [api("list_senders")]: [
        () =>
          envelope(senders([]), {
            accounts: [ACCOUNT, short],
            complete: false,
          }),
      ],
    });
    await run(s.io, ["senders", "--since", "2025-01-01"]);
    assert.ok(
      s.err.includes(
        "Mailbox acc-3: current, but not read whole for this answer, last reached 2026-10-18.",
      ),
    );
    assert.ok(!s.err.some((l) => l.startsWith("Mailbox acc-1")));
  });
});
