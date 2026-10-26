/**
 * Las plantillas DXF en la app (V2c-4, `docs/fem3d/dibujo.md` §10): de dónde sale el fichero de
 * cada una, leerlo en su worker y lo que se da a las vistas de planta y a los enganches.
 *
 * - El fichero se busca por su sha256: en la memoria de la página, en el navegador (IndexedDB, que
 *   comparten todos sus proyectos) y junto al proyecto (la carpeta o el servidor local). Si el de al
 *   lado del proyecto tiene otro sha256, es otro plano: se dice y no se usa. Lo encontrado fuera del
 *   navegador se guarda en él.
 * - Al importar, el fichero va al navegador y, con la carpeta del disco, a su lado si aún no está.
 * - Por planta: las plantillas que la tienen y están leídas, colocadas (`colocar`), con la geometría
 *   para la GPU (Float32, respecto a un origen suyo) y su índice para enganchar. El índice se hace en
 *   una tarea aparte, justo después (o al primer enganche, si llega antes): con un plano de 100 000
 *   segmentos, colocar, indexar y dibujar juntos pasaban de 50 ms.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlantillaDxf } from "../../../src/agente/proyecto.ts";
import type { Vec2 } from "../../../src/compilador/fisico.ts";
import { dibujoDxf, type DibujoDxf } from "../../../src/dxf/aplanar.ts";
import { colocar, indicePlantilla, type IndicePlantilla, type PlantillaColocada, type TextoColocado } from "../../../src/editor/dibujo/plantilla.ts";
import { guardarDxf, leerDxfGuardado } from "../sesion/almacen.ts";
import type { Origen } from "../sesion/origen.ts";
import type { PedidoDxf, RespuestaDxf } from "./lector.worker.ts";

export type EstadoPlantilla = { tipo: "cargando" } | { tipo: "listo"; dibujo: DibujoDxf } | { tipo: "falta" } | { tipo: "error"; mensaje: string };

// ─── Leer ───────────────────────────────────────────────────────────────────────────────────────

let worker: Worker | null = null;
let siguiente = 0;
const pendientes = new Map<number, { res: (d: DibujoDxf) => void; rej: (e: Error) => void }>();

/** Lee un DXF en su worker (sin worker, como en las pruebas, aquí). */
export function leerDxf(bytes: Uint8Array): Promise<DibujoDxf> {
  if (typeof Worker === "undefined") {
    try {
      return Promise.resolve(dibujoDxf(bytes));
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }
  if (!worker) {
    worker = new Worker(new URL("./lector.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<RespuestaDxf>) => {
      const p = pendientes.get(e.data.id);
      pendientes.delete(e.data.id);
      if (!p) return;
      if (e.data.ok) p.res(e.data.dibujo);
      else p.rej(new Error(e.data.mensaje));
    };
  }
  const id = ++siguiente;
  return new Promise((res, rej) => {
    pendientes.set(id, { res, rej });
    // Una copia: los bytes siguen sirviendo aquí (para guardarlos)
    const copia = bytes.slice();
    worker!.postMessage({ id, bytes: copia } satisfies PedidoDxf, [copia.buffer]);
  });
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Lo leído de cada fichero, por su sha256 (null: no se encontró). */
const dibujos = new Map<string, Promise<DibujoDxf | null>>();

async function buscar(t: PlantillaDxf, origen: Origen | null): Promise<DibujoDxf | null> {
  let bytes = await leerDxfGuardado(t.sha256).catch(() => null);
  if (!bytes && origen?.leerBytes) {
    const b = await origen.leerBytes(t.fichero);
    if (b) {
      if ((await sha256Hex(b)) !== t.sha256) throw new Error(`${t.fichero}, junto al proyecto, no es el plano de la plantilla «${t.nombre}» (ha cambiado). Elíjalo otra vez para usar el nuevo.`);
      bytes = b;
      await guardarDxf(t.sha256, b).catch(() => {});
    }
  }
  return bytes ? leerDxf(bytes) : null;
}

/** El DXF de una plantilla, leído, o null si no está ni en el navegador ni junto al proyecto. */
export function dibujoDe(t: PlantillaDxf, origen: Origen | null): Promise<DibujoDxf | null> {
  let p = dibujos.get(t.sha256);
  if (!p) {
    p = buscar(t, origen);
    dibujos.set(t.sha256, p);
    // Lo que falló o no se encontró se vuelve a buscar la próxima vez
    p.then((d) => d ?? dibujos.delete(t.sha256)).catch(() => dibujos.delete(t.sha256));
  }
  return p;
}

/** Lee un fichero elegido por el usuario y lo guarda en el navegador (y junto al proyecto, si es una carpeta). */
export async function importarDxf(f: File, origen: Origen | null): Promise<{ dibujo: DibujoDxf; sha256: string }> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  const sha256 = await sha256Hex(bytes);
  const dibujo = await leerDxf(bytes);
  dibujos.set(sha256, Promise.resolve(dibujo));
  await guardarDxf(sha256, bytes).catch(() => {});
  await origen?.dejarFichero?.(f.name, bytes);
  return { dibujo, sha256 };
}

/** Un nombre de plantilla que no está en la lista. */
export function nombreLibre(lista: readonly PlantillaDxf[], base: string): string {
  const b = base.trim() || "Plantilla";
  if (!lista.some((t) => t.nombre === b)) return b;
  for (let i = 2; ; i++) if (!lista.some((t) => t.nombre === `${b} (${i})`)) return `${b} (${i})`;
}

// ─── Por planta ─────────────────────────────────────────────────────────────────────────────────

/** Lo que dibuja una vista de planta: los segmentos (Float32, xyz respecto a `origen`) y los textos. */
export interface GeometriaPlantilla {
  origen: Vec2;
  posiciones: Float32Array;
  textos: TextoColocado[];
}

export interface EnPlanta {
  colocadas: PlantillaColocada[];
  /** El índice para enganchar (se hace la primera vez que se pide). */
  indice: () => IndicePlantilla | null;
  geometria: GeometriaPlantilla | null;
}

export function geometriaDe(cs: readonly PlantillaColocada[]): GeometriaPlantilla | null {
  const n = cs.reduce((s, c) => s + (c.lineas.length + c.curvas.length) / 4, 0);
  const textos = cs.flatMap((c) => c.textos);
  if (!n && !textos.length) return null;
  // El origen, en un vértice: los Float32 guardan bien lo que hay cerca
  const primero = cs.find((c) => c.lineas.length || c.curvas.length);
  const o: Vec2 = primero ? (primero.lineas.length ? [primero.lineas[0]!, primero.lineas[1]!] : [primero.curvas[0]!, primero.curvas[1]!]) : [textos[0]!.x, textos[0]!.y];
  const pos = new Float32Array(n * 6);
  let k = 0;
  for (const c of cs)
    for (const xs of [c.lineas, c.curvas])
      for (let i = 0; i < xs.length; i += 4) {
        pos[k++] = xs[i]! - o[0];
        pos[k++] = xs[i + 1]! - o[1];
        pos[k++] = 0;
        pos[k++] = xs[i + 2]! - o[0];
        pos[k++] = xs[i + 3]! - o[1];
        pos[k++] = 0;
      }
  return { origen: o, posiciones: pos, textos };
}

/**
 * Las plantillas del proyecto: el estado de cada fichero (por su sha256) y, por planta, lo que se
 * dibuja y engancha.
 */
export function usePlantillasDxf(lista: readonly PlantillaDxf[] | undefined, origen: Origen | null) {
  const [estados, setEstados] = useState<ReadonlyMap<string, EstadoPlantilla>>(() => new Map());
  const pedidos = useRef(new Set<string>());
  const [vuelta, setVuelta] = useState(0);
  useEffect(() => {
    for (const t of lista ?? []) {
      if (pedidos.current.has(t.sha256)) continue;
      pedidos.current.add(t.sha256);
      setEstados((m) => new Map(m).set(t.sha256, { tipo: "cargando" }));
      dibujoDe(t, origen).then(
        (d) => setEstados((m) => new Map(m).set(t.sha256, d ? { tipo: "listo", dibujo: d } : { tipo: "falta" })),
        (e: unknown) => setEstados((m) => new Map(m).set(t.sha256, { tipo: "error", mensaje: e instanceof Error ? e.message : String(e) })),
      );
    }
  }, [lista, origen, vuelta]);

  /** Busca otra vez un fichero (tras elegirlo, o si apareció junto al proyecto). */
  const recargar = useCallback((sha256: string) => {
    pedidos.current.delete(sha256);
    setVuelta((n) => n + 1);
  }, []);

  const porPlanta = useMemo(() => {
    const cache = new Map<string, EnPlanta>();
    return (planta: string): EnPlanta => {
      let r = cache.get(planta);
      if (!r) {
        const colocadas: PlantillaColocada[] = [];
        for (const t of lista ?? []) {
          const e = estados.get(t.sha256);
          if (t.plantas.includes(planta) && e?.tipo === "listo") colocadas.push(colocar(e.dibujo, t));
        }
        let ix: IndicePlantilla | null | undefined = colocadas.length ? undefined : null;
        const indice = () => (ix === undefined ? (ix = indicePlantilla(colocadas)) : ix);
        r = { colocadas, indice, geometria: geometriaDe(colocadas) };
        cache.set(planta, r);
        if (ix === undefined) setTimeout(indice, 0);
      }
      return r;
    };
  }, [lista, estados]);

  return { estados, porPlanta, recargar };
}
