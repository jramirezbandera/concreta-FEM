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
        {actual && (actual.errores ? <i className="f" aria-label={`${actual.errores} error${actual.errores === 1 ? "" : "es"}`} /> : actual.avisos ? <i className="w" aria-label={`${actual.avisos} aviso${actual.avisos === 1 ? "" : "s"}`} /> : null)}
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
