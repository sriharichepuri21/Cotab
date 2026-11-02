# Cotab design system

How Cotab looks and feels, for anyone (or any agent) building UI here. The
values below are the real ones: tokens live at the top of
`frontend/src/styles/glass.css`, the landing page in `landing.css`. When this file and the code disagree, the code wins and
this file gets fixed.

## 1. Visual theme and atmosphere

**Tabby on moss glass.** A calm, warm money app with a knitted friend in it.

- **Studio (day, default):** crisp white panels on `#f5f6f4`, framed by the same
  dark side column and dark wave scene as night, so day keeps night's depth.
- **Night:** the same waves, lightly veiled, on deep green-black (`#0b120f`).
- **Tabby** (the knitted mint character, `public/tabby`) is the personality. Tabby reacts
  to the money and never decorates. One cat per screen, at most.
- **Restraint:** one hero number per screen, set large and light. Everything
  else supports it.
- Not: neon fintech, glass over photographs, gradients or glows for their own sake.

## 2. Colour palette and roles

Use tokens, never hex in components. Both themes set the same names. In
components, use the classes: `text-glass-ink`, `text-glass-ink2`,
`text-glass-soft`, `text-glass-pos`, `text-glass-neg`, `text-glass-warn`,
`glass-cta`, `glass-surface`, `glass-tint`, `glass-tint-pos|neg|warn`,
`glass-inverse`, `glass-danger`.

The brand's mint artwork sets the palette: `#a9dcc6` and `#2f8a68`, with `#1f6f55`
for actions and `#12261a` as ink. Every neutral carries a little of that mint, so
greys never read as stock greys.

| Token                | Night                | Day                   | Role                                     |
| -------------------- | -------------------- | --------------------- | ---------------------------------------- |
| `--bg`               | `#0b120f`            | `#f5f6f4`             | Ground below the scene                   |
| `--ink`              | `#ececec`            | `#12261a`             | Primary text, hero figures               |
| `--ink-2`, `--ink-3` | ink at 80%, 62%      | ink at 76%, `#566b61` | Body text, secondary notes               |
| `--pos`              | `#a9dcc6`            | `#1f6f55`             | Owed to you, on pace, done               |
| `--neg`, `--warn`    | `#f0a493`, `#e3d18a` | `#a2493a`, `#7c6418`  | Status only: over budget, needs checking |
| `--lime`             | `#a8cba6`            | same                  | Accent; the name is historical           |
| `--cta-bg`           | `#a9dcc6`            | `#0f2a1e`             | The one primary action                   |
| `--surf`             | `#131b17`            | `#ffffff`             | Every card                               |
| `--hair`, `--track`  | white 10%            | ink 8–9%              | Dividers, progress tracks                |

Rules:

- Red means **you must act**. Nothing settled, zero or informational is red.
- The primary action is the only solid. At most one per view.
- Category tints (rent, groceries, dining...) are soft tiles behind a line
  icon, never fills behind text.

## 3. Typography

- **DM Sans** for everything in the app, with in-between weights: 420 for text,
  480 for titles and figures.
- **Display figures** (the hero number) at weight 500, large, tracking about
  -0.035em. Cents are raised and small (`Raised` in `parts.tsx`), a little less so in rows.
- **Labels** are sentence case with no tracking: `Safe to spend`. No uppercase
  kickers, no italics.
- Money is always tabular and in the account's currency; never add
  currencies together.
- Sizes in use: 44px for the one answer figure (36px on phones), 24px page
  titles, 22px tile figures, 15px section titles, 14px names and amounts, 13px
  notes. The contrast between the top figure and body text is what sets the hierarchy.

## 4. Component styling

- **Panel:** solid `--surf` fill with a `--sh` hairline, radius 14px. Lists
  sit inside one panel with hairline dividers, not one card per row.
- **Accent:** `--bright` marks live data and the one active control: budget bars,
  the 30-day line, a ready send button.
- **Art:** `wave-scene` behind Today, `wave-hero` in slim cards, blurred `wave-side` at
  the foot of the side column. Only a side-to-side veil for text; never flatten the glow.
- **Outside the app:** sign-in, onboarding, the splash and share links use the same
  waves, with one crisp panel for forms. Shared components take the `--c-*` tokens,
  which follow the theme because `<html data-theme>` is set before first paint.
- **The scene:** Today opens on the mint waves: frosted pills, the dark ticket, and
  Tabby standing on a glass panel. Other screens open on a slim wave card. Icons are
  thin line (weight 300), filled only when active.
- **Stats** that belong together share one frame with hairlines between them.
- **Ticket:** the home ticket stays deep green on the waves; receipts and tabs read as paper tickets: a dashed tear line
  and half-circle notches at the sides, zigzag bottom on a receipt.
- **Buttons:** pills. Primary = `--cta-bg`; secondary = glass with
  `--sh-soft`; destructive = a text link in `--neg`, placed last.
- **Rows:** 38px neutral category tile (line icon, radius 10), name and note on the
  left, amount right. Show "yours" only when it differs from the total.
- **Bottom bar:** flat, full width, a hairline on top, five slots with Scan in
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
- Rhythm: 8 / 16 between elements, 24 between sections, 16–18 inside panels.
- Radii: 10 tiles, 14 panels, pill for buttons and chips.
- Screen heroes are slim: 18px line, 13px note, a 40px Tabby. Only the ticket
  carries a larger figure. Rows are about 60px, with 4px progress bars.
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

Three levels only: the ground, panels, and the floating layer (sheets, the
scanner). Depth comes from a hairline, never from shadows, glossy rims or glows.
Glass (blur plus a light hairline) is only for what floats on the waves. There is one card. Every panel takes `--surf`, the `--sh-soft` edge and a 14px
corner from one rule in `studio.css`; only the home ticket differs. `finish.css`
loads last and holds the type scale, spacing and control styles. Day: white cards
on off-white. Night: `#171717` cards on `#0d0d0d`. Green marks data and active items.
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
