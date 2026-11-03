# Contributing to The 40 Thieves

These are the org-wide defaults. A repository's own `CONTRIBUTING.md` adds to them and wins where they differ.

## Before you start

- Open an issue first for anything larger than a typo or a one-line fix, so the shape is agreed before the work is done. The issue forms (bug, feature, question) are the same in every repository.
- Check the repository's `AGENTS.md` or `CLAUDE.md` when present. They describe the gates a change has to pass and are written for humans and coding agents alike.

## Licensing

Every repository in the organization is licensed under Apache-2.0. By contributing you agree that your contribution is licensed under the same terms.

A Contributor License Agreement (The 40 Thieves CLA) is forthcoming and will be enforced on pull requests by CLA Assistant once it is in place. Until then, the Apache-2.0 inbound-equals-outbound rule above is the whole agreement.

## Pull requests

- One change per pull request. Keep refactors separate from behaviour changes.
- Every pull request fills in the template: what changed, why, and how it was tested.
- Tests accompany behaviour changes. A bug fix comes with the test that would have caught it.
- Commits are signed where the repository's ruleset requires it (SSH or GPG signing both work).
- Continuous integration must be green. Maintainers do not merge around a failing check.

## Releases

Each repository that publishes releases has a `RELEASING.md` describing its tagging and changelog convention. The common rules: semver tags `vX.Y.Z`, one GitHub Release per tag, and the release body is the changelog excerpt for that version. The product pages on [the40thieves.dev](https://the40thieves.dev) read the latest GitHub Release, so a tag without a Release is invisible there.

## Reporting security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).

## Conduct

Everyone participating in this organization's projects agrees to the [Code of Conduct](CODE_OF_CONDUCT.md).
