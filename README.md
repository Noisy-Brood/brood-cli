<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/banner-dark.png">
  <img alt="Noisy Brood: The command line" src=".github/banner-light.png">
</picture>

# The command line

[![npm](https://img.shields.io/npm/v/@noisybrood/cli)](https://www.npmjs.com/package/@noisybrood/cli)
[![The check, on the latest copy](https://github.com/Noisy-Brood/brood-cli/actions/workflows/check.yml/badge.svg)](https://github.com/Noisy-Brood/brood-cli/actions/workflows/check.yml)
[![Licence: Apache-2.0](https://img.shields.io/badge/licence-Apache--2.0-blue)](LICENSE)

`brood` answers questions about your mailbox from Noisy Brood's index: who
writes to you, how often, who has gone quiet, and what Brood has decided about
each. It never reads a message. The index holds no subject, no body and no
attachment, so there is nothing of what anyone wrote for it to show you.

It changes your mailbox in two ways only, `brood hush` and `brood unhush`, and
only once you have signed in with that permission.

## Install

It needs Node 24 or later.

```
npm install --global @noisybrood/cli@0.1.0
```

Name the version. Each one published is fixed once it is on npm, and carries
a provenance attestation, shown on its npm page, saying it was built here,
from this repository's source.

## Sign in

```
brood login
```

It shows a code and an address. Open the address in a browser where you are
signed in to Noisy Brood, and approve the code. Nothing is typed into the
terminal but the command. `brood login --read-only` asks for a session that
can only read.

The session is kept in `~/.config/brood/credentials.json` (or under
`XDG_CONFIG_HOME`), readable only by you, and `brood logout` ends it at Brood
before forgetting it. To shut it out at once, revoke it on your account page.

## Ask

```
brood senders                     who wrote, most first
brood senders stripe.com          one sender
brood quiet                       senders that have gone silent
brood week                        one finished week, beside the week before
brood classifications             what Brood has decided, and its state
brood help                        everything else
```

Every command that reads your index takes `--json`, which prints the answer
as the API gives it.
Before an answer, brood says any mailbox it could not read whole, so a quiet
answer is never taken for a quiet mailbox.

## This repository

This repository is where brood is built and published, copied one way from a
private one. brood is written and reviewed there, and copied here with the
parts of Noisy Brood's own packages it compiles in whenever it changes.
Nothing here is edited by hand, and it takes no pull requests. A tag starts
the publish workflow, which builds the package here and stages it on npm
with provenance, holding no npm token, and a maintainer approves each version
with a second factor before it is published.

Questions and ideas are welcome in
[Discussions](https://github.com/Noisy-Brood/brood-cli/discussions), and bugs as
issues. A security problem is never either: see [SECURITY.md](SECURITY.md).
