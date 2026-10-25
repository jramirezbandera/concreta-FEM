/**
 * Diálogos del editor (V2a): borrar (si otros objetos usan lo que se borra, se dice cuáles y se
 * elige entre borrarlos también o pasarlos a otro), copiar a otras plantas, renumerar (I-g) y
 * los ábacos en los pilares de un reticular.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { copiarAPlantas, objetosDePlanta } from "../../../src/editor/edicion.ts";
import { operacionAbacos, proponerAbacos } from "../../../src/editor/abacos.ts";
import { operacionVigasBorde, proponerVigasBorde } from "../../../src/editor/vigasBorde.ts";
import { aplicar, nombreColeccion } from "../../../src/editor/operaciones.ts";
import { COLECCIONES, indiceIds, lista } from "../../../src/editor/referencias.ts";
import { PREFIJOS, renumerar, RENUMERABLES } from "../../../src/editor/renumerar.ts";
import type { ModeloFisico } from "../../../src/compilador/fisico.ts";
import { useVisor } from "../contexto.ts";

const total = (m: ModeloFisico) => COLECCIONES.reduce((n, c) => n + lista(m, c).length, 0);

/**
 * `clase`: otra forma de la caja (el gestor de GE, más ancho y con dos columnas).
 *
 * Esc cierra el de encima aunque el foco no esté dentro (GE1-1: tras pulsar un botón que cambia o
 * desaparece, el foco se va al `body`). Se escucha en la ventana, en la fase de captura, y no sigue:
 * así no suelta también lo elegido ni anula la herramienta de dibujo.
 */
export function Dialogo({ titulo, children, pie, onCerrar, clase }: { titulo: string; children: React.ReactNode; pie: React.ReactNode; onCerrar: () => void; clase?: string }) {
  const fondo = useRef<HTMLDivElement>(null);
  const cerrar = useRef(onCerrar);
  cerrar.current = onCerrar;
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
    <div ref={fondo} className="dialogo-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className={clase ? `dialogo ${clase}` : "dialogo"} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="dialogo-cab">
          <h2>{titulo}</h2>
          <button type="button" className="ib" style={{ width: 28, height: 28 }} aria-label="Cerrar" title="Cerrar (Esc)" onClick={onCerrar}>
            <X size={16} />
          </button>
        </div>
        <div className="dialogo-cuerpo">{children}</div>
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
                {nombreColeccion(idx.get(id)!.coleccion)} {id} <span className="text-text-disabled">({rs.join("; ")})</span>
              </li>
            ))}
          </ul>
          <label className="opcion">
            <input type="radio" name="modo" checked={modo === "borrar"} onChange={() => setModo("borrar")} />
            <span>
              Borrarlos también
              {cascada !== null && <small>En total se borran {cascada} objetos; los tramos de pilar sólo pierden el tramo.</small>}
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
      <div className="dlg-et" style={{ marginTop: 4 }}>Qué se copia</div>
      <label className="opcion">
        <input type="radio" checked={!entera} onChange={() => setEntera(false)} />
        <span>
          Lo elegido <span className="mono text-text-secondary">· {ids.length > 6 ? `${ids.slice(0, 6).join(", ")}… (${ids.length})` : ids.join(", ")}</span>
        </span>
      </label>
      <label className="opcion">
        <input type="radio" checked={entera} onChange={() => setEntera(true)} disabled={!planta} />
        <span>
          Toda la planta {planta} <span className="mono text-text-secondary">· {todos.length} objetos</span>
          <small>Vigas, losas, paños, apoyos, apoyos lineales y sus cargas.</small>
        </span>
      </label>
      <div className="dlg-et">A las plantas</div>
      <div className="fichas">
        {m.plantas.map((x) => (
          <label key={x.id} className="ficha" title={x.nombre}>
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
            {x.id}
            {x.id === planta && <small>esta</small>}
          </label>
        ))}
      </div>
      <p className="dlg-nota">Los ids nuevos llevan la planta de destino. Las cargas van a la copia de su viga, su losa o su paño. Los pilares y los muros no se copian: se alargan con su «desde» y su «hasta».</p>
      {error && <p className="mt-2 text-state-fail">{error}</p>}
    </Dialogo>
  );
}

/** Renumerar como CYPECAD (I-g, `interfaz.md` §12.1): dice qué cambia antes de hacerlo. */
export function DialogoRenumerar({ onCerrar }: { onCerrar: (hecho?: string) => void }) {
  const { proyecto, seleccion, setSeleccion, elegidos, setElegidos } = useVisor();
  const ed = proyecto.edicion!;
  const m = ed.proyecto.modelo;
  const { mapa, reordena } = useMemo(() => renumerar(m), [m]);
  const cambia = mapa.size > 0 || reordena;
  const idx = useMemo(() => indiceIds(m), [m]);
  const [error, setError] = useState<string | null>(null);
  const porColeccion = RENUMERABLES.map((c) => ({ c, n: [...mapa.keys()].filter((id) => idx.get(id)?.coleccion === c).length })).filter((x) => x.n > 0);
  const ejemplos = [...mapa].slice(0, 8);

  const hacer = () => {
    const r = ed.editar({ op: "renumerar" }, "Renumerar");
    if (!r.ok) return setError(r.errores.map((e) => e.mensaje).join(" "));
    const nuevo = (id: string) => mapa.get(id) ?? id;
    if (elegidos.length) setElegidos(elegidos.map(nuevo));
    else if (seleccion) setSeleccion(nuevo(seleccion));
    onCerrar(mapa.size ? `Renumerados ${mapa.size} objetos.` : "Pilares ordenados.");
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
        Como en CYPECAD: pilares <span className="mono">{PREFIJOS.pilares}1…</span>, vigas <span className="mono">{PREFIJOS.vigas}1…</span>, losas <span className="mono">{PREFIJOS.losas}1…</span>, paños <span className="mono">{PREFIJOS.panos}1…</span> y muros <span className="mono">{PREFIJOS.muros}1…</span>, por filas de arriba abajo y de izquierda a derecha (las vigas, losas, paños y muros, por plantas de abajo arriba). La tabla de pilares queda en ese orden.
      </p>
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
            {mapa.size > ejemplos.length && <li className="text-text-disabled">… y {mapa.size - ejemplos.length} más</li>}
          </ul>
          <p className="dlg-nota">Las cargas y demás referencias siguen a su objeto. Cambia la huella, así que hay que volver a calcular. Se puede deshacer con Ctrl+Z.</p>
        </>
      )}
      {error && <p className="mt-2 text-state-fail">{error}</p>}
    </Dialogo>
  );
}


