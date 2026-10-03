/**
 * Generador de combinaciones de acciones CTE DB SE 4.2–4.3 y NCSE-02 para el modelo 3D (H30).
 *
 * Cada combinación es un vector de factores alineado con los casos de carga base: el motor
 * resuelve los casos una vez y Concreta superpone (H21). Reglas:
 *
 * - ELU persistente o transitoria (4.3): Σ γG·Gk + γQ·Qk,1 + Σ γQ·ψ0·Qk,i
 * - ELU extraordinaria (4.4): Σ Gk + Ad + ψ1·Qk,1 + Σ ψ2·Qk,i   (con `incendio`, también sin Ad)
 * - ELU sísmica (4.5): Σ Gk + Ad + Σ ψ2·Qk,i, con el 100/30 en dos direcciones (NCSE-02 3.6.2.4)
 *   y la excentricidad accidental como casos de una familia por dirección (NCSE-02 3.2)
 * - ELS característica (4.6), frecuente (4.7) y casi permanente (4.8)
 * - GEO y GEO-SIS: acciones para el terreno (DB SE-C 2.3.2.2, γ = 1)
 *
 * Además:
 * - las permanentes son favorables o desfavorables «consideradas globalmente» (4.2.2-1): todas con
 *   el mismo estado, cada una con su γ de la tabla 4.1;
 * - una variable favorable no está (γ = 0) y de cada familia excluyente (viento en 4 direcciones,
 *   sismo con ±e) entra como mucho un caso;
 * - las cargas nocionales (casos N, derivados de un caso vertical, RES-17) entran en ELU-PT con el
 *   factor de su caso origen y el signo de la acción lateral presente; sin acción lateral, una
 *   combinación por dirección y signo;
 * - sin combinaciones repetidas (un ψ = 0 deja una combinación igual a otra).
 *
 * El perfil «cype» reproduce los coeficientes de una memoria CYPE de CE/CTE (P2115, A.3): G
 * favorable 0,80 también en sísmica e incendio, y para el terreno todas las variables con γ = 1
 * sin ψ (sin viento con sismo).
 */
import type { Psi } from "./psi.ts";

/** G permanente · Q uso · S nieve · W viento · T temperatura · E sismo · A accidental · N nocional. */
export type TipoAccion = "G" | "Q" | "S" | "W" | "T" | "E" | "A" | "N";

/** Clase de duración (DB SE-M tabla 2.2), para el kmod de la madera. */
export type Duracion = "permanente" | "larga" | "media" | "corta" | "instantanea";

export interface CasoCarga {
  id: string;
  tipo: TipoAccion;
  /** Familia excluyente: como mucho un caso de la familia por combinación. */
  familia?: string;
  /** ψ de la tabla 4.2 (Q, S, W y T). */
  psi?: Psi;
  /** G: fila de la tabla 4.1 (peso propio y del terreno por defecto). */
  permanente?: "peso" | "empuje" | "agua";
  /** W, E y N: dirección horizontal; W y N, además, el signo. */
  direccion?: "X" | "Y";
  signo?: 1 | -1;
  /** N: id del caso vertical del que deriva (Hi = φ·Ni). */
  derivadoDe?: string;
  /** Por defecto: G permanente, Q media, S corta, W y T corta, E y A instantánea; N la de su origen. */
  duracion?: Duracion;
}

export type Situacion = "ELU-PT" | "ELU-ACC" | "ELU-SIS" | "ELS-C" | "ELS-F" | "ELS-CP" | "GEO" | "GEO-SIS";
export const SITUACIONES: readonly Situacion[] = ["ELU-PT", "ELU-ACC", "ELU-SIS", "ELS-C", "ELS-F", "ELS-CP", "GEO", "GEO-SIS"];

export interface Combinacion {
  id: string;
  situacion: Situacion;
  /** Factores alineados con los casos de carga. */
  factores: Float64Array;
  etiqueta: string;
  duracion: Duracion;
}

export interface OpcionesCombinaciones {
  situaciones?: readonly Situacion[];
  perfil?: "cte" | "cype";
  /** ELU-ACC también sin acción accidental: la situación de incendio. */
  incendio?: boolean;
}

