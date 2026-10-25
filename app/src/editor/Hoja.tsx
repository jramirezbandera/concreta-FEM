/**
 * Tablas del editor (V2a, `docs/fem3d/visor.md` §6.2): una hoja de cálculo densa por tipo de
 * objeto, enlazada con la planta (elegir una fila resalta el objeto, y elegirlo en la planta lleva a
 * su fila).
 *
 * Teclado como en una hoja de cálculo: flechas, Intro (editar y bajar), Tab, Esc (deshacer lo
 * escrito), F2, Supr (vaciar la celda) y escribir directamente. Ctrl+C copia las filas elegidas con
 * su cabecera (o la celda); Ctrl+V pega un bloque de Excel desde la celda activa (o por id, si trae
 * cabecera). La última fila es la nueva: el objeto se crea cuando tiene lo que necesita.
 *
 * Las columnas con opciones (las plantas, las secciones, la base…) se eligen en un desplegable: doble
 * clic, Intro, Alt+↓ o la flecha de la celda activa. F2 o escribir directamente, y pegar, siguen igual.
 *
 * Cada celda se lee y se escribe con las funciones puras de `src/editor/` (`tablas.ts`,
 * `edicion.ts`): lo que se ve es lo que se guarda, y un dato que no vale no entra (se dice por qué).
 */
import { memo, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ClipboardCopy, CopyPlus, Layers, Plus, Trash2 } from "lucide-react";
import type { Fila as FilaTexto } from "../../../src/editor/celdas.ts";
import { escribirTsv } from "../../../src/editor/celdas.ts";
import { proponerEjes } from "../../../src/compilador/ejes.ts";
import { operacionFila, pegar } from "../../../src/editor/edicion.ts";
import { comoUna } from "../../../src/editor/gestores.ts";
import { lista, type Objeto } from "../../../src/editor/referencias.ts";
import { DEF_TABLAS, TABLAS, conActual, contexto, filaConValor, objetosTabla, type NombreTabla, type Opcion } from "../../../src/editor/tablas.ts";
import type { Diagnostico } from "../../../src/motor/diagnosticos.ts";
import { useVisor } from "../contexto.ts";
import { DialogoBorrar, DialogoCopiar } from "./Dialogos.tsx";
import { abrirGestor, esDelGestor, OpcionesGestor, pedidoCampo, type ColeccionGestor } from "./referencia.tsx";

type Mensaje = { tono: "fail" | "ok" | "neu"; texto: string } | null;

interface FilaVista {
  id: string;
  objeto: Objeto;
  fila: FilaTexto;
}

/** Tablas que se pueden filtrar por la planta activa. */
const POR_PLANTA: ReadonlySet<NombreTabla> = new Set(["pilares", "vigas", "forjados", "muros", "apoyos", "apoyosLineales", "cargas"]);
const COPIABLES: ReadonlySet<NombreTabla> = new Set(["vigas", "forjados", "apoyos", "apoyosLineales", "cargas"]);
const CON_ORDEN: ReadonlySet<NombreTabla> = new Set(["plantas", "casos"]);

/** Peor severidad y mensajes de los diagnósticos de cada objeto. */
function diagnosticosPorObjeto(ds: readonly Diagnostico[]): Map<string, { sev: "f" | "w"; textos: string[] }> {
  const r = new Map<string, { sev: "f" | "w"; textos: string[] }>();
  for (const d of ds)
    for (const id of d.ids ?? []) {
      const x = r.get(id) ?? { sev: "w" as const, textos: [] };
      if (d.severidad === "error") x.sev = "f";
      x.textos.push(d.mensaje);
      r.set(id, x);
    }
  return r;
}

/**
 * Sin ejes en el proyecto, el dibujo usa los propuestos (I2, `src/compilador/ejes.ts`): esto los
 * guarda en el proyecto, de una vez y con un solo deshacer, para cambiarlos en la tabla.
 */
function EjesPropuestos() {
  const { proyecto } = useVisor();
  const ed = proyecto.edicion!;
  const propuestos = useMemo(() => proponerEjes(ed.proyecto.modelo).ejes, [ed.proyecto.modelo]);
  if (!propuestos.length) return <span className="text-[12px] text-text-secondary">Sin ejes: no hay alineaciones de pilares que proponer.</span>;
  return (
    <span className="flex items-center gap-2 text-[12px] text-text-secondary">
      El proyecto no tiene ejes: se dibujan {propuestos.length} propuestos.
      <button type="button" className="btn btn-p" onClick={() => ed.editar({ op: "lote", operaciones: propuestos.map((objeto) => ({ op: "crear", coleccion: "ejes", objeto: objeto as unknown as Objeto })) }, "Ejes propuestos")}>
        Guardarlos en el proyecto
      </button>
    </span>
  );
}

