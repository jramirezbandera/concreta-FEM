import { useEffect, useState } from "react";
import { Dialogo } from "./Dialogo";
import {
  validarHipotesis,
  type DatosHipotesisUI,
} from "./validacionesHipotesis";
import { type ErrorCampo } from "./validacionesDialogo";
import { Campo, Segmentado, Boton } from "../primitivas";
import {
  modeloStore,
  vistaStore,
  crearHipotesis,
  editarHipotesis,
  eliminarHipotesis,
} from "../../estado";
import { cargasDeHipotesis } from "../../dominio";
import "./dialogos.css";
import "./gruposPlantas.css";

// DialogoHipotesis (feature-13, T3.1): maestro-detalle con COMMIT EN VIVO, calcado
// de DialogoGruposYPlantas. A la izquierda la lista de hipotesis; al seleccionar
// una, su nombre + tipo (permanente/variable) a la derecha. Cada edicion despacha
// su comando al instante (sin boton "Guardar"). Vocabulario CYPECAD (Hipótesis,
// permanente/variable); cero jerga FEM (nada de "case"/"load combination").
//
// INVARIANTE DEL `base` (CLAUDE.md §10): los comandos se construyen SIEMPRE contra
// el modelo ACTUAL leido justo antes de ejecutar (modeloStore.getState().getModelo()),
// nunca contra la copia del render. Igual que en F10/F11/F12.
//
// Reusa el layout maestro-detalle del dialogo de Grupos/Plantas (clases .cx-gyp__*)
// para identico look; solo cambia el detalle (nombre + tipo, sin sub-lista).

// Tipo de hipotesis nueva por defecto: permanente (peso propio/cargas muertas es el
// caso mas comun al sembrar una obra). El usuario la conmuta a variable si procede.
const HIPOTESIS_DEFECTO = { tipo: "permanente" as const };

const OPCIONES_TIPO = [
  { valor: "permanente", etiqueta: "Permanente" },
  { valor: "variable", etiqueta: "Variable" },
] as const;

// Lee el modelo ACTUAL del store. Se llama justo antes de cada comando para no
// retener el modelo entre ediciones (invariante del `base`).
function leerModelo() {
  return modeloStore.getState().getModelo();
}

// Busca el mensaje de un campo concreto en una lista de errores de validacion.
function errorDe(errores: ErrorCampo[], campo: string): string | undefined {
  return errores.find((e) => e.campo === campo)?.mensaje;
}

// --- Subcomponente: input de TEXTO controlado-local con commit en blur ----------
// Calcado del CampoTexto del dialogo de Grupos/Plantas: estado LOCAL mientras se
// teclea (no despacha por tecla), resincroniza si el valor entrante cambia desde
// fuera (undo, cambio de hipotesis activa). En blur llama onCommit(valor); el padre
// valida y decide si despacha.
interface CampoTextoProps {
  etiqueta: string;
  valor: string;
  onCommit: (v: string) => void;
  error?: string;
}

function CampoTexto({ etiqueta, valor, onCommit, error }: CampoTextoProps) {
  const [local, setLocal] = useState(valor);
  useEffect(() => {
    setLocal(valor);
  }, [valor]);
  return (
    <Campo
      etiqueta={etiqueta}
      value={local}
      error={error}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => onCommit(local)}
    />
  );
}

