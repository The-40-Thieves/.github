# Security policy

This policy applies to every repository in the The-40-Thieves organization unless a repository's own `SECURITY.md` says otherwise.

## Reporting a vulnerability

Do not open a public issue or pull request for a security problem.

Report it privately to the contact published at <https://the40thieves.dev/.well-known/security.txt>. That file is the source of truth for the contact address, the preferred languages and its own expiry date; this page points at it rather than duplicating it.

Include what you can: the affected repository and version, steps to reproduce, the impact you believe it has, and any proof of concept. Encrypted reports are welcome where the security.txt file lists a key.

## What to expect

- Acknowledgement within 5 business days.
- An initial assessment within 10 business days, with a severity estimate and a plan.
- A coordinated fix. We ask for a **90-day disclosure window** from the acknowledgement, extended by agreement if a fix needs longer. We will credit you in the release notes unless you prefer otherwise.

## Scope

In scope: the code in these repositories, the published packages built from them, and the sites under `the40thieves.dev`.

Out of scope: third-party services the projects talk to (report those to their owners), denial-of-service findings that require unreasonable traffic, and social-engineering of maintainers.

## No bounty

There is no bug bounty programme. Reports are handled on their merits and credited.

## Supported versions

Only the latest release of each project receives security fixes. Older tags are not patched.
