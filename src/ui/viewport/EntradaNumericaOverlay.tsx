// EntradaNumericaOverlay: barra de COORDENADAS de la colocacion (UX-2.5, spec §6
// "snaps tipo CAD + entrada numerica"). Panel glass fijo en el HUD (bottom-center),
// visible solo con una herramienta de colocacion activa en vista planta — el
// precedente CYPECAD/AutoCAD es una barra de comandos fija, no un input flotante
// (foco estable, testeable, no pelea con el cursor).
//
// FLUJO: teclear un caracter de la gramatica ([0-9.,@<>+-]) con el foco libre
// enfoca el input ("type to command"); Enter parsea (entradaNumerica.ts) y emite la
// expresion por entradaBus — la herramienta activa la resuelve contra SU punto
// pendiente y la confirma por el MISMO pipeline del clic. Esc en el input vacia/
// suelta el foco con preventDefault: la colocacion lo ignora (costura
// debeIgnorarEscColocacion) y el SIGUIENTE Esc ya cancela la colocacion.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { vistaStore, type Herramienta } from "../../estado";
import { focoEnCampoEditable } from "../shell/useAtajosGlobales";
import { parsearEntradaNumerica } from "./entradaNumerica";
import { emitirEntrada } from "./hooks/entradaBus";

// Teclas que "pertenecen" a la gramatica de coordenadas: al pulsarlas con el foco
// libre, el input se enfoca y recibe el caracter (patron type-to-command).
const TECLA_GRAMATICA = /^[0-9.,@<\-+]$/;

// Guia por herramienta (lenguaje de obra; la referencia del @ difiere).
const PROMPT: Record<Exclude<Herramienta, "seleccion">, string> = {
  pilar: "x,y · @dx,dy desde el último pilar",
  viga: "x,y · @dx,dy · d<a desde el extremo fijado",
  pano: "x,y · @dx,dy · d<a desde la esquina fijada",
  muro: "x,y · @dx,dy desde el extremo fijado (se alinea a los ejes)",
};

// Herramienta de colocacion activa en vista planta, o null (overlay oculto).
function useColocacionActiva(): Exclude<Herramienta, "seleccion"> | null {
  const lee = (): Exclude<Herramienta, "seleccion"> | null => {
    const s = vistaStore.getState();
    if (s.modoVista !== "planta" || s.herramienta === "seleccion") return null;
    return s.herramienta;
  };
  return useSyncExternalStore(
    (cb) => {
      const offH = vistaStore.subscribe((s) => s.herramienta, cb);
      const offM = vistaStore.subscribe((s) => s.modoVista, cb);
      return () => {
        offH();
        offM();
      };
    },
    lee,
    lee,
  );
}

export function EntradaNumericaOverlay() {
  const herramienta = useColocacionActiva();
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refInput = useRef<HTMLInputElement>(null);

  // Reset al cambiar/salir de herramienta: una expresion a medias no debe
  // sobrevivir a un cambio de contexto.
  useEffect(() => {
    setTexto("");
    setError(null);
  }, [herramienta]);

  // Captura global (fase capture): un caracter de la gramatica con el foco libre
  // enfoca el input; el propio keydown sigue su curso y el caracter cae dentro.
  useEffect(() => {
    if (herramienta === null) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (!TECLA_GRAMATICA.test(ev.key)) return;
      if (focoEnCampoEditable()) return;
      refInput.current?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [herramienta]);

  if (herramienta === null) return null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const r = parsearEntradaNumerica(texto);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      emitirEntrada(r.expr);
      // Exito: limpiar y CONSERVAR el foco (se encadenan puntos tecleados, como en
      // una barra de comandos CAD). Los errores de resolucion (p. ej. @ sin punto
      // de referencia) los avisa la herramienta por la barra de estado.
      setTexto("");
      setError(null);
      return;
    }
    if (e.key === "Escape") {
      // preventDefault: ESTE Esc es del input (vaciar/soltar foco), no de la
      // herramienta — la colocacion lo ignora via defaultPrevented (UX-C11) y el
      // siguiente Esc, ya sin foco aqui, cancela la colocacion.
      e.preventDefault();
      setTexto("");
      setError(null);
      e.currentTarget.blur();
    }
  };

  return (
    <div className="cx-float cx-entrada-num" role="group" aria-label="Coordenadas">
      <span className="cx-entrada-num__prompt caps">{PROMPT[herramienta]}</span>
      <input
        ref={refInput}
        className="cx-entrada-num__input mono"
        value={texto}
        placeholder="x,y"
        aria-label="Coordenadas de colocación"
        aria-invalid={error !== null}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          setTexto(e.target.value);
          if (error !== null) setError(null);
        }}
        onKeyDown={onKeyDown}
      />
      {error !== null && <span className="cx-entrada-num__error">{error}</span>}
    </div>
  );
}
