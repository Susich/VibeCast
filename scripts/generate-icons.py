"""Generates VibeCast app icons and web logo from assets/vibecast_logo.jpg."""

from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC_LOGO = ROOT / "assets" / "vibecast_logo.jpg"
ICONS_OUT = ROOT / "desktop" / "src-tauri" / "icons"
PUBLIC_OUT = ROOT / "desktop" / "public"
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

def main() -> None:
    print("Generating icons from assets/vibecast_logo.jpg...")
    base_icon = extract_and_mask_icon()
    
    # Save web logo as transparent PNG
    logo_512 = base_icon.resize((512, 512), Image.LANCZOS)
    logo_512.save(PUBLIC_OUT / "logo.png", "PNG")
    logo_512.save(ROOT / "assets" / "vibecast_icon.png", "PNG")
    # Also overwrite public/logo.jpg with RGB version if anything still references it
    logo_512.convert("RGB").save(PUBLIC_OUT / "logo.jpg", "JPEG", quality=95)
    
    # Tauri icon files
    for size, name in [
        (32, "32x32.png"),
        (128, "128x128.png"),
        (256, "128x128@2x.png"),
        (512, "icon.png"),
        (1024, "icon-1024.png"),
    ]:
        resized = base_icon.resize((size, size), Image.LANCZOS)
        resized.save(ICONS_OUT / name, "PNG")

    # Windows ICO file with all standard sizes
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    base_icon.save(ICONS_OUT / "icon.ico", format="ICO", sizes=ico_sizes)
    print(f"Icons successfully generated in {ICONS_OUT} and {PUBLIC_OUT}")

if __name__ == "__main__":
    main()
