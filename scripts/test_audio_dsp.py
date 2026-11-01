"""
Comprehensive test suite for VolumeSmoother and Theming Engine.
"""
import numpy as np
import sys
from pathlib import Path

# Add project root to sys.path
root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root))

from scripts.audio_dsp import VolumeSmoother
from themes import THEMES, get_theme, load_config, save_config

def test_volume_smoother_basic():
    print("Test 1: VolumeSmoother initialization and target setting...")
    smoother = VolumeSmoother(sample_rate=44100, channels=2, initial_volume=50.0, smoothing_window_ms=15.0)
    assert abs(smoother.current_gain - 0.5) < 1e-4
    assert abs(smoother.target_gain - 0.5) < 1e-4

    smoother.set_target_volume(100.0)
    assert abs(smoother.target_gain - 1.0) < 1e-4
    print("  -> Passed.")

def test_volume_smoother_no_clicks():
    print("Test 2: Click/pop prevention on rapid volume change...")
    smoother = VolumeSmoother(sample_rate=44100, channels=2, initial_volume=0.0, smoothing_window_ms=15.0)
    smoother.set_target_volume(100.0)

    # 10 ms chunk = 441 samples
    chunk = np.ones((441, 2), dtype=np.float32)
    processed = smoother.process(chunk)

    # First sample must be close to 0 to prevent audio click
    assert processed[0, 0] < 0.1, f"First sample {processed[0, 0]} exceeds click threshold"
    # End of chunk should ramp smoothly
    assert processed[-1, 0] > processed[0, 0], "Signal should ramp up"
    print(f"  -> Passed (ramp: {processed[0, 0]:.4f} -> {processed[-1, 0]:.4f}).")

def test_volume_smoother_reaches_target():
    print("Test 3: Volume settles cleanly at target...")
    smoother = VolumeSmoother(sample_rate=44100, channels=2, initial_volume=100.0, smoothing_window_ms=15.0)
    smoother.set_target_volume(0.0)

    # Process 50 ms of audio (enough to settle in a 15ms window)
    chunk = np.ones((2205, 2), dtype=np.float32)
    processed = smoother.process(chunk)

    assert abs(smoother.current_gain - 0.0) < 1e-3, f"Expected 0.0, got {smoother.current_gain}"
    assert processed[-1, 0] == 0.0, f"Expected last sample to be muted, got {processed[-1, 0]}"
    print("  -> Passed.")

def test_themes_palette_completeness():
    print("Test 4: Verification of dark theme palettes...")
    expected_themes = ["cyberpunk", "midnight", "catppuccin", "dracula", "nord"]
    assert len(THEMES) == len(expected_themes), f"Expected only {len(expected_themes)} dark themes, found {len(THEMES)}"
    for theme_id in expected_themes:
        theme = get_theme(theme_id)
        assert theme is not None, f"Missing theme: {theme_id}"
        assert theme.is_dark is True, f"Theme {theme_id} must be dark"
        tokens = theme.tokens
        for token_field in [
            "bg_primary", "bg_card", "accent", "accent_hover",
            "text_main", "text_muted", "border", "meter_gradient"
        ]:
            val = getattr(tokens, token_field, None)
            assert val is not None and len(val) > 0, f"Missing token {token_field} in theme {theme_id}"
    print(f"  -> All {len(expected_themes)} dark themes validated with all required color tokens.")

if __name__ == "__main__":
    test_volume_smoother_basic()
    test_volume_smoother_no_clicks()
    test_volume_smoother_reaches_target()
    test_themes_palette_completeness()
    print("\nAll Python Audio DSP and Themes tests passed successfully!")
