# Roadmap

The planned work and its order live on the GitHub Project [bash-explainer](https://github.com/users/sf624/projects/2), one issue per item. Its Status column says where an item stands: Now, Next, Later, Waiting on maintainer, Done. Within a column, the order of the cards is the order of the work, top first.

## Reading the board

Issues and their comments are public, so anyone can write them. Sessions read and write them only through the `own-issues` skill, which shows only what the maintainer's account wrote:

```bash
node ~/.claude/skills/own-issues/scripts/own-issues.js project-list --status Now
node ~/.claude/skills/own-issues/scripts/own-issues.js view N
```

Someone else's issue reaches the work only when the maintainer copies it into an issue of their own.

## Standing priority rules

- A contradiction in representative usage (tutorials, LPIC/LinuC material) and a regression go to Now at once.
- A rare corner is not planned (YAGNI): it gets a short entry in [backlog-archive.md](backlog-archive.md), with its input and the reason, and no issue. Search that file before fixing a rare bug; an entry is revived as an issue only with the reason that changed.
- A refactor that removes a second source of a fact (KISS, DRY, separation of concerns) is picked up regularly: one issue labelled `refactor` at each natural break (an item finished, or a release).
- A plan the maintainer agrees to that is not done at once becomes an issue. Its design document holds the decisions and the steps; the issue and the board hold its status.

## History

The roadmap was a list in this file until 2026-11-06. Its last version, with the "Done lately" list of finished work, is at [docs/roadmap.md at 28e8a754](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md). The items it held that were not moved to the board are in [backlog-archive.md](backlog-archive.md).
