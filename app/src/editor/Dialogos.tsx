/**
 * Diálogos del editor (V2a): borrar (si otros objetos usan lo que se borra, se dice cuáles y se
 * elige entre borrarlos también o pasarlos a otro) y copiar a otras plantas.
 */
import { useMemo, useState } from "react";
import { copiarAPlantas, objetosDePlanta } from "../../../src/editor/edicion.ts";
import { aplicar, nombreColeccion } from "../../../src/editor/operaciones.ts";
import { COLECCIONES, indiceIds, lista } from "../../../src/editor/referencias.ts";
import type { ModeloFisico } from "../../../src/compilador/fisico.ts";
import { useVisor } from "../contexto.ts";

const total = (m: ModeloFisico) => COLECCIONES.reduce((n, c) => n + lista(m, c).length, 0);

function Dialogo({ titulo, children, pie, onCerrar }: { titulo: string; children: React.ReactNode; pie: React.ReactNode; onCerrar: () => void }) {
  return (
    <div className="dialogo-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()} onKeyDown={(e) => e.key === "Escape" && onCerrar()}>
      <div className="dialogo" role="dialog" aria-modal="true" aria-label={titulo}>
        <h2>{titulo}</h2>
        <div className="px-4 py-3 text-[12.5px]">{children}</div>
        <div className="pie">{pie}</div>
      </div>
    </div>
  );
}

