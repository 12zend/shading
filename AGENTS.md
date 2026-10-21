# Movie Agent Instructions

Guidelines for coding agents working on this repository.

> [!IMPORTANT]
> **Record every new feature in `./engine-versions.json`.**
> Whenever you add a feature, add a new entry with its **version**, **version name** and **commit hash**, and update `current`. A feature is not finished until this entry is committed. See [Engine Version Records](#engine-version-records-required) below.

## Engine Version Records (REQUIRED)

`./engine-versions.json` is the version history of the engine. Keep it in sync with the features you add.

### When to add an entry
- Every time a new feature is added (a `feat` commit), add a new version entry.
- Use [Semantic Versioning](https://semver.org/) based on the latest entry:
  - New feature → bump **minor** (`1.0.0` → `1.1.0`).
  - Change that breaks saved projects or existing behaviour → bump **major** (`1.1.0` → `2.0.0`), and only with explicit user approval.
- If one task adds several closely related features, a single entry for that task is acceptable; list them in the final report.

### Entry format
Append the new entry to the **end** of the `versions` array (oldest first) and set `current` to the new version:

```json
{
  "current": "1.1.0",
  "versions": [
    {
      "version": "1.0.0",
      "name": "Shading 1.0.0",
      "commit": "222616e9b099060f4821502516b5fe26bf36c9a3",
      "date": "2026-10-21"
    },
    {
      "version": "1.1.0",
      "name": "Shading 1.1.0",
      "commit": "<full 40-character hash of the feature commit>",
      "date": "YYYY-MM-DD"
    }
  ]
}
```

- `version`: `MAJOR.MINOR.PATCH`, higher than every existing entry.
- `name`: `Shading <version>` (e.g. `Shading 1.1.0`).
- `commit`: the **full 40-character** hash of the commit that introduced the feature (not a short hash).
- `date`: that commit's date in `YYYY-MM-DD` format.
- `current`: must equal the `version` of the last entry.

### How to record it
A commit cannot contain its own hash, so record the version in a separate follow-up commit:
1. Commit the feature (e.g. `feat(movie): add ...`).
2. Get its hash and date: `git rev-parse HEAD` and `git log -1 --format=%cs HEAD`.
3. Add the entry to `./engine-versions.json` and update `current`.
4. Check that the file is valid JSON (e.g. `node -e "JSON.parse(require('fs').readFileSync('engine-versions.json','utf8'))"`).
5. Commit only that file: `chore(version): record Shading X.Y.Z`.

### Rules
- Never edit, reorder or delete existing entries.
- Never record a hash that does not exist in the repository, and never guess a hash.
- Include the new version, name and commit hash in the final report.

## Block Execution Must Not Add Delay

- New or modified Movie command blocks must return immediately and must not return a `Promise` to the Scratch VM.
- Start required asynchronous work with `MovieAssetManager.runWithoutWaiting` so the script stays in the current VM tick.
- Do not add waits, timers, artificial yields, or promise-wait behavior to blocks unless the user explicitly requests blocking semantics.
- Rendering and material blocks must be safe to run inside loops without exposing intermediate frames or causing visible flicker.
- In particular, sequences such as `erase all` → `render wall` (or another Movie render block) → `stamp` must finish without a VM yield between those blocks.
- Creation blocks used declaratively in a render loop, such as `add material`, must be idempotent and must not reset an existing resource every iteration.
- Cache decoded asynchronous assets separately from scene/material state so clearing and reapplying them in the same tick does not flash a fallback value.
- Add a regression test that asserts each new asynchronous command primitive returns `undefined`.
- `event_renderframe` is a custom hat without a command primitive. Compiled render-frame scripts may execute their full body synchronously from `runtime.startHats('event_renderframe')`; do not assume that starting the hat creates a VM yield.
- Do not implement automatic `erase all` by calling `pen_clear` from the timeline `BEFORE_EXECUTE` or `AFTER_EXECUTE` hooks. That clears the pen layer outside the render-frame transaction, so a slow Movie render can expose a blank intermediate frame or add apparent delay. A frame reset must be part of the same atomic render transaction and must be tested in both compiled and interpreter execution paths.
- Do not use a global `renderer.draw` suppression guard as a workaround for render-frame timing. Preserve the existing renderer scheduling and fix the block boundary that exposes the intermediate state.

Existing blocks with deliberately documented atomic behavior are compatibility exceptions. Do not introduce new exceptions without explicit user approval.

## Plugins

- Effects and other specialised features are plugins in the separate `shading-plugins` repository (one zippable folder per plugin), loaded through `src/lib/plugins/`. Do not add effect-specific code, shaders or assets back into the core; extend the plugin API instead. See `docs/PLUGINS.md`.
- The block rules above apply to plugin blocks. Plugin tests load the official plugins from `../shading-plugins` (or `SHADING_PLUGINS_DIR`).
- Keep the legacy Looks opcodes and `penfx_menu_shader_penfx_builtins_*` menu names stable; saved projects reference them.

## Core workflow
1. Before editing, read the relevant documentation and inspect the repository, current branch, `git status`, and recent commits.
2. Break the requested work into small, independently verifiable milestones. Prefer milestones that leave the repository in a working state.
3. Implement one milestone at a time. Keep changes focused and avoid unrelated refactoring.
4. At each milestone, run the relevant checks (format, lint, typecheck, tests, build, or a targeted manual check). Fix failures caused by the changes before committing.
5. Review `git diff` and `git status`. Stage **only files related to that milestone**, then create a commit with a descriptive message.
6. If the milestone added a feature, record it in `./engine-versions.json` as described in [Engine Version Records](#engine-version-records-required).
7. Continue to the next milestone and repeat. At the end, report the changes, checks performed, commit hashes, and any remaining issues.

## When to commit
Commit at a natural boundary, such as:
- Completing a coherent feature or subfeature.
- Finishing a bug fix with regression coverage.
- Adding or updating a discrete module, API, or UI component.
- Completing a migration or configuration change that can be verified independently.
- Finishing a documentation update associated with a completed change.

**Do not** commit after every file edit or arbitrary number of lines. **Do not** postpone all commits until the end of a multi-stage task. For long tasks, seek several meaningful checkpoints.

## Commit quality rules
- Each commit should represent one understandable logical change.
- Prefer a clean, testable state at every commit; do not knowingly commit broken code unless the task explicitly requires an intermediate nonworking state and that state is clearly identified.
- Use concise commit messages in the format `type(scope): summary` where useful. Typical types: `feat`, `fix`, `refactor`, `test`, `docs`, `build`, `chore`.
- Keep commits easy to review and revert independently.
- Never include secrets, credentials, local environment files, build artifacts, or unrelated changes.
- Do not amend, squash, rebase, reset, or overwrite existing commits unless explicitly instructed.
- Never push to a remote or create a release unless explicitly requested.

## Handling existing changes
- Treat pre-existing uncommitted changes as user-owned. Do not discard, rewrite, or accidentally commit them.
- If the working tree is dirty, isolate and stage only the agent's own modifications (use selective staging when needed).
- Avoid destructive Git commands such as `git reset --hard`, `git clean -fd`, and force-push.
- If safe separation of changes is impossible, explain the blocker instead of creating a mixed commit.

## Verification and exceptions
- Run the most relevant available verification before each commit; do not claim checks passed unless they actually ran successfully.
- If a check cannot run due to missing tooling or external dependencies, document the limitation and run whatever local checks are feasible.
- If a milestone cannot be safely committed, leave its changes uncommitted, explain why, and continue only when doing so is safe.
- Follow any repository-specific instructions and user requirements that are more specific than this file.

## Final report
Provide a concise summary including:
- Completed milestones and corresponding commit hashes/messages.
- New engine version entries added to `./engine-versions.json` (version, name, commit).
- Tests/builds/checks executed and their results.
- Uncommitted changes (if any), blockers, and recommended next steps.
