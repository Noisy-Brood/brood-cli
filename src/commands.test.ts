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
              relationship: null,
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
            sender_written: { path: "external/stripe", subject: "stripe.com" },
          }),
      ],
    });
    assert.equal(await run(s.io, ["hush", "stripe.com"]), 0);
    assert.deepEqual(JSON.parse(s.sent[1]!.body), { classification: ID(2) });
    assert.deepEqual(s.out, [
      "Filed stripe.com out of your inbox, under external/stripe.",
    ]);
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

  it("files a sender Brood proposed nothing for by hand, found as brood senders finds one (#1355)", async () => {
    const s = await signedIn({
      [api("list_classifications")]: [() => envelope({ classifications: [] })],
      [api("list_senders")]: [
        () =>
          envelope(
            senders([
              { root: "linear.app", messages: 3 },
              { root: "stripe.com", messages: 9 },
            ]),
          ),
      ],
      [api("hush")]: [
        () =>
          envelope({
            id: ID(5),
            state: "active",
            already: false,
            rules: [{ id: ID(7), account: "acc-1" }],
            failed: [],
            sender_written: { path: "external/stripe", subject: "stripe.com" },
          }),
      ],
    });
    assert.equal(await run(s.io, ["hush", "stripe.com"]), 0);
    assert.deepEqual(JSON.parse(s.sent.at(-1)!.body), { sender: ID(2) });
    assert.deepEqual(s.out, [
      "Filed stripe.com out of your inbox, under external/stripe.",
    ]);
  });

  it("refuses an id that names no classification, filing nothing", async () => {
    const s = await signedIn({
      [api("get_classification")]: [() => problem(404, "not_found")],
    });
    assert.equal(await run(s.io, ["hush", ID(9)]), 1);
    assert.ok(!s.sent.some((x) => x.url === api("hush")));
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
            sender_written: { path: "external/stripe", subject: "stripe.com" },
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

const sender = (relationship: string | null) => ({
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
    relationship,
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

const keepAnswer = (
  checked: boolean,
  outcomes: [string, string][],
  inForce: boolean | null = checked ? null : true,
) =>
  envelope({
    checked,
    in_force: inForce,
    lines: outcomes.map(([text, outcome], i) => ({
      line: i + 1,
      text,
      outcome,
    })),
  });

describe("keep (#659)", () => {
  it("lists the never-quiet list, and what Brood keeps for everyone", async () => {
    const s = await signedIn({
      [api("list_kept")]: [
        () =>
          envelope({
            kept: [
              {
                kind: "domain",
                value: "bank.com",
                added_at: "2026-10-01T00:00:00Z",
                last_wrote: "2026-10-16T10:00:00Z",
                sender: null,
              },
            ],
            seeds: [
              {
                kind: "address",
                value: "no-reply@accounts.google.com",
                why: "Account security.",
              },
            ],
          }),
      ],
    });
    assert.equal(await run(s.io, ["keep"]), 0);
    assert.deepEqual(s.out, [
      "bank.com  domain  last wrote 2026-10-16",
      "",
      "Kept for everyone:",
      "no-reply@accounts.google.com  Account security.",
    ]);
  });

  it("carries the listing on with --cursor, and says where the next page starts", async () => {
    const s = await signedIn({
      [api("list_kept")]: [
        () => envelope({ kept: [], seeds: [] }, { next: "c2" }),
      ],
    });
    assert.equal(
      await run(s.io, ["keep", "--limit", "5", "--cursor", "c1"]),
      0,
    );
    assert.deepEqual(JSON.parse(s.sent[0]!.body), { limit: 5, cursor: "c1" });
    assert.ok(s.err.some((l) => l.includes("--cursor c2")));
  });

  it("refuses a file it cannot read in a sentence, sending nothing", async () => {
    const s = await signedIn({});
    s.io.read = async () => {
      throw Object.assign(new Error("ENOENT: no such file"), {
        code: "ENOENT",
      });
    };
    assert.equal(await run(s.io, ["keep", "add", "missing.txt", "--yes"]), 1);
    assert.deepEqual(s.err, ["brood could not read missing.txt (ENOENT)."]);
    assert.equal(s.sent.length, 0);
  });

  it("checks a file's list, asks, and adds it on a yes", async () => {
    const s = await signedIn({
      [api("keep")]: [
        () =>
          keepAnswer(true, [
            ["alice@acme.com", "added"],
            ["bank.com", "already_listed"],
          ]),
        () =>
          keepAnswer(false, [
            ["alice@acme.com", "added"],
            ["bank.com", "already_listed"],
          ]),
      ],
    });
    const asked: string[] = [];
    s.io.read = async (path) => {
      assert.equal(path, "kept.txt");
      return "alice@acme.com\nbank.com\n";
    };
    s.io.ask = async (q) => (asked.push(q), "y");
    assert.equal(await run(s.io, ["keep", "add", "kept.txt"]), 0);
    assert.deepEqual(
      s.sent.map((x) => JSON.parse(x.body)),
      [
        { lines: "alice@acme.com\nbank.com\n", check: true },
        { lines: "alice@acme.com\nbank.com\n" },
      ],
    );
    assert.deepEqual(asked, ["Keep one? [y/N] "]);
    assert.deepEqual(s.out, [
      "line 1  alice@acme.com  to add",
      "line 2  bank.com        already kept",
      "Kept one. Brood never files their mail.",
    ]);
  });

  it("adds nothing when the answer is not yes", async () => {
    const s = await signedIn({
      [api("keep")]: [() => keepAnswer(true, [["alice@acme.com", "added"]])],
    });
    s.io.read = async () => "alice@acme.com";
    s.io.ask = async () => "";
    assert.equal(await run(s.io, ["keep", "add", "kept.txt"]), 0);
    assert.equal(s.sent.length, 1);
    assert.equal(s.out.at(-1), "Nothing added.");
  });

  it("asks nothing when the check finds nothing new", async () => {
    const s = await signedIn({
      [api("keep")]: [() => keepAnswer(true, [["bank.com", "already_listed"]])],
    });
    s.io.read = async () => "bank.com";
    s.io.ask = async () => assert.fail("asked with nothing to add");
    assert.equal(await run(s.io, ["keep", "add", "kept.txt"]), 0);
    assert.equal(s.out.at(-1), "Nothing new to keep.");
  });

  it("stops at the check with --check, asking nothing", async () => {
    const s = await signedIn({
      [api("keep")]: [() => keepAnswer(true, [["nodot", "unrenderable"]])],
    });
    s.io.input = async () => "nodot";
    assert.equal(await run(s.io, ["keep", "add", "--check"]), 0);
    assert.deepEqual(JSON.parse(s.sent[0]!.body), {
      lines: "nodot",
      check: true,
    });
    assert.deepEqual(s.out, [
      "line 1  nodot  refused: a filter cannot hold it exactly",
    ]);
  });

  it("refuses a list from standard input without --yes, sending nothing, since nobody can be asked there", async () => {
    const s = await signedIn({});
    s.io.input = async () => "alice@acme.com";
    s.io.ask = async () => assert.fail("asked while reading standard input");
    assert.equal(await run(s.io, ["keep", "add"]), 1);
    assert.equal(s.sent.length, 0);
    assert.match(s.err.join("\n"), /cannot ask while it reads the list/);
  });

  it("adds a list from standard input with --yes, saying each line", async () => {
    const s = await signedIn({
      [api("keep")]: [
        () =>
          keepAnswer(false, [
            ["alice@acme.com", "added"],
            ["@bank.com", "added"],
          ]),
      ],
    });
    s.io.input = async () => "alice@acme.com\n@bank.com";
    assert.equal(await run(s.io, ["keep", "add", "--yes"]), 0);
    assert.deepEqual(JSON.parse(s.sent[0]!.body), {
      lines: "alice@acme.com\n@bank.com",
    });
    assert.deepEqual(s.out, [
      "line 1  alice@acme.com  added",
      "line 2  @bank.com       added",
      "Kept 2. Brood never files their mail.",
    ]);
  });

  it("refuses a file's list when nobody is at a terminal to ask, sending nothing", async () => {
    const s = await signedIn({});
    s.io.read = async () => "alice@acme.com";
    assert.equal(await run(s.io, ["keep", "add", "kept.txt"]), 1);
    assert.equal(s.sent.length, 0);
    assert.match(s.err.join("\n"), /Nobody is at a terminal to ask/);
  });

  it("says nothing was added when a filter could not change", async () => {
    const s = await signedIn({
      [api("keep")]: [
        () => keepAnswer(false, [["alice@acme.com", "not_in_force"]], false),
      ],
    });
    s.io.input = async () => "alice@acme.com";
    assert.equal(await run(s.io, ["keep", "add", "--yes"]), 0);
    assert.match(s.out.at(-1)!, /^Nothing was added: one of Brood's filters/);
  });

  it("refuses what it cannot mean: a verb it lacks, both of --check and --yes, either on the listing, and an empty list", async () => {
    for (const argv of [
      ["keep", "remove"],
      ["keep", "add", "--check", "--yes"],
      ["keep", "--yes"],
      ["keep", "add", "a.txt", "b.txt"],
      ["keep", "add", "a.txt", "--yes", "--limit", "5"],
    ]) {
      const s = await signedIn({});
      s.io.read = async () => "alice@acme.com";
      assert.equal(await run(s.io, argv), 1, argv.join(" "));
      assert.equal(s.sent.length, 0, argv.join(" "));
    }
    const s = await signedIn({});
    s.io.input = async () => "\n  \n";
    assert.equal(await run(s.io, ["keep", "add", "--yes"]), 1);
    assert.match(s.err.join("\n"), /holds no addresses or domains/);
  });
});

const relationshipsAnswer = (
  checked: boolean,
  outcomes: [string, string][],
  later: boolean | null = checked ? null : false,
) =>
  envelope({
    checked,
    later,
    lines: outcomes.map(([text, outcome], i) => ({
      line: i + 1,
      text,
      outcome,
    })),
  });

describe("relationships add (#659)", () => {
  it("checks a file's relationships, asks, and adds them on a yes", async () => {
    const s = await signedIn({
      [api("add_relationships")]: [
        () =>
          relationshipsAnswer(true, [
            ["Acme: acme.com", "added"],
            ["gmail.com", "shared"],
          ]),
        () =>
          relationshipsAnswer(false, [
            ["Acme: acme.com", "added"],
            ["gmail.com", "shared"],
          ]),
      ],
    });
    const asked: string[] = [];
    s.io.read = async () => "Acme: acme.com\ngmail.com";
    s.io.ask = async (q) => (asked.push(q), "yes");
    assert.equal(
      await run(s.io, [
        "relationships",
        "add",
        "--group",
        "Investors",
        "list.txt",
      ]),
      0,
    );
    assert.deepEqual(
      s.sent.map((x) => JSON.parse(x.body)),
      [
        { lines: "Acme: acme.com\ngmail.com", check: true, group: "Investors" },
        { lines: "Acme: acme.com\ngmail.com", group: "Investors" },
      ],
    );
    assert.deepEqual(asked, ["Add one relationship to Investors? [y/N] "]);
    assert.deepEqual(s.out, [
      "line 1  Acme: acme.com  to add",
      "line 2  gmail.com       refused: a mail provider's domain or your own",
      "Added one relationship. Brood proposes a home for their mail now, among your proposals.",
    ]);
  });

  it("says the proposals come shortly when Brood has yet to run over them", async () => {
    const s = await signedIn({
      [api("add_relationships")]: [
        () =>
          relationshipsAnswer(
            false,
            [
              ["a.com", "added"],
              ["b.com", "added"],
            ],
            true,
          ),
      ],
    });
    s.io.input = async () => "a.com\nb.com";
    assert.equal(
      await run(s.io, [
        "relationships",
        "add",
        "--group",
        "Investors",
        "--yes",
      ]),
      0,
    );
    assert.equal(
      s.out.at(-1),
      "Added 2 relationships. Brood proposes a home for their mail shortly.",
    );
  });

  it("says a line again when Brood failed on it after the yes", async () => {
    const s = await signedIn({
      [api("add_relationships")]: [
        () => relationshipsAnswer(true, [["a.com", "added"]]),
        () => relationshipsAnswer(false, [["a.com", "failed"]]),
      ],
    });
    s.io.read = async () => "a.com";
    s.io.ask = async () => "y";
    assert.equal(
      await run(s.io, [
        "relationships",
        "add",
        "--group",
        "Investors",
        "c.txt",
      ]),
      0,
    );
    assert.deepEqual(s.out.slice(-2), [
      "line 1  a.com  not added: Brood failed on it, so try it again",
      "No new relationships were added.",
    ]);
  });

  it("asks nothing when no line is new", async () => {
    const s = await signedIn({
      [api("add_relationships")]: [
        () => relationshipsAnswer(true, [["acme.com", "already"]]),
      ],
    });
    s.io.read = async () => "acme.com";
    s.io.ask = async () => assert.fail("asked with nothing to add");
    assert.equal(
      await run(s.io, [
        "relationships",
        "add",
        "--group",
        "Investors",
        "c.txt",
      ]),
      0,
    );
    assert.equal(s.out.at(-1), "No new relationships to add.");
  });

  it("refuses a bare customers-style verb, a missing group, and a list from standard input without --yes, sending nothing", async () => {
    for (const argv of [
      ["relationships", "rename", "x"],
      ["relationships", "add", "--group", "Investors"],
      ["relationships", "add", "--yes"],
      ["keep", "add", "--group", "Investors", "--yes"],
    ]) {
      const s = await signedIn({});
      s.io.input = async () => "acme.com";
      assert.equal(await run(s.io, argv), 1, argv.join(" "));
      assert.equal(s.sent.length, 0, argv.join(" "));
    }
  });
});

const proposal = (n: number, subject: string, plain: boolean) => ({
  id: ID(n),
  state: "proposed",
  reason: "volume",
  subject_kind: "domain",
  proposed_at: "2026-10-16T00:00:00Z",
  decided_at: null,
  decided_by: null,
  sender_written: { path: `external/${subject}`, subject },
  plain,
});
const proposalsAnswer = () =>
  envelope({
    proposals: [proposal(1, "list.com", true), proposal(2, "other.com", false)],
  });
const filedAnswer = (filed: number) =>
  envelope({ filed, partly: 0, refused: 0, left: 0 });

describe("proposals (#1729)", () => {
  it("lists them, marking those ready", async () => {
    const s = await signedIn({ [api("list_proposals")]: [proposalsAnswer] });
    assert.equal(await run(s.io, ["proposals"]), 0);
    assert.ok(s.out[0]!.includes("list.com"));
    assert.ok(s.out[0]!.includes("ready"));
    assert.ok(!s.out[1]!.includes(" ready"));
  });

  it("files those marked ready with --all, asking first, and asks the bar again", async () => {
    const s = await signedIn({
      [api("list_proposals")]: [proposalsAnswer],
      [api("file_proposals")]: [() => filedAnswer(1)],
    });
    const asked: string[] = [];
    s.io.ask = async (q) => (asked.push(q), "y");
    assert.equal(await run(s.io, ["proposals", "file", "--all"]), 0);
    assert.deepEqual(asked, ["File this one out of your inbox? [y/N] "]);
    const sent = s.sent.map((x) => JSON.parse(x.body));
    assert.deepEqual(sent.at(-1), { classifications: [ID(1)], plain: true });
    assert.equal(s.out.at(-1), "Filed 1.");
  });

  it("files one named even though it is not marked, as the person's own choice", async () => {
    const s = await signedIn({
      [api("list_proposals")]: [proposalsAnswer],
      [api("file_proposals")]: [() => filedAnswer(1)],
    });
    assert.equal(await run(s.io, ["proposals", "file", ID(2), "--yes"]), 0);
    assert.deepEqual(JSON.parse(s.sent.at(-1)!.body), {
      classifications: [ID(2)],
    });
  });

  it("files nothing on a no, with --check, or with nobody to ask", async () => {
    for (const [argv, ask] of [
      [["proposals", "file", "--all"], async () => "n"],
      [["proposals", "file", "--all", "--check"], async () => "y"],
      [["proposals", "file", "--all"], null],
    ] as const) {
      const s = await signedIn({ [api("list_proposals")]: [proposalsAnswer] });
      s.io.ask = ask;
      await run(s.io, [...argv]);
      assert.ok(
        !s.sent.some((x) => x.url.endsWith("file_proposals")),
        argv.join(" "),
      );
    }
  });

  it("refuses --all with names, a name not proposed, and a verb it does not have", async () => {
    for (const argv of [
      ["proposals", "file", "--all", ID(1)],
      ["proposals", "file"],
      ["proposals", "file", ID(9), "--yes"],
      ["proposals", "remove"],
      ["proposals", "decline", "not-an-id"],
      ["proposals", "decline", ID(1), "--check"],
      ["proposals", "again", ID(1), "--yes"],
    ]) {
      const s = await signedIn({ [api("list_proposals")]: [proposalsAnswer] });
      assert.equal(await run(s.io, argv), 1, argv.join(" "));
      assert.ok(
        !s.sent.some((x) => x.url.endsWith("file_proposals")),
        argv.join(" "),
      );
    }
  });

  it("prints only the answer with --json, the listing for --check and the result for --yes", async () => {
    const s = await signedIn({
      [api("list_proposals")]: [proposalsAnswer, proposalsAnswer],
      [api("file_proposals")]: [() => filedAnswer(1)],
    });
    await run(s.io, ["--json", "proposals", "file", "--all", "--check"]);
    assert.ok(JSON.parse(s.out.join("\n")).data.proposals);
    s.out.length = 0;
    await run(s.io, ["--json", "proposals", "file", "--all", "--yes"]);
    assert.equal(JSON.parse(s.out.join("\n")).data.filed, 1);
  });

  it("declines one, and puts one back", async () => {
    const s = await signedIn({
      [api("decline_proposal")]: [
        () => envelope({ id: ID(1), outcome: "declined" }),
      ],
      [api("propose_again")]: [
        () => envelope({ id: ID(1), outcome: "returning" }),
      ],
    });
    assert.equal(await run(s.io, ["proposals", "decline", ID(1)]), 0);
    assert.equal(s.out.at(-1), "Declined. Brood will not propose it again.");
    assert.equal(await run(s.io, ["proposals", "again", ID(1)]), 0);
    assert.equal(s.out.at(-1), "Not yet: its mail is still coming back.");
  });
});

const askable = () =>
  envelope({
    senders: [
      { id: ID(1), recent: 4, sender_written: { address: "news@a.com" } },
      { id: ID(2), recent: 2, sender_written: { address: "news@b.com" } },
    ],
    more: false,
  });

describe("unsubscribe (#1729)", () => {
  it("lists who can be asked, asking nobody", async () => {
    const s = await signedIn({ [api("list_unsubscribable")]: [askable] });
    assert.equal(await run(s.io, ["unsubscribe"]), 0);
    assert.equal(s.sent.length >= 1, true);
    assert.ok(s.out[0]!.includes("news@a.com"));
    assert.ok(!s.sent.some((x) => x.url.endsWith("/unsubscribe")));
  });

  it("asks one now, after a yes, by its address", async () => {
    const s = await signedIn({
      [api("list_unsubscribable")]: [askable],
      [api("unsubscribe")]: [() => envelope({ id: ID(2), outcome: "asked" })],
    });
    const asked: string[] = [];
    s.io.ask = async (q) => (asked.push(q), "yes");
    assert.equal(await run(s.io, ["unsubscribe", "news@b.com"]), 0);
    assert.deepEqual(asked, [
      "Ask news@b.com to stop? This cannot be taken back. [y/N] ",
    ]);
    assert.deepEqual(JSON.parse(s.sent.at(-1)!.body), { sender: ID(2) });
    assert.equal(s.out.at(-1), "Asked. The sender accepted.");
  });

  it("chooses everyone listed with --all, to be asked in turn", async () => {
    const s = await signedIn({
      [api("list_unsubscribable")]: [askable],
      [api("choose_unsubscribes")]: [() => envelope({ chosen: 2 })],
    });
    assert.equal(await run(s.io, ["unsubscribe", "--all", "--yes"]), 0);
    assert.deepEqual(JSON.parse(s.sent.at(-1)!.body), {
      senders: [ID(1), ID(2)],
    });
  });

  it("says when there are more than it lists, and prints only the answer with --json", async () => {
    const many = () =>
      envelope({
        senders: [
          { id: ID(1), recent: 4, sender_written: { address: "news@a.com" } },
        ],
        more: true,
      });
    const s = await signedIn({
      [api("list_unsubscribable")]: [many, many],
      [api("unsubscribe")]: [() => envelope({ id: ID(1), outcome: "asked" })],
    });
    await run(s.io, ["unsubscribe"]);
    assert.equal(s.out.at(-1), "These are the busiest, and there are more.");
    s.out.length = 0;
    await run(s.io, ["--json", "unsubscribe", "news@a.com", "--yes"]);
    assert.equal(JSON.parse(s.out.join("\n")).data.outcome, "asked");
  });

  it("sends nothing for someone it cannot ask, on a no, or with --check", async () => {
    for (const [argv, ask] of [
      [["unsubscribe", "stranger@c.com", "--yes"], async () => "y"],
      [["unsubscribe", "news@a.com"], async () => "n"],
      [["unsubscribe", "news@a.com", "--check"], async () => "y"],
    ] as const) {
      const s = await signedIn({ [api("list_unsubscribable")]: [askable] });
      s.io.ask = ask;
      await run(s.io, [...argv]);
      assert.ok(
        !s.sent.some(
          (x) =>
            x.url.endsWith("/unsubscribe") ||
            x.url.endsWith("choose_unsubscribes"),
        ),
        argv.join(" "),
      );
    }
  });
});

const relationshipsNow = () =>
  envelope({
    relationships: [
      {
        id: ID(1),
        group: ID(9),
        added_at: "2026-10-01T00:00:00Z",
        sender_written: {
          name: "Acme",
          domains: ["acme.com"],
          addresses: [],
        },
      },
    ],
    suggestions: [
      {
        id: ID(2),
        added_at: "2026-10-02T00:00:00Z",
        sender_written: {
          name: "Globex",
          domains: ["globex.com"],
          addresses: [],
        },
      },
    ],
    groups: [{ id: ID(9), name: "Investors", comes_back: true }],
  });
const done = () => envelope({ outcome: "done" });

describe("relationships (#1729)", () => {
  it("lists them with their groups, and who Brood suggests", async () => {
    const s = await signedIn({
      [api("list_relationships")]: [relationshipsNow],
    });
    assert.equal(await run(s.io, ["relationships"]), 0);
    assert.ok(s.out[0]!.includes("Acme") && s.out[0]!.includes("Investors"));
    assert.equal(s.out[1], "Brood suggests:");
    assert.ok(s.out[2]!.includes("Globex"));
  });

  it("accepts a suggestion by its domain into a group", async () => {
    const s = await signedIn({
      [api("list_relationships")]: [relationshipsNow],
      [api("accept_suggestion")]: [
        () => envelope({ id: ID(2), outcome: "done", later: false }),
      ],
    });
    assert.equal(
      await run(s.io, [
        "relationships",
        "accept",
        "globex.com",
        "--group",
        "Partners",
      ]),
      0,
    );
    assert.deepEqual(JSON.parse(s.sent.at(-1)!.body), {
      relationship: ID(2),
      group: "Partners",
    });
  });

  it("removes one after a yes, saying what stops, and not on a no or with --check", async () => {
    const yes = await signedIn({
      [api("list_relationships")]: [relationshipsNow],
      [api("remove_relationship")]: [done],
    });
    const asked: string[] = [];
    yes.io.ask = async (q) => (asked.push(q), "y");
    assert.equal(await run(yes.io, ["relationships", "remove", "Acme"]), 0);
    assert.deepEqual(asked, ["Remove Acme? [y/N] "]);
    assert.ok(yes.out.some((l) => l.includes("stays filed")));
    assert.deepEqual(JSON.parse(yes.sent.at(-1)!.body), {
      relationship: ID(1),
    });
    for (const [argv, ask] of [
      [["relationships", "remove", "Acme"], async () => "n"],
      [["relationships", "remove", "Acme", "--check"], async () => "y"],
      [["relationships", "remove", "Acme"], null],
    ] as const) {
      const s = await signedIn({
        [api("list_relationships")]: [relationshipsNow],
      });
      s.io.ask = ask;
      await run(s.io, [...argv]);
      assert.ok(
        !s.sent.some((x) => x.url.endsWith("remove_relationship")),
        argv.join(" "),
      );
    }
  });

  it("prints only the answer with --json --check", async () => {
    const s = await signedIn({
      [api("list_relationships")]: [relationshipsNow],
    });
    await run(s.io, ["--json", "relationships", "remove", "Acme", "--check"]);
    assert.ok(JSON.parse(s.out.join("\n")).data.relationships);
  });

  it("refuses a move with no group, someone not listed, and a suggestion to remove", async () => {
    for (const argv of [
      ["relationships", "move", "Acme"],
      ["relationships", "move", "Nobody", "--group", "Investors"],
      ["relationships", "remove", "Globex", "--yes"],
      ["relationships", "dismiss", "Acme"],
    ]) {
      const s = await signedIn({
        [api("list_relationships")]: [relationshipsNow],
      });
      assert.equal(await run(s.io, argv), 1, argv.join(" "));
      assert.equal(
        s.sent.filter((x) => !x.url.endsWith("list_relationships")).length,
        0,
        argv.join(" "),
      );
    }
  });
});

describe("groups (#1729)", () => {
  it("lists them, and adds one", async () => {
    const s = await signedIn({
      [api("list_relationships")]: [relationshipsNow],
      [api("add_group")]: [() => envelope({ outcome: "taken" })],
    });
    assert.equal(await run(s.io, ["groups"]), 0);
    assert.ok(s.out[0]!.includes("comes back"));
    assert.equal(await run(s.io, ["groups", "add", "Investors"]), 0);
    assert.equal(s.out.at(-1), "Another of your groups has that name.");
  });

  it("finds a group by its name in any case, for each change", async () => {
    const cases: [string[], string, Record<string, unknown>][] = [
      [
        ["groups", "rename", "investors", "Backers"],
        "rename_group",
        { group: ID(9), name: "Backers" },
      ],
      [
        ["groups", "comes-back", "investors", "off"],
        "set_group_comes_back",
        { group: ID(9), comes_back: false },
      ],
      [["groups", "remove", "investors"], "remove_group", { group: ID(9) }],
    ];
    for (const [argv, operation, body] of cases) {
      const s = await signedIn({
        [api("list_relationships")]: [relationshipsNow],
        [api(operation)]: [done],
      });
      assert.equal(await run(s.io, argv), 0, argv.join(" "));
      assert.deepEqual(JSON.parse(s.sent.at(-1)!.body), body);
    }
  });

  it("refuses a group it cannot find and a setting that is neither on nor off", async () => {
    for (const argv of [
      ["groups", "remove", "Nobody"],
      ["groups", "comes-back", "Investors", "maybe"],
      ["groups", "archive", "Investors"],
    ]) {
      const s = await signedIn({
        [api("list_relationships")]: [relationshipsNow],
      });
      assert.equal(await run(s.io, argv), 1, argv.join(" "));
    }
  });
});

describe("proposals file, more than one request takes", () => {
  it("refuses before asking", async () => {
    const s = await signedIn({});
    const ids = Array.from({ length: 51 }, (_, i) => ID(i + 1));
    assert.equal(await run(s.io, ["proposals", "file", ...ids]), 1);
    assert.equal(s.sent.length, 0);
  });
});

describe("hush by hand, under a root filed address by address (#1355)", () => {
  it("says what was filed when it is an address rather than the root named", async () => {
    const s = await signedIn({
      [api("list_classifications")]: [() => envelope({ classifications: [] })],
      [api("list_senders")]: [
        () => envelope(senders([{ root: "vendor.com", messages: 9 }])),
      ],
      [api("hush")]: [
        () =>
          envelope({
            id: ID(5),
            state: "active",
            already: false,
            rules: [{ id: ID(7), account: "acc-1" }],
            failed: [],
            sender_written: {
              path: "external/news@vendor.com",
              subject: "news@vendor.com",
            },
          }),
      ],
    });
    assert.equal(await run(s.io, ["hush", "vendor.com"]), 0);
    assert.deepEqual(s.out, [
      "Filed news@vendor.com out of your inbox, under external/news@vendor.com.",
      "Brood files vendor.com address by address, since you write to someone there or it is shared, so only news@vendor.com is filed.",
    ]);
  });

  it("says why when Brood would never file the sender, rather than calling the name invalid", async () => {
    const s = await signedIn({
      [api("list_classifications")]: [() => envelope({ classifications: [] })],
      [api("list_senders")]: [
        () => envelope(senders([{ root: "vendor.com", messages: 9 }])),
      ],
      [api("hush")]: [() => problem(400, "invalid_argument", "sender")],
    });
    assert.equal(await run(s.io, ["hush", "vendor.com"]), 1);
    assert.match(s.err.join("\n"), /^Brood does not file vendor\.com by hand/);
  });
});

describe("quieted homes and batching (#1729)", () => {
  it("brings back the quieted one a name means, not the active one beside it", async () => {
    const s = await signedIn({
      [api("list_classifications")]: [
        () =>
          envelope({
            classifications: [
              classification(
                1,
                "vendor.test",
                "active",
                "external/vendor.test/a",
              ),
              classification(2, "vendor.test", "quieted"),
            ],
          }),
      ],
      [api("restore_quieted")]: [
        () => envelope({ id: ID(2), outcome: "restored_later" }),
      ],
    });
    assert.equal(await run(s.io, ["quieted", "restore", "vendor.test"]), 0);
    assert.deepEqual(JSON.parse(s.sent.at(-1)!.body), {
      classification: ID(2),
    });
    assert.match(s.out.at(-1)!, /at the next rules pass/);
  });

  it("leaves one quiet, and refuses one nothing quieted covers", async () => {
    const s = await signedIn({
      [api("list_classifications")]: [
        () =>
          envelope({
            classifications: [classification(2, "vendor.test", "quieted")],
          }),
        () =>
          envelope({
            classifications: [classification(1, "acme.test", "active")],
          }),
      ],
      [api("leave_quiet")]: [
        () => envelope({ id: ID(2), outcome: "answered" }),
      ],
    });
    assert.equal(await run(s.io, ["quieted", "leave", "vendor.test"]), 0);
    assert.equal(s.out.at(-1), "Left quiet.");
    assert.equal(await run(s.io, ["quieted", "leave", "acme.test"]), 1);
    assert.ok(!s.sent.some((x, i) => i > 1 && x.url === api("leave_quiet")));
  });

  it("batches a filed home, and refuses a setting it does not have before calling", async () => {
    const s = await signedIn({
      [api("list_classifications")]: [
        () =>
          envelope({
            classifications: [classification(1, "vendor.test", "active")],
          }),
      ],
      [api("set_batched")]: [
        () => envelope({ id: ID(1), outcome: "no_hours" }),
      ],
    });
    assert.equal(await run(s.io, ["batch", "vendor.test", "on"]), 0);
    assert.deepEqual(JSON.parse(s.sent.at(-1)!.body), {
      classification: ID(1),
      batched: true,
    });
    assert.match(s.out.at(-1)!, /arrival hours/);
    const sent = s.sent.length;
    assert.equal(await run(s.io, ["batch", "vendor.test", "yes"]), 1);
    assert.equal(s.sent.length, sent);
  });
});

describe("your own filters (#1729)", () => {
  const listed = () =>
    envelope({
      mailboxes: [
        {
          account: ID(7),
          mailbox: "me@work.test",
          rules: {
            shown: [
              {
                id: "F1",
                sender: { kind: "domain", value: "news\u001b[2J.test" },
                under: ["Reading"],
                does: ["out_of_inbox"],
                cannot_adopt: null,
              },
              {
                id: "F2",
                sender: { kind: "address", value: "boss@work.test" },
                under: ["Boss"],
                does: ["starred"],
                cannot_adopt: "keeps_in_inbox",
              },
            ],
            unreadable: 1,
            left_behind: [{ by: "SaneBox", homes: ["@SaneLater"] }],
          },
        },
        { account: ID(8), mailbox: "me@home.test", rules: null },
      ],
    });

  it("lists each mailbox's filters, cleaned, with what each does and why one cannot be taken over", async () => {
    const s = await signedIn({ [api("list_own_rules")]: [listed] });
    assert.equal(await run(s.io, ["own-rules"]), 0);
    assert.deepEqual(s.out, [
      "me@work.test",
      "  news[2J.test    Reading  out of the inbox  can be taken over            F1",
      "  boss@work.test  Boss     starred           it leaves mail in the inbox  F2",
      "  One more names no one sender.",
      "  SaneBox left @SaneLater.",
      "me@home.test",
      "  Brood could not read its filters just now.",
    ]);
  });

  it("asks before taking one over, sends nothing on a no, and finds the mailbox by its address", async () => {
    const accounts = () =>
      envelope({
        accounts: [{ id: ID(7), address: "me@work.test", connected: true }],
      });
    const s = await signedIn({
      [api("list_accounts")]: [accounts, accounts],
      [api("adopt_rule")]: [() => envelope({ outcome: "keeps_in_inbox" })],
    });
    s.io.ask = async () => "n";
    assert.equal(
      await run(s.io, ["own-rules", "adopt", "me@work.test", "F2"]),
      0,
    );
    assert.ok(!s.sent.some((x) => x.url === api("adopt_rule")));
    assert.equal(
      await run(s.io, ["own-rules", "adopt", "ME@work.test", "F2", "--yes"]),
      0,
    );
    assert.deepEqual(JSON.parse(s.sent.at(-1)!.body), {
      account: ID(7),
      rule: "F2",
    });
    assert.equal(
      s.out.at(-1),
      "Brood cannot take it over: it leaves mail in the inbox.",
    );
  });
});

describe("keep-out (#1729)", () => {
  const portrait = (address: string, filed: boolean) =>
    envelope({
      ...sender(null),
      addresses: [
        {
          id: ID(5),
          messages: 3,
          last: null,
          never_quiet: false,
          kept_out: false,
          filing: [
            {
              mailbox: "me@work.test",
              classification: filed
                ? {
                    id: ID(3),
                    state: "active",
                    sender_written: { path: "external/vendor.test" },
                  }
                : null,
            },
          ],
          sender_written: { address, domain: "mail.vendor.test", names: [] },
        },
      ],
    });

  it("finds an address under its root, asks, and keeps it out", async () => {
    const s = await signedIn({
      [api("list_senders")]: [
        () => envelope(senders([{ root: "vendor.test", messages: 9 }])),
      ],
      [api("get_sender")]: [() => portrait("alerts@mail.vendor.test", true)],
      [api("keep_out")]: [
        () => envelope({ id: ID(5), outcome: "kept_out", returning: [ID(7)] }),
      ],
    });
    const asked: string[] = [];
    s.io.ask = async (q) => (asked.push(q), "y");
    assert.equal(await run(s.io, ["keep-out", "alerts@mail.vendor.test"]), 0);
    assert.match(asked[0]!, /out of external\/vendor\.test/);
    assert.deepEqual(JSON.parse(s.sent.at(-1)!.body), { sender: ID(5) });
    assert.match(s.out.at(-1)!, /^Kept out\./);
  });

  it("refuses one nothing files, and a domain, asking nothing", async () => {
    const s = await signedIn({
      [api("list_senders")]: [
        () => envelope(senders([{ root: "vendor.test", messages: 9 }])),
      ],
      [api("get_sender")]: [() => portrait("alerts@vendor.test", false)],
    });
    s.io.ask = async () => assert.fail("asked");
    assert.equal(await run(s.io, ["keep-out", "alerts@vendor.test"]), 1);
    assert.equal(await run(s.io, ["keep-out", "vendor.test"]), 1);
    assert.ok(!s.sent.some((x) => x.url === api("keep_out")));
  });
});

describe("rules file (#1729)", () => {
  it("files what is already there for one rule, by its id", async () => {
    const s = await signedIn({
      [api("file_existing")]: [
        () => envelope({ id: ID(4), outcome: "continues", filed: 12 }),
      ],
    });
    assert.equal(await run(s.io, ["rules", "file", ID(4)]), 0);
    assert.deepEqual(JSON.parse(s.sent.at(-1)!.body), { rule: ID(4) });
    assert.match(s.out.at(-1)!, /12 messages filed so far\.$/);
    assert.equal(await run(s.io, ["rules", "file", "nope"]), 1);
  });
});

describe("the rule book (#1729)", () => {
  const NUMBERS = {
    "file.min_events": 10,
    "file.window_days": 30,
    "file.subdomain_split": 3,
    "quiet.silence_days": 60,
    "quiet.correction_streak": 3,
    "surface.reply_window_days": 7,
    "surface.relationship_silence_days": 30,
    "relationship.window_months": 3,
    "relationship.min_active_months": 2,
    "relationship.min_inbound": 4,
    "relationship.inbound_per_reply": 3,
  };
  const none = { homes: [], quieted: [], declined: [], relationships: [] };
  const checked = () =>
    envelope({
      checked: true,
      outcome: null,
      in_force: NUMBERS,
      sender_written: {
        more: none,
        fewer: { ...none, quieted: ["external/old\u001b.test"] },
      },
    });

  it("shows a change, asks, and saves it against the numbers it was checked with", async () => {
    const s = await signedIn({
      [api("set_rule_book")]: [
        checked,
        () =>
          envelope({
            checked: false,
            outcome: "saved",
            in_force: null,
            sender_written: null,
          }),
      ],
    });
    s.io.ask = async () => "y";
    assert.equal(
      await run(s.io, ["rule-book", "set", "quiet.silence_days=90"]),
      0,
    );
    assert.deepEqual(JSON.parse(s.sent[0]!.body), {
      numbers: { "quiet.silence_days": 90 },
      check: true,
    });
    assert.deepEqual(JSON.parse(s.sent[1]!.body), {
      numbers: { "quiet.silence_days": 90 },
      in_force: NUMBERS,
    });
    assert.deepEqual(s.out, [
      "Brood would no longer quiet external/old.test.",
      "Saved. Brood decides by them from its next run.",
    ]);
  });

  it("stops after the check with --check, and refuses a name or value it lacks before calling", async () => {
    const s = await signedIn({ [api("set_rule_book")]: [checked] });
    assert.equal(
      await run(s.io, ["rule-book", "set", "quiet.silence_days=90", "--check"]),
      0,
    );
    assert.equal(s.sent.length, 1);
    for (const argv of [
      ["rule-book", "set"],
      ["rule-book", "set", "quiet.nothing=5"],
      ["rule-book", "set", "quiet.silence_days=ninety"],
      ["rule-book", "set", "quiet.silence_days=90=1"],
      ["rule-book", "set", "quiet.silence_days=90", "--check", "--yes"],
    ])
      assert.equal(await run(s.io, argv), 1, argv.join(" "));
    assert.equal(s.sent.length, 1);
  });

  it("lists the numbers with a default beside one changed, and resets with --yes", async () => {
    const s = await signedIn({
      [api("get_rule_book")]: [
        () =>
          envelope({
            numbers: { ...NUMBERS, "quiet.silence_days": 90 },
            defaults: NUMBERS,
            ignored: [],
            can_change: true,
          }),
      ],
      [api("reset_rule_book")]: [() => envelope({ outcome: "saved" })],
    });
    s.io.env.NO_COLOR = "1";
    assert.equal(await run(s.io, ["rule-book"]), 0);
    assert.ok(
      s.out.some((l) => /^quiet\.silence_days\s+90\s+default 60$/.test(l)),
    );
    assert.equal(await run(s.io, ["rule-book", "reset", "--yes"]), 0);
    assert.equal(s.sent.at(-1)!.url, api("reset_rule_book"));
  });
});

describe("preferences (#1729)", () => {
  it("shows the account's settings, and sets each", async () => {
    const s = await signedIn({
      [api("get_preferences")]: [
        () =>
          envelope({
            letter: "month",
            first_proposals: { wanted: true, sent: false },
            arrival_hours: { hours: [8, 17], utc_offset_minutes: -300 },
          }),
      ],
      [api("set_letter")]: [() => envelope({ letter: "week" })],
      [api("set_first_proposals")]: [() => envelope({ outcome: "sent" })],
      [api("set_arrival_hours")]: [
        () => envelope({ hours: [7], utc_offset_minutes: 60 }),
      ],
    });
    assert.equal(await run(s.io, ["preferences"]), 0);
    assert.deepEqual(s.out, [
      "Letter           a letter each month",
      "First proposals  an email when they are ready",
      "Arrival hours    08:00 and 17:00",
    ]);
    assert.equal(await run(s.io, ["preferences", "letter", "week"]), 0);
    assert.deepEqual(JSON.parse(s.sent.at(-1)!.body), { letter: "week" });
    assert.equal(await run(s.io, ["preferences", "first-proposals", "off"]), 0);
    assert.deepEqual(JSON.parse(s.sent.at(-1)!.body), { wanted: false });
    assert.equal(
      s.out.at(-1),
      "The email has gone already, so nothing changed.",
    );
    // Five hours behind UTC, as the machine says it: minutes east is -300.
    const offset = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = () => 300;
    try {
      assert.equal(await run(s.io, ["preferences", "hours", "7"]), 0);
    } finally {
      Date.prototype.getTimezoneOffset = offset;
    }
    assert.deepEqual(JSON.parse(s.sent.at(-1)!.body), {
      hours: [7],
      utc_offset_minutes: -300,
    });
  });

  it("refuses another's account, a choice it lacks and an hour that is none, before calling", async () => {
    const s = await signedIn({});
    for (const argv of [
      ["preferences", "--owner", "user_2"],
      ["preferences", "letter", "daily"],
      ["preferences", "first-proposals", "yes"],
      ["preferences", "hours"],
      ["preferences", "hours", "8", "12", "17"],
      ["preferences", "hours", "8am"],
      ["preferences", "timezone"],
    ])
      assert.equal(await run(s.io, argv), 1, argv.join(" "));
    assert.equal(s.sent.length, 0);
  });
});
