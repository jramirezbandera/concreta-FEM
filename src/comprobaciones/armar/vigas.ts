/**
 * Fase CO2 (`docs/fem3d/comprobaciones.md` §4.4): proponer el armado de un vano de viga.
 *
 * Como en los pilares, proponer es elegir de unas tablas y el juez es la comprobación
 * (`comprobarVano`: el módulo de vigas de Concreta, la flecha y la torsión); aquí no hay ninguna
 * fórmula de armado. Determinista.
 *
 * Un vano tiene varias armaduras (la inferior, la superior corrida y la de cada apoyo, los cercos del
 * centro y los de cada apoyo, y las barras de piel), cada una con su tabla, de menos a más acero. Se
 * empieza por la primera de cada tabla; cada fila que falla dice qué armadura hay que aumentar
 * (`FilaViga.grupo`), y ésa pasa a la siguiente de su tabla, hasta que no falla ninguna. Al final se
 * intenta bajar cada una un puesto, por si otra que subió después la hizo innecesaria: lo propuesto
 * cumple, y con cualquiera de sus armaduras un puesto más abajo, no.
 *
 * Las tablas:
 *  - barras de una cara: de 2 a 12 del mismo diámetro (12, 16, 20 o 25) que quepan en el ancho con
 *    25 mm libres entre ellas (el árido de 20 mm más 5, CE A19 §8.2(2)), de menos a más acero;
 *  - cercos: Ø6, Ø8 o Ø10 a 300, 250, 200, 150, 125, 100, 75 o 60 mm, de 2, 3, 4 o 6 ramas (las que
 *    caben a 60 mm o más entre ejes). Primero los de 2 ramas, de menos a más acero, y luego los de
 *    más: sólo llevan más de dos las vigas que lo necesitan (una plana, por la separación
 *    transversal de 0,75·d del §9.2.2(8));
 *  - piel: de 0 a 5 barras Ø12 por cara lateral (sólo las pide la torsión de equilibrio).
 * La armadura superior de un apoyo no baja de la corrida, ni sus cercos de los del centro.
 *
 * Con `fijas`, la superior de la zona de un apoyo es la dada y no se mueve (la que se ha igualado con
 * el vano del otro lado, CO2-k): se propone lo demás con ella.
 */
import { armadoViga, ramasDe, type ArmadoVanoViga, type BarrasCara, type CercosViga, type DatosArmado } from "../armado.ts";
import { comprobarVano, geometriaViga, type ComprobacionVano, type FilaViga, type GrupoArmado } from "../comprobar/vigas.ts";
import type { DemandasVano, DemandasViga } from "../demandas/vigas.ts";

export const DIAMETROS_VIGA = [12, 16, 20, 25] as const;
export const BARRAS_MAXIMO = 12;
export const DIAMETROS_CERCO = [6, 8, 10] as const;
export const SEPARACIONES_CERCO = [300, 250, 200, 150, 125, 100, 75, 60] as const;
export const PIEL_MAXIMO = 5;
export const DIAMETRO_PIEL = 12;

/** Separación libre mínima entre las barras de la tabla, mm: el árido de 20 mm más 5 (CE A19 §8.2(2)). */
export const SEPARACION_LIBRE = 25;

const area = (d: number) => (Math.PI * d * d) / 4;

/** Las barras de una cara de una viga de ancho b (mm), de menos a más acero (a igual área, menos barras). Sólo las que caben. */
export function tablaBarras(b: number, recubrimiento: number): BarrasCara[] {
  const tabla: BarrasCara[] = [];
  // El hueco entre los cercos (con el más fino) y la separación libre mínima entre barras: máx(Ø, 25 mm)
  const hueco = b - 2 * recubrimiento - 2 * DIAMETROS_CERCO[0];
  for (const diametro of DIAMETROS_VIGA) for (let n = 2; n <= BARRAS_MAXIMO; n++) if (n * diametro + (n - 1) * Math.max(diametro, SEPARACION_LIBRE) <= hueco + 1e-9) tabla.push({ n, diametro });
  return tabla
    .map((t, i) => ({ t, i, a: t.n * area(t.diametro) }))
    .sort((p, q) => p.a - q.a || p.t.n - q.t.n || p.i - q.i)
    .map((x) => x.t);
}

