# Third-party notices — `.claude/skills`

These Claude Code skills are vendored (PROGRESS F11). They are development tooling for the assistant, not part of
the shipped app, and are kept here with their licences because this repository is public (DECISIONS #28).

| Skill folder | Source | Licence |
|---|---|---|
| `ui-ux-pro-max` | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | MIT — see [`LICENSE`](LICENSE) (© 2024 Next Level Builder) |
| `banner-design`, `brand`, `design`, `design-system`, `slides` | vendored together with `ui-ux-pro-max` (metadata author: claudekit) | MIT as declared in their `SKILL.md` (`license: MIT`) / the same upstream [`LICENSE`](LICENSE) |
| `ui-styling` | as above | its own [`ui-styling/LICENSE.txt`](ui-styling/LICENSE.txt) (Apache License 2.0) — its `SKILL.md` metadata says MIT; the bundled licence file is kept as shipped |

Project rule: these skills are secondary references — the project's own design documents and tokens always win
(CLAUDE.md §6, `docs/06_DESIGN_SYSTEM.md`).
