/**
 * El gestor de plantas (GE3, `docs/fem3d/gestores.md` §3.5), como la introducción de plantas de
 * CYPECAD. A la izquierda, el alzado esquemático del edificio de arriba abajo, con su cota y la
 * altura entre plantas, y en azul lo que se va a añadir antes de añadirlo; un clic elige una planta.
 * A la derecha, o se añaden plantas (n de altura h encima o debajo de la elegida) o se ven los datos
 * de la elegida (su formulario, el del inspector).
 *
 * Con un proyecto que empieza (`pedido.inicio`, al crearlo, con su planta sobre la cimentación), lo
 * primero es cuántas plantas tiene y de qué altura (`plantasEdificio`): sin plantas no se dibuja nada.
 *
 * Las alturas y el orden salen de `src/editor/plantas.ts`; aquí sólo se pinta.
 */
import { useState, type CSSProperties } from "react";
import { Table2 } from "lucide-react";
import type { Planta, TipoPlanta } from "../../../src/compilador/fisico.ts";
import { cotasPlantas } from "../../../src/compilador/cotas.ts";
import { textoUsos, usosDe } from "../../../src/editor/gestores.ts";
import type { Operacion } from "../../../src/editor/operaciones.ts";
import { insertarPlantas, MAX_PLANTAS_NUEVAS, plantasEdificio } from "../../../src/editor/plantas.ts";
import { useVisor } from "../contexto.ts";
import { cota, fmt } from "../fmt.ts";
import { Dialogo, DialogoBorrar } from "./Dialogos.tsx";
import { FormularioObjeto } from "./Formulario.tsx";
import { cerrarGestor, type PedidoGestor } from "./referencia.tsx";

const leer = (t: string): number => (t.trim() === "" ? NaN : Number(t.trim().replace(",", ".")));
const TIPOS: readonly [TipoPlanta | "", string][] = [
  ["", "planta"],
  ["sotano", "sótano"],
  ["cubierta", "cubierta"],
];

type Modo = "inicio" | "anadir" | "datos";

