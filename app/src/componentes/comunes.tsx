/** Piezas comunes de los paneles: secciones, filas, lista de plantas, combinaciones y diagnósticos. */
import type { ReactNode } from "react";
import type { Diagnostico } from "../../../src/motor/diagnosticos.ts";
import type { CombinacionDisponible, EleccionCombinaciones, EstadoSesion } from "../../../src/visor/sesion.ts";
import type { Combinaciones } from "../../../src/visor/datos.ts";
import { cota, fmt } from "../fmt.ts";

export function Seccion({ titulo, valor, children }: { titulo: string; valor?: ReactNode; children?: ReactNode }) {
  return (
    <section>
      <h2 className="sec">
        <span>{titulo}</span>
        {valor !== undefined && <span>{valor}</span>}
      </h2>
      {children}
    </section>
  );
}

export function Fila({ k, v, clase }: { k: ReactNode; v: ReactNode; clase?: string }) {
  return (
    <div className="fila">
      <span>{k}</span>
      <span className={`v ${clase ?? ""}`}>{v}</span>
    </div>
  );
}

/** Panel lateral de anchura fija con su propio scroll (prototipos: 288 a la izquierda, 320 a la derecha). */
export function Panel({ lado, ancho, children, etiqueta }: { lado: "izq" | "der"; ancho?: number; children: ReactNode; etiqueta: string }) {
  const w = ancho ?? (lado === "izq" ? 288 : 340);
  return (
    <aside aria-label={etiqueta} className={`scroll-hide flex shrink-0 flex-col overflow-y-auto bg-bg-surface pb-6 ${lado === "izq" ? "border-r" : "border-l"} border-border-main`} style={{ width: w }}>
      {children}
    </aside>
  );
}

/** Barra de 36 px sobre el lienzo, con el contexto de lo que se ve. */
export function BarraLienzo({ children, derecha }: { children: ReactNode; derecha?: ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border-main bg-bg-surface px-3">
      <div className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-secondary">{children}</div>
      {derecha}
    </div>
  );
}

export function ListaPlantas({ estado, planta, onPlanta, extra }: { estado: EstadoSesion; planta: string | null; onPlanta: (id: string) => void; extra?: (id: string) => ReactNode }) {
  return (
    <Seccion titulo="Plantas" valor={estado.plantas.length}>
      <div role="listbox" aria-label="Plantas">
        {estado.plantas.map((p) => (
          <button key={p.id} type="button" role="option" aria-selected={p.id === planta} data-on={p.id === planta} className="lista-fila" style={{ gridTemplateColumns: "minmax(36px,auto) 1fr auto auto" }} onClick={() => onPlanta(p.id)}>
            <span className="font-medium text-text-primary">{p.id}</span>
            <span className="truncate text-[11px]">{p.nombre ?? ""}</span>
            <span className="mono text-[12px]">{cota(p.cota)}</span>
            <span className="mono min-w-[24px] text-right text-[11px]">{extra ? extra(p.id) : p.errores ? <span className="text-state-fail">{p.errores}!</span> : p.avisos ? <span className="text-state-warn">{p.avisos}</span> : ""}</span>
          </button>
        ))}
      </div>
    </Seccion>
  );
}

/** Valor del selector de combinaciones, en texto. */
const codificar = (e: EleccionCombinaciones) => JSON.stringify(e);

/**
 * Selector de combinaciones: las de por defecto (las de A1/A4 para la vista), la envolvente de una
 * situación, una combinación suelta o un caso. Todas las opciones a la vista en un solo desplegable.
 */
