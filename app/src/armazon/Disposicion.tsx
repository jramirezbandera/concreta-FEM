/**
 * La disposición común de los espacios de trabajo (`docs/fem3d/interfaz.md` §3 y §13): barra de
 * herramientas, navegador, vista, propiedades y panel inferior. Cada espacio da el contenido de cada
 * hueco; la disposición sólo los coloca, los pliega y recuerda cómo se dejaron (`paneles.ts`).
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Maximize2, Minimize2 } from "lucide-react";
import type { EstadoSesion } from "../../../src/visor/sesion.ts";
import { useDesplegado } from "../componentes/desplegado.ts";
import { cota } from "../fmt.ts";
import type { Icono } from "./iconos.tsx";
import type { Paneles } from "./paneles.ts";
import { Grupo } from "../componentes/Grupo.tsx";

// ─── Barra de herramientas ──────────────────────────────────────────────────────────────────────

export function Herramienta({ icono: I, nombre, onClick, activa, disabled, title }: { icono: Icono; nombre: string; onClick: () => void; activa?: boolean; disabled?: boolean; title?: string }) {
  return (
    <button type="button" className="herr" data-on={!!activa} aria-pressed={activa === undefined ? undefined : activa} disabled={disabled} title={title} onClick={onClick}>
      <I size={20} />
      <span>{nombre}</span>
    </button>
  );
}

export function Separador() {
  return <span className="herr-sep" aria-hidden="true" />;
}

/**
 * Un menú que cuelga de un botón (UI-7: lo que no cabe en una barra estrecha). Va en `position:
 * fixed`, porque la barra de herramientas recorta lo que se sale de ella; se cierra con Esc, con un
 * clic fuera, al cambiar el tamaño de la ventana y al usar cualquiera de sus botones.
 */
export function MenuFlotante({ boton, etiqueta, children, clase = "" }: { boton: (p: { abierto: boolean; alternar: () => void; ref: RefObject<HTMLButtonElement | null> }) => ReactNode; etiqueta: string; children: ReactNode; clase?: string }) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useDesplegado(abierto, () => setAbierto(false), [menu], ref);
  // UI2-4: con el menú ya en el árbol (oculto), se mide y se deja entero dentro de la ventana.
  useLayoutEffect(() => {
    if (!abierto) {
      setPos(null);
      return;
    }
    const r = ref.current?.getBoundingClientRect();
    const ancho = menu.current?.offsetWidth ?? 240;
    const alto = menu.current?.offsetHeight ?? 0;
    if (r) {
      const debajo = r.bottom + 4;
      setPos({
        x: Math.max(8, Math.min(r.left, window.innerWidth - ancho - 8)),
        y: debajo + alto > window.innerHeight - 8 ? Math.max(8, r.top - 4 - alto) : debajo,
      });
    }
    const cerrar = () => setAbierto(false);
    window.addEventListener("resize", cerrar);
    return () => window.removeEventListener("resize", cerrar);
  }, [abierto]);
  return (
    <>
      {boton({ abierto, alternar: () => setAbierto((x) => !x), ref })}
      {abierto && (
        <div
          ref={menu}
          className={`menu-flotante ${clase}`}
          role="menu"
          aria-label={etiqueta}
          style={pos ? { left: pos.x, top: pos.y } : { visibility: "hidden" }}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("button")) setAbierto(false);
          }}
        >
          {children}
        </div>
      )}
    </>
  );
}

/**
 * Herramientas que, en una barra estrecha (por debajo de 1500 px), se pliegan en un botón con su
 * menú (UI-7: Mover…Renumerar en «Editar ▾»). En una ancha se ven como siempre y el botón no.
 */
export function GrupoPlegable({ icono: I, nombre, activa, children }: { icono: Icono; nombre: string; activa?: boolean; children: ReactNode }) {
  return (
    <>
      <span className="herr-grupo">{children}</span>
      <MenuFlotante
        etiqueta={nombre}
        clase="herr-menu"
        boton={({ abierto, alternar, ref }) => (
          <button ref={ref} type="button" className="herr herr-plegado" data-on={!!activa || abierto} aria-haspopup="menu" aria-expanded={abierto} title={`${nombre}: lo que no cabe en la barra`} onClick={alternar}>
            <I size={20} />
            <span>
              {nombre} <ChevronDown size={11} className="inline" aria-hidden="true" />
            </span>
          </button>
        )}
      >
        {children}
      </MenuFlotante>
    </>
  );
}

export function Hueco() {
  return <span className="min-w-3 flex-1" />;
}

