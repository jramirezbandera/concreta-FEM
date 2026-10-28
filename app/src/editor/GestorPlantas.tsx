/**
 * El gestor de plantas (GE3, `docs/fem3d/gestores.md` §3.5), como la introducción de plantas de
 * CYPECAD. A la izquierda, el alzado esquemático del edificio a escala (SVG), con la cota de cada
 * forjado y la altura entre plantas acotada, y en azul lo que se va a añadir antes de añadirlo; un
 * clic elige una planta. A la derecha, o se añaden plantas (qué, dónde y con qué nombres) o se ven
 * los datos de la elegida (su formulario, el del inspector).
 *
 * Con un proyecto que empieza (`pedido.inicio`, al crearlo, con su planta sobre la cimentación), lo
 * primero es cuántas plantas tiene y de qué altura (`plantasEdificio`): sin plantas no se dibuja nada.
 *
 * Las alturas y el orden salen de `src/editor/plantas.ts`; aquí sólo se pinta.
 */
import { useId, useState, type KeyboardEvent } from "react";
import { Table2 } from "lucide-react";
import type { Planta, TipoPlanta } from "../../../src/compilador/fisico.ts";
import { cotasPlantas } from "../../../src/compilador/cotas.ts";
import { textoUsos, usosDe } from "../../../src/editor/gestores.ts";
import type { Operacion } from "../../../src/editor/operaciones.ts";
import { insertarPlantas, MAX_PLANTAS_NUEVAS, plantasEdificio, type InsercionPlantas } from "../../../src/editor/plantas.ts";
import { Ayuda } from "../componentes/Ayuda.tsx";
import { useVisor } from "../contexto.ts";
import { cota, fmt } from "../fmt.ts";
import { Dialogo, DialogoBorrar } from "./Dialogos.tsx";
import { FormularioObjeto } from "./Formulario.tsx";
import { cerrarGestor, type PedidoGestor } from "./referencia.tsx";
import "./gestores.css";

const leer = (t: string): number => (t.trim() === "" ? NaN : Number(t.trim().replace(",", ".")));
const TIPOS: readonly [TipoPlanta | "", string][] = [
  ["", "planta"],
  ["sotano", "sótano"],
  ["cubierta", "cubierta"],
];

type Modo = "inicio" | "anadir" | "datos";

