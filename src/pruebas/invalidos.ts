/**
 * Catálogo de entradas no válidas para el criterio 4 de E6: cada una estropea un dato de un modelo
 * válido (de `aleatorio.ts`). No es código del motor.
 *
 * Son valores que el compilador o un JSON pueden traer aunque los tipos de TypeScript no los dejen
 * escribir: índices fuera de rango, NaN e infinitos, propiedades nulas o negativas, vectores de otra
 * longitud, geometría degenerada, restricciones incompatibles, cargas fuera de su objeto… y algunos
 * campos que faltan (`contrato`: el tipo los exige). `calcular` tiene que devolver siempre un
 * resultado: no válido con un error con código o, si el dato es inocuo, válido y en equilibrio.
 */
import type { ModeloAnalitico } from "../motor/modelo.ts";
import { generador } from "./aleatorio.ts";

/** Modelo mutable (copia profunda) para estropearlo sin los tipos de solo lectura. */
// biome-ignore lint: el catálogo rompe los tipos a propósito
type Mutable = any;

export interface EntradaNoValida {
  id: string;
  descripcion: string;
  /** Estropea `m` (una copia); devuelve false si el modelo no tiene el objeto que hace falta. */
  aplicar: (m: Mutable, azar: () => number) => boolean;
  /** Códigos de error aceptables; vacío: cualquier error (o un resultado válido). */
  codigos: string[];
  /** Rompe el contrato de tipos (un campo obligatorio que falta o de otro tipo). */
  contrato?: boolean;
}

const elegir = (l: readonly Mutable[], r: () => number): Mutable => l[Math.floor(r() * l.length)];
const indice = (n: number, r: () => number) => Math.floor(r() * n);
const conTipo = (m: Mutable, tipo: string) => (m.restricciones ?? []).map((x: Mutable, i: number) => [x, i]).filter(([x]: [Mutable]) => x.tipo === tipo);
const PROP = "modelo/propiedad-no-valida";
const NUDO = "modelo/nudo-no-valido";
const CARGA = "carga/no-valida";

/** Barras verticales (pilares) y horizontales (vigas), por sus nudos. */
const verticales = (m: Mutable) => m.barras.filter((b: Mutable) => Math.abs(m.nudos[b.nudos[0]].z - m.nudos[b.nudos[1]].z) > 1);

