import { useEffect, useSyncExternalStore } from "react";
import {
  PanelFlotante,
  Boton,
  CampoNumero,
  SelectSeccion,
  SelectMaterial,
} from "../primitivas";
import { CampoArranque, CampoVinculacion } from "./camposPilar";
import { vistaStore, modeloStore, type DefaultsPilar } from "../../estado";
import {
  DEFAULT_MATERIAL_ID,
  DEFAULT_SECCION_PILAR,
  resolverSeccionDefault,
  esCombinacionIncoherentePorId,
  mensajeCoherencia,
} from "../../biblioteca";
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
  // Secciones de obra (Capa 1): re-render solo si cambia la referencia del array
  // (Immer la preserva si no se tocan). Necesarias para resolver el default de obra
  // (hormigon sembrado) y para el aviso de coherencia D15.
  const seccionesObra = modeloStore((s) => s.modelo.secciones);

  // UX (D4+D5): al activar la herramienta sin seccion/material fijados, preselecciona
  // la seccion de obra por defecto (hormigon HA 30×30 sembrado; antes cogia el primer
  // PERFIL del catalogo, IPE, incoherente con el MVP de hormigon) y el material por
  // defecto (HA-25). Solo rellena lo vacio: respeta lo que el usuario ya hubiera elegido.
  useEffect(() => {
    const parche: Partial<DefaultsPilar> = {};
    if (!defaults.seccionId) {
      const id = resolverSeccionDefault(DEFAULT_SECCION_PILAR.nombre, seccionesObra);
      if (id) parche.seccionId = id;
    }
    if (!defaults.materialId) parche.materialId = DEFAULT_MATERIAL_ID;
    if (Object.keys(parche).length > 0) setDefaults(parche);
    // Se ejecuta al montar (entrada en modo pilar); las dependencias evitan
    // re-disparar tras rellenar (los ids ya no son null).
  }, [defaults.seccionId, defaults.materialId, seccionesObra, setDefaults]);

  // D15: aviso NO bloqueante si la seccion (perfil metalico / hormigon) no casa con
  // la familia del material (acero / hormigon). Puro; el mensaje va en lenguaje de obra.
  const avisoCoherencia = mensajeCoherencia(
    esCombinacionIncoherentePorId(defaults.seccionId, defaults.materialId, seccionesObra),
  );

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

      {/* D15: aviso de mezcla incoherente seccion<->material. NO bloquea la
          colocacion; solo advierte (--warning, role=status). */}
      {avisoCoherencia ? (
        <p className="cx-aviso-coherencia" role="status">
          {avisoCoherencia}
        </p>
      ) : null}

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
