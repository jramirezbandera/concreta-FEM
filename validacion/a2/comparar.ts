/**
 * Spike A2 (criterio 2): compara el proyecto que hace un agente desde la descripción en texto
 * (`descripciones/`) con el modelo de referencia, a 1e-6. Los `id` del agente pueden ser otros
 * (salvo los de los casos, que da la descripción), así que todo se empareja por posición:
 * - reacciones totales por caso: ΣF y ΣM respecto al origen;
 * - desplazamiento del maestro de cada planta [ux, uy, rz] por caso, con las plantas emparejadas
 *   por su cota;
 * - flecha máxima de la losa de cada planta por caso;
 * - cinco piezas elegidas:
 *   · un pilar, por su (x, y) y la cota de la cabeza de su tramo: [N, Vy, Vz, T, My, Mz] en la
 *     base y en la cabeza del tramo flexible;
 *   · una viga, por un punto de su eje y la cota de su planta: en el vano que lo contiene, el
 *     máximo y el mínimo de My y el mayor |Vz|, que no dependen del sentido en que se dibujó.
 *
 * Uso: bun validacion/a2/comparar.ts <1022|nucleo|edificio> <proyecto.json> → tabla y código 0/1.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { leerProyecto } from "../../src/agente/proyecto.ts";
import { compilar } from "../../src/compilador/compilar.ts";
import { Consultas } from "../../src/compilador/consultas.ts";
import { cotasPlantas } from "../../src/compilador/cotas.ts";
import { factoresCaso } from "../../src/compilador/envolventes.ts";
import type { ModeloFisico, OpcionesCompilacion, Vec2 } from "../../src/compilador/fisico.ts";
import { calcular } from "../../src/motor/calcular.ts";
import { iniciarNucleo } from "../../src/nucleo/index.ts";
import { casosValidos } from "../../src/pruebas/comparar.ts";
import { fisico1022 } from "../c1/modelos.ts";
import { edificioObjetivoLosas } from "../c2/modelos.ts";
import { reticulaConNucleo } from "../c3/modelos.ts";

export const TOLERANCIA_A2 = 1e-6;

interface Punto {
  x: number;
  y: number;
  /** Cota de la cabeza del tramo (pilar) o de la planta (viga), m. */
  cota: number;
}

export interface Referencia {
  descripcion: string;
  fisico: () => ModeloFisico;
  opciones?: OpcionesCompilacion;
  pilares: Punto[];
  vigas: Punto[];
}

const IN = 0.0254;
export const REFERENCIAS: Record<string, Referencia> = {
  "1022": {
    descripcion: "1022.md",
    fisico: fisico1022,
    opciones: { modificadores: {} },
    pilares: [
      { x: 360 * IN, y: 0, cota: 162 * IN },
      { x: 0, y: 0, cota: (2 * 162 + 2 * 156) * IN },
      { x: 720 * IN, y: 0, cota: (2 * 162 + 5 * 156) * IN },
    ],
    vigas: [
      { x: 180 * IN, y: 0, cota: 162 * IN },
      { x: 540 * IN, y: 0, cota: (2 * 162 + 5 * 156) * IN },
    ],
  },
  nucleo: {
    descripcion: "nucleo.md",
    fisico: reticulaConNucleo,
    opciones: { tamanoMalla: 1 },
    pilares: [
      { x: 0, y: 0, cota: 0 },
      { x: 6, y: 5, cota: 0 },
      { x: 18, y: 15, cota: 0 },
    ],
    vigas: [
      { x: 3, y: 5, cota: 0 },
      { x: 12, y: 12.5, cota: 0 },
    ],
  },
  edificio: {
    descripcion: "edificio.md",
    fisico: () => edificioObjetivoLosas(7),
    pilares: [
      { x: 24, y: 15, cota: 0 },
      { x: 54, y: 0, cota: 18 },
    ],
    vigas: [
      { x: 21, y: 10, cota: 6 },
      { x: 30, y: 12.5, cota: 12 },
      { x: 9, y: 17.5, cota: 0 },
    ],
  },
};

export interface Magnitudes {
  casos: string[];
  reacciones: number[][];
  /** Por cota (redondeada a mm): [ux, uy, rz] por caso. */
  maestros: Map<string, number[][]>;
  /** Por cota: la flecha máxima de las losas de la planta, por caso. */
  flechas: Map<string, number[]>;
  /** Por pieza elegida, en el orden de la referencia: sus valores por caso. */
  piezas: { nombre: string; valores: number[][] | null; nota?: string }[];
  nudos: number;
}

const claveCota = (z: number) => z.toFixed(3);

