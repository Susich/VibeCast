import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { DEFAULT_THEME, THEMES, hexToRgba, type ThemeId } from "../themes";
import { getAudioRhythmFrame, loadTrackRhythm } from "../lib/audioRhythm";

interface CircularVisualizerProps {
  isPlaying: boolean;
  volume?: number;
  trackId?: string | null;
  position?: number;
}

const NUM_BARS = 52;
const INNER_RADIUS = 33.5;
const BASE_MAX_BAR_HEIGHT = 8.5;

export function CircularVisualizer({
  isPlaying,
  volume = 80,
  trackId: propTrackId,
  position: propPosition,
}: CircularVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const barsRef = useRef<Float32Array>(new Float32Array(NUM_BARS));
  const peaksRef = useRef<Float32Array>(new Float32Array(NUM_BARS));
  const peakDecayRef = useRef<Float32Array>(new Float32Array(NUM_BARS));
  const rotationRef = useRef<number>(0);
  const rippleRef = useRef<{ radius: number; maxRadius: number; progress: number; active: boolean }>({
    radius: INNER_RADIUS,
    maxRadius: INNER_RADIUS + 12,
    progress: 1.0,
    active: false,
  });

  const isPlayingRef = useRef(isPlaying);
  const volumeRef = useRef(volume);

  const storeTrackId = useStore((state) => state.player.currentTrackId);
  const storePosition = useStore((state) => state.player.position);
  const storeVolume = useStore((state) => state.player.volume);

  const activeTrackId = propTrackId !== undefined ? propTrackId : storeTrackId;
  const activePosition = propPosition !== undefined ? propPosition : storePosition;
  const activeVolume = volume !== undefined ? volume : storeVolume;

  const trackIdRef = useRef(activeTrackId);
  trackIdRef.current = activeTrackId;

  // Track IPC position updates and interpolate smoothly between ticks
  const posTrackerRef = useRef({ pos: activePosition, time: performance.now() });
  useEffect(() => {
    posTrackerRef.current = { pos: activePosition, time: performance.now() };
  }, [activePosition]);

  // Pre-load / decode real audio rhythm whenever active track changes
  useEffect(() => {
    if (activeTrackId) {
      void loadTrackRhythm(activeTrackId);
    }
  }, [activeTrackId]);

  const themeId = useStore((state) => state.theme);
  const activeTheme = THEMES[themeId as ThemeId] || THEMES[DEFAULT_THEME];
  const accent = activeTheme?.tokens?.accent || "#00f0ff";
  const accentHover = activeTheme?.tokens?.accent_hover || "#38f9d7";

  const colorsRef = useRef({ accent, accentHover });

  isPlayingRef.current = isPlaying;
  volumeRef.current = activeVolume;
  colorsRef.current = { accent, accentHover };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Handle high DPI screens for crisp line rendering
    const dpr = window.devicePixelRatio || 1;
    canvas.width = 120 * dpr;
    canvas.height = 120 * dpr;

    let isRunning = true;

    const render = () => {
      if (!isRunning) return;

      const playing = isPlayingRef.current;
      // Volume scaling: 0.0 to 1.0 directly from player volume setting
      const userVol = Math.max(0, Math.min(100, volumeRef.current ?? 80)) / 100;
      const now = performance.now();
      const { accent: currentAccent, accentHover: currentHover } = colorsRef.current;

      // Interpolate real-time playback position between IPC packets
      const elapsedSinceUpdate = (now - posTrackerRef.current.time) / 1000;
      const currentPos = playing
        ? posTrackerRef.current.pos + Math.min(elapsedSinceUpdate, 0.4)
        : posTrackerRef.current.pos;

      // Extract real audio frequency and beat dynamics for the current millisecond of the song
      const rhythm = getAudioRhythmFrame(trackIdRef.current, currentPos, playing);

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      const cx = 60;
      const cy = 60;

      // Dynamic volume and track energy scale (0.0 when muted or paused)
      const dynamicVolScale = playing ? userVol : 0;
      const trackEnergy = rhythm.energy;

      // Varied rotation drift: slowly drifts, gently accelerated by groove and beat drops
      if (playing && userVol > 0.05) {
        const rotationSpeed = (0.003 + trackEnergy * 0.006 + rhythm.beat * 0.012) * (0.3 + 0.7 * userVol);
        rotationRef.current = (rotationRef.current + rotationSpeed) % (Math.PI * 2);
      }
      const rotation = rotationRef.current;

      // Beat-triggered shockwave ripple (more lively on strong beats at higher volumes)
      const ripple = rippleRef.current;
      if (playing && userVol > 0.25 && rhythm.beat > 0.55 && ripple.progress >= 1.0) {
        ripple.progress = 0.0;
        ripple.active = true;
        ripple.maxRadius = INNER_RADIUS + 5 + 8 * userVol + rhythm.beat * 3;
      }

      // Draw shockwave ripple ring if active
      if (ripple.active && dynamicVolScale > 0.1) {
        ripple.progress += 0.035;
        if (ripple.progress >= 1.0) {
          ripple.active = false;
        } else {
          const currentRadius = INNER_RADIUS + (ripple.maxRadius - INNER_RADIUS) * Math.sin(ripple.progress * Math.PI * 0.5);
          const rippleAlpha = (1 - ripple.progress) * 0.45 * dynamicVolScale;
          ctx.beginPath();
          ctx.arc(cx, cy, currentRadius, 0, Math.PI * 2);
          ctx.strokeStyle = hexToRgba(currentHover, rippleAlpha);
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }

      // 1. Soft atmospheric neon glow around bubble edge - dynamically scales with volume and bass
      if (playing && dynamicVolScale > 0.05) {
        const beatExpansion = (rhythm.beat * 3.5 + rhythm.bass * 2.5) * dynamicVolScale;
        const bloomRadius = INNER_RADIUS + (3 + 4 * dynamicVolScale) + beatExpansion;
        const bgGlow = ctx.createRadialGradient(cx, cy, INNER_RADIUS - 1, cx, cy, bloomRadius);

        const glowAlpha = Math.min(0.4, (0.06 + rhythm.bass * 0.16 + rhythm.beat * 0.12) * dynamicVolScale);
        bgGlow.addColorStop(0, hexToRgba(currentAccent, glowAlpha));
        bgGlow.addColorStop(0.65, hexToRgba(currentHover, glowAlpha * 0.35));
        bgGlow.addColorStop(1, hexToRgba(currentAccent, 0));

        ctx.fillStyle = bgGlow;
        ctx.beginPath();
        ctx.arc(cx, cy, bloomRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      // 2. Real-time radial equalizer bars with bilateral symmetry and volume-adaptive height
      const bars = barsRef.current;
      const peaks = peaksRef.current;
      const peakDecay = peakDecayRef.current;
      let totalEnergy = 0;

      // Dynamic max bar height depending on both player volume and track energy
      // (quiet passage / low volume = 2-4px, loud drop / 100% volume = up to 8.5px)
      const currentMaxBarHeight = Math.max(1.0, BASE_MAX_BAR_HEIGHT * dynamicVolScale * (0.45 + 0.55 * Math.max(0.2, trackEnergy)));

      const halfBars = NUM_BARS / 2;

      for (let i = 0; i < NUM_BARS; i++) {
        // Bilateral symmetry: mirror frequency spectrum left and right from bottom-center
        const isLeftHemisphere = i < halfBars;
        const mirrorIndex = isLeftHemisphere ? i : NUM_BARS - 1 - i;
        const bandIndex = Math.min(NUM_BARS - 1, Math.floor((mirrorIndex / (halfBars - 1)) * (NUM_BARS - 1)));

        // Subtle fluid organic wave modulation across the perimeter
        const theta = ((i / NUM_BARS) * Math.PI * 2) + rotation;
        const waveFlutter = Math.sin(theta * 3 + now * 0.003) * 0.08 * rhythm.mid * dynamicVolScale;

        if (playing && dynamicVolScale > 0.02) {
          const rawTarget = rhythm.bars[bandIndex];
          // Volume-proportional target
          const target = Math.max(0.04, Math.min(1.0, (rawTarget + waveFlutter) * dynamicVolScale));

          // Smooth musical attack and organic release
          if (target > bars[i]) {
            bars[i] += (target - bars[i]) * 0.38;
          } else {
            bars[i] += (target - bars[i]) * 0.14;
          }
        } else {
          // Smooth decay to zero when muted or paused
          bars[i] *= 0.82;
          if (bars[i] < 0.003) bars[i] = 0;
        }

        totalEnergy += bars[i];

        // Peak holder logic for floating spark dots at bar tips
        if (bars[i] > peaks[i]) {
          peaks[i] = bars[i];
          peakDecay[i] = 0;
        } else {
          peakDecay[i] += 0.005;
          peaks[i] -= peakDecay[i];
          if (peaks[i] < bars[i]) peaks[i] = bars[i];
        }

        const barHeight = Math.max(dynamicVolScale > 0.05 ? 0.6 : 0, bars[i] * currentMaxBarHeight);
        const r1 = INNER_RADIUS;
        const r2 = INNER_RADIUS + barHeight;

        const x1 = cx + Math.cos(theta) * r1;
        const y1 = cy + Math.sin(theta) * r1;
        const x2 = cx + Math.cos(theta) * r2;
        const y2 = cy + Math.sin(theta) * r2;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineWidth = 1.3 + 0.4 * dynamicVolScale;
        ctx.lineCap = "round";

        // Clean theme-adaptive neon colors with dynamic gradient levels
        if (bars[i] > 0.65) {
          ctx.strokeStyle = currentHover;
          ctx.shadowColor = currentHover;
          ctx.shadowBlur = 3.5 * dynamicVolScale;
        } else if (bars[i] > 0.3) {
          ctx.strokeStyle = currentAccent;
          ctx.shadowColor = currentAccent;
          ctx.shadowBlur = 2.5 * dynamicVolScale;
        } else {
          ctx.strokeStyle = hexToRgba(currentAccent, 0.4 + 0.4 * dynamicVolScale);
          ctx.shadowColor = currentAccent;
          ctx.shadowBlur = 1.2 * dynamicVolScale;
        }

        ctx.stroke();

        // 3. Floating peak spark dots on prominent frequency bars at moderate-to-high volume
        if (peaks[i] > 0.38 && dynamicVolScale > 0.35 && barHeight > 2.0) {
          const peakDist = INNER_RADIUS + peaks[i] * currentMaxBarHeight + 1.6;
          const px = cx + Math.cos(theta) * peakDist;
          const py = cy + Math.sin(theta) * peakDist;
          ctx.beginPath();
          ctx.arc(px, py, 0.9 * dynamicVolScale, 0, Math.PI * 2);
          ctx.fillStyle = peaks[i] > 0.7 ? "#ffffff" : currentHover;
          ctx.shadowColor = currentHover;
          ctx.shadowBlur = 2;
          ctx.fill();
        }
      }

      ctx.restore();

      // If playing or bars/ripple are still active, keep animating
      if (playing || totalEnergy > 0.02 || ripple.active) {
        animFrameRef.current = requestAnimationFrame(render);
      }
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      isRunning = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      className="circular-visualizer-canvas"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: 120,
        height: 120,
        pointerEvents: "none",
        zIndex: 1,
      }}
    />
  );
}
