/**
 * La disposición común de los espacios de trabajo (`docs/fem3d/interfaz.md` §3 y §13): barra de
 * herramientas, navegador, vista, propiedades y panel inferior. Cada espacio da el contenido de cada
 * hueco; la disposición sólo los coloca, los pliega y recuerda cómo se dejaron (`paneles.ts`).
 */
import { useRef, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import type { EstadoSesion } from "../../../src/visor/sesion.ts";
import { cota } from "../fmt.ts";
import type { Icono } from "./iconos.tsx";
import type { Paneles } from "./paneles.ts";

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

export function Hueco() {
  return <span className="min-w-3 flex-1" />;
}

/** Elegir uno de varios valores cortos (magnitud, esfuerzo), en monoespaciada. */
export function Segmentado<T extends string>({ opciones, valor, onCambio, etiqueta, deshabilitada }: { opciones: readonly { id: T; nombre: string; title?: string }[]; valor: T; onCambio: (v: T) => void; etiqueta: string; deshabilitada?: (id: T) => boolean }) {
  return (
    <div className="herr-seg" role="group" aria-label={etiqueta}>
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

// ─── Vista: cabecera y carril de plantas ────────────────────────────────────────────────────────

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

/**
 * Las plantas, de arriba abajo, en el borde izquierdo de la vista (§5.1). AvPág y RePág hacen lo
 * mismo (en `App`). Los errores y avisos de cada planta, como en V1.
 */
export function CarrilPlantas({ estado, planta, onPlanta }: { estado: EstadoSesion; planta: string | null; onPlanta: (id: string) => void }) {
  return (
    <div className="carril" role="listbox" aria-label="Plantas">
      {estado.plantas.map((p) => (
        <button key={p.id} type="button" role="option" aria-selected={p.id === planta} data-on={p.id === planta} title={p.nombre ? `${p.id} · ${p.nombre}` : p.id} onClick={() => onPlanta(p.id)}>
          <span>{p.id}</span>
          <span className="mono">{cota(p.cota)}</span>
          {p.errores ? <i className="f" aria-label={`${p.errores} errores`} /> : p.avisos ? <i className="w" aria-label={`${p.avisos} avisos`} /> : null}
        </button>
      ))}
    </div>
  );
}

// ─── Paneles laterales e inferior ───────────────────────────────────────────────────────────────

export interface Lateral {
  titulo: string;
  contenido: ReactNode;
  ancho?: number;
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
    <aside aria-label={l.titulo} className={`panel ${izq ? "izq" : "der"}`} style={{ width: l.ancho ?? (izq ? 248 : 300) }}>
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

function Dock({ pestanas, p }: { pestanas: Pestana[]; p: Paneles }) {
  const activa = pestanas.find((x) => x.id === p.pestana) ?? pestanas[0]!;
  const arrastre = useRef<{ y: number; alto: number } | null>(null);
  const abierto = p.dock;
  return (
    <section className="dock" aria-label="Panel inferior" style={abierto ? { height: p.alto } : undefined} data-abierto={abierto}>
      {abierto && (
        <div
          className="dock-asa"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Cambiar la altura del panel inferior"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            arrastre.current = { y: e.clientY, alto: p.alto };
          }}
          onPointerMove={(e) => {
            const a = arrastre.current;
            if (a) p.poner({ alto: Math.max(120, Math.min(window.innerHeight - 260, a.alto + a.y - e.clientY)) });
          }}
          onPointerUp={() => (arrastre.current = null)}
        />
      )}
      <div className="dock-tabs" role="tablist" aria-label="Pestañas del panel inferior">
        <button type="button" className="ib" style={{ width: 26, height: 26 }} onClick={() => p.poner({ dock: !abierto })} aria-label={abierto ? "Plegar el panel inferior" : "Abrir el panel inferior"} title={abierto ? "Plegar el panel inferior" : "Abrir el panel inferior"}>
          {abierto ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        {pestanas.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={abierto && x.id === activa.id}
            data-on={abierto && x.id === activa.id}
            className="dock-tab"
            onClick={() => (abierto && x.id === activa.id ? p.poner({ dock: false }) : p.poner({ dock: true, pestana: x.id }))}
          >
            {x.titulo}
            {x.insignia !== undefined && <span className="insignia">{x.insignia}</span>}
          </button>
        ))}
      </div>
      {abierto && (
        <div className="dock-cuerpo" role="tabpanel" aria-label={activa.titulo}>
          {activa.contenido}
        </div>
      )}
    </section>
  );
}

// ─── La disposición ─────────────────────────────────────────────────────────────────────────────

export function Disposicion({ paneles, herramientas, nav, vista, props, dock, etiquetaHerramientas }: { paneles: Paneles; herramientas: ReactNode; etiquetaHerramientas: string; nav?: Lateral | null; vista: ReactNode; props?: Lateral | null; dock?: Pestana[] }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="herramientas" role="toolbar" aria-label={etiquetaHerramientas}>
        {herramientas}
      </div>
      <div className="flex min-h-0 flex-1">
        {nav && <PanelLateral lado="izq" l={nav} abierto={paneles.nav} onAbierto={(v) => paneles.poner({ nav: v })} />}
        <section className="vista" aria-label="Vista">
          {vista}
        </section>
        {props && <PanelLateral lado="der" l={props} abierto={paneles.props} onAbierto={(v) => paneles.poner({ props: v })} />}
      </div>
      {dock && dock.length > 0 && <Dock pestanas={dock} p={paneles} />}
    </div>
  );
}
