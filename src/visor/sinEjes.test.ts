/**
 * El botón «Ejes» de la barra de la vista (`sinEjes`): la planta y el alzado sin los ejes de
 * replanteo ni sus cotas, con todo lo demás igual (en el alzado, las cotas de las plantas se quedan).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ejesDe } from "../compilador/ejes.ts";
import type { Proyecto } from "../agente/proyecto.ts";
import { planoDeEje, vistaAlzado } from "../agente/render/alzado.ts";
import { vistaModelo } from "../agente/render/modelo.ts";
import { prepararEscena, sinEjes, type EscenaPreparada } from "./escena.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const f = (JSON.parse(readFileSync(join(RAIZ, "validacion/a2/agente/edificio/proyecto.json"), "utf8")) as Proyecto).modelo;
const d = { huella: "0123456789abcdef" };
const EJES = new Set(["eje", "eje-burbuja", "cota"]);
const ids = new Set(ejesDe(f).ejes.map((e) => e.id));

function comprobar(p: EscenaPreparada, s: EscenaPreparada) {
  expect(p.capas.some((c) => EJES.has(c.estilo))).toBe(true);
  expect(s.capas.some((c) => EJES.has(c.estilo))).toBe(false);
  expect(s.glifos.some((g) => g.estilo === "eje-burbuja")).toBe(false);
  expect(s.textos.some((t) => t.clase === "cota" || (t.clase === "eje" && ids.has(t.objeto!)))).toBe(false);
  expect(s.leyenda.some((l) => l.estilo && EJES.has(l.estilo))).toBe(false);
  // Lo demás, igual y en el mismo orden
  expect(s.capas).toEqual(p.capas.filter((c) => !EJES.has(c.estilo)));
  expect(s.glifos).toEqual(p.glifos.filter((g) => g.estilo !== "eje-burbuja"));
  expect(s.caja).toEqual(p.caja);
}

describe("sinEjes", () => {
  it("planta: sin ejes, burbujas ni cotas; lo demás igual", () => {
    const p = prepararEscena(vistaModelo(f, f.plantas[0]!.id, d));
    const s = sinEjes(p);
    comprobar(p, s);
    expect(s.textos.length).toBeLessThan(p.textos.length);
  });

  it("alzado: sin los ejes que cruzan, con las cotas de las plantas", () => {
    const eje = ejesDe(f).ejes[0]!;
    const p = prepararEscena(vistaAlzado(f, planoDeEje(f, eje.id)!, d));
    const s = sinEjes(p);
    comprobar(p, s);
    const plantas = (e: EscenaPreparada) => e.textos.filter((t) => t.clase === "eje" && !ids.has(t.objeto!));
    expect(plantas(s).length).toBeGreaterThan(0);
    expect(plantas(s)).toEqual(plantas(p));
  });
});
