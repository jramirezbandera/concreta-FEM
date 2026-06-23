import { useEffect, useState } from "react";
import {
  PanelFlotante,
  Boton,
  SelectSeccion,
  SelectMaterial,
} from "../primitivas";
import { CampoExtremo, CampoTirante } from "./camposViga";
import { Dialogo } from "../dialogos/Dialogo";
import { SeccionCargas } from "../dialogos";
import {
  validarViga,
  type DatosVigaUI,
  type ErrorCampo,
} from "../dialogos/validacionesViga";
import {
  modeloStore,
  seleccionStore,
  editarViga,
  eliminarViga,
} from "../../estado";
import type { Modelo, Viga } from "../../dominio";
import { cargasDeAmbito } from "../../dominio";
import "./inspectorViga.css";

// InspectorViga (feature-12, Tarea 2.2): panel flotante sobre el lienzo que edita
// la viga SELECCIONADA con COMMIT EN VIVO. Espejo de InspectorPilar, pero
// SOLO-PROPIEDADES: la geometria (nudoI/nudoJ y sus coordenadas) la fija la
// introduccion grafica en planta, NO este formulario (decision de producto). Visible
// solo cuando hay EXACTAMENTE una viga seleccionada. Vocabulario de obra (Viga,
// Sección, Material, Extremo empotrado/articulado, Tirante); cero jerga FEM.
//
// INVARIANTE DEL `base` (CLAUDE.md §10): los comandos se construyen SIEMPRE contra
// el modelo ACTUAL leido justo antes de ejecutar (modeloStore.getState().getModelo()),
// nunca contra la copia del render. Igual que en F10/F11.
//
// UNIDADES (CLAUDE.md §14): el inspector de viga no edita magnitudes con unidades
// (seccion/material por id, extremos enum, tirante boolean); no hay conversion aqui.

// Lee el modelo ACTUAL del store. Se llama justo antes de cada comando para no
// retener el modelo entre ediciones (invariante del `base`).
function leerModelo() {
  return modeloStore.getState().getModelo();
}

// Busca el mensaje de un campo concreto en la lista de errores de validacion.
function errorDe(errores: ErrorCampo[], campo: string): string | undefined {
  return errores.find((e) => e.campo === campo)?.mensaje;
}

// Construye los DatosVigaUI completos a partir de la viga actual y un parche del
// campo editado. validarViga valida el CONJUNTO, asi que el resto de campos se toma
// de la viga vigente. nombre no se edita aqui (solo-propiedades), pero forma parte
// del contrato de validacion (unicidad).
function datosDesde(viga: Viga, cambios: Partial<DatosVigaUI>): DatosVigaUI {
  return {
    nombre: viga.nombre,
    seccionId: viga.seccionId,
    materialId: viga.materialId,
    extremoI: viga.extremoI,
    extremoJ: viga.extremoJ,
    tirante: viga.tirante,
    ...cambios,
  };
}

// Cuenta las cargas que arrastraria borrar la viga (mismo criterio que eliminarViga:
// cargas cuyo ambito apunta a la viga). Sirve para avisar del alcance antes de
// confirmar el borrado (diseno para la confianza, igual que F10/F11).
function contarCargasDeLaViga(modelo: Modelo, vigaId: string): number {
  return cargasDeAmbito(modelo, vigaId).length;
}

