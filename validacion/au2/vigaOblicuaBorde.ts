/**
 * A2-39 (`docs/fem3d/auditoria-2.md` §3.3): una viga a pocos grados del borde de la losa. Losa de 6 × 6
 * sobre cuatro pilares de 30 × 30 con vigas de 30 × 50 por sus cuatro lados; la de abajo, girada un
 * ángulo α (su pilar derecho sube 6·tan α). Por α: los nudos de las láminas que caen en una cara del
 * ancho de una viga (a ≤ 1e-6) y no son de ningún enlace ni de una barra, con dónde están, y los avisos.
 * Uso: bun validacion/au2/vigaOblicuaBorde.ts > validacion/au2/out_vigaOblicuaBorde.txt
 */
import { compilar } from "../../src/compilador/compilar.ts";
import type { ModeloFisico, Vec2 } from "../../src/compilador/fisico.ts";

function modelo(alfa: number, borde: boolean): ModeloFisico {
  const t = Math.tan((alfa * Math.PI) / 180);
  // «viga»: la viga de abajo girada (su pilar derecho sube 6·tan α); «borde»: la viga recta y el borde
  // de abajo de la losa girado α, desde la cara de fuera de la viga en x = −0,15 (cruza su ancho)
  const d = borde ? 0 : 6 * t;
  const yb = borde ? -0.15 + 6.3 * t : -0.15;
  return {
    plantas: [
      { id: "N1", altura: null },
      { id: "C", altura: 3 },
    ],
    materiales: [{ id: "HA", tipo: "hormigon", fck: 25 }],
    secciones: [
      { id: "P30", material: "HA", forma: "rectangular", b: 0.3, h: 0.3 },
      { id: "V", material: "HA", forma: "rectangular", b: 0.3, h: 0.5 },
    ],
    pilares: [
      { id: "P1", x: 0, y: 0, desde: "C", hasta: "N1", seccion: "P30" },
      { id: "P2", x: 6, y: d, desde: "C", hasta: "N1", seccion: "P30" },
      { id: "P3", x: 0, y: 6, desde: "C", hasta: "N1", seccion: "P30" },
      { id: "P4", x: 6, y: 6, desde: "C", hasta: "N1", seccion: "P30" },
    ],
    vigas: [
      { id: "V1", planta: "N1", puntos: [[0, 0], [6, d]], seccion: "V" },
      { id: "V2", planta: "N1", puntos: [[6, d], [6, 6]], seccion: "V" },
      { id: "V3", planta: "N1", puntos: [[6, 6], [0, 6]], seccion: "V" },
      { id: "V4", planta: "N1", puntos: [[0, 6], [0, 0]], seccion: "V" },
    ],
    losas: [{ id: "L1", planta: "N1", contorno: [[-0.15, -0.15], [6.15, yb], [6.15, 6.15], [-0.15, 6.15]], espesor: 0.2, material: "HA" }],
    casos: [{ id: "G", pesoPropio: true, accion: { tipo: "G" } }],
  };
}

const distSeg = (p: Vec2, a: Vec2, b: Vec2) => {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
for (const borde of [false, true]) for (const alfa of [0, 0.5, 1, 2, 3, 5, 10]) {
  const f = modelo(alfa, borde);
  const c = compilar(f);
  if (!c.valido) {
    console.log(`${borde ? "borde" : "viga"} α = ${alfa}°: no compila (${c.diagnosticos.filter((x) => x.severidad === "error").map((x) => x.codigo).join(", ")})`);
    continue;
  }
  const atados = new Set<number>();
  for (const r of c.modelo.restricciones ?? []) if (r.tipo === "enlace-rigido") for (const v of [r.maestro, ...r.esclavos]) atados.add(v);
  for (const b of c.modelo.barras ?? []) for (const v of b.nudos) atados.add(v);
  const deLaminas = new Set((c.modelo.laminas ?? []).flatMap((l) => l.nudos));
  const sueltos: string[] = [];
  for (const n of deLaminas) {
    if (atados.has(n)) continue;
    const nd = c.modelo.nudos[n]!;
    const p: Vec2 = [nd.x, nd.y];
    for (const a of c.mapeo.anchos ?? []) {
      if (a.tira) continue;
      const P = a.poligono;
      const enCara = P.some((q, i) => distSeg(p, q, P[(i + 1) % P.length]!) <= 1e-6);
      if (enCara) {
        sueltos.push(`${a.viga} (${nd.x.toFixed(3)}, ${nd.y.toFixed(3)})`);
        break;
      }
    }
  }
  const avisos = [...new Set(c.diagnosticos.filter((x) => x.severidad !== "info").map((x) => x.codigo))].join(", ");
  console.log(`${borde ? "borde" : "viga"} α = ${alfa}°: ${sueltos.length} nudos en una cara sin enlace${sueltos.length ? ": " + sueltos.slice(0, 12).join("; ") : ""}${avisos ? `; avisos: ${avisos}` : ""}`);
}
