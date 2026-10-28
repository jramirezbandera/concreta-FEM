/**
 * Los enganches en la barra de la vista de planta, como la barra de estado de AutoCAD: el ortogonal
 * (F8), el imán que enciende y apaga los enganches sin perder cuáles están marcados y, en su flecha,
 * la lista de tipos (con el símbolo que se pinta en la planta) y de dónde se engancha (el modelo y la
 * plantilla DXF, F3). El estado es el del controlador: el mismo en todas las vistas.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronUp, Magnet } from "lucide-react";
import { FUENTES_ENGANCHE, NOMBRE_ENGANCHE, TIPOS_ENGANCHE, type FuenteEnganche, type TipoEnganche } from "../../../src/editor/dibujo/enganches.ts";
import type { ControladorDibujo } from "./controlador.ts";

const NOMBRE_FUENTE: Record<FuenteEnganche, string> = { modelo: "Modelo", plantilla: "Plantilla DXF" };

/** El símbolo de cada tipo, el de `marcador` en la planta (r = 6 en 16 px). */
const SIMBOLO: Record<TipoEnganche, string> = {
  fijo: "M2 2h12v12H2z",
  extremo: "M2 2h12v12H2z",
  centro: "M14 8a6 6 0 1 1-12 0a6 6 0 1 1 12 0z",
  esquina: "M8 2l6 6l-6 6l-6-6z",
  vertice: "M8 2l6 6l-6 6l-6-6z",
  cruce: "M2 2l12 12M14 2L2 14",
  medio: "M8 2l6 10.8H2z",
  cara: "M2 2h12v12H2zM2 8h12",
  perpendicular: "M2 2v12h12M2 8h6v6",
  cercano: "M2 2h12L2 14h12z",
};

const alternar = <T,>(xs: ReadonlySet<T>, x: T): Set<T> => {
  const n = new Set(xs);
  if (n.has(x)) n.delete(x);
  else n.add(x);
  return n;
};

export function BarraEnganches({ ctrl }: { ctrl: ControladorDibujo }) {
  const foto = useSyncExternalStore(ctrl.suscribir, ctrl.instantanea);
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  // Se cierra con Esc o con un clic fuera
  useEffect(() => {
    if (!abierto) return;
    const fuera = (x: PointerEvent) => !caja.current?.contains(x.target as Node) && setAbierto(false);
    const esc = (x: KeyboardEvent) => {
      if (x.key !== "Escape") return;
      // Sólo cierra la lista: la herramienta sigue
      x.stopImmediatePropagation();
      setAbierto(false);
    };
    window.addEventListener("pointerdown", fuera, true);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("pointerdown", fuera, true);
      window.removeEventListener("keydown", esc, true);
    };
  }, [abierto]);

  const n = foto.enganchar ? foto.activos.size : 0;
  return (
    <div ref={caja} className="eng-barra">
      <button type="button" className="ib" data-on={foto.orto} aria-pressed={foto.orto} title="Ortogonal (F8): según los ejes de la planta; con Mayús, también a 45°" aria-label="Ortogonal" onClick={() => ctrl.alternarOrto()}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 2.5v11h11" />
          <path d="M3 9.5h4.5v4" />
        </svg>
      </button>
      <span className="eng-dividido" data-on={foto.enganchar}>
        <button type="button" className="ib" data-on={foto.enganchar} aria-pressed={foto.enganchar} title={foto.enganchar ? `Enganches: ${n} de ${TIPOS_ENGANCHE.length} tipos. Un clic los apaga` : "Enganches apagados: un clic los enciende"} aria-label="Enganches" onClick={() => ctrl.alternarEnganches()}>
          <Magnet size={15} />
        </button>
        <button type="button" className="ib eng-flecha" data-on={abierto} aria-expanded={abierto} aria-haspopup="true" title="Qué se engancha y a qué" aria-label="Lista de enganches" onClick={() => setAbierto((x) => !x)}>
          <ChevronUp size={12} />
        </button>
      </span>
      {abierto && (
        <div className="eng-menu" role="group" aria-label="Enganches a objetos">
          <div className="eng-cab">
            <span>Enganches</span>
            <button type="button" className="eng-link" onClick={() => ctrl.ponerActivos(new Set(TIPOS_ENGANCHE))}>
              Todos
            </button>
            <button type="button" className="eng-link" onClick={() => ctrl.ponerActivos(new Set())}>
              Ninguno
            </button>
          </div>
          <div className="eng-tipos" data-apagados={!foto.enganchar}>
            {TIPOS_ENGANCHE.map((t) => (
              <label key={t} className="eng-fila">
                <input type="checkbox" checked={foto.activos.has(t)} onChange={() => ctrl.ponerActivos(alternar(foto.activos, t))} />
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <path d={SIMBOLO[t]} />
                </svg>
                <span>{NOMBRE_ENGANCHE[t]}</span>
              </label>
            ))}
          </div>
          <div className="eng-cab">
            <span>Enganchar a</span>
          </div>
          <div className="eng-tipos" role="group" aria-label="Enganchar a">
            {FUENTES_ENGANCHE.map((f) => (
              <label key={f} className="eng-fila">
                <input type="checkbox" checked={foto.fuentes.has(f)} onChange={() => ctrl.ponerFuentes(alternar(foto.fuentes, f))} />
                <span className="flex-1">{NOMBRE_FUENTE[f]}</span>
                {f === "plantilla" && <span className="dib-tecla">F3</span>}
              </label>
            ))}
          </div>
          <p className="eng-nota">A igual tipo, el modelo gana a la plantilla DXF.</p>
        </div>
      )}
    </div>
  );
}
