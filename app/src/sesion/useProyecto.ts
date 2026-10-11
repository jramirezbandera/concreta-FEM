/**
 * El proyecto abierto en el visor: abrirlo (de una carpeta o de un texto), usar los resultados que
 * guardó la CLI o calcular, y vigilar el fichero para recargarlo cuando el agente, o el ingeniero, lo
 * cambie (criterio 5 de V1).
 *
 * Regla (criterio 3): en cuanto se ve que el fichero cambió, los resultados se marcan como
 * desactualizados, antes de leerlo; cada carga lleva un número de generación y lo que llegue de una
 * carga anterior se descarta.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Diagnostico } from "../../../src/motor/diagnosticos.ts";
import type { EstadoSesion } from "../../../src/visor/sesion.ts";
import { nombreFirmas, type Origen } from "./origen.ts";
import { ClienteSesion, ErrorObsoleto } from "./cliente.ts";

export type Fase = "vacio" | "abriendo" | "calculando" | "listo" | "error";

/** Un origen que se puede vigilar (carpeta o URL), o un texto suelto (arrastrado o elegido), sin vigilancia. */
export type Fuente = { tipo: "origen"; origen: Origen } | { tipo: "texto"; nombre: string };

export interface Tiempos {
  abrir?: number;
  guardados?: number;
  calcular?: number;
}

export interface ProyectoAbierto {
  fase: Fase;
  estado: EstadoSesion | null;
  cliente: ClienteSesion | null;
  fuente: Fuente | null;
  /** El fichero cambió y aún no hay resultados de la versión nueva. */
  desactualizado: boolean;
  /** Por qué no se pudo abrir o calcular. */
  errores: Diagnostico[];
  /** Por qué no se usaron los resultados de `.fem/` (si los había). */
  motivoGuardados: string | null;
  /** Texto del fichero de firmas (vacío si no hay). */
  firmas: string;
  tiempos: Tiempos;
  /** Cuenta las cargas: cambia con cada versión del proyecto. */
  version: number;
  abrirOrigen: (o: Origen) => void;
  abrirTexto: (texto: string, nombre: string) => void;
  recalcular: () => void;
}

/** Cada cuánto se mira si el fichero cambió (criterio 5: detectarlo en ≤ 2 s). */
export const VIGILANCIA_MS = 1000;

