"""
Illustrative project images for the FICTIONAL demo workspace.

    python3 scripts/build-demo-images.py

Writes public/demo/*.jpg (1200x800) and *-thumb.jpg (600x400). They are original
renders — no real homes, people or stock photography — and the demo labels them
"Illustrative image". Drawn at 2x and downsampled for clean edges.
"""
import math
import os
import random

from PIL import Image, ImageChops, ImageDraw, ImageFilter

W, H = 1200, 800
S = 2  # supersample
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "demo")


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    return tuple(int(lerp(a, b, t)) for a, b in zip(c1, c2))


def canvas(color=(240, 236, 230)):
    return Image.new("RGB", (W * S, H * S), color)


def P(x, y):
    return (x * S, y * S)


def poly(d, pts, fill):
    d.polygon([P(*p) for p in pts], fill=fill)


def vgrad(img, box, top, bottom):
    x0, y0, x1, y1 = [int(v * S) for v in box]
    g = Image.new("RGB", (1, max(1, y1 - y0)))
    for y in range(y1 - y0):
        g.putpixel((0, y), mix(top, bottom, y / max(1, y1 - y0 - 1)))
    g = g.resize((max(1, x1 - x0), max(1, y1 - y0)))
    img.paste(g, (x0, y0))


def poly_grad(img, pts, top, bottom):
    """Fill a polygon with a vertical gradient."""
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    box = (min(xs), min(ys), max(xs), max(ys))
    layer = canvas()
    vgrad(layer, box, top, bottom)
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).polygon([P(*p) for p in pts], fill=255)
    img.paste(layer, (0, 0), mask)


def soft_shadow(img, pts, opacity=90, blur=18):
    sh = Image.new("L", img.size, 0)
    ImageDraw.Draw(sh).polygon([P(*p) for p in pts], fill=opacity)
    sh = sh.filter(ImageFilter.GaussianBlur(blur * S))
    dark = Image.new("RGB", img.size, (30, 24, 20))
    img.paste(dark, (0, 0), sh)


def glow(img, cx, cy, r, color=(255, 236, 200), strength=110):
    m = Image.new("L", img.size, 0)
    ImageDraw.Draw(m).ellipse([P(cx - r, cy - r), P(cx + r, cy + r)], fill=strength)
    m = m.filter(ImageFilter.GaussianBlur(r * S * 0.45))
    img.paste(Image.new("RGB", img.size, color), (0, 0), m)


