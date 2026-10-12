/**
 * La zona de vistas (I2, `docs/fem3d/interfaz.md` §5 y §14): 1, 2 o 4 celdas sobre un solo lienzo
 * WebGL (`motor.ts`). Cada celda tiene su cabecera (tipo, planta o eje, modo), su carril de plantas
 * (planta y 3D), su barra (encuadrar, desplazar, orbitar, proyección) y una fuente que le da lo que
 * dibuja: cada espacio de trabajo dice qué fuente va en cada tipo de vista (`FuentesVistas`); sin
 * ella, la del modelo.
 *
 * Las fuentes son componentes que piden sus datos a la sesión y los pasan a su vista por efectos
 * (`Fuente2D`, `Fuente3D`); también pintan lo que va en el DOM de la celda (la leyenda, un aviso).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Box, Hand, Maximize, Move3d, MousePointer2, Rotate3d } from "lucide-react";
import type { Vec2 } from "../../../src/agente/render/escena.ts";
import type { Alambrico } from "../../../src/visor/alambrico.ts";
import type { Geometria3D } from "../../../src/visor/datos.ts";
import type { Eleccion, EscenaPreparada } from "../../../src/visor/escena.ts";
import type { FuenteEscena, VistaPlanta } from "../../../src/visor/sesion.ts";
import { CarrilPlantas, Chip } from "../armazon/Disposicion.tsx";
import { Aviso } from "../componentes/comunes.tsx";
import { useVisor } from "../contexto.ts";
import { cota } from "../fmt.ts";
import { atributos, pintura } from "../lienzo/pintura.ts";
import { usePedido } from "../sesion/usePedido.ts";
import { useTheme } from "../tema/useTheme.ts";
import { useVistas, vistasDe, type EstadoVista, type TipoVista } from "./estado.ts";
import { Motor, type Herramienta, type Vista } from "./motor.ts";
import { Vista2D, type Eventos2D, type Marca, type Margenes } from "./vista2d.ts";
import { Vista3D, type Eventos3D, type Modo3D } from "./vista3d.ts";

// ─── La celda y su contexto ─────────────────────────────────────────────────────────────────────

interface Celda {
  i: number;
  /** Hay varias vistas: lo que flota (la leyenda) empieza plegado. */
  varias: boolean;
  v: EstadoVista;
  vista: Vista | null;
}

/**
 * «Está llegando lo que dibuja la vista»: en el mismo render que el pedido (los bancos esperan a
 * que todas las `.lienzo[data-cargando]` digan false).
 */
function Cargando({ si }: { si: boolean }) {
  return <span hidden className="lienzo" data-cargando={si} />;
}

const ContextoCelda = createContext<Celda | null>(null);
const useCelda = (): Celda => {
  const c = useContext(ContextoCelda);
  if (!c) throw new Error("useCelda fuera de una celda");
  return c;
};

/** El motor que se ve ahora (para los atajos de `App`: F encuadra la vista activa). */
let motorVisible: { motor: Motor; activa: () => number } | null = null;
export function encuadrarActiva(): void {
  if (!motorVisible) return;
  motorVisible.motor.vista(motorVisible.activa())?.encuadrar();
}

/** Para el banco de Chrome: el motor y sus vistas. */
declare global {
  interface Window {
    __motorVistas?: Motor | null;
  }
}

export interface FuentesVistas {
  /** Lo que dibuja una planta (por defecto, el modelo). */
  planta?: (v: EstadoVista, i: number) => ReactNode;
  /** Lo que dibuja un 3D (por defecto, el alámbrico o el analítico). */
  tresD?: (v: EstadoVista, i: number) => ReactNode;
  /** Lo que va en la cabecera de una planta, tras la planta (qué se dibuja). */
  cabeceraPlanta?: (v: EstadoVista, i: number) => ReactNode;
}

const MARGENES_PLANTA: Margenes = { izq: 124, arriba: 52, der: 24, abajo: 44 };
const MARGENES_ALZADO: Margenes = { izq: 24, arriba: 52, der: 24, abajo: 44 };

