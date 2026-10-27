# Cotab logo pack · mark B ("Two halves") · v1.1

A c and an o woven through each other. The gap in the c is an open tab; it closes when the tab is settled.
v1.1: the mark is now as tall as the word (ascender to baseline) and shares its centre line in every lockup.

## What is in here

| Folder | What | Use it for |
|---|---|---|
| `01-svg/mark` | Glass mark (dark and light grounds, open and "settled"), flat marks in ink, moss, cream, white, black, sage | Web, product, print (flat) |
| `01-svg/lockup` | Horizontal and stacked lockups, glass and flat. The word "cotab" is outlines, no font needed | Headers, decks, documents |
| `01-svg/animated` | Self-animating SVGs: loader (loops), intro (draws in once) | Web, no video needed |
| `01-svg/icon` | `favicon.svg` (switches colour for light and dark tabs) | Browsers |
| `02-png/transparent` | Marks and lockups on transparent backgrounds, many sizes | Anywhere you need a PNG |
| `02-png/with-background` | Marks and lockups on moss, mist, cream, ink and sage | Presentations, quick posts |
| `03-app-icons` | iOS (1024 + every size), Android (adaptive foreground, background, monochrome, legacy, Play Store), PWA, Apple touch, favicons + `favicon.ico` | App stores, the web app |
| `04-social` | Open Graph (dark and light), Twitter/X header, LinkedIn and YouTube banners, avatars | Social media |
| `05-animation` | Loader, intro, intro with wordmark, settle, idle. Transparent WebM / WebP / APNG for dark and light UIs; MP4 / WebP / GIF on moss and mist | Splash screens, loading states, video, web |
| `06-guidelines` | `Cotab-Logo-Guidelines.pdf`, colour tokens (JSON and CSS) | Everyone |

## Which file do I use?

* Dark or mid-green background: **glass** (`...-glass-on-dark`, `mark-glass`).
* Light background: **glass deep** (`...-glass-on-light`, `mark-glass-deep`).
* On a photo, in print, or below 48 px: **flat**.
* Browser tab: `favicon.svg`, then `favicon.ico`.
* Static logo: always the open c. Use the closed ("settled") mark only for the moment a tab is settled.

## Animations

| Name | Length | Behaviour |
|---|---|---|
| loader | 2.4 s, loops | The c closes, holds, opens again |
| intro | 3.4 s, once | The o draws in, then the c, then the c closes once and reopens |
| intro-lockup | 4.2 s, once | The intro, then "cotab" slides in |
| settle | 1.6 s, once | The c closes and a ripple leaves the crossing |
| idle | 4 s, loops | A slow float and a 2 degree tilt |

`transparent-dark` is for dark interfaces, `transparent-light` for light ones. WebM has real transparency in Chrome, Edge and Firefox; in Safari use the WebP or APNG. With reduced motion on, show the still logo.

## Notes

* The glass look uses SVG lighting filters. Browsers render it fully; Figma, Illustrator and Sketch may not, so use the PNGs or the flat SVGs there.
* Colours: `06-guidelines/cotab-colors.css` and `cotab-brand-tokens.json`.
* Wordmark: Outfit Bold, -4% tracking, outlined in every file.
* This logo is already in the Cotab web app (`frontend/src/components/CotabLogo.tsx`).

## In this repository

This folder is the Cotab logo pack (v1.1), checked in so the brand files live with the code.
Left out to keep the repo light: the animated WebP and APNG files (the WebM, MP4 and GIF
versions are here) and the 2048 px PNGs. Both are rebuilt by the scripts in `source/`:

* `source/logo.py` is the single source of the mark's geometry, colours and wordmark outlines.
  The app's React version is `frontend/src/components/CotabLogo.tsx`; change the geometry in
  both places together.
* `build_static.py` makes the SVGs and the render job list, `render.cjs` renders PNGs with
  Playwright, `anim.py` / `build_anim.py` / `build_svg_anim.py` / `encode.py` make the animations,
  and `build_guide.py` + `pdf.cjs` make the guidelines PDF.
* The scripts expect Python with `fonttools` and Node with Playwright, the Outfit font from
  `@fontsource/outfit`, and paths under `/tmp/claude-0/`: edit the paths at the top before running.
