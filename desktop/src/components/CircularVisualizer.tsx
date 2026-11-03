import { useEffect, useRef } from "react";

interface CircularVisualizerProps {
  isPlaying: boolean;
  volume?: number;
}

const NUM_BARS = 52;
const INNER_RADIUS = 33.5;
const MAX_BAR_HEIGHT = 20.5;

export function CircularVisualizer({ isPlaying, volume = 80 }: CircularVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const barsRef = useRef<Float32Array>(new Float32Array(NUM_BARS));
  const isPlayingRef = useRef(isPlaying);
  const volumeRef = useRef(volume);

  isPlayingRef.current = isPlaying;
  volumeRef.current = volume;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Handle high DPI screens for crisp line rendering
    const dpr = window.devicePixelRatio || 1;
    canvas.width = 120 * dpr;
    canvas.height = 120 * dpr;

    let startTime = performance.now();
    let isRunning = true;

    const render = () => {
      if (!isRunning) return;

      const playing = isPlayingRef.current;
      const volScale = Math.max(0.2, Math.min(1, (volumeRef.current || 80) / 100));
      const now = performance.now();
      const t = (now - startTime) / 1000;

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      const cx = 60;
      const cy = 60;

      // 1. Soft atmospheric neon bloom behind the bars
      if (playing) {
        const bgGlow = ctx.createRadialGradient(cx, cy, INNER_RADIUS - 2, cx, cy, INNER_RADIUS + 22);
        bgGlow.addColorStop(0, "rgba(41, 121, 255, 0.28)");
        bgGlow.addColorStop(0.6, "rgba(0, 229, 255, 0.12)");
        bgGlow.addColorStop(1, "rgba(41, 121, 255, 0)");
        ctx.fillStyle = bgGlow;
        ctx.beginPath();
        ctx.arc(cx, cy, INNER_RADIUS + 22, 0, Math.PI * 2);
        ctx.fill();
      }

      // 2. Calculate and render radial equalizer bars
      const bars = barsRef.current;
      let totalEnergy = 0;

      // Music rhythm formulas (bass pulse, snare hit, traveling frequency waves)
      const beat1 = Math.pow(Math.max(0, Math.sin(t * 3.8)), 4) * 0.9;
      const beat2 = Math.pow(Math.max(0, Math.cos(t * 7.6 + 0.3)), 6) * 0.7;

      for (let i = 0; i < NUM_BARS; i++) {
        const theta = (i / NUM_BARS) * Math.PI * 2;

        if (playing) {
          // Complex frequency landscape around the circle
          const wave1 = Math.sin(theta * 2 - t * 2.8) * 0.35;
          const wave2 = Math.cos(theta * 4 + t * 4.2) * 0.25;
          const wave3 = Math.sin(theta * 7 - t * 6.0) * 0.2;
          const jitter = Math.sin(i * 147.2 + t * 16.0) * 0.15;

          // Bass emphasis on left/top quadrant (just like the reference screenshot)
          const bassWeight = Math.max(0, -Math.cos(theta - 0.4));
          const trebleWeight = Math.max(0, Math.sin(theta * 1.5 + 1.2));

          let raw =
            0.12 +
            (wave1 + wave2 + wave3) * 0.45 +
            bassWeight * beat1 * 0.75 +
            trebleWeight * beat2 * 0.5 +
            jitter;

          // Clamp and scale with volume
          const target = Math.max(0.04, Math.min(1.0, raw)) * volScale;

          // Fast attack, smooth decay (classic audio visualizer physics)
          if (target > bars[i]) {
            bars[i] += (target - bars[i]) * 0.35;
          } else {
            bars[i] += (target - bars[i]) * 0.14;
          }
        } else {
          // Smooth decay to zero when paused
          bars[i] *= 0.88;
          if (bars[i] < 0.005) bars[i] = 0;
        }

        totalEnergy += bars[i];

        const barHeight = Math.max(0.8, bars[i] * MAX_BAR_HEIGHT);
        const r1 = INNER_RADIUS;
        const r2 = INNER_RADIUS + barHeight;

        const x1 = cx + Math.cos(theta) * r1;
        const y1 = cy + Math.sin(theta) * r1;
        const x2 = cx + Math.cos(theta) * r2;
        const y2 = cy + Math.sin(theta) * r2;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineWidth = 1.9;
        ctx.lineCap = "round";

        // Intense neon glow with bright electric blue/cyan and white hot peaks
        if (bars[i] > 0.65) {
          ctx.strokeStyle = "#ffffff";
          ctx.shadowColor = "#00f0ff";
          ctx.shadowBlur = 8;
        } else if (bars[i] > 0.35) {
          ctx.strokeStyle = "#4d94ff";
          ctx.shadowColor = "#2979ff";
          ctx.shadowBlur = 6;
        } else {
          ctx.strokeStyle = "#1e60ff";
          ctx.shadowColor = "#1e60ff";
          ctx.shadowBlur = 4;
        }

        ctx.stroke();
      }

      ctx.restore();

      // If playing or bars are still decaying down, keep animating
      if (playing || totalEnergy > 0.05) {
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