/** Lo que dice el «?» de cada campo (la ayuda en un globo, no un texto debajo). */
const AYUDA = {
  plantas: "Cuántas plantas tiene el edificio sobre la cimentación, contando la cubierta. Cada planta es un forjado: sus pilares, vigas, losas y cargas se dibujan en ella.",
  primera: "De la cimentación a la cara superior del primer forjado. La cota de una planta es la cara superior de su forjado.",
  demas: "De cara superior a cara superior de forjado, igual en todas. Con una sola planta no se usa.",
  cuantas: `De 1 a ${MAX_PLANTAS_NUEVAS}, todas con la misma altura y el mismo tipo.`,
  altura: "De forjado a forjado (cara superior a cara superior): la de cada planta nueva hasta la de encima.",
  tipo: "Planta, sótano o cubierta. Un sótano cambia el origen de las cotas: la ±0,00 queda en la planta más baja que no es sótano. Una cubierta no tiene que llevar la sobrecarga de las demás plantas (no se avisa si le falta).",
  donde: "Encima: las nuevas van sobre la elegida y lo que hay encima sube. Debajo: van bajo ella, y ésta y lo que hay encima suben. La planta también se elige con un clic en el alzado.",
  prefijo: "Los ids de las plantas nuevas: el prefijo y el primer número libre (N1, N2…). Las piezas y las cargas citan su planta por el id; se puede cambiar después.",
};

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
            <div className="gp-form" data-anadir>
              <p className="ges-bienvenida">
                <strong>Empiece por las plantas.</strong> Todo lo que se dibuja va en una: diga cuántas tiene el edificio sobre la cimentación y de qué altura. Después podrá añadir más encima o debajo, y sótanos, desde «Plantas» en la barra.
              </p>
              <section className="gp-sec">
                <h3>El edificio</h3>
                <div className="gp-fila">
                  <label className="gp-campo gp-corto">
                    <span>
                      Plantas <Ayuda texto={AYUDA.plantas} />
                    </span>
                    <input value={n} inputMode="numeric" aria-label="Número de plantas sobre la cimentación" data-error={!r.ok && !(leer(n) >= 1)} onChange={(e) => setN(e.target.value)} autoFocus />
                  </label>
                  <label className="gp-campo">
                    <span>
                      La primera <Ayuda texto={AYUDA.primera} />
                    </span>
                    <span className="gp-unidad" data-unidad="m">
                      <input value={alturaBaja} inputMode="decimal" aria-label="Altura de la primera planta, m" data-error={!r.ok && !(leer(alturaBaja) > 0)} onChange={(e) => setAlturaBaja(e.target.value)} />
                    </span>
                  </label>
                  <label className="gp-campo">
                    <span>
                      Las demás <Ayuda texto={AYUDA.demas} />
                    </span>
                    <span className="gp-unidad" data-unidad="m">
                      <input value={altura} inputMode="decimal" aria-label="Altura de las demás plantas, m" disabled={leer(n) <= 1} data-error={!r.ok && leer(n) > 1 && !(leer(altura) > 0)} onChange={(e) => setAltura(e.target.value)} />
                    </span>
                  </label>
                </div>
              </section>
              <Nombres prefijo={prefijo} setPrefijo={setPrefijo} r={r} />
              <button type="button" className="gp-enlace" onClick={() => setModo("anadir")}>
                Prefiero añadirlas de una en una
              </button>
            </div>
          )}

          {modo === "anadir" && (
            <div className="gp-form" data-anadir>
              <section className="gp-sec">
                <h3>Qué plantas</h3>
                <div className="gp-fila">
                  <label className="gp-campo gp-corto">
                    <span>
                      Cuántas <Ayuda texto={AYUDA.cuantas} />
                    </span>
                    <input value={n} inputMode="numeric" aria-label="Número de plantas nuevas" data-error={!r.ok && !(leer(n) >= 1)} onChange={(e) => setN(e.target.value)} />
                  </label>
                  <label className="gp-campo">
                    <span>
                      Altura <Ayuda texto={AYUDA.altura} />
                    </span>
                    <span className="gp-unidad" data-unidad="m">
                      <input value={altura} inputMode="decimal" aria-label="Altura de las plantas nuevas, m" data-error={!r.ok && !(leer(altura) > 0)} onChange={(e) => setAltura(e.target.value)} />
                    </span>
                  </label>
                  <label className="gp-campo">
                    <span>
                      Tipo <Ayuda texto={AYUDA.tipo} />
                    </span>
                    <select value={tipo} aria-label="Tipo de las plantas nuevas" onChange={(e) => setTipo(e.target.value as TipoPlanta | "")}>
                      {TIPOS.map(([v, t]) => (
                        <option key={v} value={v}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>
              <section className="gp-sec">
                <h3>
                  Dónde <Ayuda texto={AYUDA.donde} />
                </h3>
                <div className="gp-fila">
                  <div className="seg gp-seg" role="radiogroup" aria-label="Encima o debajo">
                    {(["encima", "debajo"] as const).map((d) => (
                      <button key={d} type="button" role="radio" aria-checked={donde === d} data-on={donde === d} onClick={() => setDonde(d)}>
                        {d === "encima" ? "Encima de" : "Debajo de"}
                      </button>
                    ))}
                  </div>
                  <label className="gp-campo gp-ancho">
                    <select value={de} aria-label="Planta de referencia" onChange={(e) => elegir(e.target.value)}>
                      {plantas.map((p, i) => (
                        <option key={p.id} value={p.id}>
                          {`${p.id} · ${cota(cotas[i] ?? null)}`}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>
              <Nombres prefijo={prefijo} setPrefijo={setPrefijo} r={r} />
            </div>
          )}

          {modo === "datos" && actual && (
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
            setElegida(0);
            setModo("anadir");
          }}
        />
      )}
    </>
  );
}

/** El prefijo de los ids y, debajo, las plantas que salen con su cota (o por qué no salen). */
function Nombres({ prefijo, setPrefijo, r }: { prefijo: string; setPrefijo: (v: string) => void; r: InsercionPlantas }) {
  const cotas = r.ok ? cotasPlantas(r.plantas) : [];
  const cotaDe = (id: string) => (r.ok ? cota(cotas[r.plantas.findIndex((p) => p.id === id)] ?? null) : "");
  return (
    <section className="gp-sec">
      <h3>Nombres</h3>
      <div className="gp-fila">
        <label className="gp-campo gp-corto">
          <span>
            Prefijo <Ayuda texto={AYUDA.prefijo} />
          </span>
          <input value={prefijo} aria-label="Prefijo de los ids" data-error={!r.ok && !prefijo.trim()} onChange={(e) => setPrefijo(e.target.value)} />
        </label>
        {r.ok ? (
          <ul className="gp-nuevas" aria-label="Plantas que se crean">
            {[...r.ids].reverse().map((id) => (
              <li key={id}>
                <b>{id}</b>
                {cotaDe(id)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="gp-mal">{r.mensaje}</p>
        )}
      </div>
    </section>
  );
}

/** Unidades del dibujo (≈ px) por m, con un mínimo por planta para que se lea. */
const PX_M = 30;
const MIN_FILA = 36;
const MAX_ALZADO = 420;
/** Ancho del dibujo y dónde va cada cosa. */
const W = 300;
const X_EDIF = [100, 200] as const;
const X_PILARES = [112, 150, 188];
/** Letras del rótulo bajo el id que caben antes del edificio. */
const MAX_SUB = 15;
const X_COTA = 238;
const ARRIBA = 24;

/**
 * El alzado esquemático: los forjados de arriba abajo a escala, los pilares entre ellos, la altura
 * de cada planta acotada y la cota de cada forjado en su nivel, sobre el terreno. Un clic en un nivel
 * lo elige (también con el teclado). Lo dibujado va con una tabla oculta que dice lo mismo para un
 * lector de pantalla.
 */
function Alzado({ plantas, nuevas, elegida, onElegir }: { plantas: readonly Planta[]; nuevas: ReadonlySet<string>; elegida: string | null; onElegir: (id: string) => void }) {
  const rayado = useId();
  const cotas = cotasPlantas(plantas);
  const total = plantas.reduce((s, p) => s + (p.altura ?? 0), 0);
  const k = total > 0 ? Math.min(PX_M, MAX_ALZADO / total) : PX_M;
  const ys: number[] = [];
  plantas.forEach((p, i) => ys.push(i === 0 ? ARRIBA : ys[i - 1]! + Math.max(MIN_FILA, (p.altura ?? 0) * k)));
  const yFin = ys[ys.length - 1] ?? ARRIBA;
  const alto = yFin + 30;
  const ultima = plantas.length - 1;
  return (
    <div className="ges-alzado">
      <svg className="gp-alzado" viewBox={`0 0 ${W} ${alto}`} width={W} height={alto} role="group" aria-label="Alzado de las plantas">
        <defs>
          <pattern id={rayado} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7" className="gp-rayado" />
          </pattern>
        </defs>
        {plantas.map((p, i) => {
          const y = ys[i]!;
          const nueva = nuevas.has(p.id);
          const sel = p.id === elegida;
          const arriba = i > 0 ? ys[i - 1]! : null;
          const sub = nueva ? "nueva" : p.nombre ? p.nombre : p.tipo && p.tipo !== "planta" ? (p.tipo === "sotano" ? "sótano" : p.tipo) : i === ultima ? "cimentación" : null;
          return (
            <g
              key={p.id}
              className="gp-nivel"
              data-nueva={nueva || undefined}
              data-elegida={sel || undefined}
              {...(nueva
                ? {}
                : {
                    role: "button",
                    tabIndex: 0,
                    "aria-label": `Elegir ${p.id}`,
                    "aria-pressed": sel,
                    onClick: () => onElegir(p.id),
                    onKeyDown: (e: KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onElegir(p.id);
                      }
                    },
                  })}
            >
              <rect className="gp-banda" x={0} y={y - 15} width={W} height={30} rx={6} />
              {arriba !== null &&
                X_PILARES.map((x) => <rect key={x} className="gp-pilar" x={x - 2.5} y={arriba + 3} width={5} height={y - arriba - 6} />)}
              {arriba !== null && (
                <g className="gp-acot">
                  <line x1={X_COTA} y1={arriba} x2={X_COTA} y2={y} />
                  <line x1={X_COTA - 3} y1={arriba + 3} x2={X_COTA + 3} y2={arriba - 3} />
                  <line x1={X_COTA - 3} y1={y + 3} x2={X_COTA + 3} y2={y - 3} />
                  <text x={X_COTA - 6} y={(arriba + y) / 2 + 4} textAnchor="end">
                    {fmt(plantas[i]!.altura, 2)}
                  </text>
                </g>
              )}
              <line className="gp-nivel-linea" x1={X_EDIF[1] + 4} y1={y} x2={W - 4} y2={y} />
              <text className="gp-cota" x={W - 4} y={y - 5}>
                {cota(cotas[i] ?? null)}
              </text>
              {i === ultima ? (
                <rect className="gp-forjado gp-cim" x={X_EDIF[0] - 10} y={y - 4} width={X_EDIF[1] - X_EDIF[0] + 20} height={9} rx={1.5} />
              ) : (
                <rect className="gp-forjado" x={X_EDIF[0]} y={y - 3} width={X_EDIF[1] - X_EDIF[0]} height={6} rx={1.5} />
              )}
              <text className="gp-id" x={8} y={sub ? y - 1 : y + 4}>
                {p.id}
              </text>
              {sub && (
                <text className="gp-sub" x={8} y={y + 12}>
                  {sub.length > MAX_SUB ? `${sub.slice(0, MAX_SUB - 1).trimEnd()}…` : sub}
                  {sub.length > MAX_SUB && <title>{sub}</title>}
                </text>
              )}
            </g>
          );
        })}
        <rect x={X_EDIF[0] - 14} y={yFin + 6} width={X_EDIF[1] - X_EDIF[0] + 28} height={14} fill={`url(#${rayado})`} />
        <line className="gp-terreno" x1={X_EDIF[0] - 14} y1={yFin + 6} x2={X_EDIF[1] + 14} y2={yFin + 6} />
      </svg>
      <p className="gp-total">
        {`${plantas.length} niveles · ${fmt(total, 2)} m de altura`}
        {nuevas.size > 0 && <span>{` · ${nuevas.size} ${nuevas.size === 1 ? "nueva" : "nuevas"}`}</span>}
      </p>
      <table className="sr-only" aria-label="Cómo quedan las plantas">
        <thead>
          <tr>
            <th>Planta</th>
            <th />
            <th>altura</th>
            <th>cota</th>
          </tr>
        </thead>
        <tbody>
          {plantas.map((p, i) => (
            <tr key={p.id}>
              <td>{nuevas.has(p.id) ? `${p.id} · nueva` : p.id}</td>
              <td />
              <td>{p.altura === null ? "—" : fmt(p.altura, 2)}</td>
              <td>{cota(cotas[i] ?? null)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
