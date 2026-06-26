import { useEffect, useSyncExternalStore } from "react";
import {
  PanelFlotante,
  Boton,
  CampoNumero,
  SelectSeccion,
  SelectMaterial,
} from "../primitivas";
import { CampoArranque, CampoVinculacion } from "./camposPilar";
import { vistaStore, type DefaultsPilar } from "../../estado";
import { listarSecciones, listarMateriales } from "../../biblioteca";
import "./panelHerramientaPilar.css";

// PanelHerramientaPilar (feature-11, Tarea 4.1): panel flotante ligero visible
// SOLO cuando la herramienta "pilar" esta activa. Fija los `defaultsPilar` (lo que
// se aplicara a cada pilar colocado con clic) ANTES o DURANTE la colocacion. Es el
// gemelo "de creacion" del InspectorPilar (que edita el pilar ya seleccionado).
// Autocontrolado: se autooculta fuera del modo pilar.
//
// Vocabulario de obra (Sección, Material, Arranque, Vinculación, Ángulo); cero
// jerga FEM (CLAUDE.md §17). Defaults viajan en vistaStore (estado de UI, NO undo).
//
// UNIDADES (CLAUDE.md §14): el angulo se edita en grados (= interno); la seccion y
// el material solo se eligen por id. No hay conversion aqui.

// Catalogos inmutables: se listan una vez fuera del render (igual que los Select*).
const PRIMERA_SECCION = listarSecciones()[0]?.id ?? null;
const PRIMER_MATERIAL = listarMateriales()[0]?.id ?? null;

// True solo en modo "pilar". subscribeWithSelector -> re-render solo al conmutar.
function useHerramientaPilar(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.herramienta, cb),
    () => vistaStore.getState().herramienta === "pilar",
    () => vistaStore.getState().herramienta === "pilar",
  );
}

// Suscripcion ligera a los defaults (cambian al editar el panel, nunca por frame).
function useDefaultsPilar(): DefaultsPilar {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.defaultsPilar, cb),
    () => vistaStore.getState().defaultsPilar,
    () => vistaStore.getState().defaultsPilar,
  );
}

function PanelActivo() {
  const defaults = useDefaultsPilar();
  const setDefaults = vistaStore.getState().setDefaultsPilar;
  const terminar = () => vistaStore.getState().setHerramienta("seleccion");

  // UX: al activar la herramienta sin seccion/material fijados, preselecciona el
  // primero del catalogo para que el primer clic pueda colocar de inmediato (la
  // ColocacionPilar ignora el clic si faltan seccion/material). Solo rellena lo
  // vacio: respeta lo que el usuario ya hubiera elegido en sesiones previas.
  useEffect(() => {
    const parche: Partial<DefaultsPilar> = {};
    if (!defaults.seccionId && PRIMERA_SECCION) parche.seccionId = PRIMERA_SECCION;
    if (!defaults.materialId && PRIMER_MATERIAL) parche.materialId = PRIMER_MATERIAL;
    if (Object.keys(parche).length > 0) setDefaults(parche);
    // Se ejecuta al montar (entrada en modo pilar); las dependencias evitan
    // re-disparar tras rellenar (los ids ya no son null).
  }, [defaults.seccionId, defaults.materialId, setDefaults]);

  return (
    <PanelFlotante
      className="cx-herramienta-pilar"
      titulo="Nuevo pilar"
      tag="pilar"
      // data-testid para E2E (feature-16): panel glass sin rol (es un <div .cx-float>);
      // marca que la herramienta de pilar esta activa. Sus controles internos
      // (Sección, Material, Ángulo) se localizan por etiqueta/rol; el panel da el
      // gancho estable para afirmar el modo de introduccion.
      data-testid="panel-herramienta-pilar"
    >
      <SelectSeccion
        etiqueta="Sección"
        valor={defaults.seccionId}
        onCambio={(id) => setDefaults({ seccionId: id })}
      />
      <SelectMaterial
        etiqueta="Material"
        valor={defaults.materialId}
        onCambio={(id) => setDefaults({ materialId: id })}
      />

      <CampoNumero
        etiqueta="Ángulo"
        sufijo="°"
        valor={defaults.angulo}
        // Sin validacion aqui: si el campo queda vacio/no numerico, conserva el
        // angulo actual en vez de fijar NaN en los defaults.
        onCommit={(v) =>
          setDefaults({ angulo: Number.isFinite(v) ? v : defaults.angulo })
        }
      />

      <CampoArranque
        className="cx-herramienta-pilar__campo"
        valor={defaults.arranque}
        onValor={(v) => setDefaults({ arranque: v })}
      />

      <CampoVinculacion
        className="cx-herramienta-pilar__campo"
        valor={defaults.vinculacionExterior}
        onValor={(v) => setDefaults({ vinculacionExterior: v })}
      />

      <div className="cx-herramienta-pilar__acciones">
        <Boton variante="ghost" onClick={terminar}>
          Terminar
        </Boton>
      </div>
    </PanelFlotante>
  );
}

export function PanelHerramientaPilar() {
  const activo = useHerramientaPilar();
  if (!activo) return null;
  return <PanelActivo />;
}
