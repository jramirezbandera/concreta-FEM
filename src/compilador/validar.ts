/**
 * Paso 1 del compilador: esquema, referencias y cotas del modelo físico. Todo defecto es un
 * diagnóstico que nombra el objeto físico por su `id`; nada lanza, ni con datos basura (la
 * entrada puede venir de un fichero). Si hay errores, la compilación no sigue.
 */
import { Diagnosticos } from "../motor/diagnosticos.ts";
import { cotasPlantas } from "./cotas.ts";
import type { ApoyoFisico, ApoyoLineal, Banda, CargaFisica, CasoFisico, Losa, Material, ModeloFisico, OpcionesResueltas, Pilar, Planta, Seccion, Vec2, Viga } from "./fisico.ts";
import { areaInterseccionRegiones, defectoPoligono, distanciaEntreSegmentos, puntoEnPoligono, type Region } from "./poligonos.ts";
import { compilarSeccion, materialElastico, type SeccionCompilada } from "./secciones.ts";

/** Una losa ya comprobada, con su material de lámina y su peso propio. */
export interface LosaCompilada {
  losa: Losa;
  region: Region;
  /** Material de las láminas (E en kN/m², ν, espesor en m). */
  material: { E: number; nu: number; t: number };
  /** Peso propio, kN/m² (H24, C2-g). */
  pp: number;
  /** Peso específico del material, kN/m³. */
  gamma: number;
}

/** El modelo físico ya comprobado, con sus índices. Las listas de objetos van ordenadas por `id`. */
export interface Contexto {
  op: OpcionesResueltas;
  plantas: readonly Planta[];
  /** Cota de cada planta (de arriba abajo); NaN si no se puede saber y nadie la usa. */
  cotas: readonly number[];
  planta: ReadonlyMap<string, number>;
  /** Planta más baja (la última de la lista). */
  plantaBaja: number;
  secciones: ReadonlyMap<string, SeccionCompilada>;
  pilares: readonly Pilar[];
  vigas: readonly Viga[];
  apoyos: readonly ApoyoFisico[];
  /** En el orden del modelo físico (es el de los resultados). */
  casos: readonly CasoFisico[];
  caso: ReadonlyMap<string, number>;
  cargas: readonly CargaFisica[];
  pilarDe: ReadonlyMap<string, Pilar>;
  vigaDe: ReadonlyMap<string, Viga>;
  /** C2: losas (por id), apoyos lineales y bandas. */
  losas: readonly LosaCompilada[];
  losaDe: ReadonlyMap<string, LosaCompilada>;
  apoyosLineales: readonly ApoyoLineal[];
  bandas: readonly Banda[];
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pos = (v: unknown): v is number => num(v) && v > 0;
const vec3 = (v: unknown): boolean => Array.isArray(v) && v.length === 3 && v.every(num);
const vec2 = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && v.every(num);
const seis = (v: unknown): boolean => Array.isArray(v) && v.length === 6 && v.every((x) => typeof x === "boolean");
const porId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Qué falla en los modificadores de rigidez de las opciones, o null si están bien. */
function modificadoresNoValidos(m: unknown): string | null {
  if (!esObjeto(m)) return "no son un objeto";
  for (const [pieza, g] of Object.entries(m)) {
    if (g === undefined) continue;
    if (pieza !== "pilares" && pieza !== "vigas") return `pieza desconocida «${pieza}»`;
    if (!esObjeto(g)) return `${pieza} no es un objeto`;
    for (const [mat, mods] of Object.entries(g)) {
      if (mods === undefined) continue;
      if (!["todos", "hormigon", "acero", "general"].includes(mat)) return `material desconocido «${mat}» en ${pieza}`;
      if (!esObjeto(mods)) return `${pieza}.${mat} no es un objeto`;
      for (const [k, x] of Object.entries(mods)) {
        if (x === undefined) continue;
        if (!["A", "Avy", "Avz", "J", "Iy", "Iz"].includes(k)) return `propiedad desconocida «${k}» en ${pieza}.${mat}`;
        if (!(num(x) && x > 0 && x <= 100)) return `${pieza}.${mat}.${k} = ${String(x)}`;
      }
    }
  }
  return null;
}

/** Qué le falta a un polígono de la entrada (forma y simplicidad), o null. */
function poligonoNoValido(p: unknown): string | null {
  if (!Array.isArray(p) || !p.every(vec2)) return "tiene que ser una lista de pares [x, y] de números";
  const d = defectoPoligono(p as Vec2[], 1e-9);
  return d ? `no es un polígono simple: ${d}` : null;
}

/** Qué le falta a una polilínea de la entrada, o null. */
function polilineaNoValida(p: unknown): string | null {
  if (!Array.isArray(p) || p.length < 2 || !p.every(vec2)) return "los puntos tienen que ser una lista de al menos dos pares [x, y] de números";
  for (let k = 1; k < p.length; k++) {
    const [a, b] = [p[k - 1] as Vec2, p[k] as Vec2];
    if (!(Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) > 1e-9)) return `los puntos ${k} y ${k + 1} coinciden`;
  }
  return null;
}

