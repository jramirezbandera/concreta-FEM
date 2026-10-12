/**
 * La zona de vistas (I2, `docs/fem3d/interfaz.md` §5 y §14): 1, 2 o 4 celdas sobre un solo lienzo
 * WebGL (`motor.ts`). Cada celda tiene su cabecera de desplegables (tipo, planta o eje, modo), su
 * barra (encuadrar, desplazar, orbitar, proyección) y una fuente que le da lo que
 * dibuja: cada espacio de trabajo dice qué fuente va en cada tipo de vista (`FuentesVistas`); sin
 * ella, la del modelo.
 *
 * Las fuentes son componentes que piden sus datos a la sesión y los pasan a su vista por efectos
 * (`Fuente2D`, `Fuente3D`); también pintan lo que va en el DOM de la celda (la leyenda, un aviso).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookmarkPlus, Box, BoxSelect, Hand, Maximize, Move3d, MousePointer2, Rotate3d, SlidersHorizontal, X } from "lucide-react";
import type { EntradaLeyenda, Estilo, Vec2 } from "../../../src/agente/render/escena.ts";
import type { Alambrico } from "../../../src/visor/alambrico.ts";
import type { Geometria3D } from "../../../src/visor/datos.ts";
import type { Diagramas3D } from "../../../src/visor/diagramas3d.ts";
import type { Isovalores3D } from "../../../src/visor/isovalores3d.ts";
import type { Pilares3D } from "../../../src/visor/pilares3d.ts";
import type { Reacciones3D } from "../../../src/visor/reacciones3d.ts";
import type { Solido } from "../../../src/visor/solido.ts";
import type { EstadoSesion } from "../../../src/visor/sesion.ts";
import type { ExtremoDeformada } from "../../../src/visor/datos.ts";
import type { Eleccion, EscenaPreparada } from "../../../src/visor/escena.ts";
import type { FuenteEscena, VistaPlanta } from "../../../src/visor/sesion.ts";
import { Desplegable, SelectorPlanta } from "../armazon/Disposicion.tsx";
import { Aviso } from "../componentes/comunes.tsx";
import { useVisor } from "../contexto.ts";
import { atributos, pintura } from "../lienzo/pintura.ts";
import { usePedido } from "../sesion/usePedido.ts";
import { useTheme } from "../tema/useTheme.ts";
import { aGuardada, useVistas, vistasDe, type EstadoVista, type TipoVista } from "./estado.ts";
import { Motor, type Herramienta, type Vista } from "./motor.ts";
import { Vista2D, type Eventos2D, type Marca, type Margenes } from "./vista2d.ts";
import { TIPOS_FILTRO, Vista3D, type Color3D, type Eventos3D, type FiltroVista, type Modo3D, type Objetivo3D, type Sonda, type TipoFiltro } from "./vista3d.ts";

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
  /** Lo que dibuja un alzado (por defecto, el modelo). */
  alzado?: (v: EstadoVista, i: number) => ReactNode;
  /** Lo que va en la cabecera de una planta, tras la planta (qué se dibuja). */
  cabeceraPlanta?: (v: EstadoVista, i: number) => ReactNode;
  /** Lo mismo en un 3D y en un alzado (I4: qué resultado se ve). */
  cabecera3D?: (v: EstadoVista, i: number) => ReactNode;
  cabeceraAlzado?: (v: EstadoVista, i: number) => ReactNode;
}

