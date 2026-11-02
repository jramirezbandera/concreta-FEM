/**
 * Diálogos del editor (V2a): borrar (si otros objetos usan lo que se borra, se dice cuáles y se
 * elige entre borrarlos también o pasarlos a otro), copiar a otras plantas, renumerar (I-g) y
 * los ábacos en los pilares de un reticular.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { copiarAPlantas, objetosDePlanta } from "../../../src/editor/edicion.ts";
import { operacionAbacos, proponerAbacos } from "../../../src/editor/abacos.ts";
import { operacionVigasBorde, proponerVigasBorde, vigasDelBorde } from "../../../src/editor/vigasBorde.ts";
import { aplicar, nombreColeccion } from "../../../src/editor/operaciones.ts";
import { COLECCIONES, indiceIds, lista } from "../../../src/editor/referencias.ts";
import { leerNumero } from "../../../src/editor/celdas.ts";
import { PREFIJOS, propuestaPlantas, renumerar, RENUMERABLES } from "../../../src/editor/renumerar.ts";
import type { ModeloFisico } from "../../../src/compilador/fisico.ts";
import { useVisor } from "../contexto.ts";
import { plural } from "../fmt.ts";

const total = (m: ModeloFisico) => COLECCIONES.reduce((n, c) => n + lista(m, c).length, 0);

/**
 * `clase`: otra forma de la caja (el gestor de GE, más ancho y con dos columnas).
 *
 * Esc cierra el de encima aunque el foco no esté dentro (GE1-1: tras pulsar un botón que cambia o
 * desaparece, el foco se va al `body`). Se escucha en la ventana, en la fase de captura, y no sigue:
 * así no suelta también lo elegido ni anula la herramienta de dibujo.
 */
const ENFOCABLES = 'button:not(:disabled), [href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * El foco de un diálogo (UI-54): al abrirse va dentro (a lo marcado con `autoFocus`, o al primer
 * campo), Tab no sale de él y al cerrarse vuelve a donde estaba.
 */
function useFocoDialogo(caja: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    const c = caja.current;
    if (c && !c.contains(document.activeElement)) {
      const primero = c.querySelector<HTMLElement>(".dialogo-cuerpo input:not(:disabled), .dialogo-cuerpo select:not(:disabled), .dialogo-cuerpo textarea:not(:disabled)") ?? c.querySelector<HTMLElement>(ENFOCABLES);
      primero?.focus();
    }
    const tab = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !c) return;
      const abiertos = document.querySelectorAll(".dialogo");
      if (abiertos[abiertos.length - 1] !== c) return;
      const t = [...c.querySelectorAll<HTMLElement>(ENFOCABLES)].filter((x) => x.offsetParent !== null || x === document.activeElement);
      if (!t.length) return;
      const [a, z] = [t[0]!, t[t.length - 1]!];
      if (!c.contains(document.activeElement)) {
        e.preventDefault();
        a.focus();
      } else if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    window.addEventListener("keydown", tab, true);
    return () => {
      window.removeEventListener("keydown", tab, true);
      if (antes && antes.isConnected && antes !== document.body) antes.focus();
    };
  }, [caja]);
}

/**
 * `pendiente` (UI-30): lo que se perdería al cerrar (los cambios de una ficha sin aplicar). Con él,
 * cerrar (Esc, la cruz o el fondo) pregunta antes. `fondoCierra: false`, un clic en el fondo no
 * cierra (los gestores: se perdía lo escrito con un clic fuera).
 *
 * `alConfirmar` (C-36): la acción del botón primario, que también hace Intro en un campo del
 * cuerpo (no en un botón, un desplegable o un texto de varias líneas, ni si el campo ya lo usa).
 */
