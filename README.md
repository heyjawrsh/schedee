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

### Connecting a Google account in development

Without this the app runs on built-in demo calendars. To sync a real Google account you need your own Google OAuth clients and the auth Worker running locally.

1. In [Google Cloud console](https://console.cloud.google.com/projectcreate), create a project and [enable the Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com).
2. Under [Audience](https://console.cloud.google.com/auth/audience), choose External, keep it in Testing and add yourself as a test user. Under [Data Access](https://console.cloud.google.com/auth/scopes), add `calendar.events`, `calendar.calendarlist.readonly`, `openid` and `email`.
3. Under [Clients](https://console.cloud.google.com/auth/clients), create a **Web application** client with JavaScript origin `http://localhost:5173` and redirect URI `http://localhost:8787/oauth/google/callback`. Copy the secret when it's shown; Google won't show it again.
4. Create `worker/.env.local` (gitignored) with `GOOGLE_WEB_CLIENT_ID=...` and `GOOGLE_WEB_CLIENT_SECRET=...`. The variables are described in `worker/.env.schema`, which [Varlock](https://varlock.dev) validates; you can also point them at a secret manager, e.g. 1Password with `op(op://vault/item/field)`.
5. Run the Worker and the app side by side:

```sh
pnpm --filter @schedee/worker dev   # auth Worker on http://localhost:8787
pnpm dev                            # web app on http://localhost:5173
```

Then press ⌘K in the app and choose **Add Google Calendar account**. While the Google project is in Testing, Google asks you to sign in again every 7 days.

Edits to synced events go back to Google. Each one is queued on the device with the edit itself and sent in order, so changes made offline go out when the connection returns. If Google refuses one, it's dropped and that calendar reloads from Google.

If an account's sign-in expires or is revoked, a warning shows next to it in the sidebar with **Sign in again** (also in ⌘K). Its calendars stay on screen and queued edits wait until you're back. Refused edits show as a short note under the account.

To remove an account, press ⌘K and choose **Remove account**. It clears that account's calendars, events, unsent edits and sign-in from this device (and the keychain on desktop). Nothing changes in Google.

#### Desktop

The desktop app signs in through your default browser and keeps the refresh token in the system keychain. It talks to Google directly, so it doesn't need the Worker.

1. Under [Clients](https://console.cloud.google.com/auth/clients), create a **Desktop app** client in the same project. It needs no redirect URI.
2. Create `apps/desktop/.env.local` (gitignored) with `GOOGLE_DESKTOP_CLIENT_ID=...` and `GOOGLE_DESKTOP_CLIENT_SECRET=...`, described in `apps/desktop/.env.schema`. They're compiled into the app; Google treats a desktop client's secret as public, but keep it out of the repo.
3. Run `pnpm desktop`, then press ⌘K and choose **Add Google Calendar account**.

Unsigned dev builds may ask for keychain access after each rebuild; choose **Always Allow**.

## License

[AGPL-3.0](LICENSE). If you run a modified Schedee as a service, you share your changes.

Schedee is an independent project and is not affiliated with or endorsed by Notion Labs.
