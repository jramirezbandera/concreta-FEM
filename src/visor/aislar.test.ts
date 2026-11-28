/**
 * VC6 (`docs/fem3d/coherencia-vistas.md`, CV-8): aislar y ocultar en las vistas planas.
 * - Filtrar la escena preparada (`filtrarObjetos`) da, capa a capa en su orden, los mismos números
 *   que preparar la escena sin las primitivas de lo que no se ve, y lo mismo en glifos y textos.
 * - Con el filtro, elegir (un clic o una ventana) no coge lo que no se ve.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { reticulaConNucleo } from "../../validacion/c3/modelos.ts";
import { VERSION_ESQUEMA } from "../agente/proyecto.ts";
import type { Escena, Primitiva } from "../agente/render/escena.ts";
import { sha256 } from "../compilador/huella.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { Atendedor } from "./atender.ts";
import { filtrarObjetos, prepararEscena, visibleConFiltro, type EscenaPreparada, type FiltroObjetos } from "./escena.ts";
import type { FuenteEscena, Sesion } from "./sesion.ts";

let s: Sesion;

beforeAll(async () => {
  const wasm = readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm"));
  await iniciarNucleo(wasm);
  const at = new Atendedor(sha256(new Uint8Array(wasm)));
  const r = await at.atender({ tipo: "abrir", texto: JSON.stringify({ esquema: VERSION_ESQUEMA, modelo: reticulaConNucleo() }) });
  if (!r.ok) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  s = (at as unknown as { sesion: Sesion }).sesion;
}, 600_000);

const valido = <T,>(r: { valido: true; valor: T } | { valido: false; diagnosticos: { mensaje: string }[] }): T => {
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return r.valor;
};

const objetoDe = (p: Primitiva): string | undefined => ("objeto" in p ? p.objeto : undefined);

/** Los números de las capas de una escena preparada, por estilo y forma, en su orden. */
function numeros(e: EscenaPreparada): Map<string, { a: number[]; s: number[] }> {
  const m = new Map<string, { a: number[]; s: number[] }>();
  for (const c of e.capas) {
    const k = `${c.estilo}|${c.forma}|${c.relleno ?? ""}`;
    const x = m.get(k) ?? m.set(k, { a: [], s: [] }).get(k)!;
    x.a.push(...c.abanicos);
    x.s.push(...c.segmentos);
  }
  for (const [k, x] of m) if (!x.a.length && !x.s.length) m.delete(k);
  return m;
}

describe("VC6: aislar y ocultar en planta y alzado", () => {
  const fuentes: FuenteEscena[] = [
    { tipo: "planta", planta: "N1", vista: { vista: "modelo" } },
    { tipo: "alzado", plano: { eje: "B" } },
  ];
  const filtros: FiltroObjetos[] = [{ ocultos: ["NUCLEO", "P0-5"] }, { aislados: ["P6-5", "X5-N1"] }, { aislados: ["P6-5", "NUCLEO"], ocultos: ["NUCLEO"] }];

  it("filtrar la escena preparada es prepararla sin lo que no se ve", () => {
    for (const fu of fuentes) {
      const e = valido(fu.tipo === "planta" ? s.escenaA4(fu.planta, fu.vista) : s.alzadoA4(fu.plano)) as Escena;
      const prep = prepararEscena(e);
      for (const f of filtros) {
        const ve = visibleConFiltro(f)!;
        const filtrada = filtrarObjetos(prep, ve);
        // El origen de la escena preparada sale de su caja, que no cambia: se prepara con la misma
        const sin = prepararEscena({ ...e, primitivas: e.primitivas.filter((p) => objetoDe(p) === undefined || ve(objetoDe(p)!)) });
        expect(sin.origen).toEqual(prep.origen);
        const [a, b] = [numeros(filtrada), numeros(sin)];
        expect([...a.keys()].sort(), JSON.stringify(f)).toEqual([...b.keys()].sort());
        for (const [k, x] of a) {
          expect(x.a, k).toEqual(b.get(k)!.a);
          expect(x.s, k).toEqual(b.get(k)!.s);
        }
        expect(filtrada.glifos).toEqual(sin.glifos);
        expect(filtrada.textos).toEqual(sin.textos);
        // Y quita algo
        const quitados = e.primitivas.filter((p) => objetoDe(p) !== undefined && !ve(objetoDe(p)!)).length;
        expect(quitados).toBeGreaterThan(0);
      }
    }
  });

  it("con el filtro, elegir no coge lo que no se ve", () => {
    const fu: FuenteEscena = { tipo: "planta", planta: "N1", vista: { vista: "modelo" } };
    expect(s.elegir(fu, [0, 5], 0.2)?.objeto).toBe("P0-5");
    const otro = s.elegir(fu, [0, 5], 0.2, undefined, undefined, { ocultos: ["P0-5"] })?.objeto;
    expect(otro).not.toBe("P0-5");
    expect(s.elegir(fu, [0, 5], 0.2, undefined, undefined, { aislados: ["P6-5"] })?.objeto ?? null).not.toBe("P0-5");
    const todos = s.ventana(fu, [-1, -1, 19, 16], "dentro");
    const vistos = s.ventana(fu, [-1, -1, 19, 16], "dentro", undefined, { aislados: ["P6-5", "P0-5"] });
    expect(todos.length).toBeGreaterThan(2);
    expect([...vistos].sort()).toEqual(["P0-5", "P6-5"].filter((x) => todos.includes(x)).sort());
    expect(s.ventana(fu, [-1, -1, 19, 16], "dentro", undefined, { ocultos: ["P0-5"] })).not.toContain("P0-5");
  });
});
