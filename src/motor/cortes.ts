/**
 * Cortes (E5): esfuerzos que atraviesan un plano, reducidos a un punto, con el convenio de las
 * barras: [N, Vy, Vz, T, My, Mz] en la cara de normal +x del corte (cabecera de modelo.ts). Una
 * franja de losa cortada con z = la normal de la losa se lee como una viga (My > 0, momento de
 * vano; Vz, el cortante); un machón de muro cortado en horizontal con x hacia arriba, como un pilar.
 *
 * Definición (`Corte`): plano por `origen` con normal `x`; eje z = `vz` proyectado sobre el plano;
 * y = z × x. El corte es la parte del plano dentro del rectángulo y ∈ [y0, y1], z ∈ [z0, z1]
 * (coordenadas respecto al origen). El rectángulo puede ser un segmento: una franja de losa
 * (z0 = z1 = 0) o un machón de muro (y0 = y1 = 0). Los esfuerzos son los que el lado +x (B) ejerce
 * sobre el lado −x (A) a través del corte; los nudos del corte (a menos de TOL_CORTE del plano)
 * quedan del lado B, así que una carga nodal sobre ellos no entra.
 *
 * Qué entra:
 * - Láminas que tocan el plano desde el lado A, con el centroide dentro del rectángulo: la suma de
 *   sus fuerzas nodales g = k·u − f_eq en los nudos del corte. Es exacto: un corte que separa el
 *   modelo en dos cierra el equilibrio con las cargas y reacciones de un lado.
 * - Láminas que atraviesan el plano:
 *   · "fuerzas-nodales" (por defecto): no puede haberlas (error): el corte tiene que seguir la malla
 *     (el compilador siembra las líneas de corte, H29).
 *   · "campos": la integral de los campos recuperados (SPR, campos.ts) a lo largo de su intersección
 *     con el plano, recortada al rectángulo; si el tramo acaba en un borde libre, con la fuerza de
 *     borde de Kirchhoff. Vale en cualquier posición; no es exacto. Donde el corte sigue la malla
 *     sigue usando fuerzas nodales, así que un corte alineado da lo mismo por los dos métodos.
 * - Barras: si atraviesan el plano, su esfuerzo exacto en el punto de cruce (diagrama de E2, o la
 *   fuerza de su nudo del lado A si el cruce cae en un offset rígido); si sólo lo tocan en un nudo
 *   desde el lado A, su fuerza nodal en ese nudo.
 * - Restricciones (cuerpos rígidos) con nudos a los dos lados: lo que transmiten a través del
 *   plano, Σ de sus fuerzas sobre sus nudos del lado A (fuerzasNodales.ts). Si parte de esos nudos
 *   cae fuera del rectángulo (un diafragma cortado por una franja), su parte no se puede atribuir
 *   al corte: las componentes que transmite (todas en un enlace rígido; las de su plano en un
 *   diafragma) quedan en NaN con un aviso.
 *
 * Todo es lineal en (u, cargas): los esfuerzos de una combinación son la combinación de los de sus
 * casos.
 */
import { DiagramasBarras } from "./barras.ts";
import { Diagnosticos, listaIds, type Diagnostico } from "./diagnosticos.ts";
import { FuerzasNodales } from "./fuerzasNodales.ts";
import type { ModeloAnalitico, ResultadoCaso, Vec3 } from "./modelo.ts";

/** Distancia al plano por debajo de la cual un nudo está en el corte (m): la tolerancia numérica de H28. */
export const TOL_CORTE = 1e-6;

export type MetodoCorte = "fuerzas-nodales" | "campos";

