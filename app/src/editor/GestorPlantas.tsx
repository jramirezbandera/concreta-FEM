/**
 * El gestor de plantas (GE3, `docs/fem3d/gestores.md` §3.5), como la introducción de plantas de
 * CYPECAD. A la izquierda, el alzado esquemático del edificio a escala (SVG), con la cota de cada
 * forjado y la altura entre plantas acotada, y en azul lo que se va a añadir antes de añadirlo; un
 * clic elige una planta. A la derecha, o se añaden plantas o se edita la elegida (su formulario, el
 * del inspector).
 *
 * Los formularios van en filas, con el nombre a la izquierda y, a la derecha, una nota corta que dice
 * lo que hace falta saber (de la prueba de uso del 2026-11-28: los «?» con párrafos y la caja de
 * bienvenida no explicaban nada). Debajo, lo que va a pasar en una frase: qué plantas se crean, a qué
 * cota, y cuáles suben.
 *
 * Con un proyecto que empieza (`pedido.inicio`, al crearlo, con su planta sobre la cimentación), lo
 * primero es cuántas plantas tiene, de qué altura y dónde va la ±0,00 (`plantasEdificio`): sin plantas
 * no se dibuja nada.
 *
 * La cota de una planta se escribe en sus datos (`moverCota`): mueve sólo su forjado, y 0 la hace la
 * ±0,00. Debajo de la ficha se dice cuál es la ±0,00.
 *
 * Los datos de una planta van al modelo con «Aplicar», como en los demás gestores (`auditoria-ui.md`,
 * D-19), y no se tiran sin preguntar.
 *
 * Las alturas y el orden salen de `src/editor/plantas.ts`; aquí sólo se pinta.
 */
import { useCallback, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Table2 } from "lucide-react";
import type { Planta, TipoPlanta } from "../../../src/compilador/fisico.ts";
import { cotasPlantas } from "../../../src/compilador/cotas.ts";
import { textoUsos, usosDe } from "../../../src/editor/gestores.ts";
import type { Operacion } from "../../../src/editor/operaciones.ts";
import { insertarPlantas, MAX_PLANTAS_NUEVAS, plantasEdificio, type InsercionPlantas } from "../../../src/editor/plantas.ts";
import { useVisor } from "../contexto.ts";
import { cota, fmt, plural } from "../fmt.ts";
import { Dialogo, DialogoBorrar } from "./Dialogos.tsx";
import { FormularioObjeto, type ControlFicha } from "./Formulario.tsx";
import { PreguntaCambios } from "./Gestores.tsx";
import { cerrarGestor, type PedidoGestor } from "./referencia.tsx";
import "./gestores.css";
import { Grupo } from "../componentes/Grupo.tsx";

const leer = (t: string): number => (t.trim() === "" ? NaN : Number(t.trim().replace(",", ".")));
const TIPOS: readonly [TipoPlanta | "", string][] = [
  ["", "Planta"],
  ["sotano", "Sótano"],
  ["cubierta", "Cubierta"],
  ["escalon", "Escalón"],
];
/** Lo que es cada tipo, en una línea, junto al desplegable. */
const NOTA_TIPO: Readonly<Record<string, string>> = {
  "": "un forjado normal",
  sotano: "por debajo de la ±0,00",
  cubierta: "no avisa si le falta la sobrecarga",
  escalon: "muy cerca del de debajo, sin aviso de altura",
};

type Modo = "inicio" | "anadir" | "datos";

/** «N2», «N2 y N3», «N2, N3 y N4». */
function lista(ids: readonly string[]): string {
  return ids.length < 2 ? (ids[0] ?? "") : `${ids.slice(0, -1).join(", ")} y ${ids[ids.length - 1]}`;
}

