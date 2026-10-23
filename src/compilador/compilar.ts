/**
 * Compilador: modelo físico → modelo analítico del motor (C1: barras; C2: losas; C3: muros). Plan,
 * reglas y decisiones por defecto en `docs/fem3d/compilador.md`.
 *
 * Pasos, cada uno con sus diagnósticos (si alguno deja un error, la compilación no sigue):
 * 1. Campos desconocidos (`campos.ts`, A-1); esquema, referencias y cotas (`validar.ts`).
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
import { anchoUnion } from "./anchosVigas.ts";
import { avisarApoyosBandas } from "./bandas.ts";
import { camposDesconocidos } from "./campos.ts";
import { construirCargas, diferenciaResultantes, resultanteAnalitica, TOL_SIN_PERDIDAS } from "./cargas.ts";
import { resolverOpciones, type ModeloFisico, type OpcionesCompilacion, type OpcionesResueltas } from "./fisico.ts";
import { CUANTO_ORDEN } from "./geometria2d.ts";
import { huellaDe } from "./huella.ts";
import { construirLosas, direccionEje1, type Losas } from "./losas.ts";
import { VERSIONES_MALLADOR } from "./mallado.ts";
import type { Mapeo, NudoMapeado } from "./mapeo.ts";
import { ajustarMuros } from "./muros.ts";
import { barrasTorsionEquilibrio, construirPiezas, diafragmaDe, type BarraP, type Piezas } from "./piezas.ts";
import { conPuntoFijo } from "./puntoFijo.ts";
import { construirTopologia, cotaNudo, ejeTramo } from "./topologia.ts";
import { construirPanos, type PanosU } from "./unidireccional.ts";
import { ordenarPoligonos, validar, type Contexto } from "./validar.ts";
import type { Vec2 } from "./fisico.ts";
import type { ModificadoresBarra } from "../elementos/barra.ts";
import { puntoEnRegion } from "./poligonos.ts";

/** Versión del compilador: entra en la huella, así que cambia cuando cambia su salida. */
export const VERSION_COMPILADOR = "RV2";

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
  /** Enlaces rígidos de las caras de las vigas con su eje (fase LV) y nudos de la losa que unen. */
  enlacesVigas: { enlaces: number; nudos: number };
  /**
   * Malla de las losas: jacobiano escalado mínimo, cuadriláteros bajo el umbral, láminas de la
   * rejilla alineada (H52) y plantillas de pilar.
   */
  /** `plantillasRefinadas`: las de pilares con las caras refinadas (F2). */
  malla: { jacobianoMin: number; bajos: number; laminasRejilla: number; plantillas: number; plantillasRefinadas: number };
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
 * Los ejes de replanteo no entran: son sólo del dibujo.
 */
export function huellaCompilacion(fisico: ModeloFisico, op: OpcionesResueltas): string {
  return huellaDe({ compilador: VERSION_COMPILADOR, mallador: VERSIONES_MALLADOR, fisico: fisicoCanonico(fisico), opciones: op });
}

