/**
 * Resultados guardados de la capa de agente (A0): los de un cálculo válido, empaquetados en una
 * cabecera JSON y un bloque binario con los `Float64Array` de cada caso, tal cual (mismos bits).
 * Son derivados del proyecto (regla A2): la CLI los guarda en `.fem/<huella>/` y los reutiliza
 * mientras la huella no cambie.
 *
 * La huella es la del modelo físico, las opciones y la versión del compilador: si el compilador
 * cambia su salida sin cambiar de versión (mientras se desarrolla, o por un descuido), la misma
 * huella da otro modelo analítico, y unos resultados de la malla de antes se leían sobre la de ahora
 * sin ningún aviso (franjas de 1 000 kN·m/m en vez de 20, `docs/fem3d/firma-resultados.md`). Por eso
 * la cabecera lleva también la firma del modelo analítico calculado (`firmaModelo`), y unos
 * resultados sólo se desempaquetan sobre un modelo con la misma firma.
 *
 * Con el análisis modal (VS2), la cabecera lleva además las masas de los diafragmas y los números de
 * cada modo, y el bloque, tras los casos, los vectores de cada modo (forma, fuerzas y u).
 *
 * Puro: entra y sale texto y bytes; la CLI los escribe.
 */
import { resultanteAnalitica } from "../compilador/cargas.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import type { EstadisticasCalculo, ModeloAnalitico, ModoVibracion, ResultadoCaso, ResultadoModal } from "../motor/modelo.ts";

export const FORMATO_RESULTADOS = "concreta-fem/resultados@1";

const CAMPOS = ["u", "reacciones", "esfuerzosBarras", "esfuerzosLaminas"] as const;

/**
 * Firma del modelo analítico, sin sus cargas. La estructura es exacta: los ids (también los de los
 * casos), los tipos, las coacciones, la conectividad (los índices de nudos, barras y láminas) y
 * cuántos números hay en cada sitio, con un hash de 64 bits. Los demás números (coordenadas, secciones,
 * materiales…) van en sumas ponderadas por el nombre de su campo, que se comparan con tolerancia: el
 * mismo modelo sale en V8 y en JavaScriptCore con la misma malla pero no con los mismos bits
 * (coordenadas a 1e-12, secciones a 1–2 ulp: `huella.ts`), y la CLI (Bun) guarda resultados que el
 * visor usa en Chrome. Las cargas de cada caso, por su resultante (`resultanteAnalitica`, la del
 * control sin pérdidas): la lista no sirve, porque un motor parte una carga de barra donde el otro
 * no (en la planta circular de G, 19 150 cargas de barra en Bun y 19 098 en Node, con la misma
 * resultante).
 */
export interface FirmaModelo {
  estructura: string;
  /** Por campo: [Σ v·w, Σ |v|·w, n], con w ∈ [1, 2) según el orden del número en el modelo. */
  sumas: Record<string, [number, number, number]>;
  /** Por caso: [Fx, Fy, Fz, Mx, My, Mz, Σ|F|, Σ|M|] de sus cargas, respecto al origen. */
  cargas: number[][];
}

/** Campos cuyos números son índices (exactos, en la estructura). */
const INDICES = new Set(["nudos", "nudo", "barra", "lamina", "maestro", "esclavos", "gdl"]);

/**
 * Tolerancia relativa de las sumas: con números a 1e-12 entre motores, las sumas difieren ≲ 1e-12 de
 * Σ |v|·w; un nudo que se mueve 0,1 mm en una planta de 20 m con 50 000 nudos las mueve ~1e-4/1e6.
 */
const TOL_SUMAS = 1e-10;
/** Tolerancia relativa de la resultante de las cargas de un caso (la del control sin pérdidas es 1e-9). */
const TOL_CARGAS = 1e-9;

/** Por debajo de esto (en valor absoluto), un número que no es un índice cuenta como cero. */
const CERO = 1e-12;

/**
 * ¿Es nulo v: sólo números de |v| ≤ CERO, en listas u objetos, o vacío? Sólo para los offsets de las
 * barras, donde no tener ninguno es lo mismo que tenerlo nulo (no así en `empotramiento`, donde 0 es
 * articulado): el compilador pone un offset de un ulp (−4,4e-16 m) donde en el otro motor no pone
 * ninguno (los pilares circulares de la planta circular de G), y eso no es otro modelo.
 */
