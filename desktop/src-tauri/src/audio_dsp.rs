//! Audio DSP volume smoothing engine.
//!
//! Provides click-free and pop-free volume adjustment applied directly to PCM audio
//! sample buffers via vector operations and exponential / slew-rate limited lerp.
//! Window smoothing is 10-20 ms (default 15 ms).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// Atomic representation of target volume (0.0 to 100.0 clamped) as IEEE 754 bits.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct AtomicVolume {
    bits: Arc<AtomicU64>,
}

#[allow(dead_code)]
impl AtomicVolume {
    pub fn new(initial_volume: f64) -> Self {
        let clamped = initial_volume.clamp(0.0, 100.0);
        Self {
            bits: Arc::new(AtomicU64::new(clamped.to_bits())),
        }
    }

    pub fn get(&self) -> f64 {
        f64::from_bits(self.bits.load(Ordering::Relaxed))
    }

    pub fn set(&self, volume: f64) {
        let clamped = volume.clamp(0.0, 100.0);
        self.bits.store(clamped.to_bits(), Ordering::Relaxed);
    }
}

/// DSP volume processor applying exponential slew-rate limiter / lerp interpolation
/// across 10-20ms audio chunks to eliminate clicks, pops, and discrete stepping.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct VolumeSmoother {
    sample_rate: u32,
    channels: usize,
    current_gain: f32,
    target_gain: f32,
    smoothing_window_ms: f32,
    alpha_per_sample: f32,
}

#[allow(dead_code)]
impl VolumeSmoother {
    /// Creates a new VolumeSmoother.
    ///
    /// # Arguments
    /// * `sample_rate` - e.g. 44100 or 48000 Hz
    /// * `channels` - e.g. 2 for stereo
    /// * `initial_volume_pct` - 0.0 to 100.0
    /// * `smoothing_window_ms` - 10.0 to 20.0 ms (typically 15.0 ms)
    pub fn new(
        sample_rate: u32,
        channels: usize,
        initial_volume_pct: f32,
        smoothing_window_ms: f32,
    ) -> Self {
        let sample_rate = sample_rate.max(8000);
        let channels = channels.max(1);
        let smoothing_window_ms = smoothing_window_ms.clamp(5.0, 50.0);
        let gain = (initial_volume_pct / 100.0).clamp(0.0, 1.0);

        // Exponential smoothing factor: 1 - exp(-1 / (sample_rate * tau))
        // tau = smoothing_window_ms / 1000.0 / 3.0 (reaches ~95% in window)
        let tau = (smoothing_window_ms / 1000.0) / 3.0;
        let samples_tau = (sample_rate as f32) * tau;
        let alpha = 1.0 - (-1.0 / samples_tau.max(1.0)).exp();

        Self {
            sample_rate,
            channels,
            current_gain: gain,
            target_gain: gain,
            smoothing_window_ms,
            alpha_per_sample: alpha,
        }
    }

    pub fn set_target_volume_pct(&mut self, volume_pct: f32) {
        self.target_gain = (volume_pct / 100.0).clamp(0.0, 1.0);
    }

    pub fn current_gain(&self) -> f32 {
        self.current_gain
    }

    pub fn target_gain(&self) -> f32 {
        self.target_gain
    }

    pub fn is_settled(&self) -> bool {
        (self.current_gain - self.target_gain).abs() < 1e-5
    }

    /// Process a buffer of interleaved 32-bit float PCM samples in-place.
    /// Vectorized/chunked sample-by-sample lerp prevents audio clicks and pops.
    pub fn process_f32(&mut self, buffer: &mut [f32]) {
        if buffer.is_empty() {
            return;
        }

        let num_frames = buffer.len() / self.channels;
        let channels = self.channels;

        for frame_idx in 0..num_frames {
            // Lerp current_gain towards target_gain
            self.current_gain += (self.target_gain - self.current_gain) * self.alpha_per_sample;
            if (self.current_gain - self.target_gain).abs() < 1e-6 {
                self.current_gain = self.target_gain;
            }

            let gain = self.current_gain;
            let offset = frame_idx * channels;
            for ch in 0..channels {
                buffer[offset + ch] *= gain;
            }
        }
    }

    /// Process a buffer of interleaved 16-bit integer PCM samples in-place.
    pub fn process_i16(&mut self, buffer: &mut [i16]) {
        if buffer.is_empty() {
            return;
        }

        let num_frames = buffer.len() / self.channels;
        let channels = self.channels;

        for frame_idx in 0..num_frames {
            self.current_gain += (self.target_gain - self.current_gain) * self.alpha_per_sample;
            if (self.current_gain - self.target_gain).abs() < 1e-6 {
                self.current_gain = self.target_gain;
            }

            let gain = self.current_gain;
            let offset = frame_idx * channels;
            for ch in 0..channels {
                let sample_f = buffer[offset + ch] as f32 * gain;
                buffer[offset + ch] = sample_f.clamp(-32768.0, 32767.0) as i16;
            }
        }
    }

    /// Calculates next volume step using exponential lerp for interval-based updates.
    /// Used by background smoother tasks (e.g. 10ms intervals).
    #[allow(dead_code)]
    pub fn step_toward(&mut self, dt_seconds: f32) -> f32 {
        let tau = (self.smoothing_window_ms / 1000.0) / 3.0;
        let alpha = 1.0 - (-dt_seconds / tau.max(0.001)).exp();
        self.current_gain += (self.target_gain - self.current_gain) * alpha;
        if (self.current_gain - self.target_gain).abs() < 0.001 {
            self.current_gain = self.target_gain;
        }
        self.current_gain * 100.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_volume_smoother_initialization() {
        let smoother = VolumeSmoother::new(44100, 2, 80.0, 15.0);
        assert!((smoother.current_gain() - 0.8).abs() < 1e-4);
        assert!((smoother.target_gain() - 0.8).abs() < 1e-4);
        assert!(smoother.is_settled());
    }

    #[test]
    fn test_volume_smoother_step_response_no_clicks() {
        let mut smoother = VolumeSmoother::new(44100, 2, 0.0, 15.0);
        smoother.set_target_volume_pct(100.0);

        // A chunk of 10ms = 441 frames = 882 samples stereo
        let mut buffer = vec![1.0f32; 882];
        smoother.process_f32(&mut buffer);

        // First sample should be close to 0, not jumping to 1.0
        assert!(buffer[0] < 0.05);
        // Last sample should be higher, demonstrating smooth slew
        assert!(buffer[buffer.len() - 1] > buffer[0]);
    }

    #[test]
    fn test_volume_smoother_settles_at_target() {
        let mut smoother = VolumeSmoother::new(44100, 2, 100.0, 15.0);
        smoother.set_target_volume_pct(0.0);

        // Process 50 ms of audio (enough to settle in a 15ms window)
        let mut buffer = vec![1.0f32; 4410 * 2];
        smoother.process_f32(&mut buffer);

        assert!(smoother.is_settled());
        assert!((smoother.current_gain() - 0.0).abs() < 1e-4);
        assert_eq!(buffer[buffer.len() - 1], 0.0);
    }

    #[test]
    fn test_i16_processing_bounds() {
        let mut smoother = VolumeSmoother::new(48000, 1, 50.0, 10.0);
        let mut buffer = vec![30000i16, -30000i16];
        smoother.process_i16(&mut buffer);

        assert!(buffer[0] <= 30000);
        assert!(buffer[1] >= -30000);
    }
}
