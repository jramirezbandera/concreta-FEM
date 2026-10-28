/**
 * El inspector como formulario del objeto elegido (V2a, §6.2): las columnas de su tabla, una por
 * línea, con su unidad y su ayuda a la vista. Se escribe igual que en la tabla (Intro o salir del
 * campo), con las mismas funciones puras: un dato que no vale no entra y se dice por qué.
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { operacionFila } from "../../../src/editor/edicion.ts";
import { comoUna } from "../../../src/editor/gestores.ts";
import { indiceIds } from "../../../src/editor/referencias.ts";
import { columnasComunes, operacionVarios, type ColumnaComun } from "../../../src/editor/varios.ts";
import { DEF_TABLAS, conActual, contexto, filaConValor, objetosTabla, tablaDeColeccion, type NombreTabla } from "../../../src/editor/tablas.ts";
import { Seccion } from "../componentes/comunes.tsx";
import { useVisor } from "../contexto.ts";
import { abrirGestor, ARTICULO, esDelGestor, OpcionesGestor, pedidoCampo } from "./referencia.tsx";

/** La tabla del editor de un objeto (null si no está en el proyecto: un eje propuesto). */
export function tablaDe(m: Parameters<typeof indiceIds>[0], id: string): NombreTabla | null {
  const c = indiceIds(m).get(id)?.coleccion;
  return c ? tablaDeColeccion(c) : null;
}

export function FormularioObjeto({ id, tabla }: { id: string; tabla: NombreTabla }) {
  const { proyecto, setSeleccion } = useVisor();
  const ed = proyecto.edicion!;
  const m = ed.proyecto.modelo;
  const def = DEF_TABLAS[tabla];
  const objeto = objetosTabla(m, tabla).find((o) => o.id === id);
  const ctx = useMemo(() => contexto(m), [m]);
  const fila = useMemo(() => (objeto ? def.fila(objeto, ctx) : null), [objeto, def, ctx]);
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [errores, setErrores] = useState<Record<string, string>>({});

  useEffect(() => {
    setBorrador({});
    setErrores({});
  }, [id, fila]);

  if (!objeto || !fila) return <p className="nota">Este objeto ya no está en el proyecto.</p>;

  /** Cambia de tipo (Forjados) y aún le falta algo: el borrador es la fila entera, que se guarda al completarla. */
  const pendiente = borrador.tipo !== undefined && borrador.tipo !== fila.tipo;
  const actual = { ...fila, ...borrador };

  /** `elegido`: lo elegido en un desplegable (si no, lo escrito en el campo). */
  const escribir = (clave: string, elegido?: string) => {
    const v = elegido ?? borrador[clave];
    if (v === undefined || (v === (fila[clave] ?? "") && !pendiente)) return;
    const nueva = filaConValor(def, pendiente ? actual : fila, clave, v);
    const t = operacionFila(m, tabla, id, nueva);
    if (!t.ok) {
      if (t.errores.every((e) => e.mensaje === "falta el dato") && ((clave === "tipo" && def.conValor) || pendiente)) {
        setBorrador(nueva);
        return setErrores(Object.fromEntries(t.errores.map((e) => [e.columna ?? "", "falta el dato: se guarda en cuanto esté completo"])));
      }
      return setErrores({ ...errores, [clave]: t.errores.map((e) => e.mensaje).join(" · ") });
    }
    const col = def.columnas.find((c) => c.clave === clave)!;
    const r = ed.editar(t.operacion, `${id} · ${col.titulo} = ${v || "(vacío)"}`);
    if (!r.ok) return setErrores({ ...errores, [clave]: r.errores.map((e) => e.mensaje).join(" ") });
    if (t.operacion.op === "cambiar" && t.operacion.objeto.id !== id) setSeleccion(t.operacion.objeto.id);
  };

  /**
   * GE: «Nueva…» o «Editar…» de un desplegable de referencia abre su gestor; lo que crea y la
   * asignación van en un lote (un paso de deshacer).
   */
  const gestor = (clave: string, eleccion: string) => {
    const col = def.columnas.find((c) => c.clave === clave)!;
    abrirGestor(
      pedidoCampo({
        coleccion: col.referencia!,
        eleccion,
        valor: actual[clave] ?? "",
        tabla,
        clave,
        fila: actual,
        para: `${col.titulo === "vigueta" ? "la vigueta" : ARTICULO[col.referencia!]} de ${id}`,
        alElegir: (nuevo, crear) => {
          // «Usar» la que ya tiene no es un paso de deshacer
          if (!crear.length && !pendiente && (fila[clave] ?? "") === nuevo) return null;
          const t = operacionFila(m, tabla, id, filaConValor(def, pendiente ? actual : fila, clave, nuevo));
          if (!t.ok) return t.errores.map((e) => e.mensaje).join(" · ");
          const r = ed.editar(comoUna([...crear, t.operacion]), `${id} · ${col.titulo} = ${nuevo}`);
          return r.ok ? null : r.errores.map((e) => e.mensaje).join(" ");
        },
      }),
    );
  };

  return (
    <Seccion titulo={`Datos · ${def.titulo.toLowerCase()}`} valor="editable">
      <div className="py-1.5">
        {pendiente && (
          <p className="nota">
            {id} pasa a ser {actual.tipo}: falta lo marcado.{" "}
            <button type="button" className="text-accent hover:underline" onClick={() => (setBorrador({}), setErrores({}))}>
              Dejarlo como estaba
            </button>
          </p>
        )}
        {def.columnas.map((c) => {
          const valor = borrador[c.clave] ?? fila[c.clave] ?? "";
          // Lo que no aplica al tipo (Forjados) no se enseña si está vacío
          if (def.aplica && !valor && !def.aplica(c.clave, actual)) return null;
          const err = errores[c.clave];
          const opciones = c.opciones && !c.calculada ? c.opciones(ctx) : null;
          return (
            <label key={c.clave} className="campo">
              <span title={c.ayuda}>
                {c.titulo}
                {c.unidad && opciones && <small>{c.unidad}</small>}
              </span>
              {opciones ? (
                <select
                  className="sel"
                  value={valor}
                  data-error={!!err}
                  aria-label={c.titulo}
                  aria-invalid={!!err}
                  onChange={(e) => {
                    setErrores({ ...errores, [c.clave]: "" });
                    if (c.referencia && esDelGestor(e.target.value)) return gestor(c.clave, e.target.value);
                    escribir(c.clave, e.target.value);
                  }}
                >
                  {/* Un valor que no está entre las opciones (escrito en la tabla) se conserva */}
                  {conActual(opciones, valor).map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.texto ?? o.valor}
                    </option>
                  ))}
                  {c.referencia && <OpcionesGestor coleccion={c.referencia} valor={valor} />}
                </select>
              ) : (
                <span className="unidad" data-unidad={c.unidad} style={c.unidad ? ({ "--u": c.unidad.length } as CSSProperties) : undefined}>
                <input
                  value={valor}
                  placeholder={c.calculada ? undefined : "—"}
                  readOnly={c.calculada}
                  data-error={!!err}
                  aria-label={c.titulo}
                  aria-invalid={!!err}
                  onChange={(e) => {
                    setBorrador({ ...borrador, [c.clave]: e.target.value });
                    if (err) setErrores({ ...errores, [c.clave]: "" });
                  }}
                  onBlur={() => escribir(c.clave)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") escribir(c.clave);
                    if (e.key === "Escape") {
                      setBorrador({ ...borrador, [c.clave]: fila[c.clave] ?? "" });
                      setErrores({ ...errores, [c.clave]: "" });
                    }
                  }}
                />
                </span>
              )}
              {err ? <p className="error">{err}</p> : c.ayuda ? <p className="ayuda">{c.ayuda}</p> : null}
            </label>
          );
        })}
      </div>
    </Seccion>
  );
}

