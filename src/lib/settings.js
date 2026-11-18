import * as db from "../core/db.js";

export const DEFAULT_SETTINGS = { ringVolume: 0.7, ringTone: "classic", ringMuted: false };
export const RING_TONES = [["classic", "Clássico"], ["soft", "Suave"], ["digital", "Digital"]];

export function cleanSettings(s) {
  const o = { ...DEFAULT_SETTINGS, ...(s && typeof s === "object" ? s : {}) };
  o.ringVolume = Math.min(1, Math.max(0, Number(o.ringVolume)));
  if (!Number.isFinite(o.ringVolume)) o.ringVolume = DEFAULT_SETTINGS.ringVolume;
  if (!RING_TONES.some(([k]) => k === o.ringTone)) o.ringTone = DEFAULT_SETTINGS.ringTone;
  o.ringMuted = !!o.ringMuted;
  return { ringVolume: o.ringVolume, ringTone: o.ringTone, ringMuted: o.ringMuted };
}

export const loadSettings = async () => cleanSettings(await db.get("kv", "settings"));
export const saveSettings = (s) => db.put("kv", cleanSettings(s), "settings");