/** El desplegable abierto en la celda activa (sólo en una fila a la vez). */
interface DesplegableCelda {
  opciones: readonly Opcion[];
  /** GE: la lista de la que elige, para «Nueva…» y «Editar…» al final. */
  referencia?: ColeccionGestor;
  onElegir: (v: string) => void;
  onCerrar: () => void;
}

/**
 * El desplegable de una celda con opciones. Se abre solo; elegir escribe la celda, y Esc, Tab o
 * salir de él lo cierran sin tocarla.
 */
function Desplegable({ valor, etiqueta, d }: { valor: string; etiqueta: string; d: DesplegableCelda }) {
  const ref = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const s = ref.current;
    if (!s) return;
    s.focus();
    try {
      s.showPicker?.();
    } catch {
      // Sin gesto del usuario o sin soporte: queda enfocado, y Alt+↓ o Espacio lo abren
    }
  }, []);
  return (
    <select
      ref={ref}
      className="sel sel-celda"
      value={valor}
      aria-label={etiqueta}
      onChange={(e) => d.onElegir(e.target.value)}
      onKeyDown={(e) => {
        // El teclado es del desplegable, no de la hoja
        e.stopPropagation();
        if (e.key === "Escape") d.onCerrar();
        else if (e.key === "Tab") {
          e.preventDefault();
          d.onCerrar();
        } else if (e.key === "Enter" && e.target === e.currentTarget) {
          // Intro en el desplegable (no en una opción de la lista abierta): vale lo que tenga
          e.preventDefault();
          d.onElegir(e.currentTarget.value);
        }
      }}
      onBlur={(e) => {
        // Con la lista abierta, el foco pasa a sus opciones, que están dentro
        if (!e.currentTarget.contains(e.relatedTarget)) d.onCerrar();
      }}
    >
      {conActual(d.opciones, valor).map((o) => (
        <option key={o.valor} value={o.valor}>
          {o.texto ?? o.valor}
        </option>
      ))}
      {d.referencia && <OpcionesGestor coleccion={d.referencia} valor={valor} />}
    </select>
  );
}

/** Lo que va dentro de una celda: su texto (con la flecha del desplegable), el campo en el que se escribe, o el desplegable. */
function contenidoCelda(o: { texto: string; editando: string | null; etiqueta: string; desplegable: DesplegableCelda | null; flecha: boolean; onValor: (v: string) => void; onDesplegar: () => void }) {
  if (o.editando !== null) return o.desplegable ? <Desplegable valor={o.editando} etiqueta={o.etiqueta} d={o.desplegable} /> : <input autoFocus value={o.editando} onChange={(e) => o.onValor(e.target.value)} aria-label={o.etiqueta} />;
  if (!o.flecha) return o.texto;
  return (
    <>
      {o.texto}
      <button
        type="button"
        className="desplegar"
        tabIndex={-1}
        aria-label={`Elegir ${o.etiqueta}`}
        title="Elegir de la lista (Alt+↓)"
        // Se abre en el click: si se abriera en mousedown, el click caería en el desplegable y lo cerraría
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={o.onDesplegar}
      >
        <ChevronDown size={12} />
      </button>
    </>
  );
}

