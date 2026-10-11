/**
 * Visor y editor (V1 y V2a, docs/fem3d/visor.md). Cabecera con las seis pantallas, el estado del
 * cálculo y, si el proyecto se puede editar, deshacer, rehacer, guardar y calcular; la pantalla
 * elegida y un pie que dice de dónde salen los resultados.
 *
 * Atajos: Ctrl+S guarda; Ctrl+Z y Ctrl+Y (o Ctrl+Mayús+Z) deshacen y rehacen fuera de un campo de
 * texto (dentro, deshacen lo escrito en el campo).
 */
import { useEffect, useState } from "react";
import { FolderOpen, Moon, Play, Redo2, RefreshCw, Save, Sun, Undo2 } from "lucide-react";
import { ContextoVisor, type Pantalla } from "./contexto.ts";
import { useProyecto, type ProyectoAbierto } from "./sesion/useProyecto.ts";
import { useTheme } from "./tema/useTheme.ts";
import { Inicio, abrirDesdeUrl } from "./Inicio.tsx";
import { PantallaModelo } from "./pantallas/Modelo.tsx";
import { PantallaLosas } from "./pantallas/Losas.tsx";
import { PantallaVigas } from "./pantallas/Vigas.tsx";
import { PantallaPilares } from "./pantallas/Pilares.tsx";
import { PantallaDesplomes } from "./pantallas/Desplomes.tsx";
import { PantallaRevision } from "./pantallas/Revision.tsx";

const PANTALLAS: { id: Pantalla; nombre: string; calculo: boolean }[] = [
  { id: "modelo", nombre: "Modelo", calculo: false },
  { id: "losas", nombre: "Losas", calculo: true },
  { id: "vigas", nombre: "Vigas", calculo: true },
  { id: "pilares", nombre: "Pilares", calculo: true },
  { id: "desplomes", nombre: "Desplomes", calculo: true },
  { id: "revision", nombre: "Revisión", calculo: true },
];

function Estado({ p }: { p: ProyectoAbierto }) {
  return (
    <span data-estado={p.desactualizado ? "desactualizado" : p.fase === "error" ? "error" : !p.estado ? "vacio" : !p.estado.compila ? "no-compila" : p.estado.calculado ? "calculado" : "sin-calcular"} data-huella={p.estado?.huella ?? ""}>
      <TextoEstado p={p} />
    </span>
  );
}

function TextoEstado({ p }: { p: ProyectoAbierto }) {
  const e = p.estado;
  if (p.desactualizado) return <span className="pill warn">{p.fase === "calculando" ? "CALCULANDO" : p.edicion?.pendiente ? "COMPILANDO LO EDITADO" : "ABRIENDO"} · RESULTADOS DESACTUALIZADOS</span>;
  if (p.fase === "calculando") return <span className="pill warn">CALCULANDO · {e?.huella.slice(0, 8)}</span>;
  if (p.fase === "error") return <span className="pill fail">{e && e.compila ? "EL CÁLCULO FALLÓ" : "NO SE PUEDE ABRIR"}</span>;
  if (!e) return null;
  if (!e.compila) return <span className="pill fail">NO COMPILA · {e.huella.slice(0, 8)}</span>;
  if (e.calculado) return <span className="pill ok">CALCULADO · {e.huella.slice(0, 8)}</span>;
  return <span className="pill neu">SIN CALCULAR · {e.huella.slice(0, 8)}</span>;
}

