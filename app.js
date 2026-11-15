/*
 * Pointer Pointer 2.0
 *
 * Same idea as pointerpointer.com: every photo has a person pointing at some spot. We show the photo whose
 * pointed-at spot is closest to your pointer. Each photo is shown whole and static, fitted inside the window.
 * (The original zooms the photo and drags it so the finger lands exactly on the pointer; this version doesn't.)
 *
 * What's different from the original:
 *   1. All photos are preloaded up front, so moving the pointer switches photos immediately instead of waiting
 *      2 s and then fetching one over the network. (Decoding a 1024x768 JPEG on first draw measured ~3.5 ms,
 *      well inside a 16 ms frame, so we deliberately don't pre-decode: doing so made the browser hold ~400 MB
 *      of extra decoded bitmaps for no visible gain.)
 *   2. The screen is never blanked. The previous photo stays up until the next one is drawn, and a blurred
 *      copy of the photo fills the bars beside/above it, so there is never a black screen.
 */
(() => {
  'use strict';

  const POS = window.PP_POSITIONS;            // POS[i] = [x, y] spot photo i points at, as fractions 0..1
  const N = POS.length;
  const imageUrl = i => `images/${i}.jpg`;

  const SWITCH_MARGIN_PX = 12; // only abandon the current photo if another is this many px closer (no flicker)
  const CONCURRENCY = 8;       // simultaneous image requests while preloading
  const BG_DOWNSCALE = 6;      // the blurred backdrop is drawn at 1/6 size; the blur hides the upscale
  const hasHover = matchMedia('(any-hover: hover)').matches;

  const $ = id => document.getElementById(id);
  const fgCanvas = $('fg'), bgCanvas = $('bg');
  const fg = fgCanvas.getContext('2d'), bg = bgCanvas.getContext('2d');
  const cursorEl = $('cursor'), hud = $('hud'), hint = $('hint'), progress = $('progress');

  // ---- state --------------------------------------------------------------------------------------------
  const images = new Array(N);      // HTMLImageElement per photo (kept referenced => stays in memory)
  const ready = new Uint8Array(N);  // 1 once photo i has loaded successfully
  let readyCount = 0, settledCount = 0;

  const view = { w: 0, h: 0, dpr: 1 };
  const pointer = { x: 0, y: 0, active: false };
  let current = -1;                 // photo we want on screen
  let drawn = -1;                   // photo actually painted on the canvases right now
  let sizeDirty = true, pointerDirty = true, frameQueued = false;

  // ---- geometry -----------------------------------------------------------------------------------------
  // Fit the whole photo inside the window, centred ("contain"). Returns the on-screen rectangle.
  function fitRect(img) {
    const k = Math.min(view.w / img.naturalWidth, view.h / img.naturalHeight);
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    return { left: (view.w - w) / 2, top: (view.h - h) / 2, w, h };
  }

  // Squared distance (px) from (x, y) to the spot photo i points at, as it is laid out on screen.
  function missSq(i, x, y) {
    const img = images[i];
    const k = Math.min(view.w / img.naturalWidth, view.h / img.naturalHeight);
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    const dx = (view.w - w) / 2 + POS[i][0] * w - x;
    const dy = (view.h - h) / 2 + POS[i][1] * h - y;
    return dx * dx + dy * dy;
  }

  // Brute force over a few hundred points is microseconds, so no spatial index is needed.
  function nearestReady(x, y) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < N; i++) {
      if (!ready[i]) continue;
      const d = missSq(i, x, y);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // ---- choosing the photo -------------------------------------------------------------------------------
  function choose() {
    const x = pointer.active ? pointer.x : view.w / 2;   // before the first move, point at the centre
    const y = pointer.active ? pointer.y : view.h / 2;
    const best = nearestReady(x, y);
    if (best < 0) return;
    if (current < 0 || !ready[current]) { current = best; return; }
    if (best !== current &&
        Math.sqrt(missSq(current, x, y)) - Math.sqrt(missSq(best, x, y)) > SWITCH_MARGIN_PX) {
      current = best;
    }
  }

  // ---- drawing ------------------------------------------------------------------------------------------
  function resizeCanvases() {
    view.w = document.documentElement.clientWidth;
    view.h = document.documentElement.clientHeight;
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    fgCanvas.width = Math.round(view.w * view.dpr);
    fgCanvas.height = Math.round(view.h * view.dpr);
    bgCanvas.width = Math.max(1, Math.ceil(view.w / BG_DOWNSCALE));
    bgCanvas.height = Math.max(1, Math.ceil(view.h / BG_DOWNSCALE));
    drawn = -1;                 // resizing cleared both canvases; repaint
    sizeDirty = false;
  }

  function drawBackdrop(img) {  // photo scaled to *cover* the window, drawn tiny; CSS blurs it
    const k = Math.max(bgCanvas.width / img.naturalWidth, bgCanvas.height / img.naturalHeight);
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    bg.drawImage(img, (bgCanvas.width - w) / 2, (bgCanvas.height - h) / 2, w, h);
  }

  function drawPhoto(i) {
    const img = images[i], r = fitRect(img);
    drawBackdrop(img);
    fg.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    fg.clearRect(0, 0, view.w, view.h);
    fg.imageSmoothingQuality = 'high';
    // Snap to whole pixels so the photo's edges are crisp.
    fg.drawImage(img, Math.round(r.left), Math.round(r.top), Math.round(r.w), Math.round(r.h));
    drawn = i;
  }

  function frame() {
    frameQueued = false;
    if (sizeDirty) resizeCanvases();
    if (pointerDirty || drawn < 0) { choose(); pointerDirty = false; }
    // The photo is static, so only repaint when the photo (or the window size) actually changed.
    // If nothing is ready yet we leave the (dark grey) page as is.
    if (current >= 0 && drawn !== current) drawPhoto(current);
    if (!hasHover && pointer.active) {
      cursorEl.style.transform = `translate(${pointer.x - 3}px, ${pointer.y - 4}px)`;
    }
  }

  function schedule() {
    if (!frameQueued) { frameQueued = true; requestAnimationFrame(frame); }
  }

  // ---- preloading ---------------------------------------------------------------------------------------
  // Load in "farthest point first" order, starting at the centre. Whenever we are only partway through,
  // the photos that have arrived are spread over the whole screen, so every pointer position already has
  // a reasonably close photo and quality simply improves as the rest arrive.
  function loadOrder() {
    const order = [], used = new Uint8Array(N), minD = new Float64Array(N).fill(Infinity);
    let next = 0, bestC = Infinity;
    for (let i = 0; i < N; i++) {
      const d = (POS[i][0] - .5) ** 2 + (POS[i][1] - .5) ** 2;
      if (d < bestC) { bestC = d; next = i; }
    }
    for (let n = 0; n < N; n++) {
      order.push(next); used[next] = 1;
      let far = -1, farD = -1;
      for (let i = 0; i < N; i++) {
        if (used[i]) continue;
        const d = (POS[i][0] - POS[next][0]) ** 2 + (POS[i][1] - POS[next][1]) ** 2;
        if (d < minD[i]) minD[i] = d;
        if (minD[i] > farD) { farD = minD[i]; far = i; }
      }
      next = far;
    }
    return order;
  }

  function updateProgress() {
    progress.textContent = settledCount < N ? `Loading photos… ${readyCount} / ${N}` : '';
    if (settledCount === N && pointer.active) hud.classList.add('hidden');
  }

  function startPreload() {
    const queue = loadOrder();
    let next = 0, inFlight = 0;

    function pump() {
      while (inFlight < CONCURRENCY && next < queue.length) load(queue[next++], 0);
    }

    function load(i, attempt) {
      inFlight++;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        images[i] = img; ready[i] = 1; readyCount++; settledCount++; inFlight--;
        updateProgress();
        pointerDirty = true; schedule();                    // a closer photo may just have arrived
        pump();
      };
      img.onerror = () => {
        inFlight--;
        if (attempt < 2) {                                  // transient failure: retry shortly
          setTimeout(() => { load(i, attempt + 1); }, 500 * (attempt + 1));
        } else {
          settledCount++; updateProgress(); pump();         // give up on this one; the rest still work
        }
      };
      img.src = attempt ? `${imageUrl(i)}?retry=${attempt}` : imageUrl(i);
    }

    pump();
  }

  // ---- input --------------------------------------------------------------------------------------------
  function onPointer(e) {
    pointer.x = Math.min(Math.max(e.clientX, 0), view.w);
    pointer.y = Math.min(Math.max(e.clientY, 0), view.h);
    if (!pointer.active) {
      pointer.active = true;
      if (!hasHover) cursorEl.style.display = 'block';
      if (settledCount === N) hud.classList.add('hidden');
      else hint.textContent = '';                           // keep only the loading counter visible
    }
    pointerDirty = true;
    schedule();
  }

  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('pointerdown', onPointer, { passive: true });
  window.addEventListener('resize', () => { sizeDirty = true; schedule(); });

  // ---- go -----------------------------------------------------------------------------------------------
  hint.textContent = hasHover ? 'Please move your pointer' : 'Please tap on the screen';
  resizeCanvases();
  startPreload();
  schedule();

  // Small read-only hook, handy for debugging in the console.
  window.pointerPointerDebug = () => ({ current, drawn, readyCount, settledCount, pointer: { ...pointer }, view: { ...view } });
})();