/** Coeficientes de un caso en una situación: γ favorable y desfavorable, y ψ como principal y como acompañante. */
interface Coef {
  fav: number;
  desf: number;
  psiP: number;
  psiA: number;
}

const PSI_NULO: Psi = { psi0: 0, psi1: 0, psi2: 0 };

/** Tabla 4.1 (resistencia): γ de las permanentes. */
const GAMMA_G = {
  peso: { fav: 0.8, desf: 1.35 },
  empuje: { fav: 0.7, desf: 1.35 },
  agua: { fav: 0.9, desf: 1.2 },
};

function coeficientes(perfil: "cte" | "cype", s: Situacion, c: CasoCarga): Coef | null {
  const psi = c.psi ?? PSI_NULO;
  const cype = perfil === "cype";
  switch (c.tipo) {
    case "G": {
      if (s === "ELU-PT") {
        const g = GAMMA_G[c.permanente ?? "peso"];
        return { fav: g.fav, desf: g.desf, psiP: 1, psiA: 1 };
      }
      // Extraordinarias: G sin mayorar; CYPE la toma además como favorable a 0,80.
      const fav = cype && (s === "ELU-ACC" || s === "ELU-SIS") ? 0.8 : 1;
      return { fav, desf: 1, psiP: 1, psiA: 1 };
    }
    case "Q":
    case "S":
    case "W":
    case "T":
      switch (s) {
        case "ELU-PT":
          return { fav: 0, desf: 1.5, psiP: 1, psiA: psi.psi0 };
        case "ELU-ACC":
          return { fav: 0, desf: 1, psiP: psi.psi1, psiA: psi.psi2 };
        case "ELU-SIS":
          return { fav: 0, desf: 1, psiP: psi.psi2, psiA: psi.psi2 };
        case "ELS-C":
          return { fav: 0, desf: 1, psiP: 1, psiA: psi.psi0 };
        case "ELS-F":
          return { fav: 0, desf: 1, psiP: psi.psi1, psiA: psi.psi2 };
        case "ELS-CP":
          return { fav: 0, desf: 1, psiP: psi.psi2, psiA: psi.psi2 };
        case "GEO":
          return cype ? { fav: 0, desf: 1, psiP: 1, psiA: 1 } : { fav: 0, desf: 1, psiP: 1, psiA: psi.psi0 };
        case "GEO-SIS":
          if (!cype) return { fav: 0, desf: 1, psiP: psi.psi2, psiA: psi.psi2 };
          return c.tipo === "W" ? { fav: 0, desf: 0, psiP: 0, psiA: 0 } : { fav: 0, desf: 1, psiP: 1, psiA: 1 };
      }
      break;
    case "E":
      // Signo reversible (−1/+1) y 30 % en la dirección ortogonal.
      return s === "ELU-SIS" || s === "GEO-SIS" ? { fav: -1, desf: 1, psiP: 1, psiA: 0.3 } : null;
    case "A":
      return s === "ELU-ACC" ? { fav: 0, desf: 1, psiP: 1, psiA: 1 } : null;
    case "N":
      return null; // se añaden aparte, ligadas a su caso origen
  }
  return null;
}

/** Situaciones con acción variable principal (ψ distinto como principal y como acompañante). */
const CON_PRINCIPAL: Record<Situacion, boolean> = {
  "ELU-PT": true,
  "ELU-ACC": true,
  "ELU-SIS": false,
  "ELS-C": true,
  "ELS-F": true,
  "ELS-CP": false,
  GEO: true,
  "GEO-SIS": false,
};

const ORDEN_DURACION: readonly Duracion[] = ["permanente", "larga", "media", "corta", "instantanea"];
const DURACION_POR_TIPO: Record<Exclude<TipoAccion, "N">, Duracion> = {
  G: "permanente",
  Q: "media",
  S: "corta",
  W: "corta",
  T: "corta",
  E: "instantanea",
  A: "instantanea",
};

const esVariable = (c: CasoCarga) => c.tipo === "Q" || c.tipo === "S" || c.tipo === "W" || c.tipo === "T";

