# Working on Schedee

Schedee is a public, AGPL-3.0 look-alike of Notion Calendar 1.142.0. These rules keep the repo clean and legal.

## Public repo rules

- Never commit Notion code, images, icons or long UI copy. Record measurements and behaviour in `docs/re/` in our own words, with our own token names.
- Raw evidence from the reference app (screenshots, DOM dumps, captured text) goes in `.re/`, which is gitignored. It contains the maintainer's real calendar, so none of it may leak into commits, issues, docs, test fixtures or PR text. Fixtures use invented events and people.
- Commits are authored by the maintainer with no AI attribution lines.

## Reference app

- Capturing the reference means launching Notion Calendar with `--remote-debugging-port`. That takes keyboard focus and changes the maintainer's running app, so only do it with their go-ahead at that moment, never during a call.
- Notion Calendar treats Quit as "relaunch in the background" (`--soft-quit-relaunch`). To relaunch with a flag, terminate the process first. Always close the debug port afterwards.
- Its theme lives in the synced `interfaceTheme` setting, and event colours follow it. Switch it through the command menu and restore the original value.

## Build order

Follow `PLAN.md` milestones (kept in the maintainer's notes; summary in issue #1). Lock the single-width (1440x900) week view against the reference before adding responsiveness, animation or providers, and freeze `packages/ui` before parallel work.

## Gates

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` and `pnpm build` must pass. Fidelity is judged against reference captures with an anti-aliasing tolerant diff, never against our own renders: `pnpm fidelity -- --theme light` (and `dark`), method and current numbers in `docs/re/fidelity.md`. Any UI change re-runs both themes and must not raise a region's mismatch.

`packages/ui` is the frozen kit: new screens consume it. Changing an existing kit component needs the fidelity run to stay flat.

Note: the RTK shell hook rewrites `pnpm lint` and `biome check` and can hide Biome's real output. Run `./node_modules/.bin/biome check .` directly when in doubt.

## Platform notes

- Use `Temporal` from `@schedee/core` (temporal-polyfill); WebKit has no stable Temporal.
- iCloud and generic CalDAV are desktop-only. The web build has no CalDAV proxy.
- The Worker is stateless: OAuth code exchange and refresh only, no logging of request bodies.