export function InspectorViga() {
  // Lectura reactiva: la seleccion y las vigas. El inspector NO esta en el bucle del
  // viewport; un re-render al seleccionar/editar es aceptable (#11: lo que no puede
  // entrar en el render loop es el viewport, no este panel de propiedades).
  const seleccion = seleccionStore((s) => s.seleccion);
  const vigas = modeloStore((s) => s.modelo.vigas);

  // Errores de validacion campo a campo. Se actualizan en cada commit; NO bloquean
  // el teclear (el estado local de cada control es libre).
  const [errores, setErrores] = useState<ErrorCampo[]>([]);
  // Confirmacion de borrado destructivo (solo cuando arrastra cargas). null = sin
  // confirmacion abierta.
  const [confirmacion, setConfirmacion] = useState<{
    titulo: string;
    mensaje: string;
    onConfirmar: () => void;
  } | null>(null);

  // La viga seleccionada: exactamente una y debe existir en el modelo.
  const vigaId = seleccion.length === 1 ? seleccion[0] : null;
  const viga = vigaId ? vigas.find((v) => v.id === vigaId) ?? null : null;

  // Al cambiar de viga seleccionada, limpia los errores de la anterior (no deben
  // heredarse). Depende del id, no del objeto, para no dispararse en cada edicion.
  useEffect(() => {
    setErrores([]);
  }, [vigaId]);

  // 0 o >1 seleccionadas, o el id no es una viga del modelo: no se renderiza.
  if (!viga) return null;

  // Commit generico de un campo. Construye los DatosVigaUI con el parche, valida,
  // refleja SOLO los errores de los campos tocados y despacha si pasan. No-op si el
  // valor no cambia (no ensuciar el undo, igual que F10/F11).
  const commit = (
    campos: ReadonlyArray<keyof DatosVigaUI>,
    cambios: Partial<DatosVigaUI>,
    parche: Partial<Omit<Viga, "id" | "nombre">>,
  ) => {
    const m = leerModelo();
    const actual = m.vigas.find((v) => v.id === viga.id);
    if (!actual) return;
    const datos = datosDesde(actual, cambios);
    const errs = validarViga(m, viga.id, datos);
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
      Object.keys(parche) as (keyof Viga)[]
    ).every((k) => actual[k] === parche[k as keyof typeof parche]);
    if (sinCambio) return;
    modeloStore.getState().ejecutar(editarViga(m, viga.id, parche));
  };

  // --- Borrado ---------------------------------------------------------------
  const ejecutarBorrar = () => {
    modeloStore.getState().ejecutar(eliminarViga(leerModelo(), viga.id));
    seleccionStore.getState().limpiar();
  };

  const borrar = () => {
    const m = leerModelo();
    const nCargas = contarCargasDeLaViga(m, viga.id);
    if (nCargas === 0) {
      // Sin dependientes: borrado inmediato, sin friccion.
      ejecutarBorrar();
      return;
    }
    const frase = nCargas === 1 ? "1 carga asociada" : `${nCargas} cargas asociadas`;
    setConfirmacion({
      titulo: `Eliminar la viga ${viga.nombre}`,
      mensaje: `Se eliminará la viga ${viga.nombre} y ${frase}. Podrás deshacerlo con Ctrl+Z.`,
      onConfirmar: ejecutarBorrar,
    });
  };

  return (
    <>
      <PanelFlotante
        className="cx-inspector-viga"
        titulo={`Viga ${viga.nombre}`}
        tag="viga"
      >
        <SelectSeccion
          etiqueta="Sección"
          valor={viga.seccionId}
          onCambio={(id) => commit(["seccionId"], { seccionId: id }, { seccionId: id })}
        />
        {errorDe(errores, "seccionId") ? (
          <div className="cx-campo__error" role="alert">
            {errorDe(errores, "seccionId")}
          </div>
        ) : null}

        <SelectMaterial
          etiqueta="Material"
          valor={viga.materialId}
          onCambio={(id) => commit(["materialId"], { materialId: id }, { materialId: id })}
        />
        {errorDe(errores, "materialId") ? (
          <div className="cx-campo__error" role="alert">
            {errorDe(errores, "materialId")}
          </div>
        ) : null}

        {/* Un tirante trabaja biarticulado: el discretizador fuerza ambos extremos
            articulados. Se muestran fijos en "Articulado" (la verdad del calculo),
            no se ocultan, para que el usuario no crea que su "Empotrado" hace algo. */}
        <div className="cx-inspector-viga__fila">
          <CampoExtremo
            className="cx-inspector-viga__campo"
            etiqueta="Extremo I"
            valor={viga.tirante ? "articulado" : viga.extremoI}
            onValor={(v) => commit([], {}, { extremoI: v })}
            disabled={viga.tirante}
          />
          <CampoExtremo
            className="cx-inspector-viga__campo"
            etiqueta="Extremo J"
            valor={viga.tirante ? "articulado" : viga.extremoJ}
            onValor={(v) => commit([], {}, { extremoJ: v })}
            disabled={viga.tirante}
          />
        </div>

        <CampoTirante
          className="cx-inspector-viga__campo"
          valor={viga.tirante}
          onValor={(v) => commit([], {}, { tirante: v })}
        />

        <SeccionCargas elementoId={viga.id} />

        <div className="cx-inspector-viga__acciones">
          <Boton variante="ghost" onClick={borrar}>
            Eliminar viga
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
        <p className="cx-inspector-viga__confirmar-texto">{confirmacion?.mensaje}</p>
      </Dialogo>
    </>
  );
}
