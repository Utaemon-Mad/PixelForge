"""Generadores procedurales de pixel art (32x32) y utilidades de color/animación.

Cada generador devuelve una cuadrícula 32x32 (lista de filas) con colores
"#rrggbb" o None para los píxeles transparentes.
"""

import colorsys
import math
import random

S = 32  # tamaño base de los generadores


# ---------------------------------------------------------------- color ----

def hex_to_rgb(c):
    return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))


def rgb_to_hex(r, g, b):
    clamp = lambda v: max(0, min(255, int(round(v))))
    return "#%02x%02x%02x" % (clamp(r), clamp(g), clamp(b))


def blend(a, b, t):
    """Mezcla el color a hacia b en proporción t (0..1)."""
    ra, ga, ba = hex_to_rgb(a)
    rb, gb, bb = hex_to_rgb(b)
    return rgb_to_hex(ra + (rb - ra) * t, ga + (gb - ga) * t, ba + (bb - ba) * t)


def hsl(h, s, l):
    r, g, b = colorsys.hls_to_rgb(h % 1.0, l, s)
    return rgb_to_hex(r * 255, g * 255, b * 255)


def _hue_toward(h, target, amt):
    d = ((target - h + 0.5) % 1.0) - 0.5
    return (h + d * amt) % 1.0


def make_ramp(base, n=5):
    """Rampa de n tonos (oscuro -> claro) con desplazamiento de matiz:
    las sombras tiran hacia el violeta y las luces hacia el amarillo."""
    r, g, b = (v / 255 for v in hex_to_rgb(base))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    mid = (n - 1) / 2
    out = []
    for i in range(n):
        k = (i - mid) / mid if mid else 0
        nl = min(0.95, max(0.05, l + k * 0.28))
        if k < 0:
            nh = _hue_toward(h, 0.72, -k * 0.12)
            ns = min(1.0, s * (1 - k * 0.15))
        else:
            nh = _hue_toward(h, 0.14, k * 0.10)
            ns = s * (1 - k * 0.2)
        out.append(hsl(nh, ns, nl))
    return out


# --------------------------------------------------------------- boceto ----

class Sketch:
    """Lienzo de 'materiales'. Al renderizar, cada material se sombrea con su
    rampa (luz desde arriba-izquierda) y se añade un contorno selectivo."""

    def __init__(self):
        self.m = [[None] * S for _ in range(S)]

    def get(self, x, y):
        return self.m[y][x] if 0 <= x < S and 0 <= y < S else None

    def set(self, x, y, mat):
        x, y = int(x), int(y)
        if 0 <= x < S and 0 <= y < S:
            self.m[y][x] = mat

    def rect(self, x0, y0, x1, y1, mat, sym=False):
        for y in range(int(min(y0, y1)), int(max(y0, y1)) + 1):
            for x in range(int(min(x0, x1)), int(max(x0, x1)) + 1):
                self.set(x, y, mat)
                if sym:
                    self.set(S - 1 - x, y, mat)

    def ellipse(self, cx, cy, rx, ry, mat, cond=None):
        for y in range(S):
            for x in range(S):
                if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 and (cond is None or cond(x, y)):
                    self.m[y][x] = mat

    def render(self, ramps):
        # caja de cada material, para oscurecer su parte baja
        boxes = {}
        for y in range(S):
            for x in range(S):
                m = self.m[y][x]
                if m is not None:
                    y0, y1 = boxes.get(m, (y, y))
                    boxes[m] = (min(y0, y), max(y1, y))

        out = [[None] * S for _ in range(S)]
        for y in range(S):
            for x in range(S):
                m = self.m[y][x]
                if m is None:
                    continue
                ramp = ramps[m]
                if isinstance(ramp, str):  # color plano (ojos, brillos)
                    out[y][x] = ramp
                    continue
                up = self.get(x, y - 1) != m
                left = self.get(x - 1, y) != m
                down = self.get(x, y + 1) != m
                right = self.get(x + 1, y) != m
                idx = 2 + (up or left) + (up and left) - (down or right) - (down and right)
                y0, y1 = boxes[m]
                if idx == 2 and y1 - y0 >= 4 and (y - y0) / (y1 - y0 + 1) > 0.7:
                    idx = 1
                out[y][x] = ramp[max(0, min(len(ramp) - 1, idx))]

        # contorno selectivo: usa el tono más oscuro del material vecino
        res = [row[:] for row in out]
        for y in range(S):
            for x in range(S):
                if self.m[y][x] is not None:
                    continue
                for nx, ny in ((x, y + 1), (x, y - 1), (x + 1, y), (x - 1, y)):
                    nm = self.get(nx, ny)
                    if nm is not None:
                        ramp = ramps[nm]
                        dark = ramp if isinstance(ramp, str) else ramp[0]
                        res[y][x] = blend(dark, "#000000", 0.45)
                        break
        return res