function nulo(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "number") return Math.abs(v) <= CERO;
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    const a = v as ArrayLike<unknown>;
    for (let i = 0; i < a.length; i++) if (!nulo(a[i])) return false;
    return true;
  }
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).every(nulo);
  return false;
}

export function firmaModelo(m: ModeloAnalitico): FirmaModelo {
  // Hash de 64 bits de la estructura, con aritmética entera de 32 bits (exacta en cualquier motor): un
  // SHA-256 del texto de la estructura costaba 0,7–1,4 s en los edificios objetivo, y la firma no
  // tiene que resistir a nadie, sólo distinguir un modelo de otro
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  const mezclar = (x: number): void => {
    h1 = Math.imul(h1 ^ x, 0x01000193);
    h2 = Math.imul(h2 ^ x, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  };
  const texto = (t: string): void => {
    mezclar(0x40000000 | t.length);
    for (let i = 0; i < t.length; i++) mezclar(t.charCodeAt(i));
  };
  const [NULO, NUMERO, INDICE, TEXTO, SI, NO, LISTA, OBJETO, FIN] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const sumas: Record<string, [number, number, number]> = {};
  let k = 0;
  const ir = (v: unknown, campo: string, indice: boolean, s: [number, number, number] | null): void => {
    if (v === null || v === undefined) mezclar(NULO);
    else if (typeof v === "number") {
      if (indice && Number.isInteger(v) && Math.abs(v) < 2 ** 31) {
        mezclar(INDICE);
        mezclar(v | 0);
      } else if (indice || !Number.isFinite(v)) {
        mezclar(INDICE);
        texto(String(v));
      } else {
        mezclar(NUMERO);
        // Peso en [1, 2) por el orden del número: exacto en cualquier motor (aritmética entera)
        const w = 1 + (Math.imul(k++, 0x9e3779b1) >>> 0) / 4294967296;
        const t = s ?? (sumas[campo] ??= [0, 0, 0]);
        t[0] += v * w;
        t[1] += Math.abs(v) * w;
        t[2]++;
      }
    } else if (typeof v === "string") {
      mezclar(TEXTO);
      texto(v);
    } else if (typeof v === "boolean") mezclar(v ? SI : NO);
    else if (Array.isArray(v) || ArrayBuffer.isView(v)) {
      const a = v as ArrayLike<unknown>;
      mezclar(LISTA);
      mezclar(a.length);
      for (let i = 0; i < a.length; i++) ir(a[i], campo, indice, s);
      mezclar(FIN);
    } else if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      // Un offset nulo, como ausente (en `offsets` y en sus extremos i y j)
      const claves = Object.keys(o)
        .filter((c) => o[c] !== undefined && !((c === "offsets" || campo === "offsets") && nulo(o[c])))
        .sort();
      mezclar(OBJETO);
      for (const c of claves) {
        texto(c);
        ir(o[c], c, INDICES.has(c), null);
      }
      mezclar(FIN);
    } else mezclar(0);
  };
  ir({ ...m, casos: m.casos.map((c) => c.id) }, "", false, null);
  const cargas = m.casos.map((_, c) => {
    const r = resultanteAnalitica(m, c, [0, 0, 0]);
    return [...r.F, ...r.M, r.escalaF, r.escalaM];
  });
  const hex = (x: number) => (x >>> 0).toString(16).padStart(8, "0");
  return { estructura: hex(h1) + hex(h2), sumas, cargas };
}

