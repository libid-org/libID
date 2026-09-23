# Agent instructions

## Commit attribution

- When an AI model materially assists with a commit, append an `Assisted-by:`
  trailer naming the model and version reported by the runtime, for example
  `Assisted-by: GPT-5` or `Assisted-by: Claude Opus 5`.
- Do not name the agent harness or product, such as Codex or Claude Code.
- Do not use `Co-authored-by:` for AI assistance; keep the human author and
  committer unchanged.
- Preserve any required `Signed-off-by:` trailer alongside the attribution.

## Commit messages

- Every commit you create must follow
  [Conventional Commits](https://www.conventionalcommits.org/):
  `<type>[optional scope][!]: <description>`.
- Use semantic types such as `feat`, `fix`, `docs`, `refactor`, `test`, `build`,
  `ci`, `chore`, `perf`, or `revert`.
- Mark breaking changes with `!` before `:` or a `BREAKING CHANGE:` footer.
