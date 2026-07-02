// InspectorPano (F3): panel flotante sobre el lienzo que edita el paño SELECCIONADO con
// COMMIT EN VIVO. Espejo de InspectorViga, SOLO-PROPIEDADES: la geometria (perimetro) la
// fija la introduccion grafica en planta, NO este formulario. Visible solo cuando hay
// EXACTAMENTE un paño seleccionado. Vocabulario de obra (Paño, Material, Espesor, Tamaño
// de malla, Apoyo de borde); cero jerga FEM.
//
// INVARIANTE DEL `base` (CLAUDE.md §10): los comandos se construyen contra el modelo
// ACTUAL leido justo antes de ejecutar, nunca contra la copia del render.
//
// UNIDADES (CLAUDE.md §14): espesor y tamaño de malla se editan en mm (CampoLongitudMm,
// conversion en el borde); el material por id; el apoyo de borde enum.
import { useEffect, useState } from "react";
import { PanelFlotante, Boton, SelectMaterial } from "../primitivas";
import { CampoBordeApoyo, CampoLongitudMm } from "./camposPano";
import { Dialogo } from "../dialogos/Dialogo";
import { SeccionCargaSuperficial } from "./SeccionCargaSuperficial";
import {
  validarPano,
  type DatosPanoUI,
  type ErrorCampo,
} from "../dialogos/validacionesPano";
import {
  modeloStore,
  seleccionStore,
  vistaStore,
  editarPano,
  eliminarPano,
} from "../../estado";
import type { Modelo, Pano } from "../../dominio";
import { cargasDeAmbito } from "../../dominio";
import "./inspectorPano.css";

function leerModelo() {
  return modeloStore.getState().getModelo();
}

function errorDe(errores: ErrorCampo[], campo: string): string | undefined {
  return errores.find((e) => e.campo === campo)?.mensaje;
}

// Construye los DatosPanoUI completos a partir del paño actual y un parche del campo
// editado. validarPano valida el CONJUNTO. El nombre no se edita aqui (solo-propiedades)
// pero forma parte del contrato de validacion (unicidad).
function datosDesde(pano: Pano, cambios: Partial<DatosPanoUI>): DatosPanoUI {
  return {
    nombre: pano.nombre,
    materialId: pano.materialId,
    espesor: pano.espesor,
    tamMalla: pano.tamMalla,
    bordeApoyo: pano.bordeApoyo,
    ...cambios,
  };
}

// Cuenta las cargas que arrastraria borrar el paño (mismo criterio que eliminarPano).
function contarCargasDelPano(modelo: Modelo, panoId: string): number {
  return cargasDeAmbito(modelo, panoId).length;
}

// Estado vacio del inspector (auditoria UX-C6): en la pestana de Isovalores (donde el
// paño es el editor principal) con la herramienta "seleccion" y sin paño seleccionado,
// el dock mostraba solo "Ayudas" sin guiar a que seleccionar un paño abre su editor.
// En vez de desaparecer (return null), rinde una seccion de estado vacio en el cromo
// plano del dock (patron de PanelDiagramas / InspectorPilar). En la pestana de vigas el
// paño acompaña a la viga (editor principal), asi que alli NO muestra estado vacio: lo
// cubre el de InspectorViga y dos "Selecciona…" apilados serian ruido.
function EstadoVacioPano({ mensaje }: { mensaje: string }) {
  return (
    <PanelFlotante className="cx-inspector-pano" titulo="Propiedades">
      <p className="cx-inspector-vacio">{mensaje}</p>
    </PanelFlotante>
  );
}