export function App() {
  const proyecto = useProyecto();
  const { theme, toggleTheme } = useTheme();
  const [pantalla, setPantalla] = useState<Pantalla>(() => (new URLSearchParams(location.search).get("pantalla") as Pantalla | null) ?? "modelo");
  const [planta, setPlanta] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<string | null>(null);

  // ?proyecto=<url> o ?ejemplo=<nombre>: abrir al cargar
  useEffect(() => {
    void abrirDesdeUrl(proyecto);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al cargar la página
  }, []);

  // Atajos del editor
  const ed = proyecto.edicion;
  useEffect(() => {
    if (!ed) return;
    const f = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const enCampo = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (k === "s") {
        e.preventDefault();
        void ed.guardar();
      } else if (!enCampo && k === "z" && !e.shiftKey) {
        e.preventDefault();
        ed.deshacer();
      } else if (!enCampo && (k === "y" || (k === "z" && e.shiftKey))) {
        e.preventDefault();
        ed.rehacer();
      }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [ed]);

  // La planta elegida se conserva al recargar si sigue existiendo; si no, la primera
  const plantas = proyecto.estado?.plantas;
  const plantaValida = plantas?.some((p) => p.id === planta) ? planta : (plantas?.[0]?.id ?? null);

  if (!proyecto.estado && proyecto.fase !== "error") return <Inicio proyecto={proyecto} />;

  const e = proyecto.estado;
  const pie =
    proyecto.fuente?.tipo === "origen"
      ? `${proyecto.fuente.origen.descripcion} · vigilando cambios${ed?.guardado.tipo === "guardado" ? ` · guardado en ${ed.guardado.ms.toFixed(0)} ms` : ""}`
      : proyecto.fuente
        ? `${proyecto.fuente.nombre} · sin vigilancia (ábralo desde su carpeta para recargarlo solo y guardar en él)`
        : "";
  const resultados = !e?.calculado
    ? ""
    : e.origen === "guardados"
      ? `resultados de .fem/${e.huella.slice(0, 8)} (CLI) · leídos en ${(proyecto.tiempos.guardados ?? 0).toFixed(2)} s`
      : `compilado en ${(proyecto.tiempos.abrir ?? 0).toFixed(2)} s y calculado en el visor en ${(proyecto.tiempos.calcular ?? 0).toFixed(2)} s${proyecto.motivoGuardados ? ` · .fem no se usó: ${proyecto.motivoGuardados}` : ""}`;

  return (
    <ContextoVisor.Provider value={{ proyecto, planta: plantaValida, setPlanta, seleccion, setSeleccion, irA: setPantalla }}>
      <div className="flex h-full flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border-main bg-bg-primary px-3">
          <span className="flex shrink-0 items-center gap-1.5 text-[15px] font-semibold">
            <span className="inline-block h-[7px] w-[7px] rounded-full bg-accent" aria-hidden="true" />
            Concreta
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] uppercase tracking-[0.06em] text-text-disabled">
            Análisis / FEM 3D / <span className="normal-case tracking-normal text-text-primary">{e?.nombre ?? (proyecto.fuente?.tipo === "origen" ? proyecto.fuente.origen.fichero : (proyecto.fuente?.nombre ?? ""))}</span>
          </span>
          <nav className="seg ml-2 shrink-0" aria-label="Pantallas">
            {PANTALLAS.map((x) => (
              <button key={x.id} type="button" data-on={pantalla === x.id} aria-current={pantalla === x.id ? "page" : undefined} disabled={x.calculo && !e?.calculado} title={x.calculo && !e?.calculado ? "Necesita el cálculo" : undefined} onClick={() => setPantalla(x.id)}>
                {x.nombre}
              </button>
            ))}
          </nav>
          {ed ? (
            <>
              <button type="button" className="btn" style={{ width: 28, padding: 0 }} onClick={ed.deshacer} disabled={!ed.deshacerEtiqueta} title={ed.deshacerEtiqueta ? `Deshacer: ${ed.deshacerEtiqueta} (Ctrl+Z)` : "Nada que deshacer"} aria-label="Deshacer">
                <Undo2 size={14} />
              </button>
              <button type="button" className="btn" style={{ width: 28, padding: 0 }} onClick={ed.rehacer} disabled={!ed.rehacerEtiqueta} title={ed.rehacerEtiqueta ? `Rehacer: ${ed.rehacerEtiqueta} (Ctrl+Y)` : "Nada que rehacer"} aria-label="Rehacer">
                <Redo2 size={14} />
              </button>
              <button
                type="button"
                className={`btn ${ed.sinGuardar ? "btn-p" : ""}`}
                onClick={() => void ed.guardar()}
                disabled={!ed.sinGuardar || ed.guardado.tipo === "guardando"}
                data-sin-guardar={ed.sinGuardar}
                title={ed.modo === "escribir" ? `Guardar en ${proyecto.fuente?.tipo === "origen" ? proyecto.fuente.origen.fichero : ""} (Ctrl+S)` : "Sin carpeta: guardar descarga el fichero (Ctrl+S)"}
              >
                <Save size={14} /> {ed.guardado.tipo === "guardando" ? "Guardando…" : ed.modo === "escribir" ? "Guardar" : "Descargar"}
                {ed.sinGuardar && <span aria-label="sin guardar">●</span>}
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
              <Play size={14} /> {proyecto.fase === "calculando" ? "Calculando…" : "Calcular"}
            </button>
          ) : (
            <button type="button" className="btn" onClick={proyecto.recalcular} disabled={!e?.compila || proyecto.fase === "calculando" || (!!ed && proyecto.desactualizado)} title="Calcular de nuevo, sin usar los resultados de .fem/">
              <RefreshCw size={14} /> Recalcular
            </button>
          )}
          <button type="button" className="btn" onClick={() => location.assign(location.pathname)} title="Abrir otro proyecto">
            <FolderOpen size={14} /> Abrir
          </button>
          <button type="button" className="btn" style={{ width: 28, padding: 0 }} onClick={toggleTheme} aria-label={theme === "dark" ? "Tema claro" : "Tema oscuro"}>
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </header>

        {ed?.conflicto && (
          <div className="banda warn" role="alert">
            <span className="min-w-0 flex-1">
              <strong>{ed.conflicto}</strong> No se ha recargado ni sobrescrito nada.
            </span>
            <button type="button" className="btn" onClick={ed.recargarDisco}>
              Recargar del disco (se pierden los cambios de aquí)
            </button>
            <button type="button" className="btn" onClick={() => void ed.guardar({ forzar: true })}>
              Sobrescribir el del disco
            </button>
          </div>
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
          ) : pantalla === "modelo" || !e?.calculado ? (
            <PantallaModelo />
          ) : pantalla === "losas" ? (
            <PantallaLosas />
          ) : pantalla === "vigas" ? (
            <PantallaVigas />
          ) : pantalla === "pilares" ? (
            <PantallaPilares />
          ) : pantalla === "desplomes" ? (
            <PantallaDesplomes />
          ) : (
            <PantallaRevision />
          )}
        </main>

        <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-border-main bg-bg-surface px-3 font-mono text-[11px] text-text-disabled">
          <span className="min-w-0 shrink truncate">{pie}</span>
          <span className="min-w-0 flex-1 truncate">{resultados}</span>
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
    </ContextoVisor.Provider>
  );
}

function PantallaError({ p }: { p: ProyectoAbierto }) {
  return (
    <div className="mx-auto mt-16 w-[640px] max-w-full">
      <h1 className="text-[15px] font-semibold">No se pudo abrir el proyecto</h1>
      <p className="mt-1 text-text-secondary">El fichero no es un proyecto válido (JSON o esquema). Corríjalo y el visor lo recargará solo si lo abrió desde su carpeta.</p>
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
