// PanelHerramientaPano (F3): panel flotante ligero visible SOLO cuando la herramienta
// "pano" esta activa. Fija los `defaultsPano` (lo que se aplicara a cada paño colocado
// por dos clics) ANTES o DURANTE la colocacion. Gemelo "de creacion" del InspectorPano
// (que edita el paño ya seleccionado). Autocontrolado: se autooculta fuera del modo
// paño. Espejo de PanelHerramientaViga.
//
// Vocabulario de obra (Espesor, Material, Tamaño de malla, Apoyo de borde); cero jerga
// FEM (CLAUDE.md §17). Defaults viajan en vistaStore (estado de UI, NO undo).
//
// UNIDADES (CLAUDE.md §14): espesor y tamaño de malla se muestran/teclean en mm (campos
// CampoLongitudMm); el dominio guarda m. El material se elige por id.
import { useEffect, useSyncExternalStore } from "react";
import { PanelFlotante, Boton, SelectMaterial, Segmentado } from "../primitivas";
import {
  CampoBordeApoyo,
  CampoLongitudMm,
  CampoDireccionViguetas,
  CampoPesoPropio,
} from "./camposPano";
import { vistaStore, type DefaultsPano } from "../../estado";
import { DEFAULT_MATERIAL_ID } from "../../biblioteca";
import "./panelHerramientaPano.css";

// Selector de tipo de paño. "Losa maciza" (placa de quads) y "Unidireccional"
// (viguetas en una direccion). Reticular NO se ofrece: sigue sin soporte (DP5 del
// contrato). Etiquetas de obra; el valor es el `tipo` del dominio.
const OPCIONES_TIPO: ReadonlyArray<{
  valor: DefaultsPano["tipo"];
  etiqueta: string;
  titulo: string;
}> = [
  { valor: "losa", etiqueta: "Losa maciza", titulo: "Losa maciza de hormigón (placa)" },
  { valor: "unidireccional", etiqueta: "Unidireccional", titulo: "Forjado de viguetas en una dirección" },
];

// True solo en modo "pano". subscribeWithSelector -> re-render solo al conmutar.
function useHerramientaPano(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.herramienta, cb),
    () => vistaStore.getState().herramienta === "pano",
    () => vistaStore.getState().herramienta === "pano",
  );
}

function useDefaultsPano(): DefaultsPano {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.defaultsPano, cb),
    () => vistaStore.getState().defaultsPano,
    () => vistaStore.getState().defaultsPano,
  );
}

