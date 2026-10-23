/**
 * Pantalla de inicio (fase AL, `docs/fem3d/almacen-local.md` §3.5): los proyectos de este navegador
 * (IndexedDB), uno nuevo, importar un proyecto.json y los ejemplos del repositorio. Abrir una carpeta
 * del disco queda aparte, para trabajar con el agente (AL-a). También abre lo que diga la URL:
 *   ?local=<id>                                          (un proyecto del navegador)
 *   ?proyecto=<url del proyecto en el servidor local>   (se vigila, como una carpeta)
 *   ?ejemplo=<nombre>                                    (uno de EJEMPLOS)
 */
import { useCallback, useEffect, useState } from "react";
import { Copy, Download, FilePlus, FolderOpen, History, Trash2, Upload } from "lucide-react";
import { leerProyecto } from "../../src/agente/proyecto.ts";
import { proyectoNuevo } from "../../src/editor/plantilla.ts";
import { serializar } from "../../src/editor/serializar.ts";
import { borrar, crear, duplicar, ficha, hayAlmacen, leer, listar, origenNavegador, persistente, type Ficha } from "./sesion/almacen.ts";
import { descargar, elegirCarpeta, hayCarpetas, origenCarpeta, origenUrl, proyectosEn, type Directorio } from "./sesion/origen.ts";
import { nombreFichero, type ProyectoAbierto } from "./sesion/useProyecto.ts";
import { DialogoVersiones } from "./armazon/Versiones.tsx";
import { fechaCorta, tamano } from "./fmt.ts";

/** Proyectos de ejemplo del repositorio (el muestrario y la vivienda de `ejemplos/`, la skill y los tres de A2). */
export const EJEMPLOS: Record<string, { titulo: string; cargar: () => Promise<string> }> = {
  muestrario: { titulo: "Muestrario: sótano con empuje, núcleo, porche con apoyo lineal, reticular y unidireccional (con combinaciones)", cargar: () => import("../../ejemplos/muestrario/proyecto.json?raw").then((m) => m.default) },
  vivienda: { titulo: "Vivienda de una planta con dos cubiertas reticulares y pérgola (proyecto real, modelado por el agente)", cargar: () => import("../../ejemplos/vivienda/proyecto.json?raw").then((m) => m.default) },
  ejemplo: { titulo: "Pórtico de dos plantas con losa (ejemplo de la skill)", cargar: () => import("../../.claude/skills/fem/ejemplo.json?raw").then((m) => m.default) },
  "1022": { titulo: "Pórtico de acero de 7 plantas (SAP2000 1-022, A2)", cargar: () => import("../../validacion/a2/agente/1022/proyecto.json?raw").then((m) => m.default) },
  nucleo: { titulo: "Retícula con núcleo de muros (A2)", cargar: () => import("../../validacion/a2/agente/nucleo/proyecto.json?raw").then((m) => m.default) },
  edificio: { titulo: "Edificio objetivo: 7 plantas, 80 pilares (A2)", cargar: () => import("../../validacion/a2/agente/edificio/proyecto.json?raw").then((m) => m.default) },
};