export function GestorPlantas({ pedido }: { pedido: PedidoGestor }) {
  const { proyecto, pedirTabla } = useVisor();
  const ed = proyecto.edicion!;
  const m = ed.proyecto.modelo;
  const plantas = m.plantas;
  const cotas = cotasPlantas(plantas);
  // Por su posición: renombrarla en la ficha no la suelta
  const [elegida, setElegida] = useState<number>(Math.max(0, plantas.findIndex((p) => p.id === (pedido.id ?? pedido.planta))));
  const actual = plantas[elegida] ?? plantas[0];
  const [modo, setModo] = useState<Modo>(pedido.inicio && plantas.length === 2 ? "inicio" : pedido.id && !pedido.nueva ? "datos" : "anadir");
  const [donde, setDonde] = useState<"encima" | "debajo">("encima");
  const [n, setN] = useState(pedido.inicio ? "3" : "1");
  const [altura, setAltura] = useState("3");
  const [alturaBaja, setAlturaBaja] = useState(String(plantas[1]?.altura ?? 3).replace(".", ","));
  const [prefijo, setPrefijo] = useState("N");
  const [tipo, setTipo] = useState<TipoPlanta | "">("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [borrar, setBorrar] = useState<string | null>(null);

  const de = actual?.id ?? "";
  const r =
    modo === "inicio"
      ? plantasEdificio(m, { n: leer(n), alturaBaja: leer(alturaBaja), altura: leer(altura), prefijo })
      : insertarPlantas(m, { n: leer(n), altura: leer(altura), donde, de, prefijo, ...(tipo ? { tipo } : {}) });
  const nuevas = new Set(r.ok && modo !== "datos" ? r.ids : []);
  const vista = r.ok && modo !== "datos" ? r.plantas : plantas;

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
    const texto =
      modo === "inicio"
        ? `${r.plantas.length - 1} plantas sobre ${r.plantas[r.plantas.length - 1]!.id}`
        : `${r.ids.length > 1 ? `Plantas ${r.ids.join(", ")}` : `Planta ${r.ids[0]}`} ${donde} de ${de}`;
    if (!terminar(r.ids[0] ?? de, [r.operacion], texto)) return;
    setError(null);
    setAviso(`${texto}.`);
    if (modo === "inicio") {
      setModo("anadir");
      setN("1");
      setElegida(0);
    } else setElegida(r.plantas.findIndex((p) => p.id === r.ids[0]));
  };

  const elegir = (id: string) => {
    const i = plantas.findIndex((p) => p.id === id);
    if (i < 0) return;
    setAviso(null);
    setError(null);
    setElegida(i);
    if (modo === "inicio") setModo("anadir");
  };

  const usos = actual ? usosDe(m, actual.id) : [];
  const enCurso = modo !== "datos";

  return (
    <>
      <Dialogo
        titulo="Plantas"
        clase="gestor gestor-plantas"
        onCerrar={cerrarGestor}
        pie={
          <>
            <button type="button" className="btn btn-q mr-auto" onClick={() => (cerrarGestor(), pedirTabla("plantas"))} title="Para cambiar muchas a la vez o pegar de Excel">
              <Table2 size={14} />
              Abrir la tabla
            </button>
            {modo === "datos" && actual && (
              <button type="button" className="btn" onClick={() => setBorrar(actual.id)}>
                Borrar {actual.id}
              </button>
            )}
            {actual && pedido.alElegir && (
              <button type="button" className="btn" onClick={() => terminar(actual.id, [], "")}>
                Usar {actual.id}
              </button>
            )}
            {modo === "inicio" && (
              <button type="button" className="btn btn-p" disabled={!r.ok} onClick={anadir}>
                Crear las plantas
              </button>
            )}
            {modo === "anadir" && (
              <button type="button" className="btn btn-p" disabled={!r.ok} onClick={anadir}>
                {pedido.alElegir ? "Añadir y usar" : "Añadir"}
              </button>
            )}
            {modo === "datos" && (
              <button type="button" className="btn btn-p" onClick={cerrarGestor}>
                Hecho
              </button>
            )}
          </>
        }
      >
        <Alzado plantas={vista} nuevas={nuevas} elegida={nuevas.size || !actual ? null : actual.id} onElegir={elegir} />
        <div
          className="ges-ficha"
          onKeyDown={(e) => {
            if (e.key === "Enter" && enCurso && e.target instanceof HTMLInputElement && e.target.closest("[data-anadir]")) anadir();
          }}
        >
          {pedido.para && <p className="ges-para">Para {pedido.para}</p>}
          {modo !== "inicio" && (
            <div className="seg mb-3" role="tablist" aria-label="Añadir o ver los datos">
              <button type="button" role="tab" aria-selected={modo === "anadir"} data-on={modo === "anadir"} onClick={() => (setModo("anadir"), setAviso(null))}>
                Añadir plantas
              </button>
              {actual && (
                <button type="button" role="tab" aria-selected={modo === "datos"} data-on={modo === "datos"} onClick={() => (setModo("datos"), setAviso(null))}>
                  Datos de {actual.id}
                </button>
              )}
            </div>
          )}
          {aviso && (
            <p className="ges-aviso" role="status">
              {aviso}
            </p>
          )}

          {modo === "inicio" && (
            <div className="ges-datos" data-anadir>
              <p className="ges-bienvenida">
                <strong>Empiece por las plantas.</strong> Todo lo que se dibuja va en una: diga cuántas tiene el edificio sobre la cimentación y de qué altura. Después podrá añadir más encima o debajo, y sótanos, desde «Plantas» en la barra.
              </p>
              <label className="campo">
                <span>plantas</span>
                <input value={n} inputMode="numeric" aria-label="Número de plantas sobre la cimentación" data-error={!r.ok && !(leer(n) >= 1)} onChange={(e) => setN(e.target.value)} autoFocus />
                <p>Sobre la cimentación, con la cubierta.</p>
              </label>
              <label className="campo">
                <span>
                  la primera<small>m</small>
                </span>
                <input value={alturaBaja} inputMode="decimal" aria-label="Altura de la primera planta, m" data-error={!r.ok && !(leer(alturaBaja) > 0)} onChange={(e) => setAlturaBaja(e.target.value)} />
                <p>De la cimentación a la cara superior del primer forjado.</p>
              </label>
              <label className="campo">
                <span>
                  las demás<small>m</small>
                </span>
                <input value={altura} inputMode="decimal" aria-label="Altura de las demás plantas, m" disabled={leer(n) <= 1} data-error={!r.ok && leer(n) > 1 && !(leer(altura) > 0)} onChange={(e) => setAltura(e.target.value)} />
                <p>De forjado a forjado.</p>
              </label>
              <label className="campo">
                <span>ids</span>
                <input value={prefijo} aria-label="Prefijo de los ids" onChange={(e) => setPrefijo(e.target.value)} />
                <p>{r.ok ? `De abajo arriba: ${[plantas[0]!.id, ...r.ids].join(", ")}.` : r.mensaje}</p>
              </label>
              <button type="button" className="text-accent mt-1 text-[12px] hover:underline" onClick={() => setModo("anadir")}>
                Prefiero añadirlas de una en una
              </button>
            </div>
          )}

          {modo === "anadir" && (
            <div className="ges-datos" data-anadir>
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
                  <select className="sel min-w-0 flex-1" value={de} aria-label="Planta de referencia" onChange={(e) => elegir(e.target.value)}>
                    {plantas.map((p, i) => (
                      <option key={p.id} value={p.id}>
                        {`${p.id} · ${cota(cotas[i] ?? null)}`}
                      </option>
                    ))}
                  </select>
                </div>
                <p>{donde === "encima" ? "Lo que hay encima sube. También se elige con un clic en el alzado." : "Ésta y lo que hay encima suben. También se elige con un clic en el alzado."}</p>
              </div>
              <label className="campo">
                <span>ids</span>
                <input value={prefijo} aria-label="Prefijo de los ids" onChange={(e) => setPrefijo(e.target.value)} />
                <p>{r.ok ? `Serán ${r.ids.join(", ")}.` : r.mensaje}</p>
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
          )}

          {modo === "datos" && actual && (
            <>
              <FormularioObjeto id={actual.id} tabla="plantas" />
              <p className="ges-usos">La «altura» de una planta es la que hay hasta la de encima (en el alzado, la cota entre las dos); la de arriba no tiene.</p>
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
            setElegida(0);
            setModo("anadir");
          }}
        />
      )}
    </>
  );
}

