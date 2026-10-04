/**
 * Fuerzas nodales de los elementos y de las restricciones (E5): la base del corte por fuerzas
 * nodales (H18, H25; S7 §2.6 del área 8).
 *
 * - Fuerza nodal de un elemento: g = k·u − f_eq, lo que sus nudos ejercen sobre él (6 por nudo, en
 *   ejes globales), con k su rigidez en globales, u los desplazamientos de sus nudos y f_eq las
 *   fuerzas nodales equivalentes de las cargas que lleva. Con sus cargas, g está en equilibrio: k
 *   no hace trabajo en un movimiento de sólido rígido y f_eq es estáticamente equivalente a la
 *   carga.
 * - En cada nudo, Σ g (de todos sus elementos) = P + R + C: carga nodal, reacción (de apoyos y
 *   muelles a tierra, que por eso no cuentan como elementos aquí) y fuerza de las restricciones
 *   sobre el nudo. Fuera de las restricciones, C es el residuo del solver.
 * - Fuerzas de cada restricción (un cuerpo rígido sin masa) sobre sus nudos: en un esclavo, la C
 *   del nudo (un GDL sólo puede ser esclavo de una restricción) menos lo que le llega de las
 *   restricciones de las que es maestro; en el maestro, lo que cierra el equilibrio del cuerpo. Se
 *   resuelven desde las hojas de las cadenas (huella → cabeza de pilar → diafragma) hacia arriba.
 *   Un diafragma sólo da fuerzas en sus GDL (ux, uy, rz).
 *
 * Todo es lineal en (u, cargas): las fuerzas de una combinación son la combinación de las de sus
 * casos.
 */
import { equivalentesEnNudos, cargasDeBarrasDelCaso, type BarraPreparada } from "./barras.ts";
import { Diagnosticos } from "./diagnosticos.ts";
import { elementosDelModelo, esMuelleATierra, geometria, rigidezGlobal, type ElementoMotor, type Geometria } from "./elementos.ts";
import { cargasDeLaminasDelCaso, rigidezLamina, type LaminaPreparada } from "./laminas.ts";
import type { ModeloAnalitico, ResultadoCaso } from "./modelo.ts";

/** Componentes de un nudo que fija cada tipo de restricción (sobre las demás no hace fuerza). */
const COMPONENTES_RESTRICCION = {
  diafragma: [true, true, false, false, false, true],
  "enlace-rigido": [true, true, true, true, true, true],
} as const;

/** Fuerzas de una restricción sobre sus nudos: 6 por nudo, en el orden [maestro, ...esclavos]. */
export type FuerzasRestriccion = Float64Array;

interface CargasCaso {
  /** Equivalentes por barra (12, globales en los nudos). */
  barras: Map<number, Float64Array>;
  /** Equivalentes por lámina (24, globales). */
  laminas: Map<number, Float64Array>;
  /** Cargas nodales (6 por nudo). */
  nodales: Float64Array;
}

export class FuerzasNodales {
  readonly modelo: ModeloAnalitico;
  readonly geo: Geometria;
  /** Elementos del motor (barras, láminas y muelles), en el orden de `elementosDelModelo`. */
  readonly elementos: readonly ElementoMotor[];
  private readonly porBarra: (ElementoMotor | undefined)[] = [];
  private readonly porLamina: (ElementoMotor | undefined)[] = [];
  private readonly cargas: (CargasCaso | undefined)[];
  private incidencia: { ptr: Uint32Array; idx: Uint32Array } | null = null;

  constructor(modelo: ModeloAnalitico) {
    this.modelo = modelo;
    this.geo = geometria(modelo);
    // Supone un modelo ya calculado y válido: un error aquí es un mal uso
    const diag = new Diagnosticos();
    this.elementos = elementosDelModelo(modelo, this.geo, diag);
    if (diag.hayErrores) throw new Error(`FuerzasNodales: el modelo tiene errores (${diag.lista[0]!.mensaje}); calcúlalo antes con calcular()`);
    for (const e of this.elementos) {
      if (e.tipo === "barra") this.porBarra[e.indice] = e;
      else if (e.tipo === "lamina") this.porLamina[e.indice] = e;
    }
    this.cargas = new Array(modelo.casos.length);
  }

  /** Barra preparada (ejes, tramo flexible, offsets). */
  barraPreparada(b: number): BarraPreparada {
    const e = this.porBarra[b];
    if (!e) throw new Error(`FuerzasNodales: no hay barra ${b}`);
    return e.barra!;
  }

  /** Lámina preparada (ejes, coordenadas locales, sección). */
  laminaPreparada(l: number): LaminaPreparada {
    const e = this.porLamina[l];
    if (!e) throw new Error(`FuerzasNodales: no hay lámina ${l}`);
    return e.lamina!;
  }

