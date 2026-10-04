# README banner: where every part comes from

`banner.jpg` is 1600 × 600, JPEG quality 88 (mozjpeg, 4:4:4), made on 2026-10-04 in two steps.

## 1. Background plate: z-image-turbo on the 0G Compute router

- Endpoint: `POST https://router-api.0g.ai/v1/images/generations`
- Model: `z-image-turbo`, `size` `1536x640`, `n` 2, `response_format` `b64_json`
- Generated at `2026-10-04T01:13:49Z`. The second of the two images was used.
- Plate SHA-256: `f3bbedfeb971b903c134c6dca681a6f9d764389e4c5abf8a33b4c5ae3adfdea0`
- Prompt, verbatim:

> Cinematic film still, a vast dark obsidian plain at night under a black sky, crossed by thin glowing violet light filaments that branch and connect like a network of routes, converging toward a soft bright violet glow on the far right of the frame. Low camera angle, wide panoramic anamorphic composition, the left two thirds of the frame dark and nearly empty to leave space for a title, volumetric haze, fine floating particles, deep black and violet palette with faint warm amber highlights, film grain. No text, no letters, no numbers, no logos, no watermark.

The model was asked for no text, and the plate carries none: OCR (tesseract.js 5.1.1, `eng`, on the raw, contrast-boosted and inverted plate) found no word at confidence 60 or above. Every word in the banner is set in HTML, because a model that draws letters gets them wrong.

## 2. Type and marks: HTML rendered by Playwright

The plate is scaled to cover the frame, anchored right, lifted with `brightness(1.35) saturate(1.12) contrast(1.05)`, and darkened from the left by a gradient so the copy reads on any part of it. The page was rendered by Playwright 1.62.1 (Chromium) at 1600 × 600 and device scale 1.

| Element | Source |
| --- | --- |
| ADEXTO mark | [`public/logo.svg`](../../../public/logo.svg), ink recoloured from `#141110` to white for the dark plate |
| Display type | Bricolage Grotesque, [`src/app/fonts/BricolageGrotesque-Variable.woff2`](../../../src/app/fonts/BricolageGrotesque-Variable.woff2) |
| Text type | Inter, [`src/app/fonts/Inter-Variable.woff2`](../../../src/app/fonts/Inter-Variable.woff2) |
| Chain marks | [`public/brand/`](../../../public/brand/): `monad.svg`, `arbitrum.svg`, `robinhood.svg`, `base.svg` and `0g-token.png`, used unchanged. Their origins and licences are in [`public/brand/SOURCES.txt`](../../../public/brand/SOURCES.txt). They are trademarks of their owners and appear only to name the chains ADEXTO is deployed on |

The chain order (Monad, Arbitrum One, Robinhood Chain, Base, 0G) is the site's own order.

## Checked without looking at it

- OCR of the finished banner reads every word set in it: the wordmark, `MCP · x402 · ERC-8004`, the headline, the sub-line, `LIVE ON`, the five chain names and `adexto.xyz`.
- Contrast, measured on the background behind each text box with the text hidden (95th-percentile pixel): 8.2:1 for the smallest violet label, 12.0:1 or more for everything else (WCAG AA asks 4.5:1).
- No text box overlaps another, and nothing leaves the frame.

Contrast numbers are a measurement, not an accessibility audit. The banner's `alt` text in the README carries the same words.