export function useProyecto(): ProyectoAbierto {
  const [fase, setFase] = useState<Fase>("vacio");
  const [estado, setEstado] = useState<EstadoSesion | null>(null);
  const [cliente, setCliente] = useState<ClienteSesion | null>(null);
  const [fuente, setFuente] = useState<Fuente | null>(null);
  const [desactualizado, setDesactualizado] = useState(false);
  const [errores, setErrores] = useState<Diagnostico[]>([]);
  const [motivoGuardados, setMotivoGuardados] = useState<string | null>(null);
  const [firmas, setFirmas] = useState("");
  const [tiempos, setTiempos] = useState<Tiempos>({});
  const [version, setVersion] = useState(0);
  const gen = useRef(0);
  const clienteRef = useRef<ClienteSesion | null>(null);
  const ultimo = useRef<{ texto: string; sello: string | null; selloFirmas: string | null } | null>(null);

  const cargar = useCallback(async (texto: string, f: Fuente, opciones: { sinGuardados?: boolean } = {}) => {
    const g = ++gen.current;
    setDesactualizado(true);
    setFase("abriendo");
    setErrores([]);
    setMotivoGuardados(null);
    const vigente = () => g === gen.current;
    const c = new ClienteSesion();
    try {
      const t0 = performance.now();
      const a = await c.pedir({ tipo: "abrir", texto });
      if (!vigente()) return c.cerrar();
      clienteRef.current?.cerrar();
      clienteRef.current = c;
      setCliente(c);
      setFuente(f);
      setVersion(g);
      const t: Tiempos = { abrir: (performance.now() - t0) / 1000 };
      setTiempos(t);
      if (!a.ok) {
        setEstado(null);
        setErrores(a.diagnosticos);
        setFase("error");
        setDesactualizado(false);
        return;
      }
      setEstado(a.valor);
      if (!a.valor.compila) {
        // Se dibuja con sus diagnósticos; no hay nada que calcular
        setFase("listo");
        setDesactualizado(false);
        return;
      }
      setFase("calculando");
      if (f.tipo === "origen" && !opciones.sinGuardados) {
        const t1 = performance.now();
        const gd = await f.origen.guardados(a.valor.huella);
        if (!vigente()) return;
        if (gd) {
          const r = await c.pedir({ tipo: "guardados", cabecera: gd.cabecera, bytes: gd.bytes });
          if (!vigente()) return;
          if (r.ok && r.valor.usados) {
            setEstado(r.valor.estado);
            setTiempos({ ...t, guardados: (performance.now() - t1) / 1000 });
            setFase("listo");
            setDesactualizado(false);
            return;
          }
          setMotivoGuardados(r.ok && !r.valor.usados ? r.valor.motivo : "no se pudieron leer");
        }
      }
      const t2 = performance.now();
      const r = await c.pedir({ tipo: "calcular" });
      if (!vigente()) return;
      setTiempos({ ...t, calcular: (performance.now() - t2) / 1000 });
      if (!r.ok) {
        setErrores(r.diagnosticos);
        setFase("error");
      } else {
        setEstado(r.valor);
        setFase("listo");
      }
      setDesactualizado(false);
    } catch (e) {
      if (e instanceof ErrorObsoleto || !vigente()) return;
      setErrores([{ codigo: "visor/error-interno", severidad: "error", mensaje: e instanceof Error ? e.message : String(e) }]);
      setFase("error");
      setDesactualizado(false);
    }
  }, []);

  const leerFirmas = useCallback(async (f: Fuente) => {
    if (f.tipo !== "origen") return null;
    const l = await f.origen.leer(nombreFirmas(f.origen.fichero));
    setFirmas(l?.texto ?? "");
    return l?.sello ?? null;
  }, []);

  const abrirOrigen = useCallback(
    (o: Origen) => {
      void (async () => {
        const l = await o.leer(o.fichero);
        if (!l) {
          setErrores([{ codigo: "visor/fichero", severidad: "error", mensaje: `No se pudo leer ${o.descripcion}.` }]);
          setFase("error");
          return;
        }
        const f: Fuente = { tipo: "origen", origen: o };
        ultimo.current = { texto: l.texto, sello: l.sello, selloFirmas: await leerFirmas(f) };
        await cargar(l.texto, f);
      })();
    },
    [cargar, leerFirmas],
  );

  const abrirTexto = useCallback(
    (texto: string, nombre: string) => {
      ultimo.current = { texto, sello: null, selloFirmas: null };
      setFirmas("");
      void cargar(texto, { tipo: "texto", nombre });
    },
    [cargar],
  );

  const recalcular = useCallback(() => {
    if (ultimo.current && fuente) void cargar(ultimo.current.texto, fuente, { sinGuardados: true });
  }, [cargar, fuente]);

  // Vigilancia del fichero y de sus firmas
  useEffect(() => {
    if (!fuente || fuente.tipo !== "origen") return;
    const o = fuente.origen;
    let parado = false;
    let ocupado = false;
    const mirar = async () => {
      if (ocupado || parado || !ultimo.current) return;
      ocupado = true;
      try {
        const s = await o.sello(o.fichero);
        if (s && s !== ultimo.current.sello) {
          // Antes de leerlo: lo que se ve ya no es de este fichero
          setDesactualizado(true);
          const l = await o.leer(o.fichero);
          if (l && !parado) {
            const cambio = l.texto !== ultimo.current.texto;
            ultimo.current = { ...ultimo.current, texto: l.texto, sello: l.sello };
            if (cambio) await cargar(l.texto, fuente);
            else setDesactualizado(false);
          }
        }
        const sf = await o.sello(nombreFirmas(o.fichero));
        if (sf !== ultimo.current.selloFirmas) ultimo.current = { ...ultimo.current, selloFirmas: await leerFirmas(fuente) };
      } finally {
        ocupado = false;
      }
    };
    const t = window.setInterval(() => void mirar(), VIGILANCIA_MS);
    return () => {
      parado = true;
      window.clearInterval(t);
    };
  }, [fuente, cargar, leerFirmas]);

  useEffect(() => () => clienteRef.current?.cerrar(), []);

  return { fase, estado, cliente, fuente, desactualizado, errores, motivoGuardados, firmas, tiempos, version, abrirOrigen, abrirTexto, recalcular };
}