/** Elegir uno de varios valores cortos (magnitud, esfuerzo), en monoespaciada. */
export function Segmentado<T extends string>({ opciones, valor, onCambio, etiqueta, deshabilitada }: { opciones: readonly { id: T; nombre: string; title?: string }[]; valor: T; onCambio: (v: T) => void; etiqueta: string; deshabilitada?: (id: T) => boolean }) {
  return (
    // Mono sólo si todas las opciones son ids («uz», «M11», «Fz»), no palabras (UI2-14)
    <div className="herr-seg" role="group" aria-label={etiqueta} data-ids={opciones.every((o) => /^[A-Za-zσν]{1,2}\d{0,2}$/.test(o.nombre)) || undefined}>
      <span className="herr-seg-et">{etiqueta}</span>
      <div>
        {opciones.map((o) => (
          <button key={o.id} type="button" data-on={valor === o.id} aria-pressed={valor === o.id} disabled={deshabilitada?.(o.id)} title={o.title} onClick={() => onCambio(o.id)}>
            {o.nombre}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Un control con su etiqueta encima, en la barra (la combinación, el caso, la escala). */
export function Campo({ etiqueta, children, ancho }: { etiqueta: string; children: ReactNode; ancho?: number }) {
  return (
    <label className="herr-campo" style={ancho ? { width: ancho } : undefined}>
      <span>{etiqueta}</span>
      {children}
    </label>
  );
}

/** Elegir uno de varios valores en la barra: un `Campo` con su desplegable, alineado con los demás. */
export function CampoLista<T extends string>({ etiqueta, nombre, opciones, valor, onCambio, ancho }: { etiqueta: string; nombre?: string; opciones: readonly Opcion<T>[]; valor: T; onCambio: (v: T) => void; ancho?: number }) {
  return (
    <Campo etiqueta={etiqueta} ancho={ancho}>
      <select className="sel w-full" value={valor} onChange={(x) => onCambio(x.target.value as T)} aria-label={nombre ?? etiqueta} title={opciones.find((o) => o.id === valor)?.title}>
        {opciones.map((o) => (
          <option key={o.id} value={o.id} disabled={o.disabled} title={o.title}>
            {o.nombre}
          </option>
        ))}
      </select>
    </Campo>
  );
}

// ─── Vista: cabecera y selector de plantas ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Lo que dice qué se ve, arriba a la izquierda de la vista. */
export function CabeceraVista({ children }: { children: ReactNode }) {
  return <div className="vista-cab">{children}</div>;
}

export function Chip({ children, acento, title }: { children: ReactNode; acento?: boolean; title?: string }) {
  return (
    <span className="chip" data-acento={!!acento} title={title}>
      {children}
    </span>
  );
}

export interface Opcion<T extends string> {
  id: T;
  nombre: string;
  title?: string;
  disabled?: boolean;
}

/** Elegir uno de varios valores en la cabecera de una vista: un desplegable en un chip. */
export function Desplegable<T extends string>({ etiqueta, opciones, valor, onCambio, prefijo }: { etiqueta: string; opciones: readonly Opcion<T>[]; valor: T; onCambio: (v: T) => void; prefijo?: ReactNode }) {
  return (
    <label className="chip sel" title={opciones.find((o) => o.id === valor)?.title}>
      {prefijo}
      <select className="sel-chip" value={valor} onChange={(x) => onCambio(x.target.value as T)} aria-label={etiqueta}>
        {opciones.map((o) => (
          <option key={o.id} value={o.id} disabled={o.disabled} title={o.title}>
            {o.nombre}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className="sel-flecha" aria-hidden="true" />
    </label>
  );
}

/**
 * La planta de la vista (§5.1), de arriba abajo, en un desplegable con su cota y los errores y
 * avisos de cada una, y dos flechas para la de encima y la de debajo (AvPág y RePág, en `App`).
 * Con `ninguna`, se puede no elegir ninguna (el 3D: sin planta resaltada).
 */
export function SelectorPlanta({ estado, planta, onPlanta, ninguna }: { estado: EstadoSesion; planta: string | null; onPlanta: (id: string | null) => void; ninguna?: string }) {
  const k = estado.plantas.findIndex((p) => p.id === planta);
  const actual = estado.plantas[k];
  const ir = (d: number) => {
    const p = k < 0 ? estado.plantas[d > 0 ? 0 : estado.plantas.length - 1] : estado.plantas[k + d];
    if (p) onPlanta(p.id);
  };
  return (
    <span className="chip sel planta-sel">
      <span className="planta-sel-campo">
        {/* C-22: el punto es una imagen con su texto (un `<i aria-label>` sin rol se lo saltan los lectores) */}
        {actual && (actual.errores ? <i className="f" role="img" aria-label={`${actual.errores} error${actual.errores === 1 ? "" : "es"}`} title={`${actual.errores} error${actual.errores === 1 ? "" : "es"}`} /> : actual.avisos ? <i className="w" role="img" aria-label={`${actual.avisos} aviso${actual.avisos === 1 ? "" : "s"}`} title={`${actual.avisos} aviso${actual.avisos === 1 ? "" : "s"}`} /> : null)}
        <select className="sel-chip" value={planta ?? ""} onChange={(x) => onPlanta(x.target.value || null)} aria-label="Planta" title={actual?.nombre ? `${actual.id} · ${actual.nombre}` : undefined}>
          {ninguna !== undefined && <option value="">{ninguna}</option>}
          {estado.plantas.map((p) => (
            <option key={p.id} value={p.id}>
              {`${p.id}  ${cota(p.cota)}${p.errores ? ` · ${p.errores} error${p.errores === 1 ? "" : "es"}` : p.avisos ? ` · ${p.avisos} aviso${p.avisos === 1 ? "" : "s"}` : ""}`}
            </option>
          ))}
        </select>
        <ChevronDown size={13} className="sel-flecha" aria-hidden="true" />
      </span>
      <span className="planta-sel-sep" aria-hidden="true" />
      <button type="button" className="ib-chip" disabled={k === 0} onClick={() => ir(-1)} title="Planta de encima (RePág)" aria-label="Planta de encima">
        <ChevronUp size={14} />
      </button>
      <button type="button" className="ib-chip" disabled={k === estado.plantas.length - 1} onClick={() => ir(1)} title="Planta de debajo (AvPág)" aria-label="Planta de debajo">
        <ChevronDown size={14} />
      </button>
    </span>
  );
}

/** Un eje de replanteo como lo da la sesión: basta su id, su nombre y su recta. */
type EjeVista = EstadoSesion["ejes"][number];

/**
 * Los ejes paralelos a uno (su familia: los de letra o los de número), en el orden de la lista:
 * las flechas del alzado recorren los pórticos de una dirección sin saltar a la otra.
 */
export function ejesParalelos(ejes: readonly EjeVista[], id: string): EjeVista[] {
  const dir = (x: EjeVista) => {
    const [dx, dy] = [x.hasta[0] - x.desde[0], x.hasta[1] - x.desde[1]];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l] as const;
  };
  const e = ejes.find((x) => x.id === id);
  if (!e) return [];
  const [ux, uy] = dir(e);
  return ejes.filter((x) => {
    const [vx, vy] = dir(x);
    return Math.abs(ux * vy - uy * vx) < 1e-3;
  });
}

/** El eje de antes (−1) o el de después (+1) entre los paralelos a `id`; null en los extremos. */
export function ejeVecino(ejes: readonly EjeVista[], id: string, d: -1 | 1): string | null {
  const f = ejesParalelos(ejes, id);
  return f[f.findIndex((x) => x.id === id) + d]?.id ?? null;
}

/**
 * El eje del alzado (I2), en un desplegable con todos, y dos flechas para el anterior y el
 * siguiente de su dirección (RePág y AvPág con el alzado activo, en `App`), como las plantas.
 */
export function SelectorEje({ ejes, eje, onEje }: { ejes: readonly EjeVista[]; eje: string | null; onEje: (id: string) => void }) {
  const antes = eje ? ejeVecino(ejes, eje, -1) : null;
  const despues = eje ? ejeVecino(ejes, eje, 1) : null;
  const nombre = (x: EjeVista) => `${x.nombre ?? x.id}${x.propuesto ? " (propuesto)" : ""}`;
  return (
    <span className="chip sel planta-sel">
      <span className="planta-sel-campo">
        <span className="text-text-secondary">Eje</span>
        <select className="sel-chip" value={eje ?? ""} onChange={(x) => onEje(x.target.value)} aria-label="Eje del alzado">
          {ejes.map((x) => (
            <option key={x.id} value={x.id}>
              {nombre(x)}
            </option>
          ))}
        </select>
        <ChevronDown size={13} className="sel-flecha" aria-hidden="true" />
      </span>
      <span className="planta-sel-sep" aria-hidden="true" />
      <button type="button" className="ib-chip" disabled={!antes} onClick={() => antes && onEje(antes)} title="Eje anterior de esta dirección (RePág)" aria-label="Eje anterior">
        <ChevronUp size={14} />
      </button>
      <button type="button" className="ib-chip" disabled={!despues} onClick={() => despues && onEje(despues)} title="Eje siguiente de esta dirección (AvPág)" aria-label="Eje siguiente">
        <ChevronDown size={14} />
      </button>
    </span>
  );
}

// ─── Paneles laterales e inferior ───────────────────────────────────────────────────────────────

export interface Lateral {
  titulo: string;
  contenido: ReactNode;
  ancho?: number;
}

/**
 * El ancho de un panel lateral (UI-50): el suyo a 1920 px y menos en una ventana más estrecha, sin
 * bajar de lo que necesita (el navegador, 200 px; las propiedades, 272 px o el 80 % del suyo).
 */
function anchoPanel(izq: boolean, ancho?: number): string {
  const a = ancho ?? (izq ? 248 : 300);
  const min = izq ? Math.min(a, 200) : Math.min(a, Math.max(272, Math.round(a * 0.8)));
  return `clamp(${min}px, ${((a / 1920) * 100).toFixed(2)}vw, ${a}px)`;
}

function PanelLateral({ lado, l, abierto, onAbierto }: { lado: "izq" | "der"; l: Lateral; abierto: boolean; onAbierto: (v: boolean) => void }) {
  const izq = lado === "izq";
  if (!abierto)
    return (
      <aside className={`panel-carril ${izq ? "izq" : "der"}`} aria-label={`${l.titulo} (plegado)`}>
        <button type="button" className="ib" onClick={() => onAbierto(true)} aria-label={`Abrir ${l.titulo.toLowerCase()}`} title={`Abrir ${l.titulo.toLowerCase()}`}>
          {izq ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
        <button type="button" className="panel-carril-tit" onClick={() => onAbierto(true)}>
          {l.titulo}
        </button>
      </aside>
    );
  return (
    <aside aria-label={l.titulo} className={`panel ${izq ? "izq" : "der"}`} style={{ width: anchoPanel(izq, l.ancho) }}>
      <div className="panel-cab">
        <span>{l.titulo}</span>
        <button type="button" className="ib" style={{ width: 24, height: 24 }} onClick={() => onAbierto(false)} aria-label={`Plegar ${l.titulo.toLowerCase()}`} title={`Plegar ${l.titulo.toLowerCase()}`}>
          {izq ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>
      </div>
      <div className="panel-cuerpo scroll-hide">{l.contenido}</div>
    </aside>
  );
}

export interface Pestana {
  id: string;
  titulo: string;
  insignia?: ReactNode;
  /** Lo que se ve con la pestaña abierta. */
  contenido: ReactNode;
}

/** Lo más bajo del panel inferior abierto, px. */
const ALTO_DOCK_MIN = 120;
/** C-20: lo que sube o baja el panel con cada flecha, px. */
const PASO_DOCK = 20;
/** Lo que hay que pasar del umbral para que el panel se maximice al soltarlo (que rozarlo no lo haga), px. */
const MARGEN_MAX = 24;

/**
 * Una altura a medio camino: la mitad del espacio bajo la barra de herramientas, sin pasar del umbral.
 * Para abrir el panel de forma que se vea que está y que se puede subir o plegar.
 */
export function altoMedioDock(altoVentana: number): number {
  return Math.round(Math.min(umbralDock(altoVentana), Math.max(ALTO_DOCK_MIN + 80, (altoVentana - 122) / 2)));
}

/** Lo que se tiene por «minimizado»: tan bajo que casi no se ve lo que hay dentro, px. */
export const ALTO_DOCK_MINIMIZADO = ALTO_DOCK_MIN + 40;

/**
 * El umbral: lo más alto del panel sin maximizar, el que deja a las vistas unos 300 px (lo de encima de
 * ellas, las barras, son ~120). Es el mismo cálculo que el de `.dock` en `index.css`.
 */
export function umbralDock(altoVentana: number): number {
  return Math.max(ALTO_DOCK_MIN, altoVentana - 420);
}

/**
 * El panel inferior. Hasta el umbral (`umbralDock`) encoge las vistas. Al arrastrarlo, sigue al cursor
 * hasta arriba del todo (por encima del umbral, tapando las vistas, con «Suelte para maximizar»); al
 * soltarlo más allá del umbral se queda maximizado (`max`): tapa las vistas y los paneles laterales
 * hasta debajo de la barra de herramientas (`.dock` y `.dock-caja`, en `index.css`). Restaurado,
 * vuelve a la altura de antes, que nunca pasa del umbral.
 */
function Dock({ pestanas, p }: { pestanas: Pestana[]; p: Paneles }) {
  const activa = pestanas.find((x) => x.id === p.pestana) ?? pestanas[0]!;
  /** `base` − la y del cursor = la altura; `ahora`, la que lleva. */
  const arrastre = useRef<{ base: number; ahora: number; movido: boolean } | null>(null);
  const seccion = useRef<HTMLElement>(null);
  const caja = useRef<HTMLDivElement>(null);
  const idCuerpo = useId();
  const abierto = p.dock;
  const maximizado = abierto && p.max;
  /** Lo más alto: todo el espacio bajo la barra de herramientas (el bloque que contiene a las vistas y al panel). */
  const maximo = () => Math.max(ALTO_DOCK_MIN, seccion.current?.parentElement?.clientHeight || window.innerHeight - 180);
  const limitar = (a: number) => Math.round(Math.max(ALTO_DOCK_MIN, Math.min(maximo(), a)));
  const umbral = () => umbralDock(window.innerHeight);
  /** Pasado el umbral: maximizado (con la altura de antes, sin pasar del umbral, para restaurarlo). */
  const pasa = (a: number) => a > umbral() + MARGEN_MAX;
  const restaurado = () => Math.min(p.alto, umbral());
  /** C-38: al soltar, la altura se guarda una vez (durante el arrastre sólo cambia el estilo). */
  const soltar = () => {
    const a = arrastre.current;
    arrastre.current = null;
    const sec = seccion.current;
    if (sec) {
      delete sec.dataset.arrastre;
      delete sec.dataset.pasa;
    }
    if (!a?.movido) return;
    const max = pasa(a.ahora);
    const alto = max ? restaurado() : Math.min(a.ahora, umbral());
    // (el estilo se dejó con la altura del cursor: si la guardada no cambia, React no lo rehace)
    if (sec) {
      sec.style.setProperty("--dock-alto", `${alto}px`);
      sec.dataset.max = String(max);
    }
    p.poner({ alto, max });
  };
  const alternarMax = () => p.poner({ dock: true, max: !maximizado });
  return (
    <section ref={seccion} className="dock" aria-label="Panel inferior" style={abierto ? ({ "--dock-alto": `${p.alto}px` } as CSSProperties) : undefined} data-abierto={abierto} data-max={maximizado}>
      <div ref={caja} className="dock-caja">
        {abierto && (
          <div
            className="dock-asa"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Cambiar la altura del panel inferior"
            title="Arrastre para cambiar la altura; más arriba de lo que dejan las vistas, se maximiza · doble clic: maximizar o restaurar"
            // C-20: con el foco, ↑ y ↓ la cambian de 20 en 20 px (Inicio y Fin, al mínimo y al máximo)
            tabIndex={0}
            aria-valuenow={p.alto}
            aria-valuemin={ALTO_DOCK_MIN}
            aria-valuemax={umbral()}
            aria-valuetext={maximizado ? "maximizado" : `${p.alto} px`}
            onKeyDown={(e) => {
              // ↑ en el umbral, o Fin: maximizado; ↓ maximizado: restaurado, en el umbral
              const u = umbral();
              const desde = maximizado ? u + PASO_DOCK : Math.min(p.alto, u);
              const d = e.key === "ArrowUp" ? PASO_DOCK : e.key === "ArrowDown" ? -PASO_DOCK : null;
              const alto = d !== null ? Math.max(ALTO_DOCK_MIN, desde + d) : e.key === "Home" ? ALTO_DOCK_MIN : e.key === "End" ? Infinity : null;
              if (alto === null) return;
              e.preventDefault();
              if (alto > u) {
                if (!maximizado) p.poner({ alto: restaurado(), max: true });
              } else if (alto !== p.alto || maximizado) p.poner({ alto: Math.round(alto), max: false });
            }}
            onDoubleClick={alternarMax}
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              // (desde lo que mide ahora: maximizado, todo el espacio)
              const alto = limitar(caja.current?.offsetHeight || p.alto);
              arrastre.current = { base: e.clientY + alto, ahora: alto, movido: false };
            }}
            onPointerMove={(e) => {
              const a = arrastre.current;
              if (!a) return;
              const alto = limitar(a.base - e.clientY);
              if (alto === a.ahora) return;
              a.ahora = alto;
              a.movido = true;
              // C-38: sin `poner` (localStorage y repintar el espacio) en cada movimiento: sólo el alto de la
              // sección. Sigue al cursor también más allá del umbral; maximizar es cosa de soltar
              const sec = seccion.current;
              if (!sec) return;
              sec.dataset.max = "false";
              sec.dataset.arrastre = "true";
              if (pasa(alto)) sec.dataset.pasa = "true";
              else delete sec.dataset.pasa;
              sec.style.setProperty("--dock-alto", `${alto}px`);
            }}
            onPointerUp={soltar}
            onPointerCancel={soltar}
            onLostPointerCapture={soltar}
          />
        )}
        <Grupo rol="tablist" etiqueta="Pestañas del panel inferior" className="dock-tabs">
          <button type="button" className="ib" style={{ width: 26, height: 26 }} onClick={() => p.poner({ dock: !abierto })} aria-label={abierto ? "Plegar el panel inferior" : "Abrir el panel inferior"} title={abierto ? "Plegar el panel inferior" : "Abrir el panel inferior"}>
            {abierto ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
          {pestanas.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={abierto && x.id === activa.id}
              aria-controls={abierto && x.id === activa.id ? idCuerpo : undefined}
              data-on={abierto && x.id === activa.id}
              className="dock-tab"
              onClick={() => (abierto && x.id === activa.id ? p.poner({ dock: false }) : p.poner({ dock: true, pestana: x.id }))}
            >
              {x.titulo}
              {x.insignia !== undefined && <span className="insignia">{x.insignia}</span>}
            </button>
          ))}
          <span className="min-w-2 flex-1" />
          <button type="button" className="ib dock-max" style={{ width: 26, height: 26 }} aria-pressed={maximizado} onClick={alternarMax} aria-label={maximizado ? "Restaurar el panel inferior" : "Maximizar el panel inferior"} title={maximizado ? "Restaurar el panel inferior a su altura" : "Maximizar el panel inferior: tapa las vistas"}>
            {maximizado ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </Grupo>
        {abierto && (
          <div id={idCuerpo} className="dock-cuerpo" role="tabpanel" aria-label={activa.titulo}>
            {activa.contenido}
          </div>
        )}
      </div>
    </section>
  );
}

// ─── La disposición ─────────────────────────────────────────────────────────────────────────────

/** La ventana es más estrecha que `px` (y lo sigue al cambiar de tamaño). */
export function useEstrecha(px: number): boolean {
  const consulta = `(max-width: ${px - 0.02}px)`;
  const [si, setSi] = useState(() => typeof matchMedia === "function" && matchMedia(consulta).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const m = matchMedia(consulta);
    const cambio = () => setSi(m.matches);
    cambio();
    m.addEventListener("change", cambio);
    return () => m.removeEventListener("change", cambio);
  }, [consulta]);
  return si;
}

/** Por debajo de este ancho, el navegador y las propiedades no van abiertos a la vez (UI-50). */
const ANCHO_DOS_PANELES = 1440;

export function Disposicion({ paneles, herramientas, nav, vista, props, dock, etiquetaHerramientas }: { paneles: Paneles; herramientas: ReactNode; etiquetaHerramientas: string; nav?: Lateral | null; vista: ReactNode; props?: Lateral | null; dock?: Pestana[] }) {
  // En un portátil, con las propiedades abiertas (algo elegido) el navegador se ve plegado; abrirlo
  // pliega las propiedades. Lo recordado no cambia: al plegar las propiedades vuelve el navegador
  const estrecha = useEstrecha(ANCHO_DOS_PANELES);
  const uno = estrecha && !!props && !!nav;
  const navAbierto = paneles.nav && !(uno && paneles.props);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="herramientas" role="toolbar" aria-label={etiquetaHerramientas}>
        {herramientas}
      </div>
      {/* (el bloque de las vistas y el panel inferior: la caja del panel, al subir más de la cuenta, se coloca respecto a él) */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          {nav && <PanelLateral lado="izq" l={nav} abierto={navAbierto} onAbierto={(v) => paneles.poner(v && uno ? { nav: true, props: false } : { nav: v })} />}
          <section className="vista" aria-label="Vista">
            {vista}
          </section>
          {props && <PanelLateral lado="der" l={props} abierto={paneles.props} onAbierto={(v) => paneles.poner({ props: v })} />}
        </div>
        {dock && dock.length > 0 && <Dock pestanas={dock} p={paneles} />}
      </div>
    </div>
  );
}
