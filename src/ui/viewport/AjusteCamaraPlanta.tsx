// AjusteCamaraPlanta: encuadre BAJO DEMANDA de la camara cenital de planta (UX-3.2).
// A diferencia de AjusteCamara3D/Alzado, NO encuadra al montar (en planta la camara
// es del usuario mientras dibuja: robarla al entrar seria un salto); solo reacciona
// al encuadreBus — boton "Encuadrar" (edificio) o doble clic en el arbol de obra
// (elemento). Muta camara orto + target de MapControls + invalidate() (regla #11);
// el calculo del encuadre es puro (encuadrePlanta de encuadreVistas.ts).
import { useEffect } from "react";
import { invalidate, useThree } from "@react-three/fiber";
import { OrthographicCamera, Vector3 } from "three";
import { modeloStore } from "../../estado";
import { boundsEdificio, boundsElemento } from "./boundsEdificio";
import { encuadrePlanta } from "./encuadreVistas";
import { suscribirEncuadre, type ObjetivoEncuadre } from "./hooks/encuadreBus";

// Interfaz minima de los controles (target + update), como en AjusteCamara3D.
interface ControlesConTarget {
  target: Vector3;
  update: () => void;
}

export function AjusteCamaraPlanta() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as ControlesConTarget | null;
  const size = useThree((s) => s.size);

  useEffect(() => {
    if (!controls || !(camera instanceof OrthographicCamera)) return;
    return suscribirEncuadre((obj: ObjetivoEncuadre) => {
      const modelo = modeloStore.getState().modelo;
      const b =
        obj.objetivo === "elemento"
          ? boundsElemento(modelo, obj.id)
          : boundsEdificio(modelo);
      if (!b) return; // sin geometria / id roto: no mover la camara
      const e = encuadrePlanta(b, { w: size.width, h: size.height });
      camera.position.set(e.position[0], e.position[1], e.position[2]);
      camera.zoom = e.zoom;
      controls.target.set(e.target[0], e.target[1], e.target[2]);
      camera.updateProjectionMatrix();
      controls.update();
      invalidate();
    });
  }, [camera, controls, size.width, size.height]);

  return null;
}
