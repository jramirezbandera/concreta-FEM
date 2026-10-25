/**
 * La app (interfaz v4, `docs/fem3d/interfaz.md` §3 y §13): barra superior con los espacios de
 * trabajo, el estado del cálculo y las acciones del proyecto; el espacio elegido (Modelo, Cargas,
 * Resultados o Revisión) en la disposición común, y una barra de estado que dice de dónde salen los
 * resultados.
 *
 * Atajos:
 * - Ctrl+K: la paleta de órdenes;
 * - Ctrl+S guarda; Ctrl+Z y Ctrl+Y (o Ctrl+Mayús+Z) deshacen y rehacen fuera de un campo de texto
 *   (dentro, deshacen lo escrito en el campo);
 * - AvPág y RePág: la planta de arriba o la de abajo (con un alzado activo, el eje siguiente o el
 *   anterior de su dirección); Esc: soltar lo elegido;
 * - desde I2: F encuadra la vista activa y Ctrl+1…4 cambian la disposición de las vistas.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, FolderOpen, History, Moon, Play, Redo2, RefreshCw, Save, Search, Sun, Undo2 } from "lucide-react";
import { lista, indiceIds } from "../../src/editor/referencias.ts";
import { DEF_TABLAS, TABLAS, type NombreTabla } from "../../src/editor/tablas.ts";
import { ejeVecino } from "./armazon/Disposicion.tsx";
import { Paleta, type Orden } from "./armazon/Paleta.tsx";
import { DialogoVersiones } from "./armazon/Versiones.tsx";
import { hayAlmacen } from "./sesion/almacen.ts";
import { ContextoPaneles, useAlmacenPaneles, type EstadoPaneles } from "./armazon/paneles.ts";
import { ContextoVisor, type Espacio, type ModoResultados } from "./contexto.ts";
import { EspacioModelo } from "./espacios/Modelo.tsx";
import { EspacioResultados } from "./espacios/Resultados.tsx";
import { cota } from "./fmt.ts";
import { Inicio, abrirDesdeUrl } from "./Inicio.tsx";
import { EspacioRevision } from "./pantallas/Revision.tsx";
import { useProyecto, type ProyectoAbierto } from "./sesion/useProyecto.ts";
import { ContextoVistas, DISPOSICIONES, useEstadoVistas } from "./vistas/estado.ts";
import { encuadrarActiva } from "./vistas/Zona.tsx";
import { useTheme } from "./tema/useTheme.ts";

const ESPACIOS: { id: Espacio; nombre: string; calculo: boolean }[] = [
  { id: "modelo", nombre: "Modelo", calculo: false },
  { id: "cargas", nombre: "Cargas", calculo: false },
  { id: "resultados", nombre: "Resultados", calculo: true },
  { id: "revision", nombre: "Revisión", calculo: true },
];

const MODOS: { id: ModoResultados; nombre: string }[] = [
  { id: "losas", nombre: "Losas" },
  { id: "diagramas", nombre: "Diagramas de vigas" },
  { id: "pilares", nombre: "Pilares" },
  { id: "armado", nombre: "Armado de losas" },
  { id: "deformada", nombre: "Deformada y desplomes" },
  { id: "reacciones", nombre: "Reacciones" },
];

/** `?espacio=…&modo=…` o, como en V1, `?pantalla=…`. */
function inicial(): { espacio: Espacio; modo: ModoResultados } {
  const q = new URLSearchParams(location.search);
  const viejo: Record<string, [Espacio, ModoResultados?]> = { modelo: ["modelo"], losas: ["resultados", "losas"], vigas: ["resultados", "diagramas"], pilares: ["resultados", "pilares"], desplomes: ["resultados", "deformada"], revision: ["revision"] };
  const p = viejo[q.get("pantalla") ?? ""];
  const espacio = (q.get("espacio") as Espacio | null) ?? p?.[0] ?? "modelo";
  const modo = (q.get("modo") as ModoResultados | null) ?? p?.[1] ?? "losas";
  return { espacio: ESPACIOS.some((x) => x.id === espacio) ? espacio : "modelo", modo: MODOS.some((x) => x.id === modo) ? modo : "losas" };
}

