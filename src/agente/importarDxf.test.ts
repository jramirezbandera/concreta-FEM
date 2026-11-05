/**
 * `fem importar-dxf` (MA6, criterio 6 de `docs/fem3d/modelado.md`): ida y vuelta con los proyectos
 * de ejemplo (sus pilares, losas y ejes a un DXF con un exportador de prueba, e importarlo da los
 * mismos), y un DXF sintético con lo que tenía el de la vivienda: contornos en `LINE` sueltas y
 * dobles por los petos, pilares con su aspa, `$INSUNITS` que no casa y cotas.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ModeloFisico, Vec2 } from "../compilador/fisico.ts";
import { compilar } from "../compilador/compilar.ts";
import { aplanarDxf } from "../dxf/aplanar.ts";
import { leerDxf } from "../dxf/lector.ts";
import { leerProyecto, type Proyecto } from "./proyecto.ts";
import { serializar } from "../editor/serializar.ts";
import { importarDxf, type OpcionesImportar } from "./importarDxf.ts";

// ─── Un exportador de DXF, sólo para las pruebas ────────────────────────────────────────────────

class Escritor {
  private l: string[] = [];
  private escala: number;
  constructor(escala = 1) {
    this.escala = escala;
  }
  private par(c: number, v: string | number) {
    this.l.push(String(c), typeof v === "number" ? String(v * 1) : v);
  }
  private n = (x: number) => x * this.escala;
  linea(capa: string, a: Vec2, b: Vec2) {
    this.par(0, "LINE");
    this.par(8, capa);
    this.par(10, this.n(a[0]));
    this.par(20, this.n(a[1]));
    this.par(11, this.n(b[0]));
    this.par(21, this.n(b[1]));
  }
  polilinea(capa: string, ps: readonly Vec2[], cerrada = true) {
    this.par(0, "LWPOLYLINE");
    this.par(8, capa);
    this.par(90, ps.length);
    this.par(70, cerrada ? 1 : 0);
    for (const p of ps) {
      this.par(10, this.n(p[0]));
      this.par(20, this.n(p[1]));
    }
  }
  circulo(capa: string, c: Vec2, r: number) {
    this.par(0, "CIRCLE");
    this.par(8, capa);
    this.par(10, this.n(c[0]));
    this.par(20, this.n(c[1]));
    this.par(40, this.n(r));
  }
  texto(capa: string, p: Vec2, t: string) {
    this.par(0, "TEXT");
    this.par(8, capa);
    this.par(10, this.n(p[0]));
    this.par(20, this.n(p[1]));
    this.par(40, this.n(0.25));
    this.par(1, t);
  }
  cota(capa: string, a: Vec2, b: Vec2) {
    this.par(0, "DIMENSION");
    this.par(8, capa);
    this.par(2, "*D_NO_HAY");
    this.par(70, 1);
    this.par(13, this.n(a[0]));
    this.par(23, this.n(a[1]));
    this.par(14, this.n(b[0]));
    this.par(24, this.n(b[1]));
    this.par(42, this.n(Math.hypot(b[0] - a[0], b[1] - a[1])));
  }
  bytes(insunits?: number): Uint8Array {
    const cab = insunits === undefined ? [] : ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", String(insunits), "0", "ENDSEC"];
    return new TextEncoder().encode([...cab, "0", "SECTION", "2", "ENTITIES", ...this.l, "0", "ENDSEC", "0", "EOF"].join("\n"));
  }
}

/** Las esquinas de un pilar rectangular. */
function esquinas(m: ModeloFisico, id: string): Vec2[] {
  const p = m.pilares!.find((x) => x.id === id)!;
  const s = m.secciones.find((x) => x.id === p.seccion)!;
  if (s.forma !== "rectangular") throw new Error("no rectangular");
  const g = ((p.giro ?? 0) * Math.PI) / 180;
  const [c, sn] = [Math.cos(g), Math.sin(g)];
  return [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([i, j]): Vec2 => [p.x + (i! * s.h * c) / 2 - (j! * s.b * sn) / 2, p.y + (i! * s.h * sn) / 2 + (j! * s.b * c) / 2]);
}