const MARGENES_PLANTA: Margenes = { izq: 24, arriba: 52, der: 24, abajo: 44 };
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
  const [opciones, setOpciones] = useState(false);
  const [guardar, setGuardar] = useState(false);
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
    // Al abrir una vista guardada (`salto`), la vista se rehace con su cámara
  }, [motor, tipo, i, poner, activar, v.salto]);

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

  const contenido = tipo === "planta" ? (fuentes.planta?.(vv, i) ?? <FuenteEscena fuente={planta ? { tipo: "planta", planta, vista: { vista: "modelo" } } : null} />) : tipo === "alzado" ? (fuentes.alzado?.(vv, i) ?? <FuenteEscena fuente={eje ? { tipo: "alzado", plano: planoAlzado(eje, vv) } : null} />) : (fuentes.tresD?.(vv, i) ?? <Fuente3DModelo />);

  return (
    <div className="celda" data-activa={activa} data-tipo={tipo} data-vista={i}>
      <div ref={superficie} className="celda-superficie" style={{ cursor: herramienta === "elegir" ? "crosshair" : "grab" }} aria-label={tipo === "planta" ? `Planta ${planta ?? ""}` : tipo === "alzado" ? `Alzado del eje ${eje ?? ""}` : "Edificio en 3D"} role="img" />
      <div className="vista-cab">
        <Desplegable
          etiqueta="Tipo de vista"
          valor={tipo}
          onCambio={(t) => poner(i, { tipo: t })}
          opciones={(["planta", "alzado", "3d"] as const).map((t) => ({ id: t, nombre: NOMBRE_TIPO[t], disabled: t === "alzado" && !e.ejes.length, title: t === "alzado" && !e.ejes.length ? "Sin ejes de replanteo" : undefined }))}
        />
        {tipo === "planta" && (
          <>
            <SelectorPlanta estado={e} planta={planta} onPlanta={(p) => p && poner(i, { planta: p })} />
            {fuentes.cabeceraPlanta?.(vv, i)}
          </>
        )}
        {tipo === "alzado" && (
          <Desplegable
            etiqueta="Eje del alzado"
            prefijo={<span className="text-text-secondary">Eje</span>}
            valor={eje ?? ""}
            onCambio={(x) => poner(i, { eje: x })}
            opciones={e.ejes.map((x) => ({ id: x.id, nombre: `${x.nombre ?? x.id}${x.propuesto ? " (propuesto)" : ""}` }))}
          />
        )}
        {tipo === "alzado" && (
          <Desplegable
            etiqueta="Profundidad del alzado"
            prefijo={<span className="text-text-secondary">±</span>}
            valor={String(v.profundidad ?? PROFUNDIDAD_POR_DEFECTO)}
            onCambio={(x) => poner(i, { profundidad: Number(x) })}
            opciones={PROFUNDIDADES.map((d) => ({ id: String(d), nombre: `${String(d).replace(".", ",")} m`, title: "Lo que se ve a cada lado del plano del alzado" }))}
          />
        )}
        {tipo === "alzado" && fuentes.cabeceraAlzado?.(vv, i)}
        {tipo === "3d" && (
          <>
            <Desplegable
              etiqueta="Modo del 3D"
              valor={modo3dVisto(v.modo3d, !!fuentes.cabecera3D)}
              onCambio={(m) => poner(i, { modo3d: m })}
              opciones={MODOS_3D.map((m) => ({
                id: m.id,
                nombre: m.nombre,
                disabled: (m.id === "analitico" && !e.compila) || (m.id === "solido" && !!fuentes.cabecera3D),
                title: m.id === "analitico" && !e.compila ? "El modelo no compila" : m.id === "solido" && fuentes.cabecera3D ? "En Resultados, el sólido taparía los resultados: el translúcido lo deja ver detrás" : m.title,
              }))}
            />
            <SelectorPlanta estado={e} planta={planta} onPlanta={(p) => poner(i, { planta: p })} ninguna={fuentes.cabecera3D ? "Todas las plantas" : "Sin resaltar"} />
            {fuentes.cabecera3D?.(vv, i)}
            <ChipsFiltro filtro={v.filtro} onCambio={(f) => poner(i, { filtro: f })} />
          </>
        )}
      </div>
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
        <button type="button" className="ib" data-on={guardar} aria-expanded={guardar} disabled={!proyecto.edicion} title={proyecto.edicion ? "Guardar esta vista en el proyecto, con un nombre" : "Sólo con un proyecto editable"} aria-label="Guardar la vista" onClick={() => setGuardar((x) => !x)}>
          <BookmarkPlus size={15} />
        </button>
        {tipo === "3d" && (
          <>
            <button type="button" className="ib" data-on={herramienta === "orbitar"} aria-pressed={herramienta === "orbitar"} title="Orbitar con el botón izquierdo (siempre: Mayús y botón central o derecho)" aria-label="Orbitar" onClick={() => setHerramienta("orbitar")}>
              <Rotate3d size={15} />
            </button>
            <button type="button" className="ib" data-on={v.proyeccion === "ortografica"} aria-pressed={v.proyeccion === "ortografica"} title={v.proyeccion === "perspectiva" ? "Pasar a ortográfica" : "Pasar a perspectiva"} aria-label="Ortográfica" onClick={() => poner(i, { proyeccion: v.proyeccion === "perspectiva" ? "ortografica" : "perspectiva" })}>
              {v.proyeccion === "perspectiva" ? <Move3d size={15} /> : <Box size={15} />}
            </button>
            <button
              type="button"
              className="ib"
              data-on={!!v.filtro?.caja}
              aria-pressed={!!v.filtro?.caja}
              title={v.filtro?.caja ? "Quitar la caja de sección" : "Caja de sección: empieza en lo elegido (o en todo) y se mueve arrastrando las asas de sus caras"}
              aria-label="Caja de sección"
              onClick={() => {
                const caja = v.filtro?.caja ? null : vista instanceof Vista3D ? vista.cajaPropuesta(new Set(elegidos)) : null;
                poner(i, { filtro: { ...v.filtro, caja } });
              }}
            >
              <BoxSelect size={15} />
            </button>
            <button type="button" className="ib" data-on={opciones} aria-expanded={opciones} title="Opciones de la vista: color, lo que se ve y las plantas" aria-label="Opciones de la vista" onClick={() => setOpciones((x) => !x)}>
              <SlidersHorizontal size={15} />
            </button>
          </>
        )}
      </div>
      {tipo === "3d" && opciones && <OpcionesVista3D v={v} estado={e} onCambio={(c) => poner(i, c)} onCerrar={() => setOpciones(false)} />}
      {guardar && <GuardarVista v={vv} camara={() => vista?.camara() ?? null} onCerrar={() => setGuardar(false)} />}
      <ContextoCelda.Provider value={celda}>{contenido}</ContextoCelda.Provider>
      {motor && !motor.disponible && (
        <div className="velo">
          <Aviso tono="warn">Este navegador no puede dibujar con WebGL: las vistas no se ven. Las tablas, los diagnósticos y los resultados por pieza siguen funcionando.</Aviso>
        </div>
      )}
    </div>
  );
}