function Estado({ p }: { p: ProyectoAbierto }) {
  return (
    <span data-estado={p.desactualizado ? "desactualizado" : p.fase === "error" ? "error" : !p.estado ? "vacio" : p.estado.compilando ? "compilando" : !p.estado.compila ? "no-compila" : p.estado.calculado ? "calculado" : "sin-calcular"} data-huella={p.estado?.huella ?? ""}>
      <TextoEstado p={p} />
    </span>
  );
}

function TextoEstado({ p }: { p: ProyectoAbierto }) {
  const e = p.estado;
  if (p.desactualizado) return <span className="pill warn">{p.fase === "calculando" ? "CALCULANDO" : p.edicion?.pendiente ? "LEYENDO LO EDITADO" : "ABRIENDO"} · RESULTADOS DESACTUALIZADOS</span>;
  if (p.fase === "calculando") return <span className="pill warn">CALCULANDO · {e?.huella.slice(0, 8)}</span>;
  if (p.fase === "error") return <span className="pill fail">{e && e.compila ? "EL CÁLCULO FALLÓ" : "NO SE PUEDE ABRIR"}</span>;
  if (!e) return null;
  if (e.compilando) return <span className="pill warn" title="Lo que sólo necesita el modelo ya se dibuja; los diagnósticos, la malla y el cálculo esperan a la compilación">COMPILANDO · {e.huella.slice(0, 8)}</span>;
  if (!e.compila) return <span className="pill fail">NO COMPILA · {e.huella.slice(0, 8)}</span>;
  if (e.calculado) return <span className="pill ok">CALCULADO · {e.huella.slice(0, 8)}</span>;
  return <span className="pill neu">SIN CALCULAR · {e.huella.slice(0, 8)}</span>;
}

const enCampo = (t: EventTarget | null) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