export const RAMAS_CERCO = [2, 3, 4, 6] as const;
/** Separación mínima entre los ejes de dos ramas de un cerco, mm. */
export const SEPARACION_RAMAS = 60;

/** Los cercos de una viga de ancho b (mm): de menos a más ramas y, con las mismas, de menos a más acero por metro (a igual acero, más separados). */
export function tablaCercos(b: number, recubrimiento: number): CercosViga[] {
  const ramas = RAMAS_CERCO.filter((r) => r === 2 || (b - 2 * recubrimiento - DIAMETROS_CERCO[0]) / (r - 1) >= SEPARACION_RAMAS);
  const tabla: CercosViga[] = [];
  for (const r of ramas) for (const diametro of DIAMETROS_CERCO) for (const separacion of SEPARACIONES_CERCO) tabla.push({ diametro, separacion, ...(r !== 2 ? { ramas: r } : {}) });
  return tabla
    .map((t, i) => ({ t, i, a: (ramasDe(t) * area(t.diametro)) / t.separacion }))
    .sort((p, q) => ramasDe(p.t) - ramasDe(q.t) || p.a - q.a || q.t.separacion - p.t.separacion || p.i - q.i)
    .map((x) => x.t);
}

/** Lo que se elige de cada tabla: la posición de cada armadura del vano. */
export interface PosicionesVano {
  inferior: number;
  superior: number;
  superiorInicio: number;
  superiorFin: number;
  cercos: number;
  cercosInicio: number;
  cercosFin: number;
  piel: number;
}

const GRUPOS = ["inferior", "superior", "superiorInicio", "superiorFin", "cercos", "cercosInicio", "cercosFin", "piel"] as const;
type Grupo = (typeof GRUPOS)[number];

/** El armado de unas posiciones: lo de los apoyos, sólo si difiere de lo corrido. */
export function armadoDe(p: PosicionesVano, barras: readonly BarrasCara[], cercos: readonly CercosViga[]): ArmadoVanoViga {
  return {
    inferior: barras[p.inferior]!,
    superior: barras[p.superior]!,
    ...(p.superiorInicio !== p.superior ? { superiorInicio: barras[p.superiorInicio]! } : {}),
    ...(p.superiorFin !== p.superior ? { superiorFin: barras[p.superiorFin]! } : {}),
    cercos: cercos[p.cercos]!,
    ...(p.cercosInicio !== p.cercos ? { cercosInicio: cercos[p.cercosInicio]! } : {}),
    ...(p.cercosFin !== p.cercos ? { cercosFin: cercos[p.cercosFin]! } : {}),
    ...(p.piel ? { piel: { n: p.piel, diametro: DIAMETRO_PIEL } } : {}),
  };
}

export interface PropuestaVano {
  /** null si ninguna combinación de las tablas pasa. */
  armado: ArmadoVanoViga | null;
  /** La comprobación del propuesto (o la del último probado, si no hay propuesta). */
  comprobacion: ComprobacionVano | null;
  /** La posición de cada armadura en su tabla. */
  posiciones?: PosicionesVano;
  /** Armados probados. */
  probados: number;
  /** Por qué no hay propuesta. */
  motivo?: string;
}

const falla = (c: ComprobacionVano): FilaViga | undefined => c.filas.find((f) => f.estado === "fail");
const rechazada = (c: ComprobacionVano) => c.pendientes.find((p) => p.motivo.startsWith("el módulo no admite"));

/** La superior de la zona de un apoyo, fijada (CO2-k). */
export type ZonasFijas = Partial<Record<"superiorInicio" | "superiorFin", BarrasCara>>;