function validar(casos: readonly CasoCarga[]): void {
  const ids = new Set<string>();
  for (const c of casos) {
    if (ids.has(c.id)) throw new Error(`caso de carga repetido: ${c.id}`);
    ids.add(c.id);
    if (esVariable(c) && !c.psi) throw new Error(`la variable ${c.id} no tiene ψ`);
    if (c.tipo === "E" && !c.direccion) throw new Error(`el sismo ${c.id} no tiene dirección`);
    if (c.tipo === "N") {
      if (!c.direccion || !c.signo) throw new Error(`la nocional ${c.id} no tiene dirección y signo`);
      const origen = casos.find((o) => o.id === c.derivadoDe);
      if (!origen || !(origen.tipo === "G" || origen.tipo === "Q" || origen.tipo === "S")) {
        throw new Error(`la nocional ${c.id} no deriva de un caso vertical (G, Q o S)`);
      }
    }
    if (c.familia) {
      const tipos = new Set(casos.filter((o) => o.familia === c.familia).map((o) => o.tipo));
      if (tipos.size > 1) throw new Error(`la familia ${c.familia} mezcla tipos de acción`);
    }
  }
}

export function generarCombinaciones(casos: readonly CasoCarga[], opciones: OpcionesCombinaciones = {}): Combinacion[] {
  validar(casos);
  const perfil = opciones.perfil ?? "cte";
  const n = casos.length;
  const indice = new Map(casos.map((c, i) => [c.id, i]));
  const variables = casos.map((c, i) => (esVariable(c) ? i : -1)).filter((i) => i >= 0);
  // Grupos excluyentes de variables (familia o caso suelto)
  const grupos = new Map<string, number[]>();
  for (const i of variables) {
    const k = casos[i]!.familia ?? `#${casos[i]!.id}`;
    grupos.set(k, [...(grupos.get(k) ?? []), i]);
  }
  const gruposVar = [...grupos.values()];
  const permanentes = casos.map((c, i) => (c.tipo === "G" ? i : -1)).filter((i) => i >= 0);
  const sismos = { X: [] as number[], Y: [] as number[] };
  casos.forEach((c, i) => c.tipo === "E" && sismos[c.direccion!].push(i));
  const accidentales = casos.map((c, i) => (c.tipo === "A" ? i : -1)).filter((i) => i >= 0);
  const nocionales = casos.map((c, i) => (c.tipo === "N" ? i : -1)).filter((i) => i >= 0);

  const salida: Combinacion[] = [];
  for (const s of opciones.situaciones ?? SITUACIONES) {
    const coef = casos.map((c) => coeficientes(perfil, s, c));
    const vistos = new Set<string>();
    let num = 0;
    const emitir = (f: Float64Array) => {
      // Factores limpios (1,5·0,7 = 1,05 y no 1,0499999999999998) y sin −0
      for (let i = 0; i < n; i++) f[i] = Math.round(f[i]! * 1e12) / 1e12 || 0;
      const clave = Array.from(f).join(",");
      if (vistos.has(clave)) return;
      vistos.add(clave);
      salida.push({ id: `${s}-${++num}`, situacion: s, factores: f, etiqueta: etiqueta(casos, f), duracion: duracion(casos, indice, f) });
    };

    // Partes que no son variables: sismo (100/30) o accidental, según la situación
    const partes: { i: number; f: number }[][] = [];
    const conSismo = s === "ELU-SIS" || s === "GEO-SIS";
    if (conSismo) {
      for (const [d, o] of [["X", "Y"], ["Y", "X"]] as const) {
        for (const im of sismos[d]) {
          const cm = coef[im]!;
          const signos = cm.fav < 0 ? [1, -1] : [1];
          for (const sm of signos) {
            const base = { i: im, f: sm * cm.desf * cm.psiP };
            if (sismos[o].length === 0 || cm.psiA === 0) partes.push([base]);
            for (const io of sismos[o]) for (const so of signos) partes.push([base, { i: io, f: so * coef[io]!.desf * coef[io]!.psiA }]);
          }
        }
      }
      if (partes.length === 0) continue; // sin sismo no hay situación sísmica
    } else if (s === "ELU-ACC") {
      for (const ia of accidentales) partes.push([{ i: ia, f: coef[ia]!.desf }]);
      if (opciones.incendio) partes.push([]);
      if (partes.length === 0) continue;
    } else {
      partes.push([]);
    }

    // Estados de las permanentes: desfavorables o favorables, todas a la vez
    const estadosG = [...new Set(["desf", "fav"].map((e) => permanentes.map((i) => (e === "desf" ? coef[i]!.desf : coef[i]!.fav)).join(",")))].map((k) =>
      k === "" ? [] : k.split(",").map(Number),
    );

    for (const gs of estadosG) {
      for (const parte of partes) {
        const principales: (number | null)[] = [null, ...(CON_PRINCIPAL[s] ? variables : [])];
        for (const pr of principales) {
          const grupoPr = pr === null ? null : gruposVar.find((g) => g.includes(pr))!;
          if (pr !== null && coef[pr]!.desf * coef[pr]!.psiP === 0) continue;
          // Sin principal en una situación con principal: sólo permanentes (y la parte fija)
          const acompanan = pr !== null || !CON_PRINCIPAL[s];
          const recorrer = (k: number, f: Float64Array) => {
            if (k === gruposVar.length) {
              for (const fe of conNocionales(s, f)) emitir(fe);
              return;
            }
            const g = gruposVar[k]!;
            if (g === grupoPr || !acompanan) return recorrer(k + 1, f);
            recorrer(k + 1, f); // ausente: favorable, γ = 0
            for (const i of g) {
              const v = coef[i]!.desf * coef[i]!.psiA;
              if (v === 0) continue;
              const f2 = f.slice();
              f2[i] = v;
              recorrer(k + 1, f2);
            }
          };
          const f0 = new Float64Array(n);
          permanentes.forEach((i, j) => (f0[i] = gs[j]!));
          for (const { i, f } of parte) f0[i] = f;
          if (pr !== null) f0[pr] = coef[pr]!.desf * coef[pr]!.psiP;
          recorrer(0, f0);
        }
      }
    }
  }
  return salida;

  /** Cargas nocionales: sólo en ELU-PT, con el factor de su caso origen. */
  function conNocionales(s: Situacion, f: Float64Array): Float64Array[] {
    if (s !== "ELU-PT" || nocionales.length === 0) return [f];
    const laterales = new Set<string>();
    casos.forEach((c, i) => {
      if (c.tipo === "W" && f[i]! > 0 && c.direccion && c.signo) laterales.add(`${c.direccion}${c.signo}`);
    });
    const pares = laterales.size > 0 ? [laterales] : [...new Set(nocionales.map((i) => `${casos[i]!.direccion}${casos[i]!.signo}`))].map((p) => new Set([p]));
    return pares.map((activos) => {
      const g = f.slice();
      for (const i of nocionales) {
        const c = casos[i]!;
        if (activos.has(`${c.direccion}${c.signo}`)) g[i] = f[indice.get(c.derivadoDe!)!]!;
      }
      return g;
    });
  }
}

