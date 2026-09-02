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

**Contact:** use **GitHub Private Vulnerability Reporting** — open the repository's
**Security** tab → **Report a vulnerability**. Reports go privately to the maintainers; no
email is required. (Repo admins: this requires "Private vulnerability reporting" to be
enabled under Settings → Code security — see the note at the end of this file.)

Please do not report security vulnerabilities through public GitHub issues.

When reporting, please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce (proof-of-concept code or a minimal repro repo, if
  possible).
- The affected version(s) and, if known, the affected file/function.

## Response SLA

- **Acknowledgement:** within **72 hours** of the report.
- **Triage decision** (accepted / declined / needs more information): within **7 days**.

If we miss these windows, please follow up on the same report thread.

## Disclosure

Once a fix is available, we will publish a patched release and credit the
reporter (unless they prefer to remain anonymous) in the release notes /
`CHANGELOG.md` (or the README `## VERSION INFO` table, per repo convention).

---

*Maintainer note (remove before publishing if preferred): Private vulnerability reporting is
currently **disabled** on this repository (`isSecurityPolicyEnabled: false` as of 2026-09-02).
Enable it under Settings → Code security and analysis before this policy goes live, otherwise
the Security tab will not show the report form.*
