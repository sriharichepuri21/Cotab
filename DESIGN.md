# Cotab design system

How Cotab looks and feels, for anyone (or any agent) building UI here. The
values below are the real ones: tokens live at the top of
`frontend/src/styles/glass.css`, the landing page in `landing.css` and
`landing-moss.css`. When this file and the code disagree, the code wins and
this file gets fixed.

## 1. Visual theme and atmosphere

**Tabby on moss glass.** A calm, warm money app with a cat in it.

- **Studio (day, default):** a still, soft sage field (`#e9ede4`), frosted
  panels on top, solid ink for the one thing to press.
- **Night:** the same system in near-black olive (`#121511`) with cream ink.
- **Tabby** (the cat, V3 stock art) is the personality. He reacts to the
  money, he never decorates. One cat per screen, at most.
- **Restraint:** one hero number per screen, set large and light. Everything
  else supports it.
- Not: neon fintech, all-black OLED, glass over photographs, gradients for
  their own sake.

## 2. Colour palette and roles

Use tokens, never hex in components. Both themes set the same names. In
components, use the classes: `text-glass-ink`, `text-glass-ink2`,
`text-glass-soft`, `text-glass-pos`, `text-glass-neg`, `text-glass-warn`,
`glass-cta`, `glass-surface`, `glass-tint`, `glass-tint-pos|neg|warn`,
`glass-inverse`, `glass-danger`.

The logo sets the palette. Its gradient runs `#e6f5e0`, `#a8cba6`, `#4f7f5a`,
with `#12261a` as ink. Every primary and supporting colour is one of these or a
step between them; warm olive and yellow-lime are out.

| Token | Night | Day | Role |
|---|---|---|---|
| `--bg` | `#0d0d0d` | `#eaf2e6` | Ground (grain glow by day, flat black at night) |
| `--ink` | `#ececec` | `#12261a` | Primary text, hero figures |
| `--ink-2`, `--ink-3` | ink at 80%, 60% | ink at 74%, 58% | Body text, secondary notes |
| `--pos` | `#a8cba6` | `#3b6647` | Owed to you, on pace, done |
| `--neg`, `--warn` | `#f0a493`, `#e3d18a` | `#a2493a`, `#7c6418` | Status only: over budget, needs checking |
| `--lime` | `#a8cba6` | same | Accent; the name is historical |
| `--cta-bg` | `#ececec` | `#12261a` | The one primary action |
| `--surf` | `#171717` | glow on `#e6f5e0` | Every card |
| `--hair`, `--track` | white 10% | ink 8–9% | Dividers, progress tracks |

Rules:
- Red means **you must act**. Nothing settled, zero or informational is red.
- The primary action is the only solid. At most one per view.
- Category tints (rent, groceries, dining...) are soft tiles behind a line
  icon, never fills behind text.

## 3. Typography

- **Instrument Sans** for figures and titles, **Figtree** for everything else:
  both stay crisp at the small sizes this app uses.
- **Display figures** (the hero number) at weight 500, large, tracking about
  -0.025em. Cents can sit smaller beside the dollars (`$495`<sub>`87`</sub>).
- **Labels** are sentence case with no tracking: `Safe to spend`. No uppercase
  kickers, no italics.
- The landing page uses the same pair, in two tones for headlines.
- Money is always tabular and in the account's currency; never add
  currencies together.
- Sizes in use: 28px for the one answer figure, 18px page titles, 14px section
  titles, 14px shop names and amounts, 13px other rows, 12px secondary. Nothing larger inside the app.

## 4. Component styling

- **Panel:** solid `--surf` fill with a `--sh` hairline, radius 22px. Lists
  sit inside one panel with hairline dividers, not one card per row.