export function SelectorCombinaciones({ estado, valor, onCambio, etiqueta, soloUna }: { estado: EstadoSesion; valor: EleccionCombinaciones; onCambio: (e: EleccionCombinaciones) => void; etiqueta: string; soloUna?: boolean }) {
  const porSituacion = new Map<string, CombinacionDisponible[]>();
  for (const c of estado.combinaciones) porSituacion.set(c.situacion, [...(porSituacion.get(c.situacion) ?? []), c]);
  return (
    <label className="flex flex-col gap-1 px-3.5 py-2">
      <span className="text-[11px] text-text-secondary">{etiqueta}</span>
      <select className="sel w-full" value={codificar(valor)} onChange={(e) => onCambio(JSON.parse(e.target.value) as EleccionCombinaciones)}>
        {!soloUna && <option value={codificar({ tipo: "defecto" })}>Por defecto</option>}
        {!soloUna && porSituacion.size > 0 && (
          <optgroup label="Envolvente de una situación">
            {[...porSituacion].map(([s, cs]) => (
              <option key={s} value={codificar({ tipo: "situaciones", situaciones: [s as never] })}>
                {s} ({cs.length})
              </option>
            ))}
          </optgroup>
        )}
        {[...porSituacion].map(([s, cs]) => (
          <optgroup key={s} label={`Una combinación ${s}`}>
            {cs.map((c) => (
              <option key={c.nombre} value={codificar({ tipo: "combinacion", situaciones: [c.situacion], nombre: c.nombre })}>
                {c.nombre} · {c.etiqueta}
              </option>
            ))}
          </optgroup>
        ))}
        <optgroup label="Un caso">
          {estado.casos.map((c) => (
            <option key={c.id} value={codificar({ tipo: "caso", caso: c.id })}>
              {c.id}
              {c.nombre ? ` · ${c.nombre}` : ""}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}

/** Las combinaciones que entran en lo que se ve, con su expresión. */
export function TablaCombinaciones({ c, resaltar }: { c: Combinaciones; resaltar?: string | null }) {
  return (
    <Seccion titulo="Combinaciones" valor={`${c.nombres.length} · ${c.descripcion}`}>
      <div className="max-h-[220px] overflow-y-auto scroll-hide">
        <table className="tb">
          <thead>
            <tr>
              <th>Nombre</th>
              <th style={{ textAlign: "left" }}>Expresión</th>
            </tr>
          </thead>
          <tbody>
            {c.nombres.map((n, i) => (
              <tr key={n} className={n === resaltar ? "max" : undefined}>
                <td>{n}</td>
                <td className="txt" style={{ textAlign: "left" }}>
                  {c.etiquetas[i]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Seccion>
  );
}

export function ListaDiagnosticos({ ds, onObjeto, max = 200 }: { ds: readonly Diagnostico[]; onObjeto?: (id: string) => void; max?: number }) {
  if (!ds.length) return <p className="nota">Sin errores ni avisos.</p>;
  return (
    <ul className="m-0 list-none p-0">
      {ds.slice(0, max).map((d, i) => (
        <li key={i} className="border-b border-border-sub px-3.5 py-1.5 text-[12px]">
          <div className="flex items-center gap-2">
            <span className={`pill ${d.severidad === "error" ? "fail" : "warn"}`} style={{ height: 18, fontSize: 10 }}>
              {d.severidad === "error" ? "ERROR" : "AVISO"}
            </span>
            <span className="mono truncate text-[11px] text-text-disabled">{d.codigo}</span>
          </div>
          <p className="mt-1 text-text-secondary">{d.mensaje}</p>
          {d.ids && d.ids.length > 0 && onObjeto && (
            <div className="mt-1 flex flex-wrap gap-1">
              {d.ids.slice(0, 8).map((id) => (
                <button key={id} type="button" className="btn" style={{ height: 22, padding: "0 6px", fontSize: 11 }} onClick={() => onObjeto(id)}>
                  {id}
                </button>
              ))}
            </div>
          )}
        </li>
      ))}
      {ds.length > max && <li className="nota">… y {ds.length - max} más.</li>}
    </ul>
  );
}

/** Mensaje en el centro del lienzo (cargando, sin resultados, error). */
export function Aviso({ children, tono = "neu" }: { children: ReactNode; tono?: "neu" | "warn" | "fail" }) {
  return (
    <div className={`pill ${tono}`} style={{ height: "auto", padding: "8px 12px", fontSize: 12, maxWidth: 420, whiteSpace: "normal", lineHeight: 1.4 }}>
      {children}
    </div>
  );
}

export function Equilibrio({ estado }: { estado: EstadoSesion }) {
  if (!estado.equilibrio.length) return null;
  return (
    <Seccion titulo="Equilibrio por caso" valor="límite 1e-9">
      <table className="tb">
        <thead>
          <tr>
            <th>Caso</th>
            <th>ΣF rel.</th>
            <th>ΣM rel.</th>
          </tr>
        </thead>
        <tbody>
          {estado.equilibrio.map((e) => (
            <tr key={e.id}>
              <td>{e.id}</td>
              <td className={e.fuerzas > 1e-9 ? "f" : undefined}>{e.fuerzas.toExponential(1).replace(".", ",")}</td>
              <td className={e.momentos > 1e-9 ? "f" : undefined}>{e.momentos.toExponential(1).replace(".", ",")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Seccion>
  );
}

export { fmt };
