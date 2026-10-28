/**
 * El inspector como formulario del objeto elegido (V2a, §6.2): las columnas de su tabla, una por
 * línea, con su unidad, por grupos («Sección», «Material y peso»…). Se escribe igual que en la tabla
 * (Intro o salir del campo), con las mismas funciones puras: un dato que no vale no entra y se dice
 * por qué.
 *
 * Lo que ayuda a meter los datos (de la prueba de uso del 2026-10-28): lo obligatorio va marcado
 * con «*» y, vacío, lo dice el campo; un campo opcional vacío enseña lo que vale (`estadoCampos`); la
 * ayuda de cada campo sale en un globo al pasar el ratón por su «?» (`Ayuda`); y un forjado lleva su
 * croquis (`CroquisForjado.tsx`), enlazado con sus campos.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ComponentType, type ReactNode } from "react";
import { operacionFila } from "../../../src/editor/edicion.ts";
import { croquisForjado, estadoCampos, type EstadoCampo } from "../../../src/editor/ficha.ts";
import { comoUna } from "../../../src/editor/gestores.ts";
import { indiceIds } from "../../../src/editor/referencias.ts";
import { columnasComunes, operacionVarios, type ColumnaComun } from "../../../src/editor/varios.ts";
import { DEF_TABLAS, conActual, contexto, filaConValor, objetosTabla, tablaDeColeccion, type Columna, type NombreTabla } from "../../../src/editor/tablas.ts";
import type { Fila } from "../../../src/editor/celdas.ts";
import type { Contexto } from "../../../src/editor/tablas.ts";
import { Ayuda } from "../componentes/Ayuda.tsx";
import { Seccion } from "../componentes/comunes.tsx";
import { useVisor } from "../contexto.ts";
import { PlantaForjado, SeccionForjado } from "./CroquisForjado.tsx";
import { PesoForjado, RigidezAligeradoPanel } from "./FichaForjado.tsx";
import { abrirGestor, ARTICULO, esDelGestor, OpcionesGestor, pedidoCampo } from "./referencia.tsx";

/** Los grupos de campos de una tabla, en orden; lo que no está en ninguno va al final, sin título. */
const GRUPOS: Partial<Record<NombreTabla, readonly (readonly [string, readonly string[]])[]>> = {
  forjados: [
    ["General", ["id", "nombre", "planta", "tipo"]],
    ["Geometría en planta", ["contorno", "huecos", "abacos", "direccion"]],
    ["Sección", ["espesor", "intereje", "nervio", "capa", "caseton", "seccion", "bovedilla"]],
    ["Material y peso", ["material", "pp"]],
    ["Rigidez del aligerado", ["multiplicadores"]],
  ],
  casos: [
    ["El caso", ["id", "nombre", "pesoPropio"]],
    ["Para las combinaciones", ["tipo", "psi", "familia", "duracion"]],
    ["Según la acción", ["permanente", "direccion", "signo", "derivadoDe"]],
  ],
};

/** Las columnas por grupos (`GRUPOS`); una tabla sin grupos, un solo grupo sin título. */
function agrupar<T>(tabla: NombreTabla, cosas: readonly T[], clave: (x: T) => string): { titulo: string | null; cosas: T[] }[] {
  const g = GRUPOS[tabla];
  if (!g) return [{ titulo: null, cosas: [...cosas] }];
  const r = g.map(([titulo, claves]) => ({ titulo: titulo as string | null, cosas: claves.flatMap((k) => cosas.filter((x) => clave(x) === k)) }));
  const resto = cosas.filter((x) => !g.some(([, claves]) => claves.includes(clave(x))));
  if (resto.length) r.push({ titulo: null, cosas: resto });
  return r.filter((x) => x.cosas.length);
}

interface PropsCroquis {
  fila: Fila;
  ctx: Contexto;
  activo: string | null;
  onCampo: (clave: string) => void;
  /** Escribe un campo, como si se tecleara. */
  escribir: (clave: string, valor: string) => void;
  errores: Readonly<Record<string, string>>;
  rigidezReticular: "uniforme" | "bruta";
}

/** El dibujo (o la tabla) que encabeza un grupo de una tabla. */
const CROQUIS: Partial<Record<NombreTabla, Record<string, ComponentType<PropsCroquis>>>> = {
  forjados: {
    "Geometría en planta": ({ fila, ctx, activo, onCampo }) => <PlantaForjado c={croquisForjado(fila, ctx)} activo={activo} onCampo={onCampo} />,
    Sección: ({ fila, ctx, activo, onCampo }) => <SeccionForjado c={croquisForjado(fila, ctx)} activo={activo} onCampo={onCampo} />,
    "Material y peso": PesoForjado,
    "Rigidez del aligerado": ({ rigidezReticular, ...p }) => <RigidezAligeradoPanel {...p} rigidez={rigidezReticular} />,
  },
};

/** Los campos que no se enseñan como campo: los lleva el croquis de su grupo (los multiplicadores, en su tabla). */
const EN_CROQUIS: Partial<Record<NombreTabla, ReadonlySet<string>>> = { forjados: new Set(["multiplicadores"]) };

