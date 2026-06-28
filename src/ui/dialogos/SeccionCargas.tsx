import { useEffect, useState } from "react";
import {
  validarCarga,
  esValido,
  type DatosCargaUI,
  type ErrorCampo,
} from "./validacionesCarga";
import { CampoNumero, SelectHipotesis, Boton } from "../primitivas";
import {
  modeloStore,
  vistaStore,
  crearCarga,
  eliminarCarga,
} from "../../estado";
import type { Carga } from "../../dominio";
import { cargasDeAmbito } from "../../dominio";
import "./seccionCargas.css";

// SeccionCargas (feature-13, T3.1): bloque de gestion de CARGAS de un elemento,
// reutilizable por el InspectorViga y el InspectorPilar. Lista las cargas cuyo
// `ambito` es el elemento seleccionado y ofrece un control "Añadir carga" (tipo +
// valor + hipotesis). COMMIT EN VIVO: cada accion (anadir/eliminar) es un comando
// reversible; no hay boton "Guardar". Vocabulario de obra (Carga lineal/puntual,
// kN/m, Hipótesis); cero jerga FEM (CLAUDE.md §17).
//
// DECISION (puntual-en-viga/pilar): en F1 el inspector de viga/pilar ofrece SOLO
// carga LINEAL. La carga PUNTUAL del dominio va sobre un NUDO (el discretizador la
// bloquea con CARGA_PUNTUAL_SIN_POSICION si recae sobre una barra), y aun no hay
// inspector de nudo; introducirla aqui generaria cargas que el calculo rechaza. Se
// deja la puntual-sobre-nudo para cuando exista ese inspector. Asi el unico tipo
// elegible es "lineal" y no se expone un Segmentado de tipo con una opcion sola; el
// sufijo es siempre kN/m. (El soporte de tipos del modelo —puntual/superficial—
// sigue intacto: solo se restringe la ENTRADA por UI en F1.)
//
// INVARIANTE DEL `base` (CLAUDE.md §10): los comandos se construyen SIEMPRE contra
// el modelo ACTUAL leido justo antes de ejecutar (modeloStore.getState().getModelo()),
// nunca contra la copia del render.
//
// UNIDADES (CLAUDE.md §14): el valor de una carga lineal se introduce en kN/m
// (= interno). No hay conversion aqui; el sufijo es decorativo.

// Tipos de carga que la UI de viga/pilar permite introducir en F1 (solo lineal; ver
// cabecera). El valor del Segmentado se omite mientras haya un unico tipo.
const SUFIJO_POR_TIPO: Record<DatosCargaUI["tipo"], string> = {
  lineal: "kN/m",
  puntual: "kN",
  superficial: "kN/m²",
};

// Lee el modelo ACTUAL del store (invariante del `base`).
function leerModelo() {
  return modeloStore.getState().getModelo();
}

// Etiqueta legible del tipo de carga (lenguaje de obra).
function etiquetaTipo(tipo: Carga["tipo"]): string {
  switch (tipo) {
    case "lineal":
      return "Lineal";
    case "puntual":
      return "Puntual";
    case "superficial":
      return "Superficial";
  }
}

// Busca el mensaje de un campo concreto en la lista de errores de validacion.
function errorDe(errores: ErrorCampo[], campo: string): string | undefined {
  return errores.find((e) => e.campo === campo)?.mensaje;
}

export interface SeccionCargasProps {
  // Id del elemento (viga/pilar) sobre el que actuan las cargas (== Carga.ambito).
  elementoId: string;
}

