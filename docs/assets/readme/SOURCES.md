# README art: where every part comes from

| File | What it is | Made by |
| --- | --- | --- |
| `banner.jpg` | 1600 × 600 banner | z-image-turbo background + HTML type, see below |
| `architecture-light.png`, `architecture-dark.png` | how the pieces fit together | [`render.mjs`](render.mjs) |
| `launch-light.png`, `launch-dark.png` | one launch transaction and the fee split | [`render.mjs`](render.mjs) |
| `icons/*.svg` | icons in the README grids | [`render.mjs`](render.mjs), from Lucide |

## Diagrams and icons: `render.mjs`

```bash
node docs/assets/readme/render.mjs
```

Every word in the diagrams is set in HTML with the site's own fonts and rendered by Playwright at 2× on a transparent background. Each diagram comes in a light and a dark variant, and the README shows the one that matches the reader's GitHub theme through `<picture>`. The PNGs are palette-compressed with sharp when it is installed.

Before a file is written, the script checks the rendered page and stops on any finding: a box that overlaps another or leaves the canvas, text wider than its card, a connector that runs through a box, a font that did not load, or text below 4.5:1 contrast against what is behind it. A negative control (a deliberately long line, a misplaced label, a connector through a card, a faded text colour) was run once to confirm that each check fires.

The diagrams only draw. The facts in them (the versions, five chains, 14 MCP tools, the 1.00% split) come from the README, which reads them from chain. If a fact changes, change the README first, then the drawing.

Icons are [Lucide](https://lucide.dev) 0.468.0, read from the installed `lucide-react` package, ISC License, © Lucide Contributors. The chain marks come from [`public/brand/`](../../../public/brand/), with their origins and licences in [`public/brand/SOURCES.txt`](../../../public/brand/SOURCES.txt). They are trademarks of their owners and appear only to name the chains ADEXTO is deployed on.

## Banner: `banner.jpg`

1600 × 600, JPEG quality 88 (mozjpeg, 4:4:4), made on 2026-10-04 in two steps.

### 1. Background plate: z-image-turbo on the 0G Compute router

- Endpoint: `POST https://router-api.0g.ai/v1/images/generations`
- Model: `z-image-turbo`, `size` `1536x640`, `n` 2, `response_format` `b64_json`
- Generated at `2026-10-04T01:13:49Z`. The second of the two images was used.
- Plate SHA-256: `f3bbedfeb971b903c134c6dca681a6f9d764389e4c5abf8a33b4c5ae3adfdea0`
- Prompt, verbatim:

> Cinematic film still, a vast dark obsidian plain at night under a black sky, crossed by thin glowing violet light filaments that branch and connect like a network of routes, converging toward a soft bright violet glow on the far right of the frame. Low camera angle, wide panoramic anamorphic composition, the left two thirds of the frame dark and nearly empty to leave space for a title, volumetric haze, fine floating particles, deep black and violet palette with faint warm amber highlights, film grain. No text, no letters, no numbers, no logos, no watermark.

The model was asked for no text, and the plate carries none: OCR (tesseract.js 5.1.1, `eng`, on the raw, contrast-boosted and inverted plate) found no word at confidence 60 or above. Every word in the banner is set in HTML, because a model that draws letters gets them wrong.

### 2. Type and marks: HTML rendered by Playwright

The plate is scaled to cover the frame, anchored right, lifted with `brightness(1.35) saturate(1.12) contrast(1.05)`, and darkened from the left by a gradient so the copy reads on any part of it. The page was rendered by Playwright 1.62.1 (Chromium) at 1600 × 600 and device scale 1.

| Element | Source |
| --- | --- |
| ADEXTO mark | [`public/logo.svg`](../../../public/logo.svg), ink recoloured from `#141110` to white for the dark plate |
| Display type | Bricolage Grotesque, [`src/app/fonts/BricolageGrotesque-Variable.woff2`](../../../src/app/fonts/BricolageGrotesque-Variable.woff2) |
| Text type | Inter, [`src/app/fonts/Inter-Variable.woff2`](../../../src/app/fonts/Inter-Variable.woff2) |
| Chain marks | `monad.svg`, `arbitrum.svg`, `robinhood.svg`, `base.svg` and `0g-token.png` from [`public/brand/`](../../../public/brand/), used unchanged |

The chain order (Monad, Arbitrum One, Robinhood Chain, Base, 0G) is the site's own order.

### Checked without looking at it

- OCR of the finished banner reads every word set in it: the wordmark, `MCP · x402 · ERC-8004`, the headline, the sub-line, `LIVE ON`, the five chain names and `adexto.xyz`.
- Contrast, measured on the background behind each text box with the text hidden (95th-percentile pixel): 8.2:1 for the smallest violet label, 12.0:1 or more for everything else (WCAG AA asks 4.5:1).
- No text box overlaps another, and nothing leaves the frame.

Contrast numbers are a measurement, not an accessibility audit. The `alt` text of every image in the README carries the same words.
