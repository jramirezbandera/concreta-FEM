/**
 * Fase CO6 (`docs/fem3d/comprobaciones.md` §8.10): el armado en barras de una pieza (un tramo de
 * pilar, un vano de viga, una losa o la armadura de punzonamiento de una unión) como un formulario:
 * sus campos por grupos, el borrador en texto y el dato del proyecto que sale de él. Puro: lo usa la
 * ficha de Resultados · Comprobación; que el dato valga lo decide la operación `armado`.
 *
 * De los refuerzos y los cercos de nervio de una losa (rectángulos en sus ejes) edita las barras y
 * los quita (§8.11); la zona de cada uno se propone, y aquí se conserva.
 */
import type { ArmadoProyecto } from "../agente/armaduraBase.ts";
import type { ArmadoParte, TipoComprobacion } from "../visor/comprobaciones.ts";

export interface CampoArmado {
  /** La ruta del valor en el armado de la pieza («caraB.n», «base.x-inf.diametro»). */
  ruta: string;
  etiqueta: string;
  /** Un número de barras, un diámetro (mm, de la serie) o una medida en mm. */
  clase: "n" | "diametro" | "mm";
  /** Puede quedar vacío aunque su grupo esté. */
  opcional?: boolean;
}

export interface GrupoArmado {
  titulo: string;
  /** Todo vacío, el grupo no está en el armado. */
  opcional?: boolean;
  /** La ruta del objeto del grupo (vacía: sus campos van en la raíz). */
  ruta: string;
  campos: CampoArmado[];
  /** Un elemento de una lista de la losa (un refuerzo o una zona de cercos): cuál, para elegirlo en la planta y quitarlo. */
  elemento?: { lista: "refuerzos" | "cercos"; indice: number };
  /** Lo que no se edita de él: el largo de sus barras por el ancho que cubre («2,40 × 1,44 m»). */
  nota?: string;
}

/** El id con el que se elige en las vistas un refuerzo («L1/R3») o una zona de cercos («L1/C2») de una losa: su índice desde 1. */
export const idElemento = (losa: string, e: NonNullable<GrupoArmado["elemento"]>): string => `${losa}/${e.lista === "refuerzos" ? "R" : "C"}${e.indice + 1}`;

/** La losa y el elemento de un id de `idElemento`; null si no lo es. */
export function elementoDeId(id: string): { losa: string; lista: "refuerzos" | "cercos"; indice: number } | null {
  const m = /^(.+)\/([RC])(\d+)$/.exec(id);
  return m ? { losa: m[1]!, lista: m[2] === "R" ? "refuerzos" : "cercos", indice: Number(m[3]) - 1 } : null;
}

export const DIAMETROS_BARRA = [6, 8, 10, 12, 16, 20, 25, 32] as const;

const barras = (ruta: string, titulo: string, opcional = false, n = "barras"): GrupoArmado => ({
  titulo,
  ruta,
  ...(opcional ? { opcional } : {}),
  campos: [
    { ruta: `${ruta}.n`, etiqueta: n, clase: "n" },
    { ruta: `${ruta}.diametro`, etiqueta: "Ø", clase: "diametro" },
  ],
});
const cercos = (ruta: string, titulo: string, opcional = false, ramas = true): GrupoArmado => ({
  titulo,
  ruta,
  ...(opcional ? { opcional } : {}),
  campos: [
    { ruta: `${ruta}.diametro`, etiqueta: "Ø", clase: "diametro" },
    { ruta: `${ruta}.separacion`, etiqueta: "cada (mm)", clase: "mm" },
    ...(ramas ? [{ ruta: `${ruta}.ramas`, etiqueta: "ramas", clase: "n" as const, opcional: true }] : []),
  ],
});

const ARMADURAS = [
  ["x-inf", "X inferior"],
  ["x-sup", "X superior"],
  ["y-inf", "Y inferior"],
  ["y-sup", "Y superior"],
] as const;

