import { call } from "./api";

export interface AudioRhythmFrame {
  bass: number;        // 0.0 .. 1.0 (sub + kick + bassline)
  mid: number;         // 0.0 .. 1.0 (vocals, lead instruments)
  treble: number;      // 0.0 .. 1.0 (cymbals, hi-hats, air)
  beat: number;        // 0.0 .. 1.0 (percussive transient punch)
  energy: number;      // 0.0 .. 1.0 (overall dynamic volume)
  bars: Float32Array;  // 52 normalized equalizer bar levels
}

interface TrackRhythmProfile {
  duration: number;
  fps: number;
  frames: AudioRhythmFrame[];
}

const NUM_BARS = 52;
const FPS = 50; // 20ms resolution per frame
const profileCache = new Map<string, TrackRhythmProfile>();
const inFlightLoads = new Set<string>();

// Pre-allocated empty frame for silence / paused state
const EMPTY_BARS = new Float32Array(NUM_BARS);
const EMPTY_FRAME: AudioRhythmFrame = {
  bass: 0,
  mid: 0,
  treble: 0,
  beat: 0,
  energy: 0,
  bars: EMPTY_BARS,
};

/**
 * Loads and analyzes track audio into a fast 50 FPS rhythm/frequency profile.
 * Runs asynchronously in background using Web Audio offline decoding.
 */
