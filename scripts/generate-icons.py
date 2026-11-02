"""Generates VibeCast app icons and web logo from assets/vibecast_logo.jpg for Desktop and Android."""

from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC_LOGO = ROOT / "assets" / "vibecast_logo.jpg"
ICONS_OUT = ROOT / "desktop" / "src-tauri" / "icons"
PUBLIC_OUT = ROOT / "desktop" / "public"
RES_OUT = ROOT / "android" / "app" / "src" / "main" / "res"

ICONS_OUT.mkdir(parents=True, exist_ok=True)
PUBLIC_OUT.mkdir(parents=True, exist_ok=True)


def extract_and_mask_icon() -> Image.Image:
    if not SRC_LOGO.exists():
        raise FileNotFoundError(f"Source logo not found at {SRC_LOGO}")

    src = Image.open(SRC_LOGO).convert("RGBA")
    # Exact button bounding box (631x631)
    crop = src.crop((196, 196, 827, 827))
    W, H = crop.size

    # 4x supersampling for ultra smooth anti-aliased squircle edges
    scale = 4
    mask = Image.new("L", (W * scale, H * scale), 0)
    draw = ImageDraw.Draw(mask)
    radius = int(136 * scale)
    draw.rounded_rectangle((0, 0, W * scale, H * scale), radius=radius, fill=255)
    mask = mask.resize((W, H), Image.LANCZOS)

    crop.putalpha(mask)
    return crop


def make_round_icon(crop: Image.Image) -> Image.Image:
    W, H = crop.size
    scale = 4
    mask = Image.new("L", (W * scale, H * scale), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, W * scale, H * scale), fill=255)
    mask = mask.resize((W, H), Image.LANCZOS)
    res = crop.copy()
    res.putalpha(mask)
    return res


def main() -> None:
    print("Generating icons from assets/vibecast_logo.jpg...")
    base_icon = extract_and_mask_icon()
    raw_crop = Image.open(SRC_LOGO).convert("RGBA").crop((196, 196, 827, 827))
    round_icon = make_round_icon(raw_crop)

    # 1. Desktop & Web
    logo_512 = base_icon.resize((512, 512), Image.LANCZOS)
    logo_512.save(PUBLIC_OUT / "logo.png", "PNG")
    logo_512.save(ROOT / "assets" / "vibecast_icon.png", "PNG")
    logo_512.convert("RGB").save(PUBLIC_OUT / "logo.jpg", "JPEG", quality=95)

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

    print(f"Icons successfully generated for Desktop ({ICONS_OUT}) and Android ({RES_OUT})!")


if __name__ == "__main__":
    main()
