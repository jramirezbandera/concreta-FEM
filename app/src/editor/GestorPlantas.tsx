/**
 * El gestor de plantas (GE3, `docs/fem3d/gestores.md` §3.5), como la introducción de plantas de
 * CYPECAD: la lista de arriba abajo con su cota, y «Añadir» n plantas de altura h encima o debajo de
 * una, viendo antes cómo quedan las cotas. La ficha de una planta es su formulario (el del inspector).
 *
 * Las alturas y el orden salen de `src/editor/plantas.ts`; aquí sólo se pinta.
 */
import { useState } from "react";
import { Table2 } from "lucide-react";
import type { TipoPlanta } from "../../../src/compilador/fisico.ts";
import { cotasPlantas } from "../../../src/compilador/cotas.ts";
import { textoUsos, usosDe } from "../../../src/editor/gestores.ts";
import type { Operacion } from "../../../src/editor/operaciones.ts";
import { insertarPlantas, MAX_PLANTAS_NUEVAS } from "../../../src/editor/plantas.ts";
import { useVisor } from "../contexto.ts";
import { cota } from "../fmt.ts";
import { Dialogo, DialogoBorrar } from "./Dialogos.tsx";
import { FormularioObjeto } from "./Formulario.tsx";
import { Lista } from "./Gestores.tsx";
import { cerrarGestor, type PedidoGestor } from "./referencia.tsx";

const leer = (t: string): number => (t.trim() === "" ? NaN : Number(t.trim().replace(",", ".")));
const TIPOS: readonly [TipoPlanta | "", string][] = [
  ["", "planta"],
  ["sotano", "sótano"],
  ["cubierta", "cubierta"],
];

