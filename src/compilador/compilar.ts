/**
 * Compilador: modelo físico → modelo analítico del motor (C1: barras; C2: losas; C3: muros). Plan,
 * reglas y decisiones por defecto en `docs/fem3d/compilador.md`.
 *
 * Pasos, cada uno con sus diagnósticos (si alguno deja un error, la compilación no sigue):
 * 1. Esquema, referencias y cotas (`validar.ts`).
 * 2. Topología por planta con dos tolerancias (`topologia.ts`).
 * 2b. Vértices de los muros ajustados (`muros.ts`) y viguetas de los paños unidireccionales, con
 *     sus nudos (`unidireccional.ts`, C4): son nudos de C1 más para las losas y los muros.
 * 2c. Losas y muros: arreglo plano, estaciones de los muros, malla y su unión con pilares
 *     (huellas), vigas, apoyos y cargas, y rejilla de los muros (`losas.ts`, `muros.ts`).
 * 3. Barras con zonas rígidas y excentricidades, apoyos y diafragmas (`piezas.ts`).
 * 4. Numeración canónica de los nudos: por cota, x e y; los maestros de diafragma al final.
 * 5. Cargas y peso propio (`cargas.ts`), con el control «sin pérdidas» por caso.
 * 6. Mapeo físico ↔ analítico (`mapeo.ts`) y huella.
 *
 * Es puro (sin DOM ni IO) y nunca lanza: un dato no válido es un diagnóstico, y cualquier otra
 * excepción acaba en `compilador/error-interno`.
 */
import { Diagnosticos, type Diagnostico } from "../motor/diagnosticos.ts";
import type { Apoyo, BarraAnalitica, CargaLamina, CasoCarga, LaminaAnalitica, ModeloAnalitico, NudoAnalitico, Restriccion, Vec3 } from "../motor/modelo.ts";
import { construirCargas, diferenciaResultantes, resultanteAnalitica, TOL_SIN_PERDIDAS } from "./cargas.ts";
import { resolverOpciones, type ModeloFisico, type OpcionesCompilacion, type OpcionesResueltas } from "./fisico.ts";
import { CUANTO_ORDEN } from "./geometria2d.ts";
import { huellaDe } from "./huella.ts";
import { construirLosas, direccionEje1, type Losas } from "./losas.ts";
import { VERSIONES_MALLADOR } from "./mallado.ts";
import type { Mapeo, NudoMapeado } from "./mapeo.ts";
import { ajustarMuros } from "./muros.ts";
import { construirPiezas, diafragmaDe, type BarraP, type Piezas } from "./piezas.ts";
import { construirTopologia, cotaNudo } from "./topologia.ts";
import { construirPanos, type PanosU } from "./unidireccional.ts";
import { ordenarPoligonos, validar, type Contexto } from "./validar.ts";
import type { Vec2 } from "./fisico.ts";
import type { ModificadoresBarra } from "../elementos/barra.ts";

/** Versión del compilador: entra en la huella, así que cambia cuando cambia su salida. */
export const VERSION_COMPILADOR = "C4.0";

export interface EstadisticasCompilacion {
  nudos: number;
  barras: number;
  /** Láminas de las losas (C2) y de los muros (C3). */
  laminas: number;
  /** Láminas de los muros (C3). */
  laminasMuros: number;
  diafragmas: number;
  /** Huellas de pilar en losa (enlaces rígidos, C2-d). */
  huellas: number;
  /**
   * Malla de las losas: jacobiano escalado mínimo, cuadriláteros bajo el umbral, láminas de la
   * rejilla alineada (H52) y plantillas de pilar.
   */
  malla: { jacobianoMin: number; bajos: number; laminasRejilla: number; plantillas: number };
  /** Muros (C3): relación de aspecto máxima de sus elementos, cuántos pasan de 4, y barras auxiliares (C3-e). */
  muros: { aspectoMax: number; altos: number; auxiliares: number };
  /**
   * Forjados (C4): paños unidireccionales, sus viguetas, los nudos que crean y las que sólo tienen un
   * apoyo; láminas de los ábacos de los reticulares.
   */
  forjados: { panos: number; viguetas: number; nudosViguetas: number; voladizos: number; laminasAbaco: number };
  /** Peor error relativo del control «sin pérdidas» entre los casos (regla 3 del plan). */
  sinPerdidas: { fuerzas: number; momentos: number };
  /** Milisegundos de cada paso. */
  tiempos: Record<string, number>;
}

