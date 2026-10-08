/**
 * Modelo de SAP2000 (.$2k) → modelo analítico del motor, para comparar con los resultados de
 * SAP2000 los modelos del usuario (S5 #21, D3, regla de oro 7). No es código del motor ni el
 * compilador de Concreta: traduce lo que hace falta para esa comparación y rechaza, con un error
 * explícito, lo que no sabe traducir exactamente (nunca lo aproxima en silencio).
 *
 * Lo que traduce:
 * - nudos (cartesianos globales); unidades de PROGRAM CONTROL (N, kN, kgf, tf, lb, kip; mm, cm, m, in, ft);
 * - barras de sección general (las propiedades que SAP2000 calcula para cualquier forma): E, G, A,
 *   I33 (= Iy del motor), I22 (= Iz), J, AS2 (= Avz) y AS3 (= Avy); un área de cortante nula o un
 *   modificador de cortante nulo es «sin deformación por cortante»;
 * - ejes locales de barra: el eje 2 de SAP2000 (por defecto, +X en las verticales y hacia arriba en
 *   las demás), girado `Angle` alrededor del 1, es el vector de canto del motor;
 * - liberaciones (P, V2, V3, T, M2, M3 = N, Vz, Vy, T, Mz, My del motor), zonas rígidas en los
 *   extremos (la parte rígida, RZ × longitud) y modificadores de sección y de barra;
 * - división de barras en los nudos intermedios (auto-mesh «at intermediate joints»);
 * - láminas de 4 nudos Shell (fina o gruesa: la DKMQ vale para las dos), Membrane (flexión ×1e-6) y
 *   Plate (membrana ×1e-6), con modificadores f11…v23 y el giro de sus ejes;
 * - apoyos y muelles a tierra desacoplados en ejes globales; diafragmas (eje Z) y cuerpos rígidos;
 * - patrones de carga: peso propio, cargas nodales, cargas de barra distribuidas y puntuales (fuerza
 *   o momento, globales o locales; la parte que cae en una zona rígida pasa al nudo con su momento) y
 *   cargas uniformes de área (globales o locales);
 * - casos estáticos lineales como combinación de patrones (el motor calcula un caso por patrón).
 */
import { marcoLamina } from "../../../src/elementos/lamina.ts";
import type { MultiplicadoresLamina } from "../../../src/elementos/lamina.ts";
import type { SeccionBarra } from "../../../src/elementos/barra.ts";
import type { BarraAnalitica, CargaBarra, CargaLamina, CargaNodal, LaminaAnalitica, ModeloAnalitico, Vec3 } from "../../../src/motor/modelo.ts";
import { num, si, type Registro, type Tablas } from "./s2k.ts";

const FUERZA: Record<string, number> = { N: 1e-3, KN: 1, KGF: 9.80665e-3, TONF: 9.80665, TF: 9.80665, LB: 4.4482216152605e-3, KIP: 4.4482216152605 };
const LONGITUD: Record<string, number> = { MM: 1e-3, CM: 1e-2, M: 1, IN: 0.0254, FT: 0.3048 };

/** Un trozo de barra del motor dentro de una barra de SAP2000 (entre dos estaciones, desde el nudo I). */
export interface Trozo {
  barra: number;
  /** Estaciones (m, desde el nudo I de la barra de SAP2000) del principio y del final del tramo flexible del trozo. */
  s0: number;
  s1: number;
}

export interface BarraSap {
  nombre: string;
  /** Longitud entre nudos (m). */
  L: number;
  /** Partes rígidas en I y en J (m). */
  rigidaI: number;
  rigidaJ: number;
  trozos: Trozo[];
  /** Ejes locales de SAP2000 (1, 2, 3), globales. */
  ejes: [Vec3, Vec3, Vec3];
  nudoI: number;
  nudoJ: number;
}