# ----------------------------------------------------------- personajes ----

SKINS = ["#f2c7a5", "#e0a77f", "#c68653", "#8d5524", "#ffdbac", "#8fc27a", "#9fb4e0"]
HAIRS = ["#3b2a1e", "#e8c063", "#a33a2a", "#2b2b3a", "#d8d8e0", "#5a7bd8", "#e070a0", "#6a4a2a"]
BOOTS = ["#5a3a22", "#3b2f2f", "#4a4a5a", "#2f3b2a"]


def personaje(seed, pose=0):
    """Humanoide de frente. pose 0..3 = ciclo de caminar (0 y 2 neutros,
    1 levanta la pierna izquierda, 3 la derecha)."""
    r = random.Random(seed)
    skin = r.choice(SKINS)
    hair = r.choice(HAIRS)
    cloth = hsl(r.random(), r.uniform(0.45, 0.75), r.uniform(0.38, 0.55))
    pants = hsl(r.random(), r.uniform(0.2, 0.5), r.uniform(0.25, 0.4))
    boots = r.choice(BOOTS)
    hat_col = hsl(r.random(), r.uniform(0.4, 0.7), r.uniform(0.3, 0.5))
    rx = r.choice([5, 5, 6])
    ry = r.choice([5, 6])
    tw = r.choice([4, 5, 5, 6])
    th = r.choice([7, 8, 8])
    aw = r.choice([2, 2, 3])
    ex = r.choice([2, 3])
    hat = r.random() < 0.35
    sword = r.random() < 0.35
    long_hair = r.random() < 0.4
    belt = r.random() < 0.6

    oy = -1 if pose in (1, 3) else 0          # rebote del cuerpo
    swing = {0: 0, 1: 1, 2: 0, 3: -1}[pose]  # balanceo de brazos

    sk = Sketch()
    cy = 3 + ry + oy
    tt = cy + ry
    hip = tt + th

    # piernas y botas
    lw = max(3, tw - 1)
    for side, lifted in ((0, pose == 1), (1, pose == 3)):
        x0, x1 = (15 - lw, 14) if side == 0 else (17, 16 + lw)
        bottom = 29 - (1 if lifted else 0)
        sk.rect(x0, hip, x1, bottom - 3, "pants")
        sk.rect(x0, bottom - 2, x1, bottom, "boots")

    # torso y cinturón
    sk.rect(16 - tw, tt, 15 + tw, hip - 1, "cloth")
    if belt:
        sk.rect(16 - tw, hip - 2, 15 + tw, hip - 2, "belt")

    # brazos (manga + mano)
    for side, dy in ((0, swing), (1, -swing)):
        x0, x1 = (16 - tw - aw, 15 - tw) if side == 0 else (16 + tw, 15 + tw + aw)
        sk.rect(x0, tt + 1 + dy, x1, hip - 3 + dy, "arm")
        sk.rect(x0, hip - 2 + dy, x1, hip - 1 + dy, "skin")

    # pelo largo (detrás de la cabeza), cabeza, pelo de arriba
    if long_hair:
        sk.rect(16 - rx - 1, cy, 16 - rx, cy + ry + 3, "hair", sym=True)
    sk.ellipse(15.5, cy, rx + 0.5, ry + 0.5, "skin")
    sk.ellipse(15.5, cy - 1, rx + 1.2, ry + 0.8, "hair", cond=lambda x, y: y <= cy - ry * 0.25)

    # ojos
    for x in (15 - ex, 16 + ex):
        sk.set(x, cy + 1, "eye")
        if rx >= 6:
            sk.set(x, cy, "eye")

    # sombrero
    if hat:
        yb = int(cy - ry * 0.35)
        sk.rect(16 - rx - 2, yb, 15 + rx + 2, yb, "hat")
        sk.rect(16 - rx + 1, yb - 4, 15 + rx - 1, yb - 1, "hat")

    # espada en la mano derecha
    if sword:
        hx = 16 + tw + aw // 2
        hy = hip - 2 - swing
        sk.rect(hx, max(1, hy - 10), hx, hy - 2, "blade")
        sk.rect(hx - 1, hy - 1, hx + 1, hy - 1, "guard")

    ramps = {
        "skin": make_ramp(skin), "hair": make_ramp(hair), "cloth": make_ramp(cloth),
        "arm": make_ramp(cloth), "pants": make_ramp(pants), "boots": make_ramp(boots),
        "belt": make_ramp("#4a2f1c"), "hat": make_ramp(hat_col),
        "blade": make_ramp("#b8c4d0"), "guard": make_ramp("#d8a838"), "eye": "#1b1b2a",
    }
    return sk.render(ramps)


