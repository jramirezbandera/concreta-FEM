// PanelFrecuencias: panel HUD (HTML) del ANALISIS MODAL (F2b). Lista las frecuencias
// propias (Modo i - f Hz, mono tabular) con el modo activo resaltado y seleccionable,
// el control del nº de modos a calcular (default 6) que dispara "Calcular modos", los
// controles de amplificacion/animacion de la forma modal, y un boton "Calcular modos".
// Estilo glass coherente con el resto del HUD (PanelFlotante + tokens CSS).
//
// LENGUAJE DE OBRA (CLAUDE.md §17): habla de "modos de vibracion" y "frecuencia", nunca
// de "eigenvalue", "GDL" ni "masa modal". Las frecuencias vienen YA en Hz del motor
// (CLAUDE.md §14: el solver entrega Hz); aqui no se convierte nada.
//
// RENDIMIENTO: lee modalStore/vistaStore con useSyncExternalStore (subscribeWithSelector)
// por campo; el estado del motor llega via useSolicitarModos (calculoStore). Sin render
// por frame (la animacion la lleva ModoOverlay mutando buffers).
import { useState, useSyncExternalStore } from "react";
import { PanelFlotante, Boton } from "../primitivas";
import { modalStore, vistaStore } from "../../estado";
import type { ModeloFEM } from "../../discretizador";
import type { ResultadosModales } from "../../solver";
import { useSolicitarModos } from "./useSolicitarModos";
import { etiquetaBotonModos, modosHabilitado } from "./modalMotorUI";
import "./panelFrecuencias.css";

// Limites del nº de modos a pedir. Minimo 1 (al menos un modo); maximo prudente para no
// pedir mas modos que GDL en obras pequeñas (el motor acota a la baja de todos modos).
const NUM_MODOS_MIN = 1;
const NUM_MODOS_MAX = 30;

// Rango del slider de amplificacion de la forma modal. La forma modal es adimensional
// (normalizada a amplitud ~1 por modalGeometria): este factor la lleva a un tamaño
// visible. 0.1..5 m de amplitud cubre desde sutil hasta muy marcada.
const ESCALA_MIN = 0.1;
const ESCALA_MAX = 5;
const ESCALA_STEP = 0.1;

// --- Lectura reactiva (fuera del bucle de render) ----------------------------

interface EntradasModal {
  modos: ResultadosModales | null;
  // modeloFEM que genero estos modos: lleva el nº de modos SOLICITADO
  // (analysis.num_modes) para detectar si el motor lo acoto a la baja (aviso al usuario).
  modeloFEM: ModeloFEM | null;
  modoActivo: number;
  vigente: boolean;
}

let snapCache: EntradasModal = leerEntradas();
function leerEntradas(): EntradasModal {
  const m = modalStore.getState();
  return {
    modos: m.modos,
    modeloFEM: m.modeloFEM,
    modoActivo: m.modoActivo,
    vigente: m.vigente,
  };
}
function getSnapshot(): EntradasModal {
  const a = leerEntradas();
  const c = snapCache;
  if (
    a.modos === c.modos &&
    a.modeloFEM === c.modeloFEM &&
    a.modoActivo === c.modoActivo &&
    a.vigente === c.vigente
  ) {
    return c;
  }
  snapCache = a;
  return a;
}
function suscribir(cb: () => void): () => void {
  const offModos = modalStore.subscribe((s) => s.modos, cb);
  const offFem = modalStore.subscribe((s) => s.modeloFEM, cb);
  const offActivo = modalStore.subscribe((s) => s.modoActivo, cb);
  const offVig = modalStore.subscribe((s) => s.vigente, cb);
  return () => {
    offModos();
    offFem();
    offActivo();
    offVig();
  };
}
function useEntradasModal(): EntradasModal {
  return useSyncExternalStore(suscribir, getSnapshot, getSnapshot);
}

function useNumModos(): number {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.numModos, cb),
    () => vistaStore.getState().numModos,
    () => vistaStore.getState().numModos,
  );
}
function useModalEscala(): number {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.modalEscala, cb),
    () => vistaStore.getState().modalEscala,
    () => vistaStore.getState().modalEscala,
  );
}
function useModalAnimando(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.modalAnimando, cb),
    () => vistaStore.getState().modalAnimando,
    () => vistaStore.getState().modalAnimando,
  );
}

// Formatea una frecuencia (Hz) con dos decimales para la lista.
function fmtHz(hz: number): string {
  return hz.toFixed(2);
}

// Acota el nº de modos al rango permitido (el stepper/input no debe salir de [min,max]).
function acotarNumModos(n: number): number {
  if (!Number.isFinite(n)) return NUM_MODOS_MIN;
  const entero = Math.round(n);
  return Math.min(NUM_MODOS_MAX, Math.max(NUM_MODOS_MIN, entero));
}

