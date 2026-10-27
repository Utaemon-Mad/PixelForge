#!/usr/bin/env python3
"""PixelForge: editor y generador de pixel art para objetos, personajes y animaciones."""

import json
import os
import random
import re
import tkinter as tk
from tkinter import colorchooser, filedialog, messagebox, simpledialog, ttk

import generadores as gen
from generadores import blend, hex_to_rgb, make_ramp

try:
    from PIL import Image
except ImportError:
    Image = None

BG = "#1e1e26"
PANEL = "#262631"
FG = "#e6e6ef"
MUTED = "#8a8aa0"
ACCENT = "#5b6ee1"
CHECK_A = "#3a3a46"
CHECK_B = "#30303b"
GRID = "#25252e"
GRID8 = "#50506a"

DEFAULT_PALETTE = [
    "#0d0b14", "#2b2840", "#4b4a6b", "#7a7a9a", "#b4b4c8", "#f0f0f4",
    "#5e2236", "#9c2f3a", "#d6493c", "#f08a4b", "#f7c26b", "#fff1a8",
    "#3a2a20", "#6b4430", "#a0673e", "#d29b6a", "#f2cfa4", "#f0a0c8",
    "#1d3b2a", "#2f6b3a", "#4ea14a", "#94d168", "#d2f08c", "#2a6b6b",
    "#162a4a", "#24508c", "#3c88d6", "#7cc4f0", "#c4ecff",
    "#3e1f5c", "#7a3aa0", "#c060c8",
]

TOOLS = [
    ("pencil", "Lápiz", "b"),
    ("eraser", "Goma", "e"),
    ("fill", "Relleno", "g"),
    ("picker", "Cuentagotas", "i"),
    ("line", "Línea", "l"),
    ("rect", "Rectángulo", "r"),
    ("ellipse", "Elipse", "o"),
]


def line_points(x0, y0, x1, y1):
    """Bresenham."""
    pts = []
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx + dy
    while True:
        pts.append((x0, y0))
        if x0 == x1 and y0 == y1:
            return pts
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy


