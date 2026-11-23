// short sounds for the panels, made with Web Audio (no files). Browsers allow sound only after the person has
// clicked or typed on the page once, so the first click unlocks it.
let AC = null;
const unlock = () => { try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === "suspended") AC.resume(); } catch {} };
if (typeof window !== "undefined") ["pointerdown", "keydown", "touchstart"].forEach(ev => window.addEventListener(ev, unlock, { passive: true }));
const NOTES = {
  approved: [[523.25, 0, "triangle"], [659.25, 0.13, "triangle"], [783.99, 0.26, "triangle"], [1046.5, 0.39, "triangle"]], // rising: a file was approved
  app: [[659.25, 0, "sine"], [493.88, 0.22, "sine"], [659.25, 0.5, "sine"], [493.88, 0.72, "sine"]], // ding-dong twice: a new application
};
export function tone(kind) {
  try {
    unlock(); if (!AC || AC.state !== "running") return; const t = AC.currentTime;
    for (const [f, d, type] of NOTES[kind] || []) {
      const o = AC.createOscillator(), g = AC.createGain(); o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.4, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.42);
      o.connect(g).connect(AC.destination); o.start(t + d); o.stop(t + d + 0.45);
    }
  } catch {}
}
