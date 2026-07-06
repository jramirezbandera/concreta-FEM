// ArbolObra: arbol navegable plantas -> elementos del Sidebar (UX-3.2, spec §3.3).
// Sustituye a la antigua seccion "Plantas": una sola jerarquia donde la fila de
// planta ACTIVA el contexto (comportamiento historico) y las filas de elemento se
// sincronizan con el lienzo:
//   - clic       -> seleccionar (seleccionStore) + activar su planta (contexto)
//   - hover      -> tinte de hover en el lienzo (setHover; el pintado ya existe)
//   - doble clic -> ademas ENCUADRA el elemento (encuadreBus -> AjusteCamara*)
// Sin virtualizacion: <1000 elementos por obra en este tramo del producto; si una
// obra lo supera, virtualizar sera la mejora (documentado aqui a proposito).
import { useMemo } from "react";
import { modeloStore, seleccionStore, vistaStore } from "../../estado";
import { FilaArbol } from "../primitivas";
import { emitirEncuadre } from "../viewport/hooks/encuadreBus";
import { resolverContextoElemento } from "../viewport/hooks/resolverContextoElemento";
import { derivarArbol, type NodoElemento } from "./nodosArbol";

// Swatch semantico por tipo (mismo mapa color->elemento que el lienzo, §1.3).
const SWATCH: Record<NodoElemento["tipo"], string> = {
  pilar: "var(--pilar)",
  viga: "var(--viga)",
  pano: "var(--pano)",
};

export function ArbolObra() {
  const modelo = modeloStore((s) => s.modelo);
  const plantaActivaId = vistaStore((s) => s.plantaActivaId);
  const setPlantaActiva = vistaStore((s) => s.setPlantaActiva);
  const seleccion = seleccionStore((s) => s.seleccion);

  // Derivado por referencia de modelo: solo recalcula al editar la obra.
  const arbol = useMemo(() => derivarArbol(modelo), [modelo]);

  const seleccionar = (id: string): void => {
    seleccionStore.getState().seleccionar([id]);
    // Contexto coherente: seleccionar desde el arbol activa la planta del elemento
    // (mismo criterio que el pick en 3D pleno). SIN salto de pestana: saltar de
    // solapa desde el arbol es brusco; el resaltado en lienzo ya orienta.
    const ctx = resolverContextoElemento(modelo, id);
    if (ctx) setPlantaActiva(ctx.plantaActivaId);
  };

  const encuadrar = (id: string): void => {
    seleccionar(id);
    emitirEncuadre({ objetivo: "elemento", id });
  };

  if (arbol.length === 0) {
    return <div className="cx-menu-empty">Sin plantas definidas</div>;
  }

  return (
    <>
      {arbol.map((planta) => (
        <div key={planta.id} className="cx-arbol__planta">
          <FilaArbol
            label={planta.nombre}
            contador={planta.cota.toFixed(2)}
            seleccionada={planta.id === plantaActivaId}
            onClick={() => setPlantaActiva(planta.id)}
          />
          {planta.elementos.map((el) => (
            <FilaArbol
              key={`${planta.id}:${el.id}`}
              className="cx-arbol__elemento"
              swatch={SWATCH[el.tipo]}
              label={el.nombre}
              seleccionada={seleccion.includes(el.id)}
              title="Clic: seleccionar · Doble clic: encuadrar"
              onClick={() => seleccionar(el.id)}
              onDoubleClick={() => encuadrar(el.id)}
              onMouseEnter={() => seleccionStore.getState().setHover(el.id)}
              onMouseLeave={() => seleccionStore.getState().setHover(null)}
            />
          ))}
        </div>
      ))}
    </>
  );
}