/** ¿Se tocan o se cortan los lados de dos polígonos? */
function tocan(a: readonly Vec2[], b: readonly Vec2[]): boolean {
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) if (distanciaEntreSegmentos(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!) <= 1e-9) return true;
  return false;
}

export function validar(fisico: ModeloFisico, op: OpcionesResueltas, diag: Diagnosticos): Contexto | null {
  const f = fisico as unknown as Record<string, unknown>;
  if (!esObjeto(f)) {
    diag.error("fisico/no-valido", "El modelo físico no es un objeto.");
    return null;
  }
  if (!(num(op.epsGeom) && op.epsGeom > 0 && num(op.epsSnap) && op.epsSnap >= op.epsGeom && num(op.factorZonaRigida) && op.factorZonaRigida >= 0 && op.factorZonaRigida <= 1)) {
    diag.error("opciones/no-validas", "Las opciones no son válidas: hace falta 0 < ε_geom ≤ ε_snap y un factor de zona rígida en [0, 1].");
    return null;
  }
  if (!(num(op.tamanoMalla) && op.tamanoMalla >= 2 * op.epsSnap)) {
    diag.error("opciones/no-validas", `El tamaño de malla tiene que ser un número de al menos 2·ε_snap (${2 * op.epsSnap} m).`);
    return null;
  }
  const malMod = modificadoresNoValidos(op.modificadores);
  if (malMod) {
    diag.error(
      "opciones/no-validas",
      `Los modificadores de rigidez no son válidos (${malMod}): van por pilares y vigas, para todos o por material (hormigon, acero, general), y cada uno de A, Avy, Avz, J, Iy o Iz tiene que estar en (0, 100] (uno mayor es una penalización, E6-1).`,
    );
    return null;
  }
  const lista = (clave: string, obligatoria: boolean): Record<string, unknown>[] => {
    const v = f[clave];
    if (v === undefined && !obligatoria) return [];
    if (!Array.isArray(v)) {
      diag.error("fisico/no-valido", `El modelo físico no tiene la lista «${clave}».`);
      return [];
    }
    const r: Record<string, unknown>[] = [];
    v.forEach((x, i) => {
      if (esObjeto(x) && typeof x.id === "string" && x.id !== "") r.push(x);
      else diag.error("fisico/sin-id", `El elemento ${i + 1} de «${clave}» no es un objeto con un id de texto no vacío.`);
    });
    return r;
  };
  const plantas = lista("plantas", true) as unknown as Planta[];
  const materiales = lista("materiales", true) as unknown as Material[];
  const secciones = lista("secciones", true) as unknown as Seccion[];
  const pilares = (lista("pilares", false) as unknown as Pilar[]).sort(porId);
  const vigas = (lista("vigas", false) as unknown as Viga[]).sort(porId);
  const apoyos = (lista("apoyos", false) as unknown as ApoyoFisico[]).sort(porId);
  const casos = lista("casos", true) as unknown as CasoFisico[];
  const cargas = (lista("cargas", false) as unknown as CargaFisica[]).sort(porId);
  const losas = (lista("losas", false) as unknown as Losa[]).sort(porId);
  const apoyosLineales = (lista("apoyosLineales", false) as unknown as ApoyoLineal[]).sort(porId);
  const bandas = (lista("bandas", false) as unknown as Banda[]).sort(porId);
  if (diag.hayErrores) return null;

  // Ids únicos en todo el modelo
  const vistos = new Map<string, string>();
  for (const [clave, objs] of [
    ["plantas", plantas],
    ["materiales", materiales],
    ["secciones", secciones],
    ["pilares", pilares],
    ["vigas", vigas],
    ["apoyos", apoyos],
    ["casos", casos],
    ["cargas", cargas],
    ["losas", losas],
    ["apoyosLineales", apoyosLineales],
    ["bandas", bandas],
  ] as const) {
    for (const o of objs) {
      const antes = vistos.get(o.id);
      if (antes) diag.error("fisico/id-duplicado", `El id «${o.id}» está repetido (en ${antes} y en ${clave}): los ids tienen que ser únicos en todo el modelo.`, [o.id]);
      else vistos.set(o.id, clave);
    }
  }
  if (plantas.length === 0) diag.error("fisico/sin-plantas", "El modelo no tiene plantas.");
  if (casos.length === 0) diag.error("fisico/sin-casos", "El modelo no tiene casos de carga.");
  if (diag.hayErrores) return null;

  const mal = (id: string, que: string) => diag.error("fisico/valor-no-valido", `${id}: ${que}.`, [id]);

  // Plantas
  const planta = new Map<string, number>();
  plantas.forEach((p, i) => {
    planta.set(p.id, i);
    if (p.tipo !== undefined && p.tipo !== "cubierta" && p.tipo !== "planta" && p.tipo !== "sotano") mal(p.id, "el tipo de planta tiene que ser cubierta, planta o sotano");
    if (p.altura !== null && !(num(p.altura) && p.altura >= 0)) mal(p.id, "la altura tiene que ser un número ≥ 0 (o null si falta)");
    if (p.diafragma !== undefined && p.diafragma !== "rigido" && p.diafragma !== "ninguno") mal(p.id, "el diafragma tiene que ser rigido o ninguno");
  });

  // Materiales
  const material = new Map<string, Material>();
  for (const m of materiales) {
    material.set(m.id, m);
    const r = m as unknown as Record<string, unknown>;
    if (m.tipo === "hormigon") {
      if (!pos(r.fck)) mal(m.id, "fck tiene que ser un número > 0 (MPa)");
      if (r.nu !== undefined && !(num(r.nu) && (r.nu as number) > -1 && (r.nu as number) < 0.5)) mal(m.id, "ν tiene que estar en (−1, 0,5)");
      if (r.peso !== undefined && !(num(r.peso) && (r.peso as number) >= 0)) mal(m.id, "el peso específico tiene que ser ≥ 0");
    } else if (m.tipo === "acero") {
      if (r.E !== undefined && !pos(r.E)) mal(m.id, "E tiene que ser un número > 0 (MPa)");
      if (r.peso !== undefined && !(num(r.peso) && (r.peso as number) >= 0)) mal(m.id, "el peso específico tiene que ser ≥ 0");
    } else if (m.tipo === "general") {
      if (!pos(r.E) || !pos(r.G)) mal(m.id, "E y G tienen que ser números > 0 (kN/m²)");
      if (!(num(r.peso) && (r.peso as number) >= 0)) mal(m.id, "el peso específico tiene que ser un número ≥ 0 (kN/m³)");
    } else mal((m as { id: string }).id, "el tipo de material tiene que ser hormigon, acero o general");
  }

  // Secciones
  const seccionFisica = new Map<string, Seccion>();
  for (const s of secciones) {
    seccionFisica.set(s.id, s);
    const r = s as unknown as Record<string, unknown>;
    if (typeof r.material !== "string" || !material.has(r.material)) diag.error("fisico/referencia", `${s.id}: el material «${String(r.material)}» no existe.`, [s.id]);
    switch (s.forma) {
      case "rectangular":
        if (!pos(r.b) || !pos(r.h)) mal(s.id, "b y h tienen que ser números > 0 (m)");
        break;
      case "circular":
        if (!pos(r.D)) mal(s.id, "D tiene que ser un número > 0 (m)");
        break;
      case "I": {
        const p = r.perfil as Record<string, unknown> | undefined;
        if (!esObjeto(p) || !["A", "Iy", "Iz", "It", "h", "b", "tf", "tw"].every((k) => pos(p[k]))) mal(s.id, "el perfil necesita A, Iy, Iz, It, h, b, tf y tw > 0 (cm², cm⁴ y mm)");
        break;
      }
      case "T":
        if (![r.bf, r.hf, r.bw, r.h].every(pos)) mal(s.id, "bf, hf, bw y h tienen que ser números > 0 (m)");
        else if (!((r.hf as number) < (r.h as number) && (r.bw as number) <= (r.bf as number))) mal(s.id, "la T necesita hf < h y bw ≤ bf");
        break;
      case "general":
        if (![r.A, r.Iy, r.Iz, r.J].every(pos)) mal(s.id, "A, Iy, Iz y J tienen que ser números > 0");
        for (const k of ["Avy", "Avz", "b", "h"]) if (r[k] !== undefined && !pos(r[k])) mal(s.id, `${k} tiene que ser un número > 0`);
        break;
      default:
        mal((s as { id: string }).id, "la forma tiene que ser rectangular, circular, I, T o general");
    }
  }
  const usaSeccion = (id: string, s: unknown) => {
    if (typeof s !== "string" || !seccionFisica.has(s)) diag.error("fisico/referencia", `${id}: la sección «${String(s)}» no existe.`, [id]);
  };
  const usaPlanta = (id: string, p: unknown, que = "la planta") => {
    if (typeof p !== "string" || !planta.has(p)) {
      diag.error("fisico/referencia", `${id}: ${que} «${String(p)}» no existe.`, [id]);
      return false;
    }
    return true;
  };
  const liberaciones = (id: string, l: unknown, claves: readonly string[]) => {
    if (l === undefined) return;
    if (!esObjeto(l) || Object.keys(l).some((k) => !claves.includes(k)) || claves.some((k) => l[k] !== undefined && !seis(l[k])))
      mal(id, `las liberaciones tienen que ser { ${claves.join(", ")} } con 6 booleanos cada una ([N, Vy, Vz, T, My, Mz])`);
  };

  // Pilares
  for (const p of pilares) {
    if (!num(p.x) || !num(p.y)) mal(p.id, "x e y tienen que ser números (m)");
    const okD = usaPlanta(p.id, p.desde, "la planta de arranque");
    const okH = usaPlanta(p.id, p.hasta, "la planta de cabeza");
    if (okD && okH && !(planta.get(p.desde)! > planta.get(p.hasta)!)) mal(p.id, "la planta de arranque tiene que estar por debajo de la de cabeza");
    usaSeccion(p.id, p.seccion);
    if (p.tramos !== undefined) {
      if (!Array.isArray(p.tramos)) mal(p.id, "los tramos tienen que ser una lista de { planta, seccion }");
      else {
        const vistas = new Set<string>();
        for (const t of p.tramos) {
          if (!esObjeto(t)) {
            mal(p.id, "cada tramo tiene que ser { planta, seccion }");
            continue;
          }
          usaSeccion(p.id, t.seccion);
          if (!usaPlanta(p.id, t.planta, "la planta del tramo")) continue;
          const k = planta.get(t.planta as string)!;
          if (okD && okH && !(k >= planta.get(p.hasta)! && k < planta.get(p.desde)!)) mal(p.id, `el tramo con cabeza en ${String(t.planta)} no está entre su arranque y su cabeza`);
          if (vistas.has(t.planta as string)) mal(p.id, `el tramo con cabeza en ${String(t.planta)} está repetido`);
          vistas.add(t.planta as string);
        }
      }
    }
    if (p.giro !== undefined && !num(p.giro)) mal(p.id, "el giro tiene que ser un número (grados)");
    if (p.base !== undefined && p.base !== "empotrado" && p.base !== "articulado" && p.base !== "ninguno") mal(p.id, "la base tiene que ser empotrado, articulado o ninguno");
    liberaciones(p.id, p.liberaciones, ["base", "cabeza"]);
  }

  // Vigas
  for (const v of vigas) {
    usaPlanta(v.id, v.planta);
    usaSeccion(v.id, v.seccion);
    liberaciones(v.id, v.liberaciones, ["inicio", "fin"]);
    if (v.insercion !== undefined && v.insercion !== "plano" && v.insercion !== "superior") mal(v.id, "la inserción tiene que ser plano o superior");
    if (!Array.isArray(v.puntos) || v.puntos.length < 2 || !v.puntos.every(vec2)) {
      mal(v.id, "los puntos tienen que ser una lista de al menos dos pares [x, y] de números");
      continue;
    }
    for (let k = 1; k < v.puntos.length; k++) {
      const [a, b] = [v.puntos[k - 1]!, v.puntos[k]!];
      if (!(Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) > op.epsGeom)) {
        mal(v.id, `los puntos ${k} y ${k + 1} coinciden`);
        break;
      }
      if (k >= 2) {
        const c = v.puntos[k - 2]!;
        const u = [a[0] - c[0], a[1] - c[1]];
        const w = [b[0] - a[0], b[1] - a[1]];
        const cruz = u[0]! * w[1]! - u[1]! * w[0]!;
        const prod = u[0]! * w[0]! + u[1]! * w[1]!;
        if (prod < 0 && Math.abs(cruz) <= 1e-9 * Math.abs(prod)) {
          mal(v.id, `la polilínea vuelve sobre sí misma en el punto ${k}`);
          break;
        }
      }
    }
  }

  // Apoyos
  for (const a of apoyos) {
    usaPlanta(a.id, a.planta);
    if (!num(a.x) || !num(a.y)) mal(a.id, "x e y tienen que ser números (m)");
    if (!seis(a.coartados) || !a.coartados.some(Boolean)) mal(a.id, "coartados tienen que ser 6 booleanos, con alguno verdadero");
  }

  // Casos y cargas
  const caso = new Map<string, number>();
  casos.forEach((c, i) => caso.set(c.id, i));
  const conPeso = casos.filter((c) => c.pesoPropio === true);
  if (conPeso.length > 1)
    diag.error(
      "caso/peso-propio-repetido",
      `Hay ${conPeso.length} casos con el peso propio (${conPeso.map((c) => c.id).join(", ")}); como mucho, uno.`,
      conPeso.map((c) => c.id),
    );
  const pilarDe = new Map(pilares.map((p) => [p.id, p] as const));
  const vigaDe = new Map(vigas.map((v) => [v.id, v] as const));
  for (const c of cargas) {
    const r = c as unknown as Record<string, unknown>;
    if (typeof r.caso !== "string" || !caso.has(r.caso)) diag.error("fisico/referencia", `${c.id}: el caso «${String(r.caso)}» no existe.`, [c.id]);
    if (c.tipo === "puntual") {
      usaPlanta(c.id, c.planta);
      if (!num(c.x) || !num(c.y)) mal(c.id, "x e y tienen que ser números (m)");
      if ((c.F !== undefined && !vec3(c.F)) || (c.M !== undefined && !vec3(c.M)) || (c.F === undefined && c.M === undefined)) mal(c.id, "la carga puntual necesita F o M, vectores de 3 números");
    } else if (c.tipo === "viga" || c.tipo === "pilar") {
      const destino = c.tipo === "viga" ? r.viga : r.pilar;
      if (typeof destino !== "string" || !(c.tipo === "viga" ? vigaDe : pilarDe).has(destino)) diag.error("fisico/referencia", `${c.id}: ${c.tipo === "viga" ? "la viga" : "el pilar"} «${String(destino)}» no existe.`, [c.id]);
      if (c.ejes !== "global" && c.ejes !== "local") mal(c.id, "los ejes tienen que ser global o local");
      if (!vec3(c.q) || (c.qb !== undefined && !vec3(c.qb))) mal(c.id, "q (y qb) tienen que ser vectores de 3 números (kN/m)");
      if ((c.desde !== undefined && !num(c.desde)) || (c.hasta !== undefined && !num(c.hasta))) mal(c.id, "desde y hasta tienen que ser números (m)");
      else if (c.desde !== undefined && c.hasta !== undefined && !(c.hasta > c.desde)) mal(c.id, "hasta tiene que ser mayor que desde");
    } else if (c.tipo === "superficie") {
      usaPlanta(c.id, c.planta);
      if (!vec3(c.q)) mal(c.id, "q tiene que ser un vector de 3 números (kN/m²)");
      if (c.losa === undefined && c.zona === undefined) mal(c.id, "la carga de superficie necesita una losa, una zona o las dos");
      if (c.losa !== undefined) {
        const l = losas.find((x) => x.id === c.losa);
        if (!l) diag.error("fisico/referencia", `${c.id}: la losa «${String(c.losa)}» no existe.`, [c.id]);
        else if (l.planta !== c.planta) mal(c.id, `la losa ${l.id} no está en la planta ${String(c.planta)}`);
      }
      if (c.zona !== undefined) {
        const d = poligonoNoValido(c.zona);
        if (d) mal(c.id, `la zona ${d}`);
      }
    } else if (c.tipo === "lineal") {
      usaPlanta(c.id, c.planta);
      if (!vec3(c.q)) mal(c.id, "q tiene que ser un vector de 3 números (kN/m)");
      const d = polilineaNoValida(c.puntos);
      if (d) mal(c.id, d);
    } else mal((c as { id: string }).id, "el tipo de carga tiene que ser puntual, viga, pilar, superficie o lineal");
  }

  // Losas, apoyos lineales y bandas (C2)
  const losasC: LosaCompilada[] = [];
  for (const l of losas) {
    usaPlanta(l.id, l.planta);
    if (!pos(l.espesor)) mal(l.id, "el espesor tiene que ser un número > 0 (m)");
    if (l.pp !== undefined && !(num(l.pp) && l.pp >= 0)) mal(l.id, "el peso propio pp tiene que ser un número ≥ 0 (kN/m²)");
    if (l.eje1 !== undefined && !num(l.eje1)) mal(l.id, "el eje 1 tiene que ser un número (grados)");
    const m = typeof l.material === "string" ? material.get(l.material) : undefined;
    if (!m) diag.error("fisico/referencia", `${l.id}: el material «${String(l.material)}» no existe.`, [l.id]);
    else if (m.tipo === "acero") mal(l.id, "el material de una losa tiene que ser hormigón o general");
    const dc = poligonoNoValido(l.contorno);
    if (dc) {
      mal(l.id, `el contorno ${dc}`);
      continue;
    }
    if (l.huecos !== undefined && !Array.isArray(l.huecos)) {
      mal(l.id, "los huecos tienen que ser una lista de polígonos");
      continue;
    }
    const huecos = (l.huecos ?? []) as readonly (readonly Vec2[])[];
    let huecosBien = true;
    huecos.forEach((h, i) => {
      const dh = poligonoNoValido(h);
      if (dh) {
        mal(l.id, `el hueco ${i + 1} ${dh}`);
        huecosBien = false;
      } else if (!h.every((q) => puntoEnPoligono(q, l.contorno)) || tocan(h, l.contorno)) {
        mal(l.id, `el hueco ${i + 1} no está dentro del contorno (o lo toca)`);
        huecosBien = false;
      }
    });
    for (let i = 0; i < huecos.length && huecosBien; i++)
      for (let j = i + 1; j < huecos.length; j++)
        if (tocan(huecos[i]!, huecos[j]!) || huecos[i]!.some((q) => puntoEnPoligono(q, huecos[j]!)) || huecos[j]!.some((q) => puntoEnPoligono(q, huecos[i]!))) {
          mal(l.id, `los huecos ${i + 1} y ${j + 1} se solapan o se tocan`);
          huecosBien = false;
        }
    if (!huecosBien || !m || m.tipo === "acero" || !pos(l.espesor)) continue;
    const { elastico, peso } = materialElastico(m);
    const nu = elastico.E / (2 * elastico.G) - 1;
    if (!(nu > -1 && nu < 0.5)) {
      mal(l.id, `el material ${m.id} da ν = ${nu.toPrecision(4)} (con E y G), fuera de (−1, 0,5)`);
      continue;
    }
    losasC.push({ losa: l, region: { contorno: l.contorno, huecos }, material: { E: elastico.E, nu, t: l.espesor }, pp: l.pp ?? peso * l.espesor, gamma: peso });
  }
  // Losas solapadas en una planta
  for (let i = 0; i < losasC.length; i++) {
    for (let j = i + 1; j < losasC.length; j++) {
      const [a, b] = [losasC[i]!, losasC[j]!];
      if (a.losa.planta !== b.losa.planta) continue;
      const A = areaInterseccionRegiones(a.region, b.region);
      if (A > op.epsSnap * op.epsSnap)
        diag.error("losa/solapadas", `Las losas ${a.losa.id} y ${b.losa.id} se solapan en ${A.toPrecision(3)} m² en la planta ${a.losa.planta}.`, [a.losa.id, b.losa.id]);
    }
  }
  for (const a of apoyosLineales) {
    usaPlanta(a.id, a.planta);
    const d = polilineaNoValida(a.puntos);
    if (d) mal(a.id, d);
    if (!seis(a.coartados) || !a.coartados.some(Boolean)) mal(a.id, "coartados tienen que ser 6 booleanos, con alguno verdadero");
  }
  for (const b of bandas) {
    usaPlanta(b.id, b.planta);
    if (!vec2(b.desde) || !vec2(b.hasta)) mal(b.id, "desde y hasta tienen que ser pares [x, y] de números");
    else if (!(Math.sqrt((b.hasta[0] - b.desde[0]) ** 2 + (b.hasta[1] - b.desde[1]) ** 2) > op.epsGeom)) mal(b.id, "desde y hasta coinciden");
    if (!pos(b.ancho)) mal(b.id, "el ancho tiene que ser un número > 0 (m)");
  }
  if (diag.hayErrores) return null;

  // Cotas: las de las plantas que se usan tienen que poder saberse
  const cotas = cotasPlantas(plantas);
  const usadas = new Map<number, string>();
  const usar = (k: number, id: string) => {
    if (!usadas.has(k)) usadas.set(k, id);
  };
  for (const p of pilares) for (let k = planta.get(p.hasta)!; k <= planta.get(p.desde)!; k++) usar(k, p.id);
  for (const v of vigas) usar(planta.get(v.planta)!, v.id);
  for (const a of apoyos) usar(planta.get(a.planta)!, a.id);
  for (const c of cargas) if (c.tipo === "puntual" || c.tipo === "superficie" || c.tipo === "lineal") usar(planta.get(c.planta)!, c.id);
  for (const o of [...losas, ...apoyosLineales, ...bandas]) usar(planta.get(o.planta)!, o.id);
  for (const [k, id] of [...usadas].sort((a, b) => a[0] - b[0])) {
    if (cotas[k] === null) {
      const p = plantas[k]!;
      diag.error(
        "planta/sin-cota",
        `No se puede saber la cota de la planta ${p.nombre ?? p.id} (la usa ${id}): falta la altura de alguna planta entre ella y la planta sobre rasante más baja.`,
        [p.id, id],
      );
    }
  }
  if (diag.hayErrores) return null;
  for (const p of pilares) {
    for (let k = planta.get(p.hasta)!; k < planta.get(p.desde)!; k++) {
      if (!(cotas[k]! - cotas[k + 1]! > op.epsGeom)) mal(p.id, `el tramo con cabeza en ${plantas[k]!.id} tiene altura nula`);
    }
  }
  if (diag.hayErrores) return null;

  const compiladas = new Map<string, SeccionCompilada>();
  for (const s of secciones) compiladas.set(s.id, compilarSeccion(s, material.get(s.material)!, op.cortante));
  return {
    op,
    plantas,
    cotas: cotas.map((c) => c ?? Number.NaN),
    planta,
    plantaBaja: plantas.length - 1,
    secciones: compiladas,
    pilares,
    vigas,
    apoyos,
    casos,
    caso,
    cargas,
    pilarDe,
    vigaDe,
    losas: losasC,
    losaDe: new Map(losasC.map((l) => [l.losa.id, l] as const)),
    apoyosLineales,
    bandas,
  };
}