export interface Corte {
  /** Para los diagnósticos. */
  id?: string;
  /** Punto de reducción de los momentos y origen de las coordenadas y, z del rectángulo (global). */
  origen: Vec3;
  /** Normal del plano (eje x del corte): los esfuerzos son los del lado +x sobre el −x. */
  x: Vec3;
  /** Dirección de referencia del eje z del corte, que se proyecta sobre el plano (como el vz de las barras). */
  vz: Vec3;
  /** Extensión del corte según y (m, respecto al origen). Por defecto, [0, 0]. */
  y?: readonly [number, number];
  /** Extensión del corte según z (m, respecto al origen). Por defecto, [0, 0]. */
  z?: readonly [number, number];
  metodo?: MetodoCorte;
}

/**
 * Puntos de integración del método «campos» a lo largo del corte (los de Gauss de cada tramo de
 * lámina), con los campos recuperados en unos ejes de franja: x = la normal al corte en el plano de
 * la lámina (hacia +x del corte), z = la normal de la lámina orientada hacia el z del corte (si es
 * perpendicular, hacia su y), y = z × x. En una franja de losa son los ejes de la franja: Mx es el
 * momento que la flecta, y Σ peso·Mx es su My. Sirven para aplicar Wood–Armer punto a punto antes
 * de integrar (H25, H34).
 */
export interface MuestrasCorte {
  /** Lámina de cada punto. */
  laminas: Int32Array;
  /** Puntos (globales): 3 por punto. */
  puntos: Float64Array;
  /** Coordenadas y, z en el corte: 2 por punto. */
  yz: Float64Array;
  /** Peso de integración (m): Σ peso·valor = ∫ valor a lo largo del corte. */
  pesos: Float64Array;
  /** Ejes de franja de cada punto por filas (x, y, z): 9 por punto. */
  ejes: Float64Array;
  /** Por caso: [Nx, Ny, Nxy, Mx, My, Mxy, Qx, Qy] en los ejes de franja, 8 por punto. */
  valores: Float64Array[];
}

/** Contribución de las láminas por el método de campos (la da campos.ts). */
export interface IntegradorCampos {
  /**
   * Fuerza y momento (respecto al origen del corte, globales) que el lado B ejerce sobre las láminas
   * del lado A, por caso (6 por caso), y los puntos de integración. Añade a `info` las láminas que
   * integra y la extensión, y a `diag` sus avisos.
   */
  integrar(corte: CortePreparado, casos: readonly ResultadoCaso[], info: InfoCorte, diag: Diagnosticos): { suma: Float64Array; muestras: MuestrasCorte };
}

/** Corte con sus ejes y el lado de cada nudo, preparado para integrar. */
export interface CortePreparado {
  corte: Corte;
  origen: Float64Array;
  /** Ejes por filas: x, y, z. */
  ejes: Float64Array;
  y: readonly [number, number];
  z: readonly [number, number];
  /** Lado de cada nudo: −1 (A), 0 (en el plano), +1 (B). */
  lado: Int8Array;
  /** ¿Cae la proyección del punto dentro del rectángulo (con TOL_CORTE)? */
  dentro(p: ArrayLike<number>): boolean;
  /** Coordenadas (x, y, z) del punto en los ejes del corte, respecto al origen. */
  coordenadas(p: ArrayLike<number>): [number, number, number];
}

export interface InfoCorte {
  laminas: number[];
  barras: number[];
  restricciones: number[];
  /** Extensión real del corte según y y z: la de lo que lo atraviesa (null si no lo atraviesa nada). */
  extension: { y: [number, number]; z: [number, number] } | null;
}

export interface ResultadoCorte extends InfoCorte {
  /**
   * [N, Vy, Vz, T, My, Mz] por caso (6·nc), en los ejes del corte y respecto a su origen. NaN en
   * las componentes que el corte no puede dar (ver los diagnósticos).
   */
  esfuerzos: Float64Array;
  /** Ejes del corte por filas: x, y, z. */
  ejes: Float64Array;
  diagnosticos: Diagnostico[];
  /** Sin diagnósticos de error. Un corte no válido no trae esfuerzos (todo NaN). */
  valido: boolean;
  /** Sólo con el método «campos»: los puntos de integración de las láminas. */
  muestras?: MuestrasCorte;
}

