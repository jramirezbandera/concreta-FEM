import type { CapaVista } from "../../estado";
import { modeloStore, vistaStore } from "../../estado";
import { panosDePlanta, pilaresDePlanta, vigasDePlanta } from "../../dominio";
import { FilaArbol, SeccionColapsable } from "../primitivas";
import { emitirEncuadre } from "../viewport/hooks/encuadreBus";
import { ArbolObra } from "./ArbolObra";

// Sidebar (Spec Diseno UI §3.3, rediseno UX-3). Tres secciones, todas ACCIONABLES
// (la auditoria UX-A7/A8 enterro las filas muertas):
//   1. Vistas: espejo real de modoVista/vista3d (planta, 3D, alzados) + Encuadrar.
//   2. Capas:  visibilidad por capa del lienzo (pilares, vigas, paños, cargas,
//              rotulos, plantilla DXF, rejilla) — spec §3.3 "visibilidad por capa".
//   3. Arbol de obra: plantas -> elementos, sincronizado con el lienzo (UX-3.2).
// Lenguaje de obra SIEMPRE: nada de nodos/members (CLAUDE §17). Solo lectura del
// modelo + setters de vistaStore/seleccionStore; el shell usa estado reactivo normal
// (no esta en el bucle de render del viewport).

// Alias fino para conservar el JSX legible (<Seccion titulo=…>).
const Seccion = SeccionColapsable;

// Fila de capa: toggle de visibilidad con "ojo" + swatch semantico + contador chip.
// Boton nativo (aria-pressed = visible); el glifo de ojo es texto (patron ToolsRail,
// sin dependencias de iconos).
function FilaCapa({
  etiqueta,
  visible,
  onToggle,
  swatch,
  contador,
}: {
  etiqueta: string;
  visible: boolean;
  onToggle: () => void;
  swatch?: string;
  contador?: number;
}) {
  return (
    <button
      type="button"
      className={`cx-row cx-row--btn cx-capa${visible ? "" : " cx-capa--oculta"}`}
      aria-pressed={visible}
      title={visible ? `Ocultar ${etiqueta.toLowerCase()}` : `Mostrar ${etiqueta.toLowerCase()}`}
      onClick={onToggle}
    >
      <span className="cx-capa__ojo" aria-hidden="true">
        {visible ? "◉" : "○"}
      </span>
      {swatch && (
        <span
          className="cx-row__swatch"
          style={{ backgroundColor: swatch }}
          aria-hidden="true"
        />
      )}
      <span className="cx-row__label">{etiqueta}</span>
      {contador !== undefined && (
        <span className="cx-row__count mono">{contador}</span>
      )}
    </button>
  );
}

