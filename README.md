# Pointer Pointer 2.0

A local, instant version of pointerpointer.com: move your mouse and a photo of
someone pointing at your pointer appears. Each photo is shown whole and static, fitted inside the window.

## Run it

[Click here to try it on github](https://doranchak.github.io/pointer-pointer-2.0).

Or:

Open `index.html` in a browser. It works straight from disk (no server needed). Or, if you prefer:

```
python3 -m http.server 8000     # then visit http://localhost:8000/
```

The original version can be seen here: [pointerpointer.com](https://pointerpointer.com/)

## Files

| File | What it is |
|---|---|
| `index.html`, `app.js` | The new app (vanilla JS, no dependencies, no analytics or ads) |
| `positions.json` | Original data: `[x, y]` for each photo, as fractions of the photo's width/height |
| `positions.js` | Same data wrapped as `window.PP_POSITIONS = [...]`, because browsers block `fetch()` of `.json` over `file://` |
| `images/0.jpg` … `images/710.jpg` | All 711 photos the original uses (1024×768 JPEG, ~53 MB total) |
| `cursor.png` | The original's fake cursor, drawn on touch screens |
| `Pointer Pointer.html`, `Pointer Pointer_files/` | Your untouched saved copy of the original |

To regenerate `positions.js` after editing `positions.json`, wrap the array as `window.PP_POSITIONS = <json>;`.

## How the original works (read from its saved JS)

1. Fetches `/new-positions.json` (711 points). Photo *i* is `/images/i.jpg`.
2. **Waits until the pointer has been still for 2 s** (a debounce). Until then it shows a black "Finding pointer…" screen.
3. Picks the photo whose point is nearest the pointer (linear scan, skipping the last 4 photos shown), then fetches that
   one photo over the network, which is where most of the delay and flashing comes from.
4. Shifts the photo so the point lands exactly on the pointer, zooms it 1.2× about that point, and puts a blurred copy behind it.

The stored point is where each finger is *aiming*, a little beyond the fingertip, which is why the finger appears to
point at your cursor rather than touch it.

## What changed

- **Everything is preloaded.** All 711 photos start loading on page load (8 at a time) and are held in memory. They load in
  "farthest-point-first" order, so even before loading finishes there is a photo near every part of the screen; the
  match gets better as the rest arrive. A small counter shows progress and fades away. Locally this takes well under a second.
- **Instant response.** No 2 s wait. The nearest photo is chosen as soon as you move.
- **Each photo is shown whole and static**, fitted inside the window (like CSS `object-fit: contain`) and centred. It is
  *not* zoomed or dragged to follow the pointer, so nothing moves while you stay within one photo's zone; the picture only
  changes when another photo becomes the closest. If the window's shape differs from the photo's 4:3, the leftover bars are
  filled with a blurred copy of the photo.
- **Closest = nearest on-screen target.** The photo chosen is the one whose aimed-at spot, as laid out in the window, is nearest
  your pointer (measured in screen pixels). The pointer can be in the bars too; the nearest photo is still picked.
- **Never black.** A photo is on screen from the first moment, before you touch anything. Photos are drawn to a `<canvas>`,
  and the previous photo stays until the next one is drawn, so there is no frame without an image.
- **No flicker at borders.** The app only abandons the current photo if another is at least 12 px closer. (The original's
  "skip the last 4" rule would make photos flicker under continuous tracking, so it is gone: the same spot now gives the same
  photo each time.)

**Accuracy trade-off.** Because photos are no longer shifted, the finger points at the *closest available* spot rather than exactly
at your pointer. With 711 photos, measured over every point of the window (nearest photo, no flicker margin):

| Window | Median miss | 90th percentile | Worst |
|---|---|---|---|
| 1273×911 | 25 px | 79 px | 268 px |
| 1440×900 | 29 px | 120 px | 294 px |
| 1920×1080 | 41 px | 208 px | 405 px |
| 390×844 (phone) | 83 px | 247 px | 314 px |

Misses are largest near the corners and, on wide windows, in the side bars, because few photos aim there. (The shifted-and-zoomed
approach hides this by sliding the photo until the finger is exactly on the pointer; it is easy to bring back if you prefer.)

Measured in headless Chrome (1273×911): 711 photos preloaded in ~0.5 s from disk; a 900-event pointer sweep produced 184 photo
switches and no blank frame; the fitted rectangle was pixel-exact in 1273×911, 1920×1080 and 500×900 windows; moving within one
photo's zone left the canvas pixel-identical; and a photo that had never been drawn cost a median ~4 ms (worst ~8 ms) for its first
draw, well under a 16 ms frame, so photos are *not* pre-decoded (that cost ~400 MB of extra browser memory for no visible gain).
Memory (browser process tree, measured against a blank headless Chrome): about +120 MB for holding the preloaded photos, and about
+170 MB more after sweeping the pointer everywhere.

Touch screens: dragging a finger acts as the pointer and the original's fake cursor is drawn under it.

## Research: has this been done before?

Short answer: the original is the one famous instance, and a few people have made faster variants of it. I found nothing
that preloads and also never blanks the screen the way this version does, but I only searched the public web and
GitHub and could not read every page (see caveats).

**Origin**
- Made in 2012 by the Amsterdam studio **Moniker** (Jonathan Puckey, Luna Maurer, Roel Wouters), per
  [IDFA's archive entry](https://www.idfa.nl/en/film/e8a7a0a5-cb4f-438d-a5ac-2c0efe0388a4/pointer-pointer/) as relayed by
  [this 2026 write-up](https://webiano.digital/pointer-pointer-turns-your-cursor-into-the-punchline/) and by search summaries of a
  Fast Company article (which I couldn't open). The [2012 Hacker News thread](https://news.ycombinator.com/item?id=4095237)
  (June 11, 2012, 367 points) doesn't name the makers.
- It reuses a technique from the same people's earlier **[Flitser.org](https://www.dutchdesignawards.nl/en/gallery/flitser-org/)**
  ([It's Nice That](https://www.itsnicethat.com/articles/roel-wouters-and-jonathan-puckey-flitser)), where a light follows your
  cursor through thousands of user-submitted flash photos. Search summaries say the nearest-photo lookup was a Voronoi grid
  built for speed; HN commenters in 2012 said the same and linked a `gridPositions.json` (they counted ~900 photos; today's file has 711).
- **The delay was deliberate.** Per the IDFA entry (via the write-up above) and the creators' quotes reported in press, the pause
  was designed to make you hold still and pay attention. So "instant" is a different experience from the one they designed.

**Similar or derived work**
- **[KraXen72/pointerpointer-min-distance](https://github.com/KraXen72/pointerpointer-min-distance)** (2022): "pointerpointer but
  fast/instant". Brute-force nearest point on every mousemove, using the same positions data and downloaded images. Per its code it
  does *not* preload (it swaps `img.src` on each move), so each new photo is still fetched on demand.
- A **console snippet** posted in the [2025 HN re-post](https://hn.svelte.dev/item/45526845) removes the delay on the live site, and
  one commenter notes it reuses images by translating them slightly. The same thread mentions **ZeigerPointer** by monochrom.at (a
  collection of such images; I couldn't confirm it) and a Paul Irish video explaining the original.
- [codeadamca/deconstruction-pointer](https://awesome.ecosyste.ms/projects/github.com%2Fcodeadamca%2Fdeconstruction-pointer): a
  work-in-progress teardown of the site (listed in search results; I couldn't open it).
- A [Observable notebook](https://observablehq.com/@theabbie/pointerpointer-points-to-your-pointer) by theabbie also exists (rate-limited; unread).
- Same family, different trick: [White Glove Tracking](https://www.whiteglovetracking.com/) (2007, Evan Roth and Ben Engebreth)
  crowdsourced the position of Michael Jackson's glove in every video frame; it's a similar "label positions, then look them up" data
  idea but has no cursor interaction. "Eyes follow your cursor" widgets (e.g. Framer's Eye Contact component) swap among a few
  photos of one face looking in different directions, the same lookup idea at tiny scale.
- Traffic-similarity lists put [thatsthefinger.com](https://thatsthefinger.com/), whalefollowmouse.com, paint.toys, clicking.toys and
  theuselessweb.com near Pointer Pointer; these share the "pointless web toy" genre, not the technique (I could only confirm
  thatsthefinger.com is a finger novelty page).

**Caveats:** the Fast Company, Observable and ecosyste.ms pages blocked automated fetching, so claims attributed to them come from search
summaries. HN comments are commenters' claims, not established facts.
