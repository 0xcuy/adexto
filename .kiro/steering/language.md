# Language rule

Everything publicly visible must be in **English**. This repository is public, so the
public surface is not just the website.

| Surface | Language |
| --- | --- |
| Web UI: pages, buttons, tooltips, empty states | English |
| API error messages that reach a user | English |
| `README.md` and any committed Markdown | English |
| **Commit messages** | English |
| Branch names, PR titles, issue bodies | English |
| GitHub repo description and topics | English |
| `og.png` and social assets | English |
| Payloads written on-chain or to 0G DA | English |
| Code comments | Indonesian is fine |
| Chat replies to the repo owner | Indonesian |

Commit messages are included because `git log` is one of the first things a visitor opens,
and every commit gets its own permanent URL. Indonesian commit messages have already
reached the public (`7b05514`) and history cannot be cleaned up without a rewrite.

On-chain and DA payloads matter most: they are permanent and cannot be corrected later.

Before committing, verify the message is English. `node audit_claims.mjs` (needs the site
running at `BASE_URL`) checks rendered web copy for Indonesian text, but it does not read
commit messages, code comments, or GitHub metadata. Those have to be checked by hand.
