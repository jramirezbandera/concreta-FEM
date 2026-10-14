/**
 * El inspector como formulario del objeto elegido (V2a, §6.2): las columnas de su tabla, una por
 * línea, con su unidad y su ayuda a la vista. Se escribe igual que en la tabla (Intro o salir del
 * campo), con las mismas funciones puras: un dato que no vale no entra y se dice por qué.
 */
import { useEffect, useMemo, useState } from "react";
import { operacionFila } from "../../../src/editor/edicion.ts";
import { indiceIds } from "../../../src/editor/referencias.ts";
import { DEF_TABLAS, conActual, contexto, filaConValor, objetosTabla, tablaDeColeccion, type NombreTabla } from "../../../src/editor/tablas.ts";
import { Seccion } from "../componentes/comunes.tsx";
import { useVisor } from "../contexto.ts";

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
                {c.unidad && <small>{c.unidad}</small>}
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
                    escribir(c.clave, e.target.value);
                  }}
                >
                  {/* Un valor que no está entre las opciones (escrito en la tabla) se conserva */}
                  {conActual(opciones, valor).map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.texto ?? o.valor}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={valor}
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
              )}
              {err ? <p className="error">{err}</p> : c.ayuda ? <p className="ayuda">{c.ayuda}</p> : null}
            </label>
          );
        })}
      </div>
    </Seccion>
  );
}