def personaje_caminando(seed):
    return [personaje(seed, pose) for pose in range(4)]


# ------------------------------------------------------------ criaturas ----

def criatura(seed):
    """Criatura simétrica a partir de ruido + autómata celular."""
    r = random.Random(seed)
    alive = [[False] * S for _ in range(S)]
    for y in range(3, 29):
        for x in range(3, 16):
            dx = (15.5 - x) / 12.5
            dy = (y - 16) / 13
            if r.random() < 0.78 - (dx * dx + dy * dy) * 0.65:
                alive[y][x] = alive[y][S - 1 - x] = True
    for _ in range(2):  # suavizado (la regla es simétrica, así que la simetría se conserva)
        nxt = [[False] * S for _ in range(S)]
        for y in range(1, S - 1):
            for x in range(1, S - 1):
                n = sum(alive[y + j][x + i] for j in (-1, 0, 1) for i in (-1, 0, 1) if i or j)
                nxt[y][x] = n >= 5 or (alive[y][x] and n >= 4)
        alive = nxt

    # nos quedamos con la mancha más grande para evitar píxeles sueltos
    seen = set()
    best = []
    for y in range(S):
        for x in range(S):
            if alive[y][x] and (x, y) not in seen:
                comp, stack = [], [(x, y)]
                seen.add((x, y))
                while stack:
                    cx, cy = stack.pop()
                    comp.append((cx, cy))
                    for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                        if 0 <= nx < S and 0 <= ny < S and alive[ny][nx] and (nx, ny) not in seen:
                            seen.add((nx, ny))
                            stack.append((nx, ny))
                if len(comp) > len(best):
                    best = comp
    if len(best) < 40:  # demasiado pequeña: probamos otra semilla
        return criatura(seed + 7919)

    sk = Sketch()
    for x, y in best:
        sk.set(x, y, "body")
    ys = [y for _, y in best]
    top, bottom = min(ys), max(ys)
    mid = (top + bottom) / 2

    # barriga clara
    if r.random() < 0.6:
        for x, y in best:
            if abs(x - 15.5) < 3 and y > mid and all(sk.get(x + i, y + j) for i, j in ((1, 0), (-1, 0), (0, 1))):
                sk.set(x, y, "belly")

    # manchas simétricas
    if r.random() < 0.5:
        for _ in range(r.randint(2, 4)):
            x, y = r.choice(best)
            if x < 13 and sk.get(x, y) == "body":
                sk.set(x, y, "spot")
                sk.set(S - 1 - x, y, "spot")

    # ojos en el tercio superior, donde haya cuerpo alrededor
    cand = []
    for y in range(top + 2, int(mid) + 1):
        for ex in range(2, 7):
            x = 15 - ex
            if all(sk.get(x + i, y + j) == "body" for i in (-1, 0, 1, 2) for j in (-1, 0, 1, 2)):
                cand.append((x, y))
    if cand:
        x, y = r.choice(cand)
        sk.rect(x, y, x + 1, y + 1, "eyew", sym=True)
        sk.set(x + 1, y + 1, "eye")
        sk.set(S - 2 - x, y + 1, "eye")

    h = r.random()
    body = hsl(h, r.uniform(0.45, 0.7), r.uniform(0.42, 0.55))
    ramps = {
        "body": make_ramp(body), "belly": make_ramp(hsl(h + 0.08, 0.5, 0.72)),
        "spot": make_ramp(hsl(h + 0.5, 0.55, 0.5)), "eyew": "#f4f4f8", "eye": "#141420",
    }
    return sk.render(ramps)