const norma = (v: ArrayLike<number>) => Math.hypot(v[0]!, v[1]!, v[2]!);
const vec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === "number" && Number.isFinite(c));
const rango = (r: unknown): r is readonly [number, number] => Array.isArray(r) && r.length === 2 && r.every(Number.isFinite) && r[0] <= r[1];
const COMPONENTES = ["N", "Vy", "Vz", "T", "My", "Mz"] as const;

/** Acumulador de fuerza y momento (respecto a O) por caso. */
class Suma {
  readonly v: Float64Array;
  private readonly O: Float64Array;
  constructor(nc: number, O: Float64Array) {
    this.v = new Float64Array(6 * nc);
    this.O = O;
  }
  /** Fuerza F y momento m aplicados en X, con signo s. */
  agregar(k: number, X: ArrayLike<number>, F: ArrayLike<number>, m: ArrayLike<number>, s = 1): void {
    const o = 6 * k;
    const x = X[0]! - this.O[0]!;
    const y = X[1]! - this.O[1]!;
    const z = X[2]! - this.O[2]!;
    const fx = s * F[0]!;
    const fy = s * F[1]!;
    const fz = s * F[2]!;
    this.v[o]! += fx;
    this.v[o + 1]! += fy;
    this.v[o + 2]! += fz;
    this.v[o + 3]! += s * m[0]! + y * fz - z * fy;
    this.v[o + 4]! += s * m[1]! + z * fx - x * fz;
    this.v[o + 5]! += s * m[2]! + x * fy - y * fx;
  }
}

export class Cortes {
  readonly modelo: ModeloAnalitico;
  readonly fuerzas: FuerzasNodales;
  private diagramas: DiagramasBarras | null = null;

  constructor(modelo: ModeloAnalitico) {
    this.modelo = modelo;
    this.fuerzas = new FuerzasNodales(modelo);
  }

  /** Comprueba la definición y prepara los ejes y el lado de cada nudo; null si no es válida. */
  preparar(corte: Corte, diag: Diagnosticos): CortePreparado | null {
    const id = corte.id ?? "(sin id)";
    const y = corte.y ?? [0, 0];
    const z = corte.z ?? [0, 0];
    if (!vec(corte.origen) || !vec(corte.x) || !vec(corte.vz) || !rango(y) || !rango(z) || (corte.metodo !== undefined && corte.metodo !== "fuerzas-nodales" && corte.metodo !== "campos")) {
      diag.error("corte/no-valido", `El corte ${id} no está bien definido: origen, x y vz son vectores finitos, y e z rangos [mín, máx] finitos, y el método "fuerzas-nodales" o "campos".`, [id]);
      return null;
    }
    const nx = norma(corte.x);
    if (!(nx > 0)) {
      diag.error("corte/no-valido", `El corte ${id} tiene una normal nula.`, [id]);
      return null;
    }
    const ex = corte.x.map((c) => c / nx);
    const p = corte.vz[0] * ex[0]! + corte.vz[1] * ex[1]! + corte.vz[2] * ex[2]!;
    const vzp = [corte.vz[0] - p * ex[0]!, corte.vz[1] - p * ex[1]!, corte.vz[2] - p * ex[2]!];
    const nz = norma(vzp);
    if (!(nz > 1e-6 * norma(corte.vz))) {
      diag.error("corte/no-valido", `El vz del corte ${id} es (casi) paralelo a su normal: no fija el eje z.`, [id]);
      return null;
    }
    const ez = vzp.map((c) => c / nz);
    const ey = [ez[1]! * ex[2]! - ez[2]! * ex[1]!, ez[2]! * ex[0]! - ez[0]! * ex[2]!, ez[0]! * ex[1]! - ez[1]! * ex[0]!];
    const ejes = Float64Array.of(...ex, ...ey, ...ez);
    const O = Float64Array.from(corte.origen);
    const coordenadas = (q: ArrayLike<number>): [number, number, number] => {
      const d0 = q[0]! - O[0]!;
      const d1 = q[1]! - O[1]!;
      const d2 = q[2]! - O[2]!;
      return [d0 * ejes[0]! + d1 * ejes[1]! + d2 * ejes[2]!, d0 * ejes[3]! + d1 * ejes[4]! + d2 * ejes[5]!, d0 * ejes[6]! + d1 * ejes[7]! + d2 * ejes[8]!];
    };
    const dentro = (q: ArrayLike<number>) => {
      const [, cy, cz] = coordenadas(q);
      return cy >= y[0] - TOL_CORTE && cy <= y[1] + TOL_CORTE && cz >= z[0] - TOL_CORTE && cz <= z[1] + TOL_CORTE;
    };
    const { xyz } = this.fuerzas.geo;
    const nn = this.modelo.nudos.length;
    const lado = new Int8Array(nn);
    for (let v = 0; v < nn; v++) {
      const d = (xyz[3 * v]! - O[0]!) * ex[0]! + (xyz[3 * v + 1]! - O[1]!) * ex[1]! + (xyz[3 * v + 2]! - O[2]!) * ex[2]!;
      lado[v] = Math.abs(d) <= TOL_CORTE ? 0 : d < 0 ? -1 : 1;
    }
    return { corte, origen: O, ejes, y, z, lado, dentro, coordenadas };
  }