export function Dialogo({ titulo, children, pie, onCerrar, clase, pendiente = null, fondoCierra = true, alConfirmar }: { titulo: string; children: React.ReactNode; pie: React.ReactNode; onCerrar: () => void; clase?: string; pendiente?: string | null; fondoCierra?: boolean; alConfirmar?: () => void }) {
  const fondo = useRef<HTMLDivElement>(null);
  const caja = useRef<HTMLDivElement>(null);
  const [preguntando, setPreguntando] = useState(false);
  const intentar = () => (pendiente ? setPreguntando(true) : onCerrar());
  const cerrar = useRef(intentar);
  cerrar.current = intentar;
  useFocoDialogo(caja);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const abiertos = document.querySelectorAll(".dialogo-fondo");
      if (abiertos[abiertos.length - 1] !== fondo.current) return;
      e.preventDefault();
      e.stopPropagation();
      cerrar.current();
    };
    window.addEventListener("keydown", tecla, true);
    return () => window.removeEventListener("keydown", tecla, true);
  }, []);
  return (
    <div ref={fondo} className="dialogo-fondo" onMouseDown={(e) => fondoCierra && e.target === e.currentTarget && intentar()}>
      <div ref={caja} className={clase ? `dialogo ${clase}` : "dialogo"} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="dialogo-cab">
          <h2>{titulo}</h2>
          <button type="button" className="ib" style={{ width: 28, height: 28 }} aria-label="Cerrar" title="Cerrar (Esc)" onClick={intentar}>
            <X size={16} />
          </button>
        </div>
        <div
          className="dialogo-cuerpo"
          onKeyDown={(e) => {
            const t = e.target as HTMLElement;
            if (!alConfirmar || e.key !== "Enter" || e.defaultPrevented || e.shiftKey || e.ctrlKey || e.altKey || t.tagName !== "INPUT" || ["button", "submit", "file"].includes((t as HTMLInputElement).type)) return;
            e.preventDefault();
            alConfirmar();
          }}
        >
          {children}
        </div>
        {preguntando && pendiente ? (
          <div className="pie pie-pregunta" role="alertdialog" aria-label="Cambios sin aplicar">
            <span className="mr-auto text-[13px]">{pendiente} Si cierra, se pierden.</span>
            <button type="button" className="btn" autoFocus onClick={() => setPreguntando(false)}>
              Seguir editando
            </button>
            <button type="button" className="btn btn-peligro" onClick={onCerrar}>
              Cerrar sin aplicar
            </button>
          </div>
        ) : (
          <div className="pie">{pie}</div>
        )}
      </div>
    </div>
  );
}

/** Lo que otros objetos usan sin ser suyo: al borrarlo, lo natural es pasar a otro lo que lo usa. */
const RECURSOS: ReadonlySet<string> = new Set(["secciones", "materiales", "casos"]);