# -------------------------------------------------------------- objetos ----

def pocion(seed):
    r = random.Random(seed)
    sk = Sketch()
    rad = r.choice([7, 8, 8, 9])
    cy = 29 - rad
    body_top = cy - rad
    square = r.random() < 0.3
    neck_top = body_top - 4
    sk.rect(14, neck_top, 17, body_top + 1, "glass")
    sk.rect(13, neck_top, 18, neck_top, "glass")
    sk.rect(14, neck_top - 3, 17, neck_top - 1, "cork")
    level = cy - rad * r.uniform(-0.1, 0.4)
    if square:
        sk.rect(16 - rad, body_top + 1, 15 + rad, 28, "glass")
        sk.rect(17 - rad, int(level), 14 + rad, 27, "liquid")
    else:
        sk.ellipse(15.5, cy, rad + 0.5, rad + 0.5, "glass")
        sk.ellipse(15.5, cy, rad - 0.5, rad - 0.5, "liquid", cond=lambda x, y: y >= level)
    sx, sy = int(15.5 - rad * 0.5), int(cy - rad * 0.3)
    sk.set(sx, sy, "shine")
    sk.set(sx, sy + 1, "shine")
    ramps = {
        "glass": make_ramp("#9cc4d8"), "cork": make_ramp("#9a6a3e"),
        "liquid": make_ramp(hsl(r.random(), 0.75, 0.5)), "shine": "#ffffff",
    }
    return sk.render(ramps)


def espada(seed):
    r = random.Random(seed)
    sk = Sketch()
    length = r.randint(13, 18)
    for i in range(length):  # hoja diagonal de 2 px
        x, y = 9 + i, 22 - i
        sk.set(x, y, "blade")
        if i < length - 1:
            sk.set(x + 1, y, "edge")
    for i in range(-3, 4):  # guarda perpendicular
        sk.set(8 + i, 23 + i, "guard")
        sk.set(9 + i, 23 + i, "guard")
    for i in range(1, 4):  # empuñadura
        sk.set(7 - i + 1, 24 + i - 1, "grip")
    sk.rect(3, 27, 4, 28, "guard")  # pomo
    if r.random() < 0.5:
        sk.set(8, 23, "gem")
    metal = r.choice(["#b8c4d0", "#c8b89a", "#8fd0e0", "#d0a0a0"])
    guard = r.choice(["#d8a838", "#a0a8b8", "#b04030", "#4a8a4a"])
    ramps = {
        "blade": make_ramp(metal), "edge": make_ramp(blend(metal, "#ffffff", 0.35)),
        "guard": make_ramp(guard), "grip": make_ramp(r.choice(["#5a3a22", "#3a2a4a", "#2a3a5a"])),
        "gem": hsl(r.random(), 0.8, 0.55),
    }
    return sk.render(ramps)


def gema(seed):
    r = random.Random(seed)
    sk = Sketch()
    a = r.randint(9, 12)       # medio ancho
    crown = r.randint(4, 6)    # altura de la corona
    pav = r.randint(10, 13)    # altura del pabellón
    cy = 4 + crown
    for y in range(S):
        for x in range(S):
            dx = abs(x - 15.5)
            if cy - crown <= y < cy:
                if dx <= a - (cy - y) * 0.8:
                    table = dx <= a * 0.35 and y < cy - crown / 2
                    sk.set(x, y, "table" if table else "crown")
            elif cy <= y <= cy + pav:
                if dx <= a * (1 - (y - cy) / pav):
                    sk.set(x, y, "pav" if x < 16 else "pav2")
    sk.set(int(15.5 - a * 0.5), cy - 2, "shine")
    base = hsl(r.random(), 0.75, 0.5)
    ramps = {
        "crown": make_ramp(blend(base, "#ffffff", 0.2)), "table": make_ramp(blend(base, "#ffffff", 0.4)),
        "pav": make_ramp(base), "pav2": make_ramp(blend(base, "#000000", 0.2)), "shine": "#ffffff",
    }
    return sk.render(ramps)