function enPolilinea(puntos: readonly Vec2[], P: Vec2, tol = 1e-6): number | null {
  let s0 = 0;
  for (let i = 1; i < puntos.length; i++) {
    const [a, b] = [puntos[i - 1]!, puntos[i]!];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const t = ((P[0] - a[0]) * (b[0] - a[0]) + (P[1] - a[1]) * (b[1] - a[1])) / L;
    const d = Math.abs((P[0] - a[0]) * (b[1] - a[1]) - (P[1] - a[1]) * (b[0] - a[0])) / L;
    if (d <= tol && t >= -tol && t <= L + tol) return s0 + t;
    s0 += L;
  }
  return null;
}

export function magnitudes(f: ModeloFisico, o: OpcionesCompilacion | undefined, ref: Referencia): Magnitudes {
  const c = compilar(f, o);
  if (!c.valido) throw new Error(`no compila: ${c.diagnosticos.filter((d) => d.severidad === "error").map((d) => d.mensaje).join("; ")}`);
  const casos = casosValidos(calcular(c.modelo));
  const q = new Consultas(f, c, casos, o);
  const nc = casos.length;
  const cotas = cotasPlantas(f.plantas) as number[];
  const plantaEn = (z: number) => f.plantas.find((_, i) => Math.abs(cotas[i]! - z) < 1e-6)?.id;
  const reacciones = casos.map((cs) => {
    const T = [0, 0, 0, 0, 0, 0];
    c.modelo.nudos.forEach((nd, n) => {
      const R = cs.reacciones;
      const [Fx, Fy, Fz] = [R[6 * n]!, R[6 * n + 1]!, R[6 * n + 2]!];
      T[0]! += Fx;
      T[1]! += Fy;
      T[2]! += Fz;
      T[3]! += R[6 * n + 3]! + nd.y * Fz - nd.z * Fy;
      T[4]! += R[6 * n + 4]! + nd.z * Fx - nd.x * Fz;
      T[5]! += R[6 * n + 5]! + nd.x * Fy - nd.y * Fx;
    });
    return T;
  });
  const maestros = new Map<string, number[][]>();
  const flechas = new Map<string, number[]>();
  f.plantas.forEach((p, i) => {
    const pc = q.planta(p.id);
    if (pc.valido && pc.valor.maestro) {
      const u = pc.valor.maestro.u;
      maestros.set(claveCota(cotas[i]!), Array.from({ length: nc }, (_, k) => [u[3 * k]!, u[3 * k + 1]!, u[3 * k + 2]!]));
    }
    const losas = (f.losas ?? []).filter((l) => l.planta === p.id);
    if (losas.length)
      flechas.set(
        claveCota(cotas[i]!),
        Array.from({ length: nc }, (_, k) => Math.max(...losas.map((l) => (q.flechas(l.id, factoresCaso(k, nc)) as { valor: { maxima: { flecha: number } } }).valor.maxima.flecha))),
      );
  });
  const piezas: Magnitudes["piezas"] = [];
  for (const P of ref.pilares) {
    const nombre = `pilar (${P.x.toFixed(3)}, ${P.y.toFixed(3)}) tramo bajo z = ${P.cota.toFixed(3)}`;
    const pilar = (f.pilares ?? []).find((p) => Math.abs(p.x - P.x) < 1e-6 && Math.abs(p.y - P.y) < 1e-6);
    const planta = plantaEn(P.cota);
    const t = pilar && planta ? (q.pilar(pilar.id) as { valido: boolean; valor: { planta: string; base: { esfuerzos: Float64Array }; cabeza: { esfuerzos: Float64Array } }[] }) : null;
    const tramo = t?.valido ? t.valor.find((x) => x.planta === planta) : undefined;
    piezas.push({
      nombre,
      valores: tramo ? Array.from({ length: nc }, (_, k) => [...tramo.base.esfuerzos.slice(6 * k, 6 * k + 6), ...tramo.cabeza.esfuerzos.slice(6 * k, 6 * k + 6)]) : null,
      ...(tramo ? {} : { nota: pilar ? "sin el tramo" : "no hay pilar en ese punto" }),
    });
  }
  for (const P of ref.vigas) {
    const nombre = `viga por (${P.x.toFixed(3)}, ${P.y.toFixed(3)}) en z = ${P.cota.toFixed(3)}`;
    const planta = plantaEn(P.cota);
    let valores: number[][] | null = null;
    let nota = "no hay viga por ese punto";
    for (const v of (f.vigas ?? []).filter((x) => x.planta === planta)) {
      const s = enPolilinea(v.puntos, [P.x, P.y]);
      if (s === null) continue;
      const vv = q.viga(v.id);
      if (!vv.valido) continue;
      const i = vv.valor.vanos.findIndex((va) => s >= va.desde - 1e-9 && s <= va.hasta + 1e-9);
      if (i < 0) {
        nota = "el punto no cae en un vano";
        continue;
      }
      valores = Array.from({ length: nc }, (_, k) => {
        const e = q.vano(v.id, i, factoresCaso(k, nc));
        if (!e.valido) throw new Error(e.diagnosticos[0]!.mensaje);
        return [e.valor.maxMy.valor, e.valor.minMy.valor, Math.max(Math.abs(e.valor.maxVz.valor), Math.abs(e.valor.minVz.valor))];
      });
      break;
    }
    piezas.push({ nombre, valores, ...(valores ? {} : { nota }) });
  }
  return { casos: f.casos.map((x) => x.id), reacciones, maestros, flechas, piezas, nudos: c.modelo.nudos.length };
}

