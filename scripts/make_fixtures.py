"""Creates the test images in web/test/fixtures. Needs Pillow (pip install pillow).

They're generated rather than downloaded so the repository contains no one else's photos.
"""
import math
import pathlib
import random

from PIL import Image, ImageDraw, ImageFilter

OUT = pathlib.Path(__file__).resolve().parent.parent / "web" / "test" / "fixtures"
OUT.mkdir(parents=True, exist_ok=True)
random.seed(42)


def photo(width, height):
    """Smooth color fields plus sensor-like grain, so it compresses like a real photo."""
    img = Image.new("RGB", (width, height))
    px = img.load()
    for y in range(height):
        for x in range(width):
            noise = random.randint(-6, 6)
            r = int(255 * x / width) + noise
            g = int(255 * y / height) + noise
            b = int(128 + 100 * math.sin(x / 90) * math.cos(y / 70)) + noise
            px[x, y] = (max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)))
    return img


# A large camera-style photo.
photo(2400, 1600).save(OUT / "photo.jpg", quality=95)

# A portrait phone photo: stored sideways (600 wide, 400 tall) with EXIF orientation 6, which
# means "rotate 90 degrees clockwise to display". Shown correctly it's 400 x 600.
side = photo(600, 400)
ImageDraw.Draw(side).rectangle([0, 0, 120, 400], fill=(255, 0, 0))  # red band marks the top
exif = Image.Exif()
exif[0x0112] = 6
side.save(OUT / "portrait-rotated.jpg", quality=92, exif=exif)

# A logo: flat colors, soft edges, transparent background.
logo = Image.new("RGBA", (1200, 600), (0, 0, 0, 0))
draw = ImageDraw.Draw(logo)
draw.ellipse([60, 60, 540, 540], fill=(37, 99, 235, 255))
draw.rounded_rectangle([620, 160, 1140, 440], radius=60, fill=(249, 115, 22, 255))
draw.polygon([(300, 140), (420, 420), (180, 420)], fill=(255, 255, 255, 255))
logo = logo.filter(ImageFilter.GaussianBlur(1.2))  # anti-aliased edges, like real artwork
logo.save(OUT / "logo.png")

# Already heavily compressed: saving it again at normal quality would only make it bigger.
photo(320, 240).save(OUT / "compressed.jpg", quality=25)

# Not an image at all, despite the name.
(OUT / "not-an-image.jpg").write_text("this is plain text, not a JPEG\n")

for path in sorted(OUT.iterdir()):
    print(f"{path.name}: {path.stat().st_size} bytes")
