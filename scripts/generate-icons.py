"""Generates VibeCast app icons (no external assets required)."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "desktop" / "src-tauri" / "icons"
OUT.mkdir(parents=True, exist_ok=True)


def make_icon(size: int = 1024) -> Image.Image:
    scale = size / 1024
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # Dark rounded tile
    radius = int(210 * scale)
    draw.rounded_rectangle(
        (int(24 * scale), int(24 * scale), int(1000 * scale), int(1000 * scale)),
        radius=radius,
        fill=(11, 15, 20, 255),
        outline=(32, 45, 58, 255),
        width=max(1, int(8 * scale)),
    )

    # Green glow
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.rounded_rectangle(
        (int(200 * scale), int(200 * scale), int(824 * scale), int(824 * scale)),
        radius=int(180 * scale),
        fill=(74, 222, 128, 90),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(int(70 * scale)))
    image.alpha_composite(glow)

    # Green rounded square
    draw.rounded_rectangle(
        (int(214 * scale), int(214 * scale), int(810 * scale), int(810 * scale)),
        radius=int(190 * scale),
        fill=(74, 222, 128, 255),
    )

    # Play triangle
    draw.polygon(
        [
            (int(408 * scale), int(330 * scale)),
            (int(408 * scale), int(694 * scale)),
            (int(720 * scale), int(512 * scale)),
        ],
        fill=(11, 15, 20, 255),
    )

    return image


def main() -> None:
    base = make_icon(1024)
    for size, name in [
        (32, "32x32.png"),
        (128, "128x128.png"),
        (256, "128x128@2x.png"),
        (512, "icon.png"),
        (1024, "icon-1024.png"),
    ]:
        base.resize((size, size), Image.LANCZOS).save(OUT / name)

    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    base.save(OUT / "icon.ico", sizes=ico_sizes)
    print(f"icons written to {OUT}")


if __name__ == "__main__":
    main()