const FilaHoja = memo(function FilaHoja({
  vista,
  indice,
  claves,
  calculadas,
  aplica,
  faltan,
  conOpciones,
  sel,
  elegido,
  activa,
  editando,
  desplegable,
  error,
  diag,
  onCelda,
  onMarca,
  onEditar,
  onValor,
}: {
  vista: FilaVista;
  indice: number;
  claves: readonly string[];
  calculadas: readonly boolean[];
  /** ¿La columna aplica a la fila? (Forjados: según su tipo.) Lo que no aplica y está vacío se apaga. */
  aplica?: (clave: string, fila: FilaTexto) => boolean;
  /** En una fila pendiente (que cambia de tipo), lo que le falta para guardarse. */
  faltan?: ReadonlySet<string>;
  /** Columnas que se eligen en un desplegable. */
  conOpciones: readonly boolean[];
  sel: boolean;
  /** Elegido en las vistas o en el navegador (I2). */
  elegido: boolean;
  /** Columna activa en esta fila (−1 si no lo es). */
  activa: number;
  editando: string | null;
  desplegable: DesplegableCelda | null;
  error: boolean;
  diag: { sev: "f" | "w"; textos: string[] } | undefined;
  onCelda: (f: number, c: number, mayus: boolean) => void;
  onMarca: (f: number, mayus: boolean) => void;
  /** `desplegar`: con el desplegable, si la columna lo tiene. */
  onEditar: (f: number, c: number, inicial?: string, desplegar?: boolean) => void;
  onValor: (v: string) => void;
}) {
  return (
    <tr data-sel={sel} data-elegido={elegido} data-id={vista.id} data-pendiente={!!faltan}>
      <td className={`marca ${diag?.sev ?? ""}`} title={diag ? diag.textos.join("\n") : `Fila ${indice + 1}`} onClick={(e) => onMarca(indice, e.shiftKey)}>
        {diag ? (diag.sev === "f" ? "!" : "·") : indice + 1}
      </td>
      {claves.map((k, c) => (
        <td key={k} className={calculadas[c] ? "calc" : faltan?.has(k) ? "falta" : aplica && !vista.fila[k] && !aplica(k, vista.fila) ? "na" : undefined} data-activa={activa === c && !error} data-error={activa === c && error} title={vista.fila[k] || undefined} onMouseDown={(e) => onCelda(indice, c, e.shiftKey)} onDoubleClick={() => onEditar(indice, c, undefined, true)}>
          {contenidoCelda({
            texto: vista.fila[k] ?? "",
            editando: activa === c ? editando : null,
            etiqueta: `${vista.id} · ${k}`,
            desplegable: activa === c ? desplegable : null,
            flecha: activa === c && conOpciones[c]!,
            onValor,
            onDesplegar: () => onEditar(indice, c, undefined, true),
          })}
        </td>
      ))}
    </tr>
  );
});

/**
 * `nueva`: cada vez que cambia (y no es 0), el cursor va a la fila nueva de la tabla (las herramientas
 * Pilar, Viga… de la barra de Modelo).
 */
