// Matemática de "slippy map" (Web Mercator, tiles de 256 px) usada pelo MapView.
export const TILE = 256;
export const clampLat = (lat) => Math.max(-85.0511, Math.min(85.0511, lat));

export const worldPx = (lat, lng, z) => {
  const n = TILE * 2 ** z, r = (clampLat(lat) * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
};
export const fromWorldPx = (x, y, z) => {
  const n = TILE * 2 ** z;
  const lng = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lat, lng };
};
