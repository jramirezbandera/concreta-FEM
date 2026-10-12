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
 * Cada celda se lee y se escribe con las funciones puras de `src/editor/` (`tablas.ts`,
 * `edicion.ts`): lo que se ve es lo que se guarda, y un dato que no vale no entra (se dice por qué).
 */
import { memo, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, ClipboardCopy, CopyPlus, Layers, Plus, Trash2 } from "lucide-react";
import type { Fila as FilaTexto } from "../../../src/editor/celdas.ts";
import { escribirTsv } from "../../../src/editor/celdas.ts";
import { operacionFila, pegar } from "../../../src/editor/edicion.ts";
import { lista, type Objeto } from "../../../src/editor/referencias.ts";
import { DEF_TABLAS, TABLAS, contexto, type NombreTabla } from "../../../src/editor/tablas.ts";
import type { Diagnostico } from "../../../src/motor/diagnosticos.ts";
import { useVisor } from "../contexto.ts";
import { DialogoBorrar, DialogoCopiar } from "./Dialogos.tsx";

type Mensaje = { tono: "fail" | "ok" | "neu"; texto: string } | null;

interface FilaVista {
  id: string;
  objeto: Objeto;
  fila: FilaTexto;
}

/** Tablas que se pueden filtrar por la planta activa. */
const POR_PLANTA: ReadonlySet<NombreTabla> = new Set(["pilares", "vigas", "losas", "apoyos", "cargas"]);
const COPIABLES: ReadonlySet<NombreTabla> = new Set(["vigas", "losas", "apoyos", "cargas"]);
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

const FilaHoja = memo(function FilaHoja({
  vista,
  indice,
  claves,
  calculadas,
  sel,
  activa,
  editando,
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
  sel: boolean;
  /** Columna activa en esta fila (−1 si no lo es). */
  activa: number;
  editando: string | null;
  error: boolean;
  diag: { sev: "f" | "w"; textos: string[] } | undefined;
  onCelda: (f: number, c: number, mayus: boolean) => void;
  onMarca: (f: number, mayus: boolean) => void;
  onEditar: (f: number, c: number) => void;
  onValor: (v: string) => void;
}) {
  return (
    <tr data-sel={sel} data-id={vista.id}>
      <td className={`marca ${diag?.sev ?? ""}`} title={diag ? diag.textos.join("\n") : `Fila ${indice + 1}`} onClick={(e) => onMarca(indice, e.shiftKey)}>
        {diag ? (diag.sev === "f" ? "!" : "·") : indice + 1}
      </td>
      {claves.map((k, c) => (
        <td key={k} className={calculadas[c] ? "calc" : undefined} data-activa={activa === c && !error} data-error={activa === c && error} title={vista.fila[k] || undefined} onMouseDown={(e) => onCelda(indice, c, e.shiftKey)} onDoubleClick={() => onEditar(indice, c)}>
          {activa === c && editando !== null ? <input autoFocus value={editando} onChange={(e) => onValor(e.target.value)} aria-label={`${vista.id} · ${k}`} /> : vista.fila[k]}
        </td>
      ))}
    </tr>
  );
});

/**
 * `nueva`: cada vez que cambia (y no es 0), el cursor va a la fila nueva de la tabla (las herramientas
 * Pilar, Viga… de la barra de Modelo).
 */
