/** Piezas comunes de los paneles: secciones, filas, combinaciones, diagnósticos y equilibrio. */
import { useState, type ComponentType, type ReactNode } from "react";
import type { Diagnostico } from "../../../src/motor/diagnosticos.ts";
import type { CombinacionDisponible, EleccionCombinaciones, EstadoSesion, PropositoVista } from "../../../src/visor/sesion.ts";
import type { Combinaciones } from "../../../src/visor/datos.ts";
import { Campo } from "../armazon/Disposicion.tsx";
import { useVisor } from "../contexto.ts";
import { fmt, textoApp, coma } from "../fmt.ts";

/**
 * Cabecera de un panel de Propiedades: el icono de lo que es, qué es (en pequeño), cuál (el título),
 * una línea de detalle si hace falta y sus acciones a la derecha. La misma en el inspector, la
 * plantilla de dibujo y los modos de Resultados.
 */
export function Cabecera({ icono: I, tipo, titulo, mono, detalle, children }: { icono?: ComponentType<{ size?: number }>; tipo: ReactNode; titulo: ReactNode; mono?: boolean; detalle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="insp-cab">
      {I && (
        <span className="cab-icono">
          <I size={18} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="insp-tipo">{tipo}</div>
        <div className={`insp-id truncate${mono ? " mono" : ""}`}>{titulo}</div>
        {detalle && <div className="cab-detalle">{detalle}</div>}
      </div>
      {children}
    </div>
  );
}

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

/** Qué hacer para tener combinaciones: dar la acción de cada caso. */
const AYUDA_ACCION = "Dé la acción de cada caso (tipo, ψ, familia, dirección) en Cargas › Casos: las combinaciones salen solas.";

/** Valor del selector de combinaciones, en texto. */
const codificar = (e: EleccionCombinaciones) => JSON.stringify(e);

/** «Por defecto» con lo que es (UI-12): «Por defecto (ELU-PT, 8)»; sin resultados, sólo «Por defecto». */
export function textoPorDefecto(d: { descripcion: string; n: number } | undefined): string {
  if (!d) return "Por defecto";
  if (d.descripcion === "casos") return `Por defecto (cada caso, ${d.n})`;
  return d.n > 1 ? `Por defecto (${d.descripcion}, ${d.n})` : `Por defecto (${d.descripcion})`;
}

/**
 * Selector de combinaciones, en la barra de herramientas de Resultados: las de por defecto (las de
 * A1/A4 para el propósito de la vista, con lo que son: UI-12), la envolvente de una situación, una
 * combinación suelta o un caso. Todas las opciones a la vista en un solo desplegable.
 */
export function ComboCombinaciones({ estado, valor, onCambio, proposito, soloUna }: { estado: EstadoSesion; valor: EleccionCombinaciones; onCambio: (e: EleccionCombinaciones) => void; proposito: PropositoVista; soloUna?: boolean }) {
  const porSituacion = new Map<string, CombinacionDisponible[]>();
  const sin = estado.sinCombinaciones;
  for (const c of estado.combinaciones) porSituacion.set(c.situacion, [...(porSituacion.get(c.situacion) ?? []), c]);
  const defecto = estado.defectos?.[proposito];
  return (
    <Campo etiqueta={`Combinaciones · ${proposito}`} ancho={280}>
      <select className="sel w-full" aria-label={`Combinaciones · ${proposito}`} value={codificar(valor)} title={sin ? `Sin combinaciones CTE/NCSE. ${sin.mensaje}${sin.sinAccion.length ? ` ${AYUDA_ACCION}` : ""}` : undefined} onChange={(e) => onCambio(JSON.parse(e.target.value) as EleccionCombinaciones)}>
        {!soloUna && <option value={codificar({ tipo: "defecto" })}>{textoPorDefecto(defecto)}</option>}
        {sin && (
          <optgroup label="Sin combinaciones CTE/NCSE">
            <option disabled value="">
              {sin.sinAccion.length ? `Casos sin acción: ${sin.sinAccion.join(", ")} (Cargas › Casos)` : sin.mensaje}
            </option>
          </optgroup>
        )}
        {!soloUna && porSituacion.size > 0 && (
          <optgroup label="Envolvente de una situación">
            {[...porSituacion].map(([s, cs]) => (
              <option key={s} value={codificar({ tipo: "situaciones", situaciones: [s as never] })}>
                {`${s} (${cs.length})`}
              </option>
            ))}
          </optgroup>
        )}
        {[...porSituacion].map(([s, cs]) => (
          <optgroup key={s} label={`Una combinación ${s}`}>
            {cs.map((c) => (
              <option key={c.nombre} value={codificar({ tipo: "combinacion", situaciones: [c.situacion], nombre: c.nombre })}>
                {c.nombre} · {coma(c.etiqueta)}
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
    </Campo>
  );
}

/** El título de la pestaña del panel inferior con las combinaciones de lo que se ve (UI-12: cambian con el modo). */
export const TITULO_COMBINACIONES = "Combinaciones de esta vista";

/** Las combinaciones que entran en lo que se ve, con su expresión (en el panel inferior). */
export function TablaCombinaciones({ c, resaltar }: { c: Combinaciones; resaltar?: string | null }) {
  return (
    <Seccion titulo={TITULO_COMBINACIONES} valor={`${c.nombres.length} · ${c.descripcion}`}>
      <div>
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
                  {coma(c.etiquetas[i]!)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Seccion>
  );
}

/** Diagnósticos del mismo código y severidad, juntos: los de una sola acción salían uno por uno. */
interface GrupoDiagnosticos {
  d: Diagnostico;
  todos: Diagnostico[];
  ids: string[];
  /** Un aviso sobre los mismos objetos que un error: lo más probable es que sea su causa. */
  causa: boolean;
}

const RANGO = { error: 0, aviso: 1, info: 2 } as const;

/**
 * El orden de la lista (UI-38): primero los avisos que tocan a los objetos de un error (el «¿está
 * en cm?» de una sección de 30 m explica el error de topología que viene después), luego los
 * errores, los avisos y la información; los del mismo código, en un solo grupo.
 */
export function agruparDiagnosticos(ds: readonly Diagnostico[]): GrupoDiagnosticos[] {
  const grupos = new Map<string, GrupoDiagnosticos>();
  for (const d of ds) {
    const k = `${d.severidad}|${d.codigo}`;
    const g = grupos.get(k);
    if (g) {
      g.todos.push(d);
      for (const id of d.ids ?? []) if (!g.ids.includes(id)) g.ids.push(id);
    } else grupos.set(k, { d, todos: [d], ids: [...(d.ids ?? [])], causa: false });
  }
  const conError = new Set(ds.filter((d) => d.severidad === "error").flatMap((d) => d.ids ?? []));
  const lista = [...grupos.values()];
  for (const g of lista) g.causa = g.d.severidad === "aviso" && g.ids.some((id) => conError.has(id));
  return lista.sort((a, b) => Number(b.causa) - Number(a.causa) || RANGO[a.d.severidad] - RANGO[b.d.severidad]);
}

export function ListaDiagnosticos({ ds, onObjeto, max = 200 }: { ds: readonly Diagnostico[]; onObjeto?: (id: string) => void; max?: number }) {
  const [abiertos, setAbiertos] = useState<ReadonlySet<string>>(() => new Set());
  if (!ds.length) return <p className="nota">Sin errores ni avisos.</p>;
  const grupos = agruparDiagnosticos(ds);
  return (
    <ul className="m-0 list-none p-0">
      {grupos.slice(0, max).map((g) => {
        const k = `${g.d.severidad}|${g.d.codigo}`;
        const n = g.todos.length;
        const abierto = abiertos.has(k);
        const sev = g.d.severidad;
        return (
          <li key={k} className="border-b border-border-sub px-3.5 py-1.5 text-[12px]" data-severidad={sev}>
            <div className="flex items-center gap-2">
              <span className={`pill ${sev === "error" ? "fail" : sev === "aviso" ? "warn" : "neu"}`} style={{ height: 18, fontSize: 10 }}>
                {sev === "error" ? "ERROR" : sev === "aviso" ? "AVISO" : "INFO"}
              </span>
              {g.causa && <span className="text-[11px] font-medium text-state-warn">Posible causa de un error</span>}
              {n > 1 && <span className="text-[11px] text-text-secondary">{n} iguales</span>}
              <span className="mono ml-auto truncate text-[11px] text-text-tertiary" title="El código del diagnóstico">
                {g.d.codigo}
              </span>
            </div>
            <p className="mt-1 text-text-secondary">{textoApp(g.d.mensaje)}</p>
            {n > 1 && (
              <>
                <button type="button" className="enlace text-[11.5px]" aria-expanded={abierto} onClick={() => setAbiertos((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])))}>
                  {abierto ? "Ocultar los demás" : `Ver los otros ${n - 1}`}
                </button>
                {abierto &&
                  g.todos.slice(1).map((d, i) => (
                    <p key={i} className="mt-1 border-l-2 border-border-sub pl-2 text-text-secondary">
                      {textoApp(d.mensaje)}
                    </p>
                  ))}
              </>
            )}
            {g.ids.length > 0 && onObjeto && (
              <div className="mt-1 flex flex-wrap gap-1">
                {g.ids.slice(0, 12).map((id) => (
                  <button key={id} type="button" className="btn" style={{ height: 22, padding: "0 6px", fontSize: 11 }} onClick={() => onObjeto(id)}>
                    {id}
                  </button>
                ))}
                {g.ids.length > 12 && <span className="self-center text-[11px] text-text-tertiary">y {g.ids.length - 12} más</span>}
              </div>
            )}
          </li>
        );
      })}
      {grupos.length > max && <li className="nota">… y {grupos.length - max} más.</li>}
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

/**
 * Lo que se ve ya no es del proyecto (C-27; decía «El fichero cambió» también tras una edición): por
 * qué, según lo que pasa. `que`: lo que se ve («estos resultados», «este informe»); `abriendo`: lo
 * que se dibuja es el modelo, que ya llega.
 */
export function AvisoDesactualizado({ que = "estos resultados", abriendo = false }: { que?: string; abriendo?: boolean }) {
  const { proyecto } = useVisor();
  const editado = !!proyecto.edicion?.pendiente || (!!proyecto.edicion && proyecto.fase !== "calculando" && proyecto.fase !== "abriendo");
  const plural = /^estos|^estas/.test(que);
  const texto = abriendo
    ? editado
      ? "Leyendo lo editado…"
      : "El proyecto cambió fuera de aquí: abriendo la versión nueva…"
    : proyecto.fase === "calculando"
      ? `Calculando: ${que} ${plural ? "son" : "es"} de la versión anterior.`
      : editado
        ? `Lo editado cambia el cálculo: ${que} ${plural ? "son" : "es"} de la versión anterior.`
        : `El proyecto cambió fuera de aquí: ${que} ya no ${plural ? "son" : "es"} del proyecto.`;
  return <Aviso tono="warn">{texto}</Aviso>;
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