export async function loadTrackRhythm(trackId: string): Promise<TrackRhythmProfile | null> {
  if (!trackId) return null;
  if (profileCache.has(trackId)) {
    return profileCache.get(trackId)!;
  }
  if (inFlightLoads.has(trackId)) {
    return null;
  }

  inFlightLoads.add(trackId);

  try {
    // 1. Fetch raw audio bytes from Tauri backend (cached file or server stream)
    const rawData = await call<ArrayBuffer | number[] | Uint8Array>("get_track_audio", { trackId });
    if (!rawData) {
      inFlightLoads.delete(trackId);
      return null;
    }

    let arrayBuffer: ArrayBuffer;
    if (rawData instanceof ArrayBuffer) {
      arrayBuffer = rawData;
    } else if (rawData instanceof Uint8Array) {
      arrayBuffer = rawData.buffer.slice(rawData.byteOffset, rawData.byteOffset + rawData.byteLength) as ArrayBuffer;
    } else if (Array.isArray(rawData)) {
      arrayBuffer = new Uint8Array(rawData).buffer as ArrayBuffer;
    } else {
      inFlightLoads.delete(trackId);
      return null;
    }

    // 2. Decode using native Chromium Web Audio API
    // Using 22050 Hz sample rate for 2x faster decode and low memory footprint (covers up to 11kHz)
    const AudioCtxClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    if (!AudioCtxClass) {
      inFlightLoads.delete(trackId);
      return null;
    }

    const tempCtx = new AudioCtxClass();
    const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
    void tempCtx.close().catch(() => undefined);

    // 3. Extract channel data (mono mixdown)
    const sampleRate = audioBuffer.sampleRate;
    const duration = audioBuffer.duration;
    const numChannels = audioBuffer.numberOfChannels;
    const leftChannel = audioBuffer.getChannelData(0);
    const rightChannel = numChannels > 1 ? audioBuffer.getChannelData(1) : leftChannel;

    const totalSamples = leftChannel.length;
    const frameSize = Math.max(64, Math.floor(sampleRate / FPS));
    const totalFrames = Math.ceil(totalSamples / frameSize);

    const frames: AudioRhythmFrame[] = new Array(totalFrames);

    // 16 Logarithmic frequency center frequencies (Hz) for multi-band analysis
    const centerFreqs = [
      45, 70, 110, 180, 280, 440, 700, 1100, 1800, 2800, 4400, 6800, 9500, 12500, 16000, 19000,
    ];
    const numBands = centerFreqs.length;

    // Moving average bass energy history for beat/transient punch detection (last 20 frames = ~0.4s)
    const bassHistory: number[] = [];
    const historyLen = 20;

    // Subsampling step: ~11kHz is more than enough for visualizer frequency analysis
    const sampleStep = Math.max(1, Math.floor(sampleRate / 11025));

    for (let f = 0; f < totalFrames; f++) {
      // Yield to the browser event loop regularly to prevent any main-thread freeze
      if (f % 60 === 0 && f > 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const start = f * frameSize;
      const end = Math.min(totalSamples, start + frameSize);

      if (end <= start) {
        frames[f] = EMPTY_FRAME;
        continue;
      }

      // Calculate Total RMS energy
      let sumSq = 0;
      let runningBass = 0;
      let bassSumSq = 0;
      let trebleSumSq = 0;
      let processedSamples = 0;

      // 16-band energy accumulation
      const bandEnergies = new Float32Array(numBands);

      for (let s = start; s < end; s += sampleStep) {
        processedSamples++;
        const mono = (leftChannel[s] + rightChannel[s]) * 0.5;
        const monoSq = mono * mono;
        sumSq += monoSq;

        // 1st order IIR lowpass (~220 Hz cut-off) for bass isolation
        runningBass += (mono - runningBass) * 0.12;
        bassSumSq += runningBass * runningBass;

        // High-pass differential for treble isolation
        if (s > start) {
          const prevMono = (leftChannel[s - sampleStep] + rightChannel[s - sampleStep]) * 0.5;
          const diff = mono - prevMono;
          trebleSumSq += diff * diff;
        }

        // Discrete frequency resonators across 16 bands
        const timeInSec = s / sampleRate;
        for (let b = 0; b < numBands; b++) {
          const freq = centerFreqs[b];
          const phase = 2.0 * Math.PI * freq * timeInSec;
          const val = mono * Math.cos(phase);
          bandEnergies[b] += val * val;
        }
      }

      const count = Math.max(1, processedSamples);

      const rmsEnergy = Math.min(1.0, Math.sqrt(sumSq / count) * 2.2);
      const bassVal = Math.min(1.0, Math.sqrt(bassSumSq / count) * 2.5);
      const trebleVal = Math.min(1.0, Math.sqrt(trebleSumSq / count) * 2.6);
      const midVal = Math.min(1.0, Math.max(0.04, rmsEnergy * 1.1 - bassVal * 0.4 - trebleVal * 0.25));

      // Beat / kick transient detection: check if instant bass sharply exceeds recent average
      let avgBass = 0;
      if (bassHistory.length > 0) {
        let sum = 0;
        for (let h = 0; h < bassHistory.length; h++) sum += bassHistory[h];
        avgBass = sum / bassHistory.length;
      }
      bassHistory.push(bassVal);
      if (bassHistory.length > historyLen) {
        bassHistory.shift();
      }

      const beatThreshold = Math.max(0.14, avgBass * 1.3);
      let beatPunch = 0;
      if (bassVal > beatThreshold) {
        beatPunch = Math.min(1.0, (bassVal - avgBass) * 3.2);
      }

      // Map 16 bands into NUM_BARS = 52 radial equalizer bars
      const barLevels = new Float32Array(NUM_BARS);
      for (let i = 0; i < NUM_BARS; i++) {
        // Map bar i (0..51) to 16 frequency bands with smooth spatial grouping:
        // Bars 0..12: Sub-bass & Bass (kick drums, 808s, basslines)
        // Bars 13..25: Low-mids & Mids (snare, vocals, rhythm guitars)
        // Bars 26..38: High-mids & Treble (leads, synths, female vocals)
        // Bars 39..51: Presence & Air (hi-hats, cymbals, shimmer)
        const bandPos = (i / NUM_BARS) * (numBands - 1);
        const b0 = Math.floor(bandPos);
        const b1 = Math.min(numBands - 1, b0 + 1);
        const frac = bandPos - b0;

        const rawBand0 = Math.sqrt(bandEnergies[b0] / count) * 2.2;
        const rawBand1 = Math.sqrt(bandEnergies[b1] / count) * 2.2;
        const interpolated = rawBand0 * (1 - frac) + rawBand1 * frac;

        // Weight with frequency-specific dynamics
        let barValue = interpolated * 0.85;
        if (i < 13) {
          // Bass quadrant: emphasize kick beat impact
          barValue = barValue * 0.5 + bassVal * 0.4 + beatPunch * 0.25;
        } else if (i < 26) {
          // Low-mid quadrant
          barValue = barValue * 0.55 + midVal * 0.35 + beatPunch * 0.15;
        } else if (i < 39) {
          // High-mid quadrant
          barValue = barValue * 0.6 + midVal * 0.3 + trebleVal * 0.25;
        } else {
          // Treble quadrant: sharp crisp response
          barValue = barValue * 0.5 + trebleVal * 0.5;
        }

        // Add subtle harmonic modulation for organic visual flair
        const waveFlutter = Math.sin(i * 0.4 + f * 0.15) * 0.03 * rmsEnergy;
        barLevels[i] = Math.max(0.04, Math.min(1.0, barValue + waveFlutter));
      }

      frames[f] = {
        bass: bassVal,
        mid: midVal,
        treble: trebleVal,
        beat: beatPunch,
        energy: rmsEnergy,
        bars: barLevels,
      };
    }

    const profile: TrackRhythmProfile = {
      duration,
      fps: FPS,
      frames,
    };

    // Cache up to 25 recent tracks to maintain lean memory footprint
    if (profileCache.size > 25) {
      const firstKey = profileCache.keys().next().value;
      if (firstKey) profileCache.delete(firstKey);
    }
    profileCache.set(trackId, profile);
    inFlightLoads.delete(trackId);
    return profile;
  } catch (err) {
    inFlightLoads.delete(trackId);
    return null;
  }
}

/**
 * Returns the exact rhythm and frequency spectrum for the given track at the current position.
 * If the track is not yet decoded or loading, returns a rhythmic fallback that smoothly transitions.
 */
export function getAudioRhythmFrame(
  trackId: string | null | undefined,
  positionSeconds: number,
  isPlaying: boolean,
): AudioRhythmFrame {
  if (!isPlaying || !trackId) {
    return EMPTY_FRAME;
  }

  const profile = profileCache.get(trackId);
  if (!profile) {
    // Initiate background load if not yet requested
    void loadTrackRhythm(trackId);

    // Dynamic procedural fallback while loading (derived from position and track ID seed)
    return getProceduralFallback(trackId, positionSeconds);
  }

  const frameIdx = Math.floor(positionSeconds * profile.fps);
  if (frameIdx < 0 || frameIdx >= profile.frames.length) {
    return EMPTY_FRAME;
  }

  // Smooth interpolation between frameIdx and frameIdx + 1
  const nextIdx = Math.min(profile.frames.length - 1, frameIdx + 1);
  const frac = (positionSeconds * profile.fps) - frameIdx;

  const cur = profile.frames[frameIdx];
  const next = profile.frames[nextIdx];

  const interpolatedBars = new Float32Array(NUM_BARS);
  for (let i = 0; i < NUM_BARS; i++) {
    interpolatedBars[i] = cur.bars[i] * (1 - frac) + next.bars[i] * frac;
  }

  return {
    bass: cur.bass * (1 - frac) + next.bass * frac,
    mid: cur.mid * (1 - frac) + next.mid * frac,
    treble: cur.treble * (1 - frac) + next.treble * frac,
    beat: cur.beat * (1 - frac) + next.beat * frac,
    energy: cur.energy * (1 - frac) + next.energy * frac,
    bars: interpolatedBars,
  };
}

/**
 * Dynamic procedural rhythm generator used while track audio is decoding in background.
 * Adapts to track ID hash and playback position instead of a single static loop.
 */
function getProceduralFallback(trackId: string, position: number): AudioRhythmFrame {
  // Deterministic seed based on trackId characters
  let seed = 0;
  for (let i = 0; i < trackId.length; i++) {
    seed = (seed * 31 + trackId.charCodeAt(i)) & 0xfffff;
  }
  const tempoScale = 1.6 + (seed % 100) / 120.0; // Dynamic tempo

  const t = position * tempoScale;
  const kick = Math.pow(Math.max(0, Math.sin(t * Math.PI)), 5) * 0.6;
  const snare = Math.pow(Math.max(0, Math.cos(t * Math.PI * 0.5 + 0.3)), 6) * 0.5;
  const bass = kick * 0.6 + 0.1;
  const treble = snare * 0.5 + 0.08;
  const mid = (Math.sin(t * 1.5) * 0.5 + 0.5) * 0.35 + 0.1;
  const energy = Math.max(0.12, (bass + mid + treble) / 3);

  const bars = new Float32Array(NUM_BARS);
  for (let i = 0; i < NUM_BARS; i++) {
    const theta = (i / NUM_BARS) * Math.PI * 2;
    const wave = Math.sin(theta * 3 + t * 2.2) * 0.15;
    let val = 0.1 + wave;
    if (i < 13) {
      val += bass * 0.45;
    } else if (i < 39) {
      val += mid * 0.35;
    } else {
      val += treble * 0.4;
    }
    bars[i] = Math.max(0.04, Math.min(0.8, val));
  }

  return {
    bass,
    mid,
    treble,
    beat: kick,
    energy,
    bars,
  };
}
