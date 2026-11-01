"""
Real-time Audio Volume Smoothing with NumPy Vector Operations.

Applies smooth exponential interpolation (lerp / slew-rate limiter)
across 10-20ms audio chunks to eliminate clicks, pops, and steps during
rapid volume slider manipulation.
"""
import numpy as np
from typing import Optional

class VolumeSmoother:
    def __init__(
        self,
        sample_rate: int = 44100,
        channels: int = 2,
        initial_volume: float = 80.0,
        smoothing_window_ms: float = 15.0,
    ):
        self.sample_rate = max(8000, int(sample_rate))
        self.channels = max(1, int(channels))
        self.smoothing_window_ms = float(np.clip(smoothing_window_ms, 5.0, 50.0))
        
        self.current_gain = float(np.clip(initial_volume / 100.0, 0.0, 1.0))
        self.target_gain = self.current_gain
        
        # Exponential time constant tau (reaches 95% in window_ms)
        tau = (self.smoothing_window_ms / 1000.0) / 3.0
        samples_tau = self.sample_rate * tau
        self.alpha_per_sample = float(1.0 - np.exp(-1.0 / max(1.0, samples_tau)))

    def set_target_volume(self, volume_percent: float) -> None:
        """Sets target volume immediately without debouncing."""
        self.target_gain = float(np.clip(volume_percent / 100.0, 0.0, 1.0))

    def process(self, pcm_chunk: np.ndarray, target_volume: Optional[float] = None) -> np.ndarray:
        """
        Applies volume smoothing directly to a PCM audio buffer.
        
        pcm_chunk: NumPy array of shape (N, channels) or (N,)
        Returns processed audio array with smooth volume envelope applied.
        """
        if target_volume is not None:
            self.set_target_volume(target_volume)

        if pcm_chunk.size == 0:
            return pcm_chunk

        is_int16 = pcm_chunk.dtype == np.int16
        data = pcm_chunk.astype(np.float32)

        num_frames = data.shape[0]
        
        if abs(self.current_gain - self.target_gain) < 1e-5:
            # Steady state - fast vector scalar multiplication
            self.current_gain = self.target_gain
            data *= self.current_gain
        else:
            # Vectorized exponential curve generation
            n = np.arange(1, num_frames + 1, dtype=np.float32)
            decay = np.power(1.0 - self.alpha_per_sample, n)
            # gain[n] = target + (current - target) * (1 - alpha)^n
            gains = self.target_gain + (self.current_gain - self.target_gain) * decay
            gains[np.abs(gains - self.target_gain) < 1e-4] = self.target_gain
            
            # Reshape for multi-channel broadcasting
            if data.ndim == 2:
                gains = gains[:, np.newaxis]
            
            data *= gains
            self.current_gain = float(gains[-1] if data.ndim == 1 else gains[-1, 0])
            if abs(self.current_gain - self.target_gain) < 1e-4:
                self.current_gain = self.target_gain

        if is_int16:
            return np.clip(data, -32768, 32767).astype(np.int16)
        return data

if __name__ == "__main__":
    print("Testing VolumeSmoother with NumPy...")
    smoother = VolumeSmoother(sample_rate=44100, channels=2, initial_volume=0.0)
    smoother.set_target_volume(100.0)
    
    # 10ms chunk = 441 frames
    chunk = np.ones((441, 2), dtype=np.float32)
    processed = smoother.process(chunk)
    print(f"Processed 10ms chunk: start gain = {processed[0, 0]:.4f}, end gain = {processed[-1, 0]:.4f}")
    assert processed[0, 0] < 0.1, "First sample should not click/jump"
    assert processed[-1, 0] > processed[0, 0], "Volume should smoothly increase"
    print("VolumeSmoother NumPy test passed successfully!")