/** Lo que se ve en un campo cuyo valor no es el mismo en todos los elegidos. */
const VARIOS = "\u0000varios";

/**
 * Varios objetos de una tabla a la vez (`src/editor/varios.ts`): cada columna con el valor de todos
 * o «(varios)», y lo que se escribe va a todos en un paso de deshacer. El id no sale: es de cada uno.
 */
export function FormularioVarios({ ids, tabla }: { ids: readonly string[]; tabla: NombreTabla }) {
  const { proyecto } = useVisor();
  const ed = proyecto.edicion!;
  const m = ed.proyecto.modelo;
  const def = DEF_TABLAS[tabla];
  const ctx = useMemo(() => contexto(m), [m]);
  const claveIds = ids.join(" ");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- por su contenido: la lista llega nueva en cada render
  const cols = useMemo(() => columnasComunes(m, tabla, ids), [m, tabla, claveIds]);
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [errores, setErrores] = useState<Record<string, string>>({});

  useEffect(() => {
    setBorrador({});
    setErrores({});
  }, [cols]);

  const etiqueta = (titulo: string, v: string) => `${ids.length} ${def.titulo.toLowerCase()} · ${titulo} = ${v || "(vacío)"}`;

  /** `elegido`: lo elegido en un desplegable (si no, lo escrito en el campo). */
  const escribir = (c: ColumnaComun, elegido?: string) => {
    const v = elegido ?? borrador[c.columna.clave];
    // En un campo «varios», dejarlo vacío es no tocarlo
    if (v === undefined || v === VARIOS || v === c.valor || (c.valor === null && v === "")) return;
    const t = operacionVarios(m, tabla, ids, c.columna.clave, v);
    if (!t.ok) return setErrores({ ...errores, [c.columna.clave]: [...new Set(t.errores.map((e) => e.mensaje))].join(" · ") + ` (${[...new Set(t.errores.map((e) => e.id))].join(", ")})` });
    const r = ed.editar(t.operacion, etiqueta(c.columna.titulo, v));
    if (!r.ok) return setErrores({ ...errores, [c.columna.clave]: r.errores.map((e) => e.mensaje).join(" ") });
  };

  const gestor = (c: ColumnaComun, eleccion: string) => {
    const primero = objetosTabla(m, tabla).find((o) => o.id === ids[0]);
    abrirGestor(
      pedidoCampo({
        coleccion: c.columna.referencia!,
        eleccion,
        valor: c.valor ?? "",
        tabla,
        clave: c.columna.clave,
        fila: primero ? def.fila(primero, ctx) : {},
        para: `${c.columna.titulo === "vigueta" ? "la vigueta" : ARTICULO[c.columna.referencia!]} de ${ids.length} ${def.titulo.toLowerCase()}`,
        alElegir: (nuevo, crear) => {
          if (!crear.length && c.valor === nuevo) return null;
          // Lo creado aún no está en el modelo: la referencia se comprueba al aplicar el lote
          const t = operacionVarios(m, tabla, ids, c.columna.clave, nuevo);
          if (!t.ok) return [...new Set(t.errores.map((e) => e.mensaje))].join(" · ");
          const r = ed.editar(comoUna([...crear, t.operacion]), etiqueta(c.columna.titulo, nuevo));
          return r.ok ? null : r.errores.map((e) => e.mensaje).join(" ");
        },
      }),
    );
  };

  return (
    <Seccion titulo={`Datos · ${ids.length} ${def.titulo.toLowerCase()}`} valor="editable">
      <div className="py-1.5">
        <p className="nota">Lo que escriba va a los {ids.length}; «varios» es que no lo tienen igual.</p>
        {cols.map((c) => {
          const clave = c.columna.clave;
          const valor = borrador[clave] ?? c.valor ?? "";
          const err = errores[clave];
          const opciones = c.columna.opciones && !c.columna.calculada ? c.columna.opciones(ctx) : null;
          return (
            <label key={clave} className="campo">
              <span title={c.columna.ayuda}>
                {c.columna.titulo}
                {c.columna.unidad && opciones && <small>{c.columna.unidad}</small>}
              </span>
              {opciones ? (
                <select
                  className="sel"
                  value={c.valor === null ? VARIOS : valor}
                  data-error={!!err}
                  aria-label={c.columna.titulo}
                  aria-invalid={!!err}
                  onChange={(e) => {
                    setErrores({ ...errores, [clave]: "" });
                    if (c.columna.referencia && esDelGestor(e.target.value)) return gestor(c, e.target.value);
                    escribir(c, e.target.value);
                  }}
                >
                  {c.valor === null && <option value={VARIOS}>(varios)</option>}
                  {(c.valor === null ? opciones : conActual(opciones, valor)).map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.texto ?? o.valor}
                    </option>
                  ))}
                  {c.columna.referencia && <OpcionesGestor coleccion={c.columna.referencia} valor={c.valor ?? ""} />}
                </select>
              ) : (
                <span className="unidad" data-unidad={c.columna.unidad} style={c.columna.unidad ? ({ "--u": c.columna.unidad.length } as CSSProperties) : undefined}>
                  <input
                    value={valor}
                    placeholder={c.valor === null ? "(varios)" : c.columna.calculada ? undefined : "—"}
                    readOnly={c.columna.calculada}
                    data-error={!!err}
                    aria-label={c.columna.titulo}
                    aria-invalid={!!err}
                    onChange={(e) => {
                      setBorrador({ ...borrador, [clave]: e.target.value });
                      if (err) setErrores({ ...errores, [clave]: "" });
                    }}
                    onBlur={() => escribir(c)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") escribir(c);
                      if (e.key === "Escape") {
                        const { [clave]: _b, ...resto } = borrador;
                        setBorrador(resto);
                        setErrores({ ...errores, [clave]: "" });
                      }
                    }}
                  />
                </span>
              )}
              {err ? <p className="error">{err}</p> : c.columna.ayuda ? <p className="ayuda">{c.columna.ayuda}</p> : null}
            </label>
          );
        })}
      </div>
    </Seccion>
  );
}
