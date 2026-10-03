"""Resume los JSON del banco de escena en una tabla. Uso: python resumen.py a.json b.json ..."""
import json
import sys

for f in sys.argv[1:]:
    d = json.load(open(f, encoding="utf-8"))
    v = d.get("value") or {}
    if not v:
        print(f, "ERROR", d.get("error"))
        continue
    print(f"\n### {f} — {d['modo']} ×{d.get('throttle', 1)} CPU — {v['info']['renderer'][:70]}")
    m = v["modelo"]
    print(f"modelo: {m['barras']} barras, {m['triangulosLamina']} triángulos de lámina; heap JS {v.get('heapMB')} MB")
    print(f"{'variante':14s} {'construir':>9s} {'1er frame':>9s} {'frame med':>9s} {'p95':>6s} {'draw':>5s} {'tris':>7s} | picking ms (media / p95, aciertos)")
    for k, r in v["variantes"].items():
        picks = []
        for pk, pv in r.items():
            if pk.startswith("pick_"):
                picks.append(f"{pk[5:]}={pv['media']:.3f}/{pv['p95']:.2f} ({pv['aciertos']})")
        preps = [f"{pk[7:]}:{pv}ms" for pk, pv in r.items() if pk.startswith("msPrep")]
        print(f"{k:14s} {r['msConstruir']:9.1f} {r['msPrimerFrame']:9.1f} {r['frame']['med']:9.2f} {r['frame']['p95']:6.2f} {r['drawCalls']:5d} {r['triangulos']:7d} | {'; '.join(picks)} {('prep ' + ', '.join(preps)) if preps else ''}")
