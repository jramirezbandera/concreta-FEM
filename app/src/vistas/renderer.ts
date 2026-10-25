/**
 * El `WebGLRenderer` de la página (H41): uno solo, de larga vida, con stencil (los rellenos de la
 * planta, `capas.ts`) y antialias. Chrome no da más de 16 contextos y `dispose` no los libera, así
 * que el motor de vistas que se monta se queda con su lienzo.
 *
 * Sin WebGL (jsdom en los tests, un navegador sin él) no hay renderer: el motor lo dice en cada
 * vista y todo lo demás sigue funcionando.
 */
import { AmbientLight, BufferAttribute, BufferGeometry, DirectionalLight, DoubleSide, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshLambertMaterial, PerspectiveCamera, Scene, WebGLRenderer, type Material } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { MATERIAL_DEGRADADO, MATERIAL_LINEAS } from "./fondo.ts";

let compartido: WebGLRenderer | null | undefined;

/**
 * Los materiales del 3D (`vista3d.ts`), para precalentarlos tal cual: llevan los planos de la caja
 * de sección (I3), que cambian su programa.
 */
export const MATERIALES_3D: Material[] = [];

export function rendererCompartido(): WebGLRenderer | null {
  if (compartido !== undefined) return compartido;
  // jsdom no tiene WebGL (y avisa por consola si se le pide un contexto)
  if (typeof window === "undefined" || typeof (window as { WebGL2RenderingContext?: unknown }).WebGL2RenderingContext === "undefined") return (compartido = null);
  try {
    const r = new WebGLRenderer({ antialias: true, stencil: true, alpha: false });
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.autoClear = false;
    // La caja de sección (I3): planos de recorte por material
    r.localClippingEnabled = true;
    r.domElement.style.display = "block";
    // Comprobar los errores de un shader espera a que el driver lo compile (decenas de ms en el
    // hilo principal la primera vez): sólo al desarrollar
    r.debug.checkShaderErrors = !!import.meta.env?.DEV;
    compartido = r;
    precalentar(r);
  } catch {
    compartido = null;
  }
  return compartido;
}

/**
 * Compila en segundo plano (compileAsync, con KHR_parallel_shader_compile si lo hay) los programas
 * de todos los materiales del motor, para que la primera planta, el primer 3D o la primera
 * deformada no los compilen en mitad de un fotograma.
 */
function precalentar(r: WebGLRenderer): void {
  const hacer = () => {
    const escena = new Scene();
    escena.add(new AmbientLight(0xffffff, 1.6), new DirectionalLight(0xffffff, 1.4));
    const tri = new BufferGeometry();
    tri.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    tri.setAttribute("normal", new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    tri.setAttribute("color", new BufferAttribute(new Float32Array(9), 3));
    escena.add(new Mesh(tri, new MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, side: DoubleSide })));
    escena.add(new Mesh(tri, new MeshLambertMaterial({ vertexColors: true, side: DoubleSide, transparent: true, opacity: 0.82 })));
    escena.add(new LineSegments(tri, new LineBasicMaterial({ vertexColors: true })));
    escena.add(new LineSegments(tri, new LineBasicMaterial({ transparent: true, opacity: 0.45 })));
    const lg = new LineSegmentsGeometry();
    lg.setPositions([0, 0, 0, 1, 0, 0]);
    lg.setColors([0, 0, 0, 0, 0, 0]);
    for (const m of [new LineMaterial({ linewidth: 1, transparent: true, depthTest: false, depthWrite: false }), new LineMaterial({ linewidth: 1, transparent: true, depthTest: false, depthWrite: false, dashed: true }), new LineMaterial({ vertexColors: true, linewidth: 1.5 })]) {
      const l = new LineSegments2(lg, m);
      if (m.dashed) l.computeLineDistances();
      escena.add(l);
    }
    // Los del fondo (`fondo.ts`): las líneas llevan opacidad por vértice
    const rgba = new BufferGeometry();
    rgba.setAttribute("position", new BufferAttribute(new Float32Array(6), 3));
    rgba.setAttribute("color", new BufferAttribute(new Float32Array(8), 4));
    escena.add(new LineSegments(rgba, MATERIAL_LINEAS));
    escena.add(new Mesh(tri, MATERIAL_DEGRADADO));
    // Los del 3D, los mismos objetos (con sus planos de recorte)
    for (const m of MATERIALES_3D) {
      if (m instanceof LineMaterial) {
        const l = new LineSegments2(lg, m);
        escena.add(l);
      } else if (m instanceof LineBasicMaterial) escena.add(new LineSegments(tri, m));
      else escena.add(new Mesh(tri, m));
    }
    void r.compileAsync(escena, new PerspectiveCamera()).catch(() => {});
  };
  const ric = (window as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback;
  if (ric) ric(hacer);
  else window.setTimeout(hacer, 200);
}
