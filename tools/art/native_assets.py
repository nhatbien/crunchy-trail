"""Writes app icons and splash screens into the Capacitor iOS / Android projects.

Every existing placeholder image is replaced by a version of our art at the same pixel size.
Usage: python3 tools/art/native_assets.py <project-root>
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

root = Path(sys.argv[1])
icon = Image.open(root / "assets" / "icon-only.png").convert("RGB")
splash = Image.open(root / "assets" / "splash.png").convert("RGB")


def cover(img: Image.Image, w: int, h: int) -> Image.Image:
    s = max(w / img.width, h / img.height)
    r = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    left, top = (r.width - w) // 2, (r.height - h) // 2
    return r.crop((left, top, left + w, top + h))


def round_icon(size: int) -> Image.Image:
    img = icon.resize((size, size), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    img.putalpha(mask.resize((size, size), Image.LANCZOS))
    return img


count = 0
res = root / "android" / "app" / "src" / "main" / "res"
for p in res.rglob("*.png"):
    w, h = Image.open(p).size
    if p.name == "ic_launcher_round.png":
        round_icon(w).save(p)
    elif p.name in ("ic_launcher.png", "ic_launcher_foreground.png"):
        icon.resize((w, h), Image.LANCZOS).save(p)
    elif p.name == "splash.png":
        cover(splash, w, h).save(p)
    else:
        continue
    count += 1

xcassets = root / "ios" / "App" / "App" / "Assets.xcassets"
for p in (xcassets / "AppIcon.appiconset").glob("*.png"):
    w, h = Image.open(p).size
    icon.resize((w, h), Image.LANCZOS).save(p)
    count += 1
for p in (xcassets / "Splash.imageset").glob("*.png"):
    w, h = Image.open(p).size
    cover(splash, w, h).save(p)
    count += 1

bg = res / "values" / "ic_launcher_background.xml"
if bg.exists():
    bg.write_text('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#BFE3FF</color>\n</resources>\n')
print(f"updated {count} images")
