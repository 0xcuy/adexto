# Security policy

## Reporting a vulnerability

**Use [GitHub private vulnerability reporting](https://github.com/0xcuy/adexto/security/advisories/new).**
It is enabled on this repository, the thread is private between you and the maintainers, and it
gives you a place to attach the full report without it being public while it is still live.

Please do not open a public issue for a vulnerability. If private reporting is unavailable to
you for any reason, open an issue saying only that you have something to report and asking for
a channel — no details — and it will be answered.

## What to include

Whatever you already have. These are the things that most often decide how fast a report can be
confirmed, not a required form:

- the endpoint, contract address and chain, or file and line
- what an attacker gains, stated as the outcome rather than the class name
- reproduction steps, and a request or transaction that shows it
- whether it needs a key, a specific caller, or nothing at all

## Scope

In scope:

- the contracts in [`contracts/`](contracts/), on any of the four mainnets they are deployed to
- the application and its API routes under `src/app/api/`
- the x402 edge worker in [`cloudflare-worker/`](cloudflare-worker/)
- the MCP server at `/api/mcp`, including `pay_and_buy`
- anything that leads to loss of funds, loss of a market's reserves, or a market being
  redirected or misrepresented

Out of scope:

- third-party infrastructure we do not control. The ERC-8004 Identity Registry at
  `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` is an upgradeable proxy owned by someone else,
  the 0G Compute router is theirs, and public RPC endpoints are theirs. Report those to them
- reports produced only by a scanner, with no reproduction
- denial of service by volume against public RPC endpoints or our rate limits
- the absence of a third-party audit. There has not been one, and this is stated in the README
  rather than hidden

## What we will not do

We will not ask you to delete a report, and we will not dispute a finding by pointing at
documentation. If something is exploitable, the documentation is wrong.

There is no bug bounty programme. If that changes it will be written here rather than promised
in a thread.

## Response

You will get a reply, and if the finding is confirmed you will be told what was changed and
where the commit is. If a finding is declined you will be told the reason, with the chain state
or the code path it rests on, so you can argue with it.

Fixes are published as ordinary commits with the reasoning in the message, which is how the
rest of this repository records why something changed.

## What the contracts already guarantee

Useful context before testing, because it narrows where a high-severity finding can live. Every
fee rate is `immutable`, nothing on the launch path has an owner or a setter, and there is no
`withdraw`, `sweep`, `rescue` or `drain` function anywhere in the curve. Native leaves a curve
through exactly two paths: a seller's payout, and a fee claim to an address fixed at
construction. So a finding that lets anyone — including us — drain a market's reserves would
contradict the contracts, and that is exactly the kind of report worth sending.