/** Los grupos de campos del armado de una parte, según lo que es. */
export function gruposArmado(p: ArmadoParte): GrupoArmado[] {
  if (p.tipo === "pilares") {
    if (p.circular || p.armado?.anillo) return [barras("anillo", "Barras del anillo"), cercos("cercos", "Cercos", false, false)];
    return [
      { titulo: "Esquinas (4 barras)", ruta: "", campos: [{ ruta: "esquinas", etiqueta: "Ø", clase: "diametro" }] },
      barras("caraB", "Intermedias en cada cara b", true, "por cara"),
      barras("caraH", "Intermedias en cada cara h", true, "por cara"),
      cercos("cercos", "Cercos", false, false),
    ];
  }
  if (p.tipo === "vigas")
    return [
      barras("inferior", "Inferior, en todo el vano"),
      barras("superior", "Superior, corrida"),
      barras("superiorInicio", "Superior junto al apoyo de inicio", true),
      barras("superiorFin", "Superior junto al apoyo del fin", true),
      cercos("cercos", "Cercos"),
      cercos("cercosInicio", "Cercos junto al apoyo de inicio", true),
      cercos("cercosFin", "Cercos junto al apoyo del fin", true),
      barras("piel", "Piel, en cada cara lateral", true, "por cara"),
    ];
  if (p.tipo === "punzonamiento")
    return [
      {
        titulo: "Cercos por perímetros",
        ruta: "",
        campos: [
          { ruta: "diametro", etiqueta: "Ø", clase: "diametro" },
          { ruta: "ramas", etiqueta: "ramas por cara", clase: "n" },
          { ruta: "separacion", etiqueta: "cada (mm)", clase: "mm" },
        ],
      },
    ];
  // Una losa: la base de cada armadura (parrilla de una maciza: Ø y separación; montaje de los nervios de un reticular: n por nervio) y, en un reticular, la parrilla de los ábacos
  const base = (raiz: string, que: string, porNervio: boolean, opcional: boolean): GrupoArmado[] =>
    ARMADURAS.map(([k, nombre]) => ({
      titulo: `${que} ${nombre}`,
      ruta: `${raiz}.${k}`,
      ...(opcional ? { opcional } : {}),
      campos: [{ ruta: `${raiz}.${k}.diametro`, etiqueta: "Ø", clase: "diametro" as const }, porNervio ? { ruta: `${raiz}.${k}.n`, etiqueta: "por nervio", clase: "n" as const } : { ruta: `${raiz}.${k}.separacion`, etiqueta: "cada (mm)", clase: "mm" as const }],
    }));
  const m2 = (x: unknown) => (Array.isArray(x) && x.length === 2 && x.every((v) => typeof v === "number") ? (x[1] - x[0]).toFixed(2).replace(".", ",") : "?");
  const refuerzos: GrupoArmado[] = (p.armado?.refuerzos ?? []).map((r, indice) => {
    const nombre = ARMADURAS.find(([k]) => k === r.armadura)?.[1] ?? String(r.armadura);
    const porNervio = r.en === "nervios";
    return {
      titulo: `R${indice + 1} · ${nombre}${r.en ? ` · ${r.en === "abacos" ? "ábacos" : "nervios"}` : ""}`,
      ruta: `refuerzos.${indice}.barras`,
      campos: [{ ruta: `refuerzos.${indice}.barras.diametro`, etiqueta: "Ø", clase: "diametro" as const }, porNervio ? { ruta: `refuerzos.${indice}.barras.n`, etiqueta: "por nervio", clase: "n" as const } : { ruta: `refuerzos.${indice}.barras.separacion`, etiqueta: "cada (mm)", clase: "mm" as const }],
      elemento: { lista: "refuerzos" as const, indice },
      nota: `${m2(r.s)} × ${m2(r.t)} m`,
    };
  });
  const zonas: GrupoArmado[] = (p.armado?.cercos ?? []).map((c, indice) => ({
    ...cercos(`cercos.${indice}.cercos`, `C${indice + 1} · nervios ${c.direccion === "y" ? "Y" : "X"}`),
    elemento: { lista: "cercos" as const, indice },
    nota: `${m2(c.s)} × ${m2(c.t)} m`,
  }));
  return [...(p.reticular ? [...base("base", "Nervios,", true, false), ...base("abacos", "Ábacos,", false, true)] : base("base", "Base", false, false)), ...refuerzos, ...zonas];
}

/** El armado de una losa sin uno de sus refuerzos o de sus zonas de cercos. */
export function sinElemento<T extends { refuerzos?: unknown[]; cercos?: unknown[] }>(armado: T, e: NonNullable<GrupoArmado["elemento"]>): T {
  const a = structuredClone(armado);
  const lista = (a[e.lista] ?? []).filter((_, i) => i !== e.indice);
  if (lista.length) a[e.lista] = lista;
  else delete a[e.lista];
  return a;
}

const leer = (o: unknown, ruta: string): unknown => ruta.split(".").reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as Record<string, unknown>)[k] : undefined), o);

function escribir(o: Record<string, unknown>, ruta: string, v: unknown): void {
  const claves = ruta.split(".");
  let x = o;
  for (const k of claves.slice(0, -1)) x = (x[k] && typeof x[k] === "object" ? x[k] : (x[k] = {})) as Record<string, unknown>;
  const k = claves[claves.length - 1]!;
  if (v === undefined) delete x[k];
  else x[k] = v;
}