export function proponerVano(d: DemandasViga, v: DemandasVano, datos?: DatosArmado, op: { fijas?: ZonasFijas } = {}): PropuestaVano {
  const g = geometriaViga(d);
  if ("motivo" in g) return { armado: null, comprobacion: null, probados: 0, motivo: g.motivo };
  const rec = armadoViga({ inferior: { n: 2, diametro: 12 }, superior: { n: 2, diametro: 12 }, cercos: { diametro: 6, separacion: 300 } }, datos).recubrimiento;
  const barras = tablaBarras(g.b, rec);
  const cercos = tablaCercos(g.b, rec);
  if (!barras.length) return { armado: null, comprobacion: null, probados: 0, motivo: `en el ancho de ${Math.round(g.b)} mm no caben dos barras con ese recubrimiento` };
  const limite: Record<Grupo, number> = { inferior: barras.length, superior: barras.length, superiorInicio: barras.length, superiorFin: barras.length, cercos: cercos.length, cercosInicio: cercos.length, cercosFin: cercos.length, piel: PIEL_MAXIMO + 1 };
  const p: PosicionesVano = { inferior: 0, superior: 0, superiorInicio: 0, superiorFin: 0, cercos: 0, cercosInicio: 0, cercosFin: 0, piel: 0 };
  // Las zonas fijas: su posición en la tabla, que no se mueve
  const fijas = new Set<Grupo>();
  for (const campo of ["superiorInicio", "superiorFin"] as const) {
    const T = op.fijas?.[campo];
    if (!T) continue;
    const k = barras.findIndex((b) => b.n === T.n && b.diametro === T.diametro);
    if (k < 0) return { armado: null, comprobacion: null, probados: 0, motivo: `la superior fijada ${T.n}Ø${T.diametro} no cabe en el ancho` };
    p[campo] = k;
    fijas.add(campo);
  }
  /** La corrida no pasa de una zona fija (la zona sería menor que lo corrido). */
  const topeSuperior = Math.min(barras.length, ...[...fijas].map((g) => p[g] + 1));
  let probados = 0;
  const probar = (x: PosicionesVano): ComprobacionVano => {
    probados++;
    return comprobarVano(d, v, armadoViga(armadoDe(x, barras, cercos), datos));
  };
  /** Lo de los apoyos no baja de lo corrido. */
  const ordenar = (x: PosicionesVano) => {
    if (!fijas.has("superiorInicio")) x.superiorInicio = Math.max(x.superiorInicio, x.superior);
    if (!fijas.has("superiorFin")) x.superiorFin = Math.max(x.superiorFin, x.superior);
    x.cercosInicio = Math.max(x.cercosInicio, x.cercos);
    x.cercosFin = Math.max(x.cercosFin, x.cercos);
  };
  let c = probar(p);
  // Subir: la armadura de la primera fila que falla, un puesto
  for (;;) {
    const r = rechazada(c);
    if (r) return { armado: null, comprobacion: c, probados, motivo: r.motivo };
    const f = falla(c);
    if (!f) break;
    const grupo: GrupoArmado = f.grupo;
    const tope = grupo === "seccion" ? 0 : fijas.has(grupo) ? p[grupo] + 1 : grupo === "superior" ? topeSuperior : limite[grupo];
    if (grupo === "seccion" || p[grupo] + 1 >= tope)
      return { armado: null, comprobacion: c, probados, motivo: `ningún armado de las tablas cumple «${f.descripcion}»${f.comb ? ` (${f.comb})` : ""}: la sección no basta` };
    p[grupo]++;
    ordenar(p);
    c = probar(p);
  }
  // Bajar: cada armadura, un puesto, mientras siga sin fallar nada
  for (let cambia = true; cambia; ) {
    cambia = false;
    for (const grupo of [...GRUPOS].reverse()) {
      if (p[grupo] === 0 || fijas.has(grupo)) continue;
      if ((grupo === "superiorInicio" || grupo === "superiorFin") && p[grupo] <= p.superior) continue;
      if ((grupo === "cercosInicio" || grupo === "cercosFin") && p[grupo] <= p.cercos) continue;
      const x = { ...p, [grupo]: p[grupo] - 1 };
      const cx = probar(x);
      if (falla(cx) || rechazada(cx)) continue;
      Object.assign(p, x);
      c = cx;
      cambia = true;
    }
  }
  return { armado: armadoDe(p, barras, cercos), comprobacion: c, posiciones: { ...p }, probados };
}

// ─── La misma armadura superior a los dos lados de un apoyo (CO2-k, §8.28) ─────────────────────────

/** Un vano visto desde un apoyo: su armado y el campo de la superior de la zona de ese apoyo. */
export interface LadoApoyo {
  armado: ArmadoVanoViga;
  campo: "superiorInicio" | "superiorFin";
  /**
   * Su armado se está proponiendo ahora (se puede cambiar): con qué se comprueba y la zona del otro
   * apoyo, si ya se igualó con su vecino (no se mueve). Sin él, es el del proyecto y no se toca.
   */
  libre?: { d: DemandasViga; v: DemandasVano; fijas?: ZonasFijas };
}