export function App() {
  const proyecto = useProyecto();
  const { theme, toggleTheme } = useTheme();
  const paneles = useAlmacenPaneles();
  const [{ espacio, modo }, setDonde] = useState(inicial);
  const [elegidos, setElegidosE] = useState<string[]>([]);
  const seleccion = elegidos[elegidos.length - 1] ?? null;
  const [paleta, setPaleta] = useState(false);
  const [versionesAbiertas, setVersionesAbiertas] = useState(false);
  const [tablaPedida, setTablaPedida] = useState<{ tabla: NombreTabla; n: number } | null>(null);

  // ?proyecto=<url> o ?ejemplo=<nombre>: abrir al cargar
  useEffect(() => {
    void abrirDesdeUrl(proyecto);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al cargar la página
  }, []);

  const e = proyecto.estado;
  const ed = proyecto.edicion;
  // Las vistas, recordadas por proyecto (I2); la planta es la de la vista activa
  const vistas = useEstadoVistas(e?.nombre ?? (proyecto.fuente?.tipo === "origen" ? proyecto.fuente.origen.fichero : (proyecto.fuente?.nombre ?? "")));
  const planta = vistas.vistas[vistas.activa]!.planta;
  const { poner: ponerVista, activa: vistaActiva, setDisposicion } = vistas;
  const vistasRef = useRef(vistas);
  vistasRef.current = vistas;
  const elegidosRef = useRef(elegidos);
  elegidosRef.current = elegidos;
  const setPlanta = useCallback((p: string) => ponerVista(vistaActiva, { planta: p }), [ponerVista, vistaActiva]);
  // Resultados y Revisión sólo con un cálculo de esta huella (criterio 3 de I1)
  const espacioValido: Espacio = (espacio === "resultados" || espacio === "revision") && !e?.calculado ? "modelo" : espacio;
  const clave = espacioValido === "resultados" ? `resultados:${modo}` : espacioValido;

  const irA = useCallback((x: Espacio, m?: ModoResultados) => setDonde((d) => ({ espacio: x, modo: m ?? d.modo })), []);
  const { cambiar } = paneles;
  const setElegidos = useCallback(
    (ids: string[]) => {
      setElegidosE((x) => (x.length === ids.length && x.every((y, i) => y === ids[i]) ? x : ids));
      if (ids.length) cambiar(clave, { props: true });
    },
    [cambiar, clave],
  );
  const setSeleccion = useCallback((id: string | null) => setElegidos(id ? [id] : []), [setElegidos]);
  const pedirTabla = useCallback((t: NombreTabla) => {
    setTablaPedida((x) => ({ tabla: t, n: (x?.n ?? 0) + 1 }));
    setDonde((d) => ({ ...d, espacio: d.espacio === "cargas" ? "cargas" : "modelo" }));
  }, []);

  // La planta elegida se conserva al recargar si sigue existiendo; si no, la primera
  const plantas = e?.plantas;
  const plantaValida = plantas?.some((p) => p.id === planta) ? planta : (plantas?.[0]?.id ?? null);

  // Atajos
  useEffect(() => {
    const f = (x: KeyboardEvent) => {
      const mod = x.ctrlKey || x.metaKey;
      const k = x.key.toLowerCase();
      if (mod && !x.altKey && k === "k") {
        x.preventDefault();
        setPaleta((v) => !v);
        return;
      }
      if (mod && !x.altKey && !x.shiftKey && ["1", "2", "3", "4"].includes(x.key) && !document.querySelector("[role=dialog]")) {
        x.preventDefault();
        setDisposicion(DISPOSICIONES[Number(x.key) - 1]!.id);
        return;
      }
      if (paleta || document.querySelector("[role=dialog]")) return;
      // I3: H aísla lo elegido en el 3D activo (otra vez, lo suelta); Ctrl+H lo oculta; Mayús+H lo muestra todo
      if (k === "h" && !x.altKey && !enCampo(x.target) && !(x.target as HTMLElement | null)?.closest?.("[role=grid]")) {
        const v = vistasRef.current.vistas[vistasRef.current.activa];
        if (v?.tipo !== "3d") return;
        x.preventDefault();
        const f = v.filtro ?? {};
        const ids = elegidosRef.current;
        if (x.shiftKey) ponerVista(vistaActiva, { filtro: { caja: f.caja ?? null } });
        else if (mod) {
          if (ids.length) ponerVista(vistaActiva, { filtro: { ...f, ocultos: [...new Set([...(f.ocultos ?? []), ...ids])] } });
        } else if (f.aislados) ponerVista(vistaActiva, { filtro: { ...f, aislados: null } });
        else if (ids.length) ponerVista(vistaActiva, { filtro: { ...f, aislados: [...ids] } });
        return;
      }
      if (mod && !x.altKey && ed) {
        if (k === "s") {
          x.preventDefault();
          void (ed.modo === "descargar" && hayAlmacen() ? ed.alNavegador() : ed.guardar());
        } else if (!enCampo(x.target) && k === "z" && !x.shiftKey) {
          x.preventDefault();
          ed.deshacer();
        } else if (!enCampo(x.target) && (k === "y" || (k === "z" && x.shiftKey))) {
          x.preventDefault();
          ed.rehacer();
        }
        return;
      }
      if (mod || x.altKey || enCampo(x.target) || (x.target as HTMLElement | null)?.closest?.("[role=grid]")) return;
      const va = vistasRef.current.vistas[vistasRef.current.activa];
      if ((x.key === "PageUp" || x.key === "PageDown") && va?.tipo === "alzado" && e?.ejes.length) {
        x.preventDefault();
        const actual = e.ejes.some((y) => y.id === va.eje) ? va.eje! : e.ejes[0]!.id;
        const otro = ejeVecino(e.ejes, actual, x.key === "PageUp" ? -1 : 1);
        if (otro) ponerVista(vistaActiva, { eje: otro });
      } else if ((x.key === "PageUp" || x.key === "PageDown") && plantas?.length) {
        x.preventDefault();
        const i = plantas.findIndex((p) => p.id === plantaValida);
        const j = Math.max(0, Math.min(plantas.length - 1, i + (x.key === "PageUp" ? -1 : 1)));
        setPlanta(plantas[j]!.id);
      } else if (x.key === "Escape") setElegidosE([]);
      else if (x.key === "f" || x.key === "F") encuadrarActiva();
      else if (x.key === "F7" && va) {
        // La rejilla de la vista activa, como en AutoCAD
        x.preventDefault();
        ponerVista(vistaActiva, { rejilla: va.rejilla === false });
      }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [ed, e, paleta, plantas, plantaValida, setPlanta, setDisposicion, ponerVista, vistaActiva]);

  const navegador = proyecto.fuente?.tipo === "origen" ? proyecto.fuente.origen.navegador : undefined;
  // Lo que aún no se ha guardado, antes de ver las versiones (restaurar parte de lo guardado)
  const abrirVersiones = () => void (ed?.sinGuardar ? ed.guardar() : Promise.resolve()).then(() => setVersionesAbiertas(true));

  // Órdenes de la paleta
  const ordenes = useMemo<Orden[]>(() => {
    const r: Orden[] = [];
    for (const x of ESPACIOS) r.push({ id: `esp-${x.id}`, grupo: "Espacio", nombre: x.nombre, hacer: () => irA(x.id), deshabilitada: x.calculo && !e?.calculado });
    for (const m of MODOS) r.push({ id: `modo-${m.id}`, grupo: "Resultados", nombre: m.nombre, hacer: () => irA("resultados", m.id), deshabilitada: !e?.calculado });
    for (const p of e?.plantas ?? []) r.push({ id: `planta-${p.id}`, grupo: "Planta", nombre: `${p.id} ${cota(p.cota)}${p.nombre ? ` · ${p.nombre}` : ""}`, hacer: () => setPlanta(p.id) });
    if (ed) for (const t of TABLAS) r.push({ id: `tabla-${t}`, grupo: "Tabla", nombre: DEF_TABLAS[t].titulo, hacer: () => pedirTabla(t) });
    const vivo: Partial<EstadoPaneles> = paneles.vivos.get(clave) ?? {};
    r.push(
      { id: "calcular", grupo: "Proyecto", nombre: e?.calculado ? "Recalcular" : "Calcular", hacer: () => (e?.calculado || !proyecto.calcular ? proyecto.recalcular() : proyecto.calcular()), deshabilitada: !e?.compila || proyecto.fase === "calculando" || (!!ed && proyecto.desactualizado) },
      ...(ed?.modo === "escribir" ? [{ id: "guardar", grupo: "Proyecto", nombre: "Guardar", atajo: "Ctrl S", hacer: () => void ed.guardar(), deshabilitada: !ed.sinGuardar }] : []),
      ...(ed?.modo === "descargar" && hayAlmacen() ? [{ id: "al-navegador", grupo: "Proyecto", nombre: "Guardar en mis proyectos (en este navegador)", atajo: "Ctrl S", hacer: () => void ed.alNavegador() }] : []),
      { id: "exportar", grupo: "Proyecto", nombre: "Exportar el proyecto.json", hacer: () => ed?.exportar(), deshabilitada: !ed },
      ...(ed?.modo === "auto" ? [{ id: "versiones", grupo: "Proyecto", nombre: "Versiones anteriores…", hacer: abrirVersiones }] : []),
      { id: "deshacer", grupo: "Proyecto", nombre: ed?.deshacerEtiqueta ? `Deshacer: ${ed.deshacerEtiqueta}` : "Deshacer", atajo: "Ctrl Z", hacer: () => ed?.deshacer(), deshabilitada: !ed?.deshacerEtiqueta },
      { id: "rehacer", grupo: "Proyecto", nombre: ed?.rehacerEtiqueta ? `Rehacer: ${ed.rehacerEtiqueta}` : "Rehacer", atajo: "Ctrl Y", hacer: () => ed?.rehacer(), deshabilitada: !ed?.rehacerEtiqueta },
      { id: "abrir", grupo: "Proyecto", nombre: "Mis proyectos (abrir otro)", hacer: () => location.assign(location.pathname) },
      { id: "nav", grupo: "Paneles", nombre: vivo.nav === false ? "Abrir el navegador" : "Plegar el navegador", hacer: () => cambiar(clave, { nav: vivo.nav === false }) },
      { id: "props", grupo: "Paneles", nombre: vivo.props === false ? "Abrir las propiedades" : "Plegar las propiedades", hacer: () => cambiar(clave, { props: vivo.props === false }) },
      { id: "dock", grupo: "Paneles", nombre: vivo.dock ? "Plegar el panel inferior" : "Abrir el panel inferior", hacer: () => cambiar(clave, { dock: !vivo.dock }) },
      { id: "tema", grupo: "Vista", nombre: theme === "dark" ? "Tema claro" : "Tema oscuro", hacer: toggleTheme },
      { id: "soltar", grupo: "Vista", nombre: "Soltar lo elegido", atajo: "Esc", hacer: () => setElegidosE([]), deshabilitada: !seleccion },
      { id: "encuadrar", grupo: "Vista", nombre: "Encuadrar la vista activa", atajo: "F", hacer: encuadrarActiva },
      ...DISPOSICIONES.map((d) => ({ id: `disp-${d.id}`, grupo: "Vistas", nombre: d.nombre, atajo: d.atajo, hacer: () => vistas.setDisposicion(d.id) })),
      ...(["planta", "alzado", "3d"] as const).map((t) => ({ id: `tipo-${t}`, grupo: "Vistas", nombre: `La vista activa, ${t === "3d" ? "en 3D" : `en ${t}`}`, hacer: () => vistas.irATipo(t), deshabilitada: t === "alzado" && !e?.ejes.length })),
      ...(e?.ejes ?? []).map((x) => ({ id: `alzado-${x.id}`, grupo: "Alzado", nombre: `Eje ${x.nombre ?? x.id}${x.propuesto ? " (propuesto)" : ""}`, hacer: () => vistas.abrirAlzado(x.id) })),
    );
    return r;
  }, [e, ed, proyecto, irA, pedirTabla, paneles, clave, cambiar, theme, toggleTheme, seleccion, vistas]);

  // Los objetos del proyecto, para la paleta: elegirlo y llevar su planta
  const m = ed?.proyecto.modelo;
  const objetos = useCallback(
    (consulta: string): Orden[] => {
      if (!m || consulta.trim().length < 1) return [];
      const r: Orden[] = [];
      for (const [id, { coleccion }] of indiceIds(m)) {
        if (coleccion === "plantas") continue;
        r.push({
          id: `obj-${id}`,
          grupo: coleccion,
          nombre: id,
          hacer: () => {
            const o = lista(m, coleccion).find((x) => x.id === id) as { planta?: unknown; hasta?: unknown } | undefined;
            if (typeof o?.planta === "string") setPlanta(o.planta);
            else if (typeof o?.hasta === "string") setPlanta(o.hasta);
            setSeleccion(id);
          },
        });
      }
      return r;
    },
    [m, setSeleccion],
  );

  if (!e && proyecto.fase !== "error") return <Inicio proyecto={proyecto} />;

  const pie =
    proyecto.fuente?.tipo === "origen"
      ? proyecto.fuente.origen.navegador
        ? `${proyecto.fuente.origen.descripcion} · se guarda solo${ed?.guardado.tipo === "guardado" && ed.guardado.ms ? ` (en ${ed.guardado.ms.toFixed(0)} ms)` : ""}`
        : `${proyecto.fuente.origen.descripcion} · vigilando cambios${ed?.guardado.tipo === "guardado" ? ` · guardado en ${ed.guardado.ms.toFixed(0)} ms` : ""}`
      : proyecto.fuente
        ? `${proyecto.fuente.nombre} · sin guardar en ningún sitio${hayAlmacen() ? " (Guardar en mis proyectos, o Exportar)" : " (Exportar lo descarga)"}`
        : "";
  const resultados = !e?.calculado
    ? ""
    : e.origen === "guardados"
      ? `resultados de .fem/${e.huella.slice(0, 8)} (CLI) · leídos en ${(proyecto.tiempos.guardados ?? 0).toFixed(2)} s`
      : `compilado en ${(proyecto.tiempos.abrir ?? 0).toFixed(2)} s y calculado en el visor en ${(proyecto.tiempos.calcular ?? 0).toFixed(2)} s${proyecto.motivoGuardados ? ` · .fem no se usó: ${proyecto.motivoGuardados}` : ""}`;

  return (
    <ContextoPaneles.Provider value={paneles}>
      <ContextoVistas.Provider value={vistas}>
      <ContextoVisor.Provider value={{ proyecto, planta: plantaValida, setPlanta, seleccion, setSeleccion, elegidos, setElegidos, espacio: espacioValido, modo, irA, tablaPedida, pedirTabla }}>
        <div className="flex h-full flex-col">
          <header className="barra-sup">
            <span className="flex shrink-0 items-center gap-1.5 text-[15px] font-semibold">
              <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-[18px] w-[18px]" aria-hidden="true" />
              Concreta
            </span>
            <span className="min-w-0 max-w-[340px] shrink truncate px-1 text-[13px] text-text-primary" title={e?.nombre ?? undefined}>
              {e?.nombre ?? (proyecto.fuente?.tipo === "origen" ? proyecto.fuente.origen.fichero : (proyecto.fuente?.nombre ?? ""))}
            </span>
            <nav className="espacios" aria-label="Espacios de trabajo">
              {ESPACIOS.map((x) => (
                <button key={x.id} type="button" aria-current={espacioValido === x.id ? "page" : undefined} disabled={x.calculo && !e?.calculado} title={x.calculo && !e?.calculado ? "Necesita el cálculo" : undefined} onClick={() => irA(x.id)}>
                  {x.nombre}
                </button>
              ))}
            </nav>
            <span className="flex-1" />
            {ed ? (
              <>
                <button type="button" className="ib" onClick={ed.deshacer} disabled={!ed.deshacerEtiqueta} title={ed.deshacerEtiqueta ? `Deshacer: ${ed.deshacerEtiqueta} (Ctrl+Z)` : "Nada que deshacer"} aria-label="Deshacer">
                  <Undo2 size={16} />
                </button>
                <button type="button" className="ib" onClick={ed.rehacer} disabled={!ed.rehacerEtiqueta} title={ed.rehacerEtiqueta ? `Rehacer: ${ed.rehacerEtiqueta} (Ctrl+Y)` : "Nada que rehacer"} aria-label="Rehacer">
                  <Redo2 size={16} />
                </button>
                {ed.modo === "auto" ? (
                  // AL-b: se guarda solo; aquí sólo se dice cómo va
                  <span className="flex items-center gap-1 px-1 text-[12px] text-text-secondary" role="status" aria-label="Estado del guardado" data-sin-guardar={ed.sinGuardar} title="Se guarda solo en este navegador">
                    {ed.sinGuardar ? (
                      "Guardando…"
                    ) : (
                      <>
                        <Check size={14} /> Guardado
                      </>
                    )}
                  </span>
                ) : ed.modo === "descargar" && hayAlmacen() ? (
                  <button type="button" className="btn btn-p" onClick={() => void ed.alNavegador()} title="Guardarlo en este navegador, con los demás proyectos (Ctrl+S); desde ahí se guarda solo">
                    <Save size={15} /> Guardar en mis proyectos
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`btn ${ed.sinGuardar ? "btn-p" : ""}`}
                    onClick={() => void ed.guardar()}
                    disabled={!ed.sinGuardar || ed.guardado.tipo === "guardando"}
                    data-sin-guardar={ed.sinGuardar}
                    title={ed.modo === "escribir" ? `Guardar en ${proyecto.fuente?.tipo === "origen" ? proyecto.fuente.origen.fichero : ""} (Ctrl+S)` : "Este navegador no guarda proyectos: guardar descarga el fichero (Ctrl+S)"}
                  >
                    <Save size={15} /> {ed.guardado.tipo === "guardando" ? "Guardando…" : ed.modo === "escribir" ? "Guardar" : "Descargar"}
                    {ed.sinGuardar && <span aria-label="sin guardar">●</span>}
                  </button>
                )}
                {navegador && (
                  <button type="button" className="ib" onClick={abrirVersiones} aria-label="Versiones anteriores" title="Versiones anteriores">
                    <History size={16} />
                  </button>
                )}
                <button type="button" className="ib" onClick={ed.exportar} aria-label="Exportar el proyecto.json" title="Exportar el proyecto.json (descargarlo)">
                  <Download size={16} />
                </button>
              </>
            ) : (
              <span className="pill neu" title="Este fichero no es un proyecto válido: no se puede editar">
                SÓLO LECTURA
              </span>
            )}
            <Estado p={proyecto} />
            {ed && e?.compila && !e.calculado && !proyecto.desactualizado ? (
              <button type="button" className="btn btn-p" onClick={proyecto.calcular} disabled={proyecto.fase === "calculando"} title="Calcular esta versión del proyecto">
                <Play size={15} /> {proyecto.fase === "calculando" ? "Calculando…" : "Calcular"}
              </button>
            ) : (
              <button type="button" className="btn" onClick={proyecto.recalcular} disabled={!e?.compila || proyecto.fase === "calculando" || (!!ed && proyecto.desactualizado)} title="Calcular de nuevo, sin usar los resultados de .fem/">
                <RefreshCw size={15} /> Recalcular
              </button>
            )}
            <button type="button" className="btn" style={{ gap: 14, color: "var(--color-text-disabled)" }} onClick={() => setPaleta(true)} title="Paleta de órdenes (Ctrl+K)">
              <span className="flex items-center gap-1.5">
                <Search size={15} /> Buscar u ordenar
              </span>
              <span className="kbd">Ctrl K</span>
            </button>
            <button type="button" className="btn" onClick={() => location.assign(location.pathname)} title="Mis proyectos: abrir otro">
              <FolderOpen size={15} /> Proyectos
            </button>
            <button type="button" className="ib" onClick={toggleTheme} aria-label={theme === "dark" ? "Tema claro" : "Tema oscuro"} title={theme === "dark" ? "Tema claro" : "Tema oscuro"}>
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </header>

          {ed?.conflicto && (
            <div className="banda warn" role="alert">
              <span className="min-w-0 flex-1">
                <strong>{ed.conflicto}</strong> No se ha recargado ni sobrescrito nada.
              </span>
              <button type="button" className="btn" onClick={ed.recargarDisco}>
                {navegador ? "Recargar lo guardado" : "Recargar del disco"} (se pierden los cambios de aquí)
              </button>
              <button type="button" className="btn" onClick={() => void ed.guardar({ forzar: true })}>
                {navegador ? "Sobrescribir lo guardado" : "Sobrescribir el del disco"}
              </button>
            </div>
          )}
          {versionesAbiertas && navegador && ed && (
            <DialogoVersiones
              id={navegador}
              nombre={e?.nombre ?? "el proyecto"}
              onCerrar={() => setVersionesAbiertas(false)}
              onRestaurada={() => {
                setVersionesAbiertas(false);
                ed.recargarDisco();
              }}
            />
          )}
          {ed?.guardado.tipo === "error" && (
            <div className="banda fail" role="alert">
              <span className="min-w-0 flex-1">
                <strong>No se guardó.</strong> {ed.guardado.mensaje} Los cambios siguen aquí.
              </span>
              <button type="button" className="btn" onClick={() => void ed.guardar()}>
                Reintentar
              </button>
            </div>
          )}

          <main className="flex min-h-0 flex-1">
            {proyecto.fase === "error" && !e ? (
              <PantallaError p={proyecto} />
            ) : espacioValido === "resultados" ? (
              <EspacioResultados />
            ) : espacioValido === "revision" ? (
              <EspacioRevision />
            ) : (
              <EspacioModelo key={espacioValido} espacio={espacioValido} />
            )}
          </main>

          <footer className="barra-estado">
            <span className="shrink-0 whitespace-nowrap mono" data-cursor="" aria-live="off" />
            <span className="min-w-0 shrink truncate">{pie}</span>
            <span className="min-w-0 flex-1 truncate">{resultados}</span>
            <span className="shrink-0">kN · m</span>
            {e?.estadisticas && (
              <span className="shrink-0 whitespace-nowrap">
                {e.estadisticas.nudos} nudos{e.estadisticas.ecuaciones ? ` · ${e.estadisticas.ecuaciones} ecuaciones` : ""} · {e.estadisticas.barras} barras · {e.estadisticas.laminas} láminas
              </span>
            )}
            {e?.sha256Resultados && (
              <span className="shrink-0 whitespace-nowrap" title={`sha256 de resultados.bin: ${e.sha256Resultados}`} data-sha={e.sha256Resultados} data-origen={e.origen}>
                resultados {e.sha256Resultados.slice(0, 8)}
              </span>
            )}
            {proyecto.cliente?.motor && <span className="shrink-0 whitespace-nowrap" title="sha256 del núcleo WASM">núcleo {proyecto.cliente.motor.slice(0, 8)}</span>}
          </footer>
        </div>
        {paleta && <Paleta ordenes={ordenes} objetos={objetos} onCerrar={() => setPaleta(false)} />}
      </ContextoVisor.Provider>
      </ContextoVistas.Provider>
    </ContextoPaneles.Provider>
  );
}

function PantallaError({ p }: { p: ProyectoAbierto }) {
  return (
    <div className="mx-auto mt-16 w-[640px] max-w-full">
      <h1 className="text-[15px] font-semibold">No se pudo abrir el proyecto</h1>
      <p className="mt-1 text-text-secondary">El fichero no es un proyecto válido (JSON o esquema). Corríjalo y la app lo recargará sola si lo abrió desde su carpeta.</p>
      <ul className="mt-4 list-none p-0">
        {p.errores.map((d, i) => (
          <li key={i} className="border-b border-border-sub py-2 text-[12px]">
            <span className="mono text-text-disabled">{d.codigo}</span>
            <p className="mt-0.5">{d.mensaje}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
