# Snapchat Web Lens build

This repo ships **two** builds from one source tree:

| Build | Command | Output | Target |
|---|---|---|---|
| Web / desktop | `npm run build` | `dist/` | Any browser, desktop 16:9 |
| Snapchat Web Lens | `npm run snap` | `release/santas-sleigh-run-web-v1.zip` | Snapchat mobile, portrait only |

The Snap build is a separate Vite config (`vite.config.snap.js`) so it never
touches `dist/` or the desktop layout.

## Publish

```
npm run snap          # build the Lens bundle + pack the zip
npm run verify:snap   # optional: boot it at 390x844 in headless Chrome
```

Upload `release/santas-sleigh-run-web-v1.zip` at
[My Lenses](https://my-lenses.snapchat.com/) → new Lens → **Web Lens**.

Bump the version in `tools/pack.mjs` (`OUT_ZIP`) for each submission, e.g.
`-v2.zip`. Every upload goes through review again, so batch changes.

## What the pipeline enforces

`tools/pack.mjs` writes the zip itself (no archiver dependency) and refuses to
produce a file that breaks a platform rule:

| Snapchat requirement | How it is met |
|---|---|
| `index.html` at the zip root | Files are added relative to the build folder, not the folder itself |
| Relative asset paths | `base: './'`; every JS asset goes through `assetUrl()` (`src/utils/assetUrl.js`) |
| Forward-slash zip entries | Paths are normalised with `/` and the packer rejects backslashes |
| Zip ≤ 8 MB | Currently **6.4 MB**; the packer exits non-zero above the limit |
| `index.html` ≤ 1 MB | Currently **2.3 KB** |

`npm run verify:snap` loads the packed folder at 390×844 and fails on console
errors, page errors, failed requests, external requests, a missing HUD, a dead
joystick or an unloaded font.

## Runtime changes made for the Lens

Snapchat serves the Lens from a URL it controls, inside a locked-down webview:

- **No external resources.** Google Fonts would be blocked, so all five families
  are self-hosted in `src/fonts/` (`npm run fonts` re-downloads them) and loaded
  from `src/fonts/fonts.css`.
- **No absolute paths.** `/audio/...` and `/assets/...` would resolve against
  Snapchat's origin. All references now use `import.meta.env.BASE_URL`.
- **Background handling.** `visibilitychange` suspends audio, resumes on return
  and discards the hidden time gap; the frame delta is clamped to 100 ms so a
  backgrounded webview cannot teleport the sleigh or drain the timer.
- **Touch input.** Pointer events, `touch-action: none`, `overscroll-behavior:
  none`, and a suppressed context menu (long-press).
- **Safe areas.** The HUD already routes `env(safe-area-inset-*)`; verified at a
  simulated 120 px top inset, which is the size Snapchat's own controls need.
- **Storage.** `localStorage` works per session but is wiped when the Lens closes,
  so the audio toggle is guarded and simply won't persist across launches.

## Still required before upload (not part of the zip)

- **Lens icon** — 512×512 PNG, subject centred inside ~80% of the inscribed
  circle, full-bleed background, no transparency, no text.
- **Preview video** — 720×1280, 5 seconds, H.264 + AAC in MP4, 30 fps, `faststart`.
  Show the peak of the loop, not the main menu.

Both are uploaded separately from the zip.

## Legacy note

`release/santas-sleigh-run-web.zip` is the earlier web bundle. It still works
served from a web root, but its absolute `/assets/...` paths and remote Google
Fonts mean it cannot run as a Lens. Submit only
`release/santas-sleigh-run-web-v1.zip`.