/** El borrador de un armado: el texto de cada campo, por su ruta (vacío, lo que no está). */
export function borradorArmado(armado: unknown, grupos: readonly GrupoArmado[]): Record<string, string> {
  const b: Record<string, string> = {};
  for (const g of grupos)
    for (const c of g.campos) {
      const v = leer(armado, c.ruta);
      b[c.ruta] = typeof v === "number" ? String(v).replace(".", ",") : "";
    }
  return b;
}

/**
 * El armado que dice un borrador, sobre el que había (lo que el formulario no edita, se conserva). Un
 * grupo opcional entero vacío no está; en los demás, lo que falta es un error.
 */
export function armadoDeBorrador(previo: unknown, grupos: readonly GrupoArmado[], borrador: Readonly<Record<string, string>>): { ok: true; armado: Record<string, unknown> } | { ok: false; error: string } {
  const a = structuredClone((previo ?? {}) as Record<string, unknown>);
  for (const g of grupos) {
    const textos = g.campos.map((c) => (borrador[c.ruta] ?? "").trim());
    if (g.opcional && textos.every((t) => t === "")) {
      if (g.ruta) escribir(a, g.ruta, undefined);
      continue;
    }
    for (const [i, c] of g.campos.entries()) {
      const t = textos[i]!;
      if (t === "") {
        if (!c.opcional) return { ok: false, error: `Falta «${c.etiqueta}» en «${g.titulo}».` };
        escribir(a, c.ruta, undefined);
        continue;
      }
      const v = Number(t.replace(",", "."));
      if (!Number.isFinite(v)) return { ok: false, error: `«${t}» no es un número («${c.etiqueta}» en «${g.titulo}»).` };
      escribir(a, c.ruta, v);
    }
  }
  return { ok: true, armado: a };
}

/**
 * El armado que dice un borrador a medias, para dibujarlo mientras se escribe: lo que no es un número
 * o falta, no está (no es un dato del proyecto: no se valida ni se guarda).
 */
export function armadoParcial(previo: unknown, grupos: readonly GrupoArmado[], borrador: Readonly<Record<string, string>>): Record<string, unknown> {
  const a = structuredClone((previo ?? {}) as Record<string, unknown>);
  for (const g of grupos) {
    const textos = g.campos.map((c) => (borrador[c.ruta] ?? "").trim());
    if (g.ruta && textos.every((t) => t === "")) {
      escribir(a, g.ruta, undefined);
      continue;
    }
    for (const [i, c] of g.campos.entries()) {
      const v = textos[i] === "" ? NaN : Number(textos[i]!.replace(",", "."));
      escribir(a, c.ruta, Number.isFinite(v) ? v : undefined);
    }
  }
  return a;
}

/** Qué parte es, para escribir su armado: la pieza, la planta (de la cabeza del tramo o de la losa) y la clave de la tabla («V3/0»: el vano). */
export interface ParteArmada {
  pieza: string;
  planta?: string;
  clave: string;
}

/** El armado del proyecto con el de una parte puesto (o quitado, con null): lo que se le da a la operación `armado`. */
export function ponerArmado(previo: ArmadoProyecto | undefined, tipo: TipoComprobacion, p: ParteArmada, valor: object | null): ArmadoProyecto {
  const a = structuredClone(previo ?? {}) as ArmadoProyecto & Record<string, unknown>;
  const porPlanta = (bloque: "pilares" | "punzonamiento") => {
    const b = ((a[bloque] as Record<string, Record<string, unknown>> | undefined) ?? (a[bloque] = {} as never)) as Record<string, Record<string, unknown>>;
    const suyo = (b[p.pieza] ??= {});
    if (valor) suyo[p.planta!] = valor;
    else delete suyo[p.planta!];
    if (!Object.keys(suyo).length) delete b[p.pieza];
  };
  if (tipo === "pilares") porPlanta("pilares");
  else if (tipo === "punzonamiento") porPlanta("punzonamiento");
  else if (tipo === "losas") {
    const b = (a.forjados ??= {}) as Record<string, unknown>;
    if (valor) b[p.pieza] = valor;
    else delete b[p.pieza];
  } else {
    const vano = Number(p.clave.slice(p.pieza.length + 1));
    const b = (a.vigas ??= {}) as Record<string, (object | null)[]>;
    const lista = (b[p.pieza] ??= []);
    while (lista.length <= vano) lista.push(null);
    lista[vano] = valor;
    while (lista.length && lista[lista.length - 1] === null) lista.pop();
    if (!lista.length) delete b[p.pieza];
  }
  for (const k of ["pilares", "vigas", "forjados", "punzonamiento"] as const) if (a[k] && !Object.keys(a[k]!).length) delete a[k];
  return a;
}
