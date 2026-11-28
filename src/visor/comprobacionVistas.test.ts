/**
 * VC3 (`docs/fem3d/coherencia-vistas.md`): la comprobación en el alzado y en el 3D, con lo mismo que la
 * tabla y la planta.
 * - Alzado: cada parte que el plano ve sale con el color de su clase y su aprovechamiento (el de la
 *   tabla), y las que no ve no salen; los tramos de pilar, de su base a su cabeza.
 * - 3D: cada triángulo de un tramo de pilar, de un vano de viga o de una losa lleva la clase de su
 *   parte (la de la tabla); los demás, 0.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { edificioObjetivoLosas } from "../../validacion/c2/modelos.ts";
import { VERSION_ESQUEMA } from "../agente/proyecto.ts";
import { planoDeEje } from "../agente/render/alzado.ts";
import type { Escena, Primitiva } from "../agente/render/escena.ts";
import { ejesDe } from "../compilador/ejes.ts";
import type { AccionCaso, ModeloFisico } from "../compilador/fisico.ts";
import { sha256 } from "../compilador/huella.ts";
import { iniciarNucleo } from "../nucleo/index.ts";
import { Atendedor } from "./atender.ts";
import { claseAprovechamiento, COLOR_APROVECHAMIENTO, TIPOS_COMPROBACION, type DatosArmar, type DatosComprobaciones, type ParteComprobada, type TipoComprobacion } from "./comprobaciones.ts";
import { CLASES, type ClasesSolido } from "./comprobacionVistas.ts";
import type { EscenaPreparada } from "./escena.ts";
import type { Pedido } from "./protocolo.ts";
import type { Sesion } from "./sesion.ts";
import type { Solido } from "./solido.ts";

const ACCIONES: Record<string, AccionCaso> = {
  G: { tipo: "G" },
  Q: { tipo: "Q", psi: "uso-A" },
  Vx: { tipo: "W", psi: "viento", direccion: "X", signo: 1, familia: "viento" },
  Vy: { tipo: "W", psi: "viento", direccion: "Y", signo: 1, familia: "viento" },
};

let at: Atendedor;
let modelo: ModeloFisico;
let propuesto: DatosArmar;

const pedir = async <T>(p: Pedido): Promise<T> => {
  const r = await at.atender(p);
  if (!r.ok) throw new Error(r.diagnosticos.map((d) => d.mensaje).join("\n"));
  return r.valor as T;
};

beforeAll(async () => {
  const wasm = readFileSync(join(import.meta.dirname, "..", "nucleo", "pkg", "nucleo_bg.wasm"));
  await iniciarNucleo(wasm);
  const f = edificioObjetivoLosas(2, 2, 2);
  modelo = { ...f, casos: f.casos.map((c) => ({ ...c, accion: ACCIONES[c.id]! })) };
  at = new Atendedor(sha256(new Uint8Array(wasm)));
  await pedir({ tipo: "abrir", texto: JSON.stringify({ esquema: VERSION_ESQUEMA, modelo }) });
  await pedir({ tipo: "calcular" });
  propuesto = await pedir<DatosArmar>({ tipo: "armar", tipos: TIPOS_COMPROBACION });
}, 600_000);

const rellenos = (e: Escena) => e.primitivas.filter((p): p is Extract<Primitiva, { tipo: "poligono" }> => p.tipo === "poligono" && !!p.relleno && p.estilo === "contorno");

describe("VC3: la comprobación en el alzado y en el 3D", () => {
  it("alzado: cada parte que el plano ve, con el color de su clase y el aprovechamiento de la tabla", async () => {
    const armado = propuesto.armado;
    let vistas = 0;
    for (const de of TIPOS_COMPROBACION) {
      const tabla = await pedir<DatosComprobaciones>({ tipo: "comprobaciones", de, armado });
      const porPieza = new Map<string, ParteComprobada[]>();
      for (const p of tabla.partes) (porPieza.get(p.pieza) ?? porPieza.set(p.pieza, []).get(p.pieza)!).push(p);
      for (const eje of ejesDe(modelo).ejes.slice(0, 2)) {
        const plano = planoDeEje(modelo, eje.id)!;
        // Por el atendedor (es una tarea: pone al día lo comprobado) y, la escena sin preparar, de la sesión (en su caché)
        const prep = await pedir<EscenaPreparada>({ tipo: "alzado", plano: { eje: eje.id }, comprobacion: { de, armado } });
        const r = (at as unknown as { sesion: Sesion }).sesion.alzadoA4({ eje: eje.id }, undefined, undefined, undefined, undefined, { de, armado });
        if (!r.valido) throw new Error("sin escena");
        const esc = r.valor;
        expect(prep.extremos).toEqual(esc.extremos);
        const P = rellenos(esc);
        for (const x of P) {
          const partes = porPieza.get(x.objeto!);
          expect(partes, `${de} ${x.objeto}`).toBeDefined();
          // El color es el de la clase de alguna de sus partes
          expect(partes!.map((p) => COLOR_APROVECHAMIENTO[claseAprovechamiento(p)])).toContain(x.relleno);
        }
        // Los aprovechamientos rotulados, los de la tabla
        for (const x of esc.extremos) {
          const p = tabla.partes.find((y) => x.que.startsWith(`aprovechamiento de ${y.clave}`));
          expect(p, x.que).toBeDefined();
          expect(x.valor).toBe(p!.aprovechamiento);
        }
        // Los pilares del plano salen todos, cada tramo de su base a su cabeza
        if (de === "pilares") {
          const L = Math.hypot(plano.hasta[0] - plano.desde[0], plano.hasta[1] - plano.desde[1]);
          const nor = [-(plano.hasta[1] - plano.desde[1]) / L, (plano.hasta[0] - plano.desde[0]) / L];
          const enPlano = (modelo.pilares ?? []).filter((p) => Math.abs((p.x - plano.desde[0]) * nor[0]! + (p.y - plano.desde[1]) * nor[1]!) <= 0.5);
          const tramos = enPlano.flatMap((p) => tabla.partes.filter((t) => t.pieza === p.id));
          expect(tramos.length).toBeGreaterThan(0);
          expect(P.length).toBe(tramos.length);
          expect(esc.extremos.length).toBe(tramos.filter((t) => t.aprovechamiento !== null).length);
        }
        if (P.length) vistas++;
      }
    }
    expect(vistas).toBeGreaterThan(3);
  }, 600_000);

  it("3D: cada triángulo de una parte, con la clase de la tabla; lo demás, 0", async () => {
    const armado = propuesto.armado;
    const sol = await pedir<Solido>({ tipo: "solido" });
    for (const de of ["pilares", "vigas", "losas"] as const satisfies readonly TipoComprobacion[]) {
      const tabla = await pedir<DatosComprobaciones>({ tipo: "comprobaciones", de, armado });
      const c = await pedir<ClasesSolido>({ tipo: "comprobacion-solido", de, armado });
      expect(c.n).toBe(sol.objeto.length);
      const tipo = de === "pilares" ? "pilar" : de === "vigas" ? "viga" : "losa";
      const claseDe = (p: ParteComprobada) => 1 + CLASES.indexOf(claseAprovechamiento(p));
      let con = 0;
      for (let t = 0; t < sol.objeto.length; t++) {
        const o = sol.objetos[sol.objeto[t]!]!;
        const k = c.clase[t]!;
        if (o.tipo !== tipo) {
          expect(k, `${de} ${o.id}`).toBe(0);
          continue;
        }
        const partes = tabla.partes.filter((p) => p.pieza === o.id && (de !== "pilares" || p.planta === sol.plantas[sol.planta[t]!]));
        if (!partes.length) continue;
        expect(partes.map(claseDe), `${de} ${o.id}`).toContain(k);
        con++;
      }
      expect(con, de).toBeGreaterThan(0);
      // Un tramo de pilar, entero de la clase de su ficha
      if (de === "pilares")
        for (const p of tabla.partes) {
          const ks = new Set<number>();
          for (let t = 0; t < sol.objeto.length; t++) if (sol.objetos[sol.objeto[t]!]!.id === p.pieza && sol.plantas[sol.planta[t]!] === p.planta) ks.add(c.clase[t]!);
          if (ks.size) expect([...ks], p.clave).toEqual([claseDe(p)]);
        }
    }
  }, 600_000);
});