export type ResultadoCompilacion =
  | {
      valido: true;
      modelo: ModeloAnalitico;
      mapeo: Mapeo;
      diagnosticos: Diagnostico[];
      /** Hipótesis de modelado aplicadas, en texto, para la memoria de cálculo. */
      hipotesis: string[];
      huella: string;
      estadisticas: EstadisticasCompilacion;
    }
  | { valido: false; diagnosticos: Diagnostico[]; huella: string };

/**
 * Huella de la compilación (H13): SHA-256 del modelo físico canónico, las opciones resueltas y la
 * versión del compilador. Es la clave para reutilizar un modelo analítico o sus resultados.
 *
 * Canónico: las listas cuyo orden no significa nada (materiales, secciones, pilares, vigas, apoyos
 * y cargas, y los tramos de cada pilar) van ordenadas por id; las plantas, los casos y los puntos
 * de las vigas conservan el suyo. Así la huella no cambia al reordenar, como el modelo analítico.
 */
export function huellaCompilacion(fisico: ModeloFisico, op: OpcionesResueltas): string {
  return huellaDe({ compilador: VERSION_COMPILADOR, mallador: VERSIONES_MALLADOR, fisico: fisicoCanonico(fisico), opciones: op });
}

function fisicoCanonico(f: ModeloFisico): unknown {
  if (typeof f !== "object" || f === null) return f;
  const clave = (x: unknown, campo = "id") => (typeof x === "object" && x !== null ? String((x as Record<string, unknown>)[campo]) : "");
  const ordenar = (v: unknown, campo = "id") => (Array.isArray(v) ? [...v].sort((a, b) => (clave(a, campo) < clave(b, campo) ? -1 : clave(a, campo) > clave(b, campo) ? 1 : 0)) : v);
  const r: Record<string, unknown> = { ...f };
  for (const k of ["materiales", "secciones", "vigas", "apoyos", "cargas", "losas", "apoyosLineales", "bandas", "muros", "panos"]) if (r[k] !== undefined) r[k] = ordenar(r[k]);
  // Los ábacos de un reticular, por su vértice menor (C4): su orden no significa nada
  if (Array.isArray(r.losas))
    r.losas = (r.losas as unknown[]).map((l) => {
      const ret = typeof l === "object" && l !== null ? (l as Record<string, unknown>).reticular : undefined;
      if (typeof ret !== "object" || ret === null || !Array.isArray((ret as Record<string, unknown>).abacos)) return l;
      const ab = (ret as Record<string, unknown>).abacos as unknown[];
      if (!ab.every((p) => Array.isArray(p) && p.length > 0 && p.every((q) => Array.isArray(q) && q.length === 2 && q.every((x) => typeof x === "number")))) return l;
      return { ...(l as object), reticular: { ...(ret as object), abacos: ordenarPoligonos(ab as Vec2[][]) } };
    });
  r.pilares = Array.isArray(f.pilares)
    ? (ordenar(f.pilares) as unknown[]).map((p) => (typeof p === "object" && p !== null && Array.isArray((p as Record<string, unknown>).tramos) ? { ...p, tramos: ordenar((p as Record<string, unknown>).tramos, "planta") } : p))
    : f.pilares;
  return r;
}

export function compilar(fisico: ModeloFisico, opciones: OpcionesCompilacion = {}): ResultadoCompilacion {
  let huella = "";
  try {
    const op = resolverOpciones(opciones);
    huella = huellaCompilacion(fisico, op);
    return compilarModelo(fisico, op, huella);
  } catch (e) {
    const texto = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return {
      valido: false,
      huella,
      diagnosticos: [
        {
          codigo: "compilador/error-interno",
          severidad: "error",
          mensaje: `El compilador no ha podido convertir el modelo (${texto}). Es un fallo del compilador: el modelo físico ya se había comprobado.`,
        },
      ],
    };
  }
}

const ahora = () => performance.now();