export function GestorPlantas({ pedido }: { pedido: PedidoGestor }) {
  const { proyecto, pedirTabla } = useVisor();
  const ed = proyecto.edicion!;
  const m = ed.proyecto.modelo;
  const plantas = m.plantas;
  const cotas = cotasPlantas(plantas);
  // Por su posición: renombrarla en la ficha no la suelta
  const [elegida, setElegida] = useState<number>(pedido.nueva ? -1 : Math.max(0, plantas.findIndex((p) => p.id === pedido.id)));
  const actual = elegida >= 0 ? plantas[elegida] : undefined;
  const [de, setDe] = useState(pedido.planta && plantas.some((p) => p.id === pedido.planta) ? pedido.planta : (actual?.id ?? plantas[0]?.id ?? ""));
  const [donde, setDonde] = useState<"encima" | "debajo">("encima");
  const [n, setN] = useState("1");
  const [altura, setAltura] = useState("3");
  const [prefijo, setPrefijo] = useState("N");
  const [tipo, setTipo] = useState<TipoPlanta | "">("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [borrar, setBorrar] = useState<string | null>(null);

  const deValida = plantas.some((p) => p.id === de) ? de : (plantas[0]?.id ?? "");
  const r = insertarPlantas(m, { n: leer(n), altura: leer(altura), donde, de: deValida, prefijo, ...(tipo ? { tipo } : {}) });
  const nuevas = new Set(r.ok ? r.ids : []);
  const cotasR = r.ok ? cotasPlantas(r.plantas) : [];

  /** Aplica unas operaciones (si hay) y, desde un campo, elige `id`; devuelve si se hizo. */
  const terminar = (id: string, ops: readonly Operacion[], etiqueta: string): boolean => {
    if (pedido.alElegir) {
      const e = pedido.alElegir(id, ops);
      if (e) {
        setError(e);
        return false;
      }
      cerrarGestor();
      return true;
    }
    for (const o of ops) {
      const x = ed.editar(o, etiqueta);
      if (!x.ok) {
        setError(x.errores.map((e) => e.mensaje).join(" "));
        return false;
      }
    }
    return true;
  };

  const anadir = () => {
    if (!r.ok) return setError(r.mensaje);
    const texto = `${r.ids.length > 1 ? `Plantas ${r.ids.join(", ")}` : `Planta ${r.ids[0]}`} ${donde} de ${deValida}`;
    if (!terminar(r.ids[0]!, [r.operacion], texto)) return;
    setError(null);
    setAviso(`${texto}.`);
    setElegida(r.plantas.findIndex((p) => p.id === r.ids[0]));
  };

  const usos = actual ? usosDe(m, actual.id) : [];

  return (
    <>
      <Dialogo
        titulo="Plantas"
        clase="gestor"
        onCerrar={cerrarGestor}
        pie={
          <>
            <button type="button" className="btn btn-q mr-auto" onClick={() => (cerrarGestor(), pedirTabla("plantas"))} title="Para cambiar muchas a la vez o pegar de Excel">
              <Table2 size={14} />
              Abrir la tabla
            </button>
            {actual && (
              <button type="button" className="btn" onClick={() => setBorrar(actual.id)}>
                Borrar {actual.id}
              </button>
            )}
            {actual && pedido.alElegir && (
              <button type="button" className="btn" onClick={() => terminar(actual.id, [], "")}>
                Usar {actual.id}
              </button>
            )}
            <button type="button" className="btn btn-p" disabled={!r.ok} onClick={anadir}>
              {pedido.alElegir ? "Añadir y usar" : "Añadir"}
            </button>
          </>
        }
      >
        <Lista
          titulo="plantas"
          nuevaTexto="Añadir plantas"
          nueva={!actual}
          onNueva={() => (setAviso(null), setElegida(-1))}
          elementos={plantas.map((p, i) => ({ id: p.id, texto: p.nombre ?? (p.tipo && p.tipo !== "planta" ? p.tipo : ""), detalle: `cota ${cota(cotas[i] ?? null)} m`, n: usosDe(m, p.id).reduce((t, u) => t + u.n, 0) }))}
          elegida={actual?.id ?? null}
          onElegir={(id) => {
            setAviso(null);
            setError(null);
            setElegida(plantas.findIndex((p) => p.id === id));
            setDe(id);
          }}
        />
        <div
          className="ges-ficha"
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.closest("[data-anadir]")) anadir();
          }}
        >
          {pedido.para && <p className="ges-para">Para {pedido.para}</p>}
          {aviso && (
            <p className="ges-aviso" role="status">
              {aviso}
            </p>
          )}
          <div className="ges-cuerpo">
            <div className="ges-datos" data-anadir>
              <p className="dlg-et" style={{ marginTop: 0 }}>
                Añadir plantas
              </p>
              <label className="campo">
                <span>cuántas</span>
                <input value={n} inputMode="numeric" aria-label="Número de plantas nuevas" data-error={!r.ok && !(leer(n) >= 1)} onChange={(e) => setN(e.target.value)} />
                <p>{`De 1 a ${MAX_PLANTAS_NUEVAS}.`}</p>
              </label>
              <label className="campo">
                <span>
                  altura<small>m</small>
                </span>
                <input value={altura} inputMode="decimal" aria-label="Altura de las plantas nuevas, m" data-error={!r.ok && !(leer(altura) > 0)} onChange={(e) => setAltura(e.target.value)} />
                <p>De forjado a forjado.</p>
              </label>
              <div className="campo">
                <span>dónde</span>
                <div className="flex min-w-0 gap-1">
                  <div className="seg" role="radiogroup" aria-label="Encima o debajo">
                    {(["encima", "debajo"] as const).map((d) => (
                      <button key={d} type="button" role="radio" aria-checked={donde === d} data-on={donde === d} onClick={() => setDonde(d)}>
                        {d === "encima" ? "Encima de" : "Debajo de"}
                      </button>
                    ))}
                  </div>
                  <select className="sel min-w-0 flex-1" value={deValida} aria-label="Planta de referencia" onChange={(e) => setDe(e.target.value)}>
                    {plantas.map((p, i) => (
                      <option key={p.id} value={p.id}>
                        {`${p.id} · ${cota(cotas[i] ?? null)}`}
                      </option>
                    ))}
                  </select>
                </div>
                <p>{donde === "encima" ? "Lo que hay encima sube." : "Ésta y lo que hay encima suben."}</p>
              </div>
              <label className="campo">
                <span>ids</span>
                <input value={prefijo} aria-label="Prefijo de los ids" onChange={(e) => setPrefijo(e.target.value)} />
                <p>{r.ok ? `Serán ${r.ids.join(", ")}.` : "El prefijo y los siguientes números libres."}</p>
              </label>
              <label className="campo">
                <span>tipo</span>
                <select className="sel" value={tipo} aria-label="Tipo de las plantas nuevas" onChange={(e) => setTipo(e.target.value as TipoPlanta | "")}>
                  {TIPOS.map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
                <p>Un sótano sólo cambia el origen de las cotas.</p>
              </label>
            </div>
            <div className="ges-ver">
              <table className="tb" aria-label="Cómo quedan las plantas">
                <thead>
                  <tr>
                    <th>Planta</th>
                    <th>altura</th>
                    <th>cota</th>
                  </tr>
                </thead>
                <tbody>
                  {(r.ok ? r.plantas : plantas).map((p, i) => (
                    <tr key={p.id} data-nueva={nuevas.has(p.id) || undefined} style={nuevas.has(p.id) ? { fontWeight: 600, color: "var(--color-accent)" } : undefined}>
                      <td className="mono">
                        {p.id}
                        {nuevas.has(p.id) && " · nueva"}
                      </td>
                      <td className="mono">{p.altura === null ? "—" : cota(p.altura)}</td>
                      <td className="mono">{cota((r.ok ? cotasR : cotas)[i] ?? null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="ges-usos">{r.ok ? "Así quedan, de arriba abajo. La altura es la que hay hasta la de encima." : r.mensaje}</p>
            </div>
          </div>
          {actual && (
            <>
              <FormularioObjeto id={actual.id} tabla="plantas" />
              <p className="ges-usos">{usos.length ? `La usan ${textoUsos(usos)}.` : "No la usa ningún objeto."}</p>
            </>
          )}
          {error && (
            <p className="ges-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Dialogo>
      {borrar && (
        <DialogoBorrar
          ids={[borrar]}
          onCerrar={(hecho) => {
            setBorrar(null);
            if (!hecho) return;
            setAviso(hecho);
            setElegida(-1);
            setDe(plantas.find((p) => p.id !== borrar)?.id ?? "");
          }}
        />
      )}
    </>
  );
}