export function PanelFrecuencias() {
  const entradas = useEntradasModal();
  const numModos = useNumModos();
  const escala = useModalEscala();
  const animando = useModalAnimando();
  const { calcularModos, estadoMotor, calculando, errores, ultimoError } =
    useSolicitarModos();

  const habilitado = modosHabilitado(estadoMotor, calculando);
  const etiqueta = etiquetaBotonModos(estadoMotor, calculando);

  const lista = entradas.modos?.modos ?? [];
  const hayModos = lista.length > 0;

  // Errores de obra del ultimo intento modal (incluye los guards modales: sin masa,
  // nº de modos invalido). En lenguaje de obra; se muestran bajo el boton.
  const hayErrores = errores.length > 0;
  const hayFalloMotor = ultimoError !== null;

  // Aviso de ACOTADO: el motor calcula como mucho (GDL libres - 1) modos; si la estructura
  // no admite tantos como se pidieron, devuelve menos. Comparamos lo solicitado
  // (modeloFEM.analysis.num_modes, lo que se discretizo) con lo calculado
  // (modos.analysis.num_modes) para avisar y que el usuario no lo lea como un fallo.
  const pedidos = entradas.modeloFEM?.analysis.num_modes;
  const calculados = entradas.modos?.analysis.num_modes;
  const acotado =
    hayModos && pedidos != null && calculados != null && calculados < pedidos;

  // Input "Nº de modos" TOLERANTE: el clamp sincrono en cada pulsacion impedia vaciar el
  // campo para reescribir (Number("")=0 -> acotar -> 1, peleando contra la edicion).
  // Mantenemos un texto local que admite estados intermedios ("" o parciales) y solo
  // commiteamos a vistaStore un entero valido; al salir (blur) el campo se normaliza al
  // valor real (acotado) del store.
  const [numTexto, setNumTexto] = useState(() => String(numModos));
  const onCambioNumModos = (v: string) => {
    setNumTexto(v);
    if (v === "") return; // permitir el campo vacio mientras se edita
    const n = Number(v);
    if (Number.isInteger(n) && n >= NUM_MODOS_MIN) {
      vistaStore.getState().setNumModos(acotarNumModos(n));
    }
  };
  const onBlurNumModos = () => setNumTexto(String(vistaStore.getState().numModos));

  return (
    <PanelFlotante
      className="cx-frecuencias"
      titulo="Modos de vibración"
      // Marca la lista como obsoleta cuando la obra cambio tras calcular (vigente=false).
      tag={hayModos && !entradas.vigente ? "obsoletos" : undefined}
    >
      {/* Control del nº de modos a calcular + boton "Calcular modos". */}
      <div className="cx-frecuencias__lanzar">
        <label className="cx-frecuencias__num">
          <span className="cx-frecuencias__etq">Nº de modos</span>
          <input
            type="number"
            className="mono tnum"
            min={NUM_MODOS_MIN}
            max={NUM_MODOS_MAX}
            step={1}
            value={numTexto}
            onChange={(e) => onCambioNumModos(e.target.value)}
            onBlur={onBlurNumModos}
            aria-label="Número de modos de vibración a calcular"
          />
        </label>
        <Boton
          variante="primary"
          onClick={() => void calcularModos(numModos)}
          disabled={!habilitado}
          aria-busy={calculando || estadoMotor === "cargando"}
        >
          {etiqueta}
        </Boton>
      </div>

      {/* Reporte de errores de obra / fallo del motor (lenguaje de obra). */}
      {(hayErrores || hayFalloMotor) && (
        <div className="cx-frecuencias__reporte" role="status" aria-live="polite">
          {hayFalloMotor && (
            <p className="cx-frecuencias__motor-error">{ultimoError.mensaje}</p>
          )}
          {hayErrores && (
            <ul className="cx-frecuencias__errores">
              {errores.map((e, i) => (
                <li key={`${e.codigo}-${e.elementoId ?? i}`}>{e.mensaje}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Lista de frecuencias o estado vacio. */}
      {hayModos ? (
        <>
          <ul className="cx-frecuencias__lista" role="listbox" aria-label="Modos de vibración">
            {lista.map((m) => {
              const activo = m.numero === entradas.modoActivo;
              return (
                <li key={m.numero}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={activo}
                    className={
                      activo
                        ? "cx-frecuencias__modo cx-frecuencias__modo--activo"
                        : "cx-frecuencias__modo"
                    }
                    onClick={() => modalStore.getState().setModoActivo(m.numero)}
                  >
                    <span className="cx-frecuencias__modo-n">Modo {m.numero}</span>
                    <span className="cx-frecuencias__modo-f mono tnum">
                      {fmtHz(m.frecuencia)} Hz
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Aviso si el motor calculo menos modos de los pedidos (estructura con pocos
              GDL): que el usuario no lo lea como un fallo. */}
          {acotado && (
            <p className="cx-frecuencias__nota" role="note">
              Se calcularon {calculados} de los {pedidos} modos solicitados: la
              estructura no admite más.
            </p>
          )}

          {/* Control de amplificacion de la forma modal. */}
          <label className="cx-frecuencias__control">
            <span className="cx-frecuencias__etq">
              Amplitud <span className="mono tnum">×{escala.toFixed(1)}</span>
            </span>
            <input
              type="range"
              min={ESCALA_MIN}
              max={ESCALA_MAX}
              step={ESCALA_STEP}
              value={escala}
              onChange={(e) =>
                vistaStore.getState().setModalEscala(Number(e.target.value))
              }
              aria-label="Amplitud de la forma modal"
            />
          </label>

          {/* Toggle de animacion de la forma modal. */}
          <label className="cx-frecuencias__toggle">
            <input
              type="checkbox"
              checked={animando}
              onChange={(e) =>
                vistaStore.getState().setModalAnimando(e.target.checked)
              }
            />
            <span>Animar modo</span>
          </label>
        </>
      ) : (
        // Estado vacio legible: aun no se han calculado modos (sin jerga FEM).
        <p className="cx-frecuencias__vacio">
          Sin modos calculados. Elige el número de modos y pulsa “Calcular modos”.
        </p>
      )}
    </PanelFlotante>
  );
}