/** null si las dos firmas son del mismo modelo; si no, en qué difieren. */
export function difiereFirma(a: FirmaModelo, b: FirmaModelo): string | null {
  if (a.estructura !== b.estructura) return "la malla, la conectividad o los casos del modelo no son los mismos";
  const campos = new Set([...Object.keys(a.sumas), ...Object.keys(b.sumas)]);
  for (const c of [...campos].sort()) {
    const [x, y] = [a.sumas[c], b.sumas[c]];
    if (!x || !y || x[2] !== y[2]) return `los valores de «${c}» del modelo no son los mismos`;
    // Más un suelo de 1e-11 por número: lo que difiere a 1e-12 un número de |v| < 1 (una coordenada junto al origen)
    if (!(Math.abs(x[0] - y[0]) <= TOL_SUMAS * Math.max(x[1], y[1]) + 1e-11 * x[2])) return `los valores de «${c}» del modelo no son los mismos`;
  }
  if (a.cargas.length !== b.cargas.length) return "los casos del modelo no son los mismos";
  for (let k = 0; k < a.cargas.length; k++) {
    const [x, y] = [a.cargas[k]!, b.cargas[k]!];
    const [eF, eM] = [Math.max(x[6]!, y[6]!), Math.max(x[7]!, y[7]!)];
    const dF = Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
    const dM = Math.hypot(x[3]! - y[3]!, x[4]! - y[4]!, x[5]! - y[5]!);
    if (!(dF <= TOL_CARGAS * eF + 1e-12) || !(dM <= TOL_CARGAS * eM + 1e-12) || !(Math.abs(x[6]! - y[6]!) <= TOL_CARGAS * eF + 1e-12)) return `las cargas del caso ${k + 1} del modelo no son las mismas`;
  }
  return null;
}

export interface CabeceraResultados {
  formato: typeof FORMATO_RESULTADOS;
  /** Huella de compilación del proyecto calculado. */
  huella: string;
  /** Firma del modelo analítico calculado: unos resultados sólo valen para un modelo con la misma. */
  modelo: FirmaModelo;
  casos: { id: string; equilibrio: { fuerzas: number; momentos: number }; residuo: number }[];
  /** Longitud de cada vector de un caso; en el bloque, los de cada caso van seguidos en este orden. */
  longitudes: Record<(typeof CAMPOS)[number], number>;
  estadisticas: EstadisticasCalculo;
  /** Diagnósticos del cálculo (avisos), ya con los ids físicos. */
  diagnosticos: Diagnostico[];
  /** VS2: el análisis modal, si el modelo lo pide. Los vectores de cada modo van en el bloque, tras los casos. */
  modal?: CabeceraModal;
}

/** El análisis modal sin los vectores de sus modos, que van en el bloque: de cada uno, forma, fuerzas y u, en este orden. */
export type CabeceraModal = Omit<ResultadoModal, "modos"> & {
  modos: Omit<ModoVibracion, "forma" | "fuerzas" | "u">[];
  /** Longitud de `u` de cada modo (6 por nudo); `forma` y `fuerzas` son 3 por diafragma. */
  longitudU: number;
};

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** Empaqueta los resultados de `modelo` (el modelo analítico que se calculó). */
export function empaquetarResultados(
  huella: string,
  modelo: ModeloAnalitico,
  casos: readonly ResultadoCaso[],
  estadisticas: EstadisticasCalculo,
  diagnosticos: Diagnostico[],
  modal?: ResultadoModal,
): { cabecera: CabeceraResultados; bytes: Uint8Array } {
  if (!LITTLE_ENDIAN) throw new Error("Los resultados se guardan en little-endian y esta máquina no lo es");
  const c0 = casos[0];
  const longitudes = { u: c0?.u.length ?? 0, reacciones: c0?.reacciones.length ?? 0, esfuerzosBarras: c0?.esfuerzosBarras.length ?? 0, esfuerzosLaminas: c0?.esfuerzosLaminas.length ?? 0 };
  const porCaso = CAMPOS.reduce((s, k) => s + longitudes[k], 0);
  const nd3 = 3 * (modal?.diafragmas.length ?? 0);
  const longitudU = modal?.modos[0]?.u.length ?? 0;
  const porModo = 2 * nd3 + longitudU;
  const datos = new Float64Array(porCaso * casos.length + porModo * (modal?.modos.length ?? 0));
  casos.forEach((c, k) => {
    let o = k * porCaso;
    for (const campo of CAMPOS) {
      if (c[campo].length !== longitudes[campo]) throw new Error(`El caso ${c.id} tiene ${c[campo].length} valores de ${campo} y el primero ${longitudes[campo]}`);
      datos.set(c[campo], o);
      o += longitudes[campo];
    }
  });
  let cabeceraModal: CabeceraModal | undefined;
  if (modal) {
    modal.modos.forEach((m, i) => {
      if (m.forma.length !== nd3 || m.fuerzas.length !== nd3 || m.u.length !== longitudU) throw new Error(`El modo ${i + 1} no tiene los vectores del tamaño de los demás`);
      const o = porCaso * casos.length + i * porModo;
      datos.set(m.forma, o);
      datos.set(m.fuerzas, o + nd3);
      datos.set(m.u, o + 2 * nd3);
    });
    cabeceraModal = { ...modal, modos: modal.modos.map(({ forma: _f, fuerzas: _q, u: _u, ...resto }) => resto), longitudU };
  }
  return {
    cabecera: {
      formato: FORMATO_RESULTADOS,
      huella,
      modelo: firmaModelo(modelo),
      casos: casos.map((c) => ({ id: c.id, equilibrio: c.equilibrio, residuo: c.residuo })),
      longitudes,
      estadisticas,
      diagnosticos,
      ...(cabeceraModal ? { modal: cabeceraModal } : {}),
    },
    bytes: new Uint8Array(datos.buffer),
  };
}

