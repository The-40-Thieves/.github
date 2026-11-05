# Fixture docs

A small docs tree the template's own CI builds. It exercises what project docs do in practice:
no frontmatter, a `README.md` per directory, relative links to pages, to files that are not
pages, to files outside `docs/`, and an image next to a page.

- [The guide](guide/one.md) and [the guide index](guide/)
- [A schema that is not a page](data/sample.json)
- [The repository README](../README.md), outside the docs tree
- [A heading on another page](guide/one.md#second-heading)

```md
# Inside a fence this is not a heading
```
