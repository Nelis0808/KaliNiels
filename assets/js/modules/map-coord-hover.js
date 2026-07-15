// =================================================================
// MAP COORD HOVER — "what lon/lat is under my cursor?"
// -----------------------------------------------------------------
// Purely a data-entry aid: since pin positions in travel-countries.json
// (and a country's cityPins) are plain {lon, lat} numbers, this shows
// a small floating readout that follows the cursor while hovering any
// map, so you can point at the right spot and copy the numbers
// straight into the JSON file instead of guessing.
//
// Works for both the fixed world projection and a country's own fit
// projection — it only needs `projection.invert(x, y) -> [lon, lat]`
// (see geo-render.js) plus the pan/zoom module's toFrameLocal(), so it
// stays correct whether the map is panned, zoomed, or neither.
// =================================================================

export function attachCoordHover(viewport, panZoom, getProjection) {
  const badge = document.createElement('div');
  badge.className = 'rz-coord-badge hidden';
  viewport.appendChild(badge);

  function hide() {
    badge.classList.add('hidden');
  }

  viewport.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return; // touch has no hover — don't leave it stuck on screen
    const projection = getProjection();
    if (!projection) { hide(); return; }

    const [frameX, frameY] = panZoom.toFrameLocal(event.clientX, event.clientY);
    const rect = viewport.getBoundingClientRect();
    const scaleX = projection.width / rect.width;
    const scaleY = projection.height / rect.height;
    const [lon, lat] = projection.invert(frameX * scaleX, frameY * scaleY);

    if (!Number.isFinite(lon) || !Number.isFinite(lat)) { hide(); return; }

    badge.textContent = `lon: ${lon.toFixed(4)}  lat: ${lat.toFixed(4)}`;
    badge.classList.remove('hidden');

    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    badge.style.left = `${localX}px`;
    badge.style.top = `${localY}px`;
  });

  viewport.addEventListener('pointerleave', hide);
  viewport.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') hide();
  });

  return { hide };
}