/**
 * Los casos de unos resultados guardados, si son de `modelo` (el modelo analítico de la compilación
 * de ahora); si no, el motivo: la cabecera y los bytes no casan, o son de otro modelo analítico
 * aunque la huella sea la misma (o no llevan su firma: los guardó una versión anterior). Con ellos,
 * el análisis modal, si el modelo lo pide (y si lo pide y no lo llevan, no valen).
 */
export function desempaquetarResultados(cabecera: CabeceraResultados, bytes: Uint8Array, modelo: ModeloAnalitico): { casos: ResultadoCaso[]; modal?: ResultadoModal } | { motivo: string } {
  if (cabecera.formato !== FORMATO_RESULTADOS || !LITTLE_ENDIAN) return { motivo: "no tienen el formato de esta versión" };
  const f = cabecera.modelo as Partial<FirmaModelo> | undefined;
  if (!f || typeof f.estructura !== "string" || typeof f.sumas !== "object" || f.sumas === null || !Array.isArray(f.cargas)) return { motivo: "no llevan la firma del modelo calculado (los guardó una versión anterior)" };
  const otro = difiereFirma(f as FirmaModelo, firmaModelo(modelo));
  if (otro) return { motivo: `son de otro modelo analítico: ${otro}` };
  const porCaso = CAMPOS.reduce((s, k) => s + cabecera.longitudes[k], 0);
  const cm = cabecera.modal;
  if (!!modelo.modal !== !!cm) return { motivo: cm ? "llevan un análisis modal que el modelo no pide" : "no llevan los modos de vibración que pide el modelo" };
  if (cm && !(Array.isArray(cm.modos) && Array.isArray(cm.diafragmas) && Number.isInteger(cm.longitudU) && cm.longitudU >= 0)) return { motivo: "su análisis modal no tiene el formato de esta versión" };
  const nd3 = 3 * (cm?.diafragmas.length ?? 0);
  const porModo = cm ? 2 * nd3 + cm.longitudU : 0;
  if (bytes.byteLength !== 8 * (porCaso * cabecera.casos.length + porModo * (cm?.modos.length ?? 0))) return { motivo: "resultados.bin no casa con su cabecera" };
  // Copia alineada: los bytes de un fichero no tienen por qué empezar en múltiplo de 8
  const datos = new Float64Array(bytes.slice().buffer);
  let modal: ResultadoModal | undefined;
  if (cm) {
    const { longitudU, modos, ...resto } = cm;
    modal = {
      ...resto,
      modos: modos.map((m, i) => {
        const o = porCaso * cabecera.casos.length + i * porModo;
        return { ...m, forma: datos.slice(o, o + nd3), fuerzas: datos.slice(o + nd3, o + 2 * nd3), u: datos.slice(o + 2 * nd3, o + porModo) };
      }),
    };
  }
  return {
    ...(modal ? { modal } : {}),
    casos: cabecera.casos.map((c, k) => {
      let o = k * porCaso;
      const r = {} as Record<(typeof CAMPOS)[number], Float64Array>;
      for (const campo of CAMPOS) {
        r[campo] = datos.slice(o, o + cabecera.longitudes[campo]);
        o += cabecera.longitudes[campo];
      }
      return { id: c.id, ...r, equilibrio: c.equilibrio, residuo: c.residuo };
    }),
  };
}