function compilarModelo(fisico: ModeloFisico, op: OpcionesResueltas, huella: string): ResultadoCompilacion {
  const diag = new Diagnosticos();
  const tiempos: Record<string, number> = {};
  let t0 = ahora();
  const marca = (fase: string) => {
    const t = ahora();
    tiempos[fase] = t - t0;
    t0 = t;
  };
  const fallo = (): ResultadoCompilacion => ({ valido: false, diagnosticos: diag.lista, huella });

  const ctx = validar(fisico, op, diag);
  marca("validacion");
  if (!ctx) return fallo();
  const topo = construirTopologia(ctx, diag);
  marca("topologia");
  if (diag.hayErrores) return fallo();
  // Muros ajustados antes que las viguetas, para que sus nudos no los muevan (C4)
  const puntosMuros = ctx.muros.length ? ajustarMuros(ctx, topo, diag) : [];
  if (!puntosMuros || diag.hayErrores) return fallo();
  const panos = construirPanos(ctx, topo, puntosMuros, diag);
  marca("panos");
  if (diag.hayErrores) return fallo();
  const losas = construirLosas(ctx, topo, ctx.cargas, diag, puntosMuros, panos);
  marca("losas");
  if (diag.hayErrores) return fallo();
  const piezas = construirPiezas(ctx, topo, losas, diag, panos);
  marca("piezas");
  if (diag.hayErrores) return fallo();

  // Numeración canónica: por cota, x e y (no depende del orden de la entrada)
  const zDe = (n: number) => cotaNudo(ctx, topo.nudos[n]!);
  // Por coordenadas cuantizadas a CUANTO_ORDEN y luego por orden de creación: dos nudos con la misma
  // x salvo un ulp (el seno de un giro difiere entre V8 y JSC, COM-12) se ordenan por su y en los
  // dos motores, y dos en el mismo sitio (la base de un pilar y la de un muro) no cambian de orden
  // por un ulp al trasladar o girar la planta
  const qx = (n: number) => Math.round(topo.nudos[n]!.x / CUANTO_ORDEN);
  const qy = (n: number) => Math.round(topo.nudos[n]!.y / CUANTO_ORDEN);
  const orden = topo.nudos
    .map((_, i) => i)
    .sort((a, b) => zDe(a) - zDe(b) || qx(a) - qx(b) || qy(a) - qy(b) || a - b);
  const nuevo = new Int32Array(topo.nudos.length);
  orden.forEach((n, i) => (nuevo[n] = i));
  const nudos: NudoAnalitico[] = [];
  const mapNudos: NudoMapeado[] = [];
  const usados = new Map<string, number>();
  const idUnico = (base: string) => {
    const k = usados.get(base) ?? 0;
    usados.set(base, k + 1);
    return k === 0 ? base : `${base}#${k + 1}`;
  };
  for (const n of orden) {
    const nd = topo.nudos[n]!;
    const planta = ctx.plantas[nd.k]!.id;
    nudos.push({ id: idUnico(`${planta}:${nd.x.toFixed(3)},${nd.y.toFixed(3)}`), x: nd.x, y: nd.y, z: zDe(n) });
    mapNudos.push({ fisicos: [...nd.fisicos].sort(), planta });
  }
  // Maestros de diafragma: en el centro de los nudos de su planta (sumados en orden canónico)
  const restricciones: Restriccion[] = [];
  const mapRestr: { planta: string; pilar?: string; viga?: string }[] = [];
  for (const d of [...piezas.diafragmas].sort((a, b) => ctx.cotas[a.k]! - ctx.cotas[b.k]!)) {
    const esclavos = d.nudos.map((n) => nuevo[n]!).sort((a, b) => a - b);
    let sx = 0;
    let sy = 0;
    for (const n of esclavos) {
      sx += nudos[n]!.x;
      sy += nudos[n]!.y;
    }
    const planta = ctx.plantas[d.k]!.id;
    nudos.push({ id: `${planta}:maestro`, x: sx / esclavos.length, y: sy / esclavos.length, z: ctx.cotas[d.k]! });
    mapNudos.push({ fisicos: [], planta, maestro: true });
    restricciones.push({ tipo: "diafragma", id: `${planta}:diafragma`, maestro: nudos.length - 1, esclavos });
    mapRestr.push({ planta });
  }
  // Huellas de los pilares en las losas (C2-d): enlace rígido con maestro en el nudo del pilar
  for (const h of [...losas.huellas].sort((a, b) => ctx.cotas[a.k]! - ctx.cotas[b.k]! || (a.pilar < b.pilar ? -1 : a.pilar > b.pilar ? 1 : 0))) {
    const planta = ctx.plantas[h.k]!.id;
    restricciones.push({ tipo: "enlace-rigido", id: `${h.pilar}@${planta}:huella`, maestro: nuevo[h.maestro]!, esclavos: h.esclavos.map((n) => nuevo[n]!).sort((a, b) => a - b) });
    mapRestr.push({ planta, pilar: h.pilar });
  }
  // Huellas de las vigas que acaban en un muro fuera de su plano (C3-i)
  for (const h of [...losas.huellasVigas].sort((a, b) => ctx.cotas[a.k]! - ctx.cotas[b.k]! || nuevo[a.maestro]! - nuevo[b.maestro]!)) {
    const planta = ctx.plantas[h.k]!.id;
    restricciones.push({ tipo: "enlace-rigido", id: `${h.viga}@${planta}:huella-muro`, maestro: nuevo[h.maestro]!, esclavos: h.esclavos.map((n) => nuevo[n]!).sort((a, b) => a - b) });
    mapRestr.push({ planta, viga: h.viga });
  }
  // Láminas (C2), ya en orden canónico; su id, la losa y el orden dentro de ella
  const cuenta = new Map<string, number>();
  const laminas: LaminaAnalitica[] = losas.laminas.map((l) => {
    const lc = ctx.losas[l.losa]!;
    const k = (cuenta.get(lc.losa.id) ?? 0) + 1;
    cuenta.set(lc.losa.id, k);
    const [ex, ey] = direccionEje1(lc.losa.eje1 ?? 0);
    const r: LaminaAnalitica = { id: `${lc.losa.id}:${k}`, nudos: l.nudos.map((n) => nuevo[n]!) as unknown as LaminaAnalitica["nudos"], material: lc.material, eje1: [ex, ey, 0] };
    // Zona aligerada de un reticular (C4-h): sus multiplicadores y su ν
    const ret = lc.reticular;
    if (ret && !l.abaco) return { ...r, material: { ...lc.material, nu: ret.nu }, multiplicadores: ret.multiplicadores };
    return r;
  });
  // Láminas de los muros (C3), tras las de las losas: eje 1 horizontal a lo largo del tramo
  for (const lm of losas.muros) {
    const mw = ctx.muros[lm.w]!;
    const k = (cuenta.get(mw.muro.id) ?? 0) + 1;
    cuenta.set(mw.muro.id, k);
    laminas.push({ id: `${mw.muro.id}:${k}`, nudos: lm.nudos.map((n) => nuevo[n]!) as unknown as LaminaAnalitica["nudos"], material: mw.material, eje1: [lm.eje1[0], lm.eje1[1], 0] });
  }

  // Barras con offsets (del nudo al extremo del tramo flexible)
  const offset = (p: Vec3, n: number): Vec3 | undefined => {
    const X = nudos[nuevo[n]!]!;
    const d: Vec3 = [p[0] - X.x, p[1] - X.y, p[2] - X.z];
    return d[0] === 0 && d[1] === 0 && d[2] === 0 ? undefined : d;
  };
  // Modificadores de rigidez (D4): los de todos los materiales y, encima, los del material de la barra
  const modificadoresDe = (b: BarraP): ModificadoresBarra | undefined => {
    const g = op.modificadores[b.tipo === "pilar" ? "pilares" : b.tipo === "vigueta" ? "viguetas" : "vigas"];
    const m: ModificadoresBarra = { ...g?.todos, ...g?.[b.material] };
    return Object.keys(m).length ? m : undefined;
  };
  const barras: BarraAnalitica[] = piezas.barras.map((b) => {
    const r: BarraAnalitica = { id: b.id, nudos: [nuevo[b.i]!, nuevo[b.j]!], seccion: b.seccion, vz: b.vz };
    const di = offset(b.ip, b.i);
    const dj = offset(b.jp, b.j);
    if (di || dj) r.offsets = { ...(di ? { i: di } : {}), ...(dj ? { j: dj } : {}) };
    if (b.liberaciones) r.liberaciones = b.liberaciones;
    const m = modificadoresDe(b);
    if (m) r.modificadores = m;
    return r;
  });
  const apoyos: Apoyo[] = [...piezas.apoyos]
    .map(([n, c]) => ({ nudo: nuevo[n]!, coartados: c as unknown as Apoyo["coartados"] }))
    .sort((a, b) => a.nudo - b.nudo);
  marca("numeracion");

  // Cargas, respecto al centro del modelo
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const n of nudos) {
    [n.x, n.y, n.z].forEach((v, c) => {
      min[c] = Math.min(min[c]!, v);
      max[c] = Math.max(max[c]!, v);
    });
  }
  const centro: Vec3 = nudos.length ? [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2] : [0, 0, 0];
  const cargas = construirCargas(ctx, topo, piezas, losas, centro, diag, panos);
  marca("cargas");
  if (diag.hayErrores) return fallo();
  const casos: CasoCarga[] = ctx.casos.map((c, k) => {
    const cc = cargas.casos[k]!;
    const nodales = [...cc.nodales]
      .map(([n, f]) => ({ nudo: nuevo[n]!, f: f as unknown as readonly [number, number, number, number, number, number] }))
      .sort((a, b) => a.nudo - b.nudo);
    const enLaminas: CargaLamina[] = [
      ...[...cc.laminas].map(([l, q]): [number, CargaLamina] => [l, { tipo: "superficie", lamina: l, ejes: "global", q: [q[0]!, q[1]!, q[2]!] }]),
      ...[...cc.laminasNodos].map(([l, q]): [number, CargaLamina] => [l, { tipo: "superficie", lamina: l, ejes: "global", q: q.map((v) => [v[0]!, v[1]!, v[2]!] as const) as unknown as readonly [Vec3, Vec3, Vec3, Vec3] }]),
    ]
      .sort((a, b) => a[0] - b[0])
      .map(([, cl]) => cl);
    return { id: c.id, ...(nodales.length ? { nodales } : {}), ...(cc.barras.length ? { barras: cc.barras } : {}), ...(enLaminas.length ? { laminas: enLaminas } : {}) };
  });
  const modelo: ModeloAnalitico = { nudos, barras, ...(laminas.length ? { laminas } : {}), apoyos, restricciones, casos };

  // Sin pérdidas: resultante física = analítica, por caso
  const sinPerdidas = { fuerzas: 0, momentos: 0 };
  ctx.casos.forEach((c, k) => {
    const err = diferenciaResultantes(cargas.fisicas[k]!, resultanteAnalitica(modelo, k, centro));
    sinPerdidas.fuerzas = Math.max(sinPerdidas.fuerzas, err.fuerzas);
    sinPerdidas.momentos = Math.max(sinPerdidas.momentos, err.momentos);
    if (err.fuerzas > TOL_SIN_PERDIDAS || err.momentos > TOL_SIN_PERDIDAS) {
      diag.error(
        "cargas/perdidas",
        `En el caso ${c.id}, las cargas analíticas no reproducen las físicas: error relativo ${err.fuerzas.toExponential(2)} en fuerzas y ${err.momentos.toExponential(2)} en momentos (tolerancia ${TOL_SIN_PERDIDAS}). Es un fallo del compilador.`,
        [c.id],
        err,
      );
    }
  });
  marca("sinPerdidas");
  if (diag.hayErrores) return fallo();

  const piezasMap: Record<string, number[]> = {};
  piezas.barras.forEach((b, i) => !b.auxiliar && (piezasMap[b.pieza] ??= []).push(i));
  const panoDeVigueta = new Map(panos.viguetas.map((v) => [v.id, ctx.panos[v.pano]!.pano.id] as const));
  const nudosPilar: Record<string, number> = {};
  for (const [clave, n] of topo.nudoPilar) {
    const at = clave.lastIndexOf("@");
    nudosPilar[`${clave.slice(0, at)}@${ctx.plantas[Number(clave.slice(at + 1))]!.id}`] = nuevo[n]!;
  }
  const apoyosMap: Record<string, number> = {};
  for (const [id, n] of topo.apoyoEn) apoyosMap[id] = nuevo[n]!;
  for (const [id, n] of losas.apoyosPuntuales) apoyosMap[id] = nuevo[n]!;
  const mapeo: Mapeo = {
    nudos: mapNudos,
    barras: piezas.barras.map((b) => ({
      pieza: b.pieza,
      tipo: b.tipo,
      tramo: b.tramo,
      s: b.s,
      ...(b.auxiliar ? { auxiliar: true as const } : {}),
      ...(b.tipo === "vigueta" ? { pano: panoDeVigueta.get(b.pieza)! } : {}),
    })),
    restricciones: mapRestr,
    piezas: piezasMap,
    nudosPilar,
    apoyos: apoyosMap,
  };
  if (panos.viguetas.length) {
    const porPano: Record<string, string[]> = {};
    ctx.panos.forEach((p, i) => panos.porPano[i]!.length && (porPano[p.pano.id] = panos.porPano[i]!.map((v) => panos.viguetas[v]!.id)));
    mapeo.panos = porPano;
  }
  if (laminas.length) {
    mapeo.laminas = [...losas.laminas.map((l) => ({ losa: ctx.losas[l.losa]!.losa.id, ...(l.abaco ? { abaco: true as const } : {}) })), ...losas.muros.map((lm) => ({ muro: ctx.muros[lm.w]!.muro.id }))];
    if (losas.laminas.length) {
      const porLosa: Record<string, number[]> = {};
      losas.laminas.forEach((l, i) => (porLosa[ctx.losas[l.losa]!.losa.id] ??= []).push(i));
      mapeo.losas = porLosa;
    }
    if (losas.muros.length) {
      const porMuro: Record<string, number[]> = {};
      losas.muros.forEach((lm, i) => (porMuro[ctx.muros[lm.w]!.muro.id] ??= []).push(losas.laminas.length + i));
      mapeo.muros = porMuro;
    }
  }
  marca("mapeo");
  return {
    valido: true,
    modelo,
    mapeo,
    diagnosticos: diag.lista,
    hipotesis: hipotesis(ctx, op, piezas, losas, panos, modificadoresDe),
    huella,
    estadisticas: {
      nudos: nudos.length,
      barras: barras.length,
      laminas: laminas.length,
      diafragmas: piezas.diafragmas.length,
      huellas: losas.huellas.length,
      malla: { jacobianoMin: losas.malla.jacobianoMin, bajos: losas.malla.bajos, laminasRejilla: losas.malla.laminasRejilla, plantillas: losas.malla.plantillas },
      laminasMuros: losas.muros.length,
      muros: { aspectoMax: losas.aspectoMuros.max, altos: losas.aspectoMuros.altos, auxiliares: piezas.barras.filter((b) => b.auxiliar).length },
      forjados: { panos: ctx.panos.length, viguetas: panos.viguetas.length, nudosViguetas: panos.nudosNuevos, voladizos: panos.voladizos, laminasAbaco: losas.laminas.filter((l) => l.abaco).length },
      sinPerdidas,
      tiempos,
    },
  };
}

