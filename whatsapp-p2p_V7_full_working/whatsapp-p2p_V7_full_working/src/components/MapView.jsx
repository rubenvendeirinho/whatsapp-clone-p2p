import { useEffect, useRef, useState } from "react";
import { TILE, clampLat, worldPx, fromWorldPx } from "../lib/mapmath";

// Mapa OpenStreetMap minimalista (tiles "slippy map" 256 px), sem dependências.
// Política de utilização dos tiles: https://operations.osmfoundation.org/policies/tiles/
const MAX_Z = 19, MIN_Z = 3;

const Attribution = () => (
  <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener"
    className="absolute bottom-0 right-0 z-10 bg-white/80 px-1 text-[10px] text-slate-700">© OpenStreetMap</a>
);

/**
 * @param {{lat,lng}} center  centro inicial
 * @param {number} zoom       zoom inicial
 * @param {Array<{lat,lng,label?}>} markers  marcadores fixos
 * @param {boolean} interactive  permite arrastar e fazer zoom
 * @param {(c:{lat,lng})=>void} onMove  chamado ao mover (modo escolha: o pino fica no centro)
 * @param {boolean} pin       mostra um pino fixo no centro
 */
export default function MapView({ center, zoom = 15, markers = [], interactive = false, onMove, pin = false, className = "", height = 160, recenterKey }) {
  const box = useRef(null);
  const [size, setSize] = useState({ w: 300, h: height });
  const [view, setView] = useState({ lat: center.lat, lng: center.lng, z: zoom });
  const drag = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth || 300, h: el.clientHeight || height });
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [height]);

  // Segue o ponto quando a localização muda (partilha em direto) ou quando é pedido recentrar.
  useEffect(() => { setView((v) => ({ ...v, lat: center.lat, lng: center.lng })); }, [center.lat, center.lng, recenterKey]);

  const c = worldPx(view.lat, view.lng, view.z);
  const x0 = c.x - size.w / 2, y0 = c.y - size.h / 2;
  const n = 2 ** view.z;
  const tiles = [];
  for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + size.w) / TILE); tx++) {
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + size.h) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      const wx = ((tx % n) + n) % n;
      tiles.push({ key: `${view.z}/${tx}/${ty}`, src: `https://tile.openstreetmap.org/${view.z}/${wx}/${ty}.png`, left: tx * TILE - x0, top: ty * TILE - y0 });
    }
  }
  const at = (lat, lng) => { const p = worldPx(lat, lng, view.z); return { left: p.x - x0, top: p.y - y0 }; };

  const move = (dx, dy) => {
    const v = viewRef.current;
    const cur = worldPx(v.lat, v.lng, v.z);
    const next = fromWorldPx(cur.x - dx, cur.y - dy, v.z);
    const nv = { ...v, lat: clampLat(next.lat), lng: ((next.lng + 540) % 360) - 180 };
    viewRef.current = nv;
    setView(nv);
    onMove?.({ lat: nv.lat, lng: nv.lng });
  };
  const zoomBy = (d) => setView((v) => ({ ...v, z: Math.max(MIN_Z, Math.min(MAX_Z, v.z + d)) }));

  const down = (e) => { if (!interactive) return; drag.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const moveEv = (e) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    move(dx, dy);
  };
  const up = () => { drag.current = null; };
  const wheel = (e) => { if (interactive) zoomBy(e.deltaY < 0 ? 1 : -1); };

  return (
    <div ref={box} style={{ height, touchAction: interactive ? "none" : "auto" }}
      className={`relative w-full select-none overflow-hidden bg-[#e5e3df] ${interactive ? "cursor-grab active:cursor-grabbing" : ""} ${className}`}
      onPointerDown={down} onPointerMove={moveEv} onPointerUp={up} onPointerCancel={up} onWheel={wheel}
      role="img" aria-label="Mapa">
      {tiles.map((t) => (
        <img key={t.key} src={t.src} alt="" width={TILE} height={TILE} draggable={false} referrerPolicy="origin"
          style={{ position: "absolute", left: t.left, top: t.top, width: TILE, height: TILE, maxWidth: "none" }} />
      ))}
      {markers.map((m, i) => {
        const p = at(m.lat, m.lng);
        return (
          <div key={i} className="pointer-events-none absolute z-[5] -translate-x-1/2 -translate-y-full text-3xl text-red-600 drop-shadow" style={{ left: p.left, top: p.top }} title={m.label}>
            <svg width="28" height="36" viewBox="0 0 24 32" aria-hidden><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" fill="#dc2626" stroke="#fff" strokeWidth="1.5" /><circle cx="12" cy="12" r="4.5" fill="#fff" /></svg>
          </div>
        );
      })}
      {pin && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[5] -translate-x-1/2 -translate-y-full">
          <svg width="32" height="42" viewBox="0 0 24 32" aria-hidden><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" fill="#00a884" stroke="#fff" strokeWidth="1.5" /><circle cx="12" cy="12" r="4.5" fill="#fff" /></svg>
        </div>
      )}
      {interactive && (
        <div className="absolute left-2 top-2 z-10 flex flex-col overflow-hidden rounded bg-white shadow">
          <button type="button" aria-label="Aproximar" onPointerDown={(e) => e.stopPropagation()} onClick={() => zoomBy(1)} className="px-2.5 py-1 text-lg leading-none hover:bg-slate-100">+</button>
          <button type="button" aria-label="Afastar" onPointerDown={(e) => e.stopPropagation()} onClick={() => zoomBy(-1)} className="border-t px-2.5 py-1 text-lg leading-none hover:bg-slate-100">−</button>
        </div>
      )}
      <Attribution />
    </div>
  );
}