export function PanelTablas({ tabla, setTabla, nueva = 0, plantilla }: { tabla: NombreTabla; setTabla: (t: NombreTabla) => void; nueva?: number; plantilla?: Record<string, string> }) {
  const { proyecto, planta, seleccion, setSeleccion, elegidos, setElegidos } = useVisor();
  const ed = proyecto.edicion!;
  const elegidosS = useMemo(() => new Set(elegidos), [elegidos]);
  const m = ed.proyecto.modelo;
  const def = DEF_TABLAS[tabla];
  const cols = def.columnas;
  const claves = useMemo(() => cols.map((c) => c.clave), [cols]);
  const calculadas = useMemo(() => cols.map((c) => !!c.calculada), [cols]);
  const conOpciones = useMemo(() => cols.map((c) => !!c.opciones && !c.calculada), [cols]);
  const [soloPlanta, setSoloPlanta] = useState(true);
  const filtro = POR_PLANTA.has(tabla) && soloPlanta && planta ? planta : null;

  /**
   * Una fila que cambia de tipo (Forjados) y aún no tiene lo que necesita: se ve como queda y se
   * guarda en cuanto está completa (un objeto del modelo es siempre válido). Esc la deja como estaba.
   */
  const [pendiente, setPendiente] = useState<{ id: string; fila: FilaTexto } | null>(null);

  // Una fila por objeto, reutilizada mientras el objeto no cambie (aplicar conserva los que no toca)
  const cache = useRef(new WeakMap<Objeto, FilaTexto>());
  const filasModelo = useMemo<FilaVista[]>(() => {
    const ctx = contexto(m);
    const r: FilaVista[] = [];
    for (const o of objetosTabla(m, tabla)) {
      if (filtro) {
        const ps = def.plantas(o, ctx);
        if (ps !== null && !ps.includes(filtro)) continue;
      }
      // La cota de una planta depende de las demás: sin caché
      let f = tabla === "plantas" ? undefined : cache.current.get(o);
      if (!f) {
        f = def.fila(o, ctx);
        if (tabla !== "plantas") cache.current.set(o, f);
      }
      r.push({ id: o.id, objeto: o, fila: f });
    }
    return r;
  }, [m, def, filtro, tabla]);
  const filas = useMemo(() => (pendiente ? filasModelo.map((v) => (v.id === pendiente.id ? { ...v, fila: pendiente.fila } : v)) : filasModelo), [filasModelo, pendiente]);
  const faltanPendiente = useMemo(() => {
    if (!pendiente) return new Set<string>();
    const t = operacionFila(m, tabla, pendiente.id, pendiente.fila);
    return new Set(t.ok ? [] : t.errores.filter((e) => e.mensaje === "falta el dato").map((e) => e.columna ?? ""));
  }, [pendiente, m, tabla]);

  const [cursor, setCursor] = useState<{ f: number; c: number }>({ f: 0, c: 0 });
  const [ancla, setAncla] = useState<number | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  /** Se edita con el desplegable (no escribiendo). */
  const [desplegado, setDesplegado] = useState(false);
  const [error, setError] = useState(false);
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [dialogo, setDialogo] = useState<{ tipo: "borrar" | "copiar"; ids: string[] } | null>(null);
  const hoja = useRef<HTMLDivElement>(null);
  const nBorrador = filas.length;
  const f0 = Math.min(cursor.f, nBorrador);
  const c0 = Math.min(cursor.c, cols.length - 1);

  // Al cambiar de tabla o de filtro: cursor arriba, sin borrador ni edición
  useEffect(() => {
    setCursor({ f: 0, c: 0 });
    setAncla(null);
    setEditando(null);
    setDesplegado(false);
    setError(false);
    setBorrador({});
    setPendiente(null);
    setMensaje(null);
  }, [tabla, filtro]);

  // Elegido en la planta (o en el inspector): ir a su fila
  useEffect(() => {
    if (!seleccion) return;
    const i = filas.findIndex((x) => x.id === seleccion);
    if (i < 0 || i === f0) return;
    setCursor((x) => ({ ...x, f: i }));
    setAncla(null);
    hoja.current?.querySelector(`tr[data-id="${CSS.escape(seleccion)}"]`)?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo cuando cambia la selección
  }, [seleccion]);

  // Una herramienta de la barra pide la fila nueva
  useEffect(() => {
    if (!nueva) return;
    setCursor({ f: nBorrador, c: 0 });
    setAncla(null);
    // La herramienta que la pide puede dar ya algunas celdas (Empuje: el tipo)
    if (plantilla) setBorrador(plantilla);
    requestAnimationFrame(() => {
      hoja.current?.focus();
      hoja.current?.querySelector("tbody tr:last-child")?.scrollIntoView?.({ block: "nearest" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo cuando se pide
  }, [nueva]);

  const rango: [number, number] = ancla === null ? [f0, f0] : [Math.min(ancla, f0), Math.max(ancla, f0)];
  const elegidas = filas.slice(rango[0], Math.min(rango[1], nBorrador - 1) + 1).map((x) => x.id);

  const mover = (f: number, c: number, extender = false) => {
    const nf = Math.max(0, Math.min(nBorrador, f));
    const nc = Math.max(0, Math.min(cols.length - 1, c));
    if (extender) setAncla((a) => a ?? f0);
    else setAncla(null);
    setCursor({ f: nf, c: nc });
    setError(false);
    const id = filas[nf]?.id;
    if (extender) {
      // Mayús: lo elegido es el rango de filas, con la del cursor como principal
      const [a, b] = [Math.min(ancla ?? f0, nf), Math.max(ancla ?? f0, nf)];
      const ids = filas.slice(a, Math.min(b, nBorrador - 1) + 1).map((x) => x.id);
      if (id) setElegidos([...ids.filter((x) => x !== id), id]);
    } else if (id && id !== seleccion) setSeleccion(id);
    requestAnimationFrame(() => hoja.current?.querySelector(`tbody tr:nth-child(${nf + 1}) td:nth-child(${nc + 2})`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" }));
  };

  const textoCelda = (f: number, c: number) => (f === nBorrador ? (borrador[claves[c]!] ?? "") : (filas[f]?.fila[claves[c]!] ?? ""));

  /** Escribe un valor en una celda; false si no entra (y se sigue editando), "creado" si la fila nueva pasó a ser un objeto. */
  const escribir = (f: number, c: number, valor: string): boolean | "creado" => {
    const col = cols[c]!;
    if (col.calculada) return true;
    if (f === nBorrador) {
      const nb = filaConValor(def, borrador, col.clave, valor);
      setBorrador(nb);
      if (Object.values(nb).every((x) => x.trim() === "")) return true;
      const t = operacionFila(m, tabla, null, nb);
      if (!t.ok) {
        const faltan = t.errores.filter((e) => e.mensaje === "falta el dato").map((e) => cols.find((x) => x.clave === e.columna)?.titulo ?? e.columna);
        const otros = t.errores.filter((e) => e.mensaje !== "falta el dato");
        if (otros.some((e) => e.columna === col.clave)) {
          setMensaje({ tono: "fail", texto: `${col.titulo}: ${otros.find((e) => e.columna === col.clave)!.mensaje}` });
          return false;
        }
        setMensaje({ tono: "neu", texto: `Fila nueva: ${faltan.length ? `falta ${faltan.join(", ")}` : ""}${otros.length ? `${faltan.length ? "; " : ""}${otros.map((e) => `${e.columna}: ${e.mensaje}`).join("; ")}` : ""}.` });
        return true;
      }
      const r = ed.editar(t.operacion, `Nueva fila en ${def.titulo.toLowerCase()}`);
      if (!r.ok) {
        setMensaje({ tono: "fail", texto: r.errores.map((e) => e.mensaje).join(" ") });
        return true;
      }
      const nuevo = t.operacion.op === "crear" ? t.operacion.objeto.id : null;
      setBorrador({});
      setMensaje({ tono: "ok", texto: `Creado ${nuevo}.` });
      if (nuevo) setSeleccion(nuevo);
      return "creado";
    }
    const v = filas[f]!;
    if ((v.fila[col.clave] ?? "") === valor) return true;
    const nueva = filaConValor(def, v.fila, col.clave, valor);
    const t = operacionFila(m, tabla, v.id, nueva);
    if (!t.ok) {
      // Cambiar el tipo deja la fila a medias: queda pendiente hasta que tenga lo que necesita
      if (t.errores.every((e) => e.mensaje === "falta el dato") && ((col.clave === "tipo" && def.conValor) || pendiente?.id === v.id)) {
        setPendiente({ id: v.id, fila: nueva });
        const faltan = t.errores.map((e) => cols.find((x) => x.clave === e.columna)?.titulo ?? e.columna);
        setMensaje({ tono: "neu", texto: `${v.id}: falta ${faltan.join(", ")}. Se guarda en cuanto esté completa; Esc la deja como estaba.` });
        return true;
      }
      setMensaje({ tono: "fail", texto: t.errores.map((e) => `${cols.find((x) => x.clave === e.columna)?.titulo ?? e.columna ?? ""}: ${e.mensaje}`).join(" · ") });
      return false;
    }
    const r = ed.editar(t.operacion, `${v.id} · ${col.titulo} = ${valor || "(vacío)"}`);
    if (!r.ok) {
      setMensaje({ tono: "fail", texto: r.errores.map((e) => e.mensaje).join(" ") });
      return false;
    }
    setMensaje(pendiente?.id === v.id ? { tono: "ok", texto: `${t.operacion.op === "convertir" ? `${v.id} es ahora ${nueva.tipo}` : `${v.id} completa`}.` } : null);
    if (pendiente?.id === v.id) setPendiente(null);
    if ((t.operacion.op === "cambiar" || t.operacion.op === "convertir") && t.operacion.objeto.id !== v.id && seleccion === v.id) setSeleccion(t.operacion.objeto.id);
    return true;
  };

  /** Edita una celda: escribiendo (con `inicial`, lo tecleado) o, con `desplegar`, en su desplegable. */
  const empezar = (f: number, c: number, inicial?: string, desplegar = false) => {
    if (cols[c]?.calculada) return;
    setCursor({ f, c });
    setEditando(inicial ?? textoCelda(f, c));
    setDesplegado(desplegar && inicial === undefined && conOpciones[c]!);
    setError(false);
  };

  /** Cierra el desplegable sin escribir. */
  const cerrar = () => {
    setEditando(null);
    setDesplegado(false);
    hoja.current?.focus();
  };

  /** Lo elegido en el desplegable se escribe en la celda, y el cursor se queda en ella. */
  const elegir = (v: string) => {
    if (cols[c0]?.referencia && esDelGestor(v)) return gestor(f0, c0, v);
    const r = escribir(f0, c0, v);
    setEditando(null);
    setDesplegado(false);
    if (!r) setError(true);
    else if (r === "creado") setCursor({ f: nBorrador + 1, c: 0 });
    hoja.current?.focus();
  };

  /**
   * GE: «Nueva…» o «Editar…» abre el gestor. En una fila del modelo, lo que crea y la celda van en un
   * lote (un paso de deshacer); en la fila nueva, se crea y se escribe la celda, como al elegir.
   */
  const gestor = (f: number, c: number, eleccion: string) => {
    const col = cols[c]!;
    const v = f < nBorrador ? filas[f]! : null;
    cerrar();
    abrirGestor(
      pedidoCampo({
        coleccion: col.referencia!,
        eleccion,
        valor: (v ? v.fila : borrador)[col.clave] ?? "",
        tabla,
        clave: col.clave,
        fila: v ? v.fila : borrador,
        para: `${col.titulo} de ${v ? v.id : "la fila nueva"}`,
        alElegir: (nuevo, crear) => {
          if (!v) {
            if (crear.length) {
              const r = ed.editar(comoUna(crear), `Nueva ${col.referencia === "secciones" ? "sección" : "material"} ${nuevo}`);
              if (!r.ok) return r.errores.map((e) => e.mensaje).join(" ");
            }
            escribir(f, c, nuevo);
            return null;
          }
          const t = operacionFila(m, tabla, v.id, filaConValor(def, v.fila, col.clave, nuevo));
          if (!t.ok) return t.errores.map((e) => e.mensaje).join(" · ");
          const r = ed.editar(comoUna([...crear, t.operacion]), `${v.id} · ${col.titulo} = ${nuevo}`);
          return r.ok ? null : r.errores.map((e) => e.mensaje).join(" ");
        },
      }),
    );
  };

  const opcionesActiva = useMemo(() => (desplegado ? (cols[c0]?.opciones?.(contexto(m)) ?? null) : null), [desplegado, cols, c0, m]);
  const desplegable: DesplegableCelda | null = opcionesActiva ? { opciones: opcionesActiva, onElegir: elegir, onCerrar: cerrar, ...(cols[c0]?.referencia ? { referencia: cols[c0]!.referencia } : {}) } : null;

  const confirmar = (df: number, dc: number) => {
    if (editando === null) return;
    const r = escribir(f0, c0, editando);
    if (!r) {
      setError(true);
      return;
    }
    setEditando(null);
    setError(false);
    // Tras crear el objeto, a la fila nueva, que vuelve a ser la última
    if (r === "creado") setCursor({ f: nBorrador + 1, c: 0 });
    else mover(f0 + df, c0 + dc);
    hoja.current?.focus();
  };

  const teclas = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editando !== null) {
      if (e.key === "Enter") confirmar(e.shiftKey ? -1 : 1, 0);
      else if (e.key === "Tab") {
        e.preventDefault();
        confirmar(0, e.shiftKey ? -1 : 1);
      } else if (e.key === "Escape") {
        setEditando(null);
        setError(false);
        setMensaje(null);
        hoja.current?.focus();
      }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (e.altKey && e.key === "ArrowDown") {
      e.preventDefault();
      return empezar(f0, c0, undefined, true);
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        return mover(f0 + 1, c0, e.shiftKey);
      case "ArrowUp":
        e.preventDefault();
        return mover(f0 - 1, c0, e.shiftKey);
      case "ArrowRight":
        e.preventDefault();
        return mover(f0, c0 + 1);
      case "ArrowLeft":
        e.preventDefault();
        return mover(f0, c0 - 1);
      case "Tab":
        e.preventDefault();
        return mover(f0, c0 + (e.shiftKey ? -1 : 1));
      case "Home":
        return mover(mod ? 0 : f0, 0);
      case "End":
        return mover(mod ? nBorrador : f0, cols.length - 1);
      case "Enter":
        e.preventDefault();
        return empezar(f0, c0, undefined, true);
      case "F2":
        e.preventDefault();
        return empezar(f0, c0);
      case "Delete":
      case "Backspace":
        e.preventDefault();
        if (!escribir(f0, c0, "")) setError(true);
        return;
      case "Escape":
        setAncla(null);
        if (pendiente) {
          setMensaje({ tono: "neu", texto: `${pendiente.id} se queda como estaba.` });
          setPendiente(null);
        }
        return;
    }
    if (!mod && !e.altKey && e.key.length === 1) {
      e.preventDefault();
      empezar(f0, c0, e.key);
    }
  };

  const alPegar = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editando !== null) return;
    e.preventDefault();
    const texto = e.clipboardData.getData("text/plain");
    const t = pegar(m, tabla, texto, c0, { ids: filas.map((x) => x.id), fila: f0 });
    if (!t.ok) {
      setMensaje({ tono: "fail", texto: `No se pegó nada: ${t.errores.slice(0, 4).map((x) => `${x.fila ? `fila ${x.fila}` : ""}${x.columna ? ` · ${x.columna}` : ""}: ${x.mensaje}`).join(" · ")}${t.errores.length > 4 ? ` · y ${t.errores.length - 4} más` : ""}` });
      return;
    }
    const n = t.operacion.op === "lote" ? t.operacion.operaciones.length : 1;
    const r = ed.editar(t.operacion, `Pegar ${n} fila${n === 1 ? "" : "s"} en ${def.titulo.toLowerCase()}`);
    setMensaje(r.ok ? { tono: "ok", texto: `Pegadas ${n} filas.` } : { tono: "fail", texto: `No se pegó nada: ${r.errores.map((x) => x.mensaje).join(" ")}` });
  };

  const alCopiar = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editando !== null) return;
    e.preventDefault();
    if (ancla === null) e.clipboardData.setData("text/plain", textoCelda(f0, c0));
    else {
      const fs = filas.slice(rango[0], Math.min(rango[1], nBorrador - 1) + 1);
      e.clipboardData.setData("text/plain", escribirTsv([claves, ...fs.map((x) => claves.map((k) => x.fila[k] ?? ""))]));
      setMensaje({ tono: "ok", texto: `Copiadas ${fs.length} filas con su cabecera: péguelas en Excel, o aquí para cambiarlas por su id.` });
    }
  };

  const copiarTabla = () => {
    void navigator.clipboard.writeText(escribirTsv([claves, ...filas.map((x) => claves.map((k) => x.fila[k] ?? ""))])).then(
      () => setMensaje({ tono: "ok", texto: `Tabla copiada (${filas.length} filas, con cabecera).` }),
      () => setMensaje({ tono: "fail", texto: "El navegador no dejó copiar al portapapeles." }),
    );
  };

  const duplicar = () => {
    const v = filas[f0];
    if (!v) return;
    setBorrador({ ...v.fila, id: "" });
    mover(nBorrador, 1);
    setMensaje({ tono: "neu", texto: `Fila nueva copiada de ${v.id}: cambie lo que haga falta (el objeto se crea al escribir una celda).` });
  };

  const moverOrden = (d: -1 | 1) => {
    const v = filas[f0];
    if (!v) return;
    // Sólo en las tablas con orden (plantas y casos), que son de una colección
    const coleccion = def.colecciones[0]!;
    const todos = lista(m, coleccion).map((x) => x.id);
    const i = todos.indexOf(v.id);
    const j = i + d;
    if (j < 0 || j >= todos.length) return;
    const antesDe = d < 0 ? todos[j]! : (todos[j + 1] ?? null);
    const r = ed.editar({ op: "mover", coleccion, id: v.id, antesDe }, `Mover ${v.id}`);
    if (r.ok) setCursor({ f: f0 + d, c: c0 });
  };

  const diag = useMemo(() => diagnosticosPorObjeto(proyecto.estado?.diagnosticos ?? []), [proyecto.estado]);
  const col = cols[c0]!;
  const faltanBorrador = useMemo(() => {
    if (Object.values(borrador).every((x) => x.trim() === "")) return new Set<string>();
    const t = operacionFila(m, tabla, null, borrador);
    return new Set(t.ok ? [] : t.errores.filter((e) => e.mensaje === "falta el dato").map((e) => e.columna ?? ""));
  }, [borrador, m, tabla]);

  const contar = (t: NombreTabla) => objetosTabla(m, t).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border-main bg-bg-primary" aria-label="Tablas del modelo">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-sub bg-bg-surface px-2 py-1.5">
        <div className="seg max-w-full" style={{ overflowX: "auto" }} role="tablist" aria-label="Tabla">
          {TABLAS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={t === tabla} data-on={t === tabla} onClick={() => setTabla(t)}>
              {DEF_TABLAS[t].titulo} <span className="mono text-[10.5px] text-text-disabled">{contar(t)}</span>
            </button>
          ))}
        </div>
        {POR_PLANTA.has(tabla) && (
          <label className="chk" style={{ padding: 0 }}>
            <input type="checkbox" checked={soloPlanta} onChange={(e) => setSoloPlanta(e.target.checked)} /> sólo {planta ?? "la planta activa"}
          </label>
        )}
        {tabla === "ejes" && !m.ejes && <EjesPropuestos />}
        <span className="flex-1" />
        <button type="button" className="btn" onClick={() => mover(nBorrador, 0)} title="Ir a la fila nueva (la última)">
          <Plus size={13} /> Nueva
        </button>
        <button type="button" className="btn" onClick={duplicar} disabled={f0 >= nBorrador} title="Una fila nueva con los datos de la elegida">
          <CopyPlus size={13} /> Duplicar
        </button>
        {CON_ORDEN.has(tabla) && (
          <>
            <button type="button" className="btn" style={{ width: 28, padding: 0 }} onClick={() => moverOrden(-1)} disabled={f0 === 0 || f0 >= nBorrador} aria-label="Subir">
              <ArrowUp size={13} />
            </button>
            <button type="button" className="btn" style={{ width: 28, padding: 0 }} onClick={() => moverOrden(1)} disabled={f0 >= nBorrador - 1} aria-label="Bajar">
              <ArrowDown size={13} />
            </button>
          </>
        )}
        {COPIABLES.has(tabla) && (
          <button type="button" className="btn" onClick={() => setDialogo({ tipo: "copiar", ids: elegidas })} disabled={!elegidas.length} title="Copiar las filas elegidas a otras plantas">
            <Layers size={13} /> Copiar a plantas…
          </button>
        )}
        <button type="button" className="btn" onClick={() => setDialogo({ tipo: "borrar", ids: elegidas })} disabled={!elegidas.length} title="Borrar las filas elegidas">
          <Trash2 size={13} /> Borrar{elegidas.length > 1 ? ` ${elegidas.length}` : ""}
        </button>
        <button type="button" className="btn" onClick={copiarTabla} title="Copiar la tabla (con cabecera) para pegarla en Excel">
          <ClipboardCopy size={13} /> Copiar tabla
        </button>
      </div>

      <div ref={hoja} className="min-h-0 flex-1 overflow-auto outline-none" tabIndex={0} onKeyDown={teclas} onPaste={alPegar} onCopy={alCopiar} role="grid" aria-label={`Tabla de ${def.titulo.toLowerCase()}`} aria-rowcount={filas.length + 1}>
        <table className="hoja">
          <thead>
            <tr>
              <th className="marca" />
              {cols.map((c) => (
                <th key={c.clave} title={c.ayuda} className={c.clave === "nu" ? "nu" : undefined}>
                  {c.titulo}
                  <small>{c.unidad ?? " "}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((v, i) => (
              <FilaHoja
                key={v.id}
                vista={v}
                indice={i}
                claves={claves}
                calculadas={calculadas}
                aplica={def.aplica}
                faltan={pendiente?.id === v.id ? faltanPendiente : undefined}
                conOpciones={conOpciones}
                sel={i >= rango[0] && i <= rango[1]}
                elegido={elegidosS.has(v.id)}
                activa={i === f0 ? c0 : -1}
                editando={i === f0 ? editando : null}
                desplegable={i === f0 ? desplegable : null}
                error={i === f0 && error}
                diag={diag.get(v.id)}
                onCelda={(f, c, mayus) => {
                  if (editando !== null && !(f === f0 && c === c0)) {
                    if (desplegado) cerrar();
                    else confirmar(0, 0);
                  }
                  mover(f, c, mayus);
                }}
                onMarca={(f, mayus) => mover(f, c0, mayus)}
                onEditar={empezar}
                onValor={setEditando}
              />
            ))}
            <tr className="borrador" data-sel={f0 === nBorrador}>
              <td className="marca" title="Fila nueva: el objeto se crea cuando tiene lo que necesita">
                +
              </td>
              {cols.map((c, j) => (
                <td
                  key={c.clave}
                  className={`${c.calculada ? "calc" : ""} ${faltanBorrador.has(c.clave) ? "falta" : ""} ${def.aplica && !borrador[c.clave] && !def.aplica(c.clave, borrador) ? "na" : ""}`}
                  data-activa={f0 === nBorrador && c0 === j && !error}
                  data-error={f0 === nBorrador && c0 === j && error}
                  onMouseDown={() => {
                    if (editando !== null && desplegado && !(f0 === nBorrador && c0 === j)) cerrar();
                    mover(nBorrador, j);
                  }}
                  onDoubleClick={() => empezar(nBorrador, j, undefined, true)}
                >
                  {contenidoCelda({
                    texto: borrador[c.clave] ?? "",
                    editando: f0 === nBorrador && c0 === j ? editando : null,
                    etiqueta: `Fila nueva · ${c.clave}`,
                    desplegable: f0 === nBorrador && c0 === j ? desplegable : null,
                    flecha: f0 === nBorrador && c0 === j && conOpciones[j]!,
                    onValor: setEditando,
                    onDesplegar: () => empezar(nBorrador, j, undefined, true),
                  })}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className={`flex h-7 shrink-0 items-center gap-2 border-t border-border-sub px-3 text-[11.5px] ${mensaje?.tono === "fail" ? "text-state-fail" : mensaje?.tono === "ok" ? "text-state-ok" : "text-text-secondary"}`} role="status" aria-live="polite">
        <span className="min-w-0 flex-1 truncate" title={mensaje?.texto} data-mensaje-hoja>
          {mensaje ? (
            mensaje.texto
          ) : (
            <>
              <span className="font-medium text-text-primary">{col.titulo}</span>
              {col.unidad ? <span className="mono"> · {col.unidad}</span> : null}
              {col.ayuda ? ` · ${col.ayuda}` : ""}
            </>
          )}
        </span>
        <span className="kbd shrink-0">Intro editar o elegir · F2 escribir · Tab · Esc · Supr vaciar · Ctrl+C/V con Excel · Ctrl+Z</span>
      </div>

      {dialogo?.tipo === "borrar" && (
        <DialogoBorrar
          ids={dialogo.ids}
          onCerrar={(hecho) => {
            setDialogo(null);
            if (hecho) {
              setAncla(null);
              setMensaje({ tono: "ok", texto: hecho });
            }
            hoja.current?.focus();
          }}
        />
      )}
      {dialogo?.tipo === "copiar" && (
        <DialogoCopiar
          ids={dialogo.ids}
          onCerrar={(hecho) => {
            setDialogo(null);
            if (hecho) setMensaje({ tono: "ok", texto: hecho });
            hoja.current?.focus();
          }}
        />
      )}
    </div>
  );
}