export interface Fila {
  grupo: string;
  /** Error relativo: max|a − b| / max|referencia| del grupo. */
  error: number;
  pasa: boolean;
  nota?: string;
}

/** Error relativo de dos listas de vectores, con la escala de la referencia. */
function errorRelativo(ref: number[][], ag: number[][]): number {
  let escala = 0;
  let d = 0;
  ref.forEach((v, k) =>
    v.forEach((x, i) => {
      escala = Math.max(escala, Math.abs(x));
      d = Math.max(d, Math.abs(x - (ag[k]?.[i] ?? Number.NaN)));
    }),
  );
  return Number.isNaN(d) ? Number.POSITIVE_INFINITY : escala > 0 ? d / escala : d;
}

export function comparar(ref: Magnitudes, ag: Magnitudes): Fila[] {
  const filas: Fila[] = [];
  const fila = (grupo: string, error: number, nota?: string) => filas.push({ grupo, error, pasa: error <= TOLERANCIA_A2, ...(nota ? { nota } : {}) });
  if (ref.casos.join() !== ag.casos.join()) {
    fila("casos", Number.POSITIVE_INFINITY, `referencia ${ref.casos.join(", ")}; agente ${ag.casos.join(", ")}`);
    return filas;
  }
  fila("reacciones totales: fuerzas", errorRelativo(ref.reacciones.map((r) => r.slice(0, 3)), ag.reacciones.map((r) => r.slice(0, 3))));
  fila("reacciones totales: momentos", errorRelativo(ref.reacciones.map((r) => r.slice(3)), ag.reacciones.map((r) => r.slice(3))));
  for (const [cota, u] of ref.maestros) {
    const v = ag.maestros.get(cota);
    fila(`maestro de la planta en z = ${cota}`, v ? errorRelativo(u, v) : Number.POSITIVE_INFINITY, v ? undefined : "el agente no tiene diafragma en esa cota");
  }
  for (const [cota, w] of ref.flechas) {
    const v = ag.flechas.get(cota);
    fila(`flecha máxima de la losa en z = ${cota}`, v ? errorRelativo([w], [v]) : Number.POSITIVE_INFINITY, v ? undefined : "el agente no tiene losa en esa cota");
  }
  ref.piezas.forEach((p, i) => {
    const a = ag.piezas[i]!;
    fila(p.nombre, p.valores && a.valores ? errorRelativo(p.valores, a.valores) : Number.POSITIVE_INFINITY, a.nota);
  });
  return filas;
}

export async function compararProyecto(nombre: string, ruta: string): Promise<{ filas: Fila[]; nudos: [number, number] }> {
  const ref = REFERENCIAS[nombre];
  if (!ref) throw new Error(`referencia desconocida: ${nombre} (${Object.keys(REFERENCIAS).join(", ")})`);
  await iniciarNucleo(readFileSync(join(import.meta.dirname, "..", "..", "src", "nucleo", "pkg", "nucleo_bg.wasm")));
  const l = leerProyecto(readFileSync(ruta, "utf8"));
  if (!l.valido) throw new Error(`el proyecto no pasa el esquema: ${l.diagnosticos.map((d) => d.mensaje).join("; ")}`);
  const mr = magnitudes(ref.fisico(), ref.opciones, ref);
  const ma = magnitudes(l.proyecto.modelo, l.proyecto.opciones, ref);
  return { filas: comparar(mr, ma), nudos: [mr.nudos, ma.nudos] };
}

if (import.meta.main) {
  const [nombre, ruta] = process.argv.slice(2);
  if (!nombre || !ruta) {
    console.error(`Uso: bun validacion/a2/comparar.ts <${Object.keys(REFERENCIAS).join("|")}> <proyecto.json>`);
    process.exit(2);
  }
  const { filas, nudos } = await compararProyecto(nombre, ruta);
  console.log(`# ${nombre}: nudos de la referencia ${nudos[0]}, del agente ${nudos[1]}; tolerancia ${TOLERANCIA_A2}`);
  console.log("magnitud | error relativo | pasa");
  for (const f of filas) console.log(`${f.grupo} | ${f.error.toExponential(2)} | ${f.pasa ? "sí" : "NO"}${f.nota ? ` (${f.nota})` : ""}`);
  const todas = filas.every((f) => f.pasa);
  console.log(todas ? "PASA" : "NO PASA");
  process.exitCode = todas ? 0 : 1;
}

export const DESCRIPCIONES = join(import.meta.dirname, "descripciones");
export const listaDescripciones = () => readdirSync(DESCRIPCIONES);
