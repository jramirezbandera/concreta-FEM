/**
 * El proyecto abierto: abrirlo (de una carpeta o de un texto), usar los resultados que guardó la CLI
 * o calcular, vigilar el fichero para recargarlo cuando el agente, o el ingeniero, lo cambie
 * (criterio 5 de V1) y, desde V2a, editarlo y guardarlo (`docs/fem3d/visor.md` §6.1).
 *
 * Reglas:
 * - Criterio 3 de V1 y 4 de V2a: en cuanto se ve que el fichero cambió, o con el primer cambio del
 *   editor, los resultados se marcan como desactualizados, antes de nada más; cada carga lleva un
 *   número de generación y lo que llegue de una carga anterior se descarta.
 * - Al editar, el worker valida y compila la versión nueva (con una pausa corta para no compilar a
 *   cada tecla), pero no calcula: calcular es un botón.
 * - El proyecto que se edita está en el hilo principal (`historial`); el worker recibe su texto
 *   canónico. Deshacer devuelve el proyecto anterior tal cual.
 * - Nunca se pisa nada en silencio: si el fichero cambia en el disco con cambios sin guardar, no se
 *   recarga ni se sobrescribe; se avisa (`conflicto`) y el ingeniero elige.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { leerProyecto, type Proyecto } from "../../../src/agente/proyecto.ts";
import { deshacer as deshacerH, hacer, historial as nuevoHistorial, rehacer as rehacerH, type Historial } from "../../../src/editor/historial.ts";
import { aplicar, type Aplicacion, type Operacion } from "../../../src/editor/operaciones.ts";
import { serializar } from "../../../src/editor/serializar.ts";
import type { Diagnostico } from "../../../src/motor/diagnosticos.ts";
import type { EstadoSesion } from "../../../src/visor/sesion.ts";
import { descargar, nombreFirmas, type Origen } from "./origen.ts";
import { ClienteSesion, ErrorObsoleto } from "./cliente.ts";

export type Fase = "vacio" | "abriendo" | "calculando" | "listo" | "error";

/** Un origen que se puede vigilar (carpeta o URL), o un texto suelto (arrastrado o elegido), sin vigilancia. */
export type Fuente = { tipo: "origen"; origen: Origen } | { tipo: "texto"; nombre: string };

export interface Tiempos {
  abrir?: number;
  guardados?: number;
  calcular?: number;
}

export type EstadoGuardado = { tipo: "nada" } | { tipo: "guardando" } | { tipo: "guardado"; ms: number } | { tipo: "error"; mensaje: string };

/** Lo que el editor puede hacer con el proyecto abierto (V2a). */
export interface Edicion {
  /** El proyecto que se edita: el último cambio, aunque el worker aún lo esté compilando. */
  proyecto: Proyecto;
  sinGuardar: boolean;
  /** Etiqueta de lo que se desharía o reharía (null si no hay). */
  deshacerEtiqueta: string | null;
  rehacerEtiqueta: string | null;
  editar: (o: Operacion, etiqueta: string) => Aplicacion;
  deshacer: () => void;
  rehacer: () => void;
  /** Guarda en el fichero (o lo descarga, sin carpeta); con `forzar`, aunque haya cambiado en el disco. */
  guardar: (o?: { forzar?: boolean }) => Promise<void>;
  guardado: EstadoGuardado;
  /** El fichero cambió en el disco con cambios sin guardar, o al guardar: no se ha recargado ni sobrescrito. */
  conflicto: string | null;
  /** Descarta los cambios y lee el fichero del disco. */
  recargarDisco: () => void;
  /** Guardar escribe el fichero (carpeta o servidor local) o lo descarga (texto suelto). */
  modo: "escribir" | "descargar";
  /** Hay un cambio que el worker aún no ha compilado. */
  pendiente: boolean;
}

export interface ProyectoAbierto {
  fase: Fase;
  estado: EstadoSesion | null;
  cliente: ClienteSesion | null;
  fuente: Fuente | null;
  /** El fichero cambió, o se editó, y aún no hay estado de la versión nueva. */
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
  /** Calcula de nuevo desde el texto, sin usar los resultados de `.fem/`. */
  recalcular: () => void;
  /** Calcula la versión abierta (tras editar, el worker sólo compila). */
  calcular?: () => void;
  /** null si el fichero no es un proyecto válido (no se puede editar). */
  edicion?: Edicion | null;
}

