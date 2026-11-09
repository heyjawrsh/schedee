# Schedee design tokens: week view (reference: Notion Calendar 1.142.0)

Measured spec for M1's pixel rebuild of the week view. Machine-readable twin: `docs/re/tokens.json` (same values, same names).

**Sources.** Two DOM captures (light and dark) of the week view at 1440x900 CSS px, device pixel ratio 2. Each holds computed styles and boxes for every visible element plus the root custom properties. Six @2x screenshots, converted from their embedded ICC profile to sRGB before sampling. Raw captures are gitignored and contain private calendar data. Nothing personal is reproduced here: elements are named by role only.

**Evidence codes.** `M` = computed style from the DOM capture. `P` = pixel-sampled from an sRGB-converted screenshot. `V` = value of a reference custom property, not directly observed in the week view. **INFERRED** = derived or estimated, not measured. Reference custom-property names appear only in the Source column. All names in the Token column are Schedee's own.

**Units.** CSS px at 1x. Boxes are `[x, y, w, h]` measured from the viewport's top-left corner. The DOM capture has the time grid scrolled so that the 1 AM line sits at y=291.5. The dark screenshot is scrolled 112.5px further down, which is irrelevant for colors.

---

## 1. Color

### 1.1 Semantic colors (light / dark)

| Token                        | Light                      | Dark                         | Source (reference var)              | Evidence                                                           |
| ---------------------------- | -------------------------- | ---------------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| `neutral.0`                  | `#FFFFFF`                  | `#000000`                    | --nds-gray-0                        | V                                                                  |
| `neutral.30`                 | `rgba(84, 72, 49, 0.04)`   | `#151515`                    | --nds-gray-30                       | V                                                                  |
| `neutral.50`                 | `#F8F8F7`                  | `#191919`                    | --nds-gray-50                       | V                                                                  |
| `neutral.75`                 | `rgba(84, 72, 49, 0.08)`   | `#1C1C1C`                    | --nds-gray-75                       | V                                                                  |
| `neutral.90`                 | `rgba(227, 226, 224, 0.7)` | `#1E1E1E`                    | --nds-gray-90                       | V                                                                  |
| `neutral.100`                | `rgba(84, 72, 49, 0.15)`   | `#202020`                    | --nds-gray-100                      | V                                                                  |
| `neutral.200`                | `rgba(81, 73, 60, 0.32)`   | `#252525`                    | --nds-gray-200                      | V                                                                  |
| `neutral.300`                | `rgba(70, 68, 64, 0.45)`   | `#2F2F2F`                    | --nds-gray-300                      | V                                                                  |
| `neutral.400`                | `rgba(71, 70, 68, 0.6)`    | `#373737`                    | --nds-gray-400                      | V                                                                  |
| `neutral.500`                | `#787774`                  | `#5A5A5A`                    | --nds-gray-500                      | V                                                                  |
| `neutral.600`                | `#5F5E5B`                  | `#7F7F7F`                    | --nds-gray-600                      | V                                                                  |
| `neutral.700`                | `#484743`                  | `#9B9B9B`                    | --nds-gray-700                      | V                                                                  |
| `neutral.800`                | `#32302C`                  | `#D3D3D3`                    | --nds-gray-800                      | V                                                                  |
| `neutral.900`                | `#1D1B16`                  | `#FFFFFF`                    | --nds-gray-900                      | V                                                                  |
| `text.primary`               | `#32302C`                  | `rgba(255, 255, 255, 0.81)`  | --nds-text-primary                  | M                                                                  |
| `text.secondary`             | `#787774`                  | `rgba(255, 255, 255, 0.443)` | --nds-text-secondary                | M                                                                  |
| `text.tertiary`              | `rgba(70, 68, 64, 0.45)`   | `rgba(255, 255, 255, 0.282)` | --nds-text-tertiary                 | M                                                                  |
| `text.quaternary`            | `rgba(81, 73, 60, 0.32)`   | `rgba(255, 255, 255, 0.13)`  | --nds-text-quaternary               | V                                                                  |
| `text.calendarSuffix`        | `#787774`                  | `#7F7F7F`                    | --nds-text-contrastSecondary        | M                                                                  |
| `text.onAccent`              | `#FFFFFF`                  | `#FFFFFF`                    | --nds-text-contrastPrimary          | M                                                                  |
| `text.kbd`                   | `rgba(0, 0, 0, 0.45)`      | `rgba(255, 255, 255, 0.55)`  | --kbs                               | M                                                                  |
| `text.selection`             | `rgba(35, 131, 226, 0.21)` | `rgba(35, 131, 226, 0.35)`   | --text-selection                    | V                                                                  |
| `text.destructive`           | `#BD4841`                  | `#DA615D`                    | --calendar-text-red                 | V                                                                  |
| `icon.primary`               | `#32302C`                  | `rgba(255, 255, 255, 0.81)`  | --nds-icon-primary                  | V                                                                  |
| `icon.secondary`             | `rgba(71, 70, 68, 0.6)`    | `rgba(255, 255, 255, 0.443)` | --nds-icon-secondary                | M                                                                  |
| `icon.tertiary`              | `rgba(81, 73, 60, 0.32)`   | `rgba(255, 255, 255, 0.282)` | --nds-icon-tertiary                 | M                                                                  |
| `surface.grid`               | `#FFFFFF`                  | `#191919`                    | --nds-surface-page                  | M+P                                                                |
| `surface.grid.weekend`       | `#FCFCFC`                  | `#171717`                    | --layout-fill-grid-wknd             | M+P                                                                |
| `surface.header`             | `#FFFFFF`                  | `#191919`                    | --nds-surface-page                  | M+P                                                                |
| `surface.timeGutter`         | `#FFFFFF`                  | `#191919`                    | --nds-surface-page                  | M                                                                  |
| `surface.sidebar`            | `#F8F8F7`                  | `#202020`                    | --nds-surface-wash                  | M+P                                                                |
| `surface.contextPanel`       | `#FFFFFF`                  | `#191919`                    | --nds-surface-page                  | M+P                                                                |
| `surface.popover`            | `#FFFFFF`                  | `#252525`                    | --nds-surface-elevated              | V (dark cmd menu pixel-measured #1F1F1F, translucent over scrim) I |
| `surface.scrim`              | `rgba(0, 0, 0, 0.12)`      | `rgba(0, 0, 0, 0.24)`        | --material-dim                      | V (dark P: grid 25 to 19)                                          |
| `surface.input`              | `rgba(0, 0, 0, 0.04)`      | `rgba(255, 255, 255, 0.05)`  | (none)                              | M                                                                  |
| `surface.kbd`                | `rgba(0, 0, 0, 0.07)`      | `rgba(255, 255, 255, 0.08)`  | --kbs-bg                            | M                                                                  |
| `surface.button.top`         | `#FCFCFC`                  | `#292929`                    | --neutral-gradient-bg               | V+P                                                                |
| `surface.button.bottom`      | `#F7F7F7`                  | `#242424`                    | --neutral-gradient-bg               | V+P                                                                |
| `surface.miniMonth.weekBand` | `rgba(84, 72, 49, 0.08)`   | `rgba(255, 255, 255, 0.055)` | --nds-tint-regular                  | M                                                                  |
| `surface.selected`           | `#F7F7F7`                  | `#333333`                    | --bg-selected                       | V, usage I                                                         |
| `state.hover`                | `rgba(0, 0, 0, 0.04)`      | `rgba(255, 255, 255, 0.05)`  | --nds-state-hover                   | V                                                                  |
| `state.pressed`              | `rgba(0, 0, 0, 0.08)`      | `rgba(255, 255, 255, 0.08)`  | --nds-state-pressed                 | V                                                                  |
| `grid.line.hour`             | `#F6F6F6`                  | `#1F1F1F`                    | --layout-line-grid-h                | M+P                                                                |
| `grid.line.hour.weekend`     | `#F2F2F2`                  | `#1E1E1E`                    | --layout-line-grid-h-wknd           | M+P                                                                |
| `grid.line.day`              | `#EEEEEE`                  | `#222222`                    | --layout-line-grid-v                | M+P                                                                |
| `grid.line.day.weekend`      | `#ECECEC`                  | `#212121`                    | --layout-line-grid-v-wknd           | M+P                                                                |
| `border.divider`             | `rgba(84, 72, 49, 0.08)`   | `rgba(255, 255, 255, 0.055)` | --nds-stroke-secondary              | M+P                                                                |
| `border.strong`              | `rgba(84, 72, 49, 0.15)`   | `rgba(255, 255, 255, 0.13)`  | --nds-stroke-primary                | V                                                                  |
| `border.input`               | `rgba(0, 0, 0, 0.15)`      | `rgba(255, 255, 255, 0.2)`   | --nds-stroke-input                  | V                                                                  |
| `border.avatar`              | `rgba(0, 0, 0, 0.1)`       | `rgba(255, 255, 255, 0.1)`   | (none)                              | M                                                                  |
| `border.popover.dark`        | `n/a`                      | `#2B2B2B`                    | (none)                              | P, I                                                               |
| `border.focus`               | `#2383E2`                  | `#2383E2`                    | --nds-stroke-uiBluePrimary          | V                                                                  |
| `border.focus.halo`          | `rgba(35, 131, 226, 0.07)` | `rgba(35, 131, 226, 1)`      | --nds-uiBlue-100 / --nds-uiBlue-600 | V                                                                  |
| `chip.ring`                  | `#FFFFFF`                  | `#191919`                    | (surface.grid)                      | M                                                                  |
| `accent.today`               | `#F04842`                  | `#F15550`                    | --secondary500                      | M+P                                                                |
| `now.line`                   | `#F04842`                  | `#F15550`                    | --secondary500                      | M+P                                                                |
| `now.line.otherDays`         | `rgba(240, 72, 66, 0.3)`   | `rgba(241, 85, 80, 0.3)`     | --secondary500 at opacity 0.3       | M                                                                  |
| `now.ring`                   | `#FFFFFF`                  | `#000000`                    | --time-indicator-bg (dark)          | M                                                                  |
| `now.shadow`                 | `rgba(0, 0, 0, 0.04)`      | `rgba(0, 0, 0, 0.08)`        | --nds-shadow-xs                     | M                                                                  |
| `accent.ui`                  | `#2383E2`                  | `#2383E2`                    | --nds-uiBlue-600                    | V                                                                  |
| Notes:                       |
- The neutral ramp is themed: in light mode the low steps are warm translucent tints of `#544831`; in dark mode they are opaque grays. A separate unthemed ramp (`#FCFCFC #F7F7F7 #F2F2F2 #EDEDED #E5E5E5 #D9D9D9 #CCCCCC #BFBFBF #B2B2B2 #A6A6A6 #999999 #8C8C8C #808080 #737373 #666666 #595959 #4D4D4D #404040 #333333 #262626 #1F1F1F #1A1A1A`) feeds the button gradients and the selected background.
- Grid lines are opaque solid colors, not alpha. Weekend columns get both a fill (`surface.grid.weekend`) and their own line colors. The weekend tint covers the time grid and the all-day cells only. The day-header row stays `surface.header`.
- Toolbar buttons have a vertical gradient from `surface.button.top` to `surface.button.bottom`, plus a 1px inset `border.divider` ring.
- Sidebar and context panel are separated from the main area by a 1px `border.divider` line: the sidebar via an outer ring and the panel via a line at x=1156.
- The 1px `chip.ring` around every chip uses the grid surface color, so overlapping chips read as separate cards.

### 1.2 Event-chip color model

Every chip derives from one **calendar color**. Each calendar color has a light variant (used in light mode) and a slightly lighter dark variant (used in dark mode). Both are the values the sidebar swatch shows.

| Part                                       | Light                                                       | Dark                                               | Evidence        |
| ------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------- | --------------- |
| Left bar (4px) and sidebar swatch          | calendar color, unchanged                                   | calendar dark variant, unchanged                   | P (exact match) |
| Chip background                            | very light tint of the hue                                  | dark shade of the hue                              | M               |
| Title text                                 | dark, saturated shade of the hue                            | near-white tint of the hue                         | M               |
| Time text                                  | mid shade, less saturated than title                        | mid-light, desaturated                             | M               |
| Past event, title / time                   | gray-shifted mid tone (title L about 0.73, time about 0.81) | gray-shifted (title L about 0.61, time about 0.53) | M               |
| Past event, background                     | unchanged                                                   | unchanged                                          | M               |
| Past event, bar                            | not observed (past chips were off-screen)                   | not observed                                       | UNKNOWN         |
| Hidden calendar (sidebar swatch and label) | opacity 0.25                                                | opacity 0.25                                       | M+P             |

Measured samples for every calendar hue present in the capture. Hue names are descriptive labels, not calendar names:

| Calendar hue                                                                                                             | Bar (base) L / D      | Chip bg L / D         | Title L / D           | Time L / D            | Past title L / D      | Past time L / D       |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------- | --------------------- | --------------------- | --------------------- | --------------------- | --------------------- |
| blue-violet                                                                                                              | `#757AFF` / `#7D85FF` | `#EFF2FF` / `#3C4062` | `#504BD9` / `#F8FCFF` | `#5C61CF` / `#949AD1` | `#A3A7CB` / `#828497` | `#BBBEDA` / `#676A84` |
| cyan                                                                                                                     | `#00FBFE` / `#1FFFFF` | `#D1FFFF` / `#1B4B4B` | `#007E83` / `#CDFFFF` | `#00878A` / `#5CADAE` | `#83B4B4` / `#738B8A` | `n/a` / `n/a`         |
| magenta                                                                                                                  | `#FF08FF` / `#FF45FF` | `#FFDCFF` / `#5F2C5C` | `#9C119D` / `#FFEBFF` | `#A33BA0` / `#C287BB` | `#C49ABD` / `#947D8F` | `#D6B3CF` / `#7F617A` |
| green                                                                                                                    | `#48CA80` / `#63D18D` | `#DDFFE3` / `#2D4935` | `#007B28` / `#D6FFE3` | `n/a` / `n/a`         | `#89B594` / `#768B7A` | `n/a` / `n/a`         |
| gray                                                                                                                     | `#B3B4B4` / `#BDBCBC` | `#F7F4F3` / `#424242` | `#5D5E5F` / `#FFFFFF` | `n/a` / `n/a`         | `n/a` / `n/a`         | `n/a` / `n/a`         |
| Two further calendar colors appear only as sidebar swatches: violet `#9808FF` / `#973BFF` and red `#FF0000` / `#FF2B04`. |

**Derivation (INFERRED, least-squares fit in OKLCH).** Let `h` and `C` be the OKLCH hue and chroma of the light-variant calendar color. Each chip role keeps the hue, uses a fixed lightness and scales the chroma:

| Role       | Light                                    | Dark                     | Fit error (8-bit RGB rms) |
| ---------- | ---------------------------------------- | ------------------------ | ------------------------- |
| bg         | `oklch(0.970, 0.32C, h)`                 | `oklch(0.380, 0.33C, h)` | 1.8 / 1.0                 |
| title      | `oklch(~0.50, ~1.0C, h)`, varies per hue | `oklch(~0.99, 0.40C, h)` | 12 / 5                    |
| time       | `oklch(0.554, 0.64C, h)`                 | `oklch(0.696, 0.44C, h)` | 10 / 7                    |
| past title | `oklch(0.730, 0.30C, h)`                 | `oklch(0.614, 0.16C, h)` | 5 / 2.5                   |
| past time  | `oklch(0.807, 0.19C, h)`                 | `oklch(0.532, 0.19C, h)` | 2 / 2                     |

The background and past-state formulas reproduce the reference within 1 to 5 levels per channel. Title and time vary by hue (the reference probably applies a per-hue or contrast-driven adjustment), so M1 should use the measured table for these five hues and the formula only as a fallback. Achromatic calendars (chroma near 0) produce neutral grays: title `#5D5E5F` / `#FFFFFF`, bg `#F7F4F3` / `#424242`.

**Hatched bar (INFERRED meaning: response pending or tentative).** Some chips and ribbons draw the 4px bar as 45° diagonal stripes (rising to the right) instead of a solid fill. The stripes alternate the calendar color and the chip bg with a 5px vertical period; each color run is about 3px. Measured on a ribbon and seen on one timed chip.

### 1.3 Today and now

- Today red: `accent.today` (`#F04842` / `#F15550`). Used for the day-header badge, the mini-month today square, the now line, the now label and the sidebar notification dot.
- Now line in today's column: 2px solid `now.line`. Its top, right and bottom carry a 1px `now.ring` (surface-colored in light, black in dark) plus `now.shadow` 0 2px 4px.
- Now line in every other day column: 1px `now.line` at opacity 0.3. It spans the full column width, including today's column underneath the 2px line.

---

## 2. Typography

Fonts: `document.fonts` was empty. Every computed `fontFamily` is a system stack, so the text renders in SF Pro on macOS.

- UI stack: `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif, "Segoe UI Emoji", "Segoe UI Symbol"` (source `--nds-font-sans`). The computed stack also lists two Noto fallbacks for Arabic and Hebrew.
- Chip stack (all chip titles): `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif` (source `--sans-serif-font`).
- An "SF Compact" stack is defined (source `--compact-font`, letter-spacing -0.01em), but no week-view element uses it.
- Font smoothing and `font-variant-numeric` were not captured. Tabular numerals are INFERRED from glyph advance widths: in the hour labels and the now label every digit, including "1", is 6.25px wide at 10px. Day-header and mini-month digits are proportional ("1" is 5.8px, "2" is 7.4px at 12px).

| Role                           | Size / line height     | Weight | Letter spacing | Color                                              | Notes                                                                                                                                                                  |
| ------------------------------ | ---------------------- | ------ | -------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Month title (month and year)   | 22 / 26                | 700    | -0.22px        | text.primary                                       | both words bold                                                                                                                                                        |
| Week label                     | 12 / normal            | 500    | -0.22px        | text.secondary                                     | sits about 9px right of the title (INFERRED from pixels)                                                                                                               |
| Toolbar buttons (view, today)  | 13 / 18                | 500    | 0              | text.primary                                       |                                                                                                                                                                        |
| Day header, other days         | 13 / 18                | 400    | 0              | text.secondary                                     | weekday, then a space (about 3.5px), then the date; centered in the column; proportional digits                                                                        |
| Day header, today              | 13 / 18                | 500    | 0              | text.primary                                       | date sits in the today badge                                                                                                                                           |
| Today badge                    | 13 / 18                | 500    | 0              | text.onAccent on accent.today                      |                                                                                                                                                                        |
| Timezone label (gutter)        | 10 / 13                | 500    | 0              | text.secondary                                     |                                                                                                                                                                        |
| Hour labels                    | 10 / 13                | 500    | -0.3px         | text.secondary                                     | right-aligned; hour and meridiem in separate runs about 1px apart; tabular (INFERRED)                                                                                  |
| Now label                      | 10 / 13                | 500    | -0.3px         | text.onAccent                                      | tabular (INFERRED)                                                                                                                                                     |
| Chip title (timed and all-day) | 11 / 13                | 500    | 0              | chip title color                                   | chip stack; ellipsis; wraps to as many lines as fit                                                                                                                    |
| Chip time                      | 10 / 11                | 400    | 0              | chip time color                                    | 2px top margin under the title. The reference var says 9px, but the computed value in week view is 10px. In 10px-tall chips the time sits inline, 2px after the title. |
| Sidebar account header         | 12 / normal (16px box) | 500    | 0              | text.secondary                                     |                                                                                                                                                                        |
| Calendar row                   | 13 / 18                | 500    | 0              | text.primary                                       | the "default calendar" suffix uses text.calendarSuffix                                                                                                                 |
| Sidebar nav row (scheduling)   | 13 / 18                | 500    | 0              | text.primary                                       |                                                                                                                                                                        |
| Inputs (meet-with, search)     | 13 / 18                | 400    | 0              | text.primary; placeholder text.tertiary (INFERRED) |                                                                                                                                                                        |
| Mini-month weekday header      | 10 / 13                | 500    | 0              | text.secondary                                     |                                                                                                                                                                        |
| Mini-month day                 | 12 / normal (16px box) | 500    | 0              | text.primary                                       | out-of-month days at opacity 0.33                                                                                                                                      |
| Mini-month week number         | 10 / 13                | 500    | 0              | text.tertiary                                      |                                                                                                                                                                        |
| Context panel heading          | 13 / 18                | 500    | 0              | text.primary                                       |                                                                                                                                                                        |
| Context panel list item        | 12 / normal (16px box) | 400    | 0              | text.secondary                                     |                                                                                                                                                                        |
| Keyboard key cap               | 12                     | 500    | -0.12px        | text.kbd on surface.kbd                            |                                                                                                                                                                        |

---

## 3. Layout at 1440x900

### 3.1 Frame

| Region                     | Box                   | Notes                                                               |
| -------------------------- | --------------------- | ------------------------------------------------------------------- |
| Sidebar                    | `[0, 0, 240, 900]`    | source `--sidebar-width-default`                                    |
| Main (header and grid)     | `[240, 0, 916, 900]`  |                                                                     |
| Context panel              | `[1156, 0, 284, 900]` | source `--context-panel-width`; 1px divider at x=1156               |
| Toolbar row                | `[240, 0, 916, 42]`   | right padding 10px; contents right-aligned                          |
| Header (toolbar and title) | `[240, 0, 916, 78]`   | left padding 20px, bottom padding 2px; title row `[260, 50, *, 26]` |

Toolbar contents, right to left: two 30x30 icon buttons (next, previous) at x=1116 and x=1085 with a 1px gap; a 24px gap; the "today" button `[1011.9, 8, 61.1, 30]`; a 6px gap; the view dropdown `[929.7, 8, 76.2, 30]` with a 14px chevron; a 12px gap; a 24px circular avatar `[893.7, 11, 24, 24]`.

### 3.2 Week grid

| Element                                      | Measurement                                                                                                                                                                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Day-header row                               | y 78 to 106, height 28. Labels at y=83. 1px `grid.line.day` underneath at y=106.                                                                                                                                                                   |
| Today badge                                  | `[377.9, 83, 17, 19]` (min width 17, height 19, radius 4)                                                                                                                                                                                          |
| All-day section                              | starts at y=106. The first chip row sits at y=109 (3px inset). Chips are 19px tall on a 21px pitch (2px gap).                                                                                                                                      |
| All-day visible height                       | 137.5px (y 106 to 243.5), with a 1px `grid.line.day` bottom border at y=242.5. The capture is at its cap: content beyond it is clipped. The cap rule is INFERRED (may depend on viewport height).                                                  |
| All-day collapse control                     | 20x20 button with a 14px icon at the right of the gutter `[288.6, 108.5]`                                                                                                                                                                          |
| Time gutter                                  | x 239 to 311.6 (72.6 wide, overlapping the sidebar edge by 1px). 26px left gutter, then a 45.6px label column with 6px right padding. 1px `grid.line.day` right border at x=310.5.                                                                 |
| Gutter header                                | 26px slot holding a 20x20 add button with a 12px icon, then the timezone label `[266, 89, 38.6, 13]`                                                                                                                                               |
| Hour row height                              | **48px per hour**, so 1152px for the full day. Each hour line sits at the top of its row. The midnight line is the all-day bottom border at y=243.5.                                                                                               |
| Hour label                                   | 13px tall box, vertically centered on its line (label top = line y - 6.5)                                                                                                                                                                          |
| Day column                                   | **121px wide**. The visible week starts at x=311.5. Columns are virtualized (3 more days are rendered off-screen on each side). The last visible column runs 2.5px under the context panel. Vertical day lines are 1px at the column's right edge. |
| Period control (top right of the header row) | 16x16 button, 12px icon, at `[1138, 84]` (purpose INFERRED: day-count selector)                                                                                                                                                                    |

### 3.3 Chips

| Property                       | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timed chip width               | column width - 13 (right margin 13px, source `--chip-margin-right`), so 108 in a 121 column                                                                                                                                                                                                                                                                                                                                                                         |
| Timed chip top                 | exact start-time offset (48px per hour)                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Timed chip height              | duration in px - 3 (bottom margin 3, source `--chip-margin-bottom`), minimum 10. Measured: 15 min = 10, 30 min = 21, 60 min = 45, 90 min = 69, 120 min = 93.                                                                                                                                                                                                                                                                                                        |
| Padding                        | 1 4 1 8 for chips 45px and taller; 0 4 0 8 for the 10px and 21px chips. INFERRED threshold: compact padding below about 24px.                                                                                                                                                                                                                                                                                                                                       |
| Title placement                | 10px chip: one line, vertically centered (13px line overflows by 1.5px top and bottom), time inline. 21px chip: one line centered. Taller chips: title at top + 2, time below.                                                                                                                                                                                                                                                                                      |
| Left bar                       | 4px wide, full height, radius 4 0 0 4, calendar color                                                                                                                                                                                                                                                                                                                                                                                                               |
| Radius                         | 6                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Ring                           | 1px `chip.ring` (box-shadow spread)                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| All-day chip                   | height 19, padding 0 4 0 8, width = days spanned x 121 - 13, same bar and ring; optional 13px leading glyph (for example a gift icon)                                                                                                                                                                                                                                                                                                                               |
| Ribbon (long background event) | 8px wide strip at the column's left edge, radius 6: a 4px bar (solid or hatched) plus 4px of chip bg. Other chips in the column shift right by 11 (8 + 3px gap, sources `--chip-ribbon-width` and `--chip-ribbon-gap`). Where another chip sits beside it, the ribbon segment becomes a surface-colored cut-out with 1px dashed borders in the calendar color (about 2.5px dash and gap). The meaning of a fully dashed ribbon is INFERRED; it was seen on one day. |
| Two overlapping chips          | Area 97 wide after the ribbon offset. First chip: x+0, width 66.8 (68.9%). Second chip: x+60.5 (62.4%), width 36.5, running to the right margin. Overlap 6.3px; the later chip sits on top. The general N-way rule is INFERRED: only the 2-way case was captured.                                                                                                                                                                                                   |
| Resize handles                 | invisible 4px-tall hit strips centered on the chip's top and bottom edges (INFERRED purpose)                                                                                                                                                                                                                                                                                                                                                                        |

### 3.4 Now indicator

| Element                | Box / value                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Line in today's column | 2px tall, from column x+3 to column right - 2 (`[314.5, 305.4, 116, 2]`), radius 0 1 1 0                                                           |
| Leading cap            | 2px wide x 10px tall bar at column x+1 to x+3, vertically centered on the line. Pixel-measured; INFERRED to be a pseudo-element.                   |
| Line in other columns  | 1px at opacity 0.3, full column width                                                                                                              |
| Label                  | `[263.9, 297.4, 45.6, 17]`: padding 2 4, radius 4, right edge 3px left of the cap, vertically centered on the line, inside the gutter label column |
| Position               | y = grid top + minutes since midnight x 48/60                                                                                                      |

### 3.5 Sidebar

| Element                 | Box / value                                                                                                                                                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top bar                 | y 7, height 30. 80px left inset (window controls). Three 30x30 icon buttons with 18px icons at x=80 (toggle), 172 and 202.                                                                                                                                             |
| Mini-month block        | `[8, 52, 224, 219]`, padding 8                                                                                                                                                                                                                                         |
| Mini-month nav row      | height 30; two 24x24 buttons with 16px icons at x=178 and x=206. The month label in this row is present but transparent.                                                                                                                                               |
| Mini-month table        | weekday header row 21px tall; day cells **28x28**; week-number column 28px wide (7 days + week number = 224)                                                                                                                                                           |
| Mini-month today        | 23.3x23.3 `accent.today` square, radius 6, centered in the cell, white digit                                                                                                                                                                                           |
| Mini-month current week | `surface.miniMonth.weekBand` across the 7 day cells. Radius 8 on the outer ends only.                                                                                                                                                                                  |
| Scheduling row          | `[8, 287, 224, 28]`, radius 6, 18px icon at x=16, label at x=42, 20x20 visibility toggle on the right                                                                                                                                                                  |
| Meet-with input         | `[8, 327, 224, 30]`, radius 6, padding 6 8 6 34, 18px tertiary icon at x=16                                                                                                                                                                                            |
| Calendar list           | starts at y=365, padding 4 8 per account group. Account header row 28px. Calendar rows **28px tall on a 29px pitch**, radius 6, padding 0 4 0 8, 18x18 swatch at x=16, label at x=42. Hide-toggle button 20x20 with a 16px icon at the right (seen on the hidden row). |
| Footer                  | `[0, 856, 240, 44]`. 30x30 help button with a 20px icon. 8px notification dot: a 6px `accent.today` circle with a 1px sidebar-colored border.                                                                                                                          |
| Scrollbar               | system overlay scrollbar on the calendar list (not tokenized)                                                                                                                                                                                                          |

### 3.6 Context panel (idle state)

| Element          | Box / value                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search input     | `[1164, 8, 232, 30]`, radius 6, padding 6 28 6 34, 18px tertiary icon at x=1172, no fill                                                                                                                      |
| Panel toggle     | 30x30 at x=1400, 18px icon                                                                                                                                                                                    |
| Shortcut section | starts at y=67, padding 10 8. Heading row 30px tall at x=1164 with 8px inner left padding. List items 16px tall on a 24px pitch, starting at y=109. Key caps 16px tall, min 16 wide, right-aligned at x=1422. |

---

## 4. Radii, shadows, borders, opacity

**Radii (px).** Key caps 2. Today badge, now label and small icon buttons 4. Buttons, inputs, chips, sidebar rows and the mini-month today square 6. Chip bar 4 0 0 4. Now line 0 1 1 0. Mini-month week band 8 (outer ends only). Reference scale: s 2, m 4, l 8, xl 12. Popover and command menu 12 (INFERRED from pixels). Avatar 50%.

**Shadows.**

| Token                                  | Light                                                               | Dark                                     | Source          |
| -------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------- | --------------- |
| `shadow.xs`                            | `0 2px 4px 0 rgba(0,0,0,.04)`                                       | `0 2px 4px 0 rgba(0,0,0,.08)`            | --nds-shadow-xs |
| `shadow.sm`                            | `0 4px 12px -2px rgba(0,0,0,.08)`                                   | `0 4px 12px -2px rgba(0,0,0,.16)`        | --nds-shadow-sm |
| `shadow.md`                            | `0 14px 28px -6px rgba(0,0,0,.10), 0 2px 4px -1px rgba(0,0,0,.06)`  | `.20` / `.12`                            | --nds-shadow-md |
| `shadow.lg` (popovers, INFERRED usage) | `0 24px 48px -8px rgba(0,0,0,.24), 0 4px 12px -1px rgba(0,0,0,.12)` | `.48` / `.24`                            | --nds-shadow-lg |
| `shadow.chipRing`                      | `0 0 0 1px #FFFFFF`                                                 | `0 0 0 1px #191919`                      | M               |
| `shadow.nowLine`                       | 1px ring (top, right, bottom) in surface color + `shadow.xs`        | 1px `#000` ring + dark `shadow.xs`       | M               |
| `shadow.sidebarEdge`                   | `0 0 0 1px rgba(84,72,49,.08)`                                      | `0 0 0 1px rgba(255,255,255,.055)`       | M               |
| `shadow.button`                        | `inset 0 0 0 1px rgba(84,72,49,.08)`                                | `inset 0 0 0 1px rgba(255,255,255,.055)` | M               |
| `shadow.avatar`                        | `inset 0 0 0 .5px rgba(0,0,0,.1)`                                   | `inset 0 0 0 .5px rgba(255,255,255,.1)`  | M               |
| `shadow.focus`                         | `0 0 0 1px #2383E2, 0 0 0 4px rgba(35,131,226,.07)`                 | `0 0 0 1px #2383E2, 0 0 0 4px #2383E2`   | V               |

**Borders.** All grid and divider lines are 1px solid (section 1.1). Ribbon cut-outs are 1px dashed in the calendar color. The command menu (dark) has a 1px `#2B2B2B` edge over a translucent `#1F1F1F` body (P, INFERRED: blurred glass over the scrim).

**Opacity.**

| Token                                                                                  | Value                                | Evidence |
| -------------------------------------------------------------------------------------- | ------------------------------------ | -------- |
| `opacity.hiddenCalendar` (swatch and label of a hidden calendar)                       | 0.25                                 | M+P      |
| `opacity.outOfMonthDay` (mini-month)                                                   | 0.33                                 | M        |
| `opacity.disabled`                                                                     | 0.33                                 | V        |
| `opacity.nowLineOtherDays`                                                             | 0.3                                  | M        |
| `opacity.ghost` (drag preview, INFERRED usage)                                         | 0.5                                  | V        |
| `opacity.gridSelectionFill` / `opacity.gridSelectionBorder` (calendar color, INFERRED) | 0.125 / 0.25                         | V        |
| Past events                                                                            | not opacity; recolored (section 1.2) | M        |

**Motion (V, for later milestones).** 0.1s fast, 0.175s default, 0.275s long, 0.3s context panel. Default easing `cubic-bezier(.25,.46,.45,.94)`. Enter and exit scale 0.98.

---

## 5. Surfaces checklist (week view)

- [ ] Sidebar surface and its 1px edge ring
- [ ] Sidebar top bar (toggle, search, new-event buttons)
- [ ] Mini-month: nav row, weekday header, week-number column, day cells, out-of-month dimming, current-week band, today square
- [ ] Scheduling nav row with visibility toggle
- [ ] Meet-with input
- [ ] Calendar list: account headers, calendar rows (swatch, label, default suffix), hidden-calendar state with toggle
- [ ] Sidebar footer: help button with notification dot
- [ ] Toolbar: avatar, view dropdown, today button, previous and next buttons
- [ ] Title row: month and year title, week label
- [ ] Day-header row: weekday and date labels, today badge, period control
- [ ] Time-gutter header: add button, timezone label
- [ ] All-day section: cells (weekday and weekend), all-day chips (single and multi-day, with optional glyph), collapse control, bottom border, clip at max height
- [ ] Time gutter: hour labels, right border
- [ ] Time grid: weekday and weekend fills, hour lines, day lines (weekday and weekend variants)
- [ ] Timed chips: standard, compact (10px, inline time), multi-line title with time, overlapping pair, past-event colors
- [ ] Ribbon: solid, hatched and dashed cut-out segments, plus the offset it applies to other chips
- [ ] Hatched (pending) bar variant on timed chips
- [ ] Now indicator: today line with cap and ring, faint line on other days, gutter label
- [ ] Context panel: divider, search input, panel toggle, shortcut list with key caps
- [ ] Overlays (seen in other captures, specified only by var): popover or command menu surface, scrim, `shadow.lg`

---

## 6. Gaps and open questions

- Past-event **bar** color, and whether past chips change anything besides text color: past chips were only rendered off-screen.
- Text-selection and grid drag-selection visuals were not captured (values come from vars only).
- The N-way overlap layout rule. Only one 2-way overlap was captured.
- The cap rule for all-day height (137.5px observed at 900px viewport height).
- What the fully dashed ribbon means, and what the hatched bar means (pending RSVP is a guess).
- The light-mode popover look. Only the dark command menu was sampled.
- `font-variant-numeric` and font smoothing were not in the capture. Tabular numerals are inferred from glyph widths.