export interface LadoUnificado {
  armado: ArmadoVanoViga;
  comprobacion: ComprobacionVano;
}

/** Cuántas armaduras de la tabla se prueban, de menos a más acero, antes de dejar el apoyo como está. */
export const INTENTOS_UNIFICAR = 8;

const iguales = (a: BarrasCara, b: BarrasCara) => a.n === b.n && a.diametro === b.diametro;
const areaDe = (b: BarrasCara) => b.n * area(b.diametro);

/**
 * La armadura superior de un apoyo, la misma a sus dos lados: así pasa entera de un vano a otro en el
 * despiece, en vez de empalmarse sobre el apoyo. Cada vano se propone por su cuenta (`proponerVano`)
 * y a cada lado sale lo que pide el suyo; aquí los dos toman la mayor de las dos (la primera de la
 * tabla, de menos a más acero desde ella, con la que los dos siguen cumpliendo). Sólo sube acero.
 *
 * Si uno de los dos lados no se está proponiendo (lleva el armado del proyecto), no se toca: el otro
 * sube hasta la suya si es mayor y le cabe. Devuelve, por lado, su armado nuevo ya comprobado; null,
 * el que no cambia (también si no hay forma de igualarlos: secciones de anchos distintos en las que
 * no cabe la misma, o una regla que deja de cumplirse).
 */
export function unificarApoyo(izq: LadoApoyo, der: LadoApoyo, datos?: DatosArmado): [LadoUnificado | null, LadoUnificado | null] {
  const zona = (x: LadoApoyo) => x.armado[x.campo] ?? x.armado.superior;
  const [zi, zd] = [zona(izq), zona(der)];
  if (iguales(zi, zd) || (!izq.libre && !der.libre)) return [null, null];
  const tabla = (x: LadoApoyo): BarrasCara[] => {
    const g = x.libre && geometriaViga(x.libre.d);
    return g && !("motivo" in g) ? tablaBarras(g.b, armadoViga(x.armado, datos).recubrimiento) : [];
  };
  /**
   * El armado de un lado con T en su zona y su comprobación; null si no se puede. Primero, sólo esa
   * barra (sin el campo si es la corrida); si así falla alguna fila (con más diámetro baja el canto
   * útil y el cortante puede pasar por poco), se vuelve a proponer el vano con T fija en esa zona.
   */
  const con = (x: LadoApoyo, T: BarrasCara): LadoUnificado | null => {
    if (!x.libre) return null;
    const { [x.campo]: _zona, ...resto } = x.armado;
    const armado: ArmadoVanoViga = iguales(T, x.armado.superior) ? resto : { ...resto, [x.campo]: T };
    const comprobacion = comprobarVano(x.libre.d, x.libre.v, armadoViga(armado, datos));
    if (!falla(comprobacion) && !rechazada(comprobacion)) return { armado, comprobacion };
    const p = proponerVano(x.libre.d, x.libre.v, datos, { fijas: { ...x.libre.fijas, [x.campo]: T } });
    return p.armado && p.comprobacion && !falla(p.comprobacion) ? { armado: p.armado, comprobacion: p.comprobacion } : null;
  };
  const mayor = Math.max(areaDe(zi), areaDe(zd));
  if (izq.libre && der.libre) {
    const enDer = tabla(der);
    const candidatas = tabla(izq).filter((T) => areaDe(T) >= mayor - 1e-9 && enDer.some((y) => iguales(y, T)));
    for (const T of candidatas.slice(0, INTENTOS_UNIFICAR)) {
      // Un lado que ya tiene T no cambia (null); otro que no puede tomarla deja el apoyo como está
      const a = iguales(T, zi) ? null : con(izq, T);
      if (!iguales(T, zi) && !a) continue;
      const b = iguales(T, zd) ? null : con(der, T);
      if (!iguales(T, zd) && !b) continue;
      return [a, b];
    }
    return [null, null];
  }
  // Uno es del proyecto: el que se propone sube hasta la suya, si es mayor y le cabe
  const [libre, T] = izq.libre ? [izq, zd] : [der, zi];
  if (areaDe(T) <= areaDe(zona(libre)) + 1e-9 || !tabla(libre).some((y) => iguales(y, T))) return [null, null];
  const r = con(libre, T);
  return izq.libre ? [r, null] : [null, r];
}