def finish(img, name, warmth=(255, 214, 170), vignette=0.32, grain=6):
    img = img.resize((W, H), Image.LANCZOS)
    # warm light wash from upper left
    wash = Image.new("L", (W, H), 0)
    ImageDraw.Draw(wash).ellipse([-W * 0.3, -H * 0.6, W * 0.7, H * 0.7], fill=46)
    wash = wash.filter(ImageFilter.GaussianBlur(160))
    img.paste(Image.new("RGB", (W, H), warmth), (0, 0), wash)
    # vignette
    v = Image.new("L", (W, H), 0)
    ImageDraw.Draw(v).rectangle([0, 0, W, H], fill=int(255 * vignette))
    ImageDraw.Draw(v).ellipse([W * 0.05, H * 0.02, W * 0.95, H * 1.05], fill=0)
    v = v.filter(ImageFilter.GaussianBlur(140))
    img.paste(Image.new("RGB", (W, H), (20, 16, 14)), (0, 0), v)
    # fine grain
    rnd = random.Random(name)
    px = img.load()
    for _ in range(W * H // 3):
        x, y = rnd.randrange(W), rnd.randrange(H)
        r, g, b = px[x, y]
        n = rnd.randint(-grain, grain)
        px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    os.makedirs(OUT, exist_ok=True)
    img.save(os.path.join(OUT, f"{name}.jpg"), quality=84, optimize=True, progressive=True)
    img.resize((600, 400), Image.LANCZOS).save(os.path.join(OUT, f"{name}-thumb.jpg"), quality=80, optimize=True)


# ---------------------------------------------------------------- interiors

class Room:
    """One-point perspective room. Back wall is the rectangle (bx0,by0)-(bx1,by1)."""

    def __init__(self, bx0=330, by0=170, bx1=870, by1=560):
        self.bx0, self.by0, self.bx1, self.by1 = bx0, by0, bx1, by1
        self.vx, self.vy = (bx0 + bx1) / 2, by0 + (by1 - by0) * 0.55

    def to_front(self, x, y, t):
        """Point on the back wall (x,y) pulled toward the viewer by t (0 back, 1 picture plane)."""
        k = 1 + t * 1.6
        return (self.vx + (x - self.vx) * k, self.vy + (y - self.vy) * k)

    def shell(self, img, wall=(232, 226, 216), side=(220, 212, 200), floor=(178, 132, 92), ceiling=(244, 241, 236)):
        d = ImageDraw.Draw(img)
        b = self
        poly_grad(img, [(0, 0), (W, 0), (b.bx1, b.by0), (b.bx0, b.by0)], mix(ceiling, (255, 255, 255), 0.3), ceiling)
        poly_grad(img, [(0, 0), (b.bx0, b.by0), (b.bx0, b.by1), (0, H)], mix(side, (255, 255, 255), 0.1), mix(side, (0, 0, 0), 0.12))
        poly_grad(img, [(W, 0), (b.bx1, b.by0), (b.bx1, b.by1), (W, H)], mix(side, (0, 0, 0), 0.06), mix(side, (0, 0, 0), 0.2))
        vgrad(img, (b.bx0, b.by0, b.bx1, b.by1), mix(wall, (255, 255, 255), 0.15), mix(wall, (0, 0, 0), 0.06))
        poly_grad(img, [(b.bx0, b.by1), (b.bx1, b.by1), (W, H), (0, H)], mix(floor, (0, 0, 0), 0.12), mix(floor, (255, 255, 255), 0.05))
        # floor boards converging to the vanishing point, clipped to the floor
        lines = Image.new("L", img.size, 0)
        ld = ImageDraw.Draw(lines)
        for i in range(-14, 15):
            xb = b.vx + i * (b.bx1 - b.bx0) / 14
            ld.line([P(xb, b.by1), P(b.vx + (xb - b.vx) * 3.2, H + 260)], fill=255, width=2 * S)
        clip = Image.new("L", img.size, 0)
        ImageDraw.Draw(clip).polygon([P(b.bx0, b.by1), P(b.bx1, b.by1), P(W, H), P(0, H)], fill=255)
        img.paste(Image.new("RGB", img.size, mix(floor, (0, 0, 0), 0.18)), (0, 0), ImageChops.multiply(lines, clip))
        # skirting
        d.line([P(b.bx0, b.by1), P(b.bx1, b.by1)], fill=(250, 248, 244), width=5 * S)

    def window(self, img, x0, y0, x1, y1, sky=((170, 205, 235), (236, 244, 250)), bars=True):
        d = ImageDraw.Draw(img)
        d.rectangle([P(x0 - 8, y0 - 8), P(x1 + 8, y1 + 8)], fill=(250, 250, 248))
        vgrad(img, (x0, y0, x1, y1), *sky)
        # a soft band of distant greenery along the sill
        band = Image.new("L", img.size, 0)
        bd = ImageDraw.Draw(band)
        for k in range(10):
            cx = lerp(x0, x1, k / 9)
            r = (y1 - y0) * (0.16 + 0.06 * ((k * 7) % 3) / 2)
            bd.ellipse([P(cx - r * 1.3, y1 - r * 1.5), P(cx + r * 1.3, y1 + r)], fill=255)
        clipw = Image.new("L", img.size, 0)
        ImageDraw.Draw(clipw).rectangle([P(x0, y0), P(x1, y1)], fill=255)
        band = ImageChops.multiply(band.filter(ImageFilter.GaussianBlur(3 * S)), clipw)
        img.paste(Image.new("RGB", img.size, (132, 160, 120)), (0, 0), band)
        if bars:
            d.line([P((x0 + x1) / 2, y0), P((x0 + x1) / 2, y1)], fill=(250, 250, 248), width=6 * S)
            d.line([P(x0, (y0 + y1) / 2), P(x1, (y0 + y1) / 2)], fill=(250, 250, 248), width=6 * S)
        glow(img, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.9, (255, 246, 228), 70)


def shaker_door(d, x0, y0, x1, y1, color, inset=10):
    d.rectangle([P(x0, y0), P(x1, y1)], fill=color)
    d.rectangle([P(x0 + inset, y0 + inset), P(x1 - inset, y1 - inset)], outline=mix(color, (0, 0, 0), 0.22), width=2 * S)
    d.line([P(x0 + inset, y0 + inset + 1), P(x1 - inset, y0 + inset + 1)], fill=mix(color, (255, 255, 255), 0.25), width=S)


def kitchen():
    img = canvas()
    r = Room(300, 150, 900, 540)
    r.shell(img, wall=(236, 231, 222), side=(226, 219, 208), floor=(184, 140, 98))
    d = ImageDraw.Draw(img)
    navy = (52, 74, 92)
    oak = (196, 150, 104)
    # window over the sink
    r.window(img, 520, 215, 680, 345)
    # wall cabinets
    for x0, x1 in ((320, 500), (700, 880)):
        for i in range(3):
            a = x0 + i * (x1 - x0) / 3
            shaker_door(d, a + 2, 180, a + (x1 - x0) / 3 - 2, 310, navy, 9)
    # base units + worktop
    soft_shadow(img, [(300, 520), (900, 520), (900, 545), (300, 545)], 70, 10)
    for i in range(10):
        a = 300 + i * 60
        shaker_door(d, a + 2, 430, a + 58, 535, navy, 8)
        d.rectangle([P(a + 24, 446), P(a + 36, 449)], fill=(205, 180, 120))
    d.rectangle([P(296, 412), P(904, 432)], fill=oak)
    d.line([P(296, 412), P(904, 412)], fill=mix(oak, (255, 255, 255), 0.35), width=2 * S)
    # pendants
    for cx in (480, 600, 720):
        d.line([P(cx, 0), P(cx, 250)], fill=(40, 36, 32), width=2 * S)
        d.pieslice([P(cx - 34, 236), P(cx + 34, 300)], 180, 360, fill=(38, 36, 34))
        glow(img, cx, 300, 90, (255, 220, 160), 120)
    # island (box in perspective)
    fx0, fx1, top, bot = 390, 810, 590, 760
    soft_shadow(img, [(fx0 - 10, bot), (fx1 + 10, bot), (fx1 + 60, bot + 40), (fx0 - 60, bot + 40)], 120, 22)
    poly(d, [(fx0 + 40, top - 46), (fx1 - 40, top - 46), (fx1 + 12, top), (fx0 - 12, top)], mix(oak, (255, 255, 255), 0.12))
    poly(d, [(fx0 - 12, top), (fx1 + 12, top), (fx1 + 12, top + 20), (fx0 - 12, top + 20)], mix(oak, (0, 0, 0), 0.1))
    for i in range(4):
        a = fx0 + i * (fx1 - fx0) / 4
        shaker_door(d, a + 3, top + 24, a + (fx1 - fx0) / 4 - 3, bot, mix(navy, (0, 0, 0), 0.05), 10)
    # stools
    for cx in (470, 600, 730):
        d.ellipse([P(cx - 34, top - 70), P(cx + 34, top - 52)], fill=(64, 46, 34))
    # plant + bowl on worktop
    d.ellipse([P(830, 395), P(870, 415)], fill=(236, 232, 224))
    for k in range(7):
        a = math.pi * (0.1 + k * 0.13)
        d.line([P(850, 400), P(850 + math.cos(a) * 46 - 23, 400 - math.sin(a) * 52)], fill=(84, 120, 76), width=5 * S)
    finish(img, "kitchen")


def wardrobes():
    img = canvas()
    r = Room(250, 120, 950, 600)
    r.shell(img, wall=(232, 228, 220), side=(222, 216, 206), floor=(196, 162, 124))
    d = ImageDraw.Draw(img)
    sage = (148, 164, 140)
    soft_shadow(img, [(260, 590), (940, 590), (940, 610), (260, 610)], 80, 12)
    for i in range(6):
        a = 262 + i * 113
        shaker_door(d, a, 140, a + 110, 590, sage, 12)
        shaker_door(d, a + 8, 150, a + 102, 250, mix(sage, (255, 255, 255), 0.04), 8)
        hx = a + (98 if i % 2 == 0 else 12)
        d.rectangle([P(hx - 2, 330), P(hx + 2, 410)], fill=(196, 172, 120))
    d.rectangle([P(250, 126), P(950, 140)], fill=mix(sage, (255, 255, 255), 0.2))
    glow(img, 600, 70, 220, (255, 236, 205), 90)
    # rug and bench
    soft_shadow(img, [(420, 690), (780, 690), (840, 760), (360, 760)], 60, 30)
    poly(d, [(430, 660), (770, 660), (850, 760), (350, 760)], (226, 214, 196))
    d.rectangle([P(500, 600), P(700, 640)], fill=(120, 96, 74))
    d.rectangle([P(510, 640), P(520, 690)], fill=(90, 72, 56))
    d.rectangle([P(680, 640), P(690, 690)], fill=(90, 72, 56))
    finish(img, "wardrobes")


def staircase():
    img = canvas()
    r = Room(380, 110, 820, 580)
    r.shell(img, wall=(238, 234, 226), side=(228, 222, 212), floor=(176, 136, 96))
    d = ImageDraw.Draw(img)
    oak = (190, 146, 98)
    white = (246, 244, 240)
    # stairs rising from front-left to back wall
    n = 12
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        x0 = lerp(80, 400, t0)
        x1 = lerp(80, 400, t1)
        y = lerp(760, 230, t1)
        rise = (760 - 230) / n
        poly(d, [(x0, y + rise), (x1, y + rise), (x1 + 210 - 120 * t1, y + rise), (x0 + 210 - 120 * t0, y + rise)], oak)
        d.rectangle([P(x1, y), P(x1 + 205 - 120 * t1, y + rise)], fill=white)
        d.rectangle([P(x1, y - 6), P(x1 + 210 - 120 * t1, y + 2)], fill=mix(oak, (255, 255, 255), 0.1))
    # balustrade
    for i in range(n):
        t = (i + 0.5) / n
        x = lerp(300, 520, t)
        y = lerp(760, 230, t)
        d.rectangle([P(x - 3, y - 120), P(x + 3, y)], fill=white)
    d.line([P(270, 650), P(530, 110)], fill=oak, width=12 * S)
    d.rectangle([P(262, 600), P(292, 770)], fill=oak)
    # landing window + light
    r.window(img, 610, 170, 760, 380, bars=False)
    glow(img, 680, 300, 260, (255, 240, 214), 80)
    # console + art
    d.rectangle([P(860, 540), P(1080, 560)], fill=(120, 96, 74))
    d.rectangle([P(880, 320), P(1040, 470)], fill=(250, 248, 244))
    vgrad(img, (895, 335, 1025, 455), (214, 176, 140), (160, 120, 96))
    finish(img, "staircase")


def loft():
    img = canvas()
    d = ImageDraw.Draw(img)
    wall = (240, 236, 230)
    # sloped ceilings meeting a back wall
    bx0, by0, bx1, by1 = 400, 220, 800, 560
    poly_grad(img, [(0, 0), (W, 0), (bx1, by0), (bx0, by0)], (250, 248, 244), (236, 232, 226))
    poly_grad(img, [(0, 0), (bx0, by0), (bx0 - 40, 380), (0, 520)], (246, 243, 238), (226, 220, 212))
    poly_grad(img, [(W, 0), (bx1, by0), (bx1 + 40, 380), (W, 520)], (238, 234, 228), (218, 212, 204))
    poly_grad(img, [(0, 520), (bx0 - 40, 380), (bx0, by1), (0, H)], (232, 228, 220), (214, 208, 198))
    poly_grad(img, [(W, 520), (bx1 + 40, 380), (bx1, by1), (W, H)], (224, 218, 208), (204, 198, 188))
    vgrad(img, (bx0, by0, bx1, by1), wall, mix(wall, (0, 0, 0), 0.06))
    poly_grad(img, [(bx0, by1), (bx1, by1), (W, H), (0, H)], (186, 150, 112), (204, 170, 130))
    lines = Image.new("L", img.size, 0)
    for i in range(-12, 13):
        xb = 600 + i * 34
        ImageDraw.Draw(lines).line([P(xb, by1), P(600 + (xb - 600) * 3.4, H + 200)], fill=255, width=2 * S)
    clip = Image.new("L", img.size, 0)
    ImageDraw.Draw(clip).polygon([P(bx0, by1), P(bx1, by1), P(W, H), P(0, H)], fill=255)
    img.paste(Image.new("RGB", img.size, (166, 130, 94)), (0, 0), ImageChops.multiply(lines, clip))
    # roof windows on the slopes
    for pts in ([(150, 120), (300, 170), (290, 300), (130, 280)], [(1050, 120), (900, 170), (910, 300), (1070, 280)]):
        poly(d, [(x + (-8 if x < 600 else 8), y - 8) for x, y in pts], (250, 250, 248))
        poly_grad(img, pts, (160, 200, 236), (226, 238, 248))
        cx = sum(p[0] for p in pts) / 4
        glow(img, cx, 260, 200, (255, 246, 228), 90)
    # bed
    soft_shadow(img, [(430, 690), (770, 690), (820, 740), (380, 740)], 110, 24)
    d.rectangle([P(440, 470), P(760, 540)], fill=(132, 108, 86))
    poly(d, [(430, 560), (770, 560), (830, 700), (370, 700)], (246, 244, 240))
    poly(d, [(430, 600), (770, 600), (830, 700), (370, 700)], (210, 196, 176))
    d.rounded_rectangle([P(470, 530), P(590, 575)], radius=14 * S, fill=(252, 250, 246))
    d.rounded_rectangle([P(610, 530), P(730, 575)], radius=14 * S, fill=(252, 250, 246))
    # lamp
    d.rectangle([P(820, 520), P(880, 580)], fill=(150, 120, 90))
    d.polygon([P(830, 470), P(870, 470), P(882, 515), P(818, 515)], fill=(240, 228, 206))
    glow(img, 850, 495, 90, (255, 214, 150), 130)
    finish(img, "loft")


def media_wall():
    img = canvas()
    r = Room(240, 150, 960, 560)
    r.shell(img, wall=(70, 72, 76), side=(226, 220, 210), floor=(170, 132, 96))
    d = ImageDraw.Draw(img)
    panel = (64, 66, 70)
    vgrad(img, (240, 150, 960, 560), (78, 80, 86), (58, 60, 64))
    # recessed shelves both sides with LED strips
    for x0 in (270, 790):
        for k in range(3):
            y = 220 + k * 105
            d.rectangle([P(x0, y), P(x0 + 140, y + 82)], fill=(44, 44, 48))
            glow(img, x0 + 70, y + 6, 60, (255, 210, 150), 120)
            d.rectangle([P(x0 + 18 + k * 20, y + 40), P(x0 + 44 + k * 20, y + 80)], fill=(196, 176, 150))
    # TV + fire
    d.rectangle([P(470, 220), P(730, 370)], fill=(16, 18, 22))
    d.rectangle([P(476, 226), P(724, 364)], fill=(28, 34, 44))
    d.rectangle([P(450, 440), P(750, 500)], fill=(24, 22, 22))
    for k in range(16):
        x = 470 + k * 17
        d.polygon([P(x, 496), P(x + 8, 462 - (k % 4) * 6), P(x + 16, 496)], fill=(255, 160 + (k % 3) * 25, 70))
    glow(img, 600, 480, 160, (255, 170, 90), 120)
    # sofa
    soft_shadow(img, [(300, 740), (900, 740), (960, 790), (240, 790)], 120, 26)
    d.rounded_rectangle([P(300, 640), P(900, 740)], radius=22 * S, fill=(196, 186, 172))
    d.rounded_rectangle([P(320, 600), P(880, 660)], radius=20 * S, fill=(208, 198, 184))
    finish(img, "media-wall", vignette=0.36)


# ---------------------------------------------------------------- exteriors

def sky_and_ground(img, horizon=470, sky=((150, 190, 226), (232, 238, 240)), grass=((116, 150, 92), (88, 122, 70))):
    vgrad(img, (0, 0, W, horizon), *sky)
    vgrad(img, (0, horizon, W, H), *grass)
    d = ImageDraw.Draw(img)
    rnd = random.Random(horizon)
    for k in range(18):
        cx = rnd.randint(-40, W + 40)
        r = rnd.randint(60, 120)
        col = mix((86, 118, 78), (130, 156, 104), rnd.random())
        d.ellipse([P(cx - r, horizon - r * 1.7), P(cx + r, horizon + 10)], fill=col)
    for k in range(3):
        cx = rnd.randint(100, W - 100)
        d.ellipse([P(cx - 120, 80 + k * 40), P(cx + 120, 130 + k * 40)], fill=(246, 248, 250))


def garden_room():
    img = canvas()
    sky_and_ground(img, 480)
    d = ImageDraw.Draw(img)
    cedar = (168, 112, 72)
    # building: front face + right side (two-point lite)
    fx0, fx1, fy0, fy1 = 260, 820, 300, 640
    sx1, sy0, sy1 = 980, 330, 600
    soft_shadow(img, [(fx0, fy1), (sx1 + 60, sy1 + 20), (sx1 + 140, sy1 + 70), (fx0 + 40, fy1 + 60)], 120, 24)
    poly(d, [(fx1, fy0), (sx1, sy0), (sx1, sy1), (fx1, fy1)], mix(cedar, (0, 0, 0), 0.22))
    d.rectangle([P(fx0, fy0), P(fx1, fy1)], fill=cedar)
    for x in range(fx0, fx1, 14):
        d.line([P(x, fy0), P(x, fy1)], fill=mix(cedar, (0, 0, 0), 0.12), width=S)
    for k in range(int((sx1 - fx1) / 14)):
        x = fx1 + k * 14
        t = (x - fx1) / (sx1 - fx1)
        d.line([P(x, lerp(fy0, sy0, t)), P(x, lerp(fy1, sy1, t))], fill=mix(cedar, (0, 0, 0), 0.3), width=S)
    # roof edge
    poly(d, [(fx0 - 20, fy0 - 24), (fx1 + 10, fy0 - 24), (sx1 + 18, sy0 - 18), (sx1 + 18, sy0), (fx1, fy0), (fx0 - 20, fy0)], (46, 46, 48))
    # glazed doors with reflections
    gx0, gx1, gy0 = 330, 750, 360
    d.rectangle([P(gx0 - 8, gy0 - 8), P(gx1 + 8, fy1)], fill=(44, 44, 46))
    vgrad(img, (gx0, gy0, gx1, fy1 - 4), (186, 210, 228), (96, 112, 120))
    glow(img, 520, 520, 140, (255, 214, 160), 120)
    for k in range(1, 4):
        x = gx0 + k * (gx1 - gx0) / 4
        d.line([P(x, gy0), P(x, fy1)], fill=(44, 44, 46), width=6 * S)
    for k in range(4):
        x = gx0 + 30 + k * (gx1 - gx0) / 4
        poly(d, [(x, gy0), (x + 30, gy0), (x - 30, fy1 - 4), (x - 60, fy1 - 4)], (220, 232, 240))
    # deck
    poly(d, [(fx0 - 40, fy1), (sx1 + 40, sy1 + 10), (sx1 + 120, sy1 + 60), (fx0 - 10, fy1 + 70)], (150, 112, 80))
    for k in range(8):
        y = fy1 + k * 9
        d.line([P(fx0 - 36 + k * 4, y), P(sx1 + 44 + k * 10, sy1 + 10 + k * 7)], fill=(124, 92, 66), width=S)
    finish(img, "garden-room", warmth=(255, 226, 190))


def extension():
    img = canvas()
    sky_and_ground(img, 520, grass=((124, 156, 96), (92, 126, 74)))
    d = ImageDraw.Draw(img)
    brick = (166, 96, 72)
    # original house behind
    d.rectangle([P(180, 150), P(1020, 520)], fill=brick)
    for y in range(150, 520, 9):
        d.line([P(180, y), P(1020, y)], fill=mix(brick, (0, 0, 0), 0.12), width=S)
    poly(d, [(150, 160), (600, 40), (1050, 160)], (70, 66, 64))
    for x0 in (300, 640):
        d.rectangle([P(x0, 210), P(x0 + 140, 320)], fill=(248, 248, 246))
        vgrad(img, (x0 + 8, 218, x0 + 132, 312), (170, 196, 220), (224, 234, 242))
    # rear extension: flat roof, glazing, lantern
    ex0, ex1, ey0, ey1 = 220, 980, 380, 680
    soft_shadow(img, [(ex0, ey1), (ex1, ey1), (ex1 + 80, ey1 + 50), (ex0 + 40, ey1 + 50)], 120, 22)
    d.rectangle([P(ex0, ey0), P(ex1, ey1)], fill=(236, 232, 226))
    d.rectangle([P(ex0 - 14, ey0 - 22), P(ex1 + 14, ey0)], fill=(52, 52, 54))
    poly(d, [(520, ey0 - 22), (680, ey0 - 22), (650, ey0 - 64), (550, ey0 - 64)], (60, 60, 62))
    poly_grad(img, [(530, ey0 - 26), (670, ey0 - 26), (644, ey0 - 58), (556, ey0 - 58)], (186, 210, 228), (150, 176, 196))
    gx0, gx1, gy0 = 300, 900, 420
    d.rectangle([P(gx0 - 8, gy0 - 8), P(gx1 + 8, ey1)], fill=(48, 48, 50))
    vgrad(img, (gx0, gy0, gx1, ey1 - 4), (196, 214, 228), (110, 120, 124))
    glow(img, 600, 580, 220, (255, 220, 170), 120)
    for k in range(1, 5):
        x = gx0 + k * (gx1 - gx0) / 5
        d.line([P(x, gy0), P(x, ey1)], fill=(48, 48, 50), width=6 * S)
    for k in range(5):
        x = gx0 + 40 + k * (gx1 - gx0) / 5
        poly(d, [(x, gy0), (x + 34, gy0), (x - 26, ey1 - 4), (x - 60, ey1 - 4)], (224, 234, 240))
    # patio
    poly(d, [(ex0 - 60, ey1), (ex1 + 60, ey1), (ex1 + 160, H), (ex0 - 160, H)], (200, 194, 184))
    for k in range(1, 8):
        y = ey1 + k * (H - ey1) / 8
        d.line([P(ex0 - 60 - k * 12, y), P(ex1 + 60 + k * 12, y)], fill=(178, 172, 162), width=S)
    finish(img, "extension", warmth=(255, 226, 190))


if __name__ == "__main__":
    for f in (kitchen, wardrobes, staircase, loft, media_wall, garden_room, extension):
        f()
        print("wrote", f.__name__)