export function Sidebar() {
  // Lectura del modelo: el selector devuelve la misma referencia salvo edicion de la
  // obra, asi que el sidebar solo re-renderiza al editar (no alta frecuencia).
  const modelo = modeloStore((s) => s.modelo);

  const plantaActivaId = vistaStore((s) => s.plantaActivaId);
  const abrirDialogo = vistaStore((s) => s.abrirDialogo);
  // [D11a] Conmutacion de vista desde el arbol (espejo del selector 2D/3D del HUD).
  const modoVista = vistaStore((s) => s.modoVista);
  const setModoVista = vistaStore((s) => s.setModoVista);
  // Alzados de consulta (UX-1.5): sub-vista de 3D con camara ortografica fija.
  const vista3d = vistaStore((s) => s.vista3d);
  const setVista3d = vistaStore((s) => s.setVista3d);
  const irAAlzado = (dir: "frontal" | "lateral") => {
    // El orden importa: setModoVista resetea vista3d a "orbita".
    setModoVista("3d");
    setVista3d(dir);
  };

  // Capas (UX-3.1): ausencia de clave = visible. La rejilla conserva su flag propio.
  const capasOcultas = vistaStore((s) => s.capasOcultas);
  const toggleCapa = vistaStore((s) => s.toggleCapa);
  const rejillaVisible = vistaStore((s) => s.rejillaVisible);
  const toggleRejilla = vistaStore((s) => s.toggleRejilla);
  const numPlantillas = vistaStore((s) => s.plantillas).length;
  const capaVisible = (c: CapaVista): boolean => capasOcultas[c] !== true;

  // Contador de un tipo en el AMBITO activo (planta activa si la hay; si no, la
  // obra), mismo criterio que la auditoria UX-A8. Derivado en render: barato.
  const contarEnAmbito = (
    porPlanta: (m: typeof modelo, plantaId: string) => Array<{ id: string }>,
    totalObra: number,
  ): number => {
    if (plantaActivaId) return porPlanta(modelo, plantaActivaId).length;
    return totalObra;
  };

  return (
    <aside className="cx-sidebar" aria-label="Árbol de obra">
      <Seccion titulo="Vistas">
        <FilaArbol
          label="Planta"
          seleccionada={modoVista === "planta"}
          onClick={() => setModoVista("planta")}
        />
        <FilaArbol
          label="Vista 3D"
          seleccionada={modoVista === "3d" && vista3d === "orbita"}
          onClick={() => setModoVista("3d")}
        />
        {/* Alzados de consulta (UX-1.5): encuadre ortografico fijo, solo lectura
            (el dibujo sigue siendo en planta). */}
        <FilaArbol
          label="Alzado frontal"
          seleccionada={modoVista === "3d" && vista3d === "frontal"}
          onClick={() => irAAlzado("frontal")}
        />
        <FilaArbol
          label="Alzado lateral"
          seleccionada={modoVista === "3d" && vista3d === "lateral"}
          onClick={() => irAAlzado("lateral")}
        />
        <FilaArbol label="Encuadrar la obra" onClick={() => emitirEncuadre()} />
      </Seccion>

      <Seccion titulo="Capas">
        {/* Visibilidad por capa (UX-3.1, spec §3.3). Una capa oculta GANA al enfasis
            por pestana; no toca la Capa 1 ni el calculo. */}
        <FilaCapa
          etiqueta="Pilares"
          swatch="var(--pilar)"
          contador={contarEnAmbito(pilaresDePlanta, modelo.pilares.length)}
          visible={capaVisible("pilares")}
          onToggle={() => toggleCapa("pilares")}
        />
        <FilaCapa
          etiqueta="Vigas"
          swatch="var(--viga)"
          contador={contarEnAmbito(vigasDePlanta, modelo.vigas.length)}
          visible={capaVisible("vigas")}
          onToggle={() => toggleCapa("vigas")}
        />
        <FilaCapa
          etiqueta="Paños"
          swatch="var(--pano)"
          contador={contarEnAmbito(panosDePlanta, modelo.panos.length)}
          visible={capaVisible("panos")}
          onToggle={() => toggleCapa("panos")}
        />
        <FilaCapa
          etiqueta="Cargas"
          visible={capaVisible("cargas")}
          onToggle={() => toggleCapa("cargas")}
        />
        <FilaCapa
          etiqueta="Rótulos"
          visible={capaVisible("rotulos")}
          onToggle={() => toggleCapa("rotulos")}
        />
        <FilaCapa
          etiqueta="Plantillas DXF"
          contador={numPlantillas}
          visible={capaVisible("plantillas")}
          onToggle={() => toggleCapa("plantillas")}
        />
        {/* La rejilla ya tenia flag propio (ToolsRail); esta fila lo REFLEJA para que
            el panel de capas sea el inventario completo de lo que se dibuja. */}
        <FilaCapa
          etiqueta="Rejilla"
          visible={rejillaVisible}
          onToggle={toggleRejilla}
        />
      </Seccion>

      <Seccion titulo="Árbol de obra">
        <ArbolObra />
        {/* Acceso al dialogo de Plantas (feature-10/F3.4): crear/editar la estructura
            de la obra sin pasar por la menubar. */}
        <FilaArbol
          label="Gestionar plantas…"
          onClick={() => abrirDialogo("plantas")}
        />
      </Seccion>
    </aside>
  );
}