class PixelForge:
    def __init__(self, root):
        self.root = root
        self.w = self.h = 32
        self.frames = [self.blank()]
        self.cur = 0
        self.palette = list(DEFAULT_PALETTE)
        self.primary = "#d6493c"
        self.secondary = "#0d0b14"
        self.tool = tk.StringVar(value="pencil")
        self.brush = tk.IntVar(value=1)
        self.mirror = tk.BooleanVar(value=False)
        self.fill_shapes = tk.BooleanVar(value=False)
        self.onion = tk.BooleanVar(value=True)
        self.show_grid = tk.BooleanVar(value=True)
        self.fps = tk.IntVar(value=8)
        self.zoom = self.fit_zoom()
        self.undo_stack, self.redo_stack = [], []
        self.playing = False
        self.play_idx = 0
        self.path = None
        self.dirty = False
        self.last_gen = None
        self.drag = None
        self.ids = []
        self.shown = []

        self.build_ui()
        self.bind_keys()
        self.rebuild_canvas()
        self.refresh_frames()
        self.update_colors()
        self.update_title()
        root.protocol("WM_DELETE_WINDOW", self.quit)

    # ------------------------------------------------------------ datos ----

    def blank(self):
        return [[None] * self.w for _ in range(self.h)]

    @property
    def frame(self):
        return self.frames[self.cur]

    def fit_zoom(self):
        return max(2, min(24, 576 // max(self.w, self.h)))

    def snapshot(self):
        self.undo_stack.append(([[r[:] for r in f] for f in self.frames], self.cur))
        del self.undo_stack[:-100]
        self.redo_stack.clear()
        self.dirty = True
        self.update_title()

    def _restore(self, src, dst):
        if not src:
            return
        dst.append(([[r[:] for r in f] for f in self.frames], self.cur))
        frames, cur = src.pop()
        self.frames = frames
        self.cur = min(cur, len(frames) - 1)
        self.dirty = True
        self.refresh_all()

    def undo(self):
        self._restore(self.undo_stack, self.redo_stack)

    def redo(self):
        self._restore(self.redo_stack, self.undo_stack)

    # --------------------------------------------------------------- UI ----

    def build_ui(self):
        root = self.root
        root.title("PixelForge")
        root.configure(bg=BG)
        root.geometry("1180x800")
        style = ttk.Style()
        style.theme_use("clam")
        style.configure(".", background=PANEL, foreground=FG, fieldbackground=BG, bordercolor=BG)
        style.configure("TScrollbar", troughcolor=BG, background=PANEL, arrowcolor=FG)

        self.build_menu()

        self.status = tk.Label(root, text="", bg=BG, fg=MUTED, anchor="w", padx=8)
        self.status.pack(side="bottom", fill="x")

        # --- barra de frames
        fbar = tk.Frame(root, bg=PANEL, padx=6, pady=6)
        fbar.pack(side="bottom", fill="x")
        btns = tk.Frame(fbar, bg=PANEL)
        btns.pack(side="left", fill="y", padx=(0, 6))
        tk.Label(btns, text="Frames", bg=PANEL, fg=FG, font=("Segoe UI", 10, "bold")).pack(anchor="w")
        row = tk.Frame(btns, bg=PANEL)
        row.pack(anchor="w")
        for text, cmd in (("+ Nuevo", self.add_frame), ("Duplicar", self.dup_frame), ("Borrar", self.del_frame)):
            self.button(row, text, cmd).pack(side="left", padx=1, pady=2)
        row = tk.Frame(btns, bg=PANEL)
        row.pack(anchor="w")
        self.button(row, "◀ Mover", lambda: self.move_frame(-1)).pack(side="left", padx=1)
        self.button(row, "Mover ▶", lambda: self.move_frame(1)).pack(side="left", padx=1)
        strip_wrap = tk.Frame(fbar, bg=PANEL)
        strip_wrap.pack(side="left", fill="both", expand=True)
        self.strip = tk.Canvas(strip_wrap, bg=BG, height=92, highlightthickness=0)
        self.strip.pack(side="top", fill="x", expand=True)
        sb = ttk.Scrollbar(strip_wrap, orient="horizontal", command=self.strip.xview)
        sb.pack(side="top", fill="x")
        self.strip.configure(xscrollcommand=sb.set)
        self.strip.bind("<Button-1>", self.strip_click)

        main = tk.Frame(root, bg=BG)
        main.pack(fill="both", expand=True)

        # --- herramientas
        left = tk.Frame(main, bg=PANEL, padx=8, pady=8)
        left.pack(side="left", fill="y")
        self.section(left, "Herramientas")
        for key, name, sc in TOOLS:
            tk.Radiobutton(
                left, text=f"{name}  ({sc.upper()})", variable=self.tool, value=key, indicatoron=0,
                width=16, anchor="w", padx=6, pady=3, bg=PANEL, fg=FG, selectcolor=ACCENT,
                activebackground=ACCENT, activeforeground=FG, relief="flat", bd=0,
                command=self.update_status,
            ).pack(fill="x", pady=1)
        self.section(left, "Tamaño de pincel")
        row = tk.Frame(left, bg=PANEL)
        row.pack(fill="x")
        for n in (1, 2, 3, 4):
            tk.Radiobutton(
                row, text=str(n), variable=self.brush, value=n, indicatoron=0, width=3,
                bg=PANEL, fg=FG, selectcolor=ACCENT, relief="flat", bd=0, pady=3,
            ).pack(side="left", padx=1)
        self.section(left, "Opciones")
        for text, var in (("Espejo horizontal (M)", self.mirror), ("Figuras rellenas", self.fill_shapes),
                          ("Papel cebolla", self.onion), ("Cuadrícula", self.show_grid)):
            tk.Checkbutton(
                left, text=text, variable=var, bg=PANEL, fg=FG, selectcolor=BG, activebackground=PANEL,
                activeforeground=FG, anchor="w", command=self.options_changed,
            ).pack(fill="x")
        self.section(left, "Transformar")
        for text, cmd in (("Voltear horizontal", self.flip_h), ("Voltear vertical", self.flip_v),
                          ("Reemplazar color 1→2", self.replace_color), ("Limpiar frame", self.clear_frame)):
            self.button(left, text, cmd).pack(fill="x", pady=1)
        tk.Label(left, text="Shift+flechas: desplazar\n←/→: cambiar de frame\nRueda: zoom",
                 bg=PANEL, fg=MUTED, justify="left").pack(anchor="w", pady=(12, 0))

        # --- colores, paleta y vista previa
        right = tk.Frame(main, bg=PANEL, padx=8, pady=8)
        right.pack(side="right", fill="y")
        self.section(right, "Colores (clic izq. / der.)")
        row = tk.Frame(right, bg=PANEL)
        row.pack(fill="x")
        self.swatch = tk.Canvas(row, width=64, height=52, bg=PANEL, highlightthickness=0)
        self.swatch.pack(side="left")
        self.swatch.bind("<Button-1>", lambda e: self.choose_color(1))
        self.swatch.bind("<Button-3>", lambda e: self.choose_color(3))
        col = tk.Frame(row, bg=PANEL)
        col.pack(side="left", padx=6)
        self.button(col, "Intercambiar (X)", self.swap_colors).pack(fill="x", pady=1)
        self.hex_label = tk.Label(col, text="", bg=PANEL, fg=MUTED, font=("Consolas", 9))
        self.hex_label.pack(anchor="w")

        self.section(right, "Paleta")
        self.pal_canvas = tk.Canvas(right, width=8 * 21, height=100, bg=PANEL, highlightthickness=0)
        self.pal_canvas.pack(anchor="w")
        self.pal_canvas.bind("<Button-1>", lambda e: self.palette_click(e, 1))
        self.pal_canvas.bind("<Button-3>", lambda e: self.palette_click(e, 3))
        self.pal_canvas.bind("<Double-Button-1>", self.palette_edit)
        for text, cmd in (("Añadir color…", self.palette_add), ("Rampa de sombras del color 1", self.palette_ramp),
                          ("Quitar color 1 de la paleta", self.palette_remove),
                          ("Paleta desde el sprite", self.palette_from_sprite),
                          ("Paleta por defecto", self.palette_reset)):
            self.button(right, text, cmd).pack(fill="x", pady=1)

        self.section(right, "Vista previa")
        self.preview = tk.Canvas(right, width=168, height=168, bg=CHECK_B, highlightthickness=0)
        self.preview.pack()
        row = tk.Frame(right, bg=PANEL)
        row.pack(fill="x", pady=4)
        self.play_btn = self.button(row, "▶ Reproducir", self.toggle_play)
        self.play_btn.pack(side="left")
        tk.Label(row, text="FPS", bg=PANEL, fg=FG).pack(side="left", padx=(8, 2))
        tk.Spinbox(row, from_=1, to=60, width=4, textvariable=self.fps, bg=BG, fg=FG,
                   buttonbackground=PANEL, insertbackground=FG).pack(side="left")

        # --- lienzo
        center = tk.Frame(main, bg=BG)
        center.pack(side="left", fill="both", expand=True)
        self.canvas = tk.Canvas(center, bg=BG, highlightthickness=0, cursor="crosshair")
        self.canvas.place(relx=0.5, rely=0.5, anchor="center")
        for btn in (1, 3):
            self.canvas.bind(f"<ButtonPress-{btn}>", lambda e, b=btn: self.on_press(e, b))
            self.canvas.bind(f"<B{btn}-Motion>", lambda e, b=btn: self.on_drag(e, b))
            self.canvas.bind(f"<ButtonRelease-{btn}>", lambda e, b=btn: self.on_release(e, b))
        self.canvas.bind("<Motion>", self.on_motion)
        center.bind("<MouseWheel>", self.on_wheel)
        self.canvas.bind("<MouseWheel>", self.on_wheel)

    def build_menu(self):
        m = tk.Menu(self.root)
        archivo = tk.Menu(m, tearoff=0)
        archivo.add_command(label="Nuevo…", accelerator="Ctrl+N", command=self.new_project)
        archivo.add_command(label="Abrir…", accelerator="Ctrl+O", command=self.open_project)
        archivo.add_command(label="Guardar", accelerator="Ctrl+S", command=self.save_project)
        archivo.add_command(label="Guardar como…", command=lambda: self.save_project(True))
        archivo.add_separator()
        archivo.add_command(label="Importar PNG…", command=self.import_png)
        archivo.add_command(label="Exportar frame como PNG…", command=self.export_png)
        archivo.add_command(label="Exportar spritesheet PNG…", command=self.export_sheet)
        archivo.add_command(label="Exportar GIF animado…", command=self.export_gif)
        archivo.add_separator()
        archivo.add_command(label="Salir", command=self.quit)
        m.add_cascade(label="Archivo", menu=archivo)

        editar = tk.Menu(m, tearoff=0)
        editar.add_command(label="Deshacer", accelerator="Ctrl+Z", command=self.undo)
        editar.add_command(label="Rehacer", accelerator="Ctrl+Y", command=self.redo)
        editar.add_separator()
        editar.add_command(label="Voltear horizontal", command=self.flip_h)
        editar.add_command(label="Voltear vertical", command=self.flip_v)
        editar.add_command(label="Reemplazar color 1 → color 2", command=self.replace_color)
        editar.add_command(label="Limpiar frame", command=self.clear_frame)
        m.add_cascade(label="Editar", menu=editar)

        generar = tk.Menu(m, tearoff=0)
        generar.add_command(label="Personaje", command=lambda: self.generate(gen.personaje))
        generar.add_command(label="Personaje caminando (4 frames)",
                            command=lambda: self.generate(gen.personaje_caminando, multi=True))
        generar.add_command(label="Criatura / monstruo", command=lambda: self.generate(gen.criatura))
        generar.add_separator()
        for name, fn in gen.OBJETOS.items():
            generar.add_command(label=f"Objeto: {name}", command=lambda f=fn: self.generate(f))
        generar.add_command(label="Objeto aleatorio", command=lambda: self.generate(gen.objeto_aleatorio))
        generar.add_separator()
        generar.add_command(label="Generar otra variante", accelerator="Ctrl+G", command=self.regenerate)
        m.add_cascade(label="Generar", menu=generar)

        anim = tk.Menu(m, tearoff=0)
        for name, fn in gen.ANIMACIONES.items():
            anim.add_command(label=f"{name} desde el frame actual", command=lambda f=fn: self.auto_anim(f))
        anim.add_separator()
        anim.add_command(label="Reproducir / pausar", accelerator="Espacio", command=self.toggle_play)
        anim.add_command(label="Frame anterior", accelerator="←", command=lambda: self.step_frame(-1))
        anim.add_command(label="Frame siguiente", accelerator="→", command=lambda: self.step_frame(1))
        m.add_cascade(label="Animación", menu=anim)

        ver = tk.Menu(m, tearoff=0)
        ver.add_command(label="Acercar", accelerator="+", command=lambda: self.set_zoom(self.zoom + 2))
        ver.add_command(label="Alejar", accelerator="-", command=lambda: self.set_zoom(self.zoom - 2))
        ver.add_checkbutton(label="Cuadrícula", variable=self.show_grid, command=self.options_changed)
        ver.add_checkbutton(label="Papel cebolla", variable=self.onion, command=self.options_changed)
        m.add_cascade(label="Ver", menu=ver)
        self.root.config(menu=m)

    def section(self, parent, text):
        tk.Label(parent, text=text, bg=PANEL, fg=FG, font=("Segoe UI", 10, "bold")).pack(anchor="w", pady=(10, 3))

    def button(self, parent, text, cmd):
        return tk.Button(parent, text=text, command=cmd, bg="#33334a", fg=FG, activebackground=ACCENT,
                         activeforeground=FG, relief="flat", bd=0, padx=8, pady=3)

    def bind_keys(self):
        r = self.root
        for key, _, sc in TOOLS:
            r.bind(f"<KeyPress-{sc}>", lambda e, k=key: self.key_tool(e, k))
        r.bind("<KeyPress-m>", lambda e: self.not_typing(e) and (self.mirror.set(not self.mirror.get()), self.update_status()))
        r.bind("<KeyPress-x>", lambda e: self.not_typing(e) and self.swap_colors())
        r.bind("<space>", lambda e: self.not_typing(e) and self.toggle_play())
        r.bind("<Left>", lambda e: self.step_frame(-1))
        r.bind("<Right>", lambda e: self.step_frame(1))
        for key, d in (("Left", (-1, 0)), ("Right", (1, 0)), ("Up", (0, -1)), ("Down", (0, 1))):
            r.bind(f"<Shift-{key}>", lambda e, d=d: self.shift_frame(*d))
        r.bind("<plus>", lambda e: self.set_zoom(self.zoom + 2))
        r.bind("<minus>", lambda e: self.set_zoom(self.zoom - 2))
        r.bind("<Control-z>", lambda e: self.undo())
        r.bind("<Control-y>", lambda e: self.redo())
        r.bind("<Control-s>", lambda e: self.save_project())
        r.bind("<Control-o>", lambda e: self.open_project())
        r.bind("<Control-n>", lambda e: self.new_project())
        r.bind("<Control-g>", lambda e: self.regenerate())

    def not_typing(self, e):
        return not isinstance(e.widget, (tk.Entry, tk.Spinbox))

    def key_tool(self, e, key):
        if self.not_typing(e):
            self.tool.set(key)
            self.update_status()

    # ----------------------------------------------------------- lienzo ----

    def rebuild_canvas(self):
        c, z = self.canvas, self.zoom
        c.delete("all")
        c.config(width=self.w * z, height=self.h * z)
        self.ids = [[c.create_rectangle(x * z, y * z, x * z + z, y * z + z, width=0)
                     for x in range(self.w)] for y in range(self.h)]
        self.shown = [[None] * self.w for _ in range(self.h)]
        if self.show_grid.get() and z >= 6:
            for x in range(1, self.w):
                c.create_line(x * z, 0, x * z, self.h * z, fill=GRID8 if x % 8 == 0 else GRID)
            for y in range(1, self.h):
                c.create_line(0, y * z, self.w * z, y * z, fill=GRID8 if y % 8 == 0 else GRID)
        self.render()

    def render(self):
        f = self.frame
        prev = self.frames[self.cur - 1] if self.onion.get() and self.cur > 0 else None
        for y in range(self.h):
            row, ids, shown = f[y], self.ids[y], self.shown[y]
            for x in range(self.w):
                col = row[x]
                if col is None:
                    col = CHECK_A if (x + y) % 2 == 0 else CHECK_B
                    if prev and prev[y][x]:
                        col = blend(prev[y][x], col, 0.7)
                if shown[x] != col:
                    shown[x] = col
                    self.canvas.itemconfig(ids[x], fill=col)
        if not self.playing:
            self.draw_preview(self.cur)

    def set_zoom(self, z):
        z = max(2, min(48, z))
        if z != self.zoom:
            self.zoom = z
            self.rebuild_canvas()

    def options_changed(self):
        self.rebuild_canvas()
        self.update_status()

    def on_wheel(self, e):
        self.set_zoom(self.zoom + (2 if e.delta > 0 else -2))

    def cell(self, e):
        return e.x // self.zoom, e.y // self.zoom

    def inside(self, x, y):
        return 0 <= x < self.w and 0 <= y < self.h

    def put(self, x, y, col):
        b = self.brush.get()
        for dy in range(b):
            for dx in range(b):
                px, py = x + dx - b // 2, y + dy - b // 2
                for qx in ((px, self.w - 1 - px) if self.mirror.get() else (px,)):
                    if self.inside(qx, py):
                        self.frame[py][qx] = col

    def on_press(self, e, btn):
        if self.playing:
            self.toggle_play()
        x, y = self.cell(e)
        tool = self.tool.get()
        col = self.primary if btn == 1 else self.secondary
        if tool == "picker":
            self.pick(x, y, btn)
            return
        if not self.inside(x, y) and tool == "fill":
            return
        self.snapshot()
        self.drag = {"start": (x, y), "last": (x, y), "base": [r[:] for r in self.frame], "col": col}
        if tool == "pencil":
            self.put(x, y, col)
        elif tool == "eraser":
            self.put(x, y, None)
        elif tool == "fill":
            self.flood(x, y, col)
        else:
            self.draw_shape(x, y)
        self.render()

    def on_drag(self, e, btn):
        x, y = self.cell(e)
        self.on_motion(e)
        tool = self.tool.get()
        if tool == "picker":
            self.pick(x, y, btn)
            return
        if not self.drag:
            return
        if tool in ("pencil", "eraser"):
            col = None if tool == "eraser" else self.drag["col"]
            lx, ly = self.drag["last"]
            for px, py in line_points(lx, ly, x, y):
                self.put(px, py, col)
            self.drag["last"] = (x, y)
            self.render()
        elif tool in ("line", "rect", "ellipse"):
            self.draw_shape(x, y)
            self.render()

    def on_release(self, e, btn):
        if self.drag:
            self.drag = None
            self.refresh_frames()

    def on_motion(self, e):
        x, y = self.cell(e)
        self.update_status((x, y) if self.inside(x, y) else None)

    def pick(self, x, y, btn):
        if not self.inside(x, y) or not self.frame[y][x]:
            return
        if btn == 1:
            self.primary = self.frame[y][x]
        else:
            self.secondary = self.frame[y][x]
        self.update_colors()

    def flood(self, x, y, col):
        f = self.frame
        target = f[y][x]
        if target == col:
            return
        stack = [(x, y)]
        while stack:
            px, py = stack.pop()
            if self.inside(px, py) and f[py][px] == target:
                f[py][px] = col
                stack += [(px + 1, py), (px - 1, py), (px, py + 1), (px, py - 1)]

    def draw_shape(self, x1, y1):
        d = self.drag
        f = self.frame
        for y in range(self.h):  # vuelve al estado previo al arrastre
            f[y][:] = d["base"][y]
        x0, y0 = d["start"]
        tool, col = self.tool.get(), d["col"]
        if tool == "line":
            pts = line_points(x0, y0, x1, y1)
        else:
            ax, bx = sorted((x0, x1))
            ay, by = sorted((y0, y1))
            filled = self.fill_shapes.get()
            if tool == "rect":
                pts = [(x, y) for y in range(ay, by + 1) for x in range(ax, bx + 1)
                       if filled or x in (ax, bx) or y in (ay, by)]
            else:
                cx, cy = (ax + bx) / 2, (ay + by) / 2
                rx, ry = (bx - ax) / 2 + 0.5, (by - ay) / 2 + 0.5
                ins = lambda x, y: ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1
                pts = [(x, y) for y in range(ay, by + 1) for x in range(ax, bx + 1)
                       if ins(x, y) and (filled or not all(ins(x + i, y + j) for i, j in
                                                            ((1, 0), (-1, 0), (0, 1), (0, -1))))]
        for px, py in pts:
            self.put(px, py, col)

    # ---------------------------------------------------------- colores ----

    def update_colors(self):
        s = self.swatch
        s.delete("all")
        s.create_rectangle(22, 18, 60, 50, fill=self.secondary, outline=FG)
        s.create_rectangle(2, 2, 40, 34, fill=self.primary, outline=FG, width=2)
        self.hex_label.config(text=f"1: {self.primary}\n2: {self.secondary}")
        self.draw_palette()

    def draw_palette(self):
        c = self.pal_canvas
        c.delete("all")
        n = len(self.palette)
        c.config(height=max(21, ((n + 7) // 8) * 21))
        for i, col in enumerate(self.palette):
            x, y = (i % 8) * 21, (i // 8) * 21
            outline = FG if col == self.primary else (MUTED if col == self.secondary else PANEL)
            c.create_rectangle(x + 1, y + 1, x + 19, y + 19, fill=col, outline=outline, width=2)

    def palette_index(self, e):
        i = (e.y // 21) * 8 + e.x // 21
        return i if 0 <= e.x < 8 * 21 and 0 <= i < len(self.palette) else None

    def palette_click(self, e, btn):
        i = self.palette_index(e)
        if i is None:
            return
        if btn == 1:
            self.primary = self.palette[i]
        else:
            self.secondary = self.palette[i]
        self.update_colors()

    def palette_edit(self, e):
        i = self.palette_index(e)
        if i is None:
            return
        res = colorchooser.askcolor(self.palette[i], title="Editar color")[1]
        if res:
            self.palette[i] = res.lower()
            self.primary = self.palette[i]
            self.update_colors()

    def choose_color(self, btn):
        cur = self.primary if btn == 1 else self.secondary
        res = colorchooser.askcolor(cur, title="Elegir color")[1]
        if res:
            if btn == 1:
                self.primary = res.lower()
            else:
                self.secondary = res.lower()
            self.update_colors()

    def swap_colors(self):
        self.primary, self.secondary = self.secondary, self.primary
        self.update_colors()

    def palette_add(self):
        res = colorchooser.askcolor(self.primary, title="Añadir color a la paleta")[1]
        if res:
            self.primary = res.lower()
            if self.primary not in self.palette:
                self.palette.append(self.primary)
            self.update_colors()

    def palette_ramp(self):
        for col in make_ramp(self.primary):
            if col not in self.palette:
                self.palette.append(col)
        self.update_colors()

    def palette_remove(self):
        if self.primary in self.palette and len(self.palette) > 1:
            self.palette.remove(self.primary)
            self.update_colors()

    def palette_from_sprite(self):
        cols = []
        for f in self.frames:
            for row in f:
                for c in row:
                    if c and c not in cols:
                        cols.append(c)
        if cols:
            self.palette = cols[:256]
            self.update_colors()

    def palette_reset(self):
        self.palette = list(DEFAULT_PALETTE)
        self.update_colors()

    # ----------------------------------------------------------- frames ----

    def make_photo(self, f, scale, bg):
        img = tk.PhotoImage(width=self.w, height=self.h)
        img.put(" ".join("{" + " ".join(c or bg for c in row) + "}" for row in f))
        return img.zoom(scale) if scale > 1 else img

    def refresh_frames(self):
        s = self.strip
        s.delete("all")
        scale = max(1, 64 // max(self.w, self.h))
        tw, th = self.w * scale, self.h * scale
        if th > 72:  # lienzos grandes: reducimos la miniatura
            sub = -(-th // 72)
            tw, th = tw // sub, th // sub
        else:
            sub = 1
        self.thumbs = []
        self.thumb_w = tw + 12
        for i, f in enumerate(self.frames):
            img = self.make_photo(f, scale, CHECK_B)
            if sub > 1:
                img = img.subsample(sub)
            self.thumbs.append(img)
            x = 6 + i * self.thumb_w
            if i == self.cur:
                s.create_rectangle(x - 4, 2, x + tw + 3, th + 9, outline=ACCENT, width=3)
            s.create_image(x, 6, image=img, anchor="nw")
            s.create_text(x + tw - 2, th + 4, text=str(i + 1), fill=FG, anchor="se", font=("Segoe UI", 8, "bold"))
        s.configure(height=th + 14, scrollregion=(0, 0, 6 + len(self.frames) * self.thumb_w, th + 14))
        self.update_status()

    def strip_click(self, e):
        i = int((self.strip.canvasx(e.x) - 2) // self.thumb_w)
        if 0 <= i < len(self.frames):
            self.select_frame(i)

    def select_frame(self, i):
        self.cur = i % len(self.frames)
        self.render()
        self.refresh_frames()

    def step_frame(self, d):
        self.select_frame(self.cur + d)

    def add_frame(self):
        self.snapshot()
        self.frames.insert(self.cur + 1, self.blank())
        self.select_frame(self.cur + 1)

    def dup_frame(self):
        self.snapshot()
        self.frames.insert(self.cur + 1, [r[:] for r in self.frame])
        self.select_frame(self.cur + 1)

    def del_frame(self):
        self.snapshot()
        if len(self.frames) == 1:
            self.frames[0] = self.blank()
        else:
            del self.frames[self.cur]
            self.cur = min(self.cur, len(self.frames) - 1)
        self.refresh_all()

    def move_frame(self, d):
        j = self.cur + d
        if 0 <= j < len(self.frames):
            self.snapshot()
            self.frames[self.cur], self.frames[j] = self.frames[j], self.frames[self.cur]
            self.select_frame(j)

    def refresh_all(self):
        self.render()
        self.refresh_frames()
        self.update_title()

    def replace_current(self, new):
        self.snapshot()
        self.frames[self.cur] = new
        self.refresh_all()

    def flip_h(self):
        self.replace_current([row[::-1] for row in self.frame])

    def flip_v(self):
        self.replace_current([row[:] for row in self.frame[::-1]])

    def clear_frame(self):
        self.replace_current(self.blank())

    def shift_frame(self, dx, dy):
        self.replace_current(gen.shifted(self.frame, dx, dy, wrap=True))

    def replace_color(self):
        self.replace_current([[self.secondary if c == self.primary else c for c in row] for row in self.frame])

    # ---------------------------------------------------- vista previa ----

    def draw_preview(self, i):
        p = self.preview
        p.delete("all")
        scale = max(1, 152 // max(self.w, self.h))
        img = self.make_photo(self.frames[i], scale, CHECK_B)
        if max(self.w, self.h) > 152:
            img = img.subsample(-(-max(self.w, self.h) // 152))
        self.preview_img = img
        p.create_image(84, 84, image=img)
        if self.playing:
            p.create_text(160, 160, text=f"{i + 1}/{len(self.frames)}", fill=FG, anchor="se")

    def toggle_play(self):
        self.playing = not self.playing
        self.play_btn.config(text="■ Parar" if self.playing else "▶ Reproducir")
        if self.playing:
            self.play_idx = self.cur
            self.tick()
        else:
            self.draw_preview(self.cur)

    def tick(self):
        if not self.playing:
            return
        self.play_idx = (self.play_idx + 1) % len(self.frames)
        self.draw_preview(self.play_idx)
        try:
            fps = max(1, min(60, int(self.fps.get())))
        except (tk.TclError, ValueError):
            fps = 8
        self.root.after(1000 // fps, self.tick)

    # -------------------------------------------------------- generadores ----

    def generate(self, fn, multi=False, seed=None):
        seed = random.randrange(1 << 30) if seed is None else seed
        self.last_gen = (fn, multi)
        result = fn(seed)
        self.snapshot()
        if multi:
            self.frames = [gen.fit(g, self.w, self.h) for g in result]
            self.cur = 0
        else:
            self.frames[self.cur] = gen.fit(result, self.w, self.h)
        self.refresh_all()
        self.status.config(text=f"Generado con semilla {seed}. Ctrl+G para otra variante.")

    def regenerate(self):
        if self.last_gen:
            fn, multi = self.last_gen
            self.generate(fn, multi)

    def auto_anim(self, fn):
        self.snapshot()
        self.frames = [[r[:] for r in f] for f in fn(self.frame)]
        self.cur = 0
        self.refresh_all()
        if not self.playing:
            self.toggle_play()

    # ---------------------------------------------------------- archivos ----

    def confirm_discard(self):
        if not self.dirty:
            return True
        res = messagebox.askyesnocancel("PixelForge", "Hay cambios sin guardar. ¿Guardarlos?")
        if res is None:
            return False
        return self.save_project() if res else True

    def load_state(self, w, h, frames, palette=None, fps=None):
        self.w, self.h = w, h
        self.frames = frames
        self.cur = 0
        if palette:
            self.palette = palette
        if fps:
            self.fps.set(fps)
        self.undo_stack.clear()
        self.redo_stack.clear()
        self.zoom = self.fit_zoom()
        self.rebuild_canvas()
        self.refresh_frames()
        self.update_colors()
        self.update_title()

    def new_project(self):
        if not self.confirm_discard():
            return
        txt = simpledialog.askstring("Nuevo", "Tamaño del lienzo (ancho x alto):", initialvalue=f"{self.w}x{self.h}",
                                     parent=self.root)
        if not txt:
            return
        nums = [int(n) for n in re.findall(r"\d+", txt)]
        if not nums:
            return
        w, h = (nums + nums)[:2]
        if not (1 <= w <= 256 and 1 <= h <= 256):
            messagebox.showerror("PixelForge", "El tamaño debe estar entre 1 y 256 píxeles.")
            return
        self.path = None
        self.dirty = False
        self.load_state(w, h, [[[None] * w for _ in range(h)]])

    def open_project(self):
        if not self.confirm_discard():
            return
        path = filedialog.askopenfilename(filetypes=[("Proyecto PixelForge", "*.pxf"), ("Todos", "*.*")])
        if not path:
            return
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
            self.path = path
            self.dirty = False
            self.load_state(data["width"], data["height"], data["frames"], data.get("palette"), data.get("fps"))
        except (OSError, ValueError, KeyError) as exc:
            messagebox.showerror("PixelForge", f"No se pudo abrir el archivo:\n{exc}")

    def save_project(self, save_as=False):
        if save_as or not self.path:
            path = filedialog.asksaveasfilename(defaultextension=".pxf",
                                                filetypes=[("Proyecto PixelForge", "*.pxf")])
            if not path:
                return False
            self.path = path
        data = {"version": 1, "width": self.w, "height": self.h, "fps": int(self.fps.get()),
                "palette": self.palette, "frames": self.frames}
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, separators=(",", ":"))
        self.dirty = False
        self.update_title()
        self.status.config(text=f"Guardado en {self.path}")
        return True

    def need_pillow(self):
        if Image is None:
            messagebox.showerror("PixelForge", "Para importar/exportar imágenes instala Pillow:\n\npip install pillow")
            return True
        return False

    def to_image(self, f, scale=1):
        img = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        px = img.load()
        for y, row in enumerate(f):
            for x, c in enumerate(row):
                if c:
                    px[x, y] = hex_to_rgb(c) + (255,)
        return img.resize((self.w * scale, self.h * scale), Image.NEAREST) if scale > 1 else img

    def ask_scale(self):
        return simpledialog.askinteger("Escala", "Escala de exportación (1 = tamaño real):",
                                       initialvalue=1, minvalue=1, maxvalue=32, parent=self.root)

    def ask_export_path(self, ext, desc):
        base = os.path.splitext(os.path.basename(self.path))[0] if self.path else "sprite"
        return filedialog.asksaveasfilename(defaultextension=ext, initialfile=base + ext,
                                            filetypes=[(desc, "*" + ext)])

    def export_png(self):
        if self.need_pillow():
            return
        scale = self.ask_scale()
        path = scale and self.ask_export_path(".png", "Imagen PNG")
        if path:
            self.to_image(self.frame, scale).save(path)
            self.status.config(text=f"Exportado {path}")

    def export_sheet(self):
        if self.need_pillow():
            return
        scale = self.ask_scale()
        path = scale and self.ask_export_path(".png", "Spritesheet PNG")
        if path:
            fw, fh = self.w * scale, self.h * scale
            sheet = Image.new("RGBA", (fw * len(self.frames), fh), (0, 0, 0, 0))
            for i, f in enumerate(self.frames):
                sheet.paste(self.to_image(f, scale), (i * fw, 0))
            sheet.save(path)
            self.status.config(text=f"Spritesheet de {len(self.frames)} frames exportado: {path}")

    def export_gif(self):
        if self.need_pillow():
            return
        scale = self.ask_scale()
        path = scale and self.ask_export_path(".gif", "GIF animado")
        if path:
            imgs = [self.to_image(f, scale) for f in self.frames]
            imgs[0].save(path, save_all=True, append_images=imgs[1:], loop=0, disposal=2,
                         duration=int(1000 / max(1, int(self.fps.get()))))
            self.status.config(text=f"GIF exportado: {path}")

    def import_png(self):
        if self.need_pillow():
            return
        path = filedialog.askopenfilename(filetypes=[("Imágenes", "*.png *.gif *.bmp"), ("Todos", "*.*")])
        if not path:
            return
        img = Image.open(path).convert("RGBA")
        iw, ih = img.size
        px = img.load()

        def grab(ox, w, h):
            return [[("#%02x%02x%02x" % px[ox + x, y][:3]) if px[ox + x, y][3] >= 128 else None
                     for x in range(w)] for y in range(h)]

        if (iw, ih) == (self.w, self.h):
            self.replace_current(grab(0, iw, ih))
        elif ih == self.h and iw % self.w == 0 and messagebox.askyesno(
                "Importar", f"La imagen parece un spritesheet de {iw // self.w} frames. ¿Importarlo como frames?"):
            self.snapshot()
            self.frames = [grab(i * self.w, self.w, self.h) for i in range(iw // self.w)]
            self.cur = 0
            self.refresh_all()
        elif iw <= 256 and ih <= 256 and messagebox.askyesno(
                "Importar", f"La imagen mide {iw}x{ih}. ¿Crear un proyecto nuevo con ese tamaño?"):
            if self.confirm_discard():
                self.path = None
                self.load_state(iw, ih, [grab(0, iw, ih)])
                self.dirty = True
                self.update_title()

    # ------------------------------------------------------------ varios ----

    def update_title(self):
        name = os.path.basename(self.path) if self.path else "sin título"
        self.root.title(f"PixelForge — {name}{' *' if self.dirty else ''}  [{self.w}x{self.h}]")

    def update_status(self, pos=None):
        tool = dict((k, n) for k, n, _ in TOOLS)[self.tool.get()]
        parts = [f"Frame {self.cur + 1}/{len(self.frames)}", f"Herramienta: {tool}",
                 f"Lienzo {self.w}x{self.h}", f"Zoom {self.zoom}x"]
        if self.mirror.get():
            parts.append("Espejo ON")
        if pos:
            parts.insert(0, f"({pos[0]}, {pos[1]})")
        self.status.config(text="   ·   ".join(parts))

    def quit(self):
        if self.confirm_discard():
            self.root.destroy()


def main():
    root = tk.Tk()
    PixelForge(root)
    root.mainloop()


if __name__ == "__main__":
    main()
