# Design system

The admin app (`web/`) is styled by one small system: a set of CSS custom
properties, a handful of component classes that read them, and a few React
primitives in `web/src/ui.jsx`. There is no CSS framework and no build step
beyond Vite.

## Where things live

| File | Holds |
| --- | --- |
| `web/src/styles/tokens.css` | Every colour, radius, spacing step, font size and shadow — plus the whole dark theme |
| `web/src/styles/base.css` | Element defaults, typography, focus behaviour, small utilities |
| `web/src/styles/layout.css` | The shell: sidebar rail, topbar, page container, responsive drawer |
| `web/src/styles/components.css` | Cards, buttons, forms, tables, badges, banners, modals, wizard, flyer designer, editor |
| `web/src/styles.css` | Import order only — tokens, base, layout, components |
| `web/src/icons.jsx` | The monochrome line-icon set |
| `web/src/components/Logo.jsx` | The brand lockup — mark and wordmark, inlined so CSS can theme it |
| `web/src/ui.jsx` | React primitives (below) |

## Rules

1. **Components never hard-code a colour.** Everything is `var(--c-…)`. That
   is the only reason the dark theme is a single block of overrides rather
   than a second stylesheet.
2. **Buttons and inputs share a height** (`--control-h`, 36px; `-sm` 30px,
   `-lg` 42px), so a button beside an input always lines up.
3. **Icons are monochrome line art at `currentColor`.** An icon inherits the
   text colour of whatever it sits in, so it needs no theme-specific variant.
   Colour carries status only — never decoration.
4. **Text meets WCAG AA (4.5:1) in both themes.** `--c-muted` is pinned to
   clear it on `--c-canvas` (the lightest surface it lands on), and
   `--c-faint` on `--c-surface`. If you lighten either, re-check.

## Tokens

Colour tokens come in tiers rather than named greys:

| Token | Use |
| --- | --- |
| `--c-canvas` | Page background behind the surfaces |
| `--c-surface` / `-2` / `-3` | Cards and inputs / table headers and toolbars / hover fills and chips |
| `--c-line` / `--c-line-strong` | Default hairline / input and divider borders |
| `--c-ink` / `--c-ink-2` / `--c-muted` / `--c-faint` | Text, brightest to quietest |
| `--c-accent` and friends | The one accent (deep teal), its hover, its tinted fill and border |
| `--c-ok` / `--c-bad` / `--c-warn` / `--c-info` | Status, each with a `-soft` fill and `-line` border |
| `--c-side-*` | The sidebar, which stays dark in both themes |

Also `--r-*` (radii, 4–14px), `--sp-*` (4px spacing scale), `--fs-*` (type
scale), `--sh-*` (shadows, deliberately subtle) and the layout constants
(`--side-w`, `--topbar-h`, `--page-max`, `--control-h`).

## React primitives

From `web/src/ui.jsx`:

| Primitive | What it gives you |
| --- | --- |
| `<Card title sub actions flush>` | Surface with an optional header strip. `flush` drops the body padding so a table sits edge to edge. |
| `<StatGrid>` / `<Stat icon label value sub tone>` | The joined stat strip. The 1px grid gap draws the dividers, so it wraps cleanly at any column count. |
| `<OptionCard name checked onSelect title sub>` | Segmented option card with a radio mark. Renders a real `<input type="radio">`, so keyboard and screen readers work. |
| `<Banner tone>` | Inline message with a matching status icon (`info`, `ok`, `warn`, `bad`). |
| `<Badge tone dot>` | Status pill. `dot` adds the leading indicator used in tables. |
| `<IconButton icon label>` | Square icon-only button. `label` is required — it is both the tooltip and the accessible name. |
| `<Empty icon title action>` | Empty state with a framed icon. |
| `<Field label required hint htmlFor>` | Label + control + hint. |
| `<Modal>` / `<ConfirmModal>` | Dialog with `role="dialog"`, focus moved into the panel, Escape to close. |
| `<ThemeProvider>` / `<ThemeToggle>` / `useTheme()` | Light / dark / system. Stored per browser under `soapbox.theme`; `system` follows the OS live. |
| `<Icon name size>` | Any glyph from `icons.jsx`. |
| `<Logo variant>` | The brand lockup — `full` is mark + wordmark, `mark` is the graphic alone (used by the collapsed rail). |

## The logo

`Logo.jsx` inlines the artwork rather than loading an `.svg`, so one file
serves every background. It takes no fixed fills — two custom properties do
the work:

| Property | Paints |
| --- | --- |
| `--logo-ink` | The mark and the "soap" half of the wordmark |
| `--logo-accent` | The "box" half |

They default to `--c-ink` / `--c-accent` and are overridden on the sidebar,
which is dark in both themes and therefore needs `--c-side-accent` (a light
teal) rather than the light theme's much darker `--c-accent`.

Two things to know before editing it:

- **Context rules must out-specify `.logo`.** `components.css` is the last
  file in the import chain, so a bare `.side-logo` selector in `layout.css`
  loses to `.logo`. Scope context rules to their container
  (`.sidebar .side-logo`, `.login-card .login-logo`).
- **Counters are punched, not painted.** Each letter carries its bowl in the
  same path with `fill-rule="evenodd"`, so the holes are truly transparent
  and the logo needs no backing colour. The source artwork drew them as
  opaque off-white shapes, which only works on one background.

The source lockup stacks the mark above the wordmark; `MARK_TRANSFORM` and
`WORD_TRANSFORM` re-lay it out horizontally. To change the balance between
the two, edit those transforms — the comment above them records the source
bounding boxes the numbers derive from.

## Adding a glyph

Add an entry to `PATHS` in `web/src/icons.jsx` — a fragment of `<path>` /
`<circle>` elements on a 24×24 grid, no `fill`, no hard-coded stroke. The
`Icon` component supplies `stroke="currentColor"`, the stroke width, and the
round line caps.

## Theming

`ThemeProvider` writes `data-theme="light"` or `"dark"` on `<html>`. Anything
that needs a theme-specific value keys off `:root[data-theme='dark']` in
`tokens.css`. Prefer adding a token over writing a theme-specific component
rule — there are only a handful of the latter, and they are all cases where
the same token genuinely needs a different treatment (for example the toast,
which inverts in light mode but cannot in dark).

The guest-facing event pages, the flyer renderer and the emails are rendered
by the server (`server/lib/flyer.js`, `server/lib/emailTemplates.js`,
`server/routes/publicRoutes.js`) and have their own styling. They are
deliberately not part of this system: flyers have fixed template colours, and
email clients cannot use custom properties.
