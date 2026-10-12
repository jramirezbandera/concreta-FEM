/**
 * Resultados · Bandas (V2b, `docs/fem3d/visor.md` §7.4 d, criterio 7): lo que enseña la pantalla
 * de las bandas es lo de las consultas, bit a bit:
 * - cada fila, el menor My de las caras y el mayor de los vanos de `fem consultar banda`;
 * - el detalle de una banda, sus estaciones de la consulta y Wood–Armer de `woodArmerEstacion`;
 * - la escena, los extremos de cada banda;
 * - el reparto, el de `Consultas.reparto` en la combinación de cada línea.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { conAcciones, conPropuesta, reticularH25 } from "../../validacion/c5/modelos.ts";
import { VERSION_ESQUEMA } from "../agente/proyecto.ts";
import { banda } from "../agente/consultas.ts";
import { direccionBanda } from "../agente/render/bandas.ts";
import { woodArmerEstacion } from "../compilador/esfuerzosBandas.ts";
import { direccionEje1 } from "../compilador/losas.ts";
import { sha256 } from "../compilador/huella.ts";
import { serializar } from "../editor/serializar.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { Atendedor } from "./atender.ts";
import { datosBanda, datosBandas } from "./bandas.ts";
import { Sesion, type EleccionCombinaciones } from "./sesion.ts";

const RAIZ = join(import.meta.dirname, "..", "..");
const WASM = readFileSync(join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm"));
const MOTOR = sha256(new Uint8Array(WASM));
const D: EleccionCombinaciones = { tipo: "defecto" };

const valido = <T>(r: { valido: true; valor: T } | { valido: false; diagnosticos: unknown }): T => {
  if (!r.valido) throw new Error(JSON.stringify(r.diagnosticos));
  return r.valor;
};

beforeAll(async () => {
  await iniciarNucleo(WASM);
});

describe("Resultados · Bandas en el reticular de H25 con sus bandas propuestas", () => {
  let s: Sesion;
  beforeAll(async () => {
    const modelo = conAcciones(conPropuesta(reticularH25()));
    const a = Sesion.abrir(serializar({ esquema: VERSION_ESQUEMA, modelo }), MOTOR);
    if (!a.valido) throw new Error("no abre");
    s = a.sesion;
    expect((await s.calcular()).ok).toBe(true);
  }, 120_000);

  it("cada fila: el menor My de sus caras y el mayor de sus vanos, de «fem consultar banda»", () => {
    const planta = s.proyecto.modelo.bandas![0]!.planta;
    const d = valido(datosBandas(s, planta, D, null));
    const conj = valido(s.conjunto(D, "esfuerzos"));
    expect(d.filas.length).toBe(s.proyecto.modelo.bandas!.length);
    for (const f of d.filas) {
      const c = valido(banda(s.q!, conj, f.id));
      const caras = c.estaciones.filter((x) => x.tipo === "cara" && x.valido !== false && x.min[0] < 0);
      const vanos = c.estaciones.filter((x) => x.tipo === "vano" && x.valido !== false && x.max[0] > 0);
      expect(f.cara?.[0] ?? null).toBe(caras.length ? Math.min(...caras.map((x) => x.min[0])) : null);
      expect(f.vano?.[0] ?? null).toBe(vanos.length ? Math.max(...vanos.map((x) => x.max[0])) : null);
      expect(f.direccion).toBe(direccionBanda(s.proyecto.modelo, s.proyecto.modelo.bandas!.find((b) => b.id === f.id)!));
    }
    // Una dirección: sólo sus bandas
    const d1 = valido(datosBandas(s, planta, D, "1"));
    expect(d1.filas.every((f) => f.direccion === "1")).toBe(true);
    expect(d1.filas.length).toBeGreaterThan(0);
    expect(d1.filas.length).toBeLessThan(d.filas.length);
  });

  it("el detalle: My de la consulta, Wood–Armer de woodArmerEstacion y el momento por nervio", () => {
    const conj = valido(s.conjunto(D, "esfuerzos"));
    for (const b of s.proyecto.modelo.bandas!) {
      const d = valido(datosBanda(s, b.id, D));
      const c = valido(banda(s.q!, conj, b.id));
      const e = valido(s.q!.banda(b.id));
      expect(d.estaciones.map((x) => [x.s, x.max, x.min])).toEqual(c.estaciones.map((x) => [x.s, x.max, x.min]));
      d.estaciones.forEach((x, i) => {
        if (!x.woodArmer) return;
        const w = woodArmerEstacion(e[i]!, conj.factores).envolvente;
        expect(x.woodArmer.inferiorX[0]).toBe(w.valores.inferiorX);
        expect(x.woodArmer.superiorY[0]).toBe(w.valores.superiorY);
      });
      // Reticular: momento por nervio en las estaciones fuera de los ábacos
      expect(d.estaciones.some((x) => x.nervio)).toBe(true);
    }
  });

  it("la escena: un extremo por banda y signo, con los valores de las filas", () => {
    const planta = s.proyecto.modelo.bandas![0]!.planta;
    const d = valido(datosBandas(s, planta, D, null));
    const e = valido(s.escenaA4(planta, { vista: "bandas", combinaciones: D }));
    for (const f of d.filas) {
      const ex = e.extremos!.filter((x) => x.objeto === f.id);
      expect(ex.find((x) => x.que.startsWith("My mínimo"))?.valor ?? null).toBe(f.cara?.[0] ?? null);
      expect(ex.find((x) => x.que.startsWith("My máximo"))?.valor ?? null).toBe(f.vano?.[0] ?? null);
    }
  });

  it("el reparto: el de Consultas.reparto en la combinación de cada línea", () => {
    const planta = s.proyecto.modelo.bandas![0]!.planta;
    const d = valido(datosBandas(s, planta, D, null));
    const conj = valido(s.conjunto(D, "esfuerzos"));
    expect(d.reparto.length).toBeGreaterThan(0);
    for (const li of d.reparto) {
      const losa = s.proyecto.modelo.losas!.find((l) => l.id === li.losa)!;
      const d1 = direccionEje1(losa.eje1 ?? 0);
      const k = conj.nombres.indexOf(li.comb);
      const r = valido(s.q!.reparto(li.losa, li.direccion === "1" ? d1 : [-d1[1], d1[0]], conj.factores[k]!));
      const x = r.find((y) => y.tipo === li.tipo && Math.abs(y.s - li.s) < 1e-9)!;
      expect([x.pilares, x.centrales]).toEqual([li.pilares, li.centrales]);
    }
  });

  it("por el atendedor del worker, lo mismo", async () => {
    const at = new Atendedor(MOTOR);
    const modelo = conAcciones(conPropuesta(reticularH25()));
    expect((await at.atender({ tipo: "abrir", texto: serializar({ esquema: VERSION_ESQUEMA, modelo }) })).ok).toBe(true);
    expect((await at.atender({ tipo: "calcular" })).ok).toBe(true);
    const planta = modelo.bandas![0]!.planta;
    const r = await at.atender({ tipo: "bandas", planta, combinaciones: D, direccion: null });
    expect(r.ok).toBe(true);
    const b = await at.atender({ tipo: "banda", id: modelo.bandas![0]!.id, combinaciones: D });
    expect(b.ok).toBe(true);
  }, 120_000);
});
