# 🎨 PixelForge

Editor y generador de pixel art para crear **objetos, personajes y animaciones** para videojuegos.
Dos versiones que comparten el formato de proyecto (`.pxf`). Las capas, la selección, la foto de calco y la IA están solo en la versión web:

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
- Lienzos de 16, 32, 48, 64 o 128 px (o el tamaño que quieras hasta 256), color RGB con transparencia.
- Lápiz, goma, relleno, cuentagotas, línea, rectángulo, elipse y **selección** (mover, copiar, cortar, pegar entre frames y capas, voltear).
- **Capas** con visibilidad, opacidad, reordenar, duplicar y fusionar.
- **Modo mosaico** (3×3) para dibujar tiles de suelo y pared que encajan sin cortes.
- **Foto de calco**: carga una foto semitransparente encima del lienzo, ajusta tamaño y posición y pinta encima.
  El cuentagotas toma colores de la foto, y **Convertir a píxeles** la pasa a pixel art en una capa nueva.
- Paleta editable y rampas de sombras con desplazamiento de matiz.
- Frames, papel cebolla y vista previa animada con FPS.
- **Generar**: personajes, personaje caminando (4 frames), criaturas, pociones, espadas, gemas y escudos,
  con detalle real a 64×64 en lienzos de 64 o más.
- **Animación automática**: flotar, respirar, destello y sacudida (en todas las capas).
- **IA con Gemini** (necesitas tu clave gratuita de [Google AI Studio](https://aistudio.google.com/apikey)):
  crear un sprite desde texto, editar tu sprite («ponle un sombrero»), asistente que ve tu dibujo y da consejos, y paletas por tema.
  La clave se guarda solo en tu dispositivo.
- Exportar PNG, spritesheet, GIF animado y **paquete para motores** (ZIP con spritesheet + JSON para Phaser/Aseprite,
  SpriteFrames `.tres` para Godot 4 e instrucciones para Unity). Importar PNG y spritesheets.

## Atajos (teclado)
`B` lápiz · `E` goma · `G` relleno · `I` cuentagotas · `L` línea · `R` rectángulo · `O` elipse · `M` espejo ·
`X` intercambiar colores · `Espacio` reproducir · `←/→` frames · `Shift+flechas` desplazar dibujo ·
`S` selección · `Ctrl+C / Ctrl+X / Ctrl+V` copiar, cortar, pegar · `Ctrl+A` seleccionar todo · `Supr` borrar selección · `Esc` quitar selección ·
`Ctrl+Z / Ctrl+Y` deshacer/rehacer · `Ctrl+G` otra variante generada