  /** Cargas del caso k por elemento (se preparan la primera vez que se piden). */
  private cargasCaso(k: number): CargasCaso {
    let c = this.cargas[k];
    if (c) return c;
    const caso = this.modelo.casos[k];
    if (!caso) throw new Error(`FuerzasNodales: no hay caso ${k}`);
    const diag = new Diagnosticos();
    const preparadasB: (BarraPreparada | undefined)[] = [];
    const preparadasL: (LaminaPreparada | undefined)[] = [];
    for (const e of this.elementos) {
      if (e.barra) preparadasB[e.indice] = e.barra;
      if (e.lamina) preparadasL[e.indice] = e.lamina;
    }
    const deBarras = cargasDeBarrasDelCaso(caso.id, caso.barras ?? [], preparadasB, this.modelo, this.geo, diag).porBarra;
    const laminas = new Map<number, Float64Array>();
    cargasDeLaminasDelCaso(caso.id, caso.laminas ?? [], preparadasL, this.modelo, this.geo, diag, laminas);
    if (diag.hayErrores) throw new Error(`FuerzasNodales: el caso ${caso.id} tiene cargas no válidas (${diag.lista[0]!.mensaje})`);
    const eqB = new Map<number, Float64Array>();
    for (const [ib, cb] of deBarras) eqB.set(ib, equivalentesEnNudos(preparadasB[ib]!, cb.ferC));
    const nodales = new Float64Array(6 * this.modelo.nudos.length);
    for (const cn of caso.nodales ?? []) for (let g = 0; g < 6; g++) nodales[6 * cn.nudo + g]! += cn.f[g]!;
    c = { barras: eqB, laminas, nodales };
    this.cargas[k] = c;
    return c;
  }

  /** Cargas nodales del caso k (6 por nudo, globales). */
  cargasNodales(k: number): Float64Array {
    return this.cargasCaso(k).nodales;
  }

  /**
   * g = k·u − f_eq de un elemento del motor con las cargas del caso k (6 por nudo); con k = null,
   * sólo k·u. `K`: su rigidez global, si ya se tiene.
   */
  deElemento(e: ElementoMotor, k: number | null, u: ArrayLike<number>, K?: Float64Array): Float64Array {
    const m = 6 * e.nudos.length;
    const Ke = K ?? rigidezGlobal(this.modelo, e);
    const g = new Float64Array(m);
    for (let a = 0; a < m; a++) {
      let s = 0;
      const fila = m * a;
      for (let b = 0; b < m; b++) s += Ke[fila + b]! * u[6 * e.nudos[(b / 6) | 0]! + (b % 6)]!;
      g[a] = s;
    }
    if (k === null) return g;
    const eq = e.tipo === "barra" ? this.cargasCaso(k).barras.get(e.indice) : e.tipo === "lamina" ? this.cargasCaso(k).laminas.get(e.indice) : undefined;
    if (eq) for (let a = 0; a < m; a++) g[a] -= eq[a]!;
    return g;
  }

  /** Fuerzas que los nudos i y j ejercen sobre la barra b en el caso k (12, globales). */
  barra(b: number, k: number, r: ResultadoCaso): Float64Array {
    const e = this.porBarra[b];
    if (!e) throw new Error(`FuerzasNodales: no hay barra ${b}`);
    return this.deElemento(e, k, r.u);
  }

  /** Fuerzas que los 4 nudos ejercen sobre la lámina l en el caso k (24, globales). */
  lamina(l: number, k: number, r: ResultadoCaso): Float64Array {
    const e = this.porLamina[l];
    if (!e) throw new Error(`FuerzasNodales: no hay lámina ${l}`);
    return this.deElemento(e, k, r.u, rigidezLamina(e.lamina!));
  }

  /** Elementos (índices en `elementos`) que tocan cada nudo, sin los muelles a tierra (CSR). */
  private incidencias(): { ptr: Uint32Array; idx: Uint32Array } {
    if (this.incidencia) return this.incidencia;
    const nn = this.modelo.nudos.length;
    const ptr = new Uint32Array(nn + 1);
    const validos = this.elementos.map((e) => !esMuelleATierra(e));
    this.elementos.forEach((e, ie) => {
      if (validos[ie]) for (const v of e.nudos) ptr[v + 1]!++;
    });
    for (let v = 0; v < nn; v++) ptr[v + 1]! += ptr[v]!;
    const idx = new Uint32Array(ptr[nn]!);
    const pos = ptr.slice(0, nn);
    this.elementos.forEach((e, ie) => {
      if (validos[ie]) for (const v of e.nudos) idx[pos[v]!++] = ie;
    });
    this.incidencia = { ptr, idx };
    return this.incidencia;
  }

