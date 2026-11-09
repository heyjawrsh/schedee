# Schedee

An open source calendar for people who live in Notion Calendar and want a version nobody can sunset.

Schedee keeps the layouts, views and keyboard shortcuts you already know, and adds what Notion Calendar leaves out:

- Google, Outlook/Microsoft 365, iCloud and any CalDAV account in one grid
- ICS feed subscriptions, straight from the URL
- Web, macOS, Windows and Linux, with your calendar cached locally so it still opens offline
- Tasks you can drag onto the calendar to block out time

It runs in the browser at [sched.ee](https://sched.ee) and as a small desktop app built with Tauri. Your events stay between your device and your calendar provider. Schedee never stores them on a server.

## Status

Early. Nothing to install yet. Follow the [issues](https://github.com/heyjawrsh/schedee/issues) to see what's being built.

## Development

You need Node 26 and pnpm 12 (`mise install` sets both up from `mise.toml`), plus a Rust toolchain for the desktop app.

```sh
pnpm install
pnpm dev          # web app on http://localhost:5173
pnpm desktop      # Tauri desktop app
pnpm test         # unit tests
pnpm test:e2e     # Playwright in Chromium and WebKit
pnpm typecheck
pnpm lint
```

| Path            | What lives there                                             |
| --------------- | ------------------------------------------------------------ |
| `apps/web`      | The React app that runs at sched.ee                          |
| `apps/desktop`  | Tauri shell around the web build                             |
| `packages/core` | Event model, recurrence, time zones, sync, provider adapters |
| `packages/ui`   | Shared UI kit                                                |
| `worker`        | Stateless Cloudflare Worker for OAuth token exchange         |
| `docs/re`       | Measurements taken from the reference app                    |

## License

[AGPL-3.0](LICENSE). If you run a modified Schedee as a service, you share your changes.

Schedee is an independent project and is not affiliated with or endorsed by Notion Labs.