export function GestorPlantas({ pedido }: { pedido: PedidoGestor }) {
  const { proyecto, pedirTabla, setPlanta } = useVisor();
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
  const [cero, setCero] = useState<"primera" | "cimentacion">(plantas[1]?.tipo === "sotano" ? "primera" : "cimentacion");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [borrar, setBorrar] = useState<string | null>(null);

  const de = actual?.id ?? "";
  const r =
    modo === "inicio"
      ? plantasEdificio(m, { n: leer(n), alturaBaja: leer(alturaBaja), altura: leer(altura), prefijo, cero })
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
    const sobre = r.plantas.length - 1;
    const etiqueta = modo === "inicio" ? `Crear ${plural(sobre, "planta")} sobre la cimentación` : `Añadir ${lista(r.ids)} ${donde} de ${de}`;
    if (!terminar(r.ids[0] ?? de, [r.operacion], etiqueta)) return;
    setError(null);
    setAviso(modo === "inicio" ? `${plural(sobre, "planta creada", "plantas creadas")} sobre la cimentación.` : `${lista(r.ids)} ${r.ids.length > 1 ? "añadidas" : "añadida"} ${donde} de ${de}.`);
    setN("1");
    // Después, los datos de una planta y «Hecho» (`auditoria-ui.md`, UI-8): seguir en «Añadir», con la
    // primera nueva elegida y el número de antes, metía plantas en medio con un segundo clic
    setModo("datos");
    if (modo === "inicio") {
      // Se empieza a dibujar por la primera sobre la cimentación, no por la de arriba
      const primera = Math.max(0, r.plantas.length - 2);
      setElegida(primera);
      if (r.plantas[primera]) setPlanta(r.plantas[primera]!.id);
    } else {
      const ix = r.ids.map((id) => r.plantas.findIndex((p) => p.id === id));
      setElegida(donde === "encima" ? Math.min(...ix) : Math.max(...ix));
    }
  };

  // Los datos con «Aplicar»: lo escrito, y lo que se perdería al ir a otra planta, a «Añadir» o al cerrar (UI-30)
  const ficha = useRef<ControlFicha | null>(null);
  const [cambiado, setCambiado] = useState(false);
  const alCambiar = useCallback((c: boolean) => setCambiado(c), []);
  const pendiente = modo === "datos" && actual && cambiado ? `${actual.id} tiene cambios sin aplicar.` : null;
  const [irA, setIrA] = useState<(() => void) | null>(null);
  const antes = (f: () => void) => (pendiente ? setIrA(() => f) : f());

  const elegir = (id: string) => {
    const i = plantas.findIndex((p) => p.id === id);
    if (i < 0) return;
    antes(() => {
      setAviso(null);
      setError(null);
      setElegida(i);
      if (modo === "inicio") setModo("anadir");
    });
  };

  const usos = actual ? usosDe(m, actual.id) : [];
  const enCurso = modo !== "datos";
  const aplicar = () => {
    if (!actual) return;
    const id = actual.id;
    setError(null);
    if (ficha.current?.aplicar()) setAviso(`${id}: cambios aplicados.`);
    else setError("No se ha aplicado: falta o no vale lo marcado.");
  };
  const nCero = cotaCero(plantas);

  return (
    <>
      <Dialogo
        titulo="Plantas"
        clase="gestor gestor-plantas"
        onCerrar={cerrarGestor}
        pendiente={pendiente}
        // UI-39: el primer paso de una obra nueva no se cierra con un clic en el fondo; UI-30: ni lo escrito
        fondoCierra={modo !== "inicio" && !pendiente}
        pie={
          <>
            <button type="button" className="btn btn-q mr-auto" onClick={() => (cerrarGestor(), pedirTabla("plantas"))} title="Abrir la tabla: para cambiar muchas a la vez o pegar de Excel">
              <Table2 size={14} />
              Abrir la tabla
            </button>
            {modo === "datos" && actual && (
              <button type="button" className="btn" onClick={() => setBorrar(actual.id)}>
                Borrar {actual.id}
              </button>
            )}
            {actual && pedido.alElegir && !pendiente && (
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
                {pedido.alElegir ? "Añadir y usar" : r.ok ? `Añadir ${r.ids.length === 1 ? "1 planta" : `${r.ids.length} plantas`} ${donde === "encima" ? "encima de" : "debajo de"} ${de}` : "Añadir"}
              </button>
            )}
            {modo === "datos" &&
              (cambiado ? (
                <button type="button" className="btn btn-p" onClick={aplicar}>
                  {usos.length ? `Aplicar a ${textoUsos(usos)}` : "Aplicar"}
                </button>
              ) : (
                <button type="button" className="btn btn-p" onClick={cerrarGestor}>
                  Hecho
                </button>
              ))}
          </>
        }
      >
        <Alzado plantas={vista} nuevas={nuevas} elegida={nuevas.size || !actual ? null : actual.id} onElegir={elegir} />
        <div
          className="ges-ficha gp-ficha"
          onKeyDown={(e) => {
            if (e.key === "Enter" && enCurso && e.target instanceof HTMLInputElement && e.target.closest("[data-anadir]")) anadir();
          }}
        >
          {pedido.para && <p className="ges-para">Para {pedido.para}</p>}
          {modo !== "inicio" && (
            <Grupo rol="tablist" etiqueta="Añadir plantas o editar la elegida" className="seg gp-pestanas">
              <button type="button" role="tab" aria-selected={modo === "anadir"} data-on={modo === "anadir"} onClick={() => antes(() => (ficha.current?.descartar(), setModo("anadir"), setAviso(null)))}>
                Añadir plantas
              </button>
              {actual && (
                <button type="button" role="tab" aria-selected={modo === "datos"} data-on={modo === "datos"} onClick={() => (setModo("datos"), setAviso(null))}>
                  Editar {actual.id}
                </button>
              )}
            </Grupo>
          )}
          {irA && <PreguntaCambios texto={pendiente} onDescartar={() => (setIrA(null), ficha.current?.descartar(), irA())} onSeguir={() => setIrA(null)} />}
          {aviso && (
            <p className="msj ok ges-aviso" role="status">
              {aviso}
            </p>
          )}

          {modo === "inicio" && (
            <div className="gp-form" data-anadir>
              <header className="gp-cab">
                <h3>¿Cuántas plantas tiene el edificio?</h3>
                <p>Todo se dibuja en una planta. Más adelante podrá añadir, quitar o cambiar cada una.</p>
              </header>
              <div className="gp-rejilla">
                <Linea etiqueta="Plantas sobre la cimentación" nota="contando la cubierta">
                  <input className="gp-num" value={n} inputMode="numeric" aria-label="Número de plantas sobre la cimentación" data-error={!r.ok && !(leer(n) >= 1)} onChange={(e) => setN(e.target.value)} autoFocus />
                </Linea>
                <Linea etiqueta="Altura de la primera" nota="de la cimentación al primer forjado">
                  <Metros valor={alturaBaja} etiqueta="Altura de la primera planta, m" mal={!r.ok && !(leer(alturaBaja) > 0)} onCambio={setAlturaBaja} />
                </Linea>
                <Linea etiqueta="Altura de las demás" nota={leer(n) <= 1 ? "con una planta no hace falta" : "de forjado a forjado, todas iguales"}>
                  <Metros valor={altura} etiqueta="Altura de las demás plantas, m" desactivado={leer(n) <= 1} mal={!r.ok && leer(n) > 1 && !(leer(altura) > 0)} onCambio={setAltura} />
                </Linea>
                <Linea
                  etiqueta="Cota ±0,00"
                  como="div"
                  ancho
                  nota={cero === "cimentacion" ? "todas las cotas, positivas" : leer(alturaBaja) > 0 ? `la cimentación queda a ${cota(-leer(alturaBaja))}` : "la cimentación queda por debajo"}
                >
                  <Grupo rol="radiogroup" etiqueta="Dónde va la cota ±0,00" className="seg gp-seg">
                    {(["cimentacion", "primera"] as const).map((c) => (
                      <button key={c} type="button" role="radio" aria-checked={cero === c} data-on={cero === c} onClick={() => setCero(c)}>
                        {c === "primera" ? "En la primera planta" : "En la cimentación"}
                      </button>
                    ))}
                  </Grupo>
                </Linea>
                <Prefijo prefijo={prefijo} setPrefijo={setPrefijo} r={r} />
              </div>
              <Resumen r={r} antes={plantas} inicio />
              <button type="button" className="gp-enlace" onClick={() => setModo("anadir")}>
                Prefiero añadirlas de una en una
              </button>
            </div>
          )}

          {modo === "anadir" && (
            <div className="gp-form" data-anadir>
              <div className="gp-rejilla">
                <Linea etiqueta="Cuántas" nota={`de 1 a ${MAX_PLANTAS_NUEVAS}, iguales`}>
                  <input className="gp-num" value={n} inputMode="numeric" aria-label="Número de plantas nuevas" data-error={!r.ok && !(leer(n) >= 1)} onChange={(e) => setN(e.target.value)} />
                </Linea>
                <Linea etiqueta="Altura" nota="de cada una, de forjado a forjado">
                  <Metros valor={altura} etiqueta="Altura de las plantas nuevas, m" mal={!r.ok && !(leer(altura) > 0)} onCambio={setAltura} />
                </Linea>
                <Linea etiqueta="Tipo" nota={NOTA_TIPO[tipo]}>
                  <select className="sel gp-sel" value={tipo} aria-label="Tipo de las plantas nuevas" onChange={(e) => setTipo(e.target.value as TipoPlanta | "")}>
                    {TIPOS.map(([v, t]) => (
                      <option key={v} value={v}>
                        {t}
                      </option>
                    ))}
                  </select>
                </Linea>
                <Linea etiqueta="Dónde" como="div" ancho>
                  <Grupo rol="radiogroup" etiqueta="Encima o debajo" className="seg gp-seg">
                    {(["encima", "debajo"] as const).map((d) => (
                      <button key={d} type="button" role="radio" aria-checked={donde === d} data-on={donde === d} onClick={() => setDonde(d)}>
                        {d === "encima" ? "Encima de" : "Debajo de"}
                      </button>
                    ))}
                  </Grupo>
                  <select className="sel gp-sel" value={de} aria-label="Planta de referencia" title="La planta también se elige con un clic en el alzado" onChange={(e) => elegir(e.target.value)}>
                    {plantas.map((p, i) => (
                      <option key={p.id} value={p.id}>
                        {`${p.id} · ${cota(cotas[i] ?? null)}`}
                      </option>
                    ))}
                  </select>
                </Linea>
                <Prefijo prefijo={prefijo} setPrefijo={setPrefijo} r={r} />
              </div>
              <Resumen r={r} antes={plantas} />
            </div>
          )}

          {modo === "datos" && actual && (
            <>
              <FormularioObjeto id={actual.id} tabla="plantas" diferido={{ control: ficha, alCambiar }} sinTitulo />
              <dl className="gp-info">
                <div>
                  <dt>Cota ±0,00</dt>
                  <dd>
                    {nCero === actual.id ? `Esta planta, ${actual.id}` : (nCero ?? "—")}
                    <small>La planta más baja que no es sótano. Para cambiarla, escriba 0 en la cota de otra.</small>
                  </dd>
                </div>
                <div>
                  <dt>La usan</dt>
                  <dd>{usos.length ? textoUsos(usos) : "Nada todavía"}</dd>
                </div>
              </dl>
            </>
          )}
          {error && (
            <p className="msj fail ges-error" role="alert">
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

/** La ±0,00: la planta más baja que no es sótano. */
function cotaCero(plantas: readonly Planta[]): string | undefined {
  let o = plantas.length - 1;
  while (o > 0 && plantas[o]!.tipo === "sotano") o--;
  return plantas[o]?.id;
}

/**
 * Una fila del formulario: el nombre a la izquierda, el control y una nota corta. Un `<label>` (un
 * clic en el nombre lleva al campo) salvo con botones dentro (`como="div"`), que el `<label>` pulsaría.
 */
function Linea({ etiqueta, nota, como = "label", ancho, children }: { etiqueta: string; nota?: ReactNode; como?: "label" | "div"; ancho?: boolean; children: ReactNode }) {
  const Caja = como;
  return (
    <Caja className="gp-linea" data-ancho={ancho || undefined}>
      <span className="gp-et">{etiqueta}</span>
      {/* A lo ancho (botones y una lista), la nota va detrás en la misma celda: si no, ensancharía la columna de los campos */}
      <span className="gp-ctl">
        {children}
        {ancho && nota !== undefined && <small className="gp-nota">{nota}</small>}
      </span>
      {!ancho && nota !== undefined && <small className="gp-nota">{nota}</small>}
    </Caja>
  );
}

/** Un campo en metros, con la unidad dentro. */
function Metros({ valor, etiqueta, mal, desactivado, onCambio }: { valor: string; etiqueta: string; mal: boolean; desactivado?: boolean; onCambio: (v: string) => void }) {
  return (
    <span className="gp-unidad" data-unidad="m">
      <input className="gp-num gp-m" value={valor} inputMode="decimal" aria-label={etiqueta} disabled={desactivado} data-error={mal} onChange={(e) => onCambio(e.target.value)} />
    </span>
  );
}

/** El prefijo de los ids de las plantas nuevas, con los que salen. */
function Prefijo({ prefijo, setPrefijo, r }: { prefijo: string; setPrefijo: (v: string) => void; r: InsercionPlantas }) {
  return (
    <Linea etiqueta="Nombres" nota={r.ok && r.ids.length ? `se llamarán ${r.ids.length > 3 ? `${r.ids[0]} … ${r.ids[r.ids.length - 1]}` : lista(r.ids)}` : "prefijo y el primer número libre"}>
      <input className="gp-num" value={prefijo} aria-label="Prefijo de los ids" data-error={!r.ok && !prefijo.trim()} onChange={(e) => setPrefijo(e.target.value)} />
    </Linea>
  );
}

/**
 * Lo que va a pasar, en una o dos frases: las plantas que se crean con su cota y las que ya había y
 * cambian de cota (las de encima suben). Al empezar una obra, el edificio entero. O por qué no se puede.
 */
function Resumen({ r, antes, inicio }: { r: InsercionPlantas; antes: readonly Planta[]; inicio?: boolean }) {
  if (!r.ok)
    return (
      <p className="gp-resumen" data-mal>
        {r.mensaje}
      </p>
    );
  const cs = cotasPlantas(r.plantas);
  const cotaDe = (id: string) => cota(cs[r.plantas.findIndex((p) => p.id === id)] ?? null);
  const nuevas = [...r.ids].reverse();
  if (inicio) {
    const cim = r.plantas[r.plantas.length - 1]!;
    const sobre = r.plantas.slice(0, -1).reverse();
    return (
      <p className="gp-resumen" aria-label="Plantas que se crean">
        {sobre.map((p, i) => (
          <span key={p.id}>
            {i > 0 && (i === sobre.length - 1 ? " y " : ", ")}
            <b>{p.id}</b> a {cotaDe(p.id)}
          </span>
        ))}
        {`; la cimentación, ${cim.id}, a ${cotaDe(cim.id)}.`}
      </p>
    );
  }
  const cs0 = cotasPlantas(antes);
  const mueven = antes.flatMap((p, i) => {
    const a = cs0[i];
    const j = r.plantas.findIndex((x) => x.id === p.id);
    const b = cs[j];
    return a === null || a === undefined || b === null || b === undefined || Math.abs(b - a) < 1e-9 ? [] : [{ id: p.id, d: b - a }];
  });
  const verbo = (d: number, k: number) => (d > 0 ? (k === 1 ? "Sube" : "Suben") : k === 1 ? "Baja" : "Bajan");
  const igual = mueven.length > 0 && mueven.every((x) => Math.abs(x.d - mueven[0]!.d) < 1e-9);
  return (
    <p className="gp-resumen" aria-label="Plantas que se crean">
      {nuevas.length === 1 ? "Se crea " : "Se crean "}
      {nuevas.map((id, i) => (
        <span key={id}>
          {i > 0 && (i === nuevas.length - 1 ? " y " : ", ")}
          <b>{id}</b> a {cotaDe(id)}
        </span>
      ))}
      .
      {mueven.length > 0 &&
        (igual
          ? ` ${verbo(mueven[0]!.d, mueven.length)} ${fmt(Math.abs(mueven[0]!.d), 2)} m: ${lista(mueven.map((x) => x.id))}.`
          : ` Cambian de cota ${lista(mueven.map((x) => x.id))}.`)}
    </p>
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
          const sub = nueva ? "nueva" : p.nombre ? p.nombre : i === ultima ? "cimentación" : p.tipo && p.tipo !== "planta" ? (p.tipo === "sotano" ? "sótano" : p.tipo === "escalon" ? "escalón" : p.tipo) : null;
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
        {`${plural(plantas.length, "planta")} · ${fmt(total, 2)} m de altura`}
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