/** Exporta pilares, losas y ejes de un modelo; con `lineas`, los contornos en LINE sueltas. */
function exportar(m: ModeloFisico, o: { escala?: number; lineas?: boolean; aspa?: boolean | "cruz"; peto?: number; planta?: string } = {}): Escritor {
  const w = new Escritor(o.escala ?? 1);
  for (const p of m.pilares ?? []) {
    const s = m.secciones.find((x) => x.id === p.seccion)!;
    if (s.forma === "circular") w.circulo("PILARES", [p.x, p.y], s.D / 2);
    else {
      const e = esquinas(m, p.id);
      w.polilinea("PILARES", e);
      const medio = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (o.aspa === "cruz") {
        w.linea("PILARES", medio(e[0]!, e[1]!), medio(e[2]!, e[3]!));
        w.linea("PILARES", medio(e[1]!, e[2]!), medio(e[3]!, e[0]!));
      } else if (o.aspa) {
        w.linea("PILARES", e[0]!, e[2]!);
        w.linea("PILARES", e[1]!, e[3]!);
      }
    }
  }
  for (const l of (m.losas ?? []).filter((x) => !o.planta || x.planta === o.planta)) {
    for (const anillo of [l.contorno, ...(l.huecos ?? [])]) {
      if (o.lineas) anillo.forEach((p, i) => w.linea("FORJADO", p, anillo[(i + 1) % anillo.length]!));
      else w.polilinea("FORJADO", anillo);
    }
    if (o.peto) {
      // La cara de dentro del peto: el contorno metido hacia dentro (sólo rectángulos ortogonales)
      const xs = l.contorno.map((p) => p[0]);
      const ys = l.contorno.map((p) => p[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs) + o.peto, Math.max(...xs) - o.peto, Math.min(...ys) + o.peto, Math.max(...ys) - o.peto];
      const r: Vec2[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      r.forEach((p, i) => w.linea("FORJADO", p, r[(i + 1) % 4]!));
    }
  }
  for (const e of m.ejes ?? []) {
    w.linea("EJES", e.desde, e.hasta);
    const [dx, dy] = [e.hasta[0] - e.desde[0], e.hasta[1] - e.desde[1]];
    const l = Math.hypot(dx, dy);
    const c: Vec2 = [e.desde[0] - (0.4 * dx) / l, e.desde[1] - (0.4 * dy) / l];
    w.circulo("EJES", c, 0.4);
    w.texto("EJES", c, e.nombre ?? e.id);
  }
  return w;
}

function importar(bytes: Uint8Array, o: OpcionesImportar) {
  const dxf = leerDxf(bytes);
  return importarDxf(dxf, aplanarDxf(dxf), o);
}

const ejemplo = (n: string) => (leerProyecto(readFileSync(new URL(`../../ejemplos/${n}/proyecto.json`, import.meta.url), "utf8")) as { proyecto: Proyecto }).proyecto;

/** Un anillo como conjunto de vértices (sin el orden ni el sentido), al mm. */
const vertices = (a: readonly Vec2[]) => a.map((p) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`).sort();

function mismosPilares(a: ModeloFisico, b: ModeloFisico) {
  expect(b.pilares?.length).toBe(a.pilares?.length);
  for (const p of a.pilares!) {
    const q = b.pilares!.find((x) => Math.hypot(x.x - p.x, x.y - p.y) <= 0.01);
    expect(q, `pilar ${p.id}`).toBeDefined();
    const [s, t] = [a.secciones.find((x) => x.id === p.seccion)!, b.secciones.find((x) => x.id === q!.seccion)!];
    if (s.forma === "rectangular" && t.forma === "rectangular") {
      // El canto h, según el lado largo
      expect([t.b, t.h]).toEqual([Math.min(s.b, s.h), Math.max(s.b, s.h)]);
    } else expect(t).toMatchObject({ forma: s.forma });
  }
}

describe("fem importar-dxf (MA6)", () => {
  for (const planta of ["PB", "PL1"])
  it(`ida y vuelta con el muestrario (${planta}): pilares, losas con su hueco y ejes`, () => {
    const p = ejemplo("muestrario");
    const m = p.modelo;
    // Un DXF por planta: las losas de dos plantas, superpuestas, se partirían unas a otras
    const r = importar(exportar(m, { planta }).bytes(6), { capasPilares: ["PILARES"], capasLosas: ["FORJADO"], capasEjes: ["EJES"], espesor: 0.3, material: "HA-30", plantas: [{ id: "CIM", cota: 0 }, { id: planta, cota: 3 }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    mismosPilares(m, r.proyecto.modelo);
    const losas = m.losas!.filter((l) => l.planta === planta);
    expect(r.proyecto.modelo.losas!.map((l) => vertices(l.contorno))).toEqual(losas.map((l) => vertices(l.contorno)));
    expect(r.proyecto.modelo.losas!.map((l) => (l.huecos ?? []).map(vertices))).toEqual(losas.map((l) => (l.huecos ?? []).map(vertices)));
    expect(r.proyecto.modelo.ejes!.map((e) => e.id).sort()).toEqual(m.ejes!.map((e) => e.nombre ?? e.id).sort());
    for (const e of m.ejes!) {
      const f = r.proyecto.modelo.ejes!.find((x) => x.id === (e.nombre ?? e.id))!;
      expect(vertices([f.desde, f.hasta])).toEqual(vertices([e.desde, e.hasta]));
    }
    expect(r.informe.supuestos).toEqual([]);
    expect(r.informe.noReconocidos).toEqual([]);
    // Es un proyecto que compila
    expect(leerProyecto(serializar(r.proyecto)).valido).toBe(true);
    expect(compilar(r.proyecto.modelo, r.proyecto.opciones).valido).toBe(true);
  });

  it("ida y vuelta con la vivienda: dos cubiertas que se tocan, en LINE sueltas", () => {
    const m = ejemplo("vivienda").modelo;
    const r = importar(exportar(m, { lineas: true, aspa: "cruz" }).bytes(), { capasPilares: ["PILARES"], capasLosas: ["FORJADO"], plantas: [{ id: "PB", cota: 0 }, { id: "CUB", cota: 3.4 }, { id: "CUB-S", cota: 4.3 }], espesor: 0.3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    mismosPilares(m, r.proyecto.modelo);
    expect(new Set(r.proyecto.modelo.losas!.map((l) => vertices(l.contorno).join(";")))).toEqual(new Set(m.losas!.map((l) => vertices(l.contorno).join(";"))));
    expect(r.proyecto.modelo.plantas.map((x) => [x.id, x.altura])).toEqual([["CUB-S", null], ["CUB", 0.9], ["PB", 3.4]]);
  });

  it("como el DXF de la vivienda: $INSUNITS en mm con el dibujo en m, contorno doble por el peto, pilares con aspa y cotas", () => {
    const m: ModeloFisico = {
      plantas: [{ id: "N1", altura: null }, { id: "Cim", altura: 3 }],
      materiales: [{ id: "HA-25", tipo: "hormigon", fck: 25 }],
      secciones: [{ id: "P30x30", material: "HA-25", forma: "rectangular", b: 0.3, h: 0.3 }, { id: "P30x50", material: "HA-25", forma: "rectangular", b: 0.3, h: 0.5 }, { id: "C40", material: "HA-25", forma: "circular", D: 0.4 }],
      pilares: [
        { id: "A", x: 0.15, y: 0.15, desde: "Cim", hasta: "N1", seccion: "P30x30" },
        { id: "B", x: 6, y: 0.15, desde: "Cim", hasta: "N1", seccion: "P30x50", giro: 90 },
        { id: "C", x: 11.85, y: 0.15, desde: "Cim", hasta: "N1", seccion: "P30x30" },
        { id: "D", x: 6, y: 5, desde: "Cim", hasta: "N1", seccion: "C40" },
        { id: "E", x: 0.15, y: 9.85, desde: "Cim", hasta: "N1", seccion: "P30x30" },
        { id: "F", x: 11.85, y: 9.85, desde: "Cim", hasta: "N1", seccion: "P30x30" },
      ],
      losas: [{ id: "L", planta: "N1", contorno: [[0, 0], [12, 0], [12, 10], [0, 10]], huecos: [[[2, 6], [4, 6], [4, 8], [2, 8]]], espesor: 0.3, material: "HA-25" }],
      casos: [],
    };
    const w = exportar(m, { lineas: true, aspa: true, peto: 0.15 });
    // Una línea del peto partida en dos y solapada; una vigueta suelta (no cierra nada); un rectángulo grande en la capa de pilares
    w.linea("FORJADO", [0, 5], [-1, 5]);
    w.polilinea("PILARES", [[20, 0], [24, 0], [24, 3], [20, 3]]);
    w.polilinea("PILARES", [[20, 5], [20.4, 5], [20.2, 5.3]]);
    // Un trozo de muro sin cruz (los pilares de este dibujo la llevan): no es un pilar
    w.polilinea("PILARES", [[30, 0], [30.15, 0], [30.15, 0.3], [30, 0.3]]);
    w.cota("COTAS", [0, 0], [12, 0]);
    w.cota("COTAS", [0.15, 0.15], [6, 0.15]);
    w.cota("COTAS", [3, 3], [5, 3]);
    const r = importar(w.bytes(4), {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.informe.unidades).toBe("m");
    expect(r.informe.avisos.some((x) => x.includes("$INSUNITS"))).toBe(true);
    expect(r.informe.propuesta).toEqual({ pilares: "PILARES", losas: "FORJADO" });
    mismosPilares(m, r.proyecto.modelo);
    const b = r.proyecto.modelo.pilares!.find((x) => x.x === 6 && x.y === 0.15)!;
    expect(b).toMatchObject({ seccion: "P30x50", giro: 90 });
    // La losa, hasta la línea de fuera del peto, con su hueco
    expect(r.proyecto.modelo.losas!.map((l) => vertices(l.contorno))).toEqual([vertices(m.losas![0]!.contorno)]);
    expect(r.proyecto.modelo.losas![0]!.huecos!.map(vertices)).toEqual([vertices(m.losas![0]!.huecos![0]!)]);
    expect(r.informe.noReconocidos.map((x) => x.motivo.split(" ").slice(0, 3).join(" "))).toEqual(["rectángulo sin cruz", "polígono de 3"]);
    expect(r.informe.cotas).toMatchObject({ total: 3, cuadran: 2 });
    expect(r.informe.cotas.noCuadran.map((x) => x.valor)).toEqual([2]);
    // Lo que se puso sin dato, para preguntarlo
    expect(r.informe.supuestos.length).toBeGreaterThanOrEqual(4);
    // Los pilares, renumerados de arriba abajo y de izquierda a derecha
    expect(r.proyecto.modelo.pilares!.map((x) => x.id)).toEqual(["P1", "P2", "P3", "P4", "P5", "P6"]);
    expect(r.proyecto.modelo.pilares![0]).toMatchObject({ x: 0.15, y: 9.85 });
  });

  it("las mismas piezas con el dibujo en mm", () => {
    const m = ejemplo("muestrario").modelo;
    const r0 = importar(exportar(m, { planta: "PB" }).bytes(), { capasPilares: ["PILARES"], capasLosas: ["FORJADO"] });
    const r1 = importar(exportar(m, { planta: "PB", escala: 1000 }).bytes(4), { capasPilares: ["PILARES"], capasLosas: ["FORJADO"] });
    expect(r0.ok && r1.ok).toBe(true);
    if (!r0.ok || !r1.ok) return;
    expect(r1.informe.unidades).toBe("mm");
    expect(r1.proyecto.modelo.pilares).toEqual(r0.proyecto.modelo.pilares);
    expect(r1.proyecto.modelo.losas).toEqual(r0.proyecto.modelo.losas);
  });

  it("dice lo que falta y no inventa capas que no existen", () => {
    const r = importar(new Escritor().bytes(), { capasPilares: ["NO"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores[0]).toContain("«NO»");
  });
});