/** px por m del alzado, con un mínimo por planta para que se lea. */
const PX_M = 18;
const MIN_FILA = 30;
const MAX_ALZADO = 440;

/**
 * El alzado esquemático: una fila por planta de arriba abajo, con su forjado abajo, los pilares hasta
 * la de encima, la altura entre las dos y su cota. Es una tabla (se lee igual con un lector de
 * pantalla); lo dibujado no tiene texto.
 */
function Alzado({ plantas, nuevas, elegida, onElegir }: { plantas: readonly Planta[]; nuevas: ReadonlySet<string>; elegida: string | null; onElegir: (id: string) => void }) {
  const cotas = cotasPlantas(plantas);
  const total = plantas.reduce((s, p) => s + (p.altura ?? 0), 0);
  const k = total > 0 ? Math.min(PX_M, MAX_ALZADO / total) : PX_M;
  return (
    <div className="ges-alzado">
      <table aria-label="Cómo quedan las plantas">
        <thead>
          <tr>
            <th>Planta</th>
            <th aria-hidden="true" />
            <th>altura</th>
            <th>cota</th>
          </tr>
        </thead>
        <tbody>
          {plantas.map((p, i) => {
            const nueva = nuevas.has(p.id);
            const alto = p.altura === null ? 22 : Math.max(MIN_FILA, p.altura * k);
            return (
              <tr key={p.id} data-nueva={nueva || undefined} data-elegida={p.id === elegida || undefined} style={{ height: alto } as CSSProperties}>
                <td>
                  {nueva ? (
                    <span className="ges-planta">{p.id} · nueva</span>
                  ) : (
                    <button type="button" className="ges-planta" aria-pressed={p.id === elegida} onClick={() => onElegir(p.id)}>
                      {p.id}
                      {p.nombre ? <small> {p.nombre}</small> : p.tipo && p.tipo !== "planta" ? <small> {p.tipo === "sotano" ? "sótano" : p.tipo}</small> : null}
                    </button>
                  )}
                </td>
                <td className="ges-dib" aria-hidden="true">
                  {p.altura !== null && (
                    <>
                      <i className="ges-pil" style={{ left: "22%" }} />
                      <i className="ges-pil" style={{ right: "22%" }} />
                    </>
                  )}
                  <i className="ges-forjado" />
                </td>
                <td className="mono ges-h">{p.altura === null ? "—" : fmt(p.altura, 2)}</td>
                <td className="mono">{cota(cotas[i] ?? null)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="ges-terreno" aria-hidden="true" />
    </div>
  );
}