def escudo(seed):
    r = random.Random(seed)
    sk = Sketch()
    hw = r.choice([10, 11])
    top, taper, bottom = 4, r.randint(15, 19), 28

    def inside(x, y):
        if not top <= y <= bottom:
            return False
        w = hw if y <= taper else hw * (1 - ((y - taper) / (bottom - taper + 1)) ** 1.4)
        return abs(x - 15.5) <= w

    for y in range(S):
        for x in range(S):
            if inside(x, y):
                edge = any(not inside(x + i, y + j) for i, j in ((1, 0), (-1, 0), (0, 1), (0, -1)))
                sk.set(x, y, "rim" if edge else "face")
    kind = r.choice(["cruz", "circulo", "franja"])
    for y in range(S):
        for x in range(S):
            if sk.get(x, y) != "face":
                continue
            if kind == "cruz" and (14 <= x <= 17 and 8 <= y <= 24 or 9 <= x <= 22 and 12 <= y <= 15):
                sk.set(x, y, "emblem")
            elif kind == "circulo" and (x - 15.5) ** 2 + (y - 14) ** 2 <= 20:
                sk.set(x, y, "emblem")
            elif kind == "franja" and abs((x - 4) - (y - 4)) <= 2:
                sk.set(x, y, "emblem")
    ramps = {
        "rim": make_ramp(r.choice(["#a0a8b8", "#d8a838"])),
        "face": make_ramp(hsl(r.random(), 0.6, 0.42)),
        "emblem": make_ramp(r.choice(["#f0e0b0", "#e8e8f0", "#d8a838", "#202030"])),
    }
    return sk.render(ramps)


OBJETOS = {"Poción": pocion, "Espada": espada, "Gema": gema, "Escudo": escudo}


def objeto_aleatorio(seed):
    return random.Random(seed).choice(list(OBJETOS.values()))(seed)


# ------------------------------------------------------- utilidades ----

def fit(grid, w, h):
    """Coloca una cuadrícula de 32x32 centrada en un lienzo w x h
    (la reduce si el lienzo es más pequeño)."""
    src = len(grid)
    if w < src or h < src:
        size = min(w, h)
        grid = [[grid[int(y * src / size)][int(x * src / size)] for x in range(size)] for y in range(size)]
        src = size
    out = [[None] * w for _ in range(h)]
    ox, oy = (w - src) // 2, (h - src) // 2
    for y in range(src):
        for x in range(src):
            out[y + oy][x + ox] = grid[y][x]
    return out


# ------------------------------------------- animaciones automáticas ----

def shifted(f, dx, dy, wrap=False):
    h, w = len(f), len(f[0])
    out = [[None] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            c = f[y][x]
            if c is None:
                continue
            nx, ny = x + dx, y + dy
            if wrap:
                nx, ny = nx % w, ny % h
            if 0 <= nx < w and 0 <= ny < h:
                out[ny][nx] = c
    return out


def _bbox_rows(f):
    rows = [y for y, row in enumerate(f) if any(c is not None for c in row)]
    return (rows[0], rows[-1]) if rows else (0, 0)


def anim_flotar(f):
    return [shifted(f, 0, round(math.sin(i / 8 * 2 * math.pi) * -1.4)) for i in range(8)]


def anim_respirar(f):
    top, bottom = _bbox_rows(f)
    mid = (top + bottom) // 2
    squash = [row[:] for row in f]
    for y in range(mid, top, -1):
        squash[y] = f[y - 1][:]
    squash[top] = [None] * len(f[0])
    return [f, [r[:] for r in f], squash, [r[:] for r in squash]]


def anim_destello(f):
    flash = [[blend(c, "#ffffff", 0.65) if c else None for c in row] for row in f]
    return [f, flash, [r[:] for r in f], [r[:] for r in f]]


def anim_sacudida(f):
    return [shifted(f, dx, 0) for dx in (0, 1, -1, 1, -1, 0)]


ANIMACIONES = {
    "Flotar (8 frames)": anim_flotar,
    "Respirar / idle (4 frames)": anim_respirar,
    "Destello / golpe (4 frames)": anim_destello,
    "Sacudida (6 frames)": anim_sacudida,
}
