/**
 * Tiny UI-sound helper. Web-Audio-API based — no asset files, no library.
 *
 * The "Linear-style" approach: short envelope-shaped sine/triangle tones at
 * very low master gain. Five sounds:
 *
 *   tick    — nav-rail / context-switch (one-shot, ~12ms attack, 60ms decay)
 *   click   — primary button confirm (slightly fuller body)
 *   success — correct quiz answer (two-note rising)
 *   error   — wrong quiz answer (single low blip)
 *   chime   — long-running background task done (three-note arpeggio)
 *
 * Honored guards:
 *   - User toggle in localStorage (`mindshift.uiSounds`, default off).
 *   - Mute while the tab is hidden (PageVisibility).
 *   - Lazy AudioContext init on first call after a user gesture, so we
 *     never trip Chrome's autoplay policy.
 */

const STORAGE_KEY = "mindshift.uiSounds";
const MASTER_GAIN = 0.06;

type SoundName = "tick" | "click" | "success" | "error" | "chime";

let ctx: AudioContext | null = null;
let enabledCache: boolean | null = null;

function isEnabled(): boolean {
  if (enabledCache !== null) return enabledCache;
  try {
    enabledCache = localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    enabledCache = false;
  }
  return enabledCache;
}

export function setSoundsEnabled(on: boolean): void {
  enabledCache = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function getSoundsEnabled(): boolean {
  return isEnabled();
}

function getCtx(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const Ctor =
      typeof window !== "undefined"
        ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!Ctor) return null;
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

interface ToneSpec {
  freq: number;
  startAt: number; // seconds offset from "now"
  duration: number; // seconds
  type?: OscillatorType;
  peak?: number; // gain peak, 0..1, will be multiplied by MASTER_GAIN
}

function playTones(spec: ToneSpec[]): void {
  if (!isEnabled()) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  const audio = getCtx();
  if (!audio) return;
  if (audio.state === "suspended") {
    void audio.resume().catch(() => {
      /* ignore */
    });
  }
  const t0 = audio.currentTime;
  for (const tone of spec) {
    const osc = audio.createOscillator();
    osc.type = tone.type ?? "sine";
    osc.frequency.value = tone.freq;

    const gain = audio.createGain();
    const peak = (tone.peak ?? 1) * MASTER_GAIN;
    const start = t0 + tone.startAt;
    const end = start + tone.duration;

    // Quick linear attack, exponential decay — gives the "tick" character
    // without an audible click on cutoff.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.012, tone.duration * 0.3));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(gain).connect(audio.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}

const PRESETS: Record<SoundName, ToneSpec[]> = {
  tick: [
    { freq: 1400, startAt: 0, duration: 0.05, type: "triangle", peak: 0.6 },
  ],
  click: [
    { freq: 880, startAt: 0, duration: 0.07, type: "sine", peak: 0.8 },
    { freq: 1320, startAt: 0, duration: 0.05, type: "sine", peak: 0.4 },
  ],
  success: [
    { freq: 740, startAt: 0, duration: 0.09, type: "sine", peak: 0.7 },
    { freq: 988, startAt: 0.07, duration: 0.13, type: "sine", peak: 0.7 },
  ],
  error: [
    { freq: 220, startAt: 0, duration: 0.12, type: "triangle", peak: 0.7 },
  ],
  chime: [
    { freq: 660, startAt: 0, duration: 0.12, type: "sine", peak: 0.7 },
    { freq: 880, startAt: 0.1, duration: 0.13, type: "sine", peak: 0.7 },
    { freq: 1175, startAt: 0.2, duration: 0.18, type: "sine", peak: 0.7 },
  ],
};

export function playSound(name: SoundName): void {
  playTones(PRESETS[name]);
}
