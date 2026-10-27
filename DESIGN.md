# Cotab design system

How Cotab looks and feels, for anyone (or any agent) building UI here. The
values below are the real ones: tokens live at the top of
`frontend/src/styles/glass.css`, the landing page in `landing.css` and
`landing-moss.css`. When this file and the code disagree, the code wins and
this file gets fixed.

## 1. Visual theme and atmosphere

**Tabby on moss glass.** A calm, warm money app with a cat in it.

- **Moss (night, default):** a soft-focus olive field (`#1d2411`) that drifts
  slowly behind everything, frosted glass panels on top, cream for the one
  thing to press.
- **Mist (day):** the same system in pale sage (`#dde3cf`) with dark olive ink.
- **Tabby** (the cat, V3 stock art) is the personality. He reacts to the
  money, he never decorates. One cat per screen, at most.
- **Restraint:** one hero number per screen, set large and light. Everything
  else supports it.
- Not: neon fintech, all-black OLED, glass over photographs, gradients for
  their own sake.

## 2. Colour palette and roles

Use tokens, never hex in components. Both themes set the same names.

| Token | Night | Day | Role |
|---|---|---|---|
| `--bg` | `#1d2411` | `#dde3cf` | Page ground under the moss gradient |
| `--ink` | `#f4f6ea` | `#1f2814` | Primary text, hero figures |
| `--ink-2` | ink at 86% | ink at 80% | Body text |
| `--ink-3` | ink at 64% | ink at 60% | Secondary notes, meta |
| `--pos` / `--pos-bg` | `#cfe3a6` | `#44592b` | Owed to you, on pace, done |
| `--neg` / `--neg-bg` | `#f2b2a4` | `#9a4b3e` | You owe, over budget, delete |
| `--warn` / `--warn-bg` | `#e6d79a` | `#6f5f1d` | Close to a limit, needs checking |
| `--lime` | `#d6e496` | same | Accent: the active tick, highlights |
| `--cta-bg` / `--cta-ink` | cream on olive ink | olive with cream ink | The one primary action |
| `--surf`, `--surf-strong` | white 4–13% over olive | white 26–58% | Glass panels |
| `--hair`, `--track` | white 10% | ink 9–10% | Dividers, progress tracks |

Rules:
- Red means **you must act**. Nothing settled, zero or informational is red.
- The cream CTA is the only solid. At most one per view.
- Category tints (rent, groceries, dining...) are soft tiles behind a line
  icon, never fills behind text.

## 3. Typography

- **Urbanist** (variable) for everything. Body at weight 500.
- **Display figures** (the hero number) at weight 200–300, large, tight
  tracking (about -0.04em). Cents can sit smaller beside the dollars
  (`$495`<sub>`87`</sub>).
- **Doto** (dot matrix), uppercase with wide tracking, only for small kickers
  and meta: `SAFE TO SPEND`, `OCTOBER · $1,904.13 YOURS`. Never for numbers
  people need to read precisely, never for sentences.
- Money is always tabular and in the account's currency; never add
  currencies together.
- Sizes in use: 34–56px hero, 19–20px section titles, 15px rows, 12px
  secondary, 10–11px kickers.

## 4. Component styling

- **Glass panel:** `--surf` fill, `--blur` backdrop, `--sh` (a bright top
  inner rim plus a long soft drop), radius 22px. Lists sit inside one panel
  with hairline dividers, not one card per row.
- **Ticket:** receipts and tabs read as paper tickets: a dashed tear line
  and half-circle notches at the sides, zigzag bottom on a receipt.
- **Buttons:** pills. Primary = cream `--cta-bg`; secondary = glass with
  `--sh-soft`; destructive = a text link in `--neg`, placed last.
- **Rows:** 44px category tile (line icon, radius 14), name and note on the
  left, amount right. Show "yours" only when it differs from the total.
- **Bottom bar:** floating glass pill, five slots, the scan button raised in
  the middle in cream. Keeps its original icons.
- **Tabby:** `tabbyArt(mood, 256 | 640)` from `lib/tabby.ts`, never the
  1.8MB PNGs. Keep proportions; never inside an oval or on a coloured disc
  other than the avatar circle.
- **Splash:** `AppSplash`, the glass mark closing its c, then the word. Plays
  once per fresh load (website or app), 1.7s, 0.9s still with reduced motion.

## 5. Layout principles

- 16px page gutters on phones; every row and carousel aligns to them
  (carousels use `scroll-padding-inline: 1rem`).
- 8pt rhythm: 8 / 12 / 16 / 24 between elements, 24–32 between sections.
- Radii: 14 tiles, 18 inner cards, 22 panels, pill for buttons and chips.
- Order on a screen: kicker, hero figure, the one decision, then lists.
- Empty sections collapse to one quiet line ("Every receipt is checked.").

## 6. Depth and elevation

Three levels only: the moss ground, glass panels, and the floating layer
(bottom bar, sheets, the scan button). Depth comes from the inner top rim and
a long, low-opacity drop shadow, never from dark hard shadows or borders.
Blur only on panels and fixed layers, never on scrolling content inside them.

## 7. Do's and don'ts

Do:
- Lead each screen with one number and say what it means in plain words.
- Let Tabby's mood carry the state (cool, hmm, over-budget).
- Make every action undoable or confirmed, and say what happened.
- Check both themes at 320, 375, 390 and 430px.

Don't:
- Hard-code colours (`text-[#77776f]`); use a token.
- Repeat the hero number in a second card on the same screen.
- Explain the UI in copy ("Tabby reacts to net balances").
- Use red for zero, settled or neutral states.
- Ship images over ~100KB to a phone.

## 8. Responsive behaviour

- Built phone-first. At 768px and up the app is a centred phone column on
  the moss field; a two-column desktop layout is planned (see the audit).
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
