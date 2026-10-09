"""Turns the Codex-generated art in art/raw into game, store and YouTube assets.

Usage: python3 -I tools/art/process.py <project-root>
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

root = Path(sys.argv[1])
raw = root / "art" / "raw"
out = root / "art" / "out"
assets = root / "assets"  # input for @capacitor/assets
pub = root / "public" / "img"
for d in (out, assets, pub):
    d.mkdir(parents=True, exist_ok=True)


def cut_white_background(img: Image.Image) -> Image.Image:
    """Flood-fills the white background from the borders and makes it transparent."""
    rgb = img.convert("RGB")
    key = (255, 0, 255)
    probe = rgb.copy()
    w, h = probe.size
    for x, y in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]:
        if probe.getpixel((x, y)) != key:
            ImageDraw.floodfill(probe, (x, y), key, thresh=42)
    mask = Image.new("L", (w, h), 255)
    mp = mask.load()
    pp = probe.load()
    for y in range(h):
        for x in range(w):
            if pp[x, y] == key:
                mp[x, y] = 0
    mask = mask.filter(ImageFilter.GaussianBlur(0.8))
    rgba = rgb.convert("RGBA")
    rgba.putalpha(mask)
    return rgba.crop(rgba.getbbox())


def cover(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Center-crops to the target aspect ratio, then resizes."""
    tw, th = size
    w, h = img.size
    scale = max(tw / w, th / h)
    nw, nh = round(w * scale), round(h * scale)
    img = img.resize((nw, nh), Image.LANCZOS)
    left, top = (nw - tw) // 2, (nh - th) // 2
    return img.crop((left, top, left + tw, top + th))


def gradient(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    w, h = size
    g = Image.new("RGB", (1, h))
    for y in range(h):
        k = y / (h - 1)
        g.putpixel((0, y), tuple(round(top[i] * (1 - k) + bottom[i] * k) for i in range(3)))
    return g.resize((w, h))


# --- logo -------------------------------------------------------------------
logo = cut_white_background(Image.open(raw / "logo.png"))
logo.save(out / "logo.png")
game_logo = logo.copy()
game_logo.thumbnail((1500, 1500), Image.LANCZOS)
game_logo.save(pub / "logo.webp", "WEBP", quality=88, method=6)

# --- app icon ---------------------------------------------------------------
icon = Image.open(raw / "icon.png").convert("RGB").resize((1024, 1024), Image.LANCZOS)
icon.save(assets / "icon-only.png")
icon.save(out / "icon_1024.png")
icon.resize((512, 512), Image.LANCZOS).save(out / "icon_512.png")

# Android adaptive icon: full-bleed art as background, transparent foreground.
icon.save(assets / "icon-background.png")
Image.new("RGBA", (1024, 1024), (0, 0, 0, 0)).save(assets / "icon-foreground.png")

# --- splash -----------------------------------------------------------------
for name in ("splash.png", "splash-dark.png"):
    splash = gradient((2732, 2732), (255, 241, 247), (222, 214, 255)).convert("RGBA")
    l = logo.copy()
    l.thumbnail((1500, 1500), Image.LANCZOS)
    splash.alpha_composite(l, ((2732 - l.width) // 2, (2732 - l.height) // 2 - 60))
    splash.convert("RGB").save(assets / name)

# --- YouTube / store thumbnails (no text, no logos) --------------------------
land = Image.open(raw / "keyart_land.png").convert("RGB")
port = Image.open(raw / "keyart_port.png").convert("RGB")
cover(land, (1920, 1080)).save(out / "thumb_16x9.jpg", quality=92)
cover(port, (1080, 1920)).save(out / "thumb_9x16.jpg", quality=92)
cover(port, (1080, 1080)).save(out / "thumb_1x1.jpg", quality=92)
cover(land, (1024, 500)).save(out / "play_feature_1024x500.jpg", quality=92)

for p in sorted(list(out.iterdir()) + list(assets.iterdir()) + list(pub.iterdir())):
    print(f"{p.relative_to(root)}  {p.stat().st_size // 1024} KiB")
