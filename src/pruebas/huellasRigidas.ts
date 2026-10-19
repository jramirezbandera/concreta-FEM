/**
 * Fase HR (`docs/fem3d/huella-rigida.md`, F2-9): los nudos rígidos de cada huella de pilar que quedan
 * fuera de ella. Criterio 1 de la fase: ninguno, en ningún pilar y con ninguna opción, salvo los de
 * las caras de las vigas en su zona rígida en el pilar, que `unirCaras` une a la huella a propósito
 * (C1-a) y aquí se descuentan: un nudo a b/2 del eje de una viga de hormigón rectangular de la
 * planta, con su proyección dentro del tramo.
 */
import { compilar } from "../compilador/compilar.ts";
import type { ModeloFisico, OpcionesCompilacion } from "../compilador/fisico.ts";
import { distanciaAHuella, huellaPilar, type Huella } from "../compilador/geometria2d.ts";
import type { FormaHuella } from "../compilador/secciones.ts";

export interface RigidosFuera {
  pilar: string;
  planta: string;
  /** Índices de los nudos del modelo analítico, esclavos de la huella y fuera de ella (a más de `tol`). */
  nudos: number[];
  /** Los descontados: fuera de la huella, pero en la cara de una viga en su zona rígida (C1-a). */
  enCaras: number[];
}

type Compilado = Extract<ReturnType<typeof compilar>, { valido: true }>;

/** Forma de la huella de un pilar del modelo físico (rectangular o circular; las demás, null). */
export function formaHuella(f: ModeloFisico, idSeccion: string): FormaHuella | null {
  const s = f.secciones.find((x) => x.id === idSeccion) as { forma: string; b?: number; h?: number; D?: number } | undefined;
  if (!s) return null;
  if (s.forma === "rectangular") return { tipo: "rectangulo", b: s.b!, h: s.h! };
  if (s.forma === "circular") return { tipo: "circulo", D: s.D! };
  return null;
}

/**
 * La huella de un pilar en la losa de una planta: la del tramo de debajo (el de cabeza en esa
 * planta) si el pilar sigue hacia abajo, y si no, la del tramo de encima (`topologia.ts`; `tramos`
 * da la sección por la planta de la cabeza del tramo).
 */
export function huellaEnPlanta(f: ModeloFisico, p: NonNullable<ModeloFisico["pilares"]>[number], planta: string): Huella {
  const plantas = f.plantas.map((x) => x.id);
  const k = plantas.indexOf(planta);
  const kb = plantas.indexOf(p.desde);
  const kSeccion = kb < 0 || k < kb ? k : k - 1;
  const seccion = p.tramos?.find((t) => t.planta === plantas[kSeccion])?.seccion ?? p.seccion;
  return huellaPilar(p.x, p.y, p.giro ?? 0, formaHuella(f, seccion));
}

/**
 * Por huella (pilar y planta), sus esclavos fuera de ella. `tol` es la holgura del borde (10·ε_geom
 * por defecto, la del compilador).
 */
export function nudosRigidosFuera(f: ModeloFisico, c: Compilado, tol = 1e-5): RigidosFuera[] {
  const r: RigidosFuera[] = [];
  const porPilar = new Map((f.pilares ?? []).map((p) => [p.id, p]));
  const huellas = new Map<string, Huella | null>();
  const huellaEn = (p: NonNullable<ModeloFisico["pilares"]>[number], planta: string) => huellaEnPlanta(f, p, planta);
  /** Las caras de las vigas de hormigón rectangulares de cada planta: [A, B, b/2] por tramo. */
  const caras = new Map<string, [readonly [number, number], readonly [number, number], number][]>();
  for (const v of f.vigas ?? []) {
    const s = f.secciones.find((x) => x.id === v.seccion) as { forma: string; b?: number } | undefined;
    if (!s || s.forma !== "rectangular" || !s.b) continue;
    const lista = caras.get(v.planta) ?? [];
    for (let i = 0; i + 1 < v.puntos.length; i++) lista.push([v.puntos[i]!, v.puntos[i + 1]!, s.b / 2]);
    caras.set(v.planta, lista);
  }
  const enCara = (planta: string, q: readonly [number, number]) =>
    (caras.get(planta) ?? []).some(([A, B, b2]) => {
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const t = ((q[0] - A[0]) * (B[0] - A[0]) + (q[1] - A[1]) * (B[1] - A[1])) / (L * L);
      if (t < -1e-9 || t > 1 + 1e-9) return false;
      const d = Math.abs((q[0] - A[0]) * (B[1] - A[1]) - (q[1] - A[1]) * (B[0] - A[0])) / L;
      return Math.abs(d - b2) <= 1e-6;
    });
  (c.modelo.restricciones ?? []).forEach((x, i) => {
    const m = c.mapeo.restricciones[i]!;
    if (!x.id.endsWith(":huella") || !m.pilar) return;
    const p = porPilar.get(m.pilar);
    if (!p) return;
    const clave = `${p.id}@${m.planta}`;
    if (!huellas.has(clave)) huellas.set(clave, huellaEn(p, m.planta));
    const h = huellas.get(clave);
    if (!h?.forma) return;
    const fuera: number[] = [];
    const enCaras: number[] = [];
    for (const n of x.esclavos) {
      const q = [c.modelo.nudos[n]!.x, c.modelo.nudos[n]!.y] as const;
      if (distanciaAHuella(q, h) <= tol) continue;
      (enCara(m.planta, q) ? enCaras : fuera).push(n);
    }
    r.push({ pilar: p.id, planta: m.planta, nudos: fuera, enCaras });
  });
  return r;
}

/** Compila y cuenta: total de nudos rígidos fuera de las huellas (sin los de las caras), por si falla. */
export function contarRigidosFuera(f: ModeloFisico, op: OpcionesCompilacion = {}): { total: number; huellas: number; detalle: RigidosFuera[]; c: Compilado } {
  const c = compilar(f, op);
  if (!c.valido) throw new Error(c.diagnosticos.map((d) => `${d.codigo}: ${d.mensaje}`).join("\n"));
  const detalle = nudosRigidosFuera(f, c).filter((x) => x.nudos.length);
  return { total: detalle.reduce((a, x) => a + x.nudos.length, 0), huellas: detalle.length, detalle, c };
}