export function DialogoBorrar({ ids, onCerrar }: { ids: string[]; onCerrar: (hecho?: string) => void }) {
  const { proyecto, seleccion, setSeleccion } = useVisor();
  const ed = proyecto.edicion!;
  const p = ed.proyecto;
  const prueba = useMemo(() => aplicar(p, { op: "borrar", ids }), [p, ids]);
  const usos = !prueba.ok ? (prueba.usos ?? []) : [];
  const usados = useMemo(() => [...new Set(usos.map((u) => u.usa))], [usos]);
  const idx = useMemo(() => indiceIds(p.modelo), [p]);
  const cascada = useMemo(() => {
    const r = aplicar(p, { op: "borrar", ids, dependientes: "borrar" });
    return r.ok ? total(p.modelo) - total(r.proyecto.modelo) : null;
  }, [p, ids]);
  const [modo, setModo] = useState<"borrar" | "reasignar">("borrar");
  const [destino, setDestino] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const borrados = new Set(ids);
  const candidatos = (id: string) => {
    const c = idx.get(id)?.coleccion;
    return c ? lista(p.modelo, c).filter((o) => !borrados.has(o.id)).map((o) => o.id) : [];
  };

  const hacer = () => {
    const op = usos.length === 0 ? ({ op: "borrar", ids } as const) : modo === "borrar" ? ({ op: "borrar", ids, dependientes: "borrar" } as const) : ({ op: "borrar", ids, dependientes: { reasignar: Object.fromEntries(usados.map((u) => [u, destino[u] ?? candidatos(u)[0] ?? ""])) } } as const);
    const r = ed.editar(op, `Borrar ${ids.length > 3 ? `${ids.length} objetos` : ids.join(", ")}`);
    if (!r.ok) return setError(r.errores.map((e) => e.mensaje).join(" "));
    if (seleccion && !indiceIds(r.proyecto.modelo).has(seleccion)) setSeleccion(null);
    onCerrar(usos.length === 0 || modo === "reasignar" ? `Borrado ${ids.join(", ")}.` : `Borrado ${ids.join(", ")} y ${(cascada ?? ids.length) - ids.length} objetos que lo usaban.`);
  };

  const porObjeto = new Map<string, string[]>();
  for (const u of usos) porObjeto.set(u.id, [...(porObjeto.get(u.id) ?? []), `${u.ruta.join(".")} = ${u.usa}`]);

  return (
    <Dialogo
      titulo={`Borrar ${ids.length > 3 ? `${ids.length} objetos` : ids.join(", ")}`}
      onCerrar={() => onCerrar()}
      pie={
        <>
          <button type="button" className="btn" onClick={() => onCerrar()}>
            Cancelar
          </button>
          <button type="button" className="btn btn-p" autoFocus onClick={hacer} disabled={modo === "reasignar" && usados.some((u) => candidatos(u).length === 0)}>
            Borrar
          </button>
        </>
      }
    >
      {usos.length === 0 ? (
        <p>Nada más usa {ids.length > 1 ? "estos objetos" : "este objeto"}. Se puede deshacer con Ctrl+Z.</p>
      ) : (
        <>
          <p>
            {porObjeto.size} objeto{porObjeto.size > 1 ? "s usan" : " usa"} lo que se borra:
          </p>
          <ul className="mono my-2 max-h-[180px] list-none overflow-y-auto rounded border border-border-sub p-2 text-[11.5px]">
            {[...porObjeto].map(([id, rs]) => (
              <li key={id}>
                {nombreColeccion(idx.get(id)!.coleccion)} {id} <span className="text-text-disabled">({rs.join("; ")})</span>
              </li>
            ))}
          </ul>
          <label className="chk" style={{ padding: 0 }}>
            <input type="radio" name="modo" checked={modo === "borrar"} onChange={() => setModo("borrar")} /> Borrarlos también {cascada !== null ? `(en total se borran ${cascada} objetos; los tramos de pilar sólo pierden el tramo)` : ""}
          </label>
          <label className="chk" style={{ padding: 0 }}>
            <input type="radio" name="modo" checked={modo === "reasignar"} onChange={() => setModo("reasignar")} /> Pasarlos a otro:
          </label>
          {modo === "reasignar" &&
            usados.map((u) => (
              <label key={u} className="ml-6 flex items-center gap-2 py-1">
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

  const hacer = () => {
    const t = copiarAPlantas(m, copiar, [...destinos]);
    if (!t.ok) return setError(t.errores.map((e) => e.mensaje).join(" "));
    const n = t.operacion.op === "lote" ? t.operacion.operaciones.length : 1;
    const r = ed.editar(t.operacion, `Copiar ${copiar.length} objetos a ${[...destinos].join(", ")}`);
    if (!r.ok) return setError(r.errores.map((e) => e.mensaje).join(" "));
    onCerrar(`Creados ${n} objetos en ${[...destinos].join(", ")}.`);
  };

  return (
    <Dialogo
      titulo="Copiar a otras plantas"
      onCerrar={() => onCerrar()}
      pie={
        <>
          <button type="button" className="btn" onClick={() => onCerrar()}>
            Cancelar
          </button>
          <button type="button" className="btn btn-p" onClick={hacer} disabled={destinos.size === 0 || copiar.length === 0}>
            Copiar
          </button>
        </>
      }
    >
      <label className="chk" style={{ padding: 0 }}>
        <input type="radio" checked={!entera} onChange={() => setEntera(false)} /> Las filas elegidas: <span className="mono">{ids.length > 6 ? `${ids.slice(0, 6).join(", ")}… (${ids.length})` : ids.join(", ")}</span>
      </label>
      <label className="chk" style={{ padding: 0 }}>
        <input type="radio" checked={entera} onChange={() => setEntera(true)} disabled={!planta} /> Toda la planta {planta}: vigas, losas, apoyos y sus cargas ({todos.length} objetos)
      </label>
      <p className="mt-2 text-text-secondary">A las plantas:</p>
      <div className="grid grid-cols-3 gap-x-3">
        {m.plantas.map((x) => (
          <label key={x.id} className="chk" style={{ padding: 0 }}>
            <input
              type="checkbox"
              checked={destinos.has(x.id)}
              onChange={(e) => {
                const n = new Set(destinos);
                if (e.target.checked) n.add(x.id);
                else n.delete(x.id);
                setDestinos(n);
              }}
            />
            <span className="mono">{x.id}</span>
          </label>
        ))}
      </div>
      <p className="mt-2 text-[11.5px] text-text-secondary">Los ids nuevos llevan la planta de destino. Las cargas van a la copia de su viga o su losa. Los pilares no se copian: se alargan con su «desde» y su «hasta».</p>
      {error && <p className="mt-2 text-state-fail">{error}</p>}
    </Dialogo>
  );
}
