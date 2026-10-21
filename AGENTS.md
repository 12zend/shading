# Movie Agent Instructions

Guidelines for coding agents working on this repository.

> [!IMPORTANT]
> **Every new feature gets a new engine version in `./engine-versions.json`.**
> After committing a feature, record its **version**, **version name** and **commit** with `npm run release:engine` and commit the result. A feature is not finished until that release commit exists. See [Engine Version Records](#engine-version-records-required).

## Engine Version Records (REQUIRED)

`./engine-versions.json` lists every release of the editor (the "engine"). It is not only a changelog:

- `current` is the version this build writes into saved `.shade` files. It must equal `SHADING_PROJECT_VERSION` in `scratch-vm/src/lib/project-format.js` (checked by `test/unit/util/engine-versions.test.js`).
- Every other entry is an archived engine that `npm run build:engines` checks out from its `commit` and deploys under `engines/<version>/`, so `.shade` files open in the engine that saved them. That commit must be engine `<version>` (its own list has that `current`) and must contain `src/lib/engine-handoff.js`, or the deploy fails.

See `docs/ENGINE_VERSIONS.md` for engine switching.

### When to release a version
- Any task that adds a feature (a `feat` commit) ends with a new version. Bug fixes, refactors, tests and docs alone do not.
- Bump the **minor** version (`1.0.0` → `1.1.0`). A **major** bump (`2.0.0`) is only for changes older engines cannot read, and only with explicit user approval: older engines refuse files with a newer major version.
- Release once per task, after its last feature commit, even when the task adds several features; list them in the final report. Each version adds one archived engine build to every deploy.

### How to release
1. Commit the features as `feat(...)` commits with passing checks.
2. Preview with `npm run release:engine -- --dry-run`, then run `npm run release:engine`. Pass a version for an approved major bump (`npm run release:engine -- 2.0.0`) and `--name=<name>` for a name other than `Shading <version>`.
3. Run `npx jest test/unit/util/engine-versions`.
4. Commit only `engine-versions.json` and `scratch-vm/src/lib/project-format.js` as `chore(engine): release Shading X.Y.Z`.

The script makes these edits (follow the same rules if you ever edit by hand):

| Field | Value |
| --- | --- |
| Outgoing entry's `commit` | The last commit of that version: the parent of the oldest `feat` commit since the list last changed (`--base` to override). This is the only change ever made to an existing entry. |
| New entry `version` | `MAJOR.MINOR.PATCH`, higher than every listed version, appended to the end of `versions` (oldest first). |
| New entry `name` | `Shading <version>`, shown in the engine-switch dialog. |
| New entry `commit` | Full 40-character hash of the newest `feat` commit of the release (`--commit` to override). |
| New entry `date` | That commit's date, `YYYY-MM-DD`. |
| `current`, `SHADING_PROJECT_VERSION` | The new version. |

### Rules
- Never change the `version`, `name` or `date` of existing entries, or reorder or delete them.
- Never guess a hash or use a short hash. If the script refuses a commit, report why instead of forcing it.
- Include the new version, name and commit in the final report.

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
6. Continue to the next milestone and repeat.
7. If the task added features, release a new engine version after the last feature commit, as described in [Engine Version Records](#engine-version-records-required).
8. Report the changes, checks performed, commit hashes, and any remaining issues.

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
- The engine version released, if any (version, name, commit).
- Tests/builds/checks executed and their results.
- Uncommitted changes (if any), blockers, and recommended next steps.