export async function abrirDesdeUrl(p: ProyectoAbierto): Promise<void> {
  const q = new URLSearchParams(location.search);
  const local = q.get("local");
  if (local && hayAlmacen()) {
    const f = await ficha(local).catch(() => null);
    if (f) return p.abrirOrigen(origenNavegador(f.id, f.nombre));
  }
  const url = q.get("proyecto");
  if (url) return p.abrirOrigen(origenUrl(url));
  const ej = q.get("ejemplo");
  if (ej && EJEMPLOS[ej]) p.abrirTexto(await EJEMPLOS[ej].cargar(), `${ej}.json`);
}

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Inicio({ proyecto }: { proyecto: ProyectoAbierto }) {
  const [elegir, setElegir] = useState<{ dir: Directorio; ficheros: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [encima, setEncima] = useState(false);
  const [nuevo, setNuevo] = useState<string | null>(null);
  const [mios, setMios] = useState<Ficha[] | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);
  const [versionesDe, setVersionesDe] = useState<Ficha | null>(null);
  const [persiste, setPersiste] = useState<boolean | null>(null);
  const ocupado = proyecto.fase === "abriendo" || proyecto.fase === "calculando";
  const almacen = hayAlmacen();

  const releer = useCallback(() => {
    if (!almacen) return;
    listar().then(setMios, (e: unknown) => setError(`No se pudo leer la lista de proyectos del navegador: ${mensaje(e)}`));
    void persistente().then(setPersiste);
  }, [almacen]);
  useEffect(releer, [releer]);

  const abrir = (f: Ficha) => proyecto.abrirOrigen(origenNavegador(f.id, f.nombre));

  const carpeta = async () => {
    setError(null);
    try {
      const dir = await elegirCarpeta();
      if (!dir) return;
      const ficheros = await proyectosEn(dir);
      if (!ficheros.length) setError(`En la carpeta ${dir.name} no hay ningún .json con el esquema concreta-fem/proyecto@1.`);
      else if (ficheros.length === 1) proyecto.abrirOrigen(origenCarpeta(dir, ficheros[0]!));
      else setElegir({ dir, ficheros });
    } catch (e) {
      setError(mensaje(e));
    }
  };

  /** Proyecto nuevo, en el navegador; sin IndexedDB (algún modo privado), se abre y guardar lo descarga. */
  const crearNuevo = async () => {
    if (nuevo === null) return;
    const nombre = nuevo.trim() || "Proyecto nuevo";
    const texto = serializar(proyectoNuevo(nombre));
    if (!almacen) return proyecto.abrirTexto(texto, nombreFichero(nombre));
    try {
      abrir(await crear(texto));
    } catch (e) {
      setError(`No se pudo crear el proyecto en el navegador: ${mensaje(e)}`);
    }
  };

  /** Importar: un proyecto válido pasa al navegador; uno que no pasa el esquema se abre sin guardar, con sus errores. */
  const importar = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    const texto = await f.text();
    const l = leerProyecto(texto);
    if (!l.valido || !almacen) return proyecto.abrirTexto(texto, f.name);
    try {
      // Se guarda el texto canónico (el mismo contenido y la misma huella)
      abrir(await crear(serializar(l.proyecto), f.name.replace(/\.json$/i, "")));
    } catch (e) {
      setError(`No se pudo importar ${f.name}: ${mensaje(e)}`);
    }
  };

  const exportar = async (x: Ficha) => {
    const l = await leer(x.id);
    if (l) descargar(l.texto, nombreFichero(x.nombre));
  };

  return (
    <div
      className={`flex h-full items-start justify-center overflow-y-auto bg-bg-surface p-6 ${encima ? "outline-2 -outline-offset-8 outline-dashed outline-accent" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setEncima(true);
      }}
      onDragLeave={() => setEncima(false)}
      onDrop={(e) => {
        e.preventDefault();
        setEncima(false);
        void importar(e.dataTransfer.files[0]);
      }}
    >
      <div className="mt-[6vh] w-[720px] max-w-full rounded-md border border-border-main bg-bg-primary">
        <div className="border-b border-border-sub px-5 py-4">
          <div className="flex items-center gap-1.5 text-[15px] font-semibold">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-[18px] w-[18px]" aria-hidden="true" />
            Concreta · FEM 3D
          </div>
          <h1 className="mt-1 text-[13px] font-normal text-text-secondary">
            Modelar, calcular y revisar. Los proyectos se guardan solos en este navegador; para llevarlos a otro equipo, o para que los use el agente, se exporta el proyecto.json.
          </h1>
        </div>

        <div className="flex flex-col gap-2 px-5 py-4">
          <div className="flex gap-2">
            <button type="button" className="btn btn-p flex-1" style={{ height: 34 }} onClick={() => setNuevo(nuevo === null ? "" : null)} disabled={ocupado}>
              <FilePlus size={15} /> Proyecto nuevo…
            </button>
            <label className={`btn flex-1 ${ocupado ? "opacity-50" : ""}`} style={{ height: 34, justifyContent: "center" }}>
              <Upload size={15} /> Importar un proyecto.json (o arrastrarlo aquí)…
              <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => void importar(e.target.files?.[0])} disabled={ocupado} />
            </label>
          </div>
          {nuevo !== null && (
            <form
              className="flex items-center gap-2 rounded border border-border-main p-2"
              onSubmit={(e) => {
                e.preventDefault();
                void crearNuevo();
              }}
            >
              <span className="text-[12px] text-text-secondary">{almacen ? "Nombre:" : "Este navegador no guarda proyectos (¿modo privado?): guardar lo descargará. Nombre:"}</span>
              <input className="sel flex-1" autoFocus aria-label="Nombre del proyecto" placeholder="Proyecto nuevo" value={nuevo} onChange={(e) => setNuevo(e.target.value)} />
              <button type="submit" className="btn btn-p">
                Crear
              </button>
            </form>
          )}
          {error && <p className="text-[12px] text-state-fail">{error}</p>}
          {ocupado && <p className="mono text-[12px] text-text-secondary">{proyecto.fase === "abriendo" ? "Abriendo y compilando…" : "Calculando…"}</p>}
        </div>

        {almacen && (
          <section className="border-t border-border-sub px-5 py-3" aria-label="Mis proyectos">
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">Mis proyectos</span>
              <span className="flex-1" />
              {persiste === false && !!mios?.length && (
                <span className="text-[11px] text-state-warn" title="El navegador podría borrarlos si se queda sin espacio. Exporte los que no quiera perder.">
                  El navegador no garantiza conservarlos: exporte los importantes
                </span>
              )}
            </div>
            {mios?.length === 0 && <p className="mt-1 text-[12px] text-text-secondary">Aún no hay ninguno en este navegador. Empiece uno nuevo, importe un proyecto.json o abra un ejemplo.</p>}
            <ul className="mt-1 list-none p-0">
              {mios?.map((x) => (
                <li key={x.id} className="flex items-center gap-2 border-t border-border-sub first:border-t-0">
                  {borrando === x.id ? (
                    <>
                      <span className="min-w-0 flex-1 py-1.5 text-[12px]">
                        ¿Borrar <strong>{x.nombre}</strong> y sus versiones de este navegador? No se puede deshacer.
                      </span>
                      <button
                        type="button"
                        className="btn"
                        style={{ color: "var(--color-state-fail)" }}
                        onClick={() =>
                          void borrar(x.id).then(() => {
                            setBorrando(null);
                            releer();
                          })
                        }
                      >
                        Borrar
                      </button>
                      <button type="button" className="btn" onClick={() => setBorrando(null)}>
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="min-w-0 flex-1 truncate py-1.5 text-left text-[13px] text-accent hover:underline disabled:opacity-50" disabled={ocupado} onClick={() => abrir(x)} title={`Abrir ${x.nombre}`}>
                        {x.nombre}
                      </button>
                      <span className="mono shrink-0 text-[11px] text-text-secondary">{fechaCorta(x.modificado)}</span>
                      <span className="mono w-14 shrink-0 text-right text-[11px] text-text-disabled">{tamano(x.tamano)}</span>
                      <span className="flex shrink-0">
                        <button type="button" className="ib" aria-label={`Exportar ${x.nombre}`} title="Exportar el proyecto.json" onClick={() => void exportar(x)}>
                          <Download size={15} />
                        </button>
                        <button type="button" className="ib" aria-label={`Versiones de ${x.nombre}`} title="Versiones anteriores" onClick={() => setVersionesDe(x)}>
                          <History size={15} />
                        </button>
                        <button type="button" className="ib" aria-label={`Duplicar ${x.nombre}`} title="Duplicar" onClick={() => void duplicar(x.id).then(releer)}>
                          <Copy size={15} />
                        </button>
                        <button type="button" className="ib" aria-label={`Borrar ${x.nombre}`} title="Borrar" onClick={() => setBorrando(x.id)}>
                          <Trash2 size={15} />
                        </button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="border-t border-border-sub px-5 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">Ejemplos del repositorio · se abren sin guardar</div>
          <ul className="mt-1 list-none p-0">
            {Object.entries(EJEMPLOS).map(([k, e]) => (
              <li key={k}>
                <button type="button" className="w-full py-1 text-left text-accent hover:underline disabled:opacity-50" disabled={ocupado} onClick={() => void e.cargar().then((t) => proyecto.abrirTexto(t, `${k}.json`))}>
                  {e.titulo}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t border-border-sub px-5 py-3 text-[12px] text-text-secondary">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">En el disco, para trabajar con el agente</div>
          <p className="mt-1">
            El agente y la CLI leen el proyecto.json del disco. Para trabajar los dos sobre el mismo fichero, ábralo desde su carpeta (se recarga solo cuando el agente lo cambia) o con <span className="mono">bun run visor proyecto.json</span>.
          </p>
          <button type="button" className="btn mt-2" onClick={() => void carpeta()} disabled={!hayCarpetas() || ocupado} title={hayCarpetas() ? undefined : "Hace falta Chrome o Edge"}>
            <FolderOpen size={15} /> Abrir una carpeta…
          </button>
          {elegir && (
            <div className="mt-2 rounded border border-border-main">
              <div className="sec">
                <span>Proyectos en {elegir.dir.name}</span>
              </div>
              {elegir.ficheros.map((f) => (
                <button key={f} type="button" className="lista-fila" style={{ gridTemplateColumns: "1fr" }} onClick={() => proyecto.abrirOrigen(origenCarpeta(elegir.dir, f))}>
                  <span className="mono">{f}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {versionesDe && (
        <DialogoVersiones
          id={versionesDe.id}
          nombre={versionesDe.nombre}
          onCerrar={() => setVersionesDe(null)}
          onRestaurada={() => {
            const x = versionesDe;
            setVersionesDe(null);
            abrir(x);
          }}
        />
      )}
    </div>
  );
}
