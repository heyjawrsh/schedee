# Week view fidelity

How Schedee's week view is checked against the reference (Notion Calendar 1.142.0), and where it stands.

## Method

`pnpm fidelity -- --theme light|dark` builds the web app, renders it in headless Chromium at 1440x900 with a native device scale factor of 2, and diffs the screenshot against a reference capture with pixelmatch (threshold 0.1, anti-aliased pixels excluded). It reports the share of mismatched pixels per region.

Inputs live in the gitignored `.re/` folder because they hold the maintainer's real calendar:

- `.re/reference/week-{theme}.srgb.png`: reference captures, converted from the capture's display profile to sRGB.
- `.re/fixtures/reference-week[-dark].json`: a `CalendarSnapshot` that reproduces the captured week (same events, times, calendars and "now").

Without them the script still renders the public demo, so the pipeline can be checked from a clean clone.

Rendering details that matter:

- **Native scale factor, not emulation.** With Playwright's emulated `deviceScaleFactor`, Chromium snaps half-pixel layout positions to whole CSS pixels and every column and hour line lands 0.5px off. Launching with `--force-device-scale-factor=2` and `viewport: null` lays out in device pixels, like the Retina machine the reference came from.
- **`--force-color-profile=srgb`**, so both sides share one color space.
- **Masks:** the account avatar photo, and the macOS overlay scrollbar the reference machine draws on the calendar list.

## Results (M2a, 2026-11-09)

Mismatched pixels per region, in percent:

| Region        | Light | Dark  |
| ------------- | ----- | ----- |
| Sidebar       | 0.479 | 0.940 |
| Toolbar       | 0.032 | 0.048 |
| Title         | 0.497 | 0.475 |
| Day header    | 0.251 | 0.242 |
| All-day       | 0.085 | 0.133 |
| Gutter        | 0.079 | 0.038 |
| Grid          | 0.167 | 0.335 |
| Context panel | 0.067 | 0.067 |
| **Total**     | 0.194 | 0.345 |

Every grid line, hour line, column edge and the all-day border land on the reference's exact device pixels. An alignment search (best shift within ±3px per element) finds no remaining offset for day labels, calendar rows, chips or the now indicator.

Day, N-day and month views share the week view's kit. They are checked structurally (geometry measured from the reference month and day captures) but not pixel-diffed, because no private fixture covers the six weeks the month capture shows.

### Event editor (M2b)

`pnpm fidelity -- --theme dark --snapshot <fixture> --reference <editor capture> --select <event id> --regions editor` diffs the editor panel's upper block (header, title, times, people, calendar) against a capture of the reference's read-only editor: **0.179%** mismatched pixels. The rest of that frame differs on purpose (the reference had scrolled its week), so only the panel region counts.

### Command menu and search (M2d)

`pnpm fidelity -- --theme dark --snapshot <fixture> --reference <menu capture> --press Meta+k --regions cmdkInput,cmdkFooter` opens the menu before the screenshot and diffs its input row (**0.851%**) and footer (**0.601%**). Most of what remains is icon shape (Lucide) and glyph anti-aliasing. The list is compared by eye only: the reference lists scheduling and Notion commands Schedee leaves out, so its rows sit at different heights. Label, row and keycap metrics match within a pixel.

Measured: the panel is 680 wide, 200px from the top and centred on the window, with a 1px inside border, 12px corners and a two-layer shadow (stronger in dark). Light uses 80% white over the scrim. Rows are 36px, weight 500, inset 8px, with 6px corners. Group labels are 12px, rows 14px, the input 17px. The scrim is black at 24% in dark and 12% in light.

Search results are compared by eye against a capture of the reference searching the maintainer's calendar (`--press / --type <query>` renders ours): day headings, the red Today heading, bar, title, time and duration land within a pixel. Results run oldest first and open scrolled to Today; past ones are drawn at half opacity. The search field is transparent at rest, gets a 1px inside ring on hover and the input fill when focused.

## Known differences

- **Icons.** Schedee uses Lucide icons, not the reference's. This is deliberate and accounts for most of the sidebar, toolbar and panel residue.
- **Scrollbar width.** The reference machine shows classic scrollbars, which narrows the calendar list and moves the hidden-calendar toggle about 13px left. Headless Chromium on macOS uses overlay scrollbars. The list scrolls and reserves a gutter (`scrollbar-gutter: stable`), so the reference look returns on machines with classic scrollbars.
- **Glyph rasterization.** The bold 22px title and the today badge digits differ at the anti-aliasing level only.
- **Merged ribbon cut-outs** end about 3px earlier than the reference when three or more chips run together.
- **Inferred rules** (see `tokens.md` section 6): overlaps of three or more chips, past-event bars, the all-day height cap and the order of same-day all-day events. The reference itself orders same-day all-day events differently between captures a minute apart, so the dark fixture lists them in the order that capture showed.