/** Cada cuánto se mira si el fichero cambió (criterio 5 de V1: detectarlo en ≤ 2 s). */
export const VIGILANCIA_MS = 1000;
/**
 * Pausa tras un cambio del editor antes de compilar la versión nueva. Corta: una celda se confirma
 * con Intro (no a cada tecla) y un pegado es una sola operación; la pausa sólo junta los cambios
 * seguidos (Tab, Tab…) en una compilación.
 */
export const PAUSA_COMPILAR_MS = 150;

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
  const [hist, setHist] = useState<Historial | null>(null);
  /** El proyecto tal como está en el disco (el leído o el último guardado). */
  const [enDisco, setEnDisco] = useState<Proyecto | null>(null);
  const [guardado, setGuardado] = useState<EstadoGuardado>({ tipo: "nada" });
  const [conflicto, setConflicto] = useState<string | null>(null);
  const [pendiente, setPendiente] = useState(false);
  const gen = useRef(0);
  const clienteRef = useRef<ClienteSesion | null>(null);
  const ultimo = useRef<{ texto: string; sello: string | null; selloFirmas: string | null } | null>(null);
  const histRef = useRef<Historial | null>(null);
  const sinGuardarRef = useRef(false);
  const temporizador = useRef<number | null>(null);

  const sinGuardar = !!hist && hist.actual !== enDisco;
  sinGuardarRef.current = sinGuardar;
  histRef.current = hist;

  const cargar = useCallback(async (texto: string, f: Fuente, opciones: { sinGuardados?: boolean; sinCalcular?: boolean } = {}) => {
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
      setPendiente(false);
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
      if (opciones.sinCalcular) {
        setFase("listo");
        setDesactualizado(false);
        return;
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

  /** El proyecto del texto leído pasa a ser el que se edita, sin historia (null si no es válido). */
  const empezarEdicion = useCallback((texto: string) => {
    const l = leerProyecto(texto);
    const h = l.valido ? nuevoHistorial(l.proyecto) : null;
    histRef.current = h;
    setHist(h);
    setEnDisco(h?.actual ?? null);
    setConflicto(null);
    setGuardado({ tipo: "nada" });
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
        empezarEdicion(l.texto);
        await cargar(l.texto, f);
      })();
    },
    [cargar, leerFirmas, empezarEdicion],
  );

  const abrirTexto = useCallback(
    (texto: string, nombre: string) => {
      ultimo.current = { texto, sello: null, selloFirmas: null };
      setFirmas("");
      empezarEdicion(texto);
      void cargar(texto, { tipo: "texto", nombre });
    },
    [cargar, empezarEdicion],
  );

  const recalcular = useCallback(() => {
    const h = histRef.current;
    const texto = h ? serializar(h.actual) : ultimo.current?.texto;
    if (texto !== undefined && fuente) void cargar(texto, fuente, { sinGuardados: true });
  }, [cargar, fuente]);

  const calcular = useCallback(() => {
    const c = clienteRef.current;
    if (!c) return;
    const g = gen.current;
    setFase("calculando");
    setErrores([]);
    const t0 = performance.now();
    void c.pedir({ tipo: "calcular" }).then(
      (r) => {
        if (g !== gen.current) return;
        setTiempos((t) => ({ ...t, calcular: (performance.now() - t0) / 1000, guardados: undefined }));
        if (!r.ok) {
          setErrores(r.diagnosticos);
          setFase("error");
        } else {
          setEstado(r.valor);
          setFase("listo");
        }
      },
      (e: unknown) => {
        if (e instanceof ErrorObsoleto || g !== gen.current) return;
        setErrores([{ codigo: "visor/error-interno", severidad: "error", mensaje: e instanceof Error ? e.message : String(e) }]);
        setFase("error");
      },
    );
  }, []);

  /** Compila la versión editada tras una pausa; los resultados se marcan como desactualizados ya. */
  const programar = useCallback(
    (p: Proyecto) => {
      // Antes de nada: lo que se ve ya no es de esta versión, y lo que llegue de antes se descarta
      gen.current++;
      setDesactualizado(true);
      setPendiente(true);
      if (temporizador.current !== null) window.clearTimeout(temporizador.current);
      temporizador.current = window.setTimeout(() => {
        temporizador.current = null;
        if (fuente) void cargar(serializar(p), fuente, { sinCalcular: true });
      }, PAUSA_COMPILAR_MS);
    },
    [cargar, fuente],
  );

  const editar = useCallback(
    (o: Operacion, etiqueta: string): Aplicacion => {
      const h = histRef.current;
      if (!h) return { ok: false, errores: [{ codigo: "editor/sin-proyecto", severidad: "error", mensaje: "No hay ningún proyecto que editar." }] };
      const r = aplicar(h.actual, o);
      if (!r.ok) return r;
      const n = hacer(h, r.proyecto, etiqueta);
      histRef.current = n;
      setHist(n);
      setGuardado({ tipo: "nada" });
      programar(n.actual);
      return r;
    },
    [programar],
  );

  const mover = useCallback(
    (f: (h: Historial) => Historial) => {
      const h = histRef.current;
      if (!h) return;
      const n = f(h);
      if (n === h) return;
      histRef.current = n;
      setHist(n);
      programar(n.actual);
    },
    [programar],
  );

  const guardar = useCallback(
    async (o: { forzar?: boolean } = {}) => {
      const h = histRef.current;
      if (!h || !fuente) return;
      const p = h.actual;
      const texto = serializar(p);
      // Nunca se guarda un fichero que no pase leerProyecto (criterio de §6.1)
      const l = leerProyecto(texto);
      if (!l.valido) {
        setGuardado({ tipo: "error", mensaje: `El proyecto no pasa el esquema: no se guarda (${l.diagnosticos[0]?.mensaje ?? ""}).` });
        return;
      }
      if (fuente.tipo === "texto") {
        descargar(texto, fuente.nombre);
        setEnDisco(p);
        setGuardado({ tipo: "guardado", ms: 0 });
        return;
      }
      setGuardado({ tipo: "guardando" });
      const t0 = performance.now();
      const r = await fuente.origen.escribir(texto, { sello: ultimo.current?.sello ?? null, forzar: o.forzar });
      if (r.ok) {
        ultimo.current = { texto, sello: r.sello, selloFirmas: ultimo.current?.selloFirmas ?? null };
        setEnDisco(p);
        setConflicto(null);
        setGuardado({ tipo: "guardado", ms: performance.now() - t0 });
      } else if (r.conflicto) {
        setConflicto(r.mensaje);
        setGuardado({ tipo: "nada" });
      } else setGuardado({ tipo: "error", mensaje: r.mensaje });
    },
    [fuente],
  );

  const recargarDisco = useCallback(() => {
    if (!fuente || fuente.tipo !== "origen") return;
    void (async () => {
      const o = fuente.origen;
      setDesactualizado(true);
      const l = await o.leer(o.fichero);
      if (!l) {
        setGuardado({ tipo: "error", mensaje: `No se pudo leer ${o.descripcion}.` });
        return;
      }
      ultimo.current = { texto: l.texto, sello: l.sello, selloFirmas: ultimo.current?.selloFirmas ?? null };
      empezarEdicion(l.texto);
      await cargar(l.texto, fuente);
    })();
  }, [cargar, fuente, empezarEdicion]);

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
          if (sinGuardarRef.current) {
            // Con cambios sin guardar no se recarga ni se pisa nada: se avisa y elige el ingeniero
            setConflicto(`${o.fichero} cambió en el disco y aquí hay cambios sin guardar.`);
          } else {
            // Antes de leerlo: lo que se ve ya no es de este fichero
            setDesactualizado(true);
            const l = await o.leer(o.fichero);
            if (l && !parado && !sinGuardarRef.current) {
              const cambio = l.texto !== ultimo.current.texto;
              ultimo.current = { ...ultimo.current, texto: l.texto, sello: l.sello };
              if (cambio) {
                empezarEdicion(l.texto);
                await cargar(l.texto, fuente);
              } else setDesactualizado(false);
            }
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
  }, [fuente, cargar, leerFirmas, empezarEdicion]);

  // Avisar al cerrar la página con cambios sin guardar
  useEffect(() => {
    if (!sinGuardar) return;
    const f = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [sinGuardar]);

  useEffect(
    () => () => {
      clienteRef.current?.cerrar();
      if (temporizador.current !== null) window.clearTimeout(temporizador.current);
    },
    [],
  );

  const edicion: Edicion | null = hist
    ? {
        proyecto: hist.actual,
        sinGuardar,
        deshacerEtiqueta: hist.pasado.at(-1)?.etiqueta ?? null,
        rehacerEtiqueta: hist.futuro[0]?.etiqueta ?? null,
        editar,
        deshacer: () => mover(deshacerH),
        rehacer: () => mover(rehacerH),
        guardar,
        guardado,
        conflicto,
        recargarDisco,
        modo: fuente?.tipo === "origen" ? "escribir" : "descargar",
        pendiente,
      }
    : null;

  return { fase, estado, cliente, fuente, desactualizado, errores, motivoGuardados, firmas, tiempos, version, abrirOrigen, abrirTexto, recalcular, calcular, edicion };
}
