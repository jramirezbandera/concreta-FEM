/**
 * Pantalla de inicio: abrir la carpeta del proyecto (se vigila), un proyecto.json suelto o uno de
 * los proyectos de ejemplo del repositorio. También abre lo que diga la URL:
 *   ?proyecto=<url del proyecto en el servidor local>   (se vigila, como una carpeta)
 *   ?ejemplo=<nombre>                                    (uno de EJEMPLOS)
 */
import { useState } from "react";
import { FileJson, FolderOpen } from "lucide-react";
import { elegirCarpeta, hayCarpetas, origenCarpeta, origenUrl, proyectosEn, type Directorio } from "./sesion/origen.ts";
import type { ProyectoAbierto } from "./sesion/useProyecto.ts";

/** Proyectos de ejemplo del repositorio (la skill y los tres de A2). */
export const EJEMPLOS: Record<string, { titulo: string; cargar: () => Promise<string> }> = {
  ejemplo: { titulo: "Pórtico de dos plantas con losa (ejemplo de la skill)", cargar: () => import("../../.claude/skills/fem/ejemplo.json?raw").then((m) => m.default) },
  "1022": { titulo: "Pórtico de acero de 7 plantas (SAP2000 1-022, A2)", cargar: () => import("../../validacion/a2/agente/1022/proyecto.json?raw").then((m) => m.default) },
  nucleo: { titulo: "Retícula con núcleo de muros (A2)", cargar: () => import("../../validacion/a2/agente/nucleo/proyecto.json?raw").then((m) => m.default) },
  edificio: { titulo: "Edificio objetivo: 7 plantas, 80 pilares (A2)", cargar: () => import("../../validacion/a2/agente/edificio/proyecto.json?raw").then((m) => m.default) },
};

export async function abrirDesdeUrl(p: ProyectoAbierto): Promise<void> {
  const q = new URLSearchParams(location.search);
  const url = q.get("proyecto");
  if (url) return p.abrirOrigen(origenUrl(url));
  const ej = q.get("ejemplo");
  if (ej && EJEMPLOS[ej]) p.abrirTexto(await EJEMPLOS[ej].cargar(), `${ej}.json`);
}

export function Inicio({ proyecto }: { proyecto: ProyectoAbierto }) {
  const [elegir, setElegir] = useState<{ dir: Directorio; ficheros: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [encima, setEncima] = useState(false);
  const ocupado = proyecto.fase === "abriendo" || proyecto.fase === "calculando";

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
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const fichero = async (f: File | undefined) => {
    if (f) proyecto.abrirTexto(await f.text(), f.name);
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
        void fichero(e.dataTransfer.files[0]);
      }}
    >
      <div className="mt-[8vh] w-[620px] max-w-full rounded-md border border-border-main bg-bg-primary">
        <div className="border-b border-border-sub px-5 py-4">
          <div className="flex items-center gap-1.5 text-[15px] font-semibold">
            <span className="inline-block h-[7px] w-[7px] rounded-full bg-accent" aria-hidden="true" />
            Concreta · FEM 3D
          </div>
          <h1 className="mt-1 text-[13px] font-normal text-text-secondary">Visor de sólo lectura (V1). El modelo se edita en el proyecto.json, con el agente o a mano; el visor lo calcula, o usa los resultados que dejó la CLI, y se recarga solo cuando el fichero cambia.</h1>
        </div>
        <div className="flex flex-col gap-2 px-5 py-4">
          <button type="button" className="btn btn-p justify-start" style={{ height: 34 }} onClick={() => void carpeta()} disabled={!hayCarpetas() || ocupado}>
            <FolderOpen size={15} /> Abrir la carpeta del proyecto…
          </button>
          {!hayCarpetas() && <p className="text-[11px] text-state-warn">Este navegador no permite abrir carpetas (hace falta Chrome o Edge): sin ella no se vigila el fichero ni se leen los resultados de .fem/.</p>}
          <label className="btn justify-start" style={{ height: 34 }}>
            <FileJson size={15} /> Abrir un proyecto.json suelto (o arrastrarlo aquí)…
            <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => void fichero(e.target.files?.[0])} disabled={ocupado} />
          </label>
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
          {error && <p className="text-[12px] text-state-fail">{error}</p>}
          {ocupado && <p className="mono text-[12px] text-text-secondary">{proyecto.fase === "abriendo" ? "Abriendo y compilando…" : "Calculando…"}</p>}
        </div>
        <div className="border-t border-border-sub px-5 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">Ejemplos del repositorio</div>
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
      </div>
    </div>
  );
}
