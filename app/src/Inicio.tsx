/**
 * Pantalla de inicio (fase AL, `docs/fem3d/almacen-local.md` §3.5): los proyectos de este navegador
 * (IndexedDB), uno nuevo, importar un proyecto.json y los ejemplos del repositorio. Abrir una carpeta
 * del disco queda aparte, para trabajar con el agente (AL-a). También abre lo que diga la URL:
 *   ?local=<id>                                          (un proyecto del navegador)
 *   ?proyecto=<url del proyecto en el servidor local>   (se vigila, como una carpeta)
 *   ?ejemplo=<nombre>                                    (uno de EJEMPLOS)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Building2, ChevronRight, Copy, Download, FilePlus, FolderOpen, History, Loader2, Moon, Search, Sun, Terminal, Trash2, Upload, X } from "lucide-react";
import { useTheme } from "./tema/useTheme.ts";
import { leerProyecto } from "../../src/agente/proyecto.ts";
import { proyectoNuevo } from "../../src/editor/plantilla.ts";
import { serializar } from "../../src/editor/serializar.ts";
import { borrar, crear, duplicar, ficha, hayAlmacen, leer, listar, origenNavegador, persistente, type Ficha } from "./sesion/almacen.ts";
import { descargar, elegirCarpeta, hayCarpetas, origenCarpeta, origenUrl, proyectosEn, type Directorio } from "./sesion/origen.ts";
import { nombreFichero, type ProyectoAbierto } from "./sesion/useProyecto.ts";
import { DialogoVersiones } from "./armazon/Versiones.tsx";
import { abrirGestor, cerrarGestor } from "./editor/referencia.tsx";
import { fechaCorta, tamano } from "./fmt.ts";

/**
 * Proyectos de ejemplo del repositorio (el muestrario y la vivienda de `ejemplos/`, la skill y los tres de A2), del más
 * sencillo al más grande. El nombre accesible de cada tarjeta empieza por su título.
 */
export const EJEMPLOS: Record<string, { titulo: string; detalle: string; etiqueta?: string; cargar: () => Promise<string> }> = {
  ejemplo: { titulo: "Pórtico de dos plantas con losa", detalle: "El ejemplo sencillo: 4 pilares, vigas y losas macizas.", etiqueta: "Para empezar", cargar: () => import("../../.claude/skills/fem/ejemplo.json?raw").then((m) => m.default) },
  vivienda: { titulo: "Vivienda unifamiliar", detalle: "Una planta, dos cubiertas reticulares y pérgola; 23 pilares. Modelada por el agente desde los planos.", etiqueta: "Proyecto real", cargar: () => import("../../ejemplos/vivienda/proyecto.json?raw").then((m) => m.default) },
  muestrario: { titulo: "Muestrario", detalle: "Sótano con empuje, núcleo, porche con apoyo lineal, reticular y unidireccional, con combinaciones.", cargar: () => import("../../ejemplos/muestrario/proyecto.json?raw").then((m) => m.default) },
  nucleo: { titulo: "Retícula con núcleo de muros", detalle: "16 pilares, vigas y losa maciza alrededor de un núcleo.", cargar: () => import("../../validacion/a2/agente/nucleo/proyecto.json?raw").then((m) => m.default) },
  // Sin el nombre del programa del caso de validación: los textos de la app no nombran software comercial
  "1022": { titulo: "Pórtico de acero de 7 plantas", detalle: "Caso de validación 1-022: pilares y vigas de acero, sin losas.", cargar: () => import("../../validacion/a2/agente/1022/proyecto.json?raw").then((m) => m.default) },
  edificio: { titulo: "Edificio de 7 plantas", detalle: "80 pilares por planta, vigas y losas macizas. Tarda más en calcular.", etiqueta: "Grande", cargar: () => import("../../validacion/a2/agente/edificio/proyecto.json?raw").then((m) => m.default) },
};
/** El orden de la lista: `Object.entries` pondría «1022» delante (las claves numéricas van primero). */
const ORDEN_EJEMPLOS = ["ejemplo", "vivienda", "muestrario", "nucleo", "1022", "edificio"] as const;

/** La extensión de Claude Desktop (`scripts/paquete-mcpb.ts`), publicada junto a la app en GitHub Pages. */
export const URL_EXTENSION = "https://jramirezbandera.github.io/concreta-FEM/concreta-fem.mcpb";