const coma = (x: number) => String(x).replace(".", ",");
const NOMBRE_MATERIAL = { hormigon: "de hormigón", acero: "de acero", general: "de material general" } as const;

/** Las hipótesis de modelado de una compilación, en texto (C1-a, C1-c, C1-d, D4, C2, C3 y C4). */
function hipotesis(ctx: Contexto, op: OpcionesResueltas, piezas: Piezas, losas: Losas, panos: PanosU, modificadoresDe: (b: BarraP) => ModificadoresBarra | undefined): string[] {
  const h: string[] = [];
  h.push(
    `Nudos de dimensión finita: es rígido ${op.factorZonaRigida === 1 ? "todo el nudo" : op.factorZonaRigida === 0 ? "ningún tramo del nudo (de eje a eje)" : `el ${coma(op.factorZonaRigida * 100)} % del nudo`} (la viga dentro del pilar y el pilar dentro del canto de la viga más alta que le llega).`,
  );
  const grupos = new Map<string, number>();
  for (const b of piezas.barras) {
    const m = modificadoresDe(b);
    if (!m) continue;
    const clave = `${b.tipo === "pilar" ? "tramos de pilar" : b.tipo === "vigueta" ? "viguetas" : "tramos de viga"} ${NOMBRE_MATERIAL[b.material]}: ${Object.entries(m)
      .map(([k, x]) => `${k} ×${coma(x!)}`)
      .join(", ")}`;
    grupos.set(clave, (grupos.get(clave) ?? 0) + 1);
  }
  if (grupos.size) h.push(`Modificadores de rigidez (D4): ${[...grupos].map(([k, n]) => `${k} (${n})`).join("; ")}.`);
  else h.push("Sin modificadores de rigidez.");
  const usadas = new Set<string>([...ctx.vigas.map((v) => v.planta), ...ctx.losas.map((l) => l.losa.planta), ...ctx.panos.map((p) => p.pano.planta)]);
  for (const p of ctx.pilares) for (let k = ctx.planta.get(p.hasta)!; k <= ctx.planta.get(p.desde)!; k++) usadas.add(ctx.plantas[k]!.id);
  const conLosa = new Set(ctx.losas.map((l) => l.losa.planta));
  const conPano = new Set(ctx.panos.map((p) => p.pano.planta));
  const conDiafragma = [...new Set(piezas.diafragmas.map((d) => ctx.plantas[d.k]!.id))];
  const sin = ctx.plantas.filter((p, k) => usadas.has(p.id) && diafragmaDe(ctx, k) !== "rigido").map((p) => (conLosa.has(p.id) ? `${p.id} (semirrígido: la membrana de sus losas)` : p.id));
  h.push(`Diafragma rígido en ${conDiafragma.length ? conDiafragma.join(", ") : "ninguna planta"}${sin.length ? `; sin diafragma en ${sin.join(", ")}` : ""}.`);
  if (conDiafragma.some((p) => conLosa.has(p) || conPano.has(p)))
    h.push(
      `En las plantas con ${conPano.size ? "losas o paños unidireccionales" : "losas"}, el diafragma rígido abarca los nudos sobre ${conPano.size ? "ellos" : "las losas"} (los de las huellas, por su pilar); los que quedan fuera, como los pilares de una doble altura, no entran (C2-f${conPano.size ? ", C4-g" : ""}).`,
    );
  const superiores = ctx.vigas.filter((v) => v.insercion === "superior").map((v) => v.id);
  h.push(superiores.length ? `Eje de las vigas en el plano del forjado, salvo ${superiores.join(", ")} (bajo él, con la cara superior en el forjado).` : "Eje de las vigas en el plano del forjado.");
  if (ctx.losas.length) {
    const enRejilla = losas.malla.laminasRejilla;
    h.push(
      op.rejilla
        ? `Losas malladas con láminas DKMQ (h = ${coma(op.tamanoMalla)} m; ${losas.laminas.length} láminas; jacobiano escalado mínimo ${coma(Number(losas.malla.jacobianoMin.toFixed(3)))}): rejilla alineada con los ejes de la losa en las zonas regulares, con cuadriláteros de ≤ ${coma(op.tamanoMalla)} m y ${losas.malla.plantillas} plantillas de pilar (${enRejilla} láminas, el ${coma(Number(((100 * enRejilla) / Math.max(1, losas.laminas.length)).toFixed(0)))} %), y triangulación restringida de lado ${coma(2 * op.tamanoMalla)} m dividida en 3 cuadriláteros alrededor de lo que no cae en ella (H52, C2-a).`
        : `Losas malladas con láminas DKMQ: triangulación restringida de lado ${coma(2 * op.tamanoMalla)} m dividida en 3 cuadriláteros (h = ${coma(op.tamanoMalla)} m; ${losas.laminas.length} láminas; jacobiano escalado mínimo ${coma(Number(losas.malla.jacobianoMin.toFixed(3)))}).`,
    );
    h.push(
      `Unión pilar–losa por la huella del pilar, rígida (${losas.huellas.length} huellas, H09). Las vigas embebidas se parten en los nudos de la malla sobre su eje fuera de las huellas, y la zona rígida de la cabeza de los pilares cuenta el espesor de la losa.`,
    );
    h.push(
      `Peso propio de las losas desde su pp (${ctx.losas.map((l) => (l.reticular && l.reticular.ppAbaco !== l.reticular.ppAligerada ? `${l.losa.id}: ${coma(Number(l.pp.toFixed(3)))} kN/m² en la zona aligerada y ${coma(Number(l.reticular.ppAbaco.toFixed(3)))} en los ábacos` : `${l.losa.id}: ${coma(Number(l.pp.toFixed(3)))} kN/m²`)).join("; ")}). Las vigas rectangulares de hormigón bajo losa pesan sólo su descuelgue (C2-g, H24).`,
    );
    for (const l of ctx.losas) {
      const r = l.reticular;
      if (!r) continue;
      const m = r.multiplicadores;
      const f = (x: number | undefined) => coma(Number((x ?? 1).toFixed(4)));
      const nr = l.losa.reticular!;
      h.push(
        r.dados
          ? `Forjado reticular ${l.losa.id}: zona aligerada con los multiplicadores dados por el usuario sobre la losa maciza de ${coma(l.material.t)} m, con el ν del material (C4-h): f11 ${f(m.f11)}, f22 ${f(m.f22)}, f12 ${f(m.f12)}, m11 ${f(m.m11)}, m22 ${f(m.m22)}, m12 ${f(m.m12)}, v13 ${f(m.v13)}, v23 ${f(m.v23)}; ${r.abacos.length} ábacos macizos.`
          : `Forjado reticular ${l.losa.id} (nervios de ${coma(nr.nervio)} m cada ${coma(nr.intereje)} m, capa de ${coma(nr.capa)} m y canto total ${coma(l.material.t)} m): la zona aligerada es una lámina maciza con los multiplicadores del emparrillado de nervios, sin efecto Poisson (ν = 0) y con el G del hormigón (C4-h): f11 = f22 ${f(m.f11)}, f12 ${f(m.f12)}, m11 = m22 ${f(m.m11)}, m12 ${f(m.m12)}, v13 = v23 ${f(m.v13)}; ${r.abacos.length} ábacos macizos.`,
      );
    }
  }
  if (ctx.muros.length) {
    const aux = piezas.barras.filter((b) => b.auxiliar).length;
    h.push(
      `Muros mallados con láminas DKMQ con membrana con drilling en rejilla por paño: columnas en las estaciones de su eje (las mismas en todas sus plantas) y en sus puntos medios, a ~${coma(op.tamanoMalla)} m y con al menos 8 elementos por tramo recto (H17), y filas a ≤ ${coma(op.tamanoMalla)} m (${losas.muros.length} láminas; relación de aspecto máxima ${coma(Number(losas.aspectoMuros.max.toFixed(2)))}).`,
    );
    h.push(
      "Encuentros de los muros: comparten los nudos de sus aristas con los otros muros y con las losas (a ejes); en la cota de una planta, los nudos del muro en la huella de un pilar van con su enlace rígido, y entre plantas el pilar y el muro no se unen. Los nudos del muro en la cota de una planta entran en el diafragma con la misma regla que el resto, también los de lo alto de los dinteles (C3-d).",
    );
    h.push(
      `Las vigas que corren por el eje de un muro se parten en sus nudos${aux ? `; las que acaban en el extremo de un muro en su plano se prolongan dentro con ${aux} barras auxiliares de su sección a lo largo de su canto (C3-e, H05)` : ""}. Las vigas perpendiculares que acaban en un muro se unen a él por su huella: los nudos del muro a lo largo de su canto y de su ancho van con su extremo en un enlace rígido (C3-i).`,
    );
    h.push("Peso propio de los muros: γ·t por m² de alzado sin huecos, de forjado a forjado, menos el solape con las losas (C3-g).");
  }
  if (panos.viguetas.length) {
    const lista = ctx.panos
      .map((p, i) => `${p.pano.id}: ${panos.porPano[i]!.length} viguetas de ${p.pano.seccion} cada ${coma(p.pano.intereje)} m a ${coma(Number((((Math.atan2(panos.marcos[i]!.d[1], panos.marcos[i]!.d[0]) * 180) / Math.PI + 180) % 180).toFixed(2)))}°, pp ${coma(p.pano.pp)} kN/m²`)
      .join("; ");
    h.push(
      `Forjados unidireccionales como viguetas-barra (D2; ${lista}). Las viguetas de los paños contiguos con la misma dirección e intereje siguen las mismas rectas, centradas en su ancho, y son continuas sobre sus apoyos comunes (C4-a). Cada vigueta va de apoyo a apoyo (vigas, muros, pilares y bordes de losa), sin nudos intermedios y con la torsión liberada en un extremo; las de un voladizo la conservan (C4-c, E2-3).`,
    );
    h.push(
      "Cargas de los paños (su pp, de superficie, lineales y puntuales): a las viguetas por la regla de la palanca en la dirección transversal, y a las vigas de los lados paralelos a ellas la franja entre la última vigueta y la viga; la franja junto a un borde sin viga va a la última vigueta con su momento de transporte (C4-e). Las vigas bajo un paño pesan sólo su descuelgue (C2-g con el canto de la vigueta).",
    );
  }
  return h;
}