/**
 * El modo con que se pinta un 3D: en Resultados (las vistas con cabecera de resultados), el sólido
 * pasa a alámbrico, como en SAP2000 y ETABS; el translúcido, si se pide, da el contexto detrás.
 */
export function modo3dVisto(modo: Modo3D, resultados: boolean): Modo3D {
  return resultados && modo === "solido" ? "alambrico" : modo;
}

const NOMBRE_TIPO: Record<TipoVista, string> = { planta: "Planta", alzado: "Alzado", "3d": "3D" };

const MODOS_3D: { id: Modo3D; nombre: string; title: string }[] = [
  { id: "solido", nombre: "Sólido", title: "Las secciones extruidas, con sus aristas" },
  { id: "translucido", nombre: "Translúcido", title: "El sólido al 35 %, con los ejes encima: para ver lo de dentro" },
  { id: "alambrico", nombre: "Alámbrico", title: "Los ejes de las barras y los contornos de las losas y los muros" },
  { id: "analitico", nombre: "Analítico", title: "El modelo que se calcula: barras y láminas" },
];

/** ±d de un alzado (I3). */
const PROFUNDIDADES = [0.25, 0.5, 1, 2, 5];
const PROFUNDIDAD_POR_DEFECTO = 0.5;

/** El plano del alzado de una vista: su eje y, si no es la de por defecto, su profundidad. */
export function planoAlzado(eje: string, v: EstadoVista): { eje: string; profundidad?: number } {
  return v.profundidad !== undefined && v.profundidad !== PROFUNDIDAD_POR_DEFECTO ? { eje, profundidad: v.profundidad } : { eje };
}

