// usePickingRef: resaltado de hover/seleccion SIN setState por frame (regla #11).
//
// El color/escala de cada instancia se MUTA directamente sobre el InstancedMesh
// via ref, en respuesta a transient updates de seleccionStore (subscribe con
// subscribeWithSelector). NUNCA se usa useState que se actualice por frame ni se
// guarda el hover en estado React: el unico estado React es el id->instanceId
// (que cambia con la geometria, no por frame).
//
// Tras cada mutacion visual se llama invalidate() para que frameloop="demand"
// pinte un frame (el lienzo no re-renderiza en reposo).
import { useEffect } from "react";
import { invalidate } from "@react-three/fiber";
import type { Color, InstancedMesh } from "three";
import { seleccionStore } from "../../../estado";

export interface PintorInstancias {
  // Aplica el color base/hover/seleccion a la instancia i. Implementado por el
  // componente que posee el InstancedMesh (sabe su buffer de color).
  pintar(i: number, modo: "base" | "hover" | "seleccion"): void;
}

// Suscribe el resaltado a seleccionStore. `idsPorInstancia` mapea instanceId->id
// de dominio; `instanciaPorId` el inverso. Ante cada cambio de hover/seleccion
// REPINTA TODAS las instancias segun el estado actual (recorrido completo en
// `aplicar()`), no solo las afectadas; basta para el volumen de F1 y simplifica.
export function useResaltadoSeleccion(
  malla: { current: InstancedMesh | null },
  idPorInstancia: readonly string[],
  pintor: PintorInstancias,
): void {
  useEffect(() => {
    const instanciaPorId = new Map<string, number>();
    idPorInstancia.forEach((id, i) => instanciaPorId.set(id, i));

    // Repinta todas las instancias segun el estado actual de hover/seleccion.
    const aplicar = () => {
      const { seleccion, hoverId } = seleccionStore.getState();
      idPorInstancia.forEach((elemId, i) => {
        const sel = seleccion.includes(elemId);
        const hov = elemId === hoverId && hoverId !== null;
        pintor.pintar(i, sel ? "seleccion" : hov ? "hover" : "base");
      });
      const colorAttr = malla.current?.instanceColor;
      if (colorAttr) colorAttr.needsUpdate = true;
      invalidate();
    };

    // Pintado inicial coherente con el estado al montar/regenerar geometria.
    aplicar();

    const offHover = seleccionStore.subscribe((s) => s.hoverId, aplicar);
    const offSel = seleccionStore.subscribe((s) => s.seleccion, aplicar);
    return () => {
      offHover();
      offSel();
    };
    // idPorInstancia es estable por reconstruccion de geometria (nuevo array =>
    // re-suscribir, correcto). pintor/malla son refs estables.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idPorInstancia]);
}

// Mezcla in-place: deja `destino` = base, salvo tinte de hover/seleccion. Helper
// para el pintor del InstancedMesh de pilares.
export function aplicarTinte(
  destino: Color,
  base: Color,
  hover: Color,
  seleccion: Color,
  modo: "base" | "hover" | "seleccion",
): void {
  if (modo === "seleccion") destino.copy(seleccion);
  else if (modo === "hover") destino.copy(hover);
  else destino.copy(base);
}
