"""Tamaño de descarga de los paquetes Pyodide 314.0.0 que necesitaría PyNite.

Lee el lock del worktree, calcula el cierre transitivo de dependencias y pide
Content-Length al CDN pinneado (HEAD). Uso: python tamanos_pyodide.py
"""
import json
import os
import re
import subprocess

LOCK = r"D:\PROGRAMACION\Concreta EST\wt\feat-fem3d\node_modules\pyodide\pyodide-lock.json"
CDN = "https://cdn.jsdelivr.net/pyodide/v314.0.0/full/"
P = json.load(open(LOCK, encoding="utf-8"))["packages"]


def closure(names):
    seen = []
    stack = list(names)
    while stack:
        n = stack.pop()
        if n in seen:
            continue
        seen.append(n)
        stack.extend(P[n]["depends"])
    return seen


cache = {}


def size(name):
    if name in cache:
        return cache[name]
    fn = P[name]["file_name"]
    # HEAD no siempre trae Content-Length (Cloudflare): se descarga a wheels/ y se mide.
    dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wheels", fn)
    if not os.path.exists(dest):
        subprocess.run(["curl", "-sL", "-o", dest, CDN + fn], check=True)
    s = os.path.getsize(dest)
    cache[name] = s
    return s


def report(title, names):
    c = closure(names)
    tot = 0
    print(f"\n== {title}: {', '.join(names)}")
    for n in sorted(c, key=lambda x: -size(x)):
        s = size(n)
        tot += s
        print(f"  {n:22s} {P[n]['version']:10s} {s/1048576:7.2f} MiB  {P[n]['file_name']}")
    print(f"  TOTAL {tot/1048576:.2f} MiB ({len(c)} paquetes)")
    return tot


core = 9610179 + 1249764 + 17880 + 2552165 + 115407  # ficheros core en public/pyodide
print(f"Core Pyodide (wasm+asm.mjs+mjs+stdlib+lock): {core/1048576:.2f} MiB")
a = report("Solo numpy (hoy, taludes)", ["numpy"])
b = report("numpy + scipy (PyNite con matplotlib/prettytable stub)", ["numpy", "scipy"])
c = report("PyNite 3.2.0 requires_dist completo en Pyodide", ["numpy", "scipy", "matplotlib"])
print("\n(prettytable NO está en el lock: wheel puro de PyPI, hay que vendorizarlo o stub)")
print(f"\nIncremento sobre hoy si se stubbea matplotlib: {(b-a)/1048576:.2f} MiB")
print(f"Incremento sobre hoy con matplotlib real:     {(c-a)/1048576:.2f} MiB")
print(f"Total offline FEM3D (core + numpy + scipy + PyNite ~0.2 MiB): {(core+b+203480)/1048576:.2f} MiB")
print(f"Total offline FEM3D con matplotlib:                          {(core+c+203480)/1048576:.2f} MiB")
