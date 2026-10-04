/**
 * Modelos y huella de resultados de los bancos de E4, comunes a Chrome (`pagina.ts`) y a Node.
 *
 * El edificio objetivo es el del banco de E3 (`validacion/e3/banco.ts`): 7 plantas, 10×8 pilares,
 * luces de 6 m, barras de E2 y láminas de E3, con 24 casos (los 5 del generador repetidos con
 * factores). La huella es el SHA-256 de todos los `Float64Array` de los resultados, en orden: si
 * coincide entre Chrome y Node, los dos motores han dado los mismos bits.
 */
import type { CargaLamina, CasoCarga, ModeloAnalitico, ResultadoCalculo, Vec3 } from "../../src/motor/modelo.ts";
import { edificio } from "../../src/pruebas/edificio.ts";

export interface Variante {
  malla: number;
  diafragma: boolean;
  /** Casos de carga (24 en el banco; menos para los modelos pequeños del móvil). */
  casos?: number;
}

export const nombreVariante = (v: Variante) => `${v.diafragma ? "diafragma" : "semirrigido"}-${v.malla}-${v.casos ?? 24}c`;

export function edificioObjetivo(v: Variante): ModeloAnalitico {
  const { malla, diafragma } = v;
  const e = edificio({ vanosX: 9, vanosY: 7, luzX: 6, luzY: 6, plantas: 7, altura: 3, malla, huella: malla, vigas: true, muro: true, diafragma, barrasE2: true, laminasE3: true });
  const por = (q: Vec3 | undefined, f: number) => q && (q.map((x) => x * f) as unknown as Vec3);
  const escalarLamina = (c: CargaLamina, f: number): CargaLamina => {
    if (c.tipo === "superficie") return { ...c, q: Array.isArray(c.q[0]) ? ((c.q as readonly Vec3[]).map((q) => por(q, f)!) as never) : por(c.q as Vec3, f)! };
    if (c.tipo === "linea") return { ...c, qa: por(c.qa, f)!, qb: por(c.qb, f) };
    return { ...c, F: por(c.F, f), M: por(c.M, f) };
  };
  const base = e.modelo.casos;
  const casos: CasoCarga[] = [];
  for (let k = 0; casos.length < (v.casos ?? 24); k++) {
    const c = base[k % base.length]!;
    const f = 1 + 0.1 * Math.floor(k / base.length);
    casos.push({
      id: `${c.id}·${f.toFixed(1)}`,
      nodales: c.nodales?.map((n) => ({ ...n, f: n.f.map((x) => x * f) as never })),
      impuestos: c.impuestos?.map((d) => ({ ...d, valor: d.valor * f })),
      barras: c.barras?.map((cb) =>
        cb.tipo === "puntual" ? { ...cb, F: cb.F && (cb.F.map((x) => x * f) as never) } : { ...cb, qa: cb.qa.map((x) => x * f) as never, qb: cb.qb && (cb.qb.map((x) => x * f) as never) },
      ),
      laminas: c.laminas?.map((cl) => escalarLamina(cl, f)),
    });
  }
  return { ...e.modelo, casos };
}

/**
 * Huella de todos los `Float64Array` de los resultados, en orden: dos hashes de 32 bits (FNV-1a y
 * uno multiplicativo) sobre sus palabras de 32 bits. No es criptográfica, pero cualquier bit
 * distinto la cambia, y no necesita `crypto.subtle` (que en el móvil, por http de la red local, no
 * existe).
 */
export function huellaResultado(r: ResultadoCalculo): string {
  const casos = r.valido ? r.casos : (r.casosNoValidos ?? []);
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (const c of casos) {
    for (const v of [c.u, c.reacciones, c.esfuerzosBarras, c.esfuerzosLaminas]) {
      const w = new Uint32Array(v.buffer, v.byteOffset, v.length * 2);
      for (let i = 0; i < w.length; i++) {
        a = Math.imul(a ^ w[i]!, 0x01000193);
        b = Math.imul(b + w[i]!, 0x85ebca6b) ^ (b >>> 13);
      }
    }
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/** Peor equilibrio y peor error hacia atrás de los casos. */
export function calidad(r: ResultadoCalculo): { equilibrio: number; residuo: number } {
  const casos = r.valido ? r.casos : [];
  return {
    equilibrio: Math.max(0, ...casos.map((c) => Math.max(c.equilibrio.fuerzas, c.equilibrio.momentos))),
    residuo: Math.max(0, ...casos.map((c) => c.residuo)),
  };
}