export function PanelTablas({ tabla, setTabla, nueva = 0 }: { tabla: NombreTabla; setTabla: (t: NombreTabla) => void; nueva?: number }) {
  const { proyecto, planta, seleccion, setSeleccion } = useVisor();
  const ed = proyecto.edicion!;
  const m = ed.proyecto.modelo;
  const def = DEF_TABLAS[tabla];
  const cols = def.columnas;
  const claves = useMemo(() => cols.map((c) => c.clave), [cols]);
  const calculadas = useMemo(() => cols.map((c) => !!c.calculada), [cols]);
  const [soloPlanta, setSoloPlanta] = useState(true);
  const filtro = POR_PLANTA.has(tabla) && soloPlanta && planta ? planta : null;

  // Una fila por objeto, reutilizada mientras el objeto no cambie (aplicar conserva los que no toca)
  const cache = useRef(new WeakMap<Objeto, FilaTexto>());
  const filas = useMemo<FilaVista[]>(() => {
    const ctx = contexto(m);
    const r: FilaVista[] = [];
    for (const o of lista(m, def.coleccion)) {
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

  const [cursor, setCursor] = useState<{ f: number; c: number }>({ f: 0, c: 0 });
  const [ancla, setAncla] = useState<number | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
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
    setError(false);
    setBorrador({});
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
    if (id && id !== seleccion) setSeleccion(id);
    requestAnimationFrame(() => hoja.current?.querySelector(`tbody tr:nth-child(${nf + 1}) td:nth-child(${nc + 2})`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" }));
  };

  const textoCelda = (f: number, c: number) => (f === nBorrador ? (borrador[claves[c]!] ?? "") : (filas[f]?.fila[claves[c]!] ?? ""));

  /** Escribe un valor en una celda; false si no entra (y se sigue editando), "creado" si la fila nueva pasó a ser un objeto. */
  const escribir = (f: number, c: number, valor: string): boolean | "creado" => {
    const col = cols[c]!;
    if (col.calculada) return true;
    if (f === nBorrador) {
      const nb = { ...borrador, [col.clave]: valor };
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
    const t = operacionFila(m, tabla, v.id, { ...v.fila, [col.clave]: valor });
    if (!t.ok) {
      setMensaje({ tono: "fail", texto: t.errores.map((e) => `${cols.find((x) => x.clave === e.columna)?.titulo ?? e.columna ?? ""}: ${e.mensaje}`).join(" · ") });
      return false;
    }
    const r = ed.editar(t.operacion, `${v.id} · ${col.titulo} = ${valor || "(vacío)"}`);
    if (!r.ok) {
      setMensaje({ tono: "fail", texto: r.errores.map((e) => e.mensaje).join(" ") });
      return false;
    }
    setMensaje(null);
    if (t.operacion.op === "cambiar" && t.operacion.objeto.id !== v.id && seleccion === v.id) setSeleccion(t.operacion.objeto.id);
    return true;
  };

  const empezar = (f: number, c: number, inicial?: string) => {
    if (cols[c]?.calculada) return;
    setCursor({ f, c });
    setEditando(inicial ?? textoCelda(f, c));
    setError(false);
  };

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
    const todos = lista(m, def.coleccion).map((x) => x.id);
    const i = todos.indexOf(v.id);
    const j = i + d;
    if (j < 0 || j >= todos.length) return;
    const antesDe = d < 0 ? todos[j]! : (todos[j + 1] ?? null);
    const r = ed.editar({ op: "mover", coleccion: def.coleccion, id: v.id, antesDe }, `Mover ${v.id}`);
    if (r.ok) setCursor({ f: f0 + d, c: c0 });
  };

  const diag = useMemo(() => diagnosticosPorObjeto(proyecto.estado?.diagnosticos ?? []), [proyecto.estado]);
  const col = cols[c0]!;
  const faltanBorrador = useMemo(() => {
    if (Object.values(borrador).every((x) => x.trim() === "")) return new Set<string>();
    const t = operacionFila(m, tabla, null, borrador);
    return new Set(t.ok ? [] : t.errores.filter((e) => e.mensaje === "falta el dato").map((e) => e.columna ?? ""));
  }, [borrador, m, tabla]);

  const contar = (t: NombreTabla) => lista(m, DEF_TABLAS[t].coleccion).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border-main bg-bg-primary" aria-label="Tablas del modelo">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-sub bg-bg-surface px-2 py-1.5">
        <div className="seg" role="tablist" aria-label="Tabla">
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
                sel={i >= rango[0] && i <= rango[1]}
                activa={i === f0 ? c0 : -1}
                editando={i === f0 ? editando : null}
                error={i === f0 && error}
                diag={diag.get(v.id)}
                onCelda={(f, c, mayus) => {
                  if (editando !== null && !(f === f0 && c === c0)) confirmar(0, 0);
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
                <td key={c.clave} className={`${c.calculada ? "calc" : ""} ${faltanBorrador.has(c.clave) ? "falta" : ""}`} data-activa={f0 === nBorrador && c0 === j && !error} data-error={f0 === nBorrador && c0 === j && error} onMouseDown={() => mover(nBorrador, j)} onDoubleClick={() => empezar(nBorrador, j)}>
                  {f0 === nBorrador && c0 === j && editando !== null ? <input autoFocus value={editando} onChange={(e) => setEditando(e.target.value)} aria-label={`Fila nueva · ${c.clave}`} /> : (borrador[c.clave] ?? "")}
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
        <span className="kbd shrink-0">Intro editar · Tab · Esc · Supr vaciar · Ctrl+C/V con Excel · Ctrl+Z</span>
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
