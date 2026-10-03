"""Reempaqueta el wheel de scipy 1.17.1 (Pyodide 314) quitando subpaquetes que
PyNite no usa, para medir cuánto se ahorra. Uso: python scipy_slim.py
Salida: pyodide-slim/scipy-1.17.1-cp314-cp314-pyemscripten_2026_0_wasm32.whl
"""
import os
import shutil
import zipfile

ORIG = "wheels/scipy-1.17.1-cp314-cp314-pyemscripten_2026_0_wasm32.whl"
OUT_DIR = "pyodide-slim"
FUERA = {"stats", "optimize", "spatial", "io", "interpolate", "signal", "integrate", "fft",
         "ndimage", "cluster", "odr", "fftpack", "differentiate", "datasets", "misc", "constants"}
os.makedirs(OUT_DIR, exist_ok=True)
# copia del core de Pyodide + numpy para un indexURL propio
for f in os.listdir("pyodide-local"):
    if not f.startswith("scipy"):
        shutil.copy(os.path.join("pyodide-local", f), OUT_DIR)
dest = os.path.join(OUT_DIR, os.path.basename(ORIG))
zin = zipfile.ZipFile(ORIG)
zout = zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=9)
quitados = 0
for i in zin.infolist():
    p = i.filename.split("/")
    if p[0] == "scipy" and len(p) > 2 and p[1] in FUERA:
        quitados += 1
        continue
    zout.writestr(i, zin.read(i.filename))
zout.close()
print(f"original {os.path.getsize(ORIG)/1048576:.2f} MiB -> slim {os.path.getsize(dest)/1048576:.2f} MiB ({quitados} ficheros quitados)")
# PyNite vendorizado (sólo .py), como se hace con PySlope
zp = zipfile.ZipFile("wheels/pynitefea-3.2.0-py3-none-any.whl")
os.makedirs(os.path.join(OUT_DIR, "Pynite"), exist_ok=True)
for n in zp.namelist():
    if n.startswith("Pynite/") and n.endswith(".py"):
        open(os.path.join(OUT_DIR, n), "wb").write(zp.read(n))
print("PyNite .py copiados:", len([n for n in zp.namelist() if n.startswith('Pynite/') and n.endswith('.py')]))