  /**
   * Esfuerzos del corte en cada caso de `casos` (los de un cálculo válido, en el orden de
   * `modelo.casos`). `campos` hace falta con el método "campos".
   */
  cortar(corte: Corte, casos: readonly ResultadoCaso[], campos?: IntegradorCampos): ResultadoCorte {
    const diag = new Diagnosticos();
    const nc = casos.length;
    const id = corte.id ?? "(sin id)";
    const info: InfoCorte = { laminas: [], barras: [], restricciones: [], extension: null };
    const vacio = (ejes: Float64Array = new Float64Array(9)): ResultadoCorte => ({ ...info, esfuerzos: new Float64Array(6 * nc).fill(NaN), ejes, diagnosticos: diag.lista, valido: false });
    const cp = this.preparar(corte, diag);
    if (!cp) return vacio();
    const metodo = corte.metodo ?? "fuerzas-nodales";
    if (metodo === "campos" && !campos) throw new Error("Cortes: el método «campos» necesita un IntegradorCampos (CamposLaminas)");
    const { lado, origen: O, ejes } = cp;
    const { xyz } = this.fuerzas.geo;
    const X = (v: number) => xyz.subarray(3 * v, 3 * v + 3);
    const suma = new Suma(nc, O);
    const ext = { y: [Infinity, -Infinity] as [number, number], z: [Infinity, -Infinity] as [number, number] };
    let muestras: MuestrasCorte | undefined;
    const extender = (p: ArrayLike<number>) => {
      const [, cy, cz] = cp.coordenadas(p);
      ext.y[0] = Math.min(ext.y[0], cy);
      ext.y[1] = Math.max(ext.y[1], cy);
      ext.z[0] = Math.min(ext.z[0], cz);
      ext.z[1] = Math.max(ext.z[1], cz);
    };

    // Láminas: las que tocan el plano desde el lado A, por sus fuerzas nodales (exacto, con los dos
    // métodos); las que lo atraviesan, error por fuerzas nodales o integral de campos
    {
      const atraviesan: string[] = [];
      const bordes: string[] = [];
      for (const e of this.fuerzas.elementos) {
        if (e.tipo !== "lamina") continue;
        let menos = 0;
        let mas = 0;
        const c = [0, 0, 0];
        for (const v of e.nudos) {
          if (lado[v]! < 0) menos++;
          else if (lado[v]! > 0) mas++;
          for (let q = 0; q < 3; q++) c[q]! += xyz[3 * v + q]! / 4;
        }
        if (menos === 0 || !cp.dentro(c)) continue;
        if (mas > 0) {
          if (metodo === "fuerzas-nodales") atraviesan.push(e.id);
          continue;
        }
        const enCorte = e.nudos.map((v, a) => [v, a] as const).filter(([v]) => lado[v] === 0);
        if (enCorte.length === 0) continue;
        info.laminas.push(e.indice);
        if (enCorte.some(([v]) => !cp.dentro(X(v)))) bordes.push(e.id);
        casos.forEach((r, k) => {
          const g = this.fuerzas.lamina(e.indice, k, r);
          for (const [v, a] of enCorte) suma.agregar(k, X(v), g.subarray(6 * a, 6 * a + 3), g.subarray(6 * a + 3, 6 * a + 6));
        });
        for (const [v] of enCorte) extender(X(v));
      }
      if (atraviesan.length) {
        diag.error(
          "corte/atraviesa-laminas",
          `El corte ${id} atraviesa ${atraviesan.length} láminas por dentro (${listaIds(atraviesan)}): por fuerzas nodales tiene que seguir los lados de la malla. Usa el método "campos" o siembra la línea del corte en la malla.`,
          [id, ...atraviesan],
        );
      }
      if (bordes.length) {
        diag.aviso(
          "corte/borde-no-sigue-malla",
          `Los bordes del corte ${id} no siguen la malla: ${bordes.length} láminas (${listaIds(bordes)}) entran enteras aunque parte de su lado quede fuera del rectángulo. La extensión real va en «extension».`,
          [id, ...bordes],
        );
      }
    }
    if (metodo === "campos") {
      const c = campos!.integrar(cp, casos, info, diag);
      for (let q = 0; q < c.suma.length; q++) suma.v[q]! += c.suma[q]!;
      muestras = c.muestras;
      if (info.extension) {
        for (const q of [0, 1] as const) {
          ext.y[q] = q ? Math.max(ext.y[1], info.extension.y[1]) : Math.min(ext.y[0], info.extension.y[0]);
          ext.z[q] = q ? Math.max(ext.z[1], info.extension.z[1]) : Math.min(ext.z[0], info.extension.z[0]);
        }
      }
    }

    // Barras
    const ambiguas: string[] = [];
    for (const e of this.fuerzas.elementos) {
      if (e.tipo !== "barra") continue;
      const [i, j] = e.nudos as [number, number];
      const si = lado[i]!;
      const sj = lado[j]!;
      const pb = e.barra!;
      const dIp = this.distancia(cp, pb.ip);
      const dJp = this.distancia(cp, pb.jp);
      const ladoDe = (d: number) => (Math.abs(d) <= TOL_CORTE ? 0 : d < 0 ? -1 : 1);
      if (si === sj) {
        // Del mismo lado (o las dos en el plano): sólo puede cruzar si un offset saca el tramo flexible al otro lado
        if (si !== 0 && (ladoDe(dIp) === -si || ladoDe(dJp) === -si)) ambiguas.push(e.id);
        continue;
      }
      if (si === 0 || sj === 0) {
        // Toca el plano en un nudo: entra si la barra queda del lado A
        const [n0, a0, otro] = si === 0 ? [i, 0, sj] : [j, 1, si];
        if (otro !== -1 || !cp.dentro(X(n0))) continue;
        info.barras.push(e.indice);
        extender(X(n0));
        casos.forEach((r, k) => {
          const g = this.fuerzas.barra(e.indice, k, r);
          suma.agregar(k, X(n0), g.subarray(6 * a0, 6 * a0 + 3), g.subarray(6 * a0 + 3, 6 * a0 + 6));
        });
        continue;
      }
      // Atraviesa: en el tramo flexible (diagrama exacto) o en un offset (fuerza del nudo del lado A)
      const aEsI = si === -1;
      const flexible = ladoDe(dIp) * ladoDe(dJp) === -1;
      let p: number[];
      if (flexible) {
        const t = dIp / (dIp - dJp);
        p = [0, 1, 2].map((q) => pb.ip[q]! + t * (pb.jp[q]! - pb.ip[q]!));
      } else {
        // Primer tramo del polígono i → i' → j' → j que cambia de lado
        const puntos = [X(i), pb.ip, pb.jp, X(j)];
        const d = [this.distancia(cp, X(i)), dIp, dJp, this.distancia(cp, X(j))];
        p = [...puntos[0]!];
        for (let s = 0; s < 3; s++) {
          if (d[s]! === 0 || d[s]! * d[s + 1]! <= 0) {
            const t = d[s]! === d[s + 1]! ? 0 : d[s]! / (d[s]! - d[s + 1]!);
            p = [0, 1, 2].map((q) => puntos[s]![q]! + t * (puntos[s + 1]![q]! - puntos[s]![q]!));
            break;
          }
        }
      }
      if (!cp.dentro(p)) continue;
      info.barras.push(e.indice);
      extender(p);
      if (flexible) {
        const dgs = this.diagramasBarras();
        const t = dIp / (dIp - dJp);
        const x = t * pb.L;
        const R = pb.R;
        casos.forEach((r, k) => {
          const s = dgs.diagrama(e.indice, k, r).esfuerzosEn(x, aEsI ? -1 : 1);
          // Fuerza y momento sobre la cara +x de la barra (del tramo [0, x) por el (x, L]); My = −m_y, Mz = m_z
          const Fl = [s[0]!, s[1]!, s[2]!];
          const ml = [s[3]!, -s[4]!, s[5]!];
          const F = [0, 1, 2].map((q) => R[q]! * Fl[0]! + R[3 + q]! * Fl[1]! + R[6 + q]! * Fl[2]!);
          const m = [0, 1, 2].map((q) => R[q]! * ml[0]! + R[3 + q]! * ml[1]! + R[6 + q]! * ml[2]!);
          suma.agregar(k, p, F, m, aEsI ? 1 : -1);
        });
      } else {
        const [nA, aA] = aEsI ? [i, 0] : [j, 1];
        casos.forEach((r, k) => {
          const g = this.fuerzas.barra(e.indice, k, r);
          suma.agregar(k, X(nA), g.subarray(6 * aA, 6 * aA + 3), g.subarray(6 * aA + 3, 6 * aA + 6), -1);
        });
      }
    }
    if (ambiguas.length) {
      diag.error(
        "corte/barra-ambigua",
        `El corte ${id} pasa entre un nudo y el tramo flexible de ${ambiguas.length} barras (${listaIds(ambiguas)}): sus offsets cruzan el plano y vuelven. Mueve el corte.`,
        [id, ...ambiguas],
      );
    }

    // Restricciones que atraviesan el plano
    const lista = this.modelo.restricciones ?? [];
    const incluidas: number[] = [];
    const nan = new Uint8Array(6);
    lista.forEach((rs, ir) => {
      const nudos = [rs.maestro, ...rs.esclavos];
      const enA = nudos.filter((v) => lado[v] === -1);
      if (enA.length === 0 || enA.length === nudos.length) return;
      const dentro = enA.filter((v) => cp.dentro(X(v)));
      if (dentro.length === 0) return;
      if (dentro.length === enA.length) {
        incluidas.push(ir);
        return;
      }
      // Partida por el borde del rectángulo: no se puede atribuir al corte
      const afectadas = this.componentesDe(rs.tipo, cp, nudos.map((v) => X(v)[2]!));
      afectadas.forEach((a, c) => {
        if (a) nan[c] = 1;
      });
      diag.aviso(
        "corte/restriccion-partida",
        `La restricción ${rs.id} (${rs.tipo}) atraviesa el corte ${id} pero tiene nudos del lado A fuera de él: lo que transmite no se puede atribuir al corte, así que ${COMPONENTES.filter((_, c) => afectadas[c]).join(", ")} quedan sin valor (NaN).` +
          (rs.tipo === "diafragma" ? " Con diafragma rígido, la losa no tiene esfuerzos de membrana: lo transmite el diafragma." : ""),
        [id, rs.id],
        { componentes: COMPONENTES.filter((_, c) => afectadas[c]) },
      );
    });
    if (incluidas.length) {
      info.restricciones.push(...incluidas);
      casos.forEach((r, k) => {
        const fr = this.fuerzas.restricciones(k, r, incluidas);
        for (const ir of incluidas) {
          const rs = lista[ir]!;
          const f = fr.get(ir)!;
          [rs.maestro, ...rs.esclavos].forEach((v, a) => {
            if (lado[v] !== -1) return;
            suma.agregar(k, X(v), f.subarray(6 * a, 6 * a + 3), f.subarray(6 * a + 3, 6 * a + 6));
            if (k === 0) extender(X(v));
          });
        }
      });
    }

    if (diag.hayErrores) return vacio(ejes);
    if (info.laminas.length + info.barras.length + info.restricciones.length === 0) {
      diag.aviso("corte/vacio", `El corte ${id} no atraviesa ningún elemento: sus esfuerzos son nulos.`, [id]);
    }
    // A los ejes del corte, con el convenio de las barras: My = −m_y, Mz = m_z
    const esfuerzos = new Float64Array(6 * nc);
    for (let k = 0; k < nc; k++) {
      const o = 6 * k;
      const F = suma.v.subarray(o, o + 3);
      const M = suma.v.subarray(o + 3, o + 6);
      const pr = (v: ArrayLike<number>, e: number) => v[0]! * ejes[3 * e]! + v[1]! * ejes[3 * e + 1]! + v[2]! * ejes[3 * e + 2]!;
      esfuerzos[o] = pr(F, 0);
      esfuerzos[o + 1] = pr(F, 1);
      esfuerzos[o + 2] = pr(F, 2);
      esfuerzos[o + 3] = pr(M, 0);
      esfuerzos[o + 4] = -pr(M, 1);
      esfuerzos[o + 5] = pr(M, 2);
      for (let c = 0; c < 6; c++) if (nan[c]) esfuerzos[o + c] = NaN;
    }
    info.extension = Number.isFinite(ext.y[0]) ? ext : null;
    return { ...info, esfuerzos, ejes, diagnosticos: diag.lista, valido: true, muestras };
  }