function fisicoCanonico(f: ModeloFisico): unknown {
  if (typeof f !== "object" || f === null) return f;
  const clave = (x: unknown, campo = "id") => (typeof x === "object" && x !== null ? String((x as Record<string, unknown>)[campo]) : "");
  const ordenar = (v: unknown, campo = "id") => (Array.isArray(v) ? [...v].sort((a, b) => (clave(a, campo) < clave(b, campo) ? -1 : clave(a, campo) > clave(b, campo) ? 1 : 0)) : v);
  const r: Record<string, unknown> = { ...f };
  // Los ejes de replanteo son sólo del dibujo (I2): no cambian el modelo analítico
  delete r.ejes;
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

/**
 * La huella que dará `compilar` con estos datos, sin compilar: "" si las opciones no se pueden
 * resolver, como en `compilar`. El visor la usa mientras compila (lo que sólo necesita el modelo
 * físico se dibuja antes).
 */
export function huellaSinCompilar(fisico: ModeloFisico, opciones: OpcionesCompilacion = {}): string {
  try {
    return huellaCompilacion(fisico, resolverOpciones(opciones));
  } catch {
    return "";
  }
}

export function compilar(fisico: ModeloFisico, opciones: OpcionesCompilacion = {}): ResultadoCompilacion {
  let huella = "";
  try {
    const op = resolverOpciones(opciones);
    huella = huellaCompilacion(fisico, op);
    return compilarModelo(fisico, op, huella, opciones);
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

function compilarModelo(fisico: ModeloFisico, op: OpcionesResueltas, huella: string, opciones: OpcionesCompilacion): ResultadoCompilacion {
  const diag = new Diagnosticos();
  const tiempos: Record<string, number> = {};
  let t0 = ahora();
  const marca = (fase: string) => {
    const t = ahora();
    tiempos[fase] = t - t0;
    t0 = t;
  };
  const fallo = (): ResultadoCompilacion => ({ valido: false, diagnosticos: diag.lista, huella });

  camposDesconocidos(fisico, opciones, diag);
  const ctx = validar(fisico, op, diag);
  marca("validacion");
  if (!ctx || diag.hayErrores) return fallo();
  avisarApoyosBandas(ctx, diag);
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
  avisarDintelesEnDiafragma(ctx, diag);

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
  // Caras de las vigas (fase LV): los nudos de la losa en ellas, con maestro en su eje
  const cuentaEnlace = new Map<string, number>();
  for (const h of [...losas.enlacesVigas].sort((a, b) => ctx.cotas[a.k]! - ctx.cotas[b.k]! || nuevo[a.maestro]! - nuevo[b.maestro]!)) {
    const planta = ctx.plantas[h.k]!.id;
    const base = `${h.viga}@${planta}:cara`;
    const i = (cuentaEnlace.get(base) ?? 0) + 1;
    cuentaEnlace.set(base, i);
    restricciones.push({ tipo: "enlace-rigido", id: `${base}${i}`, maestro: nuevo[h.maestro]!, esclavos: h.esclavos.map((n) => nuevo[n]!).sort((a, b) => a - b) });
    mapRestr.push({ planta, viga: h.viga });
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
    // Ábaco de un reticular «uniforme» (CY3)
    if (ret?.abaco && l.abaco) return { ...r, material: { ...lc.material, nu: ret.abaco.nu }, multiplicadores: ret.abaco.multiplicadores };
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
  // Modificadores de rigidez (D4): los de todos los materiales y, encima, los del material de la barra.
  // En los tramos con torsión de equilibrio (C4-k), la torsión no se reduce
  const equilibrio = new Set([...(op.torsionEquilibrio ? barrasTorsionEquilibrio(ctx, topo, piezas, panos) : [])].map((i) => piezas.barras[i]!));
  // RV-a: la flexión de las vigas planas en un reticular «uniforme»
  const planas = op.rigidezVigasPlanas < 1 ? vigasPlanasEnReticular(ctx, losas, piezas) : new Set<BarraP>();
  const modificadoresDe = (b: BarraP): ModificadoresBarra | undefined => {
    const g = op.modificadores[b.tipo === "pilar" ? "pilares" : b.tipo === "vigueta" ? "viguetas" : "vigas"];
    const m: ModificadoresBarra = { ...g?.todos, ...g?.[b.material] };
    if (equilibrio.has(b) && m.J !== undefined && m.J < 1) delete m.J;
    if (planas.has(b)) m.Iy = (m.Iy ?? 1) * op.rigidezVigasPlanas;
    return Object.keys(m).length ? m : undefined;
  };
  const barras: BarraAnalitica[] = piezas.barras.map((b) => {
    const r: BarraAnalitica = { id: b.id, nudos: [nuevo[b.i]!, nuevo[b.j]!], seccion: b.seccion, vz: b.vz };
    const di = offset(b.ip, b.i);
    const dj = offset(b.jp, b.j);
    if (di || dj) r.offsets = { ...(di ? { i: di } : {}), ...(dj ? { j: dj } : {}) };
    if (b.liberaciones) r.liberaciones = b.liberaciones;
    if (b.empotramiento) r.empotramiento = b.empotramiento;
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
      ...(equilibrio.has(b) ? { torsionEquilibrio: true as const } : {}),
    })),
    restricciones: mapRestr,
    piezas: piezasMap,
    nudosPilar,
    apoyos: apoyosMap,
  };
  const enVigas = [...losas.apoyosAViga].filter(([id, x]) => x.nudos.length && ctx.apoyosLineales.some((y) => y.id === id));
  if (enVigas.length) mapeo.apoyosEnVigas = Object.fromEntries(enVigas.map(([id, x]) => [id, x.nudos.map((n) => nuevo[n]!).sort((p, q) => p - q)]));
  if (losas.anchos.length) mapeo.anchos = losas.anchos.map((a) => ({ viga: a.viga, planta: ctx.plantas[a.k]!.id, b: a.b, poligono: a.poligono.map((q) => [q[0], q[1]]) }));
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
    hipotesis: hipotesis(ctx, op, piezas, losas, panos, modificadoresDe, equilibrio, barras.some((b) => b.offsets), cargas.alDiafragma, planas),
    huella,
    estadisticas: {
      nudos: nudos.length,
      barras: barras.length,
      laminas: laminas.length,
      diafragmas: piezas.diafragmas.length,
      huellas: losas.huellas.length,
      enlacesVigas: { enlaces: losas.enlacesVigas.length, nudos: losas.enlacesVigas.reduce((a, x) => a + x.esclavos.length, 0) },
      malla: { jacobianoMin: losas.malla.jacobianoMin, bajos: losas.malla.bajos, laminasRejilla: losas.malla.laminasRejilla, plantillas: losas.malla.plantillas, plantillasRefinadas: losas.malla.plantillasRefinadas },
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
/** Luz mínima de un dintel para el aviso de C3-d, m: con 1,5 m, el diafragma ya rigidiza un 7 % (E6-3). */
export const LUZ_DINTEL_AVISO = 1.5;

/**
 * C3-d: los dinteles entran en el diafragma rígido de su planta. Con losa encima, ella ya los
 * coacciona (−6,1 % frente a la losa semirrígida, C3-4); sin losa (una planta de barras o de paños
 * unidireccionales, que no tienen membrana), el diafragma impide que su fibra superior se alargue y
 * rigidiza el muro acoplado mucho más: un 7 % con dinteles de 1,5 m y un 35 % con los de 6 m en
 * ETABS 15 (E6-3), un 15,5 % en el muro de C3-4. Aviso por dintel de luz ≥ LUZ_DINTEL_AVISO.
 */
function avisarDintelesEnDiafragma(ctx: Contexto, diag: Diagnosticos): void {
  const eps = ctx.op.epsGeom;
  for (const m of ctx.muros) {
    const base = ctx.cotas[m.kb]!;
    m.huecos.forEach((hh, nh) => {
      const luz = Math.abs(hh.hasta - hh.desde);
      if (luz < LUZ_DINTEL_AVISO - eps) return;
      const techo = base + hh.z1;
      // La planta de encima del hueco, dentro del muro: su dintel va de lo alto del hueco a esa cota
      let k = -1;
      for (let j = m.kh; j < m.kb; j++) if (ctx.cotas[j]! > techo + eps && (k < 0 || ctx.cotas[j]! < ctx.cotas[k]!)) k = j;
      if (k < 0 || diafragmaDe(ctx, k) !== "rigido") return;
      const planta = ctx.plantas[k]!.id;
      if (ctx.losas.some((l) => l.losa.planta === planta)) return;
      const canto = ctx.cotas[k]! - techo;
      diag.aviso(
        "muro/dintel-en-diafragma",
        `El dintel sobre el hueco ${nh + 1} del muro ${m.muro.id} (${luz.toFixed(2)} m de luz y ${canto.toFixed(2)} m de canto) entra en el diafragma rígido de la planta ${planta}, que no tiene losa que lo coaccione: el diafragma impide que su fibra superior se alargue y rigidiza el muro acoplado (un 7 % con dinteles de 1,5 m y un 35 % con los de 6 m en ETABS 15, E6-3). Para el sismo, contraste con diafragma "ninguno" en esa planta (C3-d).`,
        [m.muro.id, planta],
        { luz, canto },
      );
    });
  }
}

function hipotesis(ctx: Contexto, op: OpcionesResueltas, piezas: Piezas, losas: Losas, panos: PanosU, modificadoresDe: (b: BarraP) => ModificadoresBarra | undefined, equilibrio: ReadonlySet<BarraP>, conZonas: boolean, alDiafragma: readonly string[], planas: ReadonlySet<BarraP>): string[] {
  const h: string[] = [];
  // Sin ninguna barra con zona rígida (perfiles dados por sus propiedades, sin b ni h), el factor no actúa
  // ZR1: las vigas, por lo que recorren dentro del pilar; los pilares, por lo que ocupa el nudo físico
  const [fv, fp] = [op.factorZonaRigida, op.factorZonaRigidaPilares];
  const vigasZR = fv === 0 ? "las vigas, de eje a eje" : `las vigas son rígidas en ${fv === 1 ? "todo lo que" : `el ${coma(fv * 100)} % de lo que`} recorren dentro del pilar (hasta su cara)`;
  // RV-b: con el plano en la cara superior del forjado, el nudo ocupa todo el canto por debajo
  const pilaresZR =
    fp === 0
      ? "los pilares, de eje a eje"
      : op.planoForjado === "superior"
        ? `los pilares, ${fp === 1 ? "en todo el canto" : `en el ${coma(fp * 100)} % del canto`} de la losa o de la viga más alta que les llega, en la cabeza de cada tramo, con los nudos del forjado en su cara superior, como CYPECAD (RV-b): la base arranca en el nudo`
        : `los pilares, ${fp === 1 ? "hasta la cara" : `en el ${coma(fp * 100)} % del nudo hacia la cara`} de la viga o la losa que les llega (el medio canto con el eje de la viga en el plano del forjado, el canto entero si cuelga de él), en la cabeza de cada tramo${
            op.zonaRigidaBase ? " y, sobre un forjado, también en su base, como CYPECAD (LV-d)" : ""
          }`;
  h.push(
    !conZonas
      ? "Nudos de eje a eje: ninguna barra tiene zona rígida ni excentricidad (las secciones no dan dimensiones al nudo), así que el factor de zona rígida no actúa."
      : fv === 0 && fp === 0
        ? "Nudos de eje a eje: sin zonas rígidas (factor 0), como SAP2000 por defecto."
        : `Nudos de dimensión finita: ${vigasZR}; ${pilaresZR}.`,
  );
  // PF: los pilares cuyo eje cambia entre tramos
  const excentricos = ctx.pilares.filter((p) => {
    if (!conPuntoFijo(p)) return false;
    const [kb, kh] = [ctx.planta.get(p.desde)!, ctx.planta.get(p.hasta)!];
    const [x0, y0] = ejeTramo(ctx, p, kb - 1);
    for (let k = kb - 2; k >= kh; k--) {
      const [x, y] = ejeTramo(ctx, p, k);
      if (x !== x0 || y !== y0) return true;
    }
    return false;
  });
  if (excentricos.length)
    h.push(
      `Pilares con punto fijo y cambio de sección (PF, como CYPECAD): el eje de cada tramo es el centro de su sección; el nudo de cada planta va en el eje del tramo que llega a ella desde abajo, y la excentricidad, en un offset rígido en la base del tramo de encima (${excentricos.map((p) => p.id).join(", ")}).`,
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
  if (planas.size) {
    const vs = [...new Set([...planas].map((b) => b.pieza))].sort();
    h.push(
      `Vigas planas en un reticular (RV-a): la flexión (Iy) ×${coma(op.rigidezVigasPlanas)} en ${planas.size} tramos de ${vs.length} vigas (${vs.join(", ")}), incluida en los modificadores de arriba. Es un ajuste empírico a CYPECAD, que trata así las vigas de hormigón con el canto del forjado embebidas en un reticular «uniforme» sin decirlo en su memoria: con la sección bruta, sus vigas llevan hasta 1,6 veces el momento de vano de CYPECAD y la losa, hasta un 13 % menos.`,
    );
  }
  // CY2: empotramiento parcial de los extremos de pilar, agrupado por valor
  const emp = new Map<string, number>();
  for (const b of piezas.barras)
    for (const [e, que] of [
      ["j", "cabeza"],
      ["i", "base"],
    ] as const) {
      const a = b.empotramiento?.[e];
      if (a !== undefined) emp.set(`${que} ${coma(a)}`, (emp.get(`${que} ${coma(a)}`) ?? 0) + 1);
    }
  if (ctx.pilares.length)
    h.push(
      emp.size
        ? `Empotramiento parcial de los pilares (CY2, como CYPECAD: la rigidez es α·K_biempotrada + (1 − α)·K_articulada en ese extremo): ${[...emp].map(([k, n]) => `${k} (${n} tramos)`).join("; ")}. Por defecto, 0,3 en la cabeza del último tramo, salvo en los pilares sobre los que arranca otro.`
        : "Pilares empotrados en sus dos extremos (sin coeficiente de empotramiento parcial).",
    );
  const usadas = new Set<string>([...ctx.vigas.map((v) => v.planta), ...ctx.losas.map((l) => l.losa.planta), ...ctx.panos.map((p) => p.pano.planta)]);
  for (const p of ctx.pilares) for (let k = ctx.planta.get(p.hasta)!; k <= ctx.planta.get(p.desde)!; k++) usadas.add(ctx.plantas[k]!.id);
  const conLosa = new Set(ctx.losas.map((l) => l.losa.planta));
  const conPano = new Set(ctx.panos.map((p) => p.pano.planta));
  const conDiafragma = [...new Set(piezas.diafragmas.map((d) => ctx.plantas[d.k]!.id))];
  const sin = ctx.plantas.filter((p, k) => usadas.has(p.id) && diafragmaDe(ctx, k) !== "rigido").map((p) => (conLosa.has(p.id) ? `${p.id} (semirrígido: la membrana de sus losas)` : p.id));
  h.push(`Diafragma rígido en ${conDiafragma.length ? conDiafragma.join(", ") : "ninguna planta"}${sin.length ? `; sin diafragma en ${sin.join(", ")}` : ""}.`);
  if (alDiafragma.length)
    h.push(
      `Las cargas puntuales sólo horizontales en una losa con diafragma rígido (${alDiafragma.join(", ")}) van al nudo del diafragma más cercano con su momento de transporte, sin nudo propio en la malla: con el diafragma rígido es la misma carga (SP-5).`,
    );
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
        ? `Losas malladas con láminas DKMQ (h = ${coma(op.tamanoMalla)} m; ${losas.laminas.length} láminas; jacobiano escalado mínimo ${coma(Number(losas.malla.jacobianoMin.toFixed(3)))}): rejilla alineada con los ejes de la losa en las zonas regulares, con cuadriláteros de ≤ ${coma(op.tamanoMalla)} m y ${losas.malla.plantillas} plantillas de pilar (${enRejilla} láminas, el ${coma(Number(((100 * enRejilla) / Math.max(1, losas.laminas.length)).toFixed(0)))} %), y triangulación restringida de lado ${coma(2 * op.tamanoMalla)} m, refinada junto a los rasgos pequeños (con el objetivo de un jacobiano escalado ≥ 0,3) y dividida en 3 cuadriláteros, alrededor de lo que no cae en ella (H52, C2-a, G-4).`
        : `Losas malladas con láminas DKMQ: triangulación restringida de lado ${coma(2 * op.tamanoMalla)} m, refinada junto a los rasgos pequeños (G-4) y dividida en 3 cuadriláteros (h = ${coma(op.tamanoMalla)} m; ${losas.laminas.length} láminas; jacobiano escalado mínimo ${coma(Number(losas.malla.jacobianoMin.toFixed(3)))}).`,
    );
    const conAncho = losas.anchos.length > 0;
    const otras = ctx.vigas.some((v) => ctx.losas.some((l) => l.losa.planta === v.planta) && anchoUnion(ctx, v) === null);
    h.push(
      `Unión pilar–losa por la huella del pilar, rígida: sólo los nudos dentro de la huella o en su borde (${losas.huellas.length} huellas, H09; fase HR). ${
        conAncho
          ? `Unión losa–viga como CYPECAD (fase LV, CY-g): el ancho de las vigas de hormigón rectangulares no es losa; la losa llega a sus caras y sus nudos en ellas van unidos al eje de la viga por un enlace rígido (${losas.enlacesVigas.length} enlaces, ${losas.enlacesVigas.reduce((a, x) => a + x.esclavos.length, 0)} nudos; los que caen frente a un pilar, con su huella). Lo que cae en el ancho de la viga (el pp de la losa, sus cargas de superficie, lineales y puntuales) pasa a la viga con su momento de transporte.${op.refinoEsquinas ? ` La malla se refina en las esquinas de los paños entre vigas (fase LV2: plantillas de esquina graduadas hacia ella, con 3 niveles en los cruces con pilar y 2 en los demás), para que la viga en la cara del pilar y las franjas junto a las vigas salgan como con la malla fina.` : ""}${otras ? " Las demás vigas (metálicas o de otras secciones) se parten en los nudos de la malla sobre su eje, con la losa continua por encima." : ""}`
          : "Las vigas embebidas se parten en los nudos de la malla sobre su eje fuera de las huellas."
      } La zona rígida de la cabeza de los pilares cuenta el espesor de la losa.`,
    );
    const aViga = [...losas.apoyosAViga].filter(([, x]) => x.vigas.length).map(([id]) => id);
    const aPilar = [...losas.apoyosAViga].filter(([, x]) => x.pilares.length).map(([id]) => id);
    if (aViga.length)
      h.push(
        `Los apoyos que llegan a una viga por su ancho o su cara (${aViga.join(", ")}) apoyan el eje de la viga en su proyección, con sus mismas coacciones: como un apoyo puntual de la viga en el cruce. Con sólo uz, la viga gira libre sobre su eje en el apoyo.`,
      );
    if (aPilar.length) h.push(`Los apoyos que llegan a la huella de un pilar (${aPilar.join(", ")}) acaban en su cara: lo que cae en la huella, o en la zona rígida de una viga en el pilar, es del pilar.`);
    h.push(
      `Peso propio de las losas desde su pp (${ctx.losas.map((l) => (l.reticular && l.reticular.ppAbaco !== l.reticular.ppAligerada ? `${l.losa.id}: ${coma(Number(l.pp.toFixed(3)))} kN/m² en la zona aligerada y ${coma(Number(l.reticular.ppAbaco.toFixed(3)))} en los ábacos, con casetón recuperable (C4-i)` : `${l.losa.id}: ${coma(Number(l.pp.toFixed(3)))} kN/m²`)).join("; ")}). Las vigas rectangulares de hormigón bajo losa pesan sólo su descuelgue (C2-g, H24).${ctx.pilares.length ? " Los pilares pesan de forjado a forjado, sin descontar su cruce con las losas (A-9): del lado de la seguridad, como es habitual." : ""}`,
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
          : r.abaco
            ? `Forjado reticular ${l.losa.id} (nervios de ${coma(nr.nervio)} m cada ${coma(nr.intereje)} m, capa de ${coma(nr.capa)} m y canto total ${coma(l.material.t)} m), con la rigidez de CYPECAD (CY3): la zona aligerada y sus ${r.abacos.length} ábacos, con la mitad de la flexión de la maciza y la torsión de su emparrillado, sin efecto Poisson (ν = 0): m11 = m22 ${f(m.m11)}, m12 ${f(m.m12)}; la membrana y el cortante, por zonas (aligerada: f11 = f22 ${f(m.f11)}, f12 ${f(m.f12)}, v13 = v23 ${f(m.v13)}; ábacos, los de la maciza).`
            : `Forjado reticular ${l.losa.id} (nervios de ${coma(nr.nervio)} m cada ${coma(nr.intereje)} m, capa de ${coma(nr.capa)} m y canto total ${coma(l.material.t)} m): la zona aligerada es una lámina maciza con los multiplicadores del emparrillado de nervios, sin efecto Poisson (ν = 0) y con el G del hormigón (C4-h, rigidez «bruta»): f11 = f22 ${f(m.f11)}, f12 ${f(m.f12)}, m11 = m22 ${f(m.m11)}, m12 ${f(m.m12)}, v13 = v23 ${f(m.v13)}; ${r.abacos.length} ábacos macizos.`,
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
    h.push(
      `Peso propio de los muros: γ·t por m² de alzado sin huecos, de forjado a forjado, menos el solape con las losas (C3-g).${ctx.vigas.length ? " Las vigas rectangulares de hormigón que corren por el eje de un muro que les llega desde abajo pesan sólo lo que sobresalen de él, w·(b − t)/b, porque cuelgan del forjado dentro del muro (A-9)." : ""}`,
    );
  }
  if (panos.viguetas.length) {
    const lista = ctx.panos
      .map((p, i) => `${p.pano.id}: ${panos.porPano[i]!.length} viguetas de ${p.pano.seccion} cada ${coma(p.pano.intereje)} m a ${coma(Number((((Math.atan2(panos.marcos[i]!.d[1], panos.marcos[i]!.d[0]) * 180) / Math.PI + 180) % 180).toFixed(2)))}°, pp ${coma(p.pano.pp)} kN/m²`)
      .join("; ");
    h.push(
      `Forjados unidireccionales como viguetas-barra (D2; ${lista}). Las viguetas de los paños contiguos con la misma dirección e intereje siguen las mismas rectas, centradas en su ancho, y son continuas sobre sus apoyos comunes (C4-a). Cada vigueta va de apoyo a apoyo (vigas, muros, pilares y bordes de losa), sin nudos intermedios y con la torsión liberada en un extremo; las de un voladizo la conservan (C4-c, E2-3).`,
    );
    h.push(
      "Cargas de los paños (su pp, de superficie, lineales y puntuales): a las viguetas por la regla de la palanca en la dirección transversal, y a las vigas y los muros paralelos a ellas en sus lados la franja entre la última vigueta y la viga o el muro; la franja junto a un borde sin viga ni muro va a la última vigueta con su momento de transporte (C4-e). Las vigas bajo un paño pesan sólo su descuelgue (C2-g con el canto de la vigueta).",
    );
    if (panos.voladizos) {
      const vigas = [...new Set([...equilibrio].map((b) => b.pieza))].sort();
      h.push(
        `Viguetas en voladizo sin otro apoyo en su línea: ${panos.voladizos} (C4-k). Su momento no lo compensa ningún vano, así que lo resiste la pieza que las sujeta. ${
          !op.torsionEquilibrio
            ? "La opción de torsión de equilibrio está desactivada: las vigas que las sujetan conservan sus modificadores de torsión."
            : vigas.length
              ? `Es torsión de equilibrio en ${vigas.length > 1 ? "las vigas" : "la viga"} ${vigas.join(", ")} (${equilibrio.size} tramos, hasta los pilares, muros o vigas que coartan su giro): su torsión no se reduce (sin el J de D4) y hay que dimensionarlas a torsión.`
              : "Las sujetan pilares, muros o losas, por su flexión: ninguna viga trabaja a torsión de equilibrio."
        }`,
      );
    }
  }
  return h;
}

/**
 * RV-a: los tramos de viga de hormigón rectangular, con un canto no mayor que el del forjado, que
 * tienen a sus lados (mirados a b/4 del eje en su punto medio, como C2-g) un reticular «uniforme» de
 * su planta y ninguna otra losa ni paño. Un lado sin losa (la viga de borde) no cuenta.
 */
function vigasPlanasEnReticular(ctx: Contexto, losas: Losas, piezas: Piezas): Set<BarraP> {
  const res = new Set<BarraP>();
  const eps = ctx.op.epsGeom;
  for (const b of piezas.barras) {
    if (b.tipo !== "viga" || b.auxiliar) continue;
    const v = ctx.vigaDe.get(b.pieza);
    const sc = v && ctx.secciones.get(v.seccion);
    if (!v || !sc || sc.material !== "hormigon" || sc.forma !== "rectangular" || sc.huella?.tipo !== "rectangulo") continue;
    const dx = b.jp[0] - b.ip[0];
    const dy = b.jp[1] - b.ip[1];
    const L = Math.hypot(dx, dy);
    if (!(L > eps)) continue;
    const M: Vec2 = [(b.ip[0] + b.jp[0]) / 2, (b.ip[1] + b.jp[1]) / 2];
    const n: Vec2 = [-dy / L, dx / L];
    let reticular = false;
    let otra = false;
    for (const s of [1, -1]) {
      const q: Vec2 = [M[0] + (s * sc.huella.b * n[0]) / 4, M[1] + (s * sc.huella.b * n[1]) / 4];
      ctx.losas.forEach((l, i) => {
        if (l.losa.planta !== v.planta || !puntoEnRegion(q, losas.regiones[i]!)) return;
        if (l.reticular?.abaco && !l.reticular.dados && sc.canto <= l.material.t + eps) reticular = true;
        else otra = true;
      });
      if (ctx.panos.some((p) => p.pano.planta === v.planta && puntoEnRegion(q, p.region))) otra = true;
    }
    if (reticular && !otra) res.add(b);
  }
  return res;
}