function PanelActivo() {
  const defaults = useDefaultsPano();
  const setDefaults = vistaStore.getState().setDefaultsPano;
  const terminar = () => vistaStore.getState().setHerramienta("seleccion");

  // UX (D4+D5): al activar la herramienta sin material fijado, preselecciona el
  // material por defecto (HA-25; la losa default pasa a hormigon, coherente con el MVP;
  // antes cogia el primero del catalogo). Solo rellena lo vacio. La ColocacionPano ignora
  // el clic si falta material.
  useEffect(() => {
    if (!defaults.materialId) {
      setDefaults({ materialId: DEFAULT_MATERIAL_ID });
    }
  }, [defaults.materialId, setDefaults]);

  const esUni = defaults.tipo === "unidireccional";

  return (
    <PanelFlotante
      className="cx-herramienta-pano"
      titulo="Nuevo paño"
      tag="losa"
      data-testid="panel-herramienta-pano"
    >
      {/* Selector de tipo: fija que se colocara (losa maciza o forjado unidireccional)
          ANTES de colocar. Reticular no se ofrece (sin soporte). */}
      <div className="cx-campo cx-herramienta-pano__campo">
        <span className="cx-campo__label">Tipo de forjado</span>
        <Segmentado<DefaultsPano["tipo"]>
          opciones={OPCIONES_TIPO}
          valor={defaults.tipo}
          onValor={(v) => setDefaults({ tipo: v })}
          aria-label="Tipo de forjado"
        />
      </div>

      <SelectMaterial
        etiqueta="Material"
        valor={defaults.materialId}
        onCambio={(id) => setDefaults({ materialId: id })}
      />

      {/* Campos de la LOSA MACIZA: espesor + tamaño de malla. Ocultos bajo
          unidireccional (no aplican: la vigueta no es una placa mallada). */}
      {!esUni ? (
        <>
          <CampoLongitudMm
            etiqueta="Espesor"
            valorM={defaults.espesor}
            onValorM={(m) => {
              if (Number.isFinite(m)) setDefaults({ espesor: m });
            }}
          />
          <CampoLongitudMm
            etiqueta="Tamaño de malla"
            valorM={defaults.tamMalla}
            onValorM={(m) => {
              if (Number.isFinite(m)) setDefaults({ tamMalla: m });
            }}
          />
        </>
      ) : null}

      {/* Campos del forjado UNIDIRECCIONAL: direccion de viguetas, intereje, canto,
          ancho de nervio y peso propio. Solo bajo tipo "unidireccional". */}
      {esUni ? (
        <>
          <CampoDireccionViguetas
            className="cx-herramienta-pano__campo"
            valor={defaults.direccionViguetas}
            onValor={(v) => setDefaults({ direccionViguetas: v })}
          />
          <CampoLongitudMm
            etiqueta="Intereje"
            valorM={defaults.intereje}
            onValorM={(m) => {
              if (Number.isFinite(m)) setDefaults({ intereje: m });
            }}
          />
          <CampoLongitudMm
            etiqueta="Canto"
            valorM={defaults.canto}
            onValorM={(m) => {
              if (Number.isFinite(m)) setDefaults({ canto: m });
            }}
          />
          <CampoLongitudMm
            etiqueta="Ancho de nervio"
            valorM={defaults.anchoNervio}
            onValorM={(m) => {
              if (Number.isFinite(m)) setDefaults({ anchoNervio: m });
            }}
          />
          <CampoPesoPropio
            className="cx-herramienta-pano__campo"
            valor={defaults.pesoPropio}
            onValor={(v) => {
              if (Number.isFinite(v)) setDefaults({ pesoPropio: v });
            }}
          />
        </>
      ) : null}

      <CampoBordeApoyo
        className="cx-herramienta-pano__campo"
        valor={defaults.bordeApoyo}
        onValor={(v) => setDefaults({ bordeApoyo: v })}
      />

      {esUni ? (
        /* Nota de honestidad del forjado unidireccional: reparto en UNA direccion
           (las viguetas descargan en sus dos bordes de apoyo; los bordes paralelos no
           reciben carga), viguetas biapoyadas (empotrado se comporta como apoyado) y
           deuda de los esfuerzos por vigueta. Sustituye a la nota de la losa. */
        <p className="cx-note">
          El forjado reparte en una dirección: las viguetas descargan en sus dos bordes
          de apoyo (los bordes paralelos no reciben carga). Son biapoyadas: un borde
          empotrado se comporta como apoyado. Los esfuerzos de cada vigueta aún no se
          consultan por separado.
        </p>
      ) : (
        /* UX-C9 (reescrita en F3.2; ampliada en F2.3): la losa DESCARGA en el portico
           cuando su contorno coincide con vigas, y ademas en los pilares que queden
           por DENTRO de su superficie (losa plana); el bordeApoyo queda como fallback
           de los bordes sin viga. Se comunica ANTES de colocar para fijar la
           expectativa: dibujarla sobre vigas/pilares = acoplada. */
        <p className="cx-note">
          La losa descarga en las vigas y pilares de su contorno cuando los comparte, y
          también en los pilares que queden por dentro de su superficie; en los bordes
          sin viga se usa el apoyo de borde elegido.
        </p>
      )}

      <div className="cx-herramienta-pano__acciones">
        <Boton variante="ghost" onClick={terminar}>
          Terminar
        </Boton>
      </div>
    </PanelFlotante>
  );
}

export function PanelHerramientaPano() {
  const activo = useHerramientaPano();
  if (!activo) return null;
  return <PanelActivo />;
}