export function SeccionCargas({ elementoId }: SeccionCargasProps) {
  // Lectura reactiva: el modelo. No esta en el bucle del viewport (#11): un
  // re-render al editar es aceptable. Suscribirse al modelo (no solo a cargas)
  // permite filtrar con el helper de dominio cargasDeAmbito sin perder reactividad.
  const modelo = modeloStore((s) => s.modelo);
  const defaultsCarga = vistaStore((s) => s.defaultsCarga);
  const setDefaultsCarga = vistaStore((s) => s.setDefaultsCarga);

  // Estado LOCAL del valor que se esta tecleando en "Añadir carga" (string para
  // permitir vacio/"-"/"1." transitorios, igual que CampoNumero). Se inicializa con
  // el ultimo valor recordado (defaultsCarga.valor) si es util.
  const [valorNuevo, setValorNuevo] = useState<number>(defaultsCarga.valor);
  // Errores de validacion del formulario de "Añadir carga" (no de las cargas ya
  // creadas). Se limpian al cambiar de elemento.
  const [errores, setErrores] = useState<ErrorCampo[]>([]);

  // Al cambiar de elemento seleccionado, limpia los errores del formulario anterior.
  useEffect(() => {
    setErrores([]);
  }, [elementoId]);

  // Cargas de ESTE elemento (filtro por ambito), via el helper de dominio.
  const cargasDelElemento = cargasDeAmbito(modelo, elementoId);

  // En F1 el tipo es siempre lineal (ver cabecera). La hipotesis nueva arranca del
  // ultimo elegido (defaultsCarga.hipotesisId) SOLO si ESA hipotesis sigue existiendo
  // Y NO es la automatica; si se borro (id obsoleto) o apunta a la automatica, cae a
  // la primera hipotesis ASIGNABLE del modelo. Sin esta comprobacion, un id huerfano
  // pasa el `??` (es non-null) y validarCarga lo rechaza, bloqueando anadir cargas
  // aunque haya hipotesis validas disponibles.
  //
  // E2(b): una carga de usuario NUNCA puede vivir en la hipotesis automatica de peso
  // propio (doble computo). El fallback se hace EXPLICITO/robusto filtrando por
  // `!automatica` en vez de confiar en que el modelo vacio la siembre la ultima: la
  // primera ASIGNABLE es la que recibe la carga, y un defaultsCarga que apunte a la
  // automatica se ignora.
  const tipoNuevo: DatosCargaUI["tipo"] = "lineal";
  const asignables = modelo.hipotesis.filter((h) => !h.automatica);
  const hipotesisGuardada = defaultsCarga.hipotesisId;
  const hipotesisGuardadaAsignable =
    hipotesisGuardada !== null &&
    asignables.some((h) => h.id === hipotesisGuardada);
  const hipotesisNueva = hipotesisGuardadaAsignable
    ? hipotesisGuardada
    : (asignables[0]?.id ?? null);

  const anadir = () => {
    const m = leerModelo();
    const hipotesisId = hipotesisNueva;
    // Sin hipotesis disponible no se puede crear (no deberia ocurrir: el modelo
    // vacio siembra dos). Reflejamos el error en el campo de hipotesis.
    //
    // FIX#10: distinguir los dos estados. Si la obra NO tiene hipotesis -> hay que
    // crearlas. Si SI tiene pero ninguna es ASIGNABLE (el usuario borro las basicas y
    // solo queda la automatica de peso propio, a la que no se cuelgan cargas de
    // usuario) -> el mensaje "Crea una hipótesis antes de añadir la carga" enganaba
    // (las hipotesis existen). Mensaje especifico para ese caso.
    if (hipotesisId === null) {
      const mensaje =
        m.hipotesis.length > 0
          ? "No hay hipótesis a las que asignar la carga. Crea una hipótesis de cargas."
          : "Crea una hipótesis antes de añadir la carga.";
      setErrores([
        {
          campo: "hipotesisId",
          mensaje,
        },
      ]);
      return;
    }
    const datos: DatosCargaUI = {
      tipo: tipoNuevo,
      ambito: elementoId,
      valor: valorNuevo,
      hipotesisId,
    };
    const errs = validarCarga(m, null, datos);
    setErrores(errs);
    if (!esValido(errs)) return;
    // Recuerda el ultimo tipo/valor/hipotesis para la proxima carga (defaults).
    setDefaultsCarga({ tipo: tipoNuevo, valor: valorNuevo, hipotesisId });
    modeloStore.getState().ejecutar(
      crearCarga(m, {
        tipo: datos.tipo,
        ambito: datos.ambito,
        valor: datos.valor,
        hipotesisId: datos.hipotesisId,
      }),
    );
  };

  const eliminar = (cargaId: string) => {
    modeloStore.getState().ejecutar(eliminarCarga(leerModelo(), cargaId));
  };

  // Nombre legible de la hipotesis (lenguaje de obra). Si no se encuentra (carga
  // huerfana, no deberia pasar), se muestra un guion.
  const nombreHipotesis = (hipotesisId: string): string =>
    leerModelo().hipotesis.find((h) => h.id === hipotesisId)?.nombre ?? "—";

  // En F1 viga/pilar solo introducen carga lineal (ver cabecera), por lo que no hay
  // aviso de carga superficial que mostrar aqui; `avisoSuperficial` (validacionesCarga)
  // se reservara para cuando exista entrada de cargas superficiales (paños, F3).
  return (
    <div className="cx-cargas">
      <span className="cx-cargas__titulo">Cargas</span>

      {/* Lista de cargas del elemento */}
      <div className="cx-cargas__lista">
        {cargasDelElemento.length === 0 ? (
          <div className="cx-cargas__vacio">Sin cargas.</div>
        ) : (
          cargasDelElemento.map((c) => (
            // Fila: valor | hipótesis | ×. En F1 el tipo es SIEMPRE "Lineal", asi que
            // la columna de tipo seria ruido (identica en toda fila) y se omite del
            // render; el valor —el dato que importa— va primero. La columna de tipo se
            // reintroducira cuando F3 anada cargas puntual/superficial (varios tipos
            // conviviendo). El tipo se conserva en el aria-label del boton × (contexto
            // para lectores de pantalla).
            <div key={c.id} className="cx-cargas__fila">
              <span className="cx-cargas__valor">
                {c.valor} {SUFIJO_POR_TIPO[c.tipo]}
              </span>
              <span className="cx-cargas__hip">{nombreHipotesis(c.hipotesisId)}</span>
              <button
                type="button"
                className="cx-cargas__borrar"
                aria-label={`Eliminar carga ${etiquetaTipo(c.tipo)} ${c.valor}`}
                onClick={() => eliminar(c.id)}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      {/* Añadir carga: valor (kN/m) + hipotesis + boton. El tipo es lineal en F1. */}
      <div className="cx-cargas__anadir">
        <CampoNumero
          etiqueta="Valor"
          sufijo={SUFIJO_POR_TIPO[tipoNuevo]}
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
        {/* Deshabilitado con valor <= 0: no presentamos una accion que validarCarga
            rechazaria con seguridad ("El valor de la carga debe ser mayor que cero").
            El resto de validaciones (hipotesis) siguen en `anadir`/validarCarga. */}
        <Boton variante="primary" onClick={anadir} disabled={!(valorNuevo > 0)}>
          Añadir carga
        </Boton>
      </div>
    </div>
  );
}
