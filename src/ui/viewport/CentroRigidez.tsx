// CentroRigidez: control HUD del CENTRO DE RIGIDEZ (CR) FEM-exacto (F2). Combina el
// TOGGLE (encender/apagar el marcador ◇), el DISPARADOR "Calcular centro de rigidez" (con
// estados del motor, espejo del disparador "Calcular modos" del modal) y el PANEL de datos
// (nombre de planta + X/Y del CR + excentricidad ex/ey al CM). Vive en el HUD glass (HTML
// sobre el canvas), montado en el Hud persistente -> disponible en todas las pestanas.
//
// VISIBILIDAD: el control solo aparece en VISTA PLANTA (el CR es ayuda de planta; en
// 3D/mosaico no tiene sentido el marcador cenital). Comparte la zona mid-left con
// CentroMasa/ModeloCalculo; cada uno se autooculta por modo (el CR solo en planta, el
// modelo de calculo solo en 3D), asi nunca coinciden. El toggle arranca APAGADO.
//
// DIFERENCIA CON EL CM (calcado de CentroMasa pero NO identico): el CM es PURO (siempre
// disponible al instante); el CR lo calcula PyNite (asincrono) y hay que DISPARARLO. Por
// eso este panel tiene un boton "Calcular centro de rigidez" con estados (no calculado /
// calculando… / error con reintento), como "Calcular modos".
//
// ETIQUETA DE HIPOTESIS (obligatoria, decision del plan + Codex #18): el CR supone un
// DIAFRAGMA RIGIDO por planta. Es una hipotesis que el usuario no definio (no hay paños
// todavia). El panel lo dice EXPLICITAMENTE, en lenguaje de obra, para no vender un dato
// como si saliera de un forjado modelado.
//
// LENGUAJE DE OBRA (CLAUDE.md §2/§17): "centro de rigidez", "excentricidad", "diafragma
// rigido"; CERO jerga FEM ("GDL", "flexibilidad", "nudo maestro"). Datos numericos en mono
// tabular (Spec §7.4).
import { useSyncExternalStore } from "react";
import { vistaStore } from "../../estado";
import { PanelFlotante, Boton } from "../primitivas";
import { useCentroRigidez } from "./useCentroRigidez";
import { useSolicitarCR } from "../resultados/useSolicitarCR";
import { etiquetaBotonCR, crHabilitado } from "./crMotorUI";
import "./centroRigidez.css";

// Vista planta? El control del CR solo se ofrece en planta (espejo del CM).
function useEnPlanta(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.modoVista, cb),
    () => vistaStore.getState().modoVista === "planta",
    () => vistaStore.getState().modoVista === "planta",
  );
}

function useMostrarCR(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.mostrarCentroRigidez, cb),
    () => vistaStore.getState().mostrarCentroRigidez,
    () => vistaStore.getState().mostrarCentroRigidez,
  );
}

// Formatea una coordenada (m) con dos decimales.
function fmtM(v: number): string {
  return `${v.toFixed(2)} m`;
}

