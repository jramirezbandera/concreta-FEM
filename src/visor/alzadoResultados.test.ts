/**
 * VC4 (`docs/fem3d/coherencia-vistas.md`, CV-5): los pilares y los muros de Resultados en el alzado.
 * - Pilares: cada tramo de un pilar del plano sale una vez, con el color y el valor de su tramo en el
 *   3D (`pilares3D`, el cuadro); los de fuera del plano, no.
 * - Muros: el mapa de un campo en las láminas de los muros paralelos al plano; su mínimo y su máximo
 *   son los de esas láminas en la combinación dibujada (`valoresCampo`, calculado aparte), y sin
 *   muros en el plano no hay mapa.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { reticulaConNucleo } from "../../validacion/c3/modelos.ts";
import type { ConjuntoCombinaciones } from "../agente/combinaciones.ts";
import { VERSION_ESQUEMA } from "../agente/proyecto.ts";
import { planoDeEje } from "../agente/render/alzado.ts";
import type { Escena, Primitiva } from "../agente/render/escena.ts";
import { valoresCampo, type ResultadosRender } from "../agente/render/resultados.ts";
import { cotasPlantas } from "../compilador/cotas.ts";
import { ejesDe } from "../compilador/ejes.ts";
import type { AccionCaso, ModeloFisico } from "../compilador/fisico.ts";
import { sha256 } from "../compilador/huella.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { Atendedor } from "./atender.ts";
import { laminaMuroEnPlano } from "./alzadoResultados.ts";
import { pilares3D, SIN_BANDA, type MagnitudPilares } from "./pilares3d.ts";
import type { Sesion } from "./sesion.ts";

let at: Atendedor;
let s: Sesion;
let modelo: ModeloFisico;

const valido = <T,>(r: { valido: true; valor: T } | { valido: false; diagnosticos: { mensaje: string }[] }): T => {
  if (!r.valido) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return r.valor;
};

beforeAll(async () => {
  const wasm = readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm"));
  await iniciarNucleo(wasm);
  const f = reticulaConNucleo();
  modelo = { ...f, casos: f.casos.map((c, i): typeof c => ({ ...c, accion: (i === 0 ? { tipo: "G" } : { tipo: "Q", psi: "uso-A" }) as AccionCaso })) };
  at = new Atendedor(sha256(new Uint8Array(wasm)));
  for (const p of [{ tipo: "abrir", texto: JSON.stringify({ esquema: VERSION_ESQUEMA, modelo }) }, { tipo: "calcular" }] as const) {
    const r = await at.atender(p);
    if (!r.ok) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  }
  s = (at as unknown as { sesion: Sesion }).sesion;
}, 600_000);

const rr = () => (s as unknown as { rr: ResultadosRender }).rr;
const rellenos = (e: Escena) => e.primitivas.filter((p): p is Extract<Primitiva, { tipo: "poligono" }> => p.tipo === "poligono" && !!p.relleno && p.estilo === "contorno");

describe("VC4: pilares y muros en el alzado", () => {
  it("pilares: cada tramo del plano, con el color y el valor del 3D", () => {
    const D = { tipo: "defecto" } as const;
    let vistos = 0;
    for (const magnitud of ["N", "nu"] as MagnitudPilares[]) {
      const conj = valido((s as unknown as { conjunto: (e: typeof D, p: string) => { valido: true; valor: ConjuntoCombinaciones } }).conjunto(D, "esfuerzos"));
      const todo = pilares3D(rr(), [0, 0, 0], magnitud, conj, null);
      for (const eje of ejesDe(modelo).ejes) {
        const plano = planoDeEje(modelo, eje.id)!;
        const e = valido(s.alzadoA4({ eje: eje.id }, undefined, undefined, undefined, undefined, undefined, { pilares: { magnitud, combinaciones: D } }));
        const L = Math.hypot(plano.hasta[0] - plano.desde[0], plano.hasta[1] - plano.desde[1]);
        const nor = [-(plano.hasta[1] - plano.desde[1]) / L, (plano.hasta[0] - plano.desde[0]) / L];
        const enPlano = new Set((modelo.pilares ?? []).filter((p) => Math.abs((p.x - plano.desde[0]) * nor[0]! + (p.y - plano.desde[1]) * nor[1]!) <= 0.5).map((p) => p.id));
        const esperados = todo.tramos.map((t, i) => ({ t, color: todo.banda[i] === SIN_BANDA ? "#9ca3af" : todo.colores[todo.banda[i]!]! })).filter((x) => enPlano.has(x.t.pilar));
        const P = rellenos(e);
        expect(P.length, eje.id).toBe(esperados.length);
        P.forEach((p, k) => {
          expect(p.objeto).toBe(esperados[k]!.t.pilar);
          expect(p.relleno).toBe(esperados[k]!.color);
        });
        // El extremo, el del tramo de lo que se ve
        for (const x of e.extremos) expect(esperados.map((y) => y.t.valor)).toContain(x.valor);
        if (magnitud === "N" && esperados.some((x) => (x.t.valor ?? 0) < 0)) expect(e.extremos[0]!.valor).toBe(Math.min(...esperados.map((x) => x.t.valor ?? 0)));
        vistos += P.length;
      }
    }
    expect(vistos).toBeGreaterThan(0);
  }, 600_000);

  it("muros: el mapa de las láminas de los muros del plano, con sus extremos", () => {
    const c = rr().c;
    let conMapa = 0;
    let sinMapa = 0;
    for (const campo of ["uz", "m11", "f22"] as const) {
      const conj = valido((s as unknown as { conjunto: (e: unknown, p: string) => never }).conjunto({ tipo: "defecto" }, campo === "uz" ? "desplazamientos" : "esfuerzos")) as { factores: number[][]; nombres: string[] };
      for (const eje of ejesDe(modelo).ejes) {
        const plano = planoDeEje(modelo, eje.id)!;
        const e = valido(s.alzadoA4({ eje: eje.id }, undefined, undefined, undefined, undefined, undefined, { muros: { campo, combinaciones: { tipo: "defecto" } } }));
        const L = Math.hypot(plano.hasta[0] - plano.desde[0], plano.hasta[1] - plano.desde[1]);
        const dir = [(plano.hasta[0] - plano.desde[0]) / L, (plano.hasta[1] - plano.desde[1]) / L];
        const nor = [-dir[1]!, dir[0]!];
        const ww = (n: number) => (c.modelo.nudos[n]!.x - plano.desde[0]) * nor[0]! + (c.modelo.nudos[n]!.y - plano.desde[1]) * nor[1]!;
        // Aparte: las láminas de muro del plano, con los valores de la combinación dibujada
        const k = conj.nombres.indexOf(e.mapa?.combinacion ?? "");
        let [vmin, vmax, n] = [Infinity, -Infinity, 0];
        for (const p of modelo.plantas) {
          const x = valoresCampo(rr(), p.id, campo, conj.factores[Math.max(k, 0)]!, "muros");
          x.laminas.forEach((l, i) => {
            const lam = c.modelo.laminas![l]!;
            if (!lam.nudos.every((nn) => Math.abs(ww(nn)) <= 0.5) || (lam.eje1 && Math.abs(lam.eje1[0] * nor[0]! + lam.eje1[1] * nor[1]!) >= Math.sin(Math.PI / 18))) return;
            n++;
            for (let a = 0; a < 4; a++) {
              const v = x.v[4 * i + a]!;
              if (Number.isNaN(v)) continue;
              vmin = Math.min(vmin, v);
              vmax = Math.max(vmax, v);
            }
          });
        }
        if (!n) {
          expect(e.mapa, eje.id).toBeUndefined();
          expect(e.primitivas.some((p) => p.tipo === "region")).toBe(false);
          sinMapa++;
          continue;
        }
        expect(e.mapa, eje.id).toBeDefined();
        expect(k).toBeGreaterThanOrEqual(0);
        expect(e.mapa!.minimo).toBe(vmin);
        expect(e.mapa!.maximo).toBe(vmax);
        expect(e.primitivas.some((p) => p.tipo === "region")).toBe(true);
        conMapa++;
      }
    }
    expect(conMapa).toBeGreaterThan(0);
    expect(sinMapa).toBeGreaterThan(0);
  }, 600_000);

  it("VC5: lo que hay bajo el cursor de la planta y del alzado (`objetivo`)", async () => {
    const D = { tipo: "defecto" } as const;
    const ejes = ejesDe(modelo).ejes;
    // Diagramas en planta: la estación de la viga bajo el punto, con el punto en su eje
    const vb = s.objetivo({ tipo: "planta", planta: "N1", vista: { vista: "vigas", esfuerzo: "My", combinaciones: D } }, [9, 0.1], 0.2);
    expect(vb?.tipo).toBe("barra");
    if (vb?.tipo === "barra") {
      expect(vb.pieza).toBe("X0-N1");
      expect(Math.abs(vb.p[0] - 9)).toBeLessThan(1e-9);
      expect(Math.abs(vb.p[1] - 0.1)).toBeLessThan(1e-9);
      const r = await at.atender({ tipo: "estacion", id: vb.pieza, esfuerzo: "My", combinaciones: D, s: vb.s });
      expect(r.ok).toBe(true);
    }
    // Pilares en planta: el pilar y la planta de la vista; en el alzado, la planta del tramo de la cota
    expect(s.objetivo({ tipo: "planta", planta: "N1", vista: { vista: "pilares-n", combinaciones: D } }, [0, 5], 0.2)).toEqual({ tipo: "pilar", pilar: "P0-5", planta: "N1" });
    const ejeX0 = ejes.find((e) => { const pl = planoDeEje(modelo, e.id)!; return Math.abs(pl.desde[0] - pl.hasta[0]) < 1e-9 && Math.abs(pl.desde[0]) < 1e-9; });
    expect(ejeX0).toBeDefined();
    const plano = planoDeEje(modelo, ejeX0!.id)!;
    const L = Math.hypot(plano.hasta[0] - plano.desde[0], plano.hasta[1] - plano.desde[1]);
    const cotas = cotasPlantas(modelo.plantas) as number[];
    const u5 = ((0 - plano.desde[0]) * (plano.hasta[0] - plano.desde[0]) + (5 - plano.desde[1]) * (plano.hasta[1] - plano.desde[1])) / L;
    expect(s.objetivo({ tipo: "alzado", plano: { eje: ejeX0!.id }, pilares: { magnitud: "N", combinaciones: D } }, [u5, (cotas[0]! + cotas[1]!) / 2], 0.2)).toEqual({ tipo: "pilar", pilar: "P0-5", planta: "N1" });
    // Reacciones: el objeto bajo el punto
    const re = s.objetivo({ tipo: "planta", planta: "C", vista: { vista: "reacciones", combinaciones: D } }, [0, 5], 0.3);
    expect(re).toEqual({ tipo: "reaccion", objeto: "P0-5" });
    // Muros en el alzado: una lámina del muro del plano, con el punto en él; fuera de los muros, nada
    let vistos = 0;
    for (const eje of ejes) {
      const pl = planoDeEje(modelo, eje.id)!;
      const en = laminaMuroEnPlano(rr(), pl);
      const c = rr().c;
      const l = c.modelo.laminas!.findIndex((_, i) => en(i));
      if (l < 0) {
        expect(s.objetivo({ tipo: "alzado", plano: { eje: eje.id }, muros: { campo: "m11", combinaciones: D } }, [1, 1], 0.2)).toBeNull();
        continue;
      }
      const ns = c.modelo.laminas![l]!.nudos.map((n) => c.modelo.nudos[n]!);
      const Lp = Math.hypot(pl.hasta[0] - pl.desde[0], pl.hasta[1] - pl.desde[1]);
      const uu = (x: number, y: number) => ((x - pl.desde[0]) * (pl.hasta[0] - pl.desde[0]) + (y - pl.desde[1]) * (pl.hasta[1] - pl.desde[1])) / Lp;
      const cu = ns.reduce((a, n) => a + uu(n.x, n.y), 0) / 4;
      const cz = ns.reduce((a, n) => a + n.z, 0) / 4;
      const o = s.objetivo({ tipo: "alzado", plano: { eje: eje.id }, muros: { campo: "m11", combinaciones: D } }, [cu, cz], 0.2);
      expect(o?.tipo).toBe("lamina");
      if (o?.tipo === "lamina") {
        expect(en(o.lamina)).toBe(true);
        expect(Math.abs(uu(o.p[0], o.p[1]) - cu)).toBeLessThan(1e-9);
        const r = await at.atender({ tipo: "valor-lamina", campo: "m11", combinaciones: D, envolvente: "max", lamina: o.lamina, punto: o.p });
        expect(r.ok).toBe(true);
      }
      vistos++;
    }
    expect(vistos).toBeGreaterThan(0);
  }, 600_000);

  it("por el atendedor: el pedido del alzado con pilares y con muros", async () => {
    const eje = ejesDe(modelo).ejes[0]!.id;
    for (const extra of [{ pilares: { magnitud: "N" as const, combinaciones: { tipo: "defecto" as const } } }, { muros: { campo: "m11" as const, combinaciones: { tipo: "defecto" as const }, envolvente: "max" as const } }]) {
      const r = await at.atender({ tipo: "alzado", plano: { eje }, ...extra });
      expect(r.ok).toBe(true);
    }
  }, 600_000);
});