export const ENTRADAS_NO_VALIDAS: EntradaNoValida[] = [
  // ---------------------------------------------------------------- nudos
  { id: "nudo-nan", descripcion: "coordenada NaN", codigos: ["modelo/valor-no-finito"], aplicar: (m, r) => ((m.nudos[indice(m.nudos.length, r)].x = Number.NaN), true) },
  { id: "nudo-infinito", descripcion: "coordenada infinita", codigos: ["modelo/valor-no-finito"], aplicar: (m, r) => ((m.nudos[indice(m.nudos.length, r)].z = Infinity), true) },
  { id: "nudo-sin-y", descripcion: "nudo sin coordenada y", codigos: ["modelo/valor-no-finito"], contrato: true, aplicar: (m, r) => (delete m.nudos[indice(m.nudos.length, r)].y, true) },
  // ---------------------------------------------------------------- barras
  { id: "barra-nudo-fuera", descripcion: "barra con un nudo inexistente", codigos: [NUDO], aplicar: (m, r) => ((elegir(m.barras, r) as Mutable).nudos[1] = m.nudos.length + 3, true) },
  { id: "barra-nudo-negativo", descripcion: "barra con un índice de nudo negativo", codigos: [NUDO], aplicar: (m, r) => ((elegir(m.barras, r) as Mutable).nudos[0] = -1, true) },
  { id: "barra-nudo-repetido", descripcion: "barra con el mismo nudo en los dos extremos", codigos: [NUDO], aplicar: (m, r) => { const b = elegir(m.barras, r) as Mutable; b.nudos[1] = b.nudos[0]; return true; } },
  { id: "barra-nudo-decimal", descripcion: "barra con un índice de nudo no entero", codigos: [NUDO], aplicar: (m, r) => ((elegir(m.barras, r) as Mutable).nudos[0] += 0.5, true) },
  { id: "barra-E-nula", descripcion: "barra con E = 0", codigos: [PROP], aplicar: (m, r) => ((elegir(m.barras, r) as Mutable).seccion = { ...elegir(m.barras, r).seccion, E: 0 }, true) },
  { id: "barra-I-negativa", descripcion: "barra con Iy < 0", codigos: [PROP], aplicar: (m, r) => { const b = elegir(m.barras, r) as Mutable; b.seccion = { ...b.seccion, Iy: -b.seccion.Iy }; return true; } },
  { id: "barra-J-nan", descripcion: "barra con J = NaN", codigos: [PROP], aplicar: (m, r) => { const b = elegir(m.barras, r) as Mutable; b.seccion = { ...b.seccion, J: Number.NaN }; return true; } },
  { id: "barra-Av-nula", descripcion: "barra con Avz = 0", codigos: [PROP], aplicar: (m, r) => { const b = elegir(m.barras, r) as Mutable; b.seccion = { ...b.seccion, Avz: 0 }; return true; } },
  { id: "barra-sin-seccion", descripcion: "barra sin sección", codigos: [PROP], contrato: true, aplicar: (m, r) => (delete (elegir(m.barras, r) as Mutable).seccion, true) },
  { id: "barra-vz-nulo", descripcion: "vector de canto nulo", codigos: ["modelo/orientacion-no-valida", PROP], aplicar: (m, r) => (((elegir(m.barras, r) as Mutable).vz = [0, 0, 0]), true) },
  { id: "barra-vz-paralelo", descripcion: "vector de canto paralelo al pilar", codigos: ["modelo/orientacion-no-valida"], aplicar: (m, r) => { const v = verticales(m); if (!v.length) return false; elegir(v, r).vz = [0, 0, 2]; return true; } },
  { id: "barra-vz-corto", descripcion: "vector de canto de 2 componentes", codigos: [PROP], aplicar: (m, r) => (((elegir(m.barras, r) as Mutable).vz = [1, 0]), true) },
  { id: "barra-sin-vz", descripcion: "barra sin vector de canto", codigos: [PROP], contrato: true, aplicar: (m, r) => (delete (elegir(m.barras, r) as Mutable).vz, true) },
  {
    id: "barra-offsets-solapados",
    descripcion: "offsets que se comen la barra",
    codigos: ["modelo/elemento-degenerado", "modelo/offset-no-valido"],
    aplicar: (m, r) => {
      const b = elegir(m.barras, r) as Mutable;
      const [i, j] = b.nudos.map((v: number) => m.nudos[v]);
      b.offsets = { i: [j.x - i.x, j.y - i.y, j.z - i.z] };
      return true;
    },
  },
  { id: "barra-offset-nan", descripcion: "offset con NaN", codigos: ["modelo/offset-no-valido"], aplicar: (m, r) => (((elegir(m.barras, r) as Mutable).offsets = { j: [0, Number.NaN, 0] }), true) },
  { id: "barra-liberacion-inestable", descripcion: "axil liberado en los dos extremos", codigos: ["modelo/liberacion-inestable"], aplicar: (m, r) => { const lib = [true, false, false, false, false, false]; (elegir(m.barras, r) as Mutable).liberaciones = { i: lib, j: lib }; return true; } },
  { id: "barra-liberacion-corta", descripcion: "liberaciones de 5 valores", codigos: [PROP], aplicar: (m, r) => (((elegir(m.barras, r) as Mutable).liberaciones = { i: [false, false, false, false, true] }), true) },
  { id: "barra-modificador-nulo", descripcion: "modificador de inercia 0", codigos: [PROP], aplicar: (m, r) => (((elegir(m.barras, r) as Mutable).modificadores = { Iy: 0 }), true) },
  { id: "barra-modificador-nan", descripcion: "modificador NaN", codigos: [PROP], aplicar: (m, r) => (((elegir(m.barras, r) as Mutable).modificadores = { A: Number.NaN }), true) },
  {
    id: "barra-longitud-nula",
    descripcion: "barra entre dos nudos coincidentes",
    codigos: ["modelo/elemento-degenerado"],
    aplicar: (m, r) => {
      const b = elegir(m.barras, r) as Mutable;
      const a = m.nudos[b.nudos[0]];
      m.nudos.push({ id: "gemelo", x: a.x, y: a.y, z: a.z });
      b.nudos[1] = m.nudos.length - 1;
      b.offsets = undefined;
      return true;
    },
  },
  // ---------------------------------------------------------------- láminas
  { id: "lamina-nudo-fuera", descripcion: "lámina con un nudo inexistente", codigos: [NUDO], aplicar: (m, r) => { if (!m.laminas.length) return false; elegir(m.laminas, r).nudos[2] = 10 ** 6; return true; } },
  { id: "lamina-tres-nudos", descripcion: "lámina de 3 nudos", codigos: [NUDO], aplicar: (m, r) => { if (!m.laminas.length) return false; const l = elegir(m.laminas, r) as Mutable; l.nudos = l.nudos.slice(0, 3); return true; } },
  { id: "lamina-nudo-repetido", descripcion: "lámina con un nudo repetido", codigos: [NUDO], aplicar: (m, r) => { if (!m.laminas.length) return false; const l = elegir(m.laminas, r) as Mutable; l.nudos[3] = l.nudos[1]; return true; } },
  { id: "lamina-t-nulo", descripcion: "espesor 0", codigos: [PROP], aplicar: (m, r) => { if (!m.laminas.length) return false; const l = elegir(m.laminas, r) as Mutable; l.material = { ...l.material, t: 0 }; return true; } },
  { id: "lamina-nu-medio", descripcion: "ν = 0,5", codigos: [PROP], aplicar: (m, r) => { if (!m.laminas.length) return false; const l = elegir(m.laminas, r) as Mutable; l.material = { ...l.material, nu: 0.5 }; return true; } },
  { id: "lamina-E-nan", descripcion: "E = NaN", codigos: [PROP], aplicar: (m, r) => { if (!m.laminas.length) return false; const l = elegir(m.laminas, r) as Mutable; l.material = { ...l.material, E: Number.NaN }; return true; } },
  { id: "lamina-sin-material", descripcion: "lámina sin material", codigos: [PROP], contrato: true, aplicar: (m, r) => { if (!m.laminas.length) return false; delete elegir(m.laminas, r).material; return true; } },
  {
    id: "lamina-cruzada",
    descripcion: "nudos de la lámina en orden cruzado (pajarita)",
    codigos: ["modelo/elemento-degenerado"],
    aplicar: (m, r) => {
      if (!m.laminas.length) return false;
      const l = elegir(m.laminas, r) as Mutable;
      l.nudos = [l.nudos[0], l.nudos[2], l.nudos[1], l.nudos[3]];
      return true;
    },
  },
  {
    id: "lamina-alabeada",
    descripcion: "un nudo de forjado subido 0,1 m (láminas alabeadas)",
    codigos: ["modelo/lamina-alabeada"],
    aplicar: (m, r) => {
      const horizontales = m.laminas.filter((l: Mutable) => l.nudos.every((v: number) => Math.abs(m.nudos[v].z - m.nudos[l.nudos[0]].z) < 1e-9));
      if (!horizontales.length) return false;
      m.nudos[elegir(horizontales, r).nudos[elegir([0, 1, 2, 3], r)]].z += 0.1;
      return true;
    },
  },
  {
    id: "lamina-eje1-normal",
    descripcion: "eje 1 normal al plano de la lámina",
    codigos: ["modelo/orientacion-no-valida"],
    aplicar: (m, r) => {
      const horizontales = m.laminas.filter((l: Mutable) => l.nudos.every((v: number) => Math.abs(m.nudos[v].z - m.nudos[l.nudos[0]].z) < 1e-9));
      if (!horizontales.length) return false;
      elegir(horizontales, r).eje1 = [0, 0, -3];
      return true;
    },
  },
  { id: "lamina-eje1-nan", descripcion: "eje 1 con NaN", codigos: ["modelo/orientacion-no-valida"], aplicar: (m, r) => { if (!m.laminas.length) return false; elegir(m.laminas, r).eje1 = [1, Number.NaN, 0]; return true; } },
  { id: "lamina-eje1-corto", descripcion: "eje 1 de 2 componentes", codigos: ["modelo/orientacion-no-valida"], aplicar: (m, r) => { if (!m.laminas.length) return false; elegir(m.laminas, r).eje1 = [1, 0]; return true; } },
  { id: "lamina-multiplicador-negativo", descripcion: "multiplicador m11 < 0", codigos: [PROP], aplicar: (m, r) => { if (!m.laminas.length) return false; elegir(m.laminas, r).multiplicadores = { m11: -0.3 }; return true; } },
  { id: "lamina-gamma-nulo", descripcion: "γ/G del drilling = 0", codigos: [PROP], aplicar: (m, r) => { if (!m.laminas.length) return false; elegir(m.laminas, r).membrana = { gamma: 0 }; return true; } },
  // ---------------------------------------------------------------- muelles
  { id: "muelle-k-corta", descripcion: "muelle con 5 rigideces", codigos: [PROP], aplicar: (m, r) => { if (!m.muelles.length) return false; elegir(m.muelles, r).k = [1, 2, 3, 4, 5]; return true; } },
  { id: "muelle-k-negativa", descripcion: "muelle con una rigidez negativa", codigos: [PROP], aplicar: (m, r) => { if (!m.muelles.length) return false; const s = elegir(m.muelles, r) as Mutable; s.k = s.k.length === 6 ? [-1e6, ...s.k.slice(1)] : s.k.map((v: number, i: number) => (i === 0 ? -Math.abs(v) : v)); return true; } },
  { id: "muelle-k-asimetrica", descripcion: "matriz de rigidez no simétrica", codigos: [PROP], aplicar: (m, r) => { if (!m.muelles.length) return false; const k: number[] = Array.from({ length: 36 }, (_, i) => (i % 7 === 0 ? 1e6 : 0)); k[1] = 5e5; elegir(m.muelles, r).k = k; return true; } },
  { id: "muelle-k-nan", descripcion: "rigidez NaN", codigos: [PROP], aplicar: (m, r) => { if (!m.muelles.length) return false; const s = elegir(m.muelles, r) as Mutable; s.k = s.k.map((v: number, i: number) => (i === 2 ? Number.NaN : v)); return true; } },
  { id: "muelle-ejes-zurdos", descripcion: "ejes del muelle levógiros", codigos: ["modelo/orientacion-no-valida"], aplicar: (m, r) => { if (!m.muelles.length) return false; elegir(m.muelles, r).ejes = [1, 0, 0, 0, 1, 0, 0, 0, -1]; return true; } },
  { id: "muelle-ejes-no-ortonormales", descripcion: "ejes del muelle no ortonormales", codigos: ["modelo/orientacion-no-valida"], aplicar: (m, r) => { if (!m.muelles.length) return false; elegir(m.muelles, r).ejes = [1, 0, 0, 0.5, 1, 0, 0, 0, 1]; return true; } },
  {
    id: "muelle-separado",
    descripcion: "muelle entre dos nudos separados",
    codigos: ["modelo/muelle-no-nulo"],
    aplicar: (m, r) => {
      const dobles = m.muelles.filter((s: Mutable) => s.nudos.length === 2);
      if (!dobles.length) return false;
      const s = elegir(dobles, r) as Mutable;
      s.nudos = [s.nudos[0], m.barras[0].nudos[1]];
      return s.nudos[0] !== s.nudos[1];
    },
  },
  { id: "muelle-nudo-fuera", descripcion: "muelle sobre un nudo inexistente", codigos: [NUDO], aplicar: (m, r) => { if (!m.muelles.length) return false; elegir(m.muelles, r).nudos = [m.nudos.length]; return true; } },
  // ---------------------------------------------------------------- apoyos
  { id: "apoyo-nudo-fuera", descripcion: "apoyo sobre un nudo inexistente", codigos: ["modelo/apoyo-no-valido"], aplicar: (m) => (m.apoyos.push({ nudo: m.nudos.length + 1, coartados: [true, true, true, true, true, true] }), true) },
  { id: "apoyo-cinco", descripcion: "apoyo con 5 GDL", codigos: ["modelo/apoyo-no-valido"], aplicar: (m, r) => { if (!m.apoyos.length) return false; elegir(m.apoyos, r).coartados = [true, true, true, true, true]; return true; } },
  {
    id: "sin-apoyos",
    descripcion: "sin apoyos ni muelles a tierra",
    codigos: ["modelo/parte-sin-apoyo"],
    aplicar: (m) => {
      m.apoyos = [];
      m.muelles = m.muelles.filter((s: Mutable) => s.nudos.length === 2);
      for (const c of m.casos) c.impuestos = [];
      return true;
    },
  },
  {
    id: "apoyo-en-esclavo",
    descripcion: "apoyo en un esclavo de diafragma",
    codigos: ["restriccion/apoyo-en-esclavo"],
    aplicar: (m, r) => {
      const d = conTipo(m, "diafragma");
      if (!d.length) return false;
      m.apoyos.push({ nudo: elegir(elegir(d, r)[0].esclavos, r), coartados: [true, false, false, false, false, false] });
      return true;
    },
  },
  // ---------------------------------------------------------------- restricciones
  { id: "restriccion-maestro-fuera", descripcion: "maestro inexistente", codigos: ["restriccion/nudo-no-valido"], aplicar: (m, r) => { if (!m.restricciones.length) return false; elegir(m.restricciones, r).maestro = -2; return true; } },
  {
    id: "restriccion-esclavo-maestro",
    descripcion: "el maestro es también esclavo de sí mismo",
    codigos: ["restriccion/nudo-no-valido"],
    aplicar: (m, r) => {
      if (!m.restricciones.length) return false;
      const x = elegir(m.restricciones, r) as Mutable;
      x.esclavos = [...x.esclavos, x.maestro];
      return true;
    },
  },
  {
    id: "restriccion-esclavo-doble",
    descripcion: "un nudo esclavo de dos restricciones",
    codigos: ["restriccion/esclavo-doble"],
    aplicar: (m, r) => {
      const d = conTipo(m, "diafragma");
      const e = conTipo(m, "enlace-rigido");
      if (!d.length || !e.length) return false;
      const enlace = elegir(e, r)[0];
      const diafragma = d.find(([x]: [Mutable]) => Math.abs(m.nudos[x.maestro].z - m.nudos[enlace.maestro].z) < 1e-9);
      if (!diafragma) return false;
      diafragma[0].esclavos = [...diafragma[0].esclavos, enlace.esclavos[0]];
      return true;
    },
  },
  {
    id: "diafragma-otra-cota",
    descripcion: "diafragma con un nudo de otra cota",
    codigos: ["restriccion/diafragma-no-plano"],
    aplicar: (m, r) => {
      const d = conTipo(m, "diafragma");
      if (!d.length) return false;
      const x = elegir(d, r)[0];
      const z = m.nudos[x.maestro].z;
      const otro = m.nudos.findIndex((v: Mutable, i: number) => Math.abs(v.z - z) > 0.5 && !m.apoyos.some((a: Mutable) => a.nudo === i));
      if (otro < 0) return false;
      x.esclavos = [...x.esclavos, otro];
      return true;
    },
  },
  { id: "restriccion-tipo", descripcion: "restricción de tipo desconocido", codigos: ["restriccion/tipo-no-valido"], aplicar: (m, r) => { if (!m.restricciones.length) return false; elegir(m.restricciones, r).tipo = "soldadura"; return true; } },
  {
    id: "restriccion-ciclo",
    descripcion: "cadena cerrada: A esclavo de B y B esclavo de A",
    codigos: ["restriccion/ciclo"],
    aplicar: (m, r) => {
      const e = conTipo(m, "enlace-rigido");
      if (!e.length) return false;
      const x = elegir(e, r)[0];
      m.restricciones.push({ tipo: "enlace-rigido", id: "ciclo", maestro: x.esclavos[0], esclavos: [x.maestro] });
      return true;
    },
  },
  // ---------------------------------------------------------------- cargas
  { id: "carga-nudo-fuera", descripcion: "carga nodal sobre un nudo inexistente", codigos: [CARGA], aplicar: (m) => (m.casos[0].nodales.push({ nudo: m.nudos.length, f: [1, 0, 0, 0, 0, 0] }), true) },
  { id: "carga-nan", descripcion: "carga nodal NaN", codigos: [CARGA], aplicar: (m) => (m.casos[0].nodales.push({ nudo: 0, f: [Number.NaN, 0, 0, 0, 0, 0] }), true) },
  { id: "carga-cinco", descripcion: "carga nodal de 5 componentes", codigos: [CARGA], aplicar: (m) => (m.casos[0].nodales.push({ nudo: 0, f: [1, 0, 0, 0, 0] }), true) },
  { id: "carga-barra-fuera", descripcion: "carga sobre una barra inexistente", codigos: [CARGA], aplicar: (m) => (m.casos[0].barras.push({ tipo: "distribuida", barra: m.barras.length, ejes: "global", qa: [0, 0, -1] }), true) },
  { id: "carga-barra-x-fuera", descripcion: "puntual fuera del tramo flexible", codigos: ["carga/fuera-de-barra"], aplicar: (m) => (m.casos[0].barras.push({ tipo: "puntual", barra: 0, ejes: "local", x: 1e3, F: [0, 0, -1] }), true) },
  { id: "carga-barra-invertida", descripcion: "distribuida con a > b", codigos: [CARGA], aplicar: (m) => (m.casos[0].barras.push({ tipo: "distribuida", barra: 0, ejes: "global", qa: [0, 0, -1], a: 0.8, b: 0.2 }), true) },
  { id: "carga-barra-nan", descripcion: "distribuida con NaN", codigos: [CARGA], aplicar: (m) => (m.casos[0].barras.push({ tipo: "distribuida", barra: 0, ejes: "global", qa: [0, Number.NaN, -1] }), true) },
  { id: "carga-barra-ejes", descripcion: "carga de barra con ejes desconocidos", codigos: [CARGA], aplicar: (m) => (m.casos[0].barras.push({ tipo: "distribuida", barra: 0, ejes: "polares", qa: [0, 0, -1] }), true) },
  { id: "carga-barra-tipo", descripcion: "carga de barra de tipo desconocido (antes de E6 se tomaba por distribuida)", codigos: [CARGA], aplicar: (m) => (m.casos[0].barras.push({ tipo: "triangular", barra: 0, ejes: "global", qa: [0, 0, -1] }), true) },
  { id: "carga-lamina-fuera", descripcion: "carga sobre una lámina inexistente", codigos: [CARGA], aplicar: (m) => (m.casos[0].laminas.push({ tipo: "superficie", lamina: m.laminas.length + 2, ejes: "global", q: [0, 0, -1] }), true) },
  {
    id: "carga-lamina-punto-fuera",
    descripcion: "puntual fuera de la lámina",
    codigos: ["carga/fuera-de-lamina"],
    aplicar: (m, r) => {
      if (!m.laminas.length) return false;
      const l = indice(m.laminas.length, r);
      const v = m.nudos[m.laminas[l].nudos[0]];
      m.casos[0].laminas.push({ tipo: "puntual", lamina: l, ejes: "global", punto: [v.x + 100, v.y, v.z], F: [0, 0, -1] });
      return true;
    },
  },
  {
    id: "carga-lamina-linea-nula",
    descripcion: "carga de línea de longitud nula",
    codigos: [CARGA],
    aplicar: (m, r) => {
      if (!m.laminas.length) return false;
      const l = indice(m.laminas.length, r);
      const p = [0, 1, 2].map((c) => m.laminas[l].nudos.reduce((s: number, v: number) => s + [m.nudos[v].x, m.nudos[v].y, m.nudos[v].z][c] / 4, 0));
      m.casos[0].laminas.push({ tipo: "linea", lamina: l, ejes: "global", a: p, b: p, qa: [0, 0, -1] });
      return true;
    },
  },
  { id: "carga-lamina-tres-q", descripcion: "superficie por nudo con 3 vectores", codigos: [CARGA], aplicar: (m) => { if (!m.laminas.length) return false; m.casos[0].laminas.push({ tipo: "superficie", lamina: 0, ejes: "global", q: [[0, 0, -1], [0, 0, -1], [0, 0, -1]] }); return true; } },
  { id: "carga-lamina-nan", descripcion: "superficie con NaN", codigos: [CARGA], aplicar: (m) => { if (!m.laminas.length) return false; m.casos[0].laminas.push({ tipo: "superficie", lamina: 0, ejes: "local", q: [0, 0, Number.NaN] }); return true; } },
  {
    id: "impuesto-sin-apoyo",
    descripcion: "desplazamiento impuesto en un GDL sin apoyo",
    codigos: ["carga/impuesto-sin-apoyo"],
    aplicar: (m) => {
      const libre = m.nudos.findIndex((_: Mutable, i: number) => !m.apoyos.some((a: Mutable) => a.nudo === i));
      m.casos[0].impuestos.push({ nudo: libre, gdl: 0, valor: 0.001 });
      return true;
    },
  },
  { id: "impuesto-gdl", descripcion: "desplazamiento impuesto en el GDL 7", codigos: [CARGA], aplicar: (m) => (m.casos[0].impuestos.push({ nudo: 0, gdl: 7, valor: 0.001 }), true) },
  { id: "impuesto-nan", descripcion: "desplazamiento impuesto NaN", codigos: [CARGA], aplicar: (m) => (m.casos[0].impuestos.push({ nudo: 0, gdl: 2, valor: Number.NaN }), true) },
  {
    id: "carga-sin-rigidez",
    descripcion: "momento rx sobre el maestro auxiliar de un diafragma (GDL sin rigidez)",
    codigos: ["carga/gdl-sin-rigidez"],
    aplicar: (m) => {
      const aux = conTipo(m, "diafragma").map(([x]: [Mutable]) => x.maestro).find((v: number) => String(m.nudos[v].id).startsWith("CM"));
      if (aux === undefined) return false;
      m.casos[0].nodales.push({ nudo: aux, f: [0, 0, 0, 5, 0, 0] });
      return true;
    },
  },
  // ---------------------------------------------------------------- contrato de tipos
  { id: "barra-sin-nudos", descripcion: "barra sin nudos", codigos: [NUDO], contrato: true, aplicar: (m, r) => (delete elegir(m.barras, r).nudos, true) },
  { id: "lamina-sin-nudos", descripcion: "lámina sin nudos", codigos: [NUDO], contrato: true, aplicar: (m, r) => { if (!m.laminas.length) return false; delete elegir(m.laminas, r).nudos; return true; } },
  { id: "muelle-sin-k", descripcion: "muelle sin rigidez", codigos: [PROP], contrato: true, aplicar: (m, r) => { if (!m.muelles.length) return false; delete elegir(m.muelles, r).k; return true; } },
  { id: "apoyo-sin-coartados", descripcion: "apoyo sin la lista de GDL", codigos: ["modelo/apoyo-no-valido"], contrato: true, aplicar: (m, r) => { if (!m.apoyos.length) return false; delete elegir(m.apoyos, r).coartados; return true; } },
  { id: "restriccion-sin-esclavos", descripcion: "restricción sin la lista de esclavos", codigos: ["restriccion/nudo-no-valido"], contrato: true, aplicar: (m, r) => { if (!m.restricciones.length) return false; delete elegir(m.restricciones, r).esclavos; return true; } },
  { id: "carga-sin-f", descripcion: "carga nodal sin vector", codigos: [CARGA], contrato: true, aplicar: (m) => (m.casos[0].nodales.push({ nudo: 0 }), true) },
  { id: "modelo-sin-lista-de-nudos", descripcion: "modelo sin la lista de nudos", codigos: ["motor/error-interno"], contrato: true, aplicar: (m) => (delete m.nudos, true) },
  // ---------------------------------------------------------------- modelo
  { id: "modelo-sin-casos", descripcion: "modelo sin casos de carga", codigos: [], aplicar: (m) => ((m.casos = []), true) },
  { id: "caso-vacio", descripcion: "un caso sin cargas", codigos: [], aplicar: (m) => (m.casos.push({ id: "vacío" }), true) },
  { id: "modelo-vacio", descripcion: "modelo sin nudos ni objetos", codigos: [], aplicar: (m) => { for (const k of Object.keys(m)) m[k] = []; m.casos = [{ id: "único" }]; return true; } },
];

/** Copia profunda de un modelo con una entrada no válida aplicada (o null si no se le puede aplicar). */
export function estropear(m: ModeloAnalitico, e: EntradaNoValida, semilla: number): ModeloAnalitico | null {
  const copia = structuredClone(m) as Mutable;
  for (const k of ["barras", "laminas", "muelles", "apoyos", "restricciones"]) copia[k] ??= [];
  for (const c of copia.casos) for (const k of ["nodales", "barras", "laminas", "impuestos"]) c[k] ??= [];
  return e.aplicar(copia, generador(semilla)) ? copia : null;
}
