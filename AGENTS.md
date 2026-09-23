# Agent instructions

## Commit attribution

- When an AI model materially assists with a commit, append an `Assisted-by:`
  trailer naming the model and version reported by the runtime, for example
  `Assisted-by: GPT-5` or `Assisted-by: Claude Opus 5`.
- Do not name the agent harness or product, such as Codex or Claude Code.
- Do not use `Co-authored-by:` for AI assistance; keep the human author and
  committer unchanged.
- Preserve any required `Signed-off-by:` trailer alongside the attribution.

## Developer Certificate of Origin

- Every commit you create or amend must include a DCO `Signed-off-by:` trailer
  matching the commit author's real name and email. Use `git commit -s` or
  `git commit --amend -s`.
- Before committing, verify that `git config user.name` and `git config
  user.email` identify the intended human author. Never invent an identity or
  sign off on another person's behalf.
- Preserve existing sign-offs during rebases, amendments, and cherry-picks.
- Before pushing, verify every outgoing commit contains the required matching
  trailer.

## Commit messages

- Every commit you create must follow
  [Conventional Commits](https://www.conventionalcommits.org/):
  `<type>[optional scope][!]: <description>`.
- Use semantic types such as `feat`, `fix`, `docs`, `refactor`, `test`, `build`,
  `ci`, `chore`, `perf`, or `revert`.
- Mark breaking changes with `!` before `:` or a `BREAKING CHANGE:` footer.

## Scope discipline

- Keep each change focused. Do not bundle unrelated cleanup, refactoring, or
  redesign with the requested work.
- Preserve existing behavior outside the requested scope.
- Reuse existing project patterns before adding new abstractions or dependencies.
- Edit source files rather than generated output. If generated artifacts are
  tracked, regenerate them with the repository's documented workflow.

## Verification

- Run the repository-documented formatting, linting, type checks, tests, and
  builds relevant to the change.
- Review the final diff and report any checks that were skipped or blocked.
- For UI changes, review affected views at narrow and wide widths and preserve
  keyboard access, visible focus, readable contrast, navigation, and assets.

## Pull requests and releases

- Unless the user explicitly asks otherwise, work on a focused, short-lived
  branch and open or update a pull request. Use the repository's pull request
  template when one exists.
- Do not merge, release, publish, or deploy without explicit user authorization.
