// AjusteCamaraAlzado: encuadra la camara ORTOGRAFICA del alzado de consulta (UX-1.5)
// al edificio completo. Espejo de AjusteCamara3D: componente R3F sin malla, montado
// SOLO en alzado (Escena lo monta cuando vista3d es frontal/lateral), asi que
// "al montar" == "al entrar en el alzado". Reencuadra tambien al pulsar "Encuadrar"
// (encuadreBus) y al cambiar el tamano del viewport (el alzado es una vista de
// consulta: reencuadrar en resize es lo esperado, no un robo de camara).
//
// Muta refs + invalidate() (frameloop="demand"), nunca por frame. El calculo del
// encuadre es puro (encuadreVistas.ts).
import { useEffect } from "react";
import { invalidate, useThree } from "@react-three/fiber";
import { OrthographicCamera, Vector3 } from "three";
import { modeloStore } from "../../estado";
import { boundsEdificio, boundsElemento } from "./boundsEdificio";
import { encuadreAlzado, type DireccionAlzado } from "./encuadreVistas";
import { suscribirEncuadre, type ObjetivoEncuadre } from "./hooks/encuadreBus";

// Interfaz minima de los controles (target + update), como en AjusteCamara3D.
interface ControlesConTarget {
  target: Vector3;
  update: () => void;
}

export function AjusteCamaraAlzado({ dir }: { dir: DireccionAlzado }) {
  const camera = useThree((s) => s.camera);
  // makeDefault de MapControls registra los controles en el store de R3F; null en el
  // primer render (orden de montaje): al registrarse, el efecto vuelve a correr.
  const controls = useThree((s) => s.controls) as ControlesConTarget | null;
  const size = useThree((s) => s.size);

  useEffect(() => {
    if (!controls || !(camera instanceof OrthographicCamera)) return;
    const ajustar = (obj: ObjetivoEncuadre = { objetivo: "edificio" }) => {
      const modelo = modeloStore.getState().modelo;
      const b =
        obj.objetivo === "elemento"
          ? boundsElemento(modelo, obj.id)
          : boundsEdificio(modelo);
      if (!b) return; // sin geometria / id roto: no mover la camara (mismo guard que 3D)
      const e = encuadreAlzado(b, dir, { w: size.width, h: size.height });
      camera.position.set(e.position[0], e.position[1], e.position[2]);
      camera.up.set(0, 0, 1);
      camera.zoom = e.zoom;
      controls.target.set(e.target[0], e.target[1], e.target[2]);
      camera.updateProjectionMatrix();
      controls.update();
      invalidate();
    };
    ajustar(); // al entrar en el alzado / cuando los controles ya existen
    return suscribirEncuadre(ajustar); // y cuando el usuario pulse "Encuadrar"
  }, [camera, controls, dir, size.width, size.height]);

  return null;
}
