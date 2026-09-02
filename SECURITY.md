# Security Policy

## Supported versions

Only the latest published npm release of each LemonCloud module is supported
with security fixes. Versions below the ones listed here are not patched;
please upgrade before reporting an issue against an older version.

(Table below is current as of 2026-09-02; update on each release.)

| Package | Supported version |
|---|---|
| `lemon-core` | 4.3.0 |
| `lemon-model` | 1.2.4 |
| `lemon-devkit` | 0.2.0 |

## Reporting a vulnerability

**Contact:** {{SECURITY_CONTACT}}

> Draft note: no security contact has been designated yet. Steve needs to
> pick one of the options below (or supply an address/handle) before this
> file can be published. Do not fill in a placeholder email on your own.

Choose one reporting channel (pick one, don't offer both — a single channel
avoids reports getting lost):

- **Option A — GitHub Private Vulnerability Reporting.** Enable
  "Private vulnerability reporting" in each repo's Settings → Security (this
  also flips `isSecurityPolicyEnabled` to `true`, currently `false` on all
  three repos per `gh repo view`). Reporters use the repo's Security tab
  directly; no email address needs to be published. Requires GitHub org/repo
  admin action outside this template's scope.
- **Option B — a dedicated email alias**, e.g. `security@lemoncloud.io` or
  `{{SECURITY_CONTACT}}` (placeholder — replace with the real address once
  designated). Simpler to stand up but means an inbox someone has to monitor,
  and the address becomes public in the repo.

Please do not report security vulnerabilities through public GitHub issues.

When reporting, please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce (proof-of-concept code or a minimal repro repo, if
  possible).
- The affected version(s) and, if known, the affected file/function.

## Response SLA

Pick one (not adopted yet — this is a proposal for B1 re-review):

- **Option 1 — committed SLA:** acknowledgment within 72 hours, triage
  outcome (accepted / declined / needs more info) within 7 days.
- **Option 2 — best-effort:** no committed timeline; maintainers respond
  "as soon as reasonably possible." Simpler to honor for a small team, weaker
  signal to security researchers.

## Disclosure

Once a fix is available, we will publish a patched release and credit the
reporter (unless they prefer to remain anonymous) in the release notes /
`CHANGELOG.md` (or the README `## VERSION INFO` table, per repo convention).
