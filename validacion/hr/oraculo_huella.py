"""Fase HR, criterio 2 (docs/fem3d/huella-rigida.md §3.3): la malla tensorial de la losa 3 × 3 mezclada
con OpenSeesPy ASDShellQ4, frente al motor en la misma malla.

Lee validacion/hr/opensees-modelos.json (bun validacion/hr/tensorial.ts): por variante («tensorial-enlace»,
con el enlace rígido sólo en los nudos de la huella; «tensorial-parche», la huella como láminas 1 000
veces más rígidas), el modelo analítico y el metro de cada cara de cada pilar con el My del motor.
Cada estación se calcula aquí con las fuerzas de los elementos de OpenSees y la definición de
validacion/f/oraculo_franjas.py. El motor y OpenSees tienen que coincidir a ≤ 1e-6 relativo.

Uso: .venv312/Scripts/python.exe validacion/hr/oraculo_huella.py → validacion/hr/out_opensees.txt
"""
import json
import os
import sys
import time

import openseespy.opensees as ops

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(AQUI), "f"))
sys.path.insert(0, os.path.join(os.path.dirname(AQUI), "e6"))
from oraculo_franjas import estacion  # noqa: E402
from oraculo_opensees import resolver  # noqa: E402


def main():
    entrada = json.load(open(os.path.join(AQUI, "opensees-modelos.json"), encoding="utf-8"))
    lineas = ["# Fase HR, criterio 2: la malla tensorial de la losa 3 × 3 mezclada, motor frente a OpenSeesPy ASDShellQ4", ""]
    lineas.append("Misma malla y mismo modelo en los dos. Diferencia relativa del My del metro de cada cara (sobre el valor de OpenSees; sobre el mayor |My| en las caras con poco momento).")
    lineas.append("")
    lineas.append("variante | nudos | estaciones comparadas (de) | diferencia máxima relativa | media | máxima sobre el mayor |My|")
    for nombre, x in entrada.items():
        modelo = x["modelo"]
        t = time.perf_counter()
        enlace = {}
        for i, r in enumerate(modelo.get("restricciones", [])):
            if r["tipo"] == "enlace-rigido":
                for v in [r["maestro"], *r["esclavos"]]:
                    enlace[v] = i
        rigidas = {k for k, l in enumerate(modelo["laminas"]) if all(v in enlace for v in l["nudos"]) and len({enlace[v] for v in l["nudos"]}) == 1}
        resolver(modelo, modelo["casos"][0])
        fuerzas = [ops.eleResponse(k + 1, "forces") for k in range(len(modelo["laminas"]))]
        comp = []
        for e in x["estaciones"]:
            v = estacion(modelo, rigidas, e, fuerzas)
            if v is not None:
                comp.append((e["my"][0], v))
        mx = max(abs(v) for _, v in comp)
        rel = [abs(m - v) / abs(v) for m, v in comp if abs(v) > 0.2 * mx]
        sobre = [abs(m - v) / mx for m, v in comp]
        lineas.append(f"{nombre} | {len(modelo['nudos'])} | {len(comp)} de {len(x['estaciones'])} | {max(rel):.2e} | {sum(rel) / len(rel):.2e} | {max(sobre):.2e}")
        print(nombre, f"{time.perf_counter() - t:.1f} s", flush=True)
    open(os.path.join(AQUI, "out_opensees.txt"), "w", encoding="utf-8", newline="").write("\n".join(lineas) + "\n")
    print("\n".join(lineas))


if __name__ == "__main__":
    sys.exit(main())
