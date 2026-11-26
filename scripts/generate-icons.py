"""Generates minimalist VibeCast app icons and web logo for Desktop and Android."""

import math
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC_LOGO = ROOT / "assets" / "vibecast_logo.jpg"
ICONS_OUT = ROOT / "desktop" / "src-tauri" / "icons"
PUBLIC_OUT = ROOT / "desktop" / "public"
RES_OUT = ROOT / "android" / "app" / "src" / "main" / "res"

ICONS_OUT.mkdir(parents=True, exist_ok=True)
PUBLIC_OUT.mkdir(parents=True, exist_ok=True)


def lerp_color(c1: tuple[int, int, int], c2: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    t = max(0.0, min(1.0, t))
    return (
        int(c1[0] + (c2[0] - c1[0]) * t),
        int(c1[1] + (c2[1] - c1[1]) * t),
        int(c1[2] + (c2[2] - c1[2]) * t),
    )


def create_minimalist_logo(size: int = 1024) -> Image.Image:
    """Render a crisp, minimalist geometric VibeCast icon at `size`x`size` with 2x supersampling."""
    ss = 2
    w = size * ss
    h = size * ss

    # 1. Subtle dark gradient background (#121923 -> #090C11)
    bg = Image.new("RGBA", (w, h), (11, 15, 20, 255))
    bg_px = bg.load()
    top_c = (18, 25, 36)
    bot_c = (9, 12, 17)
    for y in range(h):
        c = lerp_color(top_c, bot_c, y / max(1, h - 1))
        for x in range(w):
            bg_px[x, y] = (c[0], c[1], c[2], 255)

    # 2. Squircle alpha mask
    mask = Image.new("L", (w, h), 0)
    mask_draw = ImageDraw.Draw(mask)
    radius = int(w * 0.225)
    mask_draw.rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=255)
    bg.putalpha(mask)

    # 3. Subtle inner border for depth on dark backgrounds
    border_layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    border_draw = ImageDraw.Draw(border_layer)
    border_w = max(2, int(w * 0.008))
    border_draw.rounded_rectangle(
        (border_w // 2, border_w // 2, w - 1 - border_w // 2, h - 1 - border_w // 2),
        radius=radius,
        outline=(255, 255, 255, 28),
        width=border_w,
    )
    bg = Image.alpha_composite(bg, border_layer)

    # 4. Minimalist geometric "V" + clean soundwave accent
    # Draw symbol mask in grayscale first, then apply crisp cyan->mint gradient
    sym_mask = Image.new("L", (w, h), 0)
    sym_draw = ImageDraw.Draw(sym_mask)

    cx = w * 0.50
    top_y = h * 0.30
    bot_y = h * 0.72
    left_x = w * 0.27
    right_x = w * 0.73
    stroke = w * 0.095
    r_cap = stroke / 2.0

    def draw_capsule(p1: tuple[float, float], p2: tuple[float, float], rad: float) -> None:
        sym_draw.line([p1, p2], fill=255, width=int(round(rad * 2)))
        for px, py in (p1, p2):
            sym_draw.ellipse((px - rad, py - rad, px + rad, py + rad), fill=255)

    # Left & right arms of minimalist V
    draw_capsule((left_x, top_y), (cx, bot_y), r_cap)
    draw_capsule((right_x, top_y), (cx, bot_y), r_cap)

    # Minimalist center audio dot / pulse inside the V
    dot_r = w * 0.048
    dot_cy = h * 0.36
    sym_draw.ellipse((cx - dot_r, dot_cy - dot_r, cx + dot_r, dot_cy + dot_r), fill=255)

    # Gradient fill for the symbol (#00F0FF -> #4ADE80)
    grad = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    grad_px = grad.load()
    c_start = (0, 240, 255)   # VibeCyan / Accent
    c_end = (74, 222, 128)    # VibeGreen
    for y in range(h):
        t = (y - top_y) / max(1.0, (bot_y - top_y))
        c = lerp_color(c_start, c_end, t)
        for x in range(w):
            grad_px[x, y] = (c[0], c[1], c[2], 255)

    grad.putalpha(sym_mask)
    composed = Image.alpha_composite(bg, grad)
    return composed.resize((size, size), Image.LANCZOS)


def make_round_icon(img: Image.Image) -> Image.Image:
    W, H = img.size
    scale = 2
    mask = Image.new("L", (W * scale, H * scale), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, W * scale - 1, H * scale - 1), fill=255)
    mask = mask.resize((W, H), Image.LANCZOS)
    # Fill opaque dark background behind round icon so corners don't clip transparently
    base = Image.new("RGBA", (W, H), (11, 15, 20, 255))
    base.paste(img, (0, 0), img)
    base.putalpha(mask)
    return base


