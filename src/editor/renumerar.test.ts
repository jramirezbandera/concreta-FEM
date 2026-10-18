/**
 * «Renumerar» (I-g, `docs/fem3d/interfaz.md` §12.1): el orden de CYPECAD, las referencias, los ids
 * ocupados, la idempotencia y que el modelo analítico no cambia.
 */
import { describe, expect, it } from "vitest";
import { VERSION_ESQUEMA, type Proyecto } from "../agente/proyecto.ts";
import { compilar } from "../compilador/compilar.ts";
import type { ModeloFisico, Vec2 } from "../compilador/fisico.ts";
import { aplicar } from "./operaciones.ts";
import { referenciasRotas } from "./referencias.ts";
import { propuestaRenumerar } from "./renumerar.ts";
import { emparejarTodos } from "../pruebas/metamorficasFisicas.ts";
import { leerEjemplo } from "./serializar.test.ts";

function renumerado(p: Proyecto): Proyecto {
  const r = aplicar(p, { op: "renumerar" });
  if (!r.ok) throw new Error(r.errores.map((e) => e.mensaje).join(" | "));
  return r.proyecto;
}

/** Una retícula de 3 filas × 4 columnas con los pilares en un orden cualquiera y una carga sobre uno. */
function reticula(giro = 0): Proyecto {
  const g = (giro * Math.PI) / 180;
  const rot = (x: number, y: number): Vec2 => [x * Math.cos(g) - y * Math.sin(g), x * Math.sin(g) + y * Math.cos(g)];
  const pos: [string, number, number][] = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) pos.push([`P-x${i}-y${j}`, 5 * i + (j === 1 ? 0.02 : 0), 4 * j]);
  const pilares = [...pos].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([id, x, y]) => {
    const [px, py] = rot(x, y);
    return { id, x: px, y: py, desde: "Cim", hasta: "N1", seccion: "P30" };
  });
  const losa = { id: "losa-1", planta: "N1", contorno: [rot(-1, -1), rot(16, -1), rot(16, 9), rot(-1, 9)], espesor: 0.25, material: "HA-30", eje1: giro };
  const m: ModeloFisico = {
    plantas: [
      { id: "N1", altura: null },
      { id: "Cim", altura: 3 },
    ],
    materiales: [{ id: "HA-30", tipo: "hormigon", fck: 30 }],
    secciones: [{ id: "P30", material: "HA-30", forma: "rectangular", b: 0.3, h: 0.3 }],
    casos: [{ id: "G", pesoPropio: true }],
    pilares,
    vigas: [
      { id: "viga-b", planta: "N1", puntos: [rot(0, 0), rot(15, 0)], seccion: "P30" },
      { id: "viga-a", planta: "N1", puntos: [rot(0, 8), rot(15, 8)], seccion: "P30" },
    ],
    losas: [losa],
    cargas: [{ tipo: "pilar", id: "q1", caso: "G", pilar: "P-x3-y2", ejes: "global", q: [0, 0, -10] }],
  } as unknown as ModeloFisico;
  return { esquema: VERSION_ESQUEMA, modelo: m };
}

const posicion = (p: Proyecto, id: string) => {
  const x = p.modelo.pilares!.find((q) => q.id === id)!;
  return [Math.round(x.x * 1e6) / 1e6, Math.round(x.y * 1e6) / 1e6];
};

describe("renumerar", () => {
  it("pilares por filas de arriba abajo y de izquierda a derecha; las referencias siguen al pilar", () => {
    const p = reticula();
    const r = renumerado(p);
    const mapa = propuestaRenumerar(p.modelo);
    // Fila de arriba (y = 8): P1…P4 de x = 0 a 15; la de en medio (con 2 cm de ruido), P5…P8
    expect(mapa.get("P-x0-y2")).toBe("P1");
    expect(mapa.get("P-x3-y2")).toBe("P4");
    expect(mapa.get("P-x0-y1")).toBe("P5");
    expect(mapa.get("P-x3-y0")).toBe("P12");
    expect(posicion(r, "P4")).toEqual(posicion(p, "P-x3-y2"));
    // La carga sigue en el mismo pilar
    expect((r.modelo.cargas![0] as { pilar: string }).pilar).toBe("P4");
    // Vigas por el mismo orden; la losa, L1
    expect(r.modelo.vigas!.map((v) => v.id)).toEqual(["V2", "V1"]);
    expect(r.modelo.losas![0]!.id).toBe("L1");
    expect(referenciasRotas(r.modelo)).toEqual([]);
  });

  it("no depende del giro de la planta", () => {
    for (const giro of [17, 30, 60]) {
      const a = propuestaRenumerar(reticula().modelo);
      const b = propuestaRenumerar(reticula(giro).modelo);
      expect([...b]).toEqual([...a]);
    }
  });

  it("es idempotente y salta los ids que ya usa otro objeto", () => {
    const q = reticula();
    const p: Proyecto = { ...q, modelo: { ...q.modelo, casos: [...q.modelo.casos, { id: "P3" } as never] } };
    const r = renumerado(p);
    expect(propuestaRenumerar(r.modelo).size).toBe(0);
    const ids = r.modelo.pilares!.map((q) => q.id);
    expect(ids).not.toContain("P3");
    expect(ids).toContain("P13");
  });

  it("edificio objetivo: el mismo modelo analítico con los ids cortos", () => {
    const { proyecto } = leerEjemplo("edificio");
    const r = renumerado(proyecto);
    expect(referenciasRotas(r.modelo)).toEqual([]);
    expect(r.modelo.pilares!.every((q) => /^P\d+$/.test(q.id))).toBe(true);
    expect(r.modelo.vigas!.every((q) => /^V\d+$/.test(q.id))).toBe(true);
    const a = compilar(proyecto.modelo, proyecto.opciones);
    const b = compilar(r.modelo, r.opciones);
    expect(a.valido && b.valido).toBe(true);
    if (!a.valido || !b.valido) return;
    // La misma malla: las barras van en el orden de los ids de sus piezas, y los nudos se mueven ulps
    // (el redondeo del arreglo sigue el orden de creación de sus puntos, que va por ids; con las caras
    // de las vigas, miles de nudos a 1e-14), así que se emparejan por posición a 1e-9 (el mismo
    // criterio que el comparador de A2) y se comparan las barras y las láminas por sus nudos
    expect(b.modelo.nudos.length).toBe(a.modelo.nudos.length);
    const pares = emparejarTodos(a.modelo, b.modelo, (q) => q, 1e-9);
    expect(pares.size).toBe(a.modelo.nudos.filter((n) => !n.id.endsWith(":maestro")).length);
    const conjunto = (m: typeof a.modelo, mapa: (n: number) => number) => [
      (m.barras ?? []).map((x) => x.nudos.map(mapa).sort((p, q) => p - q).join("|")).sort(),
      (m.laminas ?? []).map((x) => x.nudos.map(mapa).join("|")).sort(),
    ];
    expect(conjunto(a.modelo, (n) => pares.get(n)!)).toEqual(conjunto(b.modelo, (n) => n));
  }, 180_000);
});