// Detalle del panel: X/Y del CR + excentricidad, o el estado correspondiente. Distingue:
//  - planta sin CR calculado (cr===null) -> "Aun no se ha calculado…".
//  - planta no determinable (cr.x===null) -> mensaje de obra.
//  - CR determinable -> X/Y + (excentricidad si ex/ey no null).
function DetalleCentroRigidez() {
  const { cr, nombrePlanta, vigente } = useCentroRigidez();

  // Sin CR calculado para esta planta: estado vacio (aun no se ha disparado / planta sin
  // entrada en el ultimo calculo).
  if (cr === null) {
    return (
      <div className="cx-cr__detalle">
        <span className="cx-cr__vacio">
          Aún no se ha calculado el centro de rigidez de esta planta.
        </span>
      </div>
    );
  }

  // Planta no determinable: x/y null (sin rigidez torsional; p. ej. un solo pilar sin
  // rigidez a torsion). Lenguaje de obra, sin marcador roto.
  if (cr.x === null || cr.y === null) {
    return (
      <div className="cx-cr__detalle">
        <span className="cx-cr__indeterminable">
          No se puede determinar el centro de rigidez en esta planta.
        </span>
      </div>
    );
  }

  const hayExcentricidad = cr.ex !== null && cr.ey !== null;

  return (
    <div className="cx-cr__detalle">
      <div className="cx-cr__fila">
        <span className="cx-cr__clave">Planta</span>
        <span className="cx-cr__valor">
          {nombrePlanta ?? "—"}
          {!vigente ? " (obsoleto)" : ""}
        </span>
      </div>
      <div className="cx-cr__fila">
        <span className="cx-cr__clave">X</span>
        <span className="cx-cr__valor mono tnum">{fmtM(cr.x)}</span>
      </div>
      <div className="cx-cr__fila">
        <span className="cx-cr__clave">Y</span>
        <span className="cx-cr__valor mono tnum">{fmtM(cr.y)}</span>
      </div>
      {/* Excentricidad estructural CM - CR: solo si hay masa (ex/ey no null). */}
      {hayExcentricidad && (
        <>
          <span className="cx-cr__seccion">Excentricidad al centro de masas</span>
          <div className="cx-cr__fila">
            <span className="cx-cr__clave">eₓ</span>
            <span className="cx-cr__valor mono tnum">{fmtM(cr.ex as number)}</span>
          </div>
          <div className="cx-cr__fila">
            <span className="cx-cr__clave">e_y</span>
            <span className="cx-cr__valor mono tnum">{fmtM(cr.ey as number)}</span>
          </div>
        </>
      )}
    </div>
  );
}

export function CentroRigidez() {
  const enPlanta = useEnPlanta();
  const mostrar = useMostrarCR();
  const toggle = () => vistaStore.getState().toggleCentroRigidez();
  const { calcularCR, estadoMotor, calculando, errores, ultimoError } =
    useSolicitarCR();

  // El control solo se ofrece en vista planta (espejo del CM).
  if (!enPlanta) return null;

  const habilitado = crHabilitado(estadoMotor, calculando);
  const etiqueta = etiquetaBotonCR(estadoMotor, calculando);
  const hayErrores = errores.length > 0;
  const hayFalloMotor = ultimoError !== null;

  return (
    <PanelFlotante
      className="cx-cr"
      // El glifo ◇ en el icono ata visualmente el panel con el marcador de la escena.
      icono={
        <span className="cx-cr__glifo" aria-hidden="true">
          ◇
        </span>
      }
      titulo="Centro de rigidez"
    >
      <label className="cx-cr__toggle">
        <input
          type="checkbox"
          checked={mostrar}
          onChange={toggle}
          aria-label="Mostrar centro de rigidez"
        />
        <span>Mostrar en planta</span>
      </label>

      {mostrar && (
        <>
          {/* Disparador del calculo (asincrono, como "Calcular modos"). */}
          <div className="cx-cr__lanzar">
            <Boton
              variante="primary"
              onClick={() => void calcularCR()}
              disabled={!habilitado}
              aria-busy={calculando || estadoMotor === "cargando"}
            >
              {etiqueta}
            </Boton>

            {(hayErrores || hayFalloMotor) && (
              <div className="cx-cr__reporte" role="status" aria-live="polite">
                {hayFalloMotor && (
                  <p className="cx-cr__motor-error">{ultimoError.mensaje}</p>
                )}
                {hayErrores && (
                  <ul className="cx-cr__errores">
                    {errores.map((e, i) => (
                      <li key={`${e.codigo}-${e.elementoId ?? i}`}>{e.mensaje}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <DetalleCentroRigidez />

          {/* HIPOTESIS (obligatoria): el CR supone diafragma rigido por planta. */}
          <p className="cx-cr__hipotesis">
            Supone un diafragma rígido por planta (cada forjado se considera
            indeformable en su plano). Es una hipótesis de cálculo, no un paño modelado.
          </p>
        </>
      )}
    </PanelFlotante>
  );
}
