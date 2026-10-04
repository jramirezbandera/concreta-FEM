/**
 * Compilador: modelo físico → modelo analítico del motor (fase C1: barras). Plan, reglas y
 * decisiones por defecto en `docs/fem3d/compilador.md`.
 *
 * Pasos, cada uno con sus diagnósticos (si alguno deja un error, la compilación no sigue):
 * 1. Esquema, referencias y cotas (`validar.ts`).
 * 2. Topología por planta con dos tolerancias (`topologia.ts`).
 * 3. Barras con zonas rígidas y excentricidades, apoyos y diafragmas (`piezas.ts`).
 * 4. Numeración canónica de los nudos: por cota, x e y; los maestros de diafragma al final.
 * 5. Cargas y peso propio (`cargas.ts`), con el control «sin pérdidas» por caso.
 * 6. Mapeo físico ↔ analítico (`mapeo.ts`) y huella.
 *
 * Es puro (sin DOM ni IO) y nunca lanza: un dato no válido es un diagnóstico, y cualquier otra
 * excepción acaba en `compilador/error-interno`.
 */
import { Diagnosticos, type Diagnostico } from "../motor/diagnosticos.ts";
import type { Apoyo, BarraAnalitica, CasoCarga, ModeloAnalitico, NudoAnalitico, Restriccion, Vec3 } from "../motor/modelo.ts";
import { construirCargas, diferenciaResultantes, resultanteAnalitica, TOL_SIN_PERDIDAS } from "./cargas.ts";
import { resolverOpciones, type ModeloFisico, type OpcionesCompilacion, type OpcionesResueltas } from "./fisico.ts";
import { huellaDe } from "./huella.ts";
import type { Mapeo, NudoMapeado } from "./mapeo.ts";
import { construirPiezas } from "./piezas.ts";
import { construirTopologia } from "./topologia.ts";
import { validar } from "./validar.ts";

/** Versión del compilador: entra en la huella, así que cambia cuando cambia su salida. */
export const VERSION_COMPILADOR = "C1.0";

export interface EstadisticasCompilacion {
  nudos: number;
  barras: number;
  diafragmas: number;
  /** Milisegundos de cada paso. */
  tiempos: Record<string, number>;
}

export type ResultadoCompilacion =
  | { valido: true; modelo: ModeloAnalitico; mapeo: Mapeo; diagnosticos: Diagnostico[]; huella: string; estadisticas: EstadisticasCompilacion }
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
  return huellaDe({ compilador: VERSION_COMPILADOR, fisico: fisicoCanonico(fisico), opciones: op });
}

function fisicoCanonico(f: ModeloFisico): unknown {
  if (typeof f !== "object" || f === null) return f;
  const clave = (x: unknown, campo = "id") => (typeof x === "object" && x !== null ? String((x as Record<string, unknown>)[campo]) : "");
  const ordenar = (v: unknown, campo = "id") => (Array.isArray(v) ? [...v].sort((a, b) => (clave(a, campo) < clave(b, campo) ? -1 : clave(a, campo) > clave(b, campo) ? 1 : 0)) : v);
  const r: Record<string, unknown> = { ...f };
  for (const k of ["materiales", "secciones", "vigas", "apoyos", "cargas"]) r[k] = ordenar(r[k]);
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
  const piezas = construirPiezas(ctx, topo, diag);
  marca("piezas");
  if (diag.hayErrores) return fallo();

  // Numeración canónica: por cota, x e y (no depende del orden de la entrada)
  const zDe = (n: number) => ctx.cotas[topo.nudos[n]!.k]!;
  const orden = topo.nudos.map((_, i) => i).sort((a, b) => zDe(a) - zDe(b) || topo.nudos[a]!.x - topo.nudos[b]!.x || topo.nudos[a]!.y - topo.nudos[b]!.y || a - b);
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
  const mapRestr: { planta: string }[] = [];
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

  // Barras con offsets (del nudo al extremo del tramo flexible)
  const offset = (p: Vec3, n: number): Vec3 | undefined => {
    const X = nudos[nuevo[n]!]!;
    const d: Vec3 = [p[0] - X.x, p[1] - X.y, p[2] - X.z];
    return d[0] === 0 && d[1] === 0 && d[2] === 0 ? undefined : d;
  };
  const modificadores = { pilar: op.modificadores.pilares, viga: op.modificadores.vigas };
  const barras: BarraAnalitica[] = piezas.barras.map((b) => {
    const r: BarraAnalitica = { id: b.id, nudos: [nuevo[b.i]!, nuevo[b.j]!], seccion: b.seccion, vz: b.vz };
    const di = offset(b.ip, b.i);
    const dj = offset(b.jp, b.j);
    if (di || dj) r.offsets = { ...(di ? { i: di } : {}), ...(dj ? { j: dj } : {}) };
    if (b.liberaciones) r.liberaciones = b.liberaciones;
    const m = modificadores[b.tipo];
    if (m && Object.keys(m).length) r.modificadores = m;
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
  const cargas = construirCargas(ctx, topo, piezas, centro, diag);
  marca("cargas");
  if (diag.hayErrores) return fallo();
  const casos: CasoCarga[] = ctx.casos.map((c, k) => {
    const cc = cargas.casos[k]!;
    const nodales = [...cc.nodales]
      .map(([n, f]) => ({ nudo: nuevo[n]!, f: f as unknown as readonly [number, number, number, number, number, number] }))
      .sort((a, b) => a.nudo - b.nudo);
    return { id: c.id, ...(nodales.length ? { nodales } : {}), ...(cc.barras.length ? { barras: cc.barras } : {}) };
  });
  const modelo: ModeloAnalitico = { nudos, barras, apoyos, restricciones, casos };

  // Sin pérdidas: resultante física = analítica, por caso
  ctx.casos.forEach((c, k) => {
    const err = diferenciaResultantes(cargas.fisicas[k]!, resultanteAnalitica(modelo, k, centro));
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
  piezas.barras.forEach((b, i) => (piezasMap[b.pieza] ??= []).push(i));
  const nudosPilar: Record<string, number> = {};
  for (const [clave, n] of topo.nudoPilar) {
    const at = clave.lastIndexOf("@");
    nudosPilar[`${clave.slice(0, at)}@${ctx.plantas[Number(clave.slice(at + 1))]!.id}`] = nuevo[n]!;
  }
  const apoyosMap: Record<string, number> = {};
  for (const [id, n] of topo.apoyoEn) apoyosMap[id] = nuevo[n]!;
  const mapeo: Mapeo = {
    nudos: mapNudos,
    barras: piezas.barras.map((b) => ({ pieza: b.pieza, tipo: b.tipo, tramo: b.tramo, s: b.s })),
    restricciones: mapRestr,
    piezas: piezasMap,
    nudosPilar,
    apoyos: apoyosMap,
  };
  marca("mapeo");
  return {
    valido: true,
    modelo,
    mapeo,
    diagnosticos: diag.lista,
    huella,
    estadisticas: { nudos: nudos.length, barras: barras.length, diafragmas: restricciones.length, tiempos },
  };
}
