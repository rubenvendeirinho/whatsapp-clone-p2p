// Utilitários de localização (sem dependências).
export const geoSupported = () => typeof navigator !== "undefined" && "geolocation" in navigator;

export function getPosition(opts = {}) {
  return new Promise((resolve, reject) => {
    if (!geoSupported()) return reject(Object.assign(new Error("unsupported"), { code: 0 }));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0) }),
      reject,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000, ...opts }
    );
  });
}

export function geoError(e) {
  if (e?.message === "unsupported") return "Este browser não suporta localização.";
  if (e?.code === 1) return "Permita o acesso à localização nas definições do browser/site.";
  if (e?.code === 2) return "Não foi possível determinar a localização. Verifique o GPS/ligação.";
  if (e?.code === 3) return "A localização demorou demasiado. Tente novamente.";
  return "Não foi possível obter a localização.";
}

/** Distância em metros (haversine). */
export function distance(a, b) {
  const R = 6371000, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const osmLink = (l, zoom = 17) =>
  `https://www.openstreetmap.org/?mlat=${l.lat.toFixed(6)}&mlon=${l.lng.toFixed(6)}#map=${zoom}/${l.lat.toFixed(6)}/${l.lng.toFixed(6)}`;

export const fmtCoords = (l) => `${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}`;

/** Valida uma localização recebida (nunca confiar no outro lado). */
export function cleanLoc(l) {
  if (!l || typeof l !== "object") return null;
  const lat = Number(l.lat), lng = Number(l.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const acc = Number.isFinite(Number(l.acc)) ? Math.max(0, Math.min(1e7, Number(l.acc))) : undefined;
  const name = typeof l.name === "string" ? l.name.slice(0, 80) : undefined;
  return { lat, lng, ...(acc !== undefined ? { acc } : {}), ...(name ? { name } : {}) };
}
