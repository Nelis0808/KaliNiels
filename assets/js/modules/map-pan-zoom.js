// =================================================================
// MAP PAN/ZOOM — generic drag-to-pan + wheel/pinch-to-zoom
// -----------------------------------------------------------------
// Shared by reizen.js (world map) and reizen-land.js + the country
// modal in reizen.js (country-specific vector maps). Works on any
// `viewport` (fixed-size, overflow:hidden box) containing a `frame`
// (the element that actually gets translated/scaled — background
// image + pins live inside it as normal percentage-positioned
// children, so their positions never need recalculating here).
//
// Also owns "was this a click or a drag" detection: instead of
// every pin carrying its own click listener (which would also fire
// after a drag that happened to start/end on the same pin), this
// module tracks pointer movement itself and calls `onTap(event)`
// only when a press+release genuinely didn't move — mouse AND touch
// both funnel through the same Pointer Events path.
//
// Sets a `--rz-inv-zoom` custom property on `frame` (1 / scale) so
// CSS can counter-scale pins/labels — see .rz-pin in reizen.css —
// keeping them a constant on-screen size no matter how far zoomed.
// =================================================================

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const TAP_MOVE_THRESHOLD = 8; // px — press+release within this = a tap, not a drag
const DOUBLE_TAP_ZOOM = 2.5;

