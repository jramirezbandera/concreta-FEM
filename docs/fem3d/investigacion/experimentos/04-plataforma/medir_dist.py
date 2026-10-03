"""Mide el precache real del SW (dist/sw.js) y el peso de dist/ y public/pyodide.

Uso: python medir_dist.py
"""
import gzip
import json
import os
import re
import sys

WT = r"D:\PROGRAMACION\Concreta EST\wt\feat-fem3d"
DIST = os.path.join(WT, "dist")


def gz(path):
    with open(path, "rb") as f:
        data = f.read()
    return len(data), len(gzip.compress(data, 9))


sw = open(os.path.join(DIST, "sw.js"), encoding="utf-8").read()
urls = re.findall(r'url:"([^"]+)"', sw)
tot_raw = tot_gz = 0
missing = []
biggest = []
for u in urls:
    p = os.path.join(DIST, u.replace("/", os.sep))
    if not os.path.exists(p):
        missing.append(u)
        continue
    r, g = gz(p)
    tot_raw += r
    tot_gz += g
    biggest.append((r, g, u))
biggest.sort(reverse=True)
print(f"Entradas precache: {len(urls)}  (faltan en disco: {len(missing)})")
print(f"Precache total: {tot_raw/1048576:.2f} MiB bruto, {tot_gz/1048576:.2f} MiB gzip-9")
print("Mayores entradas del precache:")
for r, g, u in biggest[:8]:
    print(f"  {r/1024:8.1f} KiB  (gz {g/1024:7.1f})  {u}")

# Lo que NO está en el precache
allfiles = []
for root, _, files in os.walk(DIST):
    for fn in files:
        rel = os.path.relpath(os.path.join(root, fn), DIST).replace(os.sep, "/")
        allfiles.append(rel)
fuera = [f for f in allfiles if f not in set(urls)]
fuera_raw = sum(os.path.getsize(os.path.join(DIST, f)) for f in fuera)
print(f"\nFicheros de dist/ fuera del precache: {len(fuera)}, {fuera_raw/1048576:.2f} MiB")
by_dir = {}
for f in fuera:
    d = f.split("/")[0]
    by_dir.setdefault(d, 0)
    by_dir[d] += os.path.getsize(os.path.join(DIST, f))
for d, s in sorted(by_dir.items(), key=lambda x: -x[1]):
    print(f"  {d:12s} {s/1048576:6.2f} MiB")
assets_fuera = [f for f in fuera if f.startswith("assets/")]
print("  assets fuera:", assets_fuera)

# Pyodide: bruto y gzip
print("\npublic/pyodide (copiado a dist/pyodide):")
pd = os.path.join(DIST, "pyodide")
tr = tg = 0
for fn in sorted(os.listdir(pd)):
    r, g = gz(os.path.join(pd, fn))
    tr += r
    tg += g
    print(f"  {fn:60s} {r/1048576:6.2f} MiB  gz {g/1048576:6.2f} MiB")
print(f"  TOTAL {tr/1048576:.2f} MiB bruto, {tg/1048576:.2f} MiB gzip-9")

# Entry chunk
idx = open(os.path.join(DIST, "index.html"), encoding="utf-8").read()
ents = re.findall(r'(?:src|href)="/(assets/[^"]+\.(?:js|css))"', idx)
print("\nindex.html referencia:")
for e in ents:
    r, g = gz(os.path.join(DIST, e))
    print(f"  {e:50s} {r/1024:7.1f} KiB gz {g/1024:6.1f} KiB")