const NOMBRE_FILTRO: Record<TipoFiltro, string> = { pilar: "Pilares", viga: "Vigas", losa: "Losas", pano: "Paños", muro: "Muros", apoyo: "Apoyos" };

/** Lo que filtra un 3D, en chips que lo quitan con un clic (I3). */
function ChipsFiltro({ filtro, onCambio }: { filtro: FiltroVista | undefined; onCambio: (f: FiltroVista) => void }) {
  if (!filtro) return null;
  const chips: { texto: string; title: string; sin: FiltroVista }[] = [];
  if (filtro.desde || filtro.hasta) chips.push({ texto: `Plantas ${filtro.desde ?? "abajo"} → ${filtro.hasta ?? "arriba"}`, title: "Sólo esas plantas (los tramos de pilares y muros, por la planta de su cabeza)", sin: { ...filtro, desde: null, hasta: null } });
  if (filtro.sinTipos?.length) chips.push({ texto: `Sin ${filtro.sinTipos.map((t) => NOMBRE_FILTRO[t].toLowerCase()).join(", ")}`, title: "Tipos de objeto que no se ven", sin: { ...filtro, sinTipos: [] } });
  if (filtro.aislados) chips.push({ texto: `Aislados: ${filtro.aislados.length}`, title: `Sólo se ven ${filtro.aislados.slice(0, 12).join(", ")}${filtro.aislados.length > 12 ? "…" : ""} (H)`, sin: { ...filtro, aislados: null } });
  if (filtro.ocultos?.length) chips.push({ texto: `Ocultos: ${filtro.ocultos.length}`, title: `No se ven ${filtro.ocultos.slice(0, 12).join(", ")}${filtro.ocultos.length > 12 ? "…" : ""} (Ctrl+H)`, sin: { ...filtro, ocultos: [] } });
  if (filtro.caja) chips.push({ texto: "Caja de sección", title: "Recorta lo que se ve; se mueve con las asas de sus caras", sin: { ...filtro, caja: null } });
  return (
    <>
      {chips.map((c) => (
        <span key={c.texto} className="chip chip-filtro" data-acento title={c.title}>
          <span>{c.texto}</span>
          <button type="button" className="ib-chip" aria-label={`Quitar: ${c.texto}`} onClick={() => onCambio(c.sin)}>
            <X size={13} />
          </button>
        </span>
      ))}
    </>
  );
}

/** Guardar la vista en el proyecto con un nombre (I3): una operación del editor, que se deshace. */
function GuardarVista({ v, camara, onCerrar }: { v: EstadoVista; camara: () => unknown; onCerrar: () => void }) {
  const { proyecto } = useVisor();
  const ed = proyecto.edicion;
  const actuales = ed?.proyecto.vistas ?? [];
  const [nombre, setNombre] = useState(() => {
    let n = actuales.length + 1;
    while (actuales.some((x) => x.nombre === `Vista ${n}`)) n++;
    return `Vista ${n}`;
  });
  const limpio = nombre.trim();
  const existe = actuales.some((x) => x.nombre === limpio);
  const hacer = () => {
    if (!ed || !limpio) return;
    const g = aGuardada(v, limpio, camara());
    ed.editar({ op: "vistas", vistas: existe ? actuales.map((x) => (x.nombre === limpio ? g : x)) : [...actuales, g] }, `${existe ? "Sustituir" : "Guardar"} la vista «${limpio}»`);
    onCerrar();
  };
  return (
    <div className="opciones-vista" role="group" aria-label="Guardar la vista">
      <div className="flex items-center justify-between">
        <span className="font-semibold">Guardar la vista</span>
        <button type="button" className="ib-chip" aria-label="Cerrar" onClick={onCerrar}>
          <X size={14} />
        </button>
      </div>
      <label className="mt-2">
        <input className="sel w-full" aria-label="Nombre de la vista" value={nombre} autoFocus onChange={(x) => setNombre(x.target.value)} onKeyDown={(x) => x.key === "Enter" && hacer()} />
      </label>
      <p className="mt-1 text-[11px] leading-snug text-text-disabled">Con su tipo, su planta o su eje, su modo, su cámara y sus filtros. Se guarda en el proyecto (no cambia la huella) y se abre desde el navegador.</p>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className="btn" disabled={!limpio} onClick={hacer}>
          {existe ? "Sustituir" : "Guardar"}
        </button>
        {existe && <span className="text-[11px] text-state-warn">Ya hay una con ese nombre</span>}
      </div>
    </div>
  );
}