  /**
   * Σ g de los elementos (sin los muelles a tierra) en cada nudo de `nudos`, en el caso k: 6 por
   * nudo de la lista. Cada elemento se evalúa una sola vez.
   */
  sumaEnNudos(nudos: readonly number[], k: number, r: ResultadoCaso): Float64Array {
    const { ptr, idx } = this.incidencias();
    const pos = new Map<number, number>();
    nudos.forEach((v, i) => pos.set(v, i));
    const usados = new Set<number>();
    for (const v of nudos) for (let p = ptr[v]!; p < ptr[v + 1]!; p++) usados.add(idx[p]!);
    const out = new Float64Array(6 * nudos.length);
    for (const ie of usados) {
      const e = this.elementos[ie]!;
      const g = this.deElemento(e, k, r.u, e.lamina ? rigidezLamina(e.lamina) : undefined);
      e.nudos.forEach((v, a) => {
        const i = pos.get(v);
        if (i === undefined) return;
        for (let c = 0; c < 6; c++) out[6 * i + c]! += g[6 * a + c]!;
      });
    }
    return out;
  }

  /**
   * Fuerzas de las restricciones `cuales` (índices en `modelo.restricciones`; todas si se omite)
   * sobre sus nudos en el caso k: 6 por nudo, en el orden [maestro, ...esclavos]. Calcula también
   * las de las restricciones de las que dependen (las que tienen por maestro a uno de sus esclavos).
   */
  restricciones(k: number, r: ResultadoCaso, cuales?: readonly number[]): Map<number, FuerzasRestriccion> {
    const lista = this.modelo.restricciones ?? [];
    // Restricciones de las que cada nudo es maestro
    const deMaestro = new Map<number, number[]>();
    lista.forEach((rs, ir) => {
      let l = deMaestro.get(rs.maestro);
      if (!l) deMaestro.set(rs.maestro, (l = []));
      l.push(ir);
    });
    // Cierre: las pedidas y todas las que cuelgan de sus esclavos
    const necesarias = new Set<number>();
    const pila = [...(cuales ?? lista.map((_, i) => i))];
    while (pila.length) {
      const ir = pila.pop()!;
      if (necesarias.has(ir)) continue;
      necesarias.add(ir);
      for (const s of lista[ir]!.esclavos) for (const j of deMaestro.get(s) ?? []) pila.push(j);
    }
    // C de los esclavos: Σ g − P − R
    const esclavos = [...new Set([...necesarias].flatMap((ir) => lista[ir]!.esclavos))];
    const suma = this.sumaEnNudos(esclavos, k, r);
    const P = this.cargasCaso(k).nodales;
    const R = r.reacciones;
    const C = new Map<number, Float64Array>();
    esclavos.forEach((v, i) => {
      const c = new Float64Array(6);
      for (let q = 0; q < 6; q++) c[q] = suma[6 * i + q]! - P[6 * v + q]! - R[6 * v + q]!;
      C.set(v, c);
    });
    // Resolución desde las hojas: una restricción espera a las que tienen por maestro a sus esclavos
    const { xyz } = this.geo;
    const hechas = new Map<number, FuerzasRestriccion>();
    const resolver = (ir: number): FuerzasRestriccion => {
      const h = hechas.get(ir);
      if (h) return h;
      const rs = lista[ir]!;
      const mascara = COMPONENTES_RESTRICCION[rs.tipo];
      const f = new Float64Array(6 * (1 + rs.esclavos.length));
      const m = rs.maestro;
      let Fx = 0, Fy = 0, Fz = 0, Mx = 0, My = 0, Mz = 0;
      rs.esclavos.forEach((s, i) => {
        const c = Float64Array.from(C.get(s)!);
        for (const j of deMaestro.get(s) ?? []) {
          const fj = resolver(j);
          for (let q = 0; q < 6; q++) c[q] -= fj[q]!; // lo que le llega como maestro de j
        }
        for (let q = 0; q < 6; q++) if (!mascara[q]) c[q] = 0;
        f.set(c, 6 * (i + 1));
        const dx = xyz[3 * s]! - xyz[3 * m]!;
        const dy = xyz[3 * s + 1]! - xyz[3 * m + 1]!;
        const dz = xyz[3 * s + 2]! - xyz[3 * m + 2]!;
        Fx += c[0]!;
        Fy += c[1]!;
        Fz += c[2]!;
        Mx += c[3]! + dy * c[2]! - dz * c[1]!;
        My += c[4]! + dz * c[0]! - dx * c[2]!;
        Mz += c[5]! + dx * c[1]! - dy * c[0]!;
      });
      // El cuerpo no tiene masa: lo que da al maestro cierra su equilibrio respecto a él
      f.set([-Fx, -Fy, -Fz, -Mx, -My, -Mz], 0);
      for (let q = 0; q < 6; q++) if (!mascara[q]) f[q] = 0;
      hechas.set(ir, f);
      return f;
    };
    for (const ir of necesarias) resolver(ir);
    return hechas;
  }
}