def main() -> None:
    print("Generating minimalist VibeCast icons...")
    base_icon = create_minimalist_logo(1024)

    # Save master JPEG in assets/vibecast_logo.jpg on dark background
    master_rgb = Image.new("RGB", base_icon.size, (11, 15, 20))
    master_rgb.paste(base_icon, (0, 0), base_icon)
    master_rgb.save(SRC_LOGO, "JPEG", quality=96)

    round_icon = make_round_icon(base_icon)

    # 1. Desktop & Web
    logo_512 = base_icon.resize((512, 512), Image.LANCZOS)
    logo_512.save(PUBLIC_OUT / "logo.png", "PNG")
    logo_512.save(ROOT / "assets" / "vibecast_icon.png", "PNG")
    logo_512_rgb = Image.new("RGB", logo_512.size, (11, 15, 20))
    logo_512_rgb.paste(logo_512, (0, 0), logo_512)
    logo_512_rgb.save(PUBLIC_OUT / "logo.jpg", "JPEG", quality=95)

    for size, name in [
        (32, "32x32.png"),
        (128, "128x128.png"),
        (256, "128x128@2x.png"),
        (512, "icon.png"),
        (1024, "icon-1024.png"),
    ]:
        resized = base_icon.resize((size, size), Image.LANCZOS)
        resized.save(ICONS_OUT / name, "PNG")

    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    base_icon.save(ICONS_OUT / "icon.ico", format="ICO", sizes=ico_sizes)

    # 2. Android Mipmaps
    densities = {
        "mipmap-mdpi": (48, 108),
        "mipmap-hdpi": (72, 162),
        "mipmap-xhdpi": (96, 216),
        "mipmap-xxhdpi": (144, 324),
        "mipmap-xxxhdpi": (192, 432),
    }

    for folder, (size, fg_size) in densities.items():
        out_dir = RES_OUT / folder
        out_dir.mkdir(parents=True, exist_ok=True)

        # Legacy squircle icon
        img = base_icon.resize((size, size), Image.LANCZOS)
        img.save(out_dir / "ic_launcher.png", "PNG")

        # Legacy round icon
        r_img = round_icon.resize((size, size), Image.LANCZOS)
        r_img.save(out_dir / "ic_launcher_round.png", "PNG")

        # Adaptive icon foreground (centered inside canvas with ~72% safe zone)
        fg = Image.new("RGBA", (fg_size, fg_size), (0, 0, 0, 0))
        inner_size = int(fg_size * 0.72)
        offset = (fg_size - inner_size) // 2
        inner = base_icon.resize((inner_size, inner_size), Image.LANCZOS)
        fg.paste(inner, (offset, offset), inner)
        fg.save(out_dir / "ic_launcher_foreground.png", "PNG")

    # Android Adaptive XMLs
    anydpi = RES_OUT / "mipmap-anydpi-v26"
    anydpi.mkdir(parents=True, exist_ok=True)

    adaptive_xml = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@color/ic_launcher_background" />\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
        '</adaptive-icon>\n'
    )
    (anydpi / "ic_launcher.xml").write_text(adaptive_xml, encoding="utf-8")
    (anydpi / "ic_launcher_round.xml").write_text(adaptive_xml, encoding="utf-8")

    # Android Color resource
    values_dir = RES_OUT / "values"
    colors_xml = values_dir / "colors.xml"
    colors_xml.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<resources>\n'
        '    <color name="ic_launcher_background">#0B0F14</color>\n'
        '</resources>\n',
        encoding="utf-8",
    )

    print(f"Minimalist icons successfully generated for Desktop ({ICONS_OUT}) and Android ({RES_OUT})!")


if __name__ == "__main__":
    main()