/** Las opciones de un 3D (I3): el color del sólido, los tipos que se ven y el rango de plantas. */
function OpcionesVista3D({ v, estado, onCambio, onCerrar }: { v: EstadoVista; estado: EstadoSesion; onCambio: (c: Partial<EstadoVista>) => void; onCerrar: () => void }) {
  const f = v.filtro ?? {};
  const set = (c: Partial<FiltroVista>) => onCambio({ filtro: { ...f, ...c } });
  const sin = new Set(f.sinTipos ?? []);
  const color = v.color3d ?? "material";
  const plantas = estado.plantas;
  return (
    <div className="opciones-vista" role="group" aria-label="Opciones de la vista">
      <div className="flex items-center justify-between">
        <span className="font-semibold">Opciones de la vista</span>
        <button type="button" className="ib-chip" aria-label="Cerrar las opciones" onClick={onCerrar}>
          <X size={14} />
        </button>
      </div>
      <fieldset>
        <legend>Color del sólido</legend>
        {(
          [
            ["material", "Por material"],
            ["seccion", "Por sección"],
            ["planta", "Por planta"],
          ] as [Color3D, string][]
        ).map(([id, nombre]) => (
          <label key={id}>
            <input type="radio" name={`color-${v.tipo}`} checked={color === id} onChange={() => onCambio({ color3d: id })} />
            {nombre}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Se ven</legend>
        <div className="grid grid-cols-2">
          {TIPOS_FILTRO.map((t) => (
            <label key={t}>
              <input
                type="checkbox"
                checked={!sin.has(t)}
                onChange={(x) => {
                  const n = new Set(sin);
                  if (x.target.checked) n.delete(t);
                  else n.add(t);
                  set({ sinTipos: TIPOS_FILTRO.filter((y) => n.has(y)) });
                }}
              />
              {NOMBRE_FILTRO[t]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Plantas</legend>
        <label>
          <span className="w-8">De</span>
          <select className="sel flex-1" aria-label="Planta de abajo" value={f.desde ?? ""} onChange={(x) => set({ desde: x.target.value || null })}>
            <option value="">la de abajo</option>
            {plantas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="w-8">a</span>
          <select className="sel flex-1" aria-label="Planta de arriba" value={f.hasta ?? ""} onChange={(x) => set({ hasta: x.target.value || null })}>
            <option value="">la de arriba</option>
            {plantas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className="btn" onClick={() => onCambio({ filtro: { caja: f.caja ?? null } })}>
          Mostrar todo
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-text-disabled">H aísla lo elegido (otra vez, lo suelta); Ctrl+H lo oculta; Mayús+H lo muestra todo. La caja de sección no se quita con ellos.</p>
    </div>
  );
}

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
      {escena && leyenda && escena.leyenda.length > 0 && <Leyenda key={String(varias)} contenido={escena} abierta={!varias} />}
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
  const escena = usePedido(proyecto.cliente, fu ? (fu.tipo === "planta" ? { tipo: "escena", planta: fu.planta, vista: fu.vista } : { tipo: "alzado", plano: fu.plano, ...(fu.diagramas ? { diagramas: fu.diagramas } : {}) }) : null);
  const { eventos, resaltado } = useEleccionEscena(fu);
  // Con resultados (los diagramas de un alzado), lo de una versión anterior no se enseña
  const resultados = fu?.tipo === "alzado" && !!fu.diagramas;
  const aviso = resultados && proyecto.desactualizado ? (
    <Aviso tono="warn">El fichero cambió: estos resultados ya no son del proyecto.</Aviso>
  ) : proyecto.desactualizado && ed?.pendiente ? (
    <Aviso tono="warn">Compilando la versión editada…</Aviso>
  ) : proyecto.desactualizado ? (
    <Aviso tono="warn">El fichero cambió: abriendo la versión nueva…</Aviso>
  ) : escena.diagnosticos ? (
    <Aviso tono="fail">{escena.diagnosticos.map((d) => d.mensaje).join(" ")}</Aviso>
  ) : !escena.datos && escena.cargando ? (
    <Aviso>{resultados ? "Preparando los diagramas…" : "Preparando la vista…"}</Aviso>
  ) : null;
  const cursor = useMemo(() => (fu?.tipo === "alzado" ? (q: Vec2) => `u ${rot(q[0])} · z ${rot(q[1])} m` : undefined), [fu?.tipo]);
  return <Fuente2D escena={resultados && proyecto.desactualizado ? null : escena.datos} resaltado={resaltado} eventos={eventos} aviso={aviso} cargando={escena.cargando} formatoCursor={cursor} />;
}

const rot = (x: number) => (Math.round(x * 1000) / 1000).toString().replace(".", ",");

/** Las vistas de planta de Modelo: la planta con lo que se dibuja (modelo, diagnósticos o malla). */
export function plantaVista(v: EstadoVista, calculado: boolean): VistaPlanta {
  return { vista: v.dibujo === "malla" && !calculado ? "modelo" : v.dibujo };
}

/** Lo que añade un 3D con resultados (I4): diagramas, isovalores, pilares o reacciones, su leyenda, su estado y lo que hay bajo el cursor. */
export interface Resultados3D {
  diagramas?: Diagramas3D | null;
  isovalores?: Isovalores3D | null;
  pilares?: Pilares3D | null;
  reacciones?: Reacciones3D | null;
  leyenda?: ContenidoLeyenda | null;
  aviso?: ReactNode;
  cargando?: boolean;
  /** Lo que hay bajo el cursor quieto: quien lo recibe pide su consulta y da la sonda. */
  alPasar?: (o: Objetivo3D | null) => void;
  sonda?: Sonda | null;
}

/** La deformada de un 3D: desplazamientos (m), escala, extremos rotulados y si se anima. */
export interface Deformada3D {
  u: Float32Array;
  escala: number;
  extremos?: ExtremoDeformada[];
  animada?: boolean;
}

interface PropsFuente3D extends Resultados3D {
  alambrico: Alambrico | null;
  /** I3: el sólido, en sólido y translúcido. */
  solido?: Solido | null;
  analitico?: Geometria3D | null;
  deformada?: Deformada3D | null;
  /** Fuerza un modo (la deformada, sobre el analítico). */
  modo?: Modo3D;
  eventos?: Eventos3D;
}

/** Un 3D en la vista de la celda. */
export function Fuente3D({ alambrico, solido = null, analitico = null, deformada = null, modo, eventos, cargando = false, aviso, diagramas = null, isovalores = null, pilares = null, reacciones = null, leyenda = null, alPasar, sonda = null }: PropsFuente3D) {
  const { vista, v, varias, i } = useCelda();
  const { poner } = useVistas();
  const x = vista instanceof Vista3D ? vista : null;
  useEffect(() => x?.ponerAlambrico(alambrico), [x, alambrico]);
  useEffect(() => x?.ponerSolido(solido), [x, solido]);
  useEffect(() => x?.ponerFiltro(v.filtro), [x, v.filtro]);
  useEffect(() => x?.ponerColor(v.color3d ?? "material"), [x, v.color3d]);
  const filtro = useRef(v.filtro);
  filtro.current = v.filtro;
  useEffect(() => x?.ponerDiagramas(diagramas), [x, diagramas]);
  useEffect(() => x?.ponerIsovalores(isovalores), [x, isovalores]);
  useEffect(() => x?.ponerPilares(pilares), [x, pilares]);
  useEffect(() => x?.ponerReacciones(reacciones), [x, reacciones]);
  useEffect(() => x?.ponerAnalitico(analitico), [x, analitico]);
  useEffect(() => x?.ponerDeformada(deformada?.u ?? null, deformada?.escala ?? 1, deformada?.extremos), [x, deformada]);
  useEffect(() => x?.ponerAnimacion(!!deformada?.animada), [x, deformada?.animada]);
  useEffect(() => x?.ponerModo(modo ?? v.modo3d), [x, modo, v.modo3d]);
  useEffect(() => x?.ponerProyeccion(v.proyeccion), [x, v.proyeccion]);
  useEffect(() => x?.ponerPlantaActiva(v.planta), [x, v.planta]);
  useEffect(() => x?.ponerSonda(sonda), [x, sonda]);
  useEffect(() => {
    if (x) x.eventos = { ...(eventos ?? {}), ...(alPasar ? { pasar: alPasar } : {}), caja: (c) => poner(i, { filtro: { ...filtro.current, caja: c } }) };
  });
  return (
    <>
      <Cargando si={cargando || (!alambrico && !analitico) || !x} />
      {leyenda && leyenda.leyenda.length > 0 && <Leyenda key={String(varias)} contenido={leyenda} abierta={!varias} />}
      {aviso && <div className="velo">{aviso}</div>}
    </>
  );
}

/** El 3D del modelo: el alámbrico (y el analítico si se pide), con elegir; con resultados (I4), encima. */
export function Fuente3DModelo({ deformada, modo, resultados }: { deformada?: Deformada3D | null; modo?: Modo3D; resultados?: Resultados3D }) {
  const { proyecto, elegidos, setElegidos } = useVisor();
  const { v } = useCelda();
  const e = proyecto.estado!;
  const alamb = usePedido(proyecto.cliente, { tipo: "alambrico" });
  // Con resultados, el sólido taparía lo pintado: pasa a alámbrico (`modo3dVisto`)
  const modoEf: Modo3D = modo ?? modo3dVisto(v.modo3d, !!resultados);
  const quiereSolido = modoEf === "solido" || modoEf === "translucido";
  const sol = usePedido(proyecto.cliente, quiereSolido ? { tipo: "solido" } : null);
  const quiereAnalitico = modoEf === "analitico" && e.compila;
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
  return <Fuente3D alambrico={alamb.datos} solido={quiereSolido ? sol.datos : null} analitico={quiereAnalitico ? geo.datos : null} deformada={deformada} modo={modoEf} eventos={eventos} {...resultados} cargando={alamb.cargando || (quiereSolido && sol.cargando) || (quiereAnalitico && geo.cargando) || !!resultados?.cargando} />;
}

// ─── Leyenda ────────────────────────────────────────────────────────────────────────────────────

/**
 * Los trazos que sólo se dibujan sobre las bandas de un mapa (las isolíneas, oscuras): su muestra va
 * sobre una banda clara, como en el mapa; sobre el fondo del tema oscuro no se verían.
 */
const SOBRE_BANDAS: ReadonlySet<Estilo> = new Set<Estilo>(["isolinea", "isolinea-cero"]);
/** La banda más clara de la paleta de los mapas (`coloresBandas`). */
const FONDO_BANDA = "#fddbc7";

/** Lo que enseña una leyenda: sus entradas y sus notas (las de una escena o las de un 3D con resultados). */
export interface ContenidoLeyenda {
  leyenda: readonly EntradaLeyenda[];
  notas: readonly string[];
}

function Leyenda({ contenido: escena, abierta }: { contenido: ContenidoLeyenda; abierta: boolean }) {
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
                  {l.relleno || p.fill ? (
                    <rect x={0.5} y={0.5} width={17} height={11} {...atributos({ ...p, sw: Math.min(p.sw ?? 1, 1.5) }, l.relleno)} />
                  ) : (
                    <>
                      {l.estilo && SOBRE_BANDAS.has(l.estilo) && <rect x={0} y={0} width={18} height={12} rx={2} fill={FONDO_BANDA} />}
                      <path d="M0 6h18" {...atributos(p)} />
                    </>
                  )}
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
