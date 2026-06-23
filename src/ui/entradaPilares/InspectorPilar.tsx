import { useEffect, useState } from "react";
import {
  PanelFlotante,
  Boton,
  CampoNumero,
  SelectSeccion,
  SelectMaterial,
} from "../primitivas";
import { CampoArranque, CampoVinculacion } from "./camposPilar";
import { Dialogo } from "../dialogos/Dialogo";
import { SeccionCargas } from "../dialogos";
import {
  validarPilar,
  type DatosPilarUI,
  type ErrorCampo,
} from "../dialogos/validacionesPilar";
import {
  modeloStore,
  seleccionStore,
  editarPilar,
  eliminarPilar,
} from "../../estado";
import type { Modelo, Pilar } from "../../dominio";
import "./inspectorPilar.css";

// InspectorPilar (feature-11, Tarea 3.2): panel flotante sobre el lienzo que edita
// el pilar SELECCIONADO con COMMIT EN VIVO, calcado del patron de
// DialogoGruposYPlantas. Visible solo cuando hay EXACTAMENTE un pilar seleccionado.
// Vocabulario de obra (Pilar, Sección, Material, Planta, Arranque); cero jerga FEM.
//
// INVARIANTE DEL `base` (CLAUDE.md §10): los comandos se construyen SIEMPRE contra
// el modelo ACTUAL leido justo antes de ejecutar (modeloStore.getState().getModelo()),
// nunca contra la copia del render. Igual que en F10.
//
// UNIDADES (CLAUDE.md §14): x/y se editan en m (= interno) y el angulo en grados
// (= interno). No hay conversion aqui; la seccion solo se elige por id.

// Lee el modelo ACTUAL del store. Se llama justo antes de cada comando para no
// retener el modelo entre ediciones (invariante del `base`).
function leerModelo() {
  return modeloStore.getState().getModelo();
}

// Busca el mensaje de un campo concreto en la lista de errores de validacion.
function errorDe(errores: ErrorCampo[], campo: string): string | undefined {
  return errores.find((e) => e.campo === campo)?.mensaje;
}

// Construye los DatosPilarUI completos a partir del pilar actual y un parche del
// campo editado. validarPilar valida el CONJUNTO, asi que el resto de campos se
// toma del pilar vigente.
function datosDesde(pilar: Pilar, cambios: Partial<DatosPilarUI>): DatosPilarUI {
  return {
    nombre: pilar.nombre,
    x: pilar.x,
    y: pilar.y,
    plantaInicial: pilar.plantaInicial,
    plantaFinal: pilar.plantaFinal,
    seccionId: pilar.seccionId,
    materialId: pilar.materialId,
    angulo: pilar.angulo,
    ...cambios,
  };
}

// Cuenta las cargas que arrastraria borrar el pilar (mismo criterio que
// eliminarPilar: cargas cuyo ambito apunta al pilar). Sirve para avisar del alcance
// antes de confirmar el borrado (diseno para la confianza, igual que F10).
function contarCargasDelPilar(modelo: Modelo, pilarId: string): number {
  return modelo.cargas.filter((c) => c.ambito === pilarId).length;
}

// --- Subcomponente: selector simple de PLANTA ----------------------------------
// Las plantas del modelo, ordenadas por cota descendente (orden CYPECAD, como el
// Sidebar). value = id de planta, etiqueta = nombre. <select> nativo (estable en
// jsdom, a diferencia del Radix Select) con look CAD (.cx-input).
interface SelectPlantaProps {
  etiqueta: string;
  plantas: { id: string; nombre: string; cota: number }[];
  valor: string;
  onCambio: (id: string) => void;
}

function SelectPlanta({ etiqueta, plantas, valor, onCambio }: SelectPlantaProps) {
  const ordenadas = [...plantas].sort((a, b) => b.cota - a.cota);
  return (
    <label className="cx-campo">
      <span className="cx-campo__label">{etiqueta}</span>
      <select
        className="cx-input"
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
      >
        {ordenadas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
          </option>
        ))}
      </select>
    </label>
  );
}