export function DialogoHipotesis() {
  // Lectura reactiva del modelo (el dialogo no esta en el bucle del viewport; el
  // re-render al editar es aceptable). Selector del array de hipotesis.
  const hipotesis = modeloStore((s) => s.modelo.hipotesis);

  const dialogoActivo = vistaStore((s) => s.dialogoActivo);
  const cerrarDialogo = vistaStore((s) => s.cerrarDialogo);

  const open = dialogoActivo === "hipotesis";

  // Hipotesis activa del detalle. Estado LOCAL del dialogo (no de obra ni de vista):
  // identifica que hipotesis se edita a la derecha. Se selecciona por id.
  const [activaId, setActivaId] = useState<string | null>(null);
  // Errores de validacion campo a campo. Se limpian/actualizan en cada commit; NO
  // bloquean el teclear (el estado local del input es libre).
  const [errores, setErrores] = useState<ErrorCampo[]>([]);
  // Confirmacion de borrado destructivo (solo cuando arrastra cargas). null = sin
  // confirmacion abierta.
  const [confirmacion, setConfirmacion] = useState<{
    titulo: string;
    mensaje: string;
    onConfirmar: () => void;
  } | null>(null);

  // Si no hay activa (o la activa ya no existe), cae a la primera de la lista: el
  // detalle siempre muestra algo si hay hipotesis. Depende solo de la presencia de
  // la activa en el array, no del render completo.
  const activa =
    hipotesis.find((h) => h.id === activaId) ?? hipotesis[0] ?? null;

  // --- Acciones --------------------------------------------------------------
  const nuevaHipotesis = () => {
    const m = leerModelo();
    // Identificamos la recien creada por DIFERENCIA de ids (no por posicion): no
    // asumimos que el comando la anada al final (mismo criterio que F10).
    const idsPrevios = new Set(m.hipotesis.map((h) => h.id));
    // Nombre vacio => el comando deriva "Hipotesis {n}" (siguienteNombre).
    modeloStore.getState().ejecutar(crearHipotesis(m, { nombre: "", ...HIPOTESIS_DEFECTO }));
    const creada = leerModelo().hipotesis.find((h) => !idsPrevios.has(h.id));
    if (creada) setActivaId(creada.id);
    setErrores([]);
  };

  const editarNombre = (nombreRaw: string) => {
    if (!activa) return;
    // Commiteamos el nombre SIN espacios al borde: validamos trimeado, asi que
    // guardar " H2 " burlaria el chequeo de duplicados contra "H2".
    const nombre = nombreRaw.trim();
    const m = leerModelo();
    const errs = validarHipotesis(m, activa.id, { nombre, tipo: activa.tipo });
    const errNombre = errs.filter((e) => e.campo === "nombre");
    setErrores((prev) => [
      ...prev.filter((e) => e.campo !== "nombre"),
      ...errNombre,
    ]);
    if (errNombre.length > 0) return;
    if (nombre === activa.nombre) return; // no-op: no ensucies el undo
    modeloStore.getState().ejecutar(editarHipotesis(m, activa.id, { nombre }));
  };

  const editarTipo = (tipo: DatosHipotesisUI["tipo"]) => {
    if (!activa) return;
    if (tipo === activa.tipo) return; // no-op
    const m = leerModelo();
    modeloStore.getState().ejecutar(editarHipotesis(m, activa.id, { tipo }));
  };

  // Ejecuta el borrado real de la hipotesis (re-lee el modelo: invariante del
  // `base`) y reajusta la activa.
  const ejecutarBorrar = (hipotesisId: string) => {
    modeloStore.getState().ejecutar(eliminarHipotesis(leerModelo(), hipotesisId));
    if (activaId === hipotesisId) setActivaId(null);
    setErrores([]);
  };

  const borrar = (hipotesisId: string) => {
    const m = leerModelo();
    const h = m.hipotesis.find((x) => x.id === hipotesisId);
    // Cuenta las cargas que arrastra (eliminarHipotesis las purga en cascada, un
    // solo undo): mismo criterio que cargasDeHipotesis.
    const nCargas = cargasDeHipotesis(m, hipotesisId).length;
    if (nCargas === 0) {
      // Sin dependientes: borrado inmediato, sin friccion.
      ejecutarBorrar(hipotesisId);
      return;
    }
    const frase = nCargas === 1 ? "1 carga" : `${nCargas} cargas`;
    setConfirmacion({
      titulo: `Eliminar la hipótesis ${h?.nombre ?? ""}`.trim(),
      mensaje: `Se eliminará también ${frase}. Podrás deshacerlo con Ctrl+Z.`,
      onConfirmar: () => ejecutarBorrar(hipotesisId),
    });
  };

  const pie = (
    <Boton variante="ghost" onClick={cerrarDialogo}>
      Cerrar
    </Boton>
  );

  return (
    <>
      <Dialogo
        open={open}
        onOpenChange={(o) => {
          if (!o) cerrarDialogo();
        }}
        titulo="Hipótesis"
        pie={pie}
      >
        <div className="cx-gyp">
          {/* --- Maestro: lista de hipotesis --- */}
          <div className="cx-gyp__maestro">
            <div className="cx-gyp__maestro-head">
              <span className="cx-gyp__seccion-titulo">Hipótesis</span>
              <Boton variante="primary" onClick={nuevaHipotesis}>
                Nueva hipótesis
              </Boton>
            </div>
            <div className="cx-gyp__lista">
              {hipotesis.length === 0 ? (
                <div className="cx-gyp__vacio">Aún no hay hipótesis.</div>
              ) : (
                hipotesis.map((h) => {
                  const clases = [
                    "cx-gyp__item",
                    h.id === activa?.id && "cx-gyp__item--sel",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <button
                      key={h.id}
                      type="button"
                      className={clases}
                      aria-pressed={h.id === activa?.id}
                      onClick={() => {
                        setActivaId(h.id);
                        setErrores([]);
                      }}
                    >
                      {h.nombre}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* --- Detalle: hipotesis activa --- */}
          <div className="cx-gyp__detalle">
            {!activa ? (
              <div className="cx-gyp__vacio">Crea una hipótesis para empezar.</div>
            ) : (
              <>
                <div className="cx-gyp__grupo-campos">
                  <div className="cx-gyp__campo-ancho">
                    <CampoTexto
                      etiqueta="Nombre"
                      valor={activa.nombre}
                      onCommit={editarNombre}
                      error={errorDe(errores, "nombre")}
                    />
                  </div>
                  <div className="cx-gyp__campo-ancho">
                    <span className="cx-campo__label">Tipo</span>
                    <Segmentado
                      aria-label="Tipo"
                      opciones={OPCIONES_TIPO}
                      valor={activa.tipo}
                      onValor={editarTipo}
                    />
                  </div>
                </div>

                {/* Eliminar la hipotesis activa (al pie del detalle). */}
                <div>
                  <button
                    type="button"
                    className="cx-gyp__borrar"
                    onClick={() => borrar(activa.id)}
                  >
                    Eliminar hipótesis
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </Dialogo>

      {/* Confirmacion de borrado destructivo (solo cuando arrastra cargas).
          Dialogo anidado de Radix: se monta sobre el principal. */}
      <Dialogo
        open={confirmacion !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmacion(null);
        }}
        titulo={confirmacion?.titulo ?? ""}
        pie={
          <>
            <Boton variante="ghost" onClick={() => setConfirmacion(null)}>
              Cancelar
            </Boton>
            <Boton
              variante="danger"
              onClick={() => {
                confirmacion?.onConfirmar();
                setConfirmacion(null);
              }}
            >
              Eliminar
            </Boton>
          </>
        }
      >
        <p className="cx-gyp__confirmar-texto">{confirmacion?.mensaje}</p>
      </Dialogo>
    </>
  );
}
