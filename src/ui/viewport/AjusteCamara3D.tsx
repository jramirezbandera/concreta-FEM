// AjusteCamara3D: encuadra la camara perspectiva al edificio completo (F2c). Componente
// R3F sin malla (return null), montado SOLO en vista 3D (Escena lo monta cuando
// !esPlanta), asi que "al montar" == "al entrar en 3D".
//
// CUANDO encuadra (decision F2c, outside-voice #7): al ENTRAR en 3D y cuando el usuario
// pulsa "Encuadrar" (encuadreBus). NO se reencuadra en cada edicion del modelo: editar
// seccion/material/coordenadas desde el inspector en 3D no debe robar la camara.
//
// COMO: reposiciona la camara a ~radio/sin(fov/2) (con margen) en la direccion
// isometrica inicial (1,-1,1) mirando al centro del edificio, y fija el target de los
// OrbitControls a ese centro. Muta refs + invalidate() (frameloop="demand"), nunca por
// frame. NO usa <Bounds> de drei (reparenta hijos e interfiere con overlays/picking).
import { useEffect } from "react";
import { invalidate, useThree } from "@react-three/fiber";
import { PerspectiveCamera, Vector3 } from "three";
import { modeloStore } from "../../estado";
import { boundsEdificio, type BoundsEdificio } from "./boundsEdificio";
import { suscribirEncuadre } from "./hooks/encuadreBus";

// Interfaz minima de los OrbitControls que necesitamos (target + update). Evita
// arrastrar el tipo completo de three-stdlib/drei.
interface ControlesOrbit {
  target: Vector3;
  update: () => void;
}

// Margen sobre el ajuste justo (1 = tangente): deja aire alrededor del edificio.
const MARGEN = 1.25;
// Direccion isometrica de la camara respecto al centro (coincide con la posicion
// inicial [12,-12,12] = direccion (1,-1,1)): preserva el punto de vista.
const DIR_ISO = new Vector3(1, -1, 1).normalize();

function encuadrar(
  camera: PerspectiveCamera,
  controls: ControlesOrbit,
  b: BoundsEdificio,
): void {
  const [cx, cy, cz] = b.centro;
  const fov = (camera.fov * Math.PI) / 180;
  // Distancia para que una esfera de radio `radio` entre en el fov vertical.
  const dist = (b.radio / Math.sin(fov / 2)) * MARGEN;
  camera.position.set(
    cx + DIR_ISO.x * dist,
    cy + DIR_ISO.y * dist,
    cz + DIR_ISO.z * dist,
  );
  controls.target.set(cx, cy, cz);
  camera.updateProjectionMatrix();
  controls.update();
  invalidate();
}

export function AjusteCamara3D() {
  const camera = useThree((s) => s.camera);
  // makeDefault de OrbitControls registra los controles en el store de R3F. Puede ser
  // null en el primer render (orden de montaje); al registrarse, useThree re-renderiza
  // y este efecto vuelve a correr (deps), haciendo el encuadre inicial entonces.
  const controls = useThree((s) => s.controls) as ControlesOrbit | null;

  useEffect(() => {
    if (!controls || !(camera instanceof PerspectiveCamera)) return;
    const ajustar = () => {
      const b = boundsEdificio(modeloStore.getState().modelo);
      if (!b) return; // modelo sin geometria: no mover la camara (G3)
      encuadrar(camera, controls, b);
    };
    ajustar(); // al entrar en 3D (montaje) / cuando los controles ya existen
    return suscribirEncuadre(ajustar); // y cuando el usuario pulse "Encuadrar"
  }, [camera, controls]);

  return null;
}