  /** Distancia con signo de un punto al plano del corte. */
  private distancia(cp: CortePreparado, p: ArrayLike<number>): number {
    return cp.coordenadas(p)[0];
  }

  private diagramasBarras(): DiagramasBarras {
    return (this.diagramas ??= new DiagramasBarras(this.modelo));
  }

  /**
   * Componentes del corte [N, Vy, Vz, T, My, Mz] a las que contribuye una restricción: todas en un
   * enlace rígido; en un diafragma (fuerzas horizontales y momento según Z en su plano, a la cota
   * zd), las fuerzas con componente horizontal, los momentos con componente según Z y, si el origen
   * no está a la cota del diafragma, también los de componente horizontal.
   */
  private componentesDe(tipo: "diafragma" | "enlace-rigido", cp: CortePreparado, cotas: number[]): boolean[] {
    if (tipo === "enlace-rigido") return [true, true, true, true, true, true];
    const e = cp.ejes;
    const h = Math.abs(cotas[0]! - cp.origen[2]!) > TOL_CORTE;
    const r: boolean[] = [];
    for (let c = 0; c < 3; c++) r.push(Math.hypot(e[3 * c]!, e[3 * c + 1]!) > 1e-9);
    for (let c = 0; c < 3; c++) r.push(Math.abs(e[3 * c + 2]!) > 1e-9 || (h && Math.hypot(e[3 * c]!, e[3 * c + 1]!) > 1e-9));
    return r;
  }
}
