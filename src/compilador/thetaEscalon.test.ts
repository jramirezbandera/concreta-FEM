/**
 * A2-24 (`docs/fem3d/auditoria-2.md` §11.2): la θ del art. 3.8 de la NCSE-02 (P·d/(V·h)) de un nivel se
 * mide con cada base de la que le llega un tramo de pilar, y vale la mayor. Antes, siempre con el nivel
 * de debajo por cota: en la vivienda, la cubierta superior (planta `escalon`, a 4,30) tomaba los 0,90 m
 * hasta la cubierta baja, que está al lado y no debajo, aunque sus 13 pilares arrancan de la cimentación;
 * según X, θ salía 0,0078 en vez de 0,0121.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioSO } from "../../validacion/so/modelos.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { calcular } from "../motor/calcular.ts";
import { compilar } from "./compilar.ts";
import { Consultas } from "./consultas.ts";
import type { ModeloFisico } from "./fisico.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
beforeAll(async () => {
  await iniciarNucleo(readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm")));
});

function sismo(f: ModeloFisico) {
  const c = compilar(f);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => d.mensaje).join("\n"));
  const r = calcular(c.modelo);
  if (!r.valido) throw new Error("no calcula");
  const q = new Consultas(f, c, r.casos, {}, r.modal);
  const s = q.sismo();
  if (!s.valido) throw new Error(JSON.stringify(s.diagnosticos));
  return { s: s.valor, resp: q.sismoCalculado!.respuestas, g: r.modal!.g };
}

const SISMO = { ab: 0.11, K: 1, terreno: "II" as const, mu: 2 };

describe("A2-24: la θ de cada nivel, con la base de sus pilares", () => {
  it("en la vivienda, la cubierta superior según X, desde la cimentación (4,30 m): la mayor de sus dos bases", () => {
    const p = JSON.parse(readFileSync(join(RAIZ, "ejemplos", "vivienda", "proyecto.json"), "utf8")) as { modelo: ModeloFisico };
    const { s, g } = sismo({ ...p.modelo, acciones: { ...p.modelo.acciones, sismo: SISMO } });
    const x = s.direcciones[0];
    const sup = x.niveles[0]!;
    expect(sup.plantas).toEqual(["CUB-S"]);
    expect(sup.altura).toBeCloseTo(4.3, 12);
    // Desde la cimentación, la deriva es el desplazamiento
    expect(sup.deriva).toBe(sup.desplazamiento);
    expect(sup.theta).toBeCloseTo((sup.masa * g * sup.deriva) / (sup.cortante * 4.3), 12);
    // Según Y manda la de los 0,90 m hasta la cubierta baja (los tramos cortos entre las dos)
    const supY = s.direcciones[1].niveles[0]!;
    expect(supY.altura).toBeCloseTo(0.9, 12);
    expect(supY.theta).toBeGreaterThan((supY.masa * g * supY.desplazamiento) / (supY.cortante * 4.3));
  });

  it("en un edificio apilado, lo de antes: el nivel de debajo por cota, con la deriva del motor", () => {
    const { s, resp, g } = sismo({ ...edificioSO(), acciones: { sismo: SISMO } });
    for (const eje of [0, 1] as const) {
      const nv = resp[eje].niveles;
      let encima = 0;
      s.direcciones[eje].niveles.forEach((n, i) => {
        encima += nv[i]!.masa;
        const h = nv[i]!.z - (nv[i + 1]?.z ?? 0);
        expect(n.altura).toBe(h);
        expect(n.deriva).toBe(nv[i]!.deriva);
        expect(n.theta).toBe((encima * g * nv[i]!.deriva) / (nv[i]!.cortante * h));
      });
    }
  });
});