function duracion(casos: readonly CasoCarga[], indice: Map<string, number>, f: Float64Array): Duracion {
  let peor = 0;
  casos.forEach((c, i) => {
    if (f[i] === 0) return;
    const origen = c.tipo === "N" ? casos[indice.get(c.derivadoDe!)!]! : c;
    const d = c.duracion ?? origen.duracion ?? DURACION_POR_TIPO[origen.tipo as Exclude<TipoAccion, "N">];
    peor = Math.max(peor, ORDEN_DURACION.indexOf(d));
  });
  return ORDEN_DURACION[peor]!;
}

const fmt = (v: number) => String(Math.round(v * 1e4) / 1e4);

function etiqueta(casos: readonly CasoCarga[], f: Float64Array): string {
  const partes: string[] = [];
  casos.forEach((c, i) => {
    const v = f[i]!;
    if (v === 0) return;
    const signo = v < 0 ? "−" : partes.length ? "+" : "";
    partes.push(`${signo}${partes.length && signo ? " " : ""}${fmt(Math.abs(v))}·${c.id}`);
  });
  return partes.join(" ");
}

/** Matriz de factores (combinaciones × casos, por filas) para superponer resultados (H36). */
export function matrizFactores(combinaciones: readonly Combinacion[], nCasos: number): Float64Array {
  const m = new Float64Array(combinaciones.length * nCasos);
  combinaciones.forEach((c, k) => m.set(c.factores, k * nCasos));
  return m;
}
