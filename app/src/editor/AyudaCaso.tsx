/**
 * El panel de la derecha del gestor de casos: qué es la acción del caso, cómo entra en las
 * combinaciones, sus ψ con lo que es cada uno y los campos que pide; y, al pasar por un campo del
 * formulario o escribir en él, qué es ese campo y qué vale cada opción, con la del caso marcada.
 * Los textos, de `explicaciones.ts`; los ψ, de `psiDe` (los mismos que el generador).
 */
import { useCallback, useState, type FocusEvent, type MouseEvent } from "react";
import type { CasoFisico, ModeloFisico } from "../../../src/compilador/fisico.ts";
import { psiDe } from "../../../src/combinaciones/psi.ts";
import type { Objeto } from "../../../src/editor/referencias.ts";
import { DEF_TABLAS, contexto } from "../../../src/editor/tablas.ts";
import { ACCIONES, CAMPOS_CASO } from "./explicaciones.ts";
import "./gestores.css";

const coma = (x: number) => String(x).replace(".", ",");

/** La letra de una acción, con su color. */
export function LetraAccion({ tipo, texto, grande }: { tipo?: string; texto?: string; grande?: boolean }) {
  return (
    <span className={grande ? "acc-letra grande" : "acc-letra"} data-acc={tipo}>
      {texto ?? tipo ?? "—"}
    </span>
  );
}

/**
 * El campo del formulario bajo el ratón o con el foco, por el `data-clave` de su input (la clave de
 * la columna). Se ponen los manejadores en el contenedor del formulario.
 */
export function useCampoActivo() {
  const [foco, setFoco] = useState<string | null>(null);
  const [encima, setEncima] = useState<string | null>(null);
  const clave = (t: EventTarget | null): string | null => {
    const campo = (t as HTMLElement | null)?.closest?.(".campo");
    const clave = campo?.querySelector("[data-clave]")?.getAttribute("data-clave");
    return clave && CAMPOS_CASO[clave] ? clave : null;
  };
  const manejadores = {
    onFocus: useCallback((e: FocusEvent) => setFoco(clave(e.target)), []),
    onBlur: useCallback(() => setFoco(null), []),
    onMouseOver: useCallback((e: MouseEvent) => setEncima(clave(e.target)), []),
    onMouseLeave: useCallback(() => setEncima(null), []),
  };
  return { activo: encima ?? foco, manejadores };
}

export function AyudaCaso({ caso, m, campo }: { caso: CasoFisico; m: ModeloFisico; campo: string | null }) {
  const a = caso.accion;
  const info = a ? ACCIONES[a.tipo] : null;
  const psi = a?.psi === undefined ? null : psiDe(a.psi);
  const fila = DEF_TABLAS.casos.fila(caso as unknown as Objeto, contexto(m));
  const c = campo ? CAMPOS_CASO[campo] : undefined;
  return (
    <div className="ayuda-panel" aria-label="Ayuda del caso">
      {c && (
        <div className="ayuda-campo" role="note" aria-label={`Ayuda de ${c.titulo}`}>
          <b>{c.titulo}</b>
          <p>{c.que}</p>
          {c.opciones && (
            <ul>
              {c.opciones.map(([v, t]) => (
                <li key={v} data-on={(fila[campo!] ?? "") === v}>
                  <span>{v}</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {info ? (
        <div className="ayuda-cab">
          <LetraAccion tipo={a!.tipo} grande />
          <div>
            <b>{info.nombre}</b>
            <p>{info.que}</p>
          </div>
        </div>
      ) : (
        <p className="ayuda-sin">Sin acción: se calcula y se puede consultar, pero no entra en las combinaciones CTE/NCSE. Elija una en «acción».</p>
      )}
      {info && (
        <section>
          <h4>En las combinaciones</h4>
          <p>{info.combinaciones}</p>
        </section>
      )}
      {psi && (
        <section>
          <h4>ψ · tabla 4.2 del DB SE</h4>
          <div className="ayuda-psi">
            {(
              [
                ["ψ0", psi.psi0, "de combinación"],
                ["ψ1", psi.psi1, "frecuente"],
                ["ψ2", psi.psi2, "casi permanente"],
              ] as const
            ).map(([k, v, t]) => (
              <div key={k}>
                <span>{k}</span>
                <b>{coma(v)}</b>
                <small>{t}</small>
              </div>
            ))}
          </div>
        </section>
      )}
      {info && info.campos.length > 0 && (
        <section>
          <h4>Lo que pide esta acción</h4>
          <div className="ayuda-pide">
            {info.campos.map((k) => (
              <span key={k}>{CAMPOS_CASO[k]?.titulo ?? k}</span>
            ))}
          </div>
        </section>
      )}
      {!c && <p className="text-text-tertiary">Pase el ratón por un campo para ver qué es y qué vale cada opción.</p>}
    </div>
  );
}