export function DialogoBorrar({ ids: elegidos, onCerrar }: { ids: string[]; onCerrar: (hecho?: string) => void }) {
  const { proyecto, seleccion, setSeleccion } = useVisor();
  const ed = proyecto.edicion!;
  const p = ed.proyecto;
  // Las vigas que se quedan sin forjado (los zunchos de su borde), marcadas para borrarlas con él (UI-34)
  const borde = useMemo(() => vigasDelBorde(p.modelo, elegidos), [p, elegidos]);
  const [conBorde, setConBorde] = useState(true);
  const ids = useMemo(() => (conBorde && borde.length ? [...elegidos, ...borde] : elegidos), [conBorde, borde, elegidos]);
  const prueba = useMemo(() => aplicar(p, { op: "borrar", ids }), [p, ids]);
  const usos = !prueba.ok ? (prueba.usos ?? []) : [];
  const usados = useMemo(() => [...new Set(usos.map((u) => u.usa))], [usos]);
  const idx = useMemo(() => indiceIds(p.modelo), [p]);
  const cascada = useMemo(() => {
    const r = aplicar(p, { op: "borrar", ids, dependientes: "borrar" });
    return r.ok ? total(p.modelo) - total(r.proyecto.modelo) : null;
  }, [p, ids]);
  const borrados = new Set(ids);
  const candidatos = (id: string) => {
    const c = idx.get(id)?.coleccion;
    return c ? lista(p.modelo, c).filter((o) => !borrados.has(o.id)).map((o) => o.id) : [];
  };
  // Lo de por defecto, según qué se borra (UI-5). Una sección, un material o un caso: pasar a otro lo
  // que lo usa. Una pieza: lo que la usa (sus cargas) es suyo y va con ella; pasarlo a otra llevaría las
  // cargas de un forjado al de otra planta. Una planta, o una mezcla: nada, que se elija. El foco va a
  // Cancelar, así que un Intro reflejo no borra nada.
  const [modo, setModo] = useState<"borrar" | "reasignar" | null>(() => {
    const de = usados.map((u) => idx.get(u)?.coleccion);
    if (!de.length) return null;
    if (de.every((c) => c && RECURSOS.has(c)) && usados.every((u) => candidatos(u).length)) return "reasignar";
    if (de.every((c) => c && !RECURSOS.has(c) && c !== "plantas")) return "borrar";
    return null;
  });
  const [destino, setDestino] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const hacer = () => {
    const op = usos.length === 0 ? ({ op: "borrar", ids } as const) : modo === "borrar" ? ({ op: "borrar", ids, dependientes: "borrar" } as const) : ({ op: "borrar", ids, dependientes: { reasignar: Object.fromEntries(usados.map((u) => [u, destino[u] ?? candidatos(u)[0] ?? ""])) } } as const);
    const r = ed.editar(op, `Borrar ${ids.length > 3 ? `${ids.length} objetos` : ids.join(", ")}`);
    if (!r.ok) return setError(r.errores.map((e) => e.mensaje).join(" "));
    if (seleccion && !indiceIds(r.proyecto.modelo).has(seleccion)) setSeleccion(null);
    onCerrar(usos.length === 0 || modo === "reasignar" ? `Borrado ${ids.join(", ")}.` : `Borrado ${ids.join(", ")} y ${plural((cascada ?? ids.length) - ids.length, "objeto")} que lo usaba${(cascada ?? ids.length) - ids.length === 1 ? "" : "n"}.`);
  };

  const porObjeto = new Map<string, string[]>();
  for (const u of usos) porObjeto.set(u.id, [...(porObjeto.get(u.id) ?? []), `${u.ruta.join(".")} = ${u.usa}`]);

  return (
    <Dialogo
      titulo={`Borrar ${elegidos.length > 3 ? `${elegidos.length} objetos` : elegidos.join(", ")}`}
      onCerrar={() => onCerrar()}
      pie={
        <>
          <button type="button" className="btn" autoFocus={usos.length > 0} onClick={() => onCerrar()}>
            Cancelar
          </button>
          <button type="button" className="btn btn-peligro" autoFocus={usos.length === 0} onClick={hacer} disabled={usos.length > 0 && (modo === null || (modo === "reasignar" && usados.some((u) => candidatos(u).length === 0)))}>
            {usos.length > 0 && modo === "borrar" && cascada !== null ? `Borrar ${plural(cascada, "objeto")}` : "Borrar"}
          </button>
        </>
      }
    >
      {borde.length > 0 && (
        <label className="opcion">
          <input type="checkbox" checked={conBorde} onChange={(e) => setConBorde(e.target.checked)} />
          <span>
            Borrar también {borde.length === 1 ? "la viga" : `las ${borde.length} vigas`} de su borde, que se {borde.length === 1 ? "queda" : "quedan"} sin forjado
            <small className="mono">{borde.join(", ")}</small>
          </span>
        </label>
      )}
      {usos.length === 0 ? (
        <p>
          Nada más usa {ids.length > 1 ? "estos objetos" : "este objeto"}. <span className="text-text-secondary">Se puede deshacer con Ctrl+Z.</span>
        </p>
      ) : (
        <>
          <p>
            {porObjeto.size} objeto{porObjeto.size > 1 ? "s usan" : " usa"} lo que se borra:
          </p>
          <ul className="dlg-lista">
            {[...porObjeto].map(([id, rs]) => (
              <li key={id}>
                {nombreColeccion(idx.get(id)!.coleccion)} {id} <span className="text-text-muted">({rs.join("; ")})</span>
              </li>
            ))}
          </ul>
          <label className="opcion">
            <input type="radio" name="modo" checked={modo === "borrar"} onChange={() => setModo("borrar")} />
            <span>
              Borrarlos también
              {cascada !== null && <small>En total se {cascada === 1 ? "borra" : "borran"} {plural(cascada, "objeto")}; de un pilar con varios tramos, sólo el tramo que lo usa.</small>}
            </span>
          </label>
          <label className="opcion">
            <input type="radio" name="modo" checked={modo === "reasignar"} onChange={() => setModo("reasignar")} />
            <span>
              Pasarlos a otro
              <small>Lo que los usa pasa a usar el que elija.</small>
            </span>
          </label>
          {modo === "reasignar" &&
            usados.map((u) => (
              <label key={u} className="ml-7 mt-2 flex items-center gap-2">
                <span className="mono w-28 truncate">{u} →</span>
                <select className="sel flex-1" value={destino[u] ?? candidatos(u)[0] ?? ""} onChange={(e) => setDestino({ ...destino, [u]: e.target.value })}>
                  {candidatos(u).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            ))}
        </>
      )}
      {error && <p className="mt-2 text-state-fail">{error}</p>}
    </Dialogo>
  );
}

export function DialogoCopiar({ ids, onCerrar }: { ids: string[]; onCerrar: (hecho?: string) => void }) {
  const { proyecto, planta } = useVisor();
  const ed = proyecto.edicion!;
  const m = ed.proyecto.modelo;
  const [entera, setEntera] = useState(false);
  const [destinos, setDestinos] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const todos = planta ? objetosDePlanta(m, planta) : [];
  const copiar = entera ? todos : ids;
  // Lo que hará, antes de pulsar: cuántos crea y lo que se salta porque ya está (UI-6)
  const prueba = useMemo(() => (destinos.size && copiar.length ? copiarAPlantas(m, copiar, [...destinos]) : null), [m, copiar, destinos]);
  // P-21: el error de «Copiar» era de las opciones de antes: se quita al cambiarlas
  useEffect(() => setError(null), [entera, destinos]);
  const n = prueba?.ok ? (prueba.operacion.op === "lote" ? prueba.operacion.operaciones.length : 1) : 0;

  const hacer = () => {
    if (!prueba) return;
    if (!prueba.ok) return setError(prueba.errores.map((e) => e.mensaje).join(" "));
    const r = ed.editar(prueba.operacion, `Copiar ${plural(copiar.length, "objeto")} a ${[...destinos].join(", ")}`);
    if (!r.ok) return setError(r.errores.map((e) => e.mensaje).join(" "));
    onCerrar(`${n === 1 ? "Creado" : "Creados"} ${plural(n, "objeto")} en ${[...destinos].join(", ")}.${prueba.avisos ? ` ${prueba.avisos.join(" ")}` : ""}`);
  };

  return (
    <Dialogo
      titulo="Copiar a otras plantas"
      onCerrar={() => onCerrar()}
      alConfirmar={() => prueba?.ok && hacer()}
      pie={
        <>
          <button type="button" className="btn" onClick={() => onCerrar()}>
            Cancelar
          </button>
          <button type="button" className="btn btn-p" onClick={hacer} disabled={!prueba?.ok}>
            {n ? `Copiar ${n} ${n === 1 ? "objeto" : "objetos"}` : "Copiar"}
          </button>
        </>
      }
    >
      <div className="dlg-et" style={{ marginTop: 4 }}>Qué se copia</div>
      <label className="opcion">
        <input type="radio" name="copiar-que" checked={!entera} onChange={() => setEntera(false)} />
        <span>
          Lo elegido <span className="mono text-text-secondary">· {ids.length > 6 ? `${ids.slice(0, 6).join(", ")}… (${ids.length})` : ids.join(", ")}</span>
        </span>
      </label>
      <label className="opcion">
        <input type="radio" name="copiar-que" checked={entera} onChange={() => setEntera(true)} disabled={!planta} />
        <span>
          Toda la planta {planta} <span className="mono text-text-secondary">· {plural(todos.length, "objeto")}</span>
          <small>Vigas, forjados, apoyos, apoyos lineales y sus cargas.</small>
        </span>
      </label>
      <div className="dlg-et">A las plantas</div>
      <div className="fichas-plantas">
        {m.plantas.map((x) => (
          <label key={x.id} className="ficha" title={x.nombre}>
            <input
              type="checkbox"
              checked={destinos.has(x.id)}
              onChange={(e) => {
                const d = new Set(destinos);
                if (e.target.checked) d.add(x.id);
                else d.delete(x.id);
                setDestinos(d);
              }}
            />
            {x.id}
            {x.id === planta && <small>esta</small>}
          </label>
        ))}
      </div>
      <p className="dlg-nota">Los ids nuevos llevan la planta de destino. Las cargas van a la copia de su viga o su forjado, o a la pieza igual que ya esté en el mismo sitio. Lo que ya está no se duplica. Los pilares y los muros no se copian: se alargan con su «desde» y su «hasta».</p>
      {prueba && !prueba.ok && <p className="mt-2 text-state-fail">{prueba.errores.map((e) => e.mensaje).join(" ")}</p>}
      {prueba?.ok && prueba.avisos && <p className="dlg-nota">{prueba.avisos.join(" ")}</p>}
      {error && <p className="mt-2 text-state-fail">{error}</p>}
    </Dialogo>
  );
}

/** Renumerar como CYPECAD (I-g, `interfaz.md` §12.1): dice qué cambia antes de hacerlo. */
export function DialogoRenumerar({ onCerrar }: { onCerrar: (hecho?: string) => void }) {
  const { proyecto, seleccion, setSeleccion, elegidos, setElegidos } = useVisor();
  const ed = proyecto.edicion!;
  const m = ed.proyecto.modelo;
  // M-15: también las plantas numeradas (N1, N2… de abajo arriba), si hay alguna fuera de su orden
  const hayPlantas = useMemo(() => propuestaPlantas(m).size > 0, [m]);
  const [plantas, setPlantas] = useState(true);
  const conPlantas = hayPlantas && plantas;
  const { mapa, reordena } = useMemo(() => renumerar(m, undefined, {}, conPlantas), [m, conPlantas]);
  const cambia = mapa.size > 0 || reordena;
  const idx = useMemo(() => indiceIds(m), [m]);
  const [error, setError] = useState<string | null>(null);
  const porColeccion = [...RENUMERABLES, "plantas" as const].map((c) => ({ c, n: [...mapa.keys()].filter((id) => idx.get(id)?.coleccion === c).length })).filter((x) => x.n > 0);
  const ejemplos = [...mapa].slice(0, 8);

  const hacer = () => {
    const r = ed.editar({ op: "renumerar", ...(conPlantas ? { plantas: true } : {}) }, "Renumerar");
    if (!r.ok) return setError(r.errores.map((e) => e.mensaje).join(" "));
    const nuevo = (id: string) => mapa.get(id) ?? id;
    if (elegidos.length) setElegidos(elegidos.map(nuevo));
    else if (seleccion) setSeleccion(nuevo(seleccion));
    onCerrar(mapa.size ? `${mapa.size === 1 ? "Renumerado" : "Renumerados"} ${plural(mapa.size, "objeto")}.` : "Pilares ordenados.");
  };

  return (
    <Dialogo
      titulo="Renumerar"
      onCerrar={() => onCerrar()}
      pie={
        <>
          <button type="button" className="btn" onClick={() => onCerrar()}>
            {cambia ? "Cancelar" : "Cerrar"}
          </button>
          <button type="button" className="btn btn-p" autoFocus onClick={hacer} disabled={!cambia}>
            Renumerar
          </button>
        </>
      }
    >
      <p>
        Pilares <span className="mono">{PREFIJOS.pilares}1…</span>, vigas <span className="mono">{PREFIJOS.vigas}1…</span>, barras <span className="mono">{PREFIJOS.barras}1…</span>, forjados <span className="mono">{PREFIJOS.losas}1…</span> (los unidireccionales, <span className="mono">{PREFIJOS.panos}1…</span>) y muros <span className="mono">{PREFIJOS.muros}1…</span>, por filas de arriba abajo y de izquierda a derecha (las vigas, barras, forjados y muros, por plantas de abajo arriba). La tabla de pilares queda en ese orden.
      </p>
      {hayPlantas && (
        <label className="mt-2 flex items-start gap-2">
          <input type="checkbox" className="mt-[3px]" checked={plantas} onChange={(e) => setPlantas(e.target.checked)} />
          <span>También las plantas numeradas, de abajo arriba con los mismos números (una añadida entre N2 y N3 se llama N4: quedaría N3, y la de encima, N4). Cim, PB y las demás no cambian.</span>
        </label>
      )}
      {!cambia ? (
        <p className="mt-2">Ya están numerados así: no cambia nada.</p>
      ) : mapa.size === 0 ? (
        <p className="mt-2">Los ids ya están así; sólo se ordena la lista de pilares. No cambia la huella.</p>
      ) : (
        <>
          <p className="mt-2">
            Cambian {porColeccion.map((x) => `${x.n} ${nombreColeccion(x.c)}${x.n > 1 ? (/[aeiou]$/.test(nombreColeccion(x.c)) ? "s" : "es") : ""}`).join(", ")}:
          </p>
          <ul className="dlg-lista">
            {ejemplos.map(([a, b]) => (
              <li key={a}>
                {a} → {b}
              </li>
            ))}
            {mapa.size > ejemplos.length && <li className="text-text-muted">… y {mapa.size - ejemplos.length} más</li>}
          </ul>
          <p className="dlg-nota">Las cargas y demás referencias siguen a su objeto. Cambia la huella, así que hay que volver a calcular. Se puede deshacer con Ctrl+Z.</p>
        </>
      )}
      {error && <p className="mt-2 text-state-fail">{error}</p>}
    </Dialogo>
  );
}


const coma = (x: number) => String(Math.round(x * 1000) / 1000).replace(".", ",");
/**
 * Un número de un campo de estos diálogos (C-35): con coma o punto y espacios entre las cifras, como
 * en la hoja; vacío es «falta», no 0. El texto, si no vale.
 */
const numero = (s: string): number | string => (s.trim() === "" ? "falta" : leerNumero(s));
/** Lo que falla de los campos (`[nombre, leído]`), en una frase; null si todos son números. */
const malos = (campos: [string, number | string][]): string | null => {
  const m = campos.filter((c): c is [string, string] => typeof c[1] === "string");
  return m.length ? m.map(([k, e]) => `${k}: ${e}.`).join(" ") : null;
};

/**
 * Ábacos en los pilares de un forjado reticular (decisión del usuario, 2026-10-13): dice qué crea
 * antes de hacerlo. Los ábacos quedan como polígonos en la tabla Forjados.
 */
export function DialogoAbacos({ onCerrar }: { onCerrar: (hecho?: string) => void }) {
  const { proyecto, planta, seleccion } = useVisor();
  const ed = proyecto.edicion!;
  const m = ed.proyecto.modelo;
  const reticulares = (m.losas ?? []).filter((l) => l.reticular);
  const inicial = reticulares.find((l) => l.id === seleccion) ?? reticulares.find((l) => l.planta === planta) ?? reticulares[0];
  const [losa, setLosa] = useState(inicial?.id ?? "");
  const [a, setA] = useState("2,4");
  const [b, setB] = useState("2,4");
  const [error, setError] = useState<string | null>(null);
  const [na, nb] = [numero(a), numero(b)];
  const p = useMemo(() => {
    const mal = malos([["Según los nervios", na], ["En perpendicular", nb]]);
    if (!losa) return { error: "No hay ningún forjado reticular." };
    return mal || typeof na === "string" || typeof nb === "string" ? { error: mal ?? "" } : proponerAbacos(m, losa, na, nb);
  }, [m, losa, na, nb]);
  const op = "error" in p ? null : operacionAbacos(m, p);

  const hacer = () => {
    if (!op || "error" in p) return;
    const r = ed.editar(op, `Ábacos en los pilares de ${losa}`);
    if (!r.ok) return setError(r.errores.map((e) => e.mensaje).join(" "));
    onCerrar(`${plural(p.nuevos.length, "ábaco")} en ${losa}.`);
  };

  return (
    <Dialogo
      titulo="Ábacos en los pilares"
      onCerrar={() => onCerrar()}
      alConfirmar={hacer}
      pie={
        <>
          <button type="button" className="btn" onClick={() => onCerrar()}>
            Cancelar
          </button>
          <button type="button" className="btn btn-p" onClick={hacer} disabled={!op}>
            Crear
          </button>
        </>
      }
    >
      {reticulares.length === 0 ? (
        <p>No hay ningún forjado reticular. Un forjado es reticular por su columna «tipo» en la tabla Forjados.</p>
      ) : (
        <>
          <p>Un ábaco macizo centrado en cada pilar que llega al forjado, con sus lados según los nervios (la dirección del forjado) y su perpendicular. Quedan en la columna «ábacos» de la tabla Forjados, donde se pueden retocar.</p>
          <div className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5">
            <label htmlFor="abacos-losa">Forjado</label>
            <select id="abacos-losa" className="sel" value={losa} onChange={(e) => setLosa(e.target.value)}>
              {reticulares.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.id} · {l.planta}
                  {l.nombre ? ` · ${l.nombre}` : ""}
                </option>
              ))}
            </select>
            <label htmlFor="abacos-a">Según los nervios (m)</label>
            <input id="abacos-a" className="sel mono" value={a} inputMode="decimal" aria-invalid={typeof na === "string"} data-error={typeof na === "string"} onChange={(e) => setA(e.target.value)} />
            <label htmlFor="abacos-b">En perpendicular (m)</label>
            <input id="abacos-b" className="sel mono" value={b} inputMode="decimal" aria-invalid={typeof nb === "string"} data-error={typeof nb === "string"} onChange={(e) => setB(e.target.value)} />
          </div>
          {"error" in p ? (
            <p className="mt-3 text-state-fail">{p.error}</p>
          ) : (
            <ul className="mt-3 list-disc pl-5" aria-label="Lo que se va a hacer">
              <li>{p.nuevos.length ? `${plural(p.nuevos.length, "ábaco nuevo", "ábacos nuevos")}: ${p.nuevos.map((x) => x.pilar).join(", ")}.` : "Ningún ábaco nuevo."}</li>
              {p.conAbaco.length > 0 && <li>Ya tienen ábaco, y se dejan: {p.conAbaco.join(", ")}.</li>}
              {p.solapados.length > 0 && <li className="text-state-warn">Se solaparían con otro, y no se crean: {p.solapados.join(", ")}.</li>}
              {p.fuera.length > 0 && <li className="text-text-secondary">Se salen del forjado (cuenta lo de dentro): {p.fuera.join(", ")}.</li>}
            </ul>
          )}
          <p className="dlg-nota">Cambia la huella, así que hay que volver a calcular. Se puede deshacer con Ctrl+Z.</p>
        </>
      )}
      {error && <p className="mt-2 text-state-fail">{error}</p>}
    </Dialogo>
  );
}