export function InspectorPano() {
  const seleccion = seleccionStore((s) => s.seleccion);
  const panos = modeloStore((s) => s.modelo.panos);
  // Contexto de UI para el estado vacio: solo en Isovalores (editor principal del paño)
  // y con la herramienta de seleccion.
  const pestanaActiva = vistaStore((s) => s.pestanaActiva);
  const herramienta = vistaStore((s) => s.herramienta);

  const [errores, setErrores] = useState<ErrorCampo[]>([]);
  const [confirmacion, setConfirmacion] = useState<{
    titulo: string;
    mensaje: string;
    onConfirmar: () => void;
  } | null>(null);

  const panoId = seleccion.length === 1 ? seleccion[0] : null;
  const pano = panoId ? panos.find((p) => p.id === panoId) ?? null : null;

  // Al cambiar de paño seleccionado, limpia los errores de la anterior.
  useEffect(() => {
    setErrores([]);
  }, [panoId]);

  // Sin un paño aplicable (0 seleccionados, multiseleccion, o id no-paño): el
  // inspector no edita nada. En Isovalores con herramienta "seleccion" muestra un
  // estado vacio que guia (UX-C6); en cualquier otro contexto se repliega a null
  // (en la pestana de vigas el editor principal es la viga).
  if (!pano) {
    if (pestanaActiva === "isovalores" && herramienta === "seleccion") {
      const mensaje =
        seleccion.length > 1
          ? `${seleccion.length} elementos seleccionados. Edítalos de uno en uno.`
          : "Selecciona un paño para editar sus propiedades.";
      return <EstadoVacioPano mensaje={mensaje} />;
    }
    return null;
  }

  // Commit generico de un campo: construye DatosPanoUI con el parche, valida, refleja
  // solo los errores de los campos tocados y despacha si pasan. No-op si no cambia.
  const commit = (
    campos: ReadonlyArray<keyof DatosPanoUI>,
    cambios: Partial<DatosPanoUI>,
    parche: Partial<Omit<Pano, "id" | "nombre" | "perimetro">>,
  ) => {
    const m = leerModelo();
    const actual = m.panos.find((p) => p.id === pano.id);
    if (!actual) return;
    const datos = datosDesde(actual, cambios);
    const errs = validarPano(m, pano.id, datos);
    const camposSet = new Set<string>(campos);
    const errsCampo = errs.filter((e) => camposSet.has(e.campo));
    setErrores((prev) => [
      ...prev.filter((e) => !camposSet.has(e.campo)),
      ...errsCampo,
    ]);
    if (errsCampo.length > 0) return;
    const sinCambio = (Object.keys(parche) as (keyof Pano)[]).every(
      (k) => actual[k] === parche[k as keyof typeof parche],
    );
    if (sinCambio) return;
    modeloStore.getState().ejecutar(editarPano(m, pano.id, parche));
  };

  // --- Borrado ---------------------------------------------------------------
  const ejecutarBorrar = () => {
    modeloStore.getState().ejecutar(eliminarPano(leerModelo(), pano.id));
    seleccionStore.getState().limpiar();
  };

  const borrar = () => {
    const m = leerModelo();
    const nCargas = contarCargasDelPano(m, pano.id);
    if (nCargas === 0) {
      ejecutarBorrar();
      return;
    }
    const frase = nCargas === 1 ? "1 carga asociada" : `${nCargas} cargas asociadas`;
    setConfirmacion({
      titulo: `Eliminar el paño ${pano.nombre}`,
      mensaje: `Se eliminará el paño ${pano.nombre} y ${frase}. Podrás deshacerlo con Ctrl+Z.`,
      onConfirmar: ejecutarBorrar,
    });
  };

  return (
    <>
      <PanelFlotante
        className="cx-inspector-pano"
        titulo={`Paño ${pano.nombre}`}
        tag="losa"
      >
        <CampoLongitudMm
          etiqueta="Espesor"
          valorM={pano.espesor}
          onValorM={(m) => commit(["espesor"], { espesor: m }, { espesor: m })}
          error={errorDe(errores, "espesor")}
        />

        <SelectMaterial
          etiqueta="Material"
          valor={pano.materialId}
          onCambio={(id) => commit(["materialId"], { materialId: id }, { materialId: id })}
        />
        {errorDe(errores, "materialId") ? (
          <div className="cx-campo__error" role="alert">
            {errorDe(errores, "materialId")}
          </div>
        ) : null}

        <CampoLongitudMm
          etiqueta="Tamaño de malla"
          valorM={pano.tamMalla}
          onValorM={(m) => commit(["tamMalla"], { tamMalla: m }, { tamMalla: m })}
          error={errorDe(errores, "tamMalla")}
        />

        <CampoBordeApoyo
          className="cx-inspector-pano__campo"
          valor={pano.bordeApoyo}
          onValor={(v) => commit([], { bordeApoyo: v }, { bordeApoyo: v })}
        />

        {/* UX-C9: la losa se calcula AISLADA en esta fase (nudos propios, sin
            transferir carga al portico). Se comunica en lenguaje de obra para que el
            usuario no crea que la carga del paño llega a pilares/vigas. */}
        <p className="cx-note">
          En esta fase, la losa se calcula apoyada en su borde, de forma aislada: su
          carga no se transmite a pilares ni vigas.
        </p>

        <SeccionCargaSuperficial panoId={pano.id} />

        <div className="cx-inspector-pano__acciones">
          <Boton variante="ghost" onClick={borrar}>
            Eliminar paño
          </Boton>
        </div>
      </PanelFlotante>

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
        <p className="cx-inspector-pano__confirmar-texto">{confirmacion?.mensaje}</p>
      </Dialogo>
    </>
  );
}