export interface Importado {
  modelo: ModeloAnalitico;
  /** Factores de las unidades del fichero a kN y a m. */
  fuerza: number;
  longitud: number;
  nudos: Map<string, number>;
  barras: Map<string, BarraSap>;
  laminas: Map<string, number>;
  /** Patrones de carga, uno por caso del motor y en su orden. */
  patrones: string[];
  /** Casos estáticos lineales de SAP2000: factor de cada patrón. */
  casosSap: Map<string, Map<string, number>>;
  errores: string[];
  avisos: string[];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const esc = (a: Vec3, f: number): Vec3 => [a[0] * f, a[1] * f, a[2] * f];
const suma = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cruz = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norma = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => esc(a, 1 / norma(a));

/** Ejes locales por defecto de una barra de SAP2000 (CSI Analysis Reference, «Frame Element – Local Coordinate System»), girados `angulo` grados. */
export function ejesBarraSap(Xi: Vec3, Xj: Vec3, angulo: number): [Vec3, Vec3, Vec3] {
  const e1 = unit(sub(Xj, Xi));
  const horizontal = Math.hypot(e1[0], e1[1]);
  // vertical si el seno del ángulo con Z es menor que 1e-3: eje 2 = +X
  let e2: Vec3 = horizontal < 1e-3 ? [1, 0, 0] : unit(sub([0, 0, 1], esc(e1, e1[2])));
  let e3 = cruz(e1, e2);
  if (angulo) {
    const t = (angulo * Math.PI) / 180;
    const [c, s] = [Math.cos(t), Math.sin(t)];
    [e2, e3] = [suma(esc(e2, c), esc(e3, s)), suma(esc(e3, c), esc(e2, -s))];
  }
  return [e1, e2, e3];
}

/** Dirección de carga de SAP2000 en globales (Gravity = −Z; 1, 2, 3 = ejes locales). */
function direccion(dir: string, ejes: [Vec3, Vec3, Vec3] | null): Vec3 | null {
  switch (dir.trim().toUpperCase()) {
    case "GRAVITY":
      return [0, 0, -1];
    case "X":
      return [1, 0, 0];
    case "Y":
      return [0, 1, 0];
    case "Z":
      return [0, 0, 1];
    case "1":
      return ejes?.[0] ?? null;
    case "2":
      return ejes?.[1] ?? null;
    case "3":
      return ejes?.[2] ?? null;
    default:
      return null;
  }
}

export function importarS2k(t: Tablas): Importado {
  const errores: string[] = [];
  const avisos: string[] = [];
  const tabla = (n: string) => t.get(n) ?? [];

  // Unidades
  const control = tabla("PROGRAM CONTROL")[0];
  const unidades = (control?.CurrUnits ?? "KN, m, C").split(",").map((s) => s.trim().toUpperCase());
  const fuerza = FUERZA[unidades[0] ?? ""] ?? Number.NaN;
  const longitud = LONGITUD[unidades[1] ?? ""] ?? Number.NaN;
  if (!Number.isFinite(fuerza) || !Number.isFinite(longitud)) errores.push(`Unidades no soportadas: ${control?.CurrUnits}.`);
  const L1 = longitud;
  const F1 = fuerza;

  // Tablas que no se saben traducir
  const NO_SOPORTADAS = [
    "AREA LOADS - UNIFORM TO FRAME",
    "AREA LOADS - TEMPERATURE",
    "FRAME LOADS - TEMPERATURE",
    "JOINT LOADS - GROUND DISPLACEMENT",
    "LINK PROPERTY ASSIGNMENTS",
    "CONNECTIVITY - LINK",
    "CONNECTIVITY - SOLID",
    "JOINT SPRING ASSIGNMENTS 2 - COUPLED",
    "CONSTRAINT DEFINITIONS - EQUAL",
    "CONSTRAINT DEFINITIONS - LOCAL",
    "CONSTRAINT DEFINITIONS - WELD",
    "FRAME TENSION AND COMPRESSION LIMITS",
  ];
  for (const n of NO_SOPORTADAS) if (tabla(n).length) errores.push(`La tabla «${n}» no se sabe traducir (${tabla(n).length} registros).`);

  // Nudos
  const nudos = new Map<string, number>();
  const xyz: Vec3[] = [];
  const modelo = { nudos: [] as { id: string; x: number; y: number; z: number }[], barras: [] as BarraAnalitica[], laminas: [] as LaminaAnalitica[], muelles: [] as never[], apoyos: [] as never[], restricciones: [] as never[], casos: [] as never[] };
  const nudosM: { id: string; x: number; y: number; z: number }[] = [];
  for (const r of tabla("JOINT COORDINATES")) {
    let p: Vec3;
    if (r.GlobalX !== undefined) p = [num(r, "GlobalX"), num(r, "GlobalY"), num(r, "GlobalZ")];
    else {
      if ((r.CoordSys ?? "GLOBAL").toUpperCase() !== "GLOBAL" || (r.CoordType ?? "Cartesian").toUpperCase() !== "CARTESIAN") {
        errores.push(`El nudo ${r.Joint} no está en coordenadas cartesianas globales.`);
        continue;
      }
      p = [num(r, "XorR"), num(r, "Y"), num(r, "Z")];
    }
    const g = esc(p, L1);
    nudos.set(r.Joint!, nudosM.length);
    xyz.push(g);
    nudosM.push({ id: r.Joint!, x: g[0], y: g[1], z: g[2] });
  }
  for (const r of tabla("JOINT LOCAL AXES ASSIGNMENTS 1 - TYPICAL")) if (num(r, "AngleA", 0) || num(r, "AngleB", 0) || num(r, "AngleC", 0)) errores.push(`El nudo ${r.Joint} tiene ejes locales girados.`);
  const nudo = (nombre: string | undefined, que: string): number => {
    const v = nombre === undefined ? undefined : nudos.get(nombre);
    if (v === undefined) {
      errores.push(`${que} hace referencia al nudo inexistente ${nombre}.`);
      return -1;
    }
    return v;
  };

  // Materiales
  const materiales = new Map<string, { E: number; G: number; nu: number; peso: number }>();
  // SAP2000 exporta también sus materiales por defecto (A992Fy50, 4000Psi, A416Gr270…): uno no isótropo
  // sólo es un error si alguna barra o área lo usa
  const noIsotropos = new Set<string>();
  for (const r of tabla("MATERIAL PROPERTIES 01 - GENERAL")) if (r.SymType && r.SymType.toUpperCase() !== "ISOTROPIC") noIsotropos.add(r.Material!);
  for (const r of tabla("MATERIAL PROPERTIES 02 - BASIC MECHANICAL PROPERTIES")) {
    const E = num(r, "E1") * (F1 / L1 ** 2);
    const nu = num(r, "U12");
    const G = r.G12 !== undefined ? num(r, "G12") * (F1 / L1 ** 2) : E / (2 * (1 + nu));
    materiales.set(r.Material!, { E, G, nu, peso: num(r, "UnitWeight", 0) * (F1 / L1 ** 3) });
  }
  const material = (n: string | undefined, que: string) => {
    if (n !== undefined && noIsotropos.has(n)) {
      errores.push(`${que}: el material ${n} no es isótropo.`);
      return undefined;
    }
    const m = n === undefined ? undefined : materiales.get(n);
    if (!m) errores.push(`${que}: el material ${n} no está definido.`);
    return m;
  };

  // Secciones de barra
  const secciones = new Map<string, Registro>();
  for (const r of tabla("FRAME SECTION PROPERTIES 01 - GENERAL")) {
    secciones.set(r.SectionName!, r);
    if (/nonprismatic/i.test(r.Shape ?? "")) errores.push(`La sección ${r.SectionName} es de inercia variable.`);
    if (num(r, "I23", 0) !== 0) errores.push(`La sección ${r.SectionName} tiene I23 ≠ 0 (ejes no principales).`);
  }
  const porBarra = (n: string) => new Map(tabla(n).map((r) => [r.Frame!, r]));
  const asignacion = porBarra("FRAME SECTION ASSIGNMENTS");
  const giros = porBarra("FRAME LOCAL AXES ASSIGNMENTS 1 - TYPICAL");
  const liberaciones = porBarra("FRAME RELEASE ASSIGNMENTS 1 - GENERAL");
  const offsets = porBarra("FRAME OFFSET ALONG LENGTH ASSIGNMENTS");
  const insercion = porBarra("FRAME INSERTION POINT ASSIGNMENTS");
  const modBarra = porBarra("FRAME PROPERTY MODIFIERS");
  const mallaBarra = porBarra("FRAME AUTO MESH ASSIGNMENTS");
  const primero = (r: Registro | undefined, campos: string[], def: number) => {
    for (const c of campos) if (r?.[c] !== undefined) return num(r, c, def);
    return def;
  };

  const barras = new Map<string, BarraSap>();
  const pesoBarras: { sap: BarraSap; q: number }[] = [];
  for (const r of tabla("CONNECTIVITY - FRAME")) {
    const nombre = r.Frame!;
    const i = nudo(r.JointI, `La barra ${nombre}`);
    const j = nudo(r.JointJ, `La barra ${nombre}`);
    if (i < 0 || j < 0) continue;
    if (si(r, "IsCurved")) {
      errores.push(`La barra ${nombre} es curva.`);
      continue;
    }
    const a = asignacion.get(nombre);
    const s = a && secciones.get(a.AnalSect ?? a.Section ?? "");
    if (!s) {
      errores.push(`La barra ${nombre} no tiene una sección conocida.`);
      continue;
    }
    const mat = material(a!.MatProp && a!.MatProp !== "Default" ? a!.MatProp : s.Material, `La barra ${nombre}`);
    if (!mat) continue;
    const mb = modBarra.get(nombre);
    const mod = (seccion: string, barra: string) => num(s, seccion, 1) * primero(mb, [barra], 1);
    const [mA, mA2, mA3, mJ, mI2, mI3, mW] = [mod("AMod", "AMod"), mod("A2Mod", "AS2Mod"), mod("A3Mod", "AS3Mod"), mod("JMod", "JMod"), mod("I2Mod", "I22Mod"), mod("I3Mod", "I33Mod"), mod("WMod", "WeightMod")];
    if (!(mA > 0 && mJ > 0 && mI2 > 0 && mI3 > 0)) errores.push(`La barra ${nombre} tiene un modificador de A, J o I nulo o negativo, que el motor no admite.`);
    const AS2 = num(s, "AS2", 0) * mA2 * L1 ** 2;
    const AS3 = num(s, "AS3", 0) * mA3 * L1 ** 2;
    const seccion: SeccionBarra = {
      E: mat.E,
      G: mat.G,
      A: num(s, "Area") * mA * L1 ** 2,
      Iy: num(s, "I33") * mI3 * L1 ** 4,
      Iz: num(s, "I22") * mI2 * L1 ** 4,
      J: num(s, "TorsConst") * mJ * L1 ** 4,
      ...(AS3 > 0 ? { Avy: AS3 } : {}),
      ...(AS2 > 0 ? { Avz: AS2 } : {}),
    };
    const ins = insercion.get(nombre);
    if (ins && ((ins.CardinalPt && !/^(10|centroid)/i.test(ins.CardinalPt) && !/^no$/i.test(ins.StiffTrans ?? "Yes")) || ["JtOffXI", "JtOffYI", "JtOffZI", "JtOffXJ", "JtOffYJ", "JtOffZJ"].some((c) => num(ins, c, 0) !== 0))) {
      errores.push(`La barra ${nombre} tiene un punto de inserción distinto del centroide o desplazamientos de nudo: no se traducen todavía.`);
      continue;
    }
    const ejes = ejesBarraSap(xyz[i]!, xyz[j]!, num(giros.get(nombre) ?? {}, "Angle", 0));
    if (si(giros.get(nombre) ?? {}, "AdvanceAxes") || si(giros.get(nombre) ?? {}, "MirrorAbt2") || si(giros.get(nombre) ?? {}, "MirrorAbt3")) errores.push(`La barra ${nombre} tiene ejes avanzados o simetrizados.`);
    const L = norma(sub(xyz[j]!, xyz[i]!));
    const of = offsets.get(nombre);
    const factor = primero(of, ["RigidFactor", "RZ", "RigidFact", "RigidZoneFactor"], 0);
    const rigidaI = factor * primero(of, ["LengthOffI", "Length1", "OffsetI", "EndI"], 0) * L1;
    const rigidaJ = factor * primero(of, ["LengthOffJ", "Length2", "OffsetJ", "EndJ"], 0) * L1;
    // Liberaciones: P, V2, V3, T, M2, M3 de SAP2000 → [N, Vy, Vz, T, My, Mz] del motor
    const lib = liberaciones.get(nombre);
    if (lib && si(lib, "PartialFix")) errores.push(`La barra ${nombre} tiene liberaciones parciales (muelles).`);
    const extremo = (e: "I" | "J") => (lib ? ([si(lib, `P${e}`), si(lib, `V3${e}`), si(lib, `V2${e}`), si(lib, `T${e}`), si(lib, `M3${e}`), si(lib, `M2${e}`)] as const) : undefined);
    // División en los nudos intermedios que caen sobre la barra (auto-mesh)
    const malla = mallaBarra.get(nombre);
    const estaciones: { s: number; v: number }[] = [];
    if (malla && si(malla, "AutoMesh") && (malla.AtJoints === undefined || si(malla, "AtJoints"))) {
      const e1 = ejes[0];
      xyz.forEach((p, v) => {
        if (v === i || v === j) return;
        const d = sub(p, xyz[i]!);
        const sv = dot(d, e1);
        if (sv <= 1e-6 * L || sv >= L * (1 - 1e-6)) return;
        if (norma(sub(d, esc(e1, sv))) < 1e-6 * Math.max(1, L)) estaciones.push({ s: sv, v });
      });
      estaciones.sort((a, b) => a.s - b.s);
      if (estaciones.length && (estaciones[0]!.s <= rigidaI || estaciones[estaciones.length - 1]!.s >= L - rigidaJ)) errores.push(`La barra ${nombre} tiene un nudo intermedio dentro de una zona rígida.`);
      if (si(malla, "AtFrames") || num(malla, "MaxLength", 0) > 0 || num(malla, "NumSegs", 0) > 1) errores.push(`La barra ${nombre} tiene una malla automática por longitud o por intersecciones, que no se reproduce.`);
    }
    const puntos = [{ s: 0, v: i }, ...estaciones, { s: L, v: j }];
    const sap: BarraSap = { nombre, L, rigidaI, rigidaJ, trozos: [], ejes, nudoI: i, nudoJ: j };
    for (let k = 0; k + 1 < puntos.length; k++) {
      const [p, q] = [puntos[k]!, puntos[k + 1]!];
      const oi = k === 0 && rigidaI > 0 ? esc(ejes[0], rigidaI) : undefined;
      const oj = k + 2 === puntos.length && rigidaJ > 0 ? esc(ejes[0], -rigidaJ) : undefined;
      const libI = k === 0 ? extremo("I") : undefined;
      const libJ = k + 2 === puntos.length ? extremo("J") : undefined;
      sap.trozos.push({ barra: modelo.barras.length, s0: p.s + (oi ? rigidaI : 0), s1: q.s - (oj ? rigidaJ : 0) });
      modelo.barras.push({
        id: puntos.length > 2 ? `${nombre}.${k + 1}` : nombre,
        nudos: [p.v, q.v],
        seccion,
        vz: ejes[1],
        ...(oi || oj ? { offsets: { i: oi, j: oj } } : {}),
        ...(libI?.some(Boolean) || libJ?.some(Boolean) ? { liberaciones: { i: libI?.some(Boolean) ? libI : undefined, j: libJ?.some(Boolean) ? libJ : undefined } } : {}),
      });
    }
    barras.set(nombre, sap);
    pesoBarras.push({ sap, q: mat.peso * seccion.A * mW / mA });
  }

  // Láminas
  const laminas = new Map<string, number>();
  const seccionesArea = new Map(tabla("AREA SECTION PROPERTIES").map((r) => [r.Section!, r]));
  const asignArea = new Map(tabla("AREA SECTION ASSIGNMENTS").map((r) => [r.Area!, r]));
  const modArea = new Map(tabla("AREA STIFFNESS MODIFIERS").map((r) => [r.Area!, r]));
  const girosArea = new Map(tabla("AREA LOCAL AXES ASSIGNMENTS 1 - TYPICAL").map((r) => [r.Area!, r]));
  const mallaArea = new Map(tabla("AREA AUTO MESH ASSIGNMENTS").map((r) => [r.Area!, r]));
  const ejesLamina = new Map<number, [Vec3, Vec3, Vec3]>();
  const pesoLaminas: { l: number; q: number }[] = [];
  for (const r of tabla("CONNECTIVITY - AREA")) {
    const nombre = r.Area!;
    if (num(r, "NumJoints") !== 4) {
      errores.push(`El área ${nombre} tiene ${r.NumJoints} nudos: el motor sólo tiene cuadriláteros.`);
      continue;
    }
    const ns = [1, 2, 3, 4].map((k) => nudo(r[`Joint${k}`], `El área ${nombre}`));
    if (ns.some((v) => v < 0)) continue;
    const ma = mallaArea.get(nombre);
    if (ma && ma.MeshType && !/^(default|no auto|none)/i.test(ma.MeshType)) errores.push(`El área ${nombre} tiene malla automática de SAP2000 (${ma.MeshType}): hay que mallarla en SAP2000 (Edit > Edit Areas > Divide Areas) antes de exportar.`);
    const sec = seccionesArea.get(asignArea.get(nombre)?.Section ?? "");
    if (!sec) {
      errores.push(`El área ${nombre} no tiene una sección conocida.`);
      continue;
    }
    const tipo = (sec.Type ?? "Shell-Thin").toUpperCase();
    if ((sec.AreaType ?? "Shell").toUpperCase() !== "SHELL" || /LAYERED|NONLINEAR/.test(tipo)) {
      errores.push(`El área ${nombre} es de tipo ${sec.AreaType} ${sec.Type}, que no se traduce.`);
      continue;
    }
    const mat = material(sec.Material, `El área ${nombre}`);
    if (!mat) continue;
    const tm = num(sec, "Thickness") * L1;
    const tb = num(sec, "BendThick", num(sec, "Thickness")) * L1;
    const t = /MEMBRANE/.test(tipo) ? tm : tb;
    const ma2 = modArea.get(nombre);
    const m = (k: string, seccion: string) => num(ma2 ?? {}, k, 1) * num(sec, seccion, 1);
    const mult: Required<MultiplicadoresLamina> = {
      f11: m("f11", "F11Mod") * (tm / t),
      f22: m("f22", "F22Mod") * (tm / t),
      f12: m("f12", "F12Mod") * (tm / t),
      m11: m("m11", "M11Mod") * (tb / t) ** 3,
      m22: m("m22", "M22Mod") * (tb / t) ** 3,
      m12: m("m12", "M12Mod") * (tb / t) ** 3,
      v13: m("v13", "V13Mod"),
      v23: m("v23", "V23Mod"),
    };
    if (tm !== tb && !/MEMBRANE|PLATE/.test(tipo)) avisos.push(`El área ${nombre} tiene espesores distintos de membrana y de flexión: el cortante transversal se toma con el de flexión.`);
    if (/MEMBRANE/.test(tipo)) for (const k of ["m11", "m22", "m12", "v13", "v23"] as const) mult[k] *= 1e-6;
    if (/PLATE/.test(tipo)) for (const k of ["f11", "f22", "f12"] as const) mult[k] *= 1e-6;
    if (Object.values(mult).some((v) => !(v > 0))) errores.push(`El área ${nombre} tiene un modificador nulo o negativo, que el motor no admite.`);
    const X = ns.flatMap((v) => xyz[v]!);
    const marco = marcoLamina(X);
    if (typeof marco === "string") {
      errores.push(`El área ${nombre}: ${marco}.`);
      continue;
    }
    let e1: Vec3 = [marco.R[0]!, marco.R[1]!, marco.R[2]!];
    let e2: Vec3 = [marco.R[3]!, marco.R[4]!, marco.R[5]!];
    const e3: Vec3 = [marco.R[6]!, marco.R[7]!, marco.R[8]!];
    const giro = girosArea.get(nombre);
    if (giro && si(giro, "AdvanceAxes")) errores.push(`El área ${nombre} tiene ejes avanzados.`);
    const ang = num(giro ?? {}, "Angle", 0);
    if (ang) {
      const tr = (ang * Math.PI) / 180;
      [e1, e2] = [suma(esc(e1, Math.cos(tr)), esc(e2, Math.sin(tr))), suma(esc(e2, Math.cos(tr)), esc(e1, -Math.sin(tr)))];
    }
    const iL = modelo.laminas.length;
    laminas.set(nombre, iL);
    ejesLamina.set(iL, [e1, e2, e3]);
    const multiplicadores = Object.values(mult).every((v) => v === 1) ? undefined : mult;
    modelo.laminas.push({ id: nombre, nudos: ns as unknown as [number, number, number, number], material: { E: mat.E, nu: mat.nu, t }, ...(ang ? { eje1: e1 } : {}), ...(multiplicadores ? { multiplicadores } : {}) });
    pesoLaminas.push({ l: iL, q: mat.peso * tm * num(ma2 ?? {}, "WMod", 1) * num(sec, "WMod", 1) });
  }

  // Apoyos, muelles y restricciones
  const apoyos: { nudo: number; coartados: [boolean, boolean, boolean, boolean, boolean, boolean] }[] = [];
  for (const r of tabla("JOINT RESTRAINT ASSIGNMENTS")) {
    const v = nudo(r.Joint, "Un apoyo");
    if (v >= 0) apoyos.push({ nudo: v, coartados: ["U1", "U2", "U3", "R1", "R2", "R3"].map((c) => si(r, c)) as never });
  }
  const muelles: { id: string; nudos: [number]; k: number[] }[] = [];
  for (const r of tabla("JOINT SPRING ASSIGNMENTS 1 - UNCOUPLED")) {
    const v = nudo(r.Joint, "Un muelle");
    if (v < 0) continue;
    if ((r.CoordSys ?? "GLOBAL").toUpperCase() !== "GLOBAL") errores.push(`El muelle del nudo ${r.Joint} no está en ejes globales.`);
    const k = ["U1", "U2", "U3"].map((c) => num(r, c, 0) * (F1 / L1)).concat(["R1", "R2", "R3"].map((c) => num(r, c, 0) * F1 * L1));
    if (k.some((x) => x !== 0)) muelles.push({ id: `M${r.Joint}`, nudos: [v], k });
  }
  const tiposRestriccion = new Map<string, string>();
  for (const r of tabla("CONSTRAINT DEFINITIONS - DIAPHRAGM")) {
    tiposRestriccion.set(r.Name!, "diafragma");
    if ((r.Axis ?? "Z").toUpperCase() !== "Z" || (r.CoordSys ?? "GLOBAL").toUpperCase() !== "GLOBAL") errores.push(`El diafragma ${r.Name} no es horizontal.`);
  }
  for (const r of tabla("CONSTRAINT DEFINITIONS - BODY")) {
    tiposRestriccion.set(r.Name!, "enlace-rigido");
    if (["UX", "UY", "UZ", "RX", "RY", "RZ"].some((c) => r[c] !== undefined && !si(r, c))) errores.push(`El cuerpo rígido ${r.Name} no ata los 6 GDL.`);
  }
  const grupos = new Map<string, number[]>();
  for (const r of tabla("JOINT CONSTRAINT ASSIGNMENTS")) {
    const v = nudo(r.Joint, "Una restricción");
    if (v < 0) continue;
    const n = r.Constraint!;
    if (!tiposRestriccion.has(n)) {
      const tipo = (r.Type ?? "").toUpperCase();
      if (tipo === "DIAPHRAGM") tiposRestriccion.set(n, "diafragma");
      else if (tipo === "BODY") tiposRestriccion.set(n, "enlace-rigido");
      else errores.push(`La restricción ${n} es de tipo ${r.Type}, que no se traduce.`);
    }
    if (!grupos.has(n)) grupos.set(n, []);
    grupos.get(n)!.push(v);
  }
  const restricciones = [...grupos].filter(([n]) => tiposRestriccion.has(n)).map(([n, vs]) => ({ tipo: tiposRestriccion.get(n) as "diafragma" | "enlace-rigido", id: n, maestro: vs[0]!, esclavos: vs.slice(1) }));
  // GDL inactivos (pórticos planos): se coartan en todos los nudos, salvo los que un diafragma o un
  // cuerpo rígido hace esclavos (ux, uy y rz, o los 6), que se coartan en su maestro
  const activos = tabla("ACTIVE DEGREES OF FREEDOM")[0];
  if (activos) {
    const inactivos = ["UX", "UY", "UZ", "RX", "RY", "RZ"].map((c) => activos[c] !== undefined && !si(activos, c));
    if (inactivos.some(Boolean)) {
      const esclavizados = new Map<number, Set<number>>();
      for (const r of restricciones) {
        const gdl = r.tipo === "diafragma" ? [0, 1, 5] : [0, 1, 2, 3, 4, 5];
        for (const e of r.esclavos) esclavizados.set(e, new Set(gdl));
      }
      const previos = new Map(apoyos.map((a) => [a.nudo, a]));
      nudosM.forEach((_, v) => {
        const fuera = esclavizados.get(v);
        const mascara = inactivos.map((x, g) => x && !fuera?.has(g));
        if (!mascara.some(Boolean)) return;
        const a = previos.get(v);
        if (a) a.coartados = a.coartados.map((c, g) => c || mascara[g]!) as never;
        else apoyos.push({ nudo: v, coartados: mascara as never });
      });
    }
  }

  // Patrones de carga → casos del motor
  const patrones = tabla("LOAD PATTERN DEFINITIONS").map((r) => r.LoadPat!);
  const idx = new Map(patrones.map((p, k) => [p, k]));
  const nodales: CargaNodal[][] = patrones.map(() => []);
  const deBarra: CargaBarra[][] = patrones.map(() => []);
  const deLamina: CargaLamina[][] = patrones.map(() => []);
  const caso = (p: string | undefined, que: string): number => {
    const k = p === undefined ? undefined : idx.get(p);
    if (k === undefined) errores.push(`${que} es de un patrón de carga inexistente (${p}).`);
    return k ?? -1;
  };

  /** Carga lineal (global, kN/m) de q(sa) a q(sb) entre las estaciones sa < sb de una barra de SAP2000. */
  const repartir = (k: number, sap: BarraSap, sa: number, sb: number, qa: Vec3, qb: Vec3) => {
    const q = (s: number): Vec3 => (sb > sa ? suma(qa, esc(sub(qb, qa), (s - sa) / (sb - sa))) : qa);
    // partes en las zonas rígidas: resultante y momento al nudo, M = e1 × ∫ (s − origen)·q(s) ds
    const alNudo = (s0: number, s1: number, v: number, origen: number) => {
      if (!(s1 > s0)) return;
      const [q0, q1] = [q(s0), q(s1)];
      const [h, r0] = [s1 - s0, s0 - origen];
      const F = esc(suma(q0, q1), h / 2);
      const M = cruz(sap.ejes[0], suma(esc(q0, (h * r0) / 2 + (h * h) / 6), esc(q1, (h * r0) / 2 + (h * h) / 3)));
      nodales[k]!.push({ nudo: v, f: [...F, ...M] as never });
    };
    alNudo(Math.max(sa, 0), Math.min(sb, sap.rigidaI), sap.nudoI, 0);
    alNudo(Math.max(sa, sap.L - sap.rigidaJ), Math.min(sb, sap.L), sap.nudoJ, sap.L);
    for (const tr of sap.trozos) {
      const [a, b] = [Math.max(sa, tr.s0), Math.min(sb, tr.s1)];
      if (!(b > a)) continue;
      deBarra[k]!.push({ tipo: "distribuida", barra: tr.barra, ejes: "global", qa: q(a), qb: q(b), a: a - tr.s0, b: b - tr.s0 });
    }
  };
  const puntual = (k: number, sap: BarraSap, s: number, F: Vec3, M: Vec3) => {
    if (s <= sap.rigidaI || s >= sap.L - sap.rigidaJ) {
      const [v, origen] = s <= sap.rigidaI ? [sap.nudoI, 0] : [sap.nudoJ, sap.L];
      nodales[k]!.push({ nudo: v, f: [...F, ...suma(M, cruz(esc(sap.ejes[0], s - origen), F))] as never });
      return;
    }
    const tr = sap.trozos.find((t) => s >= t.s0 - 1e-12 && s <= t.s1 + 1e-12)!;
    deBarra[k]!.push({ tipo: "puntual", barra: tr.barra, ejes: "global", x: Math.min(Math.max(s - tr.s0, 0), tr.s1 - tr.s0), F, M });
  };

  // Peso propio
  for (const r of tabla("LOAD PATTERN DEFINITIONS")) {
    const f = num(r, "SelfWtMult", 0);
    if (!f) continue;
    const k = idx.get(r.LoadPat!)!;
    for (const { sap, q } of pesoBarras) if (q) repartir(k, sap, 0, sap.L, [0, 0, -f * q], [0, 0, -f * q]);
    for (const { l, q } of pesoLaminas) if (q) deLamina[k]!.push({ tipo: "superficie", lamina: l, ejes: "global", q: [0, 0, -f * q] });
  }
  // Cargas «gravity»: multiplicadores (globales) del peso propio de cada elemento, con su WMod. El
  // signo es el de los ejes: MultiplierZ = −1 es el peso propio hacia abajo (comprobado con las
  // reacciones de SAP2000 v21: MultiplierZ = 2 da una carga hacia arriba de dos veces el peso)
  const multiplicadoresGravedad = (r: Registro, que: string): Vec3 | null => {
    if ((r.CoordSys ?? "GLOBAL").toUpperCase() !== "GLOBAL") {
      errores.push(`${que} no está en ejes globales.`);
      return null;
    }
    return [num(r, "MultiplierX", 0), num(r, "MultiplierY", 0), num(r, "MultiplierZ", 0)];
  };
  const pesoBarra = new Map(pesoBarras.map(({ sap, q }) => [sap, q]));
  for (const r of tabla("FRAME LOADS - GRAVITY")) {
    const k = caso(r.LoadPat, `La carga gravity de la barra ${r.Frame}`);
    const sap = barras.get(r.Frame!);
    if (!sap) errores.push(`Una carga gravity es de la barra inexistente ${r.Frame}.`);
    const g = multiplicadoresGravedad(r, `La carga gravity de la barra ${r.Frame}`);
    if (k < 0 || !sap || !g) continue;
    const q = esc(g, pesoBarra.get(sap) ?? 0);
    repartir(k, sap, 0, sap.L, q, q);
  }
  const pesoLamina = new Map(pesoLaminas.map(({ l, q }) => [l, q]));
  for (const r of tabla("AREA LOADS - GRAVITY")) {
    const k = caso(r.LoadPat, `La carga gravity del área ${r.Area}`);
    const l = laminas.get(r.Area!);
    if (l === undefined) errores.push(`Una carga gravity es del área inexistente ${r.Area}.`);
    const g = multiplicadoresGravedad(r, `La carga gravity del área ${r.Area}`);
    if (k < 0 || l === undefined || !g) continue;
    deLamina[k]!.push({ tipo: "superficie", lamina: l, ejes: "global", q: esc(g, pesoLamina.get(l) ?? 0) });
  }
  for (const r of tabla("JOINT LOADS - FORCE")) {
    const k = caso(r.LoadPat, `Una carga en el nudo ${r.Joint}`);
    const v = nudo(r.Joint, "Una carga nodal");
    if (k < 0 || v < 0) continue;
    if ((r.CoordSys ?? "GLOBAL").toUpperCase() !== "GLOBAL") errores.push(`La carga del nudo ${r.Joint} no está en ejes globales.`);
    nodales[k]!.push({ nudo: v, f: ["F1", "F2", "F3"].map((c) => num(r, c, 0) * F1).concat(["M1", "M2", "M3"].map((c) => num(r, c, 0) * F1 * L1)) as never });
  }
  const estacion = (r: Registro, sap: BarraSap, rel: string, abs: string) => (/^abs/i.test(r.DistType ?? "RelDist") ? num(r, abs) * L1 : num(r, rel) * sap.L);
  for (const r of tabla("FRAME LOADS - DISTRIBUTED")) {
    const k = caso(r.LoadPat, `Una carga de la barra ${r.Frame}`);
    const sap = barras.get(r.Frame!);
    if (k < 0 || !sap) {
      if (!sap) errores.push(`Una carga distribuida es de la barra inexistente ${r.Frame}.`);
      continue;
    }
    const d = direccion(r.Dir ?? "", sap.ejes);
    if (!d || /moment/i.test(r.Type ?? "Force") || /proj/i.test(r.Dir ?? "")) {
      errores.push(`La carga distribuida de la barra ${r.Frame} (${r.Type} ${r.Dir}) no se traduce.`);
      continue;
    }
    const f = F1 / L1;
    repartir(k, sap, estacion(r, sap, "RelDistA", "AbsDistA"), estacion(r, sap, "RelDistB", "AbsDistB"), esc(d, num(r, "FOverLA") * f), esc(d, num(r, "FOverLB") * f));
  }
  for (const r of tabla("FRAME LOADS - POINT")) {
    const k = caso(r.LoadPat, `Una carga de la barra ${r.Frame}`);
    const sap = barras.get(r.Frame!);
    if (k < 0 || !sap) {
      if (!sap) errores.push(`Una carga puntual es de la barra inexistente ${r.Frame}.`);
      continue;
    }
    const d = direccion(r.Dir ?? "", sap.ejes);
    if (!d) {
      errores.push(`La carga puntual de la barra ${r.Frame} (${r.Dir}) no se traduce.`);
      continue;
    }
    const s = estacion(r, sap, "RelDist", "AbsDist");
    if (/moment/i.test(r.Type ?? "Force")) puntual(k, sap, s, [0, 0, 0], esc(d, num(r, "Moment", num(r, "Force")) * F1 * L1));
    else puntual(k, sap, s, esc(d, num(r, "Force") * F1), [0, 0, 0]);
  }
  for (const r of tabla("AREA LOADS - UNIFORM")) {
    const k = caso(r.LoadPat, `Una carga del área ${r.Area}`);
    const l = laminas.get(r.Area!);
    if (k < 0 || l === undefined) {
      if (l === undefined) errores.push(`Una carga de área es del área inexistente ${r.Area}.`);
      continue;
    }
    const d = direccion(r.Dir ?? "", ejesLamina.get(l)!);
    if (!d || /proj/i.test(r.Dir ?? "")) {
      errores.push(`La carga del área ${r.Area} (${r.Dir}) no se traduce.`);
      continue;
    }
    deLamina[k]!.push({ tipo: "superficie", lamina: l, ejes: "global", q: esc(d, num(r, "UnifLoad") * (F1 / L1 ** 2)) });
  }

  // Casos de SAP2000
  const casosSap = new Map<string, Map<string, number>>();
  const lineales = new Set(tabla("LOAD CASE DEFINITIONS").filter((r) => /^linstatic$/i.test(r.Type ?? "")).map((r) => r.Case!));
  for (const r of tabla("CASE - STATIC 1 - LOAD ASSIGNMENTS")) {
    if (!lineales.has(r.Case!)) continue;
    if (!/pattern/i.test(r.LoadType ?? "Load pattern")) {
      avisos.push(`El caso ${r.Case} tiene una carga de tipo ${r.LoadType}, que no se compara.`);
      continue;
    }
    if (!casosSap.has(r.Case!)) casosSap.set(r.Case!, new Map());
    casosSap.get(r.Case!)!.set(r.LoadName!, num(r, "LoadSF", 1));
  }
  // Sin la tabla de casos (ficheros antiguos), un caso por patrón
  if (!casosSap.size) for (const p of patrones) casosSap.set(p, new Map([[p, 1]]));

  return {
    modelo: {
      nudos: nudosM,
      barras: modelo.barras,
      laminas: modelo.laminas,
      muelles,
      apoyos,
      restricciones,
      casos: patrones.map((p, k) => ({ id: p, nodales: nodales[k], barras: deBarra[k], laminas: deLamina[k] })),
    },
    fuerza,
    longitud,
    nudos,
    barras,
    laminas,
    patrones,
    casosSap,
    errores,
    avisos,
  };
}
