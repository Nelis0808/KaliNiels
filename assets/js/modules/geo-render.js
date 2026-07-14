// =================================================================
// GEO RENDER — GeoJSON → SVG, entirely local, zero external requests
// -----------------------------------------------------------------
// Replaces the old d-maps.com scraper. Country borders are real
// Natural Earth data (public domain, via the `world-atlas` npm
// package — see /home/claude/geodata/build.js-style pipeline notes
// in STAPPENPLAN-REIZEN.md for how assets/data/world-map.json and
// assets/data/countries/*.json were generated), bundled straight
// into the repo:
//
//   assets/data/world-map.json      — every country, 50m detail,
//                                      for the world overview.
//   assets/data/countries/<ISO2>.json — one country's own outline,
//                                      10m detail (2x sharper),
//                                      trimmed to its mainland/
//                                      nearby-islands "main
//                                      territory" so a country's
//                                      own map isn't dominated by a
//                                      far-off overseas bit (see
//                                      STAPPENPLAN-REIZEN.md).
//
// Why this instead of scraping another site: ISO 3166-1 alpha-2
// codes are a real, stable, universal standard — "NL", "US", "JP" —
// so lookups are exact, forever, for any of the ~237 files here.
// Nothing to scrape, nothing that can block us or change its page
// layout under us, nothing to fall back on since there's no network
// request to fail in the first place (loading these JSON files is
// exactly as reliable as loading any other file on this site).
//
// Both projections below are plain equirectangular (linear in lon
// AND lat) — no library, ~20 lines of math — which keeps this
// dependency-free and matches the flat, familiar "world map" look.
// The per-country one additionally compensates longitude by
// cos(mean latitude) so countries away from the equator (Norway,
// UK, Japan, ...) don't look horizontally stretched.
// =================================================================

/** Converts one GeoJSON Polygon/MultiPolygon into an SVG <path> "d" string. */
export function geometryToPathD(geometry, project) {
  const ringToD = (ring) => {
    let d = '';
    for (let i = 0; i < ring.length; i++) {
      const [x, y] = project(ring[i][0], ring[i][1]);
      d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ',' + y.toFixed(2);
    }
    return d + 'Z';
  };
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polys.map((poly) => poly.map(ringToD).join(' ')).join(' ');
}

/** Fixed world projection — same for every visit, so pin percentages
 *  (computed from it once, see reizen.js) always land correctly. */
export function makeWorldProjection(width = 2000, { lonMin = -180, lonMax = 180, latMin = -58, latMax = 83 } = {}) {
  const height = width * (latMax - latMin) / (lonMax - lonMin);
  const project = (lon, lat) => [
    (lon - lonMin) / (lonMax - lonMin) * width,
    (latMax - lat) / (latMax - latMin) * height,
  ];
  return { project, width, height, viewBox: `0 0 ${width} ${height}` };
}

function boundsOfGeometry(geometry) {
  let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  polys.forEach((poly) => poly.forEach((ring) => ring.forEach(([lon, lat]) => {
    if (lon < lonMin) lonMin = lon; if (lon > lonMax) lonMax = lon;
    if (lat < latMin) latMin = lat; if (lat > latMax) latMax = lat;
  })));
  return { lonMin, lonMax, latMin, latMax };
}

/** A projection auto-fit to one country's own bounding box (+ padding),
 *  with mild latitude-based aspect correction. This is what replaces
 *  "wait for the d-maps image to load, then read its natural size". */
export function makeFitProjection(geometry, { targetWidth = 1000, padding = 0.12 } = {}) {
  const { lonMin, lonMax, latMin, latMax } = boundsOfGeometry(geometry);
  const lonSpan = Math.max(lonMax - lonMin, 0.05);
  const latSpan = Math.max(latMax - latMin, 0.05);
  const bLonMin = lonMin - lonSpan * padding;
  const bLonMax = lonMax + lonSpan * padding;
  const bLatMin = latMin - latSpan * padding;
  const bLatMax = latMax + latSpan * padding;

  const meanLatRad = (bLatMin + bLatMax) / 2 * Math.PI / 180;
  const lonCompensation = Math.max(Math.cos(meanLatRad), 0.15); // floor avoids absurd stretch near the poles
  const bLonSpan = bLonMax - bLonMin;
  const bLatSpan = bLatMax - bLatMin;
  const effectiveLonSpan = bLonSpan * lonCompensation;

  const width = targetWidth;
  const height = width * (bLatSpan / effectiveLonSpan);
  const project = (lon, lat) => [
    (lon - bLonMin) * lonCompensation / effectiveLonSpan * width,
    (bLatMax - lat) / bLatSpan * height,
  ];
  return { project, width, height, viewBox: `0 0 ${width} ${height}` };
}

const worldDataPromise = fetch(new URL('../../data/world-map.json', import.meta.url)).then((r) => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
});

const countryDataCache = new Map();

/** The world overview FeatureCollection — every country once, cached for the session. */
export function loadWorldData() {
  return worldDataPromise;
}

/** One country's own trimmed, high-detail Feature, fetched + cached on first use. */
export function loadCountryData(iso2) {
  const code = iso2.toUpperCase();
  if (countryDataCache.has(code)) return countryDataCache.get(code);
  const promise = fetch(new URL(`../../data/countries/${code}.json`, import.meta.url))
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .catch((error) => {
      countryDataCache.delete(code); // allow a retry on the next click instead of caching the failure forever
      throw error;
    });
  countryDataCache.set(code, promise);
  return promise;
}
