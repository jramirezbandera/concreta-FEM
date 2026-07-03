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
import {
  modeloStore,
  vistaStore,
  crearCarga,
  editarCarga,
  eliminarCarga,
} from "../../estado";
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
  // D17: error de la EDICION inline de una carga existente, indexado por id de carga.
  const [erroresFila, setErroresFila] = useState<Record<string, ErrorCampo[]>>({});

  // Al cambiar de paño, limpia los errores del formulario anterior.
  useEffect(() => {
    setErrores([]);
    setErroresFila({});
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

  // D17: edicion INLINE de una carga superficial existente (espejo de SeccionCargas).
  // Valida el CONJUNTO con validarCarga (valor > 0, mensaje del sentido gravitatorio),
  // comitea reversible via editarCarga y refleja el error solo en ESA fila. No-op si el
  // campo no cambia (no ensucia el undo); una edicion invalida NO comitea.
  const editar = (cargaId: string, cambios: { valor?: number; hipotesisId?: string }) => {
    const m = leerModelo();
    const carga = m.cargas.find((c) => c.id === cargaId);
    if (!carga) return;
    const datos: DatosCargaUI = {
      tipo: carga.tipo,
      ambito: carga.ambito,
      valor: cambios.valor ?? carga.valor,
      hipotesisId: cambios.hipotesisId ?? carga.hipotesisId,
    };
    const errs = validarCarga(m, cargaId, datos);
    setErroresFila((prev) => ({ ...prev, [cargaId]: errs }));
    if (!esValido(errs)) return;
    const sinCambio =
      (cambios.valor === undefined || cambios.valor === carga.valor) &&
      (cambios.hipotesisId === undefined || cambios.hipotesisId === carga.hipotesisId);
    if (sinCambio) return;
    modeloStore.getState().ejecutar(editarCarga(m, cargaId, cambios));
  };

  return (
    <div className="cx-cargas">
      <span className="cx-cargas__titulo">Cargas superficiales</span>

      <div className="cx-cargas__lista">
        {cargasDelPano.length === 0 ? (
          <div className="cx-cargas__vacio">Sin cargas.</div>
        ) : (
          cargasDelPano.map((c) => (
            // D17: fila EDITABLE inline (espejo de SeccionCargas): valor (kN/m²) |
            // hipótesis | ×. Cada campo comitea con editarCarga (commit en vivo,
            // reversible); su error de validacion se muestra bajo la fila.
            <div key={c.id} className="cx-cargas__fila cx-cargas__fila--edit">
              <div className="cx-cargas__fila-campos">
                <CampoNumero
                  etiqueta="Valor de la carga superficial"
                  sufijo={SUFIJO}
                  className="cx-cargas__fila-valor"
                  valor={c.valor}
                  onCommit={(v) => editar(c.id, { valor: v })}
                  error={errorDe(erroresFila[c.id] ?? [], "valor")}
                />
                <SelectHipotesis
                  etiqueta="Hipótesis de la carga superficial"
                  valor={c.hipotesisId}
                  onCambio={(id) => editar(c.id, { hipotesisId: id })}
                />
              </div>
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
        {/* UX-E3: el sentido de la carga no era comunicado (solo saltaba al teclear un
            negativo). Ayuda corta y permanente: el signo lo fija el discretizador. */}
        <p className="cx-cargas__ayuda">
          Valor en positivo: la carga actúa hacia abajo (gravitatoria).
        </p>
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