export function InspectorPilar() {
  // Lectura reactiva: la seleccion y el modelo. El inspector NO esta en el bucle
  // del viewport; un re-render al seleccionar/editar es aceptable (#11: lo que no
  // puede entrar en el render loop es el viewport, no este panel de propiedades).
  const seleccion = seleccionStore((s) => s.seleccion);
  const pilares = modeloStore((s) => s.modelo.pilares);
  const plantas = modeloStore((s) => s.modelo.plantas);

  // Errores de validacion campo a campo. Se actualizan en cada commit; NO bloquean
  // el teclear (el estado local de cada input es libre).
  const [errores, setErrores] = useState<ErrorCampo[]>([]);
  // Confirmacion de borrado destructivo (solo cuando arrastra cargas). null = sin
  // confirmacion abierta.
  const [confirmacion, setConfirmacion] = useState<{
    titulo: string;
    mensaje: string;
    onConfirmar: () => void;
  } | null>(null);

  // El pilar seleccionado: exactamente uno y debe existir en el modelo.
  const pilarId = seleccion.length === 1 ? seleccion[0] : null;
  const pilar = pilarId ? pilares.find((p) => p.id === pilarId) ?? null : null;

  // Al cambiar de pilar seleccionado, limpia los errores del anterior (no deben
  // heredarse). Depende del id, no del objeto, para no dispararse en cada edicion.
  useEffect(() => {
    setErrores([]);
  }, [pilarId]);

  // 0 o >1 seleccionados, o el id no es un pilar del modelo: no se renderiza.
  if (!pilar) return null;

  // Commit generico de un campo. Construye los DatosPilarUI con el parche, valida,
  // refleja SOLO los errores de los campos tocados y despacha si pasan. No-op si el
  // valor no cambia (no ensuciar el undo, igual que F10).
  const commit = (
    campos: ReadonlyArray<keyof DatosPilarUI>,
    cambios: Partial<DatosPilarUI>,
    parche: Partial<Omit<Pilar, "id" | "nombre">>,
  ) => {
    const m = leerModelo();
    const actual = m.pilares.find((p) => p.id === pilar.id);
    if (!actual) return;
    const datos = datosDesde(actual, cambios);
    const errs = validarPilar(m, pilar.id, datos);
    const camposSet = new Set<string>(campos);
    const errsCampo = errs.filter((e) => camposSet.has(e.campo));
    // Reemplaza solo los errores de los campos tocados; conserva los demas.
    setErrores((prev) => [
      ...prev.filter((e) => !camposSet.has(e.campo)),
      ...errsCampo,
    ]);
    if (errsCampo.length > 0) return;
    // No-op: si ningun campo del parche cambia su valor, no despaches.
    const sinCambio = (
      Object.keys(parche) as (keyof Pilar)[]
    ).every((k) => actual[k] === parche[k as keyof typeof parche]);
    if (sinCambio) return;
    modeloStore.getState().ejecutar(editarPilar(m, pilar.id, parche));
  };

  // --- Borrado ---------------------------------------------------------------
  const ejecutarBorrar = () => {
    modeloStore.getState().ejecutar(eliminarPilar(leerModelo(), pilar.id));
    seleccionStore.getState().limpiar();
  };

  const borrar = () => {
    const m = leerModelo();
    const nCargas = contarCargasDelPilar(m, pilar.id);
    if (nCargas === 0) {
      // Sin dependientes: borrado inmediato, sin friccion.
      ejecutarBorrar();
      return;
    }
    const frase = nCargas === 1 ? "1 carga asociada" : `${nCargas} cargas asociadas`;
    setConfirmacion({
      titulo: `Eliminar el pilar ${pilar.nombre}`,
      mensaje: `Se eliminará el pilar ${pilar.nombre} y ${frase}. Podrás deshacerlo con Ctrl+Z.`,
      onConfirmar: ejecutarBorrar,
    });
  };

  return (
    <>
      <PanelFlotante
        className="cx-inspector-pilar"
        titulo={`Pilar ${pilar.nombre}`}
        tag="pilar"
      >
        <div className="cx-inspector-pilar__fila">
          <CampoNumero
            etiqueta="X"
            sufijo="m"
            valor={pilar.x}
            onCommit={(v) => commit(["x"], { x: v }, { x: v })}
            error={errorDe(errores, "x")}
          />
          <CampoNumero
            etiqueta="Y"
            sufijo="m"
            valor={pilar.y}
            onCommit={(v) => commit(["y"], { y: v }, { y: v })}
            error={errorDe(errores, "y")}
          />
        </div>

        <SelectSeccion
          etiqueta="Sección"
          valor={pilar.seccionId}
          onCambio={(id) => commit(["seccionId"], { seccionId: id }, { seccionId: id })}
        />
        {errorDe(errores, "seccionId") ? (
          <div className="cx-campo__error" role="alert">
            {errorDe(errores, "seccionId")}
          </div>
        ) : null}

        <SelectMaterial
          etiqueta="Material"
          valor={pilar.materialId}
          onCambio={(id) => commit(["materialId"], { materialId: id }, { materialId: id })}
        />
        {errorDe(errores, "materialId") ? (
          <div className="cx-campo__error" role="alert">
            {errorDe(errores, "materialId")}
          </div>
        ) : null}

        <CampoNumero
          etiqueta="Ángulo"
          sufijo="°"
          valor={pilar.angulo}
          onCommit={(v) => commit(["angulo"], { angulo: v }, { angulo: v })}
          error={errorDe(errores, "angulo")}
        />

        <div className="cx-inspector-pilar__fila">
          <SelectPlanta
            etiqueta="Planta inicial"
            plantas={plantas}
            valor={pilar.plantaInicial}
            onCambio={(id) =>
              commit(
                ["plantaInicial", "plantaFinal"],
                { plantaInicial: id },
                { plantaInicial: id },
              )
            }
          />
          <SelectPlanta
            etiqueta="Planta final"
            plantas={plantas}
            valor={pilar.plantaFinal}
            onCambio={(id) =>
              commit(
                ["plantaInicial", "plantaFinal"],
                { plantaFinal: id },
                { plantaFinal: id },
              )
            }
          />
        </div>
        {errorDe(errores, "plantaInicial") ? (
          <div className="cx-campo__error" role="alert">
            {errorDe(errores, "plantaInicial")}
          </div>
        ) : null}
        {errorDe(errores, "plantaFinal") ? (
          <div className="cx-campo__error" role="alert">
            {errorDe(errores, "plantaFinal")}
          </div>
        ) : null}

        <CampoArranque
          className="cx-inspector-pilar__campo"
          valor={pilar.arranque}
          onValor={(v) => commit([], {}, { arranque: v })}
        />

        <CampoVinculacion
          className="cx-inspector-pilar__campo"
          valor={pilar.vinculacionExterior}
          onValor={(v) => commit([], {}, { vinculacionExterior: v })}
        />

        <SeccionCargas elementoId={pilar.id} />

        <div className="cx-inspector-pilar__acciones">
          <Boton variante="ghost" onClick={borrar}>
            Eliminar pilar
          </Boton>
        </div>
      </PanelFlotante>

      {/* Confirmacion de borrado destructivo (solo cuando arrastra cargas).
          Dialogo de Radix montado sobre el lienzo. */}
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
        <p className="cx-inspector-pilar__confirmar-texto">{confirmacion?.mensaje}</p>
      </Dialogo>
    </>
  );
}
