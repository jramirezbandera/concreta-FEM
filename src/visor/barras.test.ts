/**
 * Fase BN2 (`docs/fem3d/barras.md` §5): las barras entre dos niveles en el dibujo.
 * - Sólido: la sección barrida de extremo a extremo, una superficie cerrada con el volumen A·L (la
 *   circular, con el polígono del área exacta), y en la planta de su extremo alto.
 * - Alámbrico: su eje.
 * - Planta: su proyección en las plantas de sus dos extremos, con la flecha hacia el extremo alto (una
 *   vertical, un círculo).
 * - Alzado: de un extremo al otro, en (u, z), si los dos están cerca del plano; si lo cruza, un círculo.
 */
import { describe, expect, it } from "vitest";
import { vistaAlzado } from "../agente/render/alzado.ts";
import type { Primitiva } from "../agente/render/escena.ts";
import { vistaModelo } from "../agente/render/modelo.ts";
import { puntosBarra } from "../compilador/barras.ts";
import type { ModeloFisico } from "../compilador/fisico.ts";
import { porticoAcero, porticoArriostrado } from "../pruebas/barras.ts";
import { alambrico } from "./alambrico.ts";
import { piezasSolido, volumen } from "./solido.ts";

const objeto = (ps: readonly Primitiva[], id: string) => ps.filter((p) => p.tipo !== "texto" && "objeto" in p && p.objeto === id);

describe("BN2: las barras en el sólido y en el alámbrico", () => {
  for (const [nombre, f] of [["arriostrado", porticoArriostrado()], ["acero", porticoAcero()]] as [string, ModeloFisico][]) {
    it(`${nombre}: cada barra, cerrada y con su volumen`, () => {
      const { piezas } = piezasSolido(f);
      for (const b of f.barras!) {
        const p = piezas.find((x) => x.id === b.id)!;
        expect(p.tipo).toBe("barra");
        const [A, B] = puntosBarra(f.plantas, b)!;
        const L = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
        const s = f.secciones.find((x) => x.id === b.seccion)!;
        const area = s.forma === "circular" ? (Math.PI * s.D ** 2) / 4 : s.forma === "general" ? 0.05 ** 2 : 0;
        expect(volumen(p.caras) / (area * L), b.id).toBeCloseTo(1, 11);
        // Cerrada: el volumen no depende del origen
        expect(Math.abs(volumen(p.caras, [7, -3, 11]) - volumen(p.caras)) / volumen(p.caras), b.id).toBeLessThan(1e-11);
        const plantas = f.plantas.map((x) => x.id);
        expect(p.planta).toBe(Math.min(plantas.indexOf(b.inicio.planta), plantas.indexOf(b.fin.planta)));
      }
    });
  }
  it("el alámbrico: su eje, de extremo a extremo", () => {
    const f = porticoArriostrado();
    const a = alambrico(f);
    for (const b of f.barras!) {
      const k = a.objetos.findIndex((o) => o.id === b.id);
      expect(a.objetos[k]!.tipo).toBe("barra");
      const i = [...a.objeto].indexOf(k);
      const seg = Array.from(a.segmentos.subarray(6 * i, 6 * i + 6)).map((v, j) => v + a.origen[j % 3]!);
      const [A, B] = puntosBarra(f.plantas, b)!;
      for (let j = 0; j < 3; j++) {
        expect(seg[j]).toBeCloseTo(A[j]!, 5);
        expect(seg[3 + j]).toBeCloseTo(B[j]!, 5);
      }
    }
  });
});

describe("BN2: las barras en la planta y en el alzado", () => {
  const f = porticoArriostrado();
  it("en planta, en las de sus dos extremos, con la flecha hacia el alto", () => {
    const p1 = vistaModelo(f, "P1", { huella: "x" }).primitivas;
    const pc = vistaModelo(f, "C", { huella: "x" }).primitivas;
    const p2 = vistaModelo(f, "P2", { huella: "x" }).primitivas;
    // X1: de C (0, 0) a P1 (5, 0): en C y en P1, no en P2; la flecha, hacia +X
    for (const ps of [pc, p1]) {
      const [l, fl] = [objeto(ps, "X1").find((p) => p.tipo === "linea"), objeto(ps, "X1").find((p) => p.tipo === "flecha")];
      expect(l?.tipo === "linea" && l.puntos).toEqual([[0, 0], [5, 0]]);
      expect(fl?.tipo === "flecha" && fl.d).toEqual([1, 0]);
    }
    expect(objeto(p2, "X1")).toEqual([]);
    // T1: de P1 (0, 4) a P2 (1,5; 4); en P2 también
    expect(objeto(p2, "T1").some((p) => p.tipo === "linea")).toBe(true);
    // Una vertical: un círculo
    const g: ModeloFisico = { ...f, barras: [{ id: "V", inicio: { planta: "P1", x: 2.5, y: 0 }, fin: { planta: "P2", x: 2.5, y: 0 }, seccion: "t" }] };
    expect(objeto(vistaModelo(g, "P1", { huella: "x" }).primitivas, "V").map((p) => p.tipo)).toEqual(["marca"]);
  });
  it("en el alzado, de extremo a extremo en (u, z); si cruza el plano, un círculo", () => {
    const e = vistaAlzado(f, { desde: [-1, 4], hasta: [6, 4] }, { huella: "x" });
    const t1 = objeto(e.primitivas, "T1");
    expect(t1.length).toBe(1);
    expect(t1[0]!.tipo === "linea" && t1[0]!.puntos).toEqual([[1, 3], [2.5, 6]]);
    // T2 va de (5, 4) en C a (3,5; 3) en P1: cruza el plano y = 3,5 a la mitad
    const c = vistaAlzado(f, { desde: [0, 3.5], hasta: [6, 3.5], profundidad: 0.1 }, { huella: "x" });
    const t2 = objeto(c.primitivas, "T2");
    expect(t2.length).toBe(1);
    expect(t2[0]!.tipo === "marca" && t2[0]!.p).toEqual([4.25, 1.5]);
    // En el analítico no se dibuja el modelo físico
    expect(objeto(vistaAlzado(f, { desde: [-1, 4], hasta: [6, 4] }, { huella: "x" }, { modo: "analitico" }).primitivas, "T1").filter((p) => p.tipo === "linea" && p.estilo === "barra-alzado")).toEqual([]);
  });
});