const coma = (x: number) => String(Math.round(x * 1000) / 1000).replace(".", ",");
const numero = (s: string) => Number(s.trim().replace(",", "."));

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
  const p = useMemo(() => (losa ? proponerAbacos(m, losa, numero(a), numero(b)) : { error: "No hay ningún forjado reticular." }), [m, losa, a, b]);
  const op = "error" in p ? null : operacionAbacos(m, p);

  const hacer = () => {
    if (!op || "error" in p) return;
    const r = ed.editar(op, `Ábacos en los pilares de ${losa}`);
    if (!r.ok) return setError(r.errores.map((e) => e.mensaje).join(" "));
    onCerrar(`${p.nuevos.length} ábacos en ${losa}.`);
  };

  return (
    <Dialogo
      titulo="Ábacos en los pilares"
      onCerrar={() => onCerrar()}
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
            <input id="abacos-a" className="sel mono" value={a} onChange={(e) => setA(e.target.value)} />
            <label htmlFor="abacos-b">En perpendicular (m)</label>
            <input id="abacos-b" className="sel mono" value={b} onChange={(e) => setB(e.target.value)} />
          </div>
          {"error" in p ? (
            <p className="mt-3 text-state-fail">{p.error}</p>
          ) : (
            <ul className="mt-3 list-disc pl-5" aria-label="Lo que se va a hacer">
              <li>{p.nuevos.length ? `${p.nuevos.length} ábacos nuevos: ${p.nuevos.map((x) => x.pilar).join(", ")}.` : "Ningún ábaco nuevo."}</li>
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
  const p = useMemo(() => (losa ? proponerVigasBorde(m, losa, numero(b), numero(h)) : { error: "No hay ninguna losa." }), [m, losa, b, h]);
  const op = "error" in p ? null : operacionVigasBorde(m, p);
  const cuenta = (regla: string) => ("error" in p ? 0 : p.vigas.filter((v) => v.regla === regla).length);

  const hacer = () => {
    if (!op || "error" in p) return;
    const r = ed.editar(op, `Vigas de borde de ${losa}`);
    if (!r.ok) return setError(r.errores.map((e) => e.mensaje).join(" "));
    onCerrar(`${p.vigas.length} vigas de borde en ${losa}.`);
  };

  return (
    <Dialogo
      titulo="Vigas de borde"
      onCerrar={() => onCerrar()}
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
        <p>No hay ninguna losa.</p>
      ) : (
        <>
          <p>
            Un zuncho en cada lado del borde (contorno y huecos) que no va sobre una viga, un muro, un apoyo lineal u otro forjado. Su eje va por el de los pilares del lado; sin pilares, enrasado por fuera. La losa se lleva hasta el eje, y lo que cargaba la banda que queda fuera (cargas de superficie, petos y su peso donde no está la viga) pasa a la viga.
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
            <input id="vb-b" className="sel mono" value={b} onChange={(e) => setB(e.target.value)} />
            <label htmlFor="vb-h">Canto h (m)</label>
            <input id="vb-h" className="sel mono" value={h} onChange={(e) => setH(e.target.value)} />
          </div>
          {"error" in p ? (
            <p className="mt-3 text-state-fail">{p.error}</p>
          ) : (
            <ul className="mt-3 list-disc pl-5" aria-label="Lo que se va a hacer">
              <li>
                {p.vigas.length} vigas {p.seccion.id}
                {p.nueva ? " (sección nueva)" : ""}: {cuenta("pilares")} por el eje de los pilares, {cuenta("enrasada")} enrasadas
                {cuenta("continua") ? ` y ${cuenta("continua")} que siguen la viga que ya ata el lado` : ""}.
              </li>
              <li>
                La losa pierde una banda de {coma(Math.max(...p.vigas.map((v) => v.retranqueo)))} m como mucho; {p.cargas.filter((c) => c.tipo === "viga").length} cargas de viga la llevan a las vigas.
              </li>
              {p.quitadas.length > 0 && <li>Las cargas lineales {p.quitadas.join(", ")} pasan a las vigas{p.cargas.some((c) => c.tipo === "lineal") ? " (lo que queda fuera de la banda sigue como lineal)" : ""}.</li>}
              {p.sueltas.length > 0 && <li className="text-state-warn">Las puntuales {p.sueltas.join(", ")} quedan fuera de la losa: muévalas a la viga.</li>}
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
