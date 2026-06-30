// SeccionCargaSuperficial (F3): bloque de gestion de CARGAS SUPERFICIALES de un paño,
// montado en el InspectorPano. Espejo de SeccionCargas (feature-13) pero para el tipo
// "superficial" (kN/m²) sobre un paño losa. Lista las cargas cuyo `ambito` es el paño
// seleccionado y ofrece "Añadir carga" (valor en kN/m² + hipotesis). COMMIT EN VIVO:
// cada accion es un comando reversible; no hay boton "Guardar". Vocabulario de obra
// (Carga superficial, kN/m², Hipótesis); cero jerga FEM (CLAUDE.md §17).
//
// En F3 corte 1 la carga superficial sobre paño SI se calcula (el discretizador malla la
// losa y emite la presion): no hay aviso de "no se calcula" (a diferencia de F1).
//
// INVARIANTE DEL `base` (CLAUDE.md §10): los comandos se construyen contra el modelo
// ACTUAL leido justo antes de ejecutar, nunca contra la copia del render.
//
// UNIDADES (CLAUDE.md §14): la carga superficial se introduce en kN/m² (= interno). No
// hay conversion aqui; el sufijo es decorativo (presion gravitatoria, sentido hacia abajo
// lo fija el discretizador, no el signo del usuario).
import { useEffect, useState } from "react";
import {
  validarCarga,
  esValido,
  type DatosCargaUI,
  type ErrorCampo,
} from "../dialogos/validacionesCarga";
import { CampoNumero, SelectHipotesis, Boton } from "../primitivas";
import { modeloStore, vistaStore, crearCarga, eliminarCarga } from "../../estado";
import { cargasDeAmbito } from "../../dominio";
import "../dialogos/seccionCargas.css";

const SUFIJO = "kN/m²";

// Lee el modelo ACTUAL del store (invariante del `base`).
function leerModelo() {
  return modeloStore.getState().getModelo();
}

// Busca el mensaje de un campo concreto en la lista de errores de validacion.
function errorDe(errores: ErrorCampo[], campo: string): string | undefined {
  return errores.find((e) => e.campo === campo)?.mensaje;
}

export interface SeccionCargaSuperficialProps {
  // Id del paño sobre el que actuan las cargas (== Carga.ambito).
  panoId: string;
}

export function SeccionCargaSuperficial({ panoId }: SeccionCargaSuperficialProps) {
  // Lectura reactiva: el modelo. No esta en el bucle del viewport (#11): un re-render al
  // editar es aceptable. Suscribirse al modelo permite filtrar con cargasDeAmbito sin
  // perder reactividad.
  const modelo = modeloStore((s) => s.modelo);
  const defaultsCarga = vistaStore((s) => s.defaultsCarga);
  const setDefaultsCarga = vistaStore((s) => s.setDefaultsCarga);

  // Estado LOCAL del valor que se esta tecleando (number; CampoNumero gestiona el string).
  const [valorNuevo, setValorNuevo] = useState<number>(defaultsCarga.valor);
  const [errores, setErrores] = useState<ErrorCampo[]>([]);

  // Al cambiar de paño, limpia los errores del formulario anterior.
  useEffect(() => {
    setErrores([]);
  }, [panoId]);

  // Cargas de ESTE paño (filtro por ambito).
  const cargasDelPano = cargasDeAmbito(modelo, panoId);

  // Hipotesis nueva: arranca de la ultima elegida si sigue existiendo y NO es la
  // automatica de peso propio (E2(b): no se cuelgan cargas de usuario en ella); si no,
  // cae a la primera ASIGNABLE. Mismo criterio robusto que SeccionCargas.
  const asignables = modelo.hipotesis.filter((h) => !h.automatica);
  const hipotesisGuardada = defaultsCarga.hipotesisId;
  const hipotesisGuardadaAsignable =
    hipotesisGuardada !== null && asignables.some((h) => h.id === hipotesisGuardada);
  const hipotesisNueva = hipotesisGuardadaAsignable
    ? hipotesisGuardada
    : (asignables[0]?.id ?? null);

  const anadir = () => {
    const m = leerModelo();
    const hipotesisId = hipotesisNueva;
    if (hipotesisId === null) {
      const mensaje =
        m.hipotesis.length > 0
          ? "No hay hipótesis a las que asignar la carga. Crea una hipótesis de cargas."
          : "Crea una hipótesis antes de añadir la carga.";
      setErrores([{ campo: "hipotesisId", mensaje }]);
      return;
    }
    const datos: DatosCargaUI = {
      tipo: "superficial",
      ambito: panoId,
      valor: valorNuevo,
      hipotesisId,
    };
    const errs = validarCarga(m, null, datos);
    setErrores(errs);
    if (!esValido(errs)) return;
    // Recuerda valor/hipotesis para la proxima carga (defaults compartidos). El tipo se
    // mantiene "lineal" en defaultsCarga (lo usa SeccionCargas de viga/pilar); aqui el
    // tipo lo fija el contexto (paño => superficial), asi que no lo pisamos.
    setDefaultsCarga({ valor: valorNuevo, hipotesisId });
    modeloStore.getState().ejecutar(
      crearCarga(m, {
        tipo: "superficial",
        ambito: panoId,
        valor: valorNuevo,
        hipotesisId,
      }),
    );
  };

  const eliminar = (cargaId: string) => {
    modeloStore.getState().ejecutar(eliminarCarga(leerModelo(), cargaId));
  };

  const nombreHipotesis = (hipotesisId: string): string =>
    leerModelo().hipotesis.find((h) => h.id === hipotesisId)?.nombre ?? "—";

  return (
    <div className="cx-cargas">
      <span className="cx-cargas__titulo">Cargas superficiales</span>

      <div className="cx-cargas__lista">
        {cargasDelPano.length === 0 ? (
          <div className="cx-cargas__vacio">Sin cargas.</div>
        ) : (
          cargasDelPano.map((c) => (
            <div key={c.id} className="cx-cargas__fila">
              <span className="cx-cargas__valor">
                {c.valor} {SUFIJO}
              </span>
              <span className="cx-cargas__hip">{nombreHipotesis(c.hipotesisId)}</span>
              <button
                type="button"
                className="cx-cargas__borrar"
                aria-label={`Eliminar carga superficial ${c.valor}`}
                onClick={() => eliminar(c.id)}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      <div className="cx-cargas__anadir">
        <CampoNumero
          etiqueta="Valor"
          sufijo={SUFIJO}
          valor={valorNuevo}
          onCommit={(v) => setValorNuevo(v)}
          error={errorDe(errores, "valor")}
        />
        <div className="cx-cargas__campo">
          <span className="cx-campo__label">Hipótesis</span>
          <SelectHipotesis
            etiqueta="Hipótesis de la carga"
            valor={hipotesisNueva}
            onCambio={(id) => setDefaultsCarga({ hipotesisId: id })}
          />
          {errorDe(errores, "hipotesisId") ? (
            <div className="cx-campo__error" role="alert">
              {errorDe(errores, "hipotesisId")}
            </div>
          ) : null}
        </div>
        <Boton variante="primary" onClick={anadir} disabled={!(valorNuevo > 0)}>
          Añadir carga
        </Boton>
      </div>
    </div>
  );
}