- **Bright gradient:** `--bright` (the logo's sage to green) marks live data
  and the one active control: budget bars, today's bar, a ready send button.
  `--bright-soft` does the same on the moss card. Use it sparingly, never as a
  panel fill, and add no new hues.
- **Ticket:** receipts and tabs read as paper tickets: a dashed tear line
  and half-circle notches at the sides, zigzag bottom on a receipt.
- **Buttons:** pills. Primary = `--cta-bg`; secondary = glass with
  `--sh-soft`; destructive = a text link in `--neg`, placed last.
- **Rows:** 44px category tile (line icon, radius 14), name and note on the
  left, amount right. Show "yours" only when it differs from the total.
- **Bottom bar:** floating glass pill, five slots, the scan button raised in
  the middle. Keeps its original icons.
- **Shop names:** show merchants through `shopName`, never raw. It is display
  only: forms and filters keep the name as scanned.
- **Shop logos:** rows and receipts show the shop's logo on a white tile when
  `brandLogo` is sure of the match, otherwise the category icon. These are the
  one place outside colours appear. Add new logos to `public/brands` with their
  source in `SOURCES.json`, and mark ordinary words `strict`.
- **Tabby:** `tabbyArt(mood, 256 | 640)` from `lib/tabby.ts`, never the
  1.8MB PNGs. Keep proportions; never inside an oval or on a coloured disc
  other than the avatar circle.
- **Splash:** `AppSplash`, the glass mark closing its c, then the word. Plays
  once per fresh load (website or app), 1.7s, 0.9s still with reduced motion.

## 5. Layout principles

- 16px page gutters on phones; every row and carousel aligns to them
  (carousels use `scroll-padding-inline: 1rem`).
- Tight rhythm: 4 / 8 / 12 between elements, 16 between sections. The first
  screen should show every block without scrolling on a laptop.
- Radii: 9 tiles, 12 panels, pill for buttons and chips.
- Screen heroes are slim: 15px line, 12px note, a 40px Tabby. Only the ticket
  carries a larger figure. Lists stay about 44px a row, with 4px progress bars.
- The home summary is a ticket: balance and bar on the main part, the daily
  amount and days left on the tear-off stub. It sits above Recent, beside the
  side column.
- Today's side column adds Budgets to watch and Who to chase, three rows at most.
  Both hide when empty. Tabby's brief compares spending with this point last month.
- A failed load says so. Never show `$0.00`, "All square" or "Nothing yet" for
  data that didn't arrive.
- Tabby's brief is one row: Tabby, one line that adds to the ticket instead of
  repeating it, and the ask field. Suggestions appear once the field is focused.
- Order on a screen: kicker, hero figure, the one decision, then lists.
- Empty sections collapse to one quiet line ("Every receipt is checked.").

## 6. Depth and elevation

Three levels only: the moss ground, panels, and the floating layer
(bottom bar, sheets, the scan button). Depth comes from a hairline and a
small neutral shadow, never from glossy rims or glows. There is one card. Every panel takes `--surf`, the `--sh-soft` edge and a 12px
corner from one rule in `studio.css`; only the home ticket differs. Day: mint
cards with a faint sage corner glow and grain, on the grain-glow ground. Night:
flat `#171717` cards on `#0d0d0d`, with no glow. Green marks data and active items.
Blur only on panels and fixed layers, never on scrolling content inside them.

## 7. Do's and don'ts

Do:
- Lead each screen with one number and say what it means in plain words.
- Let Tabby's mood carry the state (cool, hmm, over-budget).
- Make every action undoable or confirmed, and say what happened.
- Check both themes at 320, 375, 390 and 430px.

Don't:
- Hard-code colours (`text-[#77776f]`); use a token class.
- Build an overlay as `fixed inset-0 max-w-[430px]` without `app-overlay`.
- Repeat the hero number in a second card on the same screen.
- Explain the UI in copy ("Tabby reacts to net balances").
- Use red for zero, settled or neutral states.
- Ship images over ~100KB to a phone.

## 8. Responsive behaviour

- Built phone-first: one 430px column with the floating bottom bar.
- **1024px and up:** a sidebar on the ground, with no panel of its own (Scan first, then Today, Activity, Tabs,
  Tabby, then Insights, Budgets, Notifications, theme and profile) replaces
  the bottom bar. Today, Tabs and Insights use two columns and fill the
  width up to 1304px, with Tabby's brief beside the moss card on Today;
  lists and forms stay at 780px; a receipt at 600px.
- **640px and up:** sheets become centred dialogs over a blurred, full-window
  backdrop (`app-overlay`); the camera becomes a centred panel.
- Nothing loops unless it is live: no drifting grounds, spinning rings or
  bobbing cats.
- Hover feedback on rows and a visible focus ring only where a pointer or
  keyboard is in use.
- No horizontal page scroll at any width; carousels scroll inside their row.
- Respect `prefers-reduced-motion`: motion becomes a still state, never a
  skipped one.
- Touch targets at least 44px.

## 9. Agent prompt guide

When building a screen for Cotab:

1. Read the tokens in `glass.css`; use `var(--...)` or an existing class.
2. Decide the one hero number and the one action first.
3. Build lists as rows inside one glass panel.
4. Pick Tabby's mood from the state, with `tabbyArt()`.
5. Write plain, short copy. Money says whose it is ("owed to you", "yours").
6. Check day and night at 320–430px, then run
   `npx prettier --check src tests && npx tsc --noEmit && npx next lint && npx vitest run`.