/** «Vigas de borde»: el zuncho de los bordes libres de una losa, con la regla de la skill (`editor/vigasBorde.ts`). */
export function DialogoVigasBorde({ onCerrar }: { onCerrar: (hecho?: string) => void }) {
  const { proyecto, planta, seleccion } = useVisor();
  const ed = proyecto.edicion!;
  const m = ed.proyecto.modelo;
  const losas = m.losas ?? [];
  const inicial = losas.find((l) => l.id === seleccion) ?? losas.find((l) => l.planta === planta) ?? losas[0];
  const [losa, setLosa] = useState(inicial?.id ?? "");
  const [b, setB] = useState("0,30");
  const [h, setH] = useState(() => String(inicial?.espesor ?? 0.3).replace(".", ","));
  const [error, setError] = useState<string | null>(null);
  const [nb, nh] = [numero(b), numero(h)];
  const p = useMemo(() => {
    const mal = malos([["Ancho b", nb], ["Canto h", nh]]);
    if (!losa) return { error: "No hay ningún forjado macizo ni reticular." };
    return mal || typeof nb === "string" || typeof nh === "string" ? { error: mal ?? "" } : proponerVigasBorde(m, losa, nb, nh);
  }, [m, losa, nb, nh]);
  const op = "error" in p ? null : operacionVigasBorde(m, p);
  const cuenta = (regla: string) => ("error" in p ? 0 : p.vigas.filter((v) => v.regla === regla).length);

  const hacer = () => {
    if (!op || "error" in p) return;
    const r = ed.editar(op, `Vigas de borde de ${losa}`);
    if (!r.ok) return setError(r.errores.map((e) => e.mensaje).join(" "));
    onCerrar(`${plural(p.vigas.length, "viga")} de borde en ${losa}.`);
  };

  return (
    <Dialogo
      titulo="Vigas de borde"
      onCerrar={() => onCerrar()}
      alConfirmar={hacer}
      pie={
        <>
          <button type="button" className="btn" onClick={() => onCerrar()}>
            Cancelar
          </button>
          <button type="button" className="btn btn-p" onClick={hacer} disabled={!op}>
            Crear
          </button>
        </>
      }
    >
      {losas.length === 0 ? (
        <p>No hay ningún forjado macizo ni reticular: los zunchos de un unidireccional se dibujan como vigas.</p>
      ) : (
        <>
          <p>
            Un zuncho en cada lado del borde (contorno y huecos) que no va sobre una viga, un muro, un apoyo lineal u otro forjado. Su eje va por el de los pilares del lado; sin pilares, enrasado por fuera. El forjado no se toca: el cálculo lleva a la viga lo que cae en su ancho y en la franja de hasta su ancho que quede entre su cara de fuera y el borde del forjado.
          </p>
          <div className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5">
            <label htmlFor="vb-losa">Forjado</label>
            <select id="vb-losa" className="sel" value={losa} onChange={(e) => setLosa(e.target.value)}>
              {losas.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.id} · {l.planta}
                  {l.nombre ? ` · ${l.nombre}` : ""}
                </option>
              ))}
            </select>
            <label htmlFor="vb-b">Ancho b (m)</label>
            <input id="vb-b" className="sel mono" value={b} inputMode="decimal" aria-invalid={typeof nb === "string"} data-error={typeof nb === "string"} onChange={(e) => setB(e.target.value)} />
            <label htmlFor="vb-h">Canto h (m)</label>
            <input id="vb-h" className="sel mono" value={h} inputMode="decimal" aria-invalid={typeof nh === "string"} data-error={typeof nh === "string"} onChange={(e) => setH(e.target.value)} />
          </div>
          {"error" in p ? (
            <p className="mt-3 text-state-fail">{p.error}</p>
          ) : (
            <ul className="mt-3 list-disc pl-5" aria-label="Lo que se va a hacer">
              <li>
                {plural(p.vigas.length, "viga")} {p.seccion.id}
                {p.nueva ? " (sección nueva)" : ""}: {cuenta("pilares")} por el eje de los pilares, {cuenta("enrasada")} enrasadas
                {cuenta("continua") ? ` y ${cuenta("continua")} que siguen la viga que ya ata el lado` : ""}.
              </li>
              <li>Su eje queda a {coma(Math.max(...p.vigas.map((v) => v.retranqueo)))} m del borde como mucho; el forjado y sus cargas no cambian.</li>
              {p.avisos.map((a) => (
                <li key={a} className="text-state-warn">
                  {a}
                </li>
              ))}
            </ul>
          )}
          <p className="dlg-nota">Cambia la huella, así que hay que volver a calcular. Se puede deshacer con Ctrl+Z.</p>
        </>
      )}
      {error && <p className="mt-2 text-state-fail">{error}</p>}
    </Dialogo>
  );
}
