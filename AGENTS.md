# Movie Agent Instructions

Guidelines for coding agents working on this repository.

## Block Execution Must Not Add Delay

- New or modified Movie command blocks must return immediately and must not return a `Promise` to the Scratch VM.
- Start required asynchronous work with `MovieAssetManager.runWithoutWaiting` so the script stays in the current VM tick.
- Do not add waits, timers, artificial yields, or promise-wait behavior to blocks unless the user explicitly requests blocking semantics.
- Rendering and material blocks must be safe to run inside loops without exposing intermediate frames or causing visible flicker.
- In particular, sequences such as `erase all` → `render wall` (or another Movie render block) → `stamp` must finish without a VM yield between those blocks.
- Add a regression test that asserts each new asynchronous command primitive returns `undefined`.

Existing blocks with deliberately documented atomic behavior are compatibility exceptions. Do not introduce new exceptions without explicit user approval.