/** El nombre del campo: «*» si es obligatorio y «?» si tiene ayuda (en un globo, al pasar el ratón). */
function Etiqueta({ c, estado, conUnidad }: { c: Columna; estado?: EstadoCampo; conUnidad: boolean }) {
  return (
    <span>
      <span className="campo-nombre">
        {c.titulo}
        {estado?.obligatorio && (
          <b className="campo-oblig" title="obligatorio">
            *
          </b>
        )}
      </span>
      {c.unidad && conUnidad && <small>{c.unidad}</small>}
      {c.ayuda && <Ayuda texto={c.ayuda} />}
    </span>
  );
}

/** Los campos por grupos, con el croquis de cada grupo si lo tiene. */
function Grupos<T>({ tabla, cosas, clave, campo, croquis }: { tabla: NombreTabla; cosas: readonly T[]; clave: (x: T) => string; campo: (x: T) => ReactNode; croquis?: (grupo: string) => ReactNode }) {
  return (
    <>
      {agrupar(tabla, cosas, clave).map((g, i) => (
        <Fragment key={g.titulo ?? `g${i}`}>
          {g.titulo && <h3 className="campo-grupo">{g.titulo}</h3>}
          {g.titulo && croquis?.(g.titulo)}
          {g.cosas.map(campo)}
        </Fragment>
      ))}
    </>
  );
}

/** La tabla del editor de un objeto (null si no está en el proyecto: un eje propuesto). */
export function tablaDe(m: Parameters<typeof indiceIds>[0], id: string): NombreTabla | null {
  const c = indiceIds(m).get(id)?.coleccion;
  return c ? tablaDeColeccion(c) : null;
}

export function FormularioObjeto({ id, tabla }: { id: string; tabla: NombreTabla }) {
  const { proyecto, setSeleccion } = useVisor();
  const [foco, setFoco] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const caja = useRef<HTMLDivElement>(null);
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

  const estados = estadoCampos(def, actual, ctx, objeto);
  const Croquis = CROQUIS[tabla];
  /** Un clic en el croquis lleva al campo. */
  const irACampo = (clave: string) => caja.current?.querySelector<HTMLElement>(`[data-clave="${clave}"]`)?.focus();

  return (
    <Seccion titulo={`Datos · ${def.titulo.toLowerCase()}`}>
      <div className="form-datos" ref={caja}>
        {pendiente && (
          <p className="nota">
            {id} pasa a ser {actual.tipo}: falta lo marcado.{" "}
            <button type="button" className="text-accent hover:underline" onClick={() => (setBorrador({}), setErrores({}))}>
              Dejarlo como estaba
            </button>
          </p>
        )}
        <Grupos
          tabla={tabla}
          // Lo que no aplica al tipo (Forjados) no se enseña si está vacío
          cosas={def.columnas.filter((c) => !(def.aplica && !(borrador[c.clave] ?? fila[c.clave]) && !def.aplica(c.clave, actual)))}
          clave={(c) => c.clave}
          croquis={(g) => {
            const C = Croquis?.[g];
            return C && <C fila={actual} ctx={ctx} activo={sobre ?? foco} onCampo={irACampo} escribir={escribir} errores={errores} rigidezReticular={ed.proyecto.opciones?.rigidezReticular ?? "uniforme"} />;
          }}
          campo={(c) => {
              if (EN_CROQUIS[tabla]?.has(c.clave)) return null;
              const valor = borrador[c.clave] ?? fila[c.clave] ?? "";
              const err = errores[c.clave];
              const opciones = c.opciones && !c.calculada ? c.opciones(ctx) : null;
              const estado = estados[c.clave];
              const falta = !!estado?.obligatorio && !valor.trim();
              return (
                <label
                  key={c.clave}
                  className="campo"
                  data-activo={(sobre ?? foco) === c.clave || undefined}
                  onFocus={() => setFoco(c.clave)}
                  onBlur={() => setFoco(null)}
                  onMouseEnter={() => setSobre(c.clave)}
                  onMouseLeave={() => setSobre(null)}
                >
                  <Etiqueta c={c} estado={estado} conUnidad={!!opciones} />
                  {opciones ? (
                    <select
                      className="sel"
                      value={valor}
                      data-error={!!err}
                      data-falta={falta || undefined}
                      data-clave={c.clave}
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
                      placeholder={c.calculada ? undefined : estado?.obligatorio ? "obligatorio" : (estado?.defecto ?? "—")}
                      readOnly={c.calculada}
                      data-error={!!err}
                      data-falta={falta || undefined}
                      data-clave={c.clave}
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
                  {err && <p className="error">{err}</p>}
                </label>
              );
          }}
        />
        <p className="nota form-leyenda">
          <b className="campo-oblig">*</b> obligatorio. Un campo vacío dice en gris lo que vale.
        </p>
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
    <Seccion titulo={`Datos · ${ids.length} ${def.titulo.toLowerCase()}`}>
      <div className="form-datos">
        <p className="nota">Lo que escriba va a los {ids.length}; «varios» es que no lo tienen igual.</p>
        <Grupos
          tabla={tabla}
          cosas={cols}
          clave={(c) => c.columna.clave}
          campo={(c) => {
              const clave = c.columna.clave;
              const valor = borrador[clave] ?? c.valor ?? "";
              const err = errores[clave];
              const opciones = c.columna.opciones && !c.columna.calculada ? c.columna.opciones(ctx) : null;
              return (
                <label key={clave} className="campo">
                  <Etiqueta c={c.columna} conUnidad={!!opciones} />
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
                  {err && <p className="error">{err}</p>}
                </label>
              );
          }}
        />
      </div>
    </Seccion>
  );
}