export function initPanZoom(viewport, frame, { onTap, minScale = MIN_SCALE, maxScale = MAX_SCALE } = {}) {
  let scale = 1;
  let tx = 0;
  let ty = 0;

  const pointers = new Map(); // pointerId -> {x, y}
  let dragStart = null;       // {x, y, tx, ty} at drag start (single-pointer pan)
  let pinchStart = null;      // {dist, scale, midX, midY} at pinch start (two-pointer zoom)
  let moved = 0;              // cumulative movement of the primary pointer this gesture
  let lastTapTime = 0;
  let lastTapPos = null;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function apply() {
    frame.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    frame.style.setProperty('--rz-inv-zoom', String(1 / scale));
    viewport.classList.toggle('rz-map-viewport-zoomed', scale > minScale + 0.001);
  }

  function clampPan() {
    const rect = viewport.getBoundingClientRect();
    const minTx = rect.width * (1 - scale);
    const minTy = rect.height * (1 - scale);
    tx = scale <= minScale ? 0 : clamp(tx, minTx, 0);
    ty = scale <= minScale ? 0 : clamp(ty, minTy, 0);
  }

  function zoomAt(clientX, clientY, factor) {
    const rect = viewport.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const frameX = (localX - tx) / scale;
    const frameY = (localY - ty) / scale;

    scale = clamp(scale * factor, minScale, maxScale);
    tx = localX - frameX * scale;
    ty = localY - frameY * scale;
    clampPan();
    apply();
  }

  function zoomAtCenter(factor) {
    const rect = viewport.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  function reset() {
    scale = minScale;
    tx = 0;
    ty = 0;
    apply();
  }

  // ---- Wheel zoom (desktop) ----
  viewport.addEventListener('wheel', (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.18 : 1 / 1.18;
    zoomAt(event.clientX, event.clientY, factor);
  }, { passive: false });

  // ---- Pointer-based drag + pinch (mouse + touch + pen, unified) ----
  viewport.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button > 0) return; // ignore right/middle click
    viewport.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 1) {
      dragStart = { x: event.clientX, y: event.clientY, tx, ty };
      moved = 0;
    } else if (pointers.size === 2) {
      dragStart = null;
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchStart = {
        dist: Math.max(dist, 1),
        scale,
        midX: (pts[0].x + pts[1].x) / 2,
        midY: (pts[0].y + pts[1].y) / 2,
        tx, ty,
      };
    }
  });

  viewport.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 2 && pinchStart) {
      const pts = [...pointers.values()];
      const dist = Math.max(Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), 1);
      const factor = dist / pinchStart.dist;
      scale = clamp(pinchStart.scale * factor, minScale, maxScale);
      // keep the pinch midpoint anchored (approx — good enough at gesture speed)
      const rect = viewport.getBoundingClientRect();
      const localX = pinchStart.midX - rect.left;
      const localY = pinchStart.midY - rect.top;
      const frameX = (localX - pinchStart.tx) / pinchStart.scale;
      const frameY = (localY - pinchStart.ty) / pinchStart.scale;
      tx = localX - frameX * scale;
      ty = localY - frameY * scale;
      clampPan();
      apply();
      return;
    }

    if (pointers.size === 1 && dragStart) {
      const dx = event.clientX - dragStart.x;
      const dy = event.clientY - dragStart.y;
      moved = Math.max(moved, Math.hypot(dx, dy));
      if (scale > minScale) {
        tx = dragStart.tx + dx;
        ty = dragStart.ty + dy;
        clampPan();
        apply();
      }
      if (moved > TAP_MOVE_THRESHOLD) viewport.classList.add('rz-map-viewport-dragging');
    }
  });

  function endPointer(event) {
    const wasSinglePan = pointers.size === 1 && dragStart;
    pointers.delete(event.pointerId);
    viewport.classList.remove('rz-map-viewport-dragging');

    if (pointers.size < 2) pinchStart = null;

    if (wasSinglePan && pointers.size === 0) {
      if (moved <= TAP_MOVE_THRESHOLD) {
        // IMPORTANT: viewport.setPointerCapture() (set on pointerdown,
        // above) retargets event.target on this pointerup to the
        // *capturing* element (the viewport itself), not whatever pin
        // is visually under the pointer — that's the whole point of
        // capture (keeps the drag tracking even if the pointer leaves
        // the viewport mid-gesture), but it means we can't trust
        // event.target here to find a tapped pin. elementFromPoint
        // gives us the real element instead.
        const realTarget = document.elementFromPoint(event.clientX, event.clientY) || event.target;

        const now = Date.now();
        const isDoubleTap = lastTapPos
          && now - lastTapTime < 350
          && Math.hypot(event.clientX - lastTapPos.x, event.clientY - lastTapPos.y) < 30;

        if (isDoubleTap) {
          zoomAt(event.clientX, event.clientY, scale > minScale + 0.5 ? (minScale / scale) : (DOUBLE_TAP_ZOOM / scale));
          lastTapTime = 0;
          lastTapPos = null;
        } else {
          lastTapTime = now;
          lastTapPos = { x: event.clientX, y: event.clientY };
          onTap?.({ target: realTarget, clientX: event.clientX, clientY: event.clientY, originalEvent: event });
        }
      }
      dragStart = null;
    }
  }

  viewport.addEventListener('pointerup', endPointer);
  viewport.addEventListener('pointercancel', endPointer);
  viewport.addEventListener('pointerleave', (event) => {
    // only treat as a gesture end if the button/finger actually left mid-drag
    if (pointers.has(event.pointerId) && event.pointerType !== 'touch') endPointer(event);
  });

  // Re-clamp on resize so a stored pan offset doesn't leave the frame
  // partly outside the viewport after a layout/orientation change.
  const resizeObserver = new ResizeObserver(() => {
    clampPan();
    apply();
  });
  resizeObserver.observe(viewport);

  apply();

  return {
    zoomIn: () => zoomAtCenter(1.4),
    zoomOut: () => zoomAtCenter(1 / 1.4),
    reset,
    // Converts a pointer's viewport-relative client position into
    // frame-local CSS-pixel coordinates, undoing the current pan/zoom
    // transform. Used by the hover-coordinate readout.
    toFrameLocal: (clientX, clientY) => {
      const rect = viewport.getBoundingClientRect();
      return [(clientX - rect.left - tx) / scale, (clientY - rect.top - ty) / scale];
    },
    destroy: () => resizeObserver.disconnect(),
  };
}
