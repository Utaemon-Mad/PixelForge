# 🎨 PixelForge

Editor y generador de pixel art para crear **objetos, personajes y animaciones** para videojuegos.
Dos versiones que comparten el mismo formato de proyecto (`.pxf`):

| Versión | Dónde | Carpeta |
|---|---|---|
| Web instalable (iPad con Apple Pencil, PC, móvil) | GitHub Pages | [`docs/`](docs/) |
| Escritorio (Windows/Mac/Linux, Python) | Tu PC | [`escritorio/`](escritorio/) |

Tus creaciones van en [`sprites/`](sprites/).

## Instalar en el iPad
1. Abre la web de GitHub Pages del repositorio en **Safari**.
2. Pulsa **Compartir → Añadir a pantalla de inicio**.
3. Se abre a pantalla completa y funciona sin conexión.

Con el Apple Pencil:
- Pinta con el lápiz.
- Con dos dedos mueves el lienzo y haces zoom.
- Activa **Solo lápiz** para que la palma no pinte. Con eso activado, un dedo mueve el lienzo.

Los sprites se guardan en el iPad (Archivo → Biblioteca) y el trabajo se autoguarda.
Para tener copia, usa **Descargar proyecto (.pxf)** o **Exportar** y guarda en Archivos o súbelo a `sprites/`.

## Versión de escritorio
    cd escritorio
    pip install -r requirements.txt
    python pixelforge.py
(o doble clic en `Iniciar_PixelForge.bat` en Windows)

## Funciones
- Lienzo de 1–256 px (32×32 por defecto), color RGB con transparencia.
- Lápiz, goma, relleno, cuentagotas, línea, rectángulo y elipse; pincel 1–4 px; modo espejo.
- Paleta editable y rampas de sombras con desplazamiento de matiz.
- Frames, papel cebolla y vista previa animada con FPS.
- **Generar**: personajes, personaje caminando (4 frames), criaturas, pociones, espadas, gemas y escudos.
- **Animación automática**: flotar, respirar, destello y sacudida.
- Exportar PNG, spritesheet y GIF animado (escala 1×–16×); importar PNG y spritesheets.

## Atajos (teclado)
`B` lápiz · `E` goma · `G` relleno · `I` cuentagotas · `L` línea · `R` rectángulo · `O` elipse · `M` espejo ·
`X` intercambiar colores · `Espacio` reproducir · `←/→` frames · `Shift+flechas` desplazar dibujo ·
`Ctrl+Z / Ctrl+Y` deshacer/rehacer · `Ctrl+G` otra variante generada