export function ZonaVistas({ fuentes = {} }: { fuentes?: FuentesVistas }) {
  const vistas = useVistas();
  const { theme } = useTheme();
  const zona = useRef<HTMLDivElement>(null);
  const [motor, setMotor] = useState<Motor | null>(null);
  const activa = useRef(vistas.activa);
  activa.current = vistas.activa;

  useEffect(() => {
    const m = new Motor(zona.current!, theme);
    m.alCursor = (t) => {
      const el = document.querySelector<HTMLElement>("[data-cursor]");
      if (el) el.textContent = t ?? "";
    };
    setMotor(m);
    motorVisible = { motor: m, activa: () => activa.current };
    window.__motorVistas = m;
    return () => {
      if (motorVisible?.motor === m) motorVisible = null;
      if (window.__motorVistas === m) window.__motorVistas = null;
      m.liberar();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- el tema se cambia abajo sin rehacer el motor
  }, []);

  useEffect(() => motor?.ponerTema(theme), [motor, theme]);

  const n = vistasDe(vistas.disposicion);
  return (
    <div ref={zona} className="zona-vistas" data-disposicion={vistas.disposicion}>
      {vistas.vistas.slice(0, n).map((v, i) => (
        <CeldaVista key={i} i={i} v={v} motor={motor} fuentes={fuentes} activa={n > 1 && vistas.activa === i} varias={n > 1} />
      ))}
    </div>
  );
}

function CeldaVista({ i, v, motor, fuentes, activa, varias }: { i: number; v: EstadoVista; motor: Motor | null; fuentes: FuentesVistas; activa: boolean; varias: boolean }) {
  const vistas = useVistas();
  const { proyecto, elegidos } = useVisor();
  const e = proyecto.estado!;
  const superficie = useRef<HTMLDivElement>(null);
  const [vista, setVista] = useState<Vista | null>(null);
  const [herramienta, setHerramienta] = useState<Herramienta>("elegir");
  const camaras = useRef(v.camaras);
  camaras.current = v.camaras;
  const { poner, activar } = vistas;

  const tipo = v.tipo;
  useEffect(() => {
    if (!motor?.disponible || !superficie.current) return;
    const cam = camaras.current?.[tipo];
    const x = tipo === "3d" ? new Vista3D(motor.entorno, cam as never) : new Vista2D(motor.entorno, cam as never);
    if (x instanceof Vista2D) x.margenes = tipo === "planta" ? MARGENES_PLANTA : MARGENES_ALZADO;
    x.alActivar = () => activar(i);
    x.alCambiarCamara = (c) => poner(i, { camaras: { ...camaras.current, [tipo]: c } });
    motor.poner(i, x, superficie.current);
    setVista(x);
    return () => {
      motor.quitar(i);
      setVista(null);
    };
  }, [motor, tipo, i, poner, activar]);

  useEffect(() => {
    if (vista) vista.herramienta = herramienta;
  }, [vista, herramienta]);

  // El encuadre completo deja sitio a la leyenda (plegada con varias vistas)
  useEffect(() => {
    if (vista instanceof Vista2D) vista.margenes = { ...(tipo === "planta" ? MARGENES_PLANTA : MARGENES_ALZADO), der: varias ? 132 : 220 };
  }, [vista, tipo, varias]);

  const ids = useMemo(() => new Set(elegidos), [elegidos]);
  useEffect(() => {
    if (vista instanceof Vista2D || vista instanceof Vista3D) vista.ponerElegidos(ids);
  }, [vista, ids]);

  // En 3D, la planta resaltada puede no ser ninguna (es lo de por defecto)
  const planta = e.plantas.some((p) => p.id === v.planta) ? v.planta! : tipo === "3d" ? null : (e.plantas[0]?.id ?? null);
  const eje = e.ejes.some((x) => x.id === v.eje) ? v.eje! : (e.ejes[0]?.id ?? null);
  const vv = useMemo(() => ({ ...v, planta, eje }), [v, planta, eje]);
  const celda = useMemo(() => ({ i, varias, v: vv, vista }), [i, varias, vv, vista]);
  const plantaV = e.plantas.find((p) => p.id === planta);

  const contenido = tipo === "planta" ? (fuentes.planta?.(vv, i) ?? <FuenteEscena fuente={planta ? { tipo: "planta", planta, vista: { vista: "modelo" } } : null} />) : tipo === "alzado" ? <FuenteEscena fuente={eje ? { tipo: "alzado", plano: { eje } } : null} /> : (fuentes.tresD?.(vv, i) ?? <Fuente3DModelo />);

  return (
    <div className="celda" data-activa={activa} data-tipo={tipo} data-vista={i}>
      <div ref={superficie} className="celda-superficie" style={{ cursor: herramienta === "elegir" ? "crosshair" : "grab" }} aria-label={tipo === "planta" ? `Planta ${planta ?? ""}` : tipo === "alzado" ? `Alzado del eje ${eje ?? ""}` : "Edificio en 3D"} role="img" />
      <div className="vista-cab">
        <span className="chip seg-chip" role="group" aria-label="Tipo de vista">
          {(["planta", "alzado", "3d"] as const).map((t) => (
            <button key={t} type="button" data-on={tipo === t} aria-pressed={tipo === t} disabled={t === "alzado" && !e.ejes.length} title={t === "alzado" && !e.ejes.length ? "Sin ejes de replanteo" : undefined} onClick={() => poner(i, { tipo: t })}>
              {NOMBRE_TIPO[t]}
            </button>
          ))}
        </span>
        {tipo === "planta" && (
          <>
            <Chip>
              <strong className="font-semibold">Planta {planta ?? "—"}</strong>
              <span className="mono text-text-secondary">{cota(plantaV?.cota)}</span>
            </Chip>
            {fuentes.cabeceraPlanta?.(vv, i)}
          </>
        )}
        {tipo === "alzado" && (
          <label className="chip" title="El eje del alzado">
            <strong className="font-semibold">Eje</strong>
            <select className="sel-chip" value={eje ?? ""} onChange={(x) => poner(i, { eje: x.target.value })} aria-label="Eje del alzado">
              {e.ejes.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nombre ?? x.id}
                  {x.propuesto ? " (propuesto)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        {tipo === "3d" && (
          <span className="chip seg-chip" role="group" aria-label="Modo del 3D">
            {(["alambrico", "analitico"] as Modo3D[]).map((m) => (
              <button key={m} type="button" data-on={v.modo3d === m} aria-pressed={v.modo3d === m} disabled={m === "analitico" && !e.compila} title={m === "analitico" ? (e.compila ? "El modelo que se calcula: barras y láminas" : "El modelo no compila") : "Los ejes de las barras y los contornos de las losas y los muros"} onClick={() => poner(i, { modo3d: m })}>
                {m === "alambrico" ? "Alámbrico" : "Analítico"}
              </button>
            ))}
          </span>
        )}
      </div>
      {tipo !== "alzado" && <CarrilPlantas estado={e} planta={planta} onPlanta={(p) => poner(i, { planta: tipo === "3d" && p === planta ? null : p })} />}
      <div className="vista-barra" role="toolbar" aria-label="Barra de la vista">
        <button type="button" className="ib" title="Encuadrar (F)" aria-label="Encuadrar" onClick={() => vista?.encuadrar()}>
          <Maximize size={15} />
        </button>
        <button type="button" className="ib" data-on={herramienta === "elegir"} aria-pressed={herramienta === "elegir"} title="Elegir: clic y ventana (Esc suelta)" aria-label="Elegir" onClick={() => setHerramienta("elegir")}>
          <MousePointer2 size={15} />
        </button>
        <button type="button" className="ib" data-on={herramienta === "desplazar"} aria-pressed={herramienta === "desplazar"} title="Desplazar con el botón izquierdo (siempre: botón central o derecho)" aria-label="Desplazar" onClick={() => setHerramienta("desplazar")}>
          <Hand size={15} />
        </button>
        {tipo === "3d" && (
          <>
            <button type="button" className="ib" data-on={herramienta === "orbitar"} aria-pressed={herramienta === "orbitar"} title="Orbitar con el botón izquierdo (siempre: Mayús y botón central o derecho)" aria-label="Orbitar" onClick={() => setHerramienta("orbitar")}>
              <Rotate3d size={15} />
            </button>
            <button type="button" className="ib" data-on={v.proyeccion === "ortografica"} aria-pressed={v.proyeccion === "ortografica"} title={v.proyeccion === "perspectiva" ? "Pasar a ortográfica" : "Pasar a perspectiva"} aria-label="Ortográfica" onClick={() => poner(i, { proyeccion: v.proyeccion === "perspectiva" ? "ortografica" : "perspectiva" })}>
              {v.proyeccion === "perspectiva" ? <Move3d size={15} /> : <Box size={15} />}
            </button>
          </>
        )}
      </div>
      <ContextoCelda.Provider value={celda}>{contenido}</ContextoCelda.Provider>
      {motor && !motor.disponible && (
        <div className="velo">
          <Aviso tono="warn">Este navegador no puede dibujar con WebGL: las vistas no se ven. Las tablas, los diagnósticos y los resultados por pieza siguen funcionando.</Aviso>
        </div>
      )}
    </div>
  );
}

const NOMBRE_TIPO: Record<TipoVista, string> = { planta: "Planta", alzado: "Alzado", "3d": "3D" };

// ─── Fuentes ────────────────────────────────────────────────────────────────────────────────────

interface PropsFuente2D {
  escena: EscenaPreparada | null;
  resaltado?: Eleccion | null;
  marcas?: Marca[];
  eventos?: Eventos2D;
  /** Algo que encima de la vista dice por qué no hay dibujo o que está cambiando. */
  aviso?: ReactNode;
  cargando?: boolean;
  leyenda?: boolean;
  formatoCursor?: (q: Vec2) => string;
}

/** Una escena 2D en la vista de la celda. */
export function Fuente2D({ escena, resaltado = null, marcas, eventos, aviso, cargando = false, leyenda = true, formatoCursor }: PropsFuente2D) {
  const { vista, varias } = useCelda();
  const v = vista instanceof Vista2D ? vista : null;
  useEffect(() => v?.ponerEscena(escena), [v, escena]);
  useEffect(() => v?.ponerResaltado(resaltado), [v, resaltado]);
  useEffect(() => v?.ponerMarcas(marcas), [v, marcas]);
  useEffect(() => {
    if (!v) return;
    v.eventos = eventos ?? {};
    if (formatoCursor) v.formatoCursor = formatoCursor;
  });
  return (
    <>
      <Cargando si={cargando || !escena || !v} />
      {escena && leyenda && escena.leyenda.length > 0 && <Leyenda key={String(varias)} escena={escena} abierta={!varias} />}
      {aviso && <div className="velo">{aviso}</div>}
    </>
  );
}

/**
 * Lo que una escena del modelo hace con el ratón (en Modelo, en Cargas y en los alzados): un clic
 * elige (Ctrl+clic añade o quita), una ventana elige lo que cae en ella y un doble clic en un eje
 * abre su alzado.
 */
export function useEleccionEscena(fuente: FuenteEscena | null): { eventos: Eventos2D; resaltado: Eleccion | null } {
  const { proyecto, elegidos, setElegidos } = useVisor();
  const { abrirAlzado } = useVistas();
  const ejes = proyecto.estado?.ejes;
  const ultimo = useRef(elegidos);
  ultimo.current = elegidos;
  const cliente = proyecto.cliente;
  const anadir = useCallback(
    (ids: string[], ctrl: boolean) => {
      const ya = ultimo.current;
      if (!ctrl) return setElegidos(ids);
      // Ctrl: los que estaban se quitan; los nuevos se añaden (el último, principal)
      const quitar = new Set(ids.filter((x) => ya.includes(x)));
      setElegidos([...ya.filter((x) => !quitar.has(x)), ...ids.filter((x) => !quitar.has(x))]);
    },
    [setElegidos],
  );
  const eventos = useMemo<Eventos2D>(
    () => ({
      clic: async (p, radio, ctrl, doble) => {
        if (!cliente || !fuente) return;
        const r = await cliente.pedir({ tipo: "elegir", fuente, punto: p, radio });
        const o = r.ok && r.valor ? (r.valor as Eleccion).objeto : null;
        if (doble && o && ejes?.some((x) => x.id === o)) return abrirAlzado(o);
        if (o) anadir([o], ctrl);
        else if (!ctrl) setElegidos([]);
      },
      ventana: async (caja, modo, ctrl) => {
        if (!cliente || !fuente) return;
        const r = await cliente.pedir({ tipo: "ventana", fuente, caja, modo });
        if (r.ok) anadir(r.valor as string[], ctrl);
      },
    }),
    [cliente, fuente, ejes, abrirAlzado, anadir, setElegidos],
  );
  const pedido = usePedido(cliente, fuente && elegidos.length ? { tipo: "elegir", fuente, punto: null, radio: 0, objetos: elegidos } : null);
  const resaltado = pedido.datos && elegidos.includes(pedido.datos.objeto) ? pedido.datos : null;
  return { eventos, resaltado };
}

/** Una escena del modelo (una planta en una vista, o un alzado), con elegir. */
export function FuenteEscena({ fuente }: { fuente: FuenteEscena | null }) {
  const { proyecto } = useVisor();
  const ed = proyecto.edicion;
  // La clave estable: el objeto cambia en cada render
  const clave = JSON.stringify(fuente);
  const fu = useMemo(() => (clave === "null" ? null : (JSON.parse(clave) as FuenteEscena)), [clave]);
  const escena = usePedido(proyecto.cliente, fu ? (fu.tipo === "planta" ? { tipo: "escena", planta: fu.planta, vista: fu.vista } : { tipo: "alzado", plano: fu.plano }) : null);
  const { eventos, resaltado } = useEleccionEscena(fu);
  const aviso = proyecto.desactualizado && ed?.pendiente ? (
    <Aviso tono="warn">Compilando la versión editada…</Aviso>
  ) : proyecto.desactualizado ? (
    <Aviso tono="warn">El fichero cambió: abriendo la versión nueva…</Aviso>
  ) : escena.diagnosticos ? (
    <Aviso tono="fail">{escena.diagnosticos.map((d) => d.mensaje).join(" ")}</Aviso>
  ) : !escena.datos && escena.cargando ? (
    <Aviso>Preparando la vista…</Aviso>
  ) : null;
  const cursor = useMemo(() => (fu?.tipo === "alzado" ? (q: Vec2) => `u ${rot(q[0])} · z ${rot(q[1])} m` : undefined), [fu?.tipo]);
  return <Fuente2D escena={escena.datos} resaltado={resaltado} eventos={eventos} aviso={aviso} cargando={escena.cargando} formatoCursor={cursor} />;
}

const rot = (x: number) => (Math.round(x * 1000) / 1000).toString().replace(".", ",");

/** Las vistas de planta de Modelo: la planta con lo que se dibuja (modelo, diagnósticos o malla). */
export function plantaVista(v: EstadoVista, calculado: boolean): VistaPlanta {
  return { vista: v.dibujo === "malla" && !calculado ? "modelo" : v.dibujo };
}

interface PropsFuente3D {
  alambrico: Alambrico | null;
  analitico?: Geometria3D | null;
  deformada?: { u: Float32Array; escala: number } | null;
  /** Fuerza un modo (la deformada, sobre el analítico). */
  modo?: Modo3D;
  eventos?: Eventos3D;
  cargando?: boolean;
  aviso?: ReactNode;
}

/** Un 3D en la vista de la celda. */
export function Fuente3D({ alambrico, analitico = null, deformada = null, modo, eventos, cargando = false, aviso }: PropsFuente3D) {
  const { vista, v } = useCelda();
  const x = vista instanceof Vista3D ? vista : null;
  useEffect(() => x?.ponerAlambrico(alambrico), [x, alambrico]);
  useEffect(() => x?.ponerAnalitico(analitico), [x, analitico]);
  useEffect(() => x?.ponerDeformada(deformada?.u ?? null, deformada?.escala ?? 1), [x, deformada]);
  useEffect(() => x?.ponerModo(modo ?? v.modo3d), [x, modo, v.modo3d]);
  useEffect(() => x?.ponerProyeccion(v.proyeccion), [x, v.proyeccion]);
  useEffect(() => x?.ponerPlantaActiva(v.planta), [x, v.planta]);
  useEffect(() => {
    if (x) x.eventos = eventos ?? {};
  });
  return (
    <>
      <Cargando si={cargando || (!alambrico && !analitico) || !x} />
      {aviso && <div className="velo">{aviso}</div>}
    </>
  );
}

/** El 3D del modelo: el alámbrico (y el analítico si se pide), con elegir. */
export function Fuente3DModelo({ deformada, modo }: { deformada?: { u: Float32Array; escala: number } | null; modo?: Modo3D }) {
  const { proyecto, elegidos, setElegidos } = useVisor();
  const { v } = useCelda();
  const e = proyecto.estado!;
  const alamb = usePedido(proyecto.cliente, { tipo: "alambrico" });
  const quiereAnalitico = (modo ?? v.modo3d) === "analitico" && e.compila;
  const geo = usePedido(proyecto.cliente, quiereAnalitico ? { tipo: "geometria" } : null);
  const ultimo = useRef(elegidos);
  ultimo.current = elegidos;
  const eventos = useMemo<Eventos3D>(
    () => ({
      elegir: (ids, ctrl) => {
        const ya = ultimo.current;
        if (!ctrl) return setElegidos(ids);
        const quitar = new Set(ids.filter((x) => ya.includes(x)));
        setElegidos([...ya.filter((x) => !quitar.has(x)), ...ids.filter((x) => !quitar.has(x))]);
      },
    }),
    [setElegidos],
  );
  return <Fuente3D alambrico={alamb.datos} analitico={quiereAnalitico ? geo.datos : null} deformada={deformada} modo={modo} eventos={eventos} cargando={alamb.cargando || (quiereAnalitico && geo.cargando)} />;
}

// ─── Leyenda ────────────────────────────────────────────────────────────────────────────────────

function Leyenda({ escena, abierta }: { escena: EscenaPreparada; abierta: boolean }) {
  const { theme: tema } = useTheme();
  const [ver, setVer] = useState(abierta);
  return (
    <div className="leyenda-vista scroll-hide" data-abierta={ver}>
      <button type="button" className="flex w-full items-center justify-between px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled" onClick={() => setVer((x) => !x)} aria-expanded={ver}>
        Leyenda <span aria-hidden="true">{ver ? "−" : "+"}</span>
      </button>
      {ver && (
        <div className="px-2.5 pb-2">
          {escena.leyenda.map((l, i) => {
            const p = l.estilo ? pintura(l.estilo, tema) : {};
            return (
              <div key={i} className="flex items-start gap-2 py-[2px] text-text-secondary">
                <svg width={18} height={12} className="mt-[1px] shrink-0" aria-hidden="true">
                  {l.relleno || p.fill ? <rect x={0.5} y={0.5} width={17} height={11} {...atributos({ ...p, sw: Math.min(p.sw ?? 1, 1.5) }, l.relleno)} /> : <path d="M0 6h18" {...atributos(p)} />}
                </svg>
                <span className={l.relleno ? "mono" : undefined}>{l.texto}</span>
              </div>
            );
          })}
          {escena.notas.length > 0 && (
            <div className="mt-2 border-t border-border-sub pt-1.5 text-[10.5px] leading-snug text-text-disabled">
              {escena.notas.map((n, i) => (
                <p key={i} className="mt-1">
                  {n}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