export async function abrirDesdeUrl(p: ProyectoAbierto): Promise<void> {
  const q = new URLSearchParams(location.search);
  // DO: `fem visor --nuevo` abre la obra nueva con sus datos y sus plantas, como «Proyecto nuevo»;
  // el parámetro se quita para que recargar no lo repita
  if (q.get("nuevo") === "1") {
    abrirGestor({ coleccion: "obra", inicio: true });
    q.delete("nuevo");
    history.replaceState(null, "", `${location.pathname}${q.size ? `?${q}` : ""}${location.hash}`);
  }
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
  /** C-13: creando o importando en el navegador (la ref, para el segundo envío del mismo instante). */
  const [creando, setCreando] = useState(false);
  const creandoRef = useRef(false);
  const [filtro, setFiltro] = useState("");
  /** Entradas y salidas del arrastre: `dragleave` salta también al pasar a un hijo. */
  const arrastre = useRef(0);
  const { theme, toggleTheme } = useTheme();
  const ocupado = proyecto.fase === "abriendo" || proyecto.fase === "calculando";
  const almacen = hayAlmacen();

  const releer = useCallback(() => {
    if (!almacen) return;
    listar().then(setMios, (e: unknown) => setError(`No se pudo leer la lista de proyectos del navegador: ${mensaje(e)}`));
    persistente().then(setPersiste, () => setPersiste(null));
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
    // C-13: un doble clic en «Crear» (o Intro dos veces) creaba dos proyectos
    if (nuevo === null || creandoRef.current) return;
    const nombre = nuevo.trim() || "Proyecto nuevo";
    const texto = serializar(proyectoNuevo(nombre));
    // Lo primero de una obra nueva son sus datos y sus plantas (DO): se abren en cuanto el editor lo esté
    abrirGestor({ coleccion: "obra", inicio: true });
    if (!almacen) return proyecto.abrirTexto(texto, nombreFichero(nombre));
    creandoRef.current = true;
    setCreando(true);
    try {
      abrir(await crear(texto));
    } catch (e) {
      cerrarGestor();
      setError(`No se pudo crear el proyecto en el navegador: ${mensaje(e)}`);
    } finally {
      creandoRef.current = false;
      setCreando(false);
    }
  };

  /** Importar: un proyecto válido pasa al navegador; uno que no pasa el esquema se abre sin guardar, con sus errores. */
  const importar = async (f: File | undefined) => {
    if (!f || creandoRef.current) return;
    setError(null);
    creandoRef.current = true;
    setCreando(true);
    try {
      const texto = await f.text();
      const l = leerProyecto(texto);
      if (!l.valido || !almacen) return proyecto.abrirTexto(texto, f.name);
      // Se guarda el texto canónico (el mismo contenido y la misma huella)
      abrir(await crear(serializar(l.proyecto), f.name.replace(/\.json$/i, "")));
    } catch (e) {
      setError(`No se pudo importar ${f.name}: ${mensaje(e)}`);
    } finally {
      creandoRef.current = false;
      setCreando(false);
    }
  };

  // C-11: las acciones de la lista dicen por qué fallan (IndexedDB, el ejemplo sin conexión); antes el botón no hacía nada
  const exportar = async (x: Ficha) => {
    try {
      const l = await leer(x.id);
      if (l) descargar(l.texto, nombreFichero(x.nombre));
      else setError(`No se pudo exportar ${x.nombre}: ya no está en este navegador.`);
    } catch (e) {
      setError(`No se pudo exportar ${x.nombre}: ${mensaje(e)}`);
    }
  };
  const borrarProyecto = (x: Ficha) =>
    borrar(x.id).then(
      () => {
        setBorrando(null);
        releer();
      },
      (e: unknown) => {
        setBorrando(null);
        setError(`No se pudo borrar ${x.nombre}: ${mensaje(e)}`);
      },
    );
  const duplicarProyecto = (x: Ficha) => duplicar(x.id).then(releer, (e: unknown) => setError(`No se pudo duplicar ${x.nombre}: ${mensaje(e)}`));
  const abrirEjemplo = (k: string, e: { cargar: () => Promise<string> }) => {
    setError(null);
    e.cargar().then(
      (t) => proyecto.abrirTexto(t, `${k}.json`),
      (x: unknown) => setError(`No se pudo cargar el ejemplo (¿sin conexión?): ${mensaje(x)}`),
    );
  };


  const buscar = filtro.trim().toLocaleLowerCase("es");
  const visibles = mios?.filter((x) => x.nombre.toLocaleLowerCase("es").includes(buscar)) ?? [];
  const anillo = "focus-visible:outline-none focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--color-ring)]";
  const baldosa = "group flex min-h-[72px] items-center gap-3 rounded-lg border border-border-main bg-bg-primary px-4 py-3 text-left shadow-xs transition-colors hover:border-accent";
  const titulo = "text-[13px] font-semibold text-text-primary";

  return (
    <div
      className="relative flex h-full flex-col overflow-y-auto bg-bg-surface"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        arrastre.current++;
        setEncima(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        arrastre.current = Math.max(0, arrastre.current - 1);
        if (!arrastre.current) setEncima(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        arrastre.current = 0;
        setEncima(false);
        void importar(e.dataTransfer.files[0]);
      }}
    >
      <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b border-border-sub bg-bg-primary px-6">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-[18px] w-[18px]" aria-hidden="true" />
        <span className="text-[13px] font-semibold">Concreta · FEM 3D</span>
        <span className="flex-1" />
        <button type="button" className="ib" onClick={toggleTheme} aria-label={theme === "dark" ? "Tema claro" : "Tema oscuro"} title={theme === "dark" ? "Tema claro" : "Tema oscuro"}>
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </header>

      <main className="mx-auto grid w-full max-w-[1120px] gap-x-10 gap-y-8 px-6 pb-12 pt-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <div>
            <h1 className="text-[18px] font-semibold text-text-primary">Proyectos</h1>
            <p className="mt-1 text-[13px] text-text-secondary">
              Modelar, calcular y revisar estructuras por elementos finitos. Todo se hace en este equipo, y los proyectos se guardan solos en este navegador.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="grid gap-3 sm:grid-cols-2">
              {nuevo === null ? (
                <button type="button" className={`${baldosa} ${anillo} disabled:pointer-events-none disabled:opacity-50`} onClick={() => setNuevo("")} disabled={ocupado}>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-btn-primary-bg text-btn-primary-fg">
                    <FilePlus size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className={`block ${titulo} group-hover:text-accent-text`}>Proyecto nuevo</span>
                    <span className="block text-[12px] text-text-secondary">Se empieza por las plantas</span>
                  </span>
                </button>
              ) : (
                <form
                  className="flex min-h-[72px] flex-col justify-center gap-2 rounded-lg border border-accent bg-bg-primary px-4 py-3 shadow-[0_0_0_3px_var(--color-ring)]"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void crearNuevo();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setNuevo(null);
                  }}
                >
                  <span className="text-[12px] text-text-secondary">{almacen ? "Nombre del proyecto nuevo" : "Este navegador no guarda proyectos (¿modo privado?): guardar lo descargará. Nombre:"}</span>
                  <span className="flex gap-2">
                    {/* Un nombre es texto, no un número: la letra de la interfaz, no la monoespaciada de `.sel` (que, fuera de las capas, gana a una utilidad) */}
                    <input className="sel min-w-0 flex-1" style={{ fontFamily: "var(--font-sans)" }} autoFocus aria-label="Nombre del proyecto" placeholder="Proyecto nuevo" value={nuevo} onChange={(e) => setNuevo(e.target.value)} />
                    <button type="submit" className="btn btn-p" disabled={creando}>
                      {creando ? "Creando…" : "Crear"}
                    </button>
                    <button type="button" className="ib" aria-label="Cancelar" title="Cancelar (Esc)" onClick={() => setNuevo(null)} disabled={creando}>
                      <X size={15} />
                    </button>
                  </span>
                </form>
              )}
              {/* C-21: el foco está en el input (sr-only); el anillo lo pinta `has-[input:focus-visible]` */}
              <label className={`${baldosa} cursor-pointer has-[input:focus-visible]:border-accent has-[input:focus-visible]:shadow-[0_0_0_3px_var(--color-ring)] ${ocupado || creando ? "pointer-events-none opacity-50" : ""}`}>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-bg-elevated text-text-secondary">
                  <Upload size={18} />
                </span>
                <span className="min-w-0">
                  <span className={`block ${titulo} group-hover:text-accent-text`}>Importar un proyecto.json</span>
                  <span className="block text-[12px] text-text-secondary">O arrástrelo a esta ventana</span>
                </span>
                <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => {
                    // Vaciado, para que volver a elegir el mismo fichero tras un error lo vuelva a leer (C-37)
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    void importar(f);
                  }}
                  disabled={ocupado || creando}
                />
              </label>
            </div>
            {error && (
              <p role="alert" className="flex items-start gap-2 rounded-md bg-tint-fail px-3 py-2 text-[12px] text-state-fail-text">
                <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden="true" /> {error}
              </p>
            )}
            {ocupado && (
              <p role="status" className="flex items-center gap-2 text-[12px] text-text-secondary">
                <Loader2 size={14} className="animate-spin" aria-hidden="true" /> {proyecto.fase === "abriendo" ? "Abriendo y compilando…" : "Calculando…"}
              </p>
            )}
          </div>

          {almacen && (
            <section className="flex flex-col gap-2" aria-label="Mis proyectos">
              <div className="flex min-h-7 items-center gap-2">
                <h2 className={titulo}>Mis proyectos</h2>
                {!!mios?.length && <span className="rounded-full bg-bg-elevated px-1.5 text-[11px] tabular-nums text-text-secondary">{mios.length}</span>}
                <span className="flex-1" />
                {(mios?.length ?? 0) > 5 && (
                  <span className="relative">
                    <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true" />
                    <input type="search" className="sel h-7 w-52 max-w-full" style={{ paddingLeft: 28, fontFamily: "var(--font-sans)" }} placeholder="Buscar" aria-label="Buscar en mis proyectos" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
                  </span>
                )}
              </div>
              <div className="overflow-hidden rounded-lg border border-border-main bg-bg-primary shadow-xs">
                {mios === null ? (
                  <p className="px-4 py-6 text-center text-[12px] text-text-muted">Leyendo los proyectos…</p>
                ) : mios.length === 0 ? (
                  <div className="flex flex-col items-center px-6 py-8 text-center">
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-bg-elevated text-text-muted">
                      <Building2 size={18} aria-hidden="true" />
                    </span>
                    <p className="mt-2 text-[13px] font-medium text-text-primary">Aún no hay proyectos en este navegador</p>
                    <p className="mt-0.5 max-w-[360px] text-[12px] text-text-secondary">Empiece uno nuevo, importe un proyecto.json o abra un ejemplo para ver cómo se trabaja.</p>
                  </div>
                ) : !visibles.length ? (
                  <p className="px-4 py-6 text-center text-[12px] text-text-secondary">Ningún proyecto contiene «{filtro.trim()}».</p>
                ) : (
                  <ul className="list-none p-0">
                    {visibles.map((x) => (
                      <li key={x.id} className={`group flex min-h-14 items-center gap-2 border-t border-border-sub px-3 first:border-t-0 ${borrando === x.id ? "bg-tint-fail" : "hover:bg-bg-surface"}`}>
                        {borrando === x.id ? (
                          <>
                            <span className="min-w-0 flex-1 py-2 text-[12px]">
                              ¿Borrar <strong>{x.nombre}</strong> y sus versiones de este navegador? No se puede deshacer.
                            </span>
                            <button type="button" className="btn btn-peligro" onClick={() => void borrarProyecto(x)}>
                              Borrar
                            </button>
                            <button type="button" className="btn" onClick={() => setBorrando(null)}>
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <>
                            {/* El nombre accesible es el del proyecto; la fecha y el tamaño se ven debajo */}
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-3 self-stretch rounded-md py-2 text-left focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
                              disabled={ocupado}
                              onClick={() => abrir(x)}
                              aria-label={x.nombre}
                              title={`Abrir ${x.nombre}`}
                            >
                              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-tint-accent text-accent-text">
                                <Building2 size={16} aria-hidden="true" />
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-[13px] font-medium text-text-primary group-hover:text-accent-text">{x.nombre}</span>
                                <span className="block truncate text-[11px] tabular-nums text-text-secondary">
                                  Modificado {fechaCorta(x.modificado)} · {tamano(x.tamano)}
                                </span>
                              </span>
                            </button>
                            {/* Las acciones, al pasar o con el foco en la fila; en pantallas táctiles, siempre */}
                            <span className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                              <button type="button" className="ib" aria-label={`Exportar ${x.nombre}`} title={`Exportar: descarga «${nombreFichero(x.nombre)}»`} onClick={() => void exportar(x)}>
                                <Download size={15} />
                              </button>
                              <button type="button" className="ib" aria-label={`Versiones de ${x.nombre}`} title="Versiones anteriores" onClick={() => setVersionesDe(x)}>
                                <History size={15} />
                              </button>
                              <button type="button" className="ib" aria-label={`Duplicar ${x.nombre}`} title="Duplicar" onClick={() => void duplicarProyecto(x)}>
                                <Copy size={15} />
                              </button>
                              <button type="button" className="ib hover:text-state-fail-text" aria-label={`Borrar ${x.nombre}`} title="Borrar" onClick={() => setBorrando(x.id)}>
                                <Trash2 size={15} />
                              </button>
                            </span>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {persiste === false && !!mios?.length ? (
                <p className="flex items-start gap-1.5 text-[12px] text-state-warn-text">
                  <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden="true" /> El navegador no garantiza conservarlos: podría borrarlos si se queda sin espacio. Exporte los importantes.
                </p>
              ) : (
                !!mios?.length && (
                  <p className="text-[12px] text-text-muted">
                    Para llevar uno a otro equipo, expórtelo (<Download size={12} className="inline align-[-1px]" aria-label="Exportar" />) y vuelva a importarlo allí.
                  </p>
                )
              )}
            </section>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          <section className="flex flex-col gap-2" aria-label="Ejemplos">
            <div className="flex min-h-7 items-baseline gap-2">
              <h2 className={titulo}>Ejemplos</h2>
              <span className="text-[12px] text-text-muted">se abren sin guardar</span>
            </div>
            {/* D-29: tarjetas en el color del texto; el azul, sólo al pasar */}
            <ul className="flex list-none flex-col gap-2 p-0">
              {ORDEN_EJEMPLOS.map((k) => [k, EJEMPLOS[k]!] as const).map(([k, e]) => (
                <li key={k}>
                  <button type="button" className={`group w-full rounded-lg border border-border-sub bg-bg-primary px-3 py-2.5 text-left transition-colors hover:border-accent ${anillo} disabled:opacity-50`} disabled={ocupado} onClick={() => abrirEjemplo(k, e)}>
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 text-[13px] font-medium text-text-primary group-hover:text-accent-text">{e.titulo}</span>
                      {e.etiqueta && <span className="shrink-0 rounded-full bg-bg-elevated px-1.5 text-[11px] text-text-secondary">{e.etiqueta}</span>}
                      <ChevronRight size={14} className="shrink-0 text-text-muted group-hover:text-accent-text" aria-hidden="true" />
                    </span>
                    <span className="mt-0.5 block pr-5 text-[12px] leading-snug text-text-secondary">{e.detalle}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-lg border border-border-sub bg-bg-primary p-3" aria-label="Trabajar con el agente">
            <h2 className={`flex items-center gap-2 ${titulo}`}>
              <Terminal size={15} className="text-text-secondary" aria-hidden="true" /> Trabajar con el agente
            </h2>
            <p className="mt-1 text-[12px] leading-snug text-text-secondary">Con Claude Desktop, el agente valida, calcula, consulta y revisa los proyectos de una carpeta de su equipo, y abre esta app sobre ellos.</p>
            {/* agente.md §13.4: el paquete se publica con la web (pages.yml); con la dirección entera, para que
                también valga en el visor local y en desarrollo, donde no está */}
            <a className="btn mt-2" href={URL_EXTENSION} download>
              <Download size={15} /> Extensión para Claude Desktop
            </a>
            <details className="mt-1 text-[12px] text-text-secondary">
              <summary className="cursor-pointer text-text-muted hover:text-text-primary">¿Cómo se instala?</summary>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4 leading-snug">
                <li>Abra el fichero descargado con Claude Desktop (doble clic, o arrástrelo a Configuración → Extensiones) y pulse «Instalar». No hace falta nada más.</li>
                <li>Pase el proyecto a una carpeta («Pasar a una carpeta», en la barra de la app) y dé a Claude la ruta de su proyecto.json.</li>
                <li>Cuando haya una versión nueva de la app, descargue e instale otra vez la extensión.</li>
              </ol>
            </details>
            <p className="mt-2 text-[12px] leading-snug text-text-secondary">El agente lee el proyecto.json del disco. Ábralo aquí desde su carpeta y la app se recargará sola cuando el agente lo cambie.</p>
            {/* P-28: lo exportado lleva el nombre del proyecto (varios en Descargas no se pisan) */}
            <details className="mt-1 text-[12px] text-text-secondary">
              <summary className="cursor-pointer text-text-muted hover:text-text-primary">¿Y un proyecto exportado?</summary>
              <p className="mt-1 leading-snug">Exportar descarga el proyecto con su nombre («Nave.json»): la CLI y el visor lo leen igual con ese nombre, o renómbrelo a proyecto.json.</p>
            </details>
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
          </section>
        </aside>
      </main>

      {encima && (
        <div className="pointer-events-none fixed inset-0 z-20 grid place-items-center bg-velo-suave p-6">
          <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-accent bg-bg-primary px-10 py-8 text-center shadow-pop">
            <Upload size={28} className="text-accent" aria-hidden="true" />
            <p className="text-[15px] font-semibold text-text-primary">Suelte el proyecto.json para importarlo</p>
            <p className="text-[12px] text-text-secondary">{almacen ? "Se guardará en Mis proyectos." : "Se abrirá sin guardar."}</p>
          </div>
        </div>
      )}
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
