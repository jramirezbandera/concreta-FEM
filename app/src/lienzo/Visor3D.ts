/**
 * Visor 3D (H41, H42): Three.js directo, fuera de React. Un único `WebGLRenderer` de larga vida para
 * toda la página, que se engancha al contenedor que lo monta (Chrome no da más de 16 contextos, y
 * `dispose` no los libera). Una geometría para las láminas y otra para las barras, nunca un objeto
 * por elemento; se pinta sólo cuando algo cambia (la cámara, la geometría, el tema).
 *
 * Z hacia arriba, como el modelo. La deformada mueve los mismos vértices: x + escala·u.
 */
import { AmbientLight, BufferAttribute, BufferGeometry, Color, DirectionalLight, DoubleSide, LineBasicMaterial, LineSegments, Mesh, MeshLambertMaterial, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Geometria3D } from "../../../src/visor/datos.ts";

export interface Colores3D {
  fondo: string;
  losa: string;
  muro: string;
  pilar: string;
  viga: string;
  vigueta: string;
  activa: string;
  original: string;
}

let rendererCompartido: WebGLRenderer | null = null;
function renderer(): WebGLRenderer {
  if (!rendererCompartido) {
    rendererCompartido = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    rendererCompartido.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  }
  return rendererCompartido;
}

export class Visor3D {
  private readonly el: HTMLElement;
  private readonly escena = new Scene();
  private readonly camara = new PerspectiveCamera(35, 1, 0.1, 5000);
  private readonly controles: OrbitControls;
  private readonly ro: ResizeObserver;
  private g: Geometria3D | null = null;
  private u: Float32Array | null = null;
  private escala = 1;
  private activa: number | null = null;
  private colores: Colores3D;
  private laminas: Mesh | null = null;
  private barras: LineSegments | null = null;
  private originales: LineSegments | null = null;
  private pendiente = 0;
  private encuadrado = false;

  constructor(el: HTMLElement, colores: Colores3D) {
    this.el = el;
    this.colores = colores;
    const r = renderer();
    el.appendChild(r.domElement);
    r.domElement.style.display = "block";
    this.camara.up.set(0, 0, 1);
    this.controles = new OrbitControls(this.camara, r.domElement);
    this.controles.enableDamping = false;
    this.controles.addEventListener("change", () => this.pintar());
    this.escena.add(new AmbientLight(0xffffff, 1.6));
    const sol = new DirectionalLight(0xffffff, 1.4);
    sol.position.set(1, -2, 3);
    this.escena.add(sol);
    this.ro = new ResizeObserver(() => this.redimensionar());
    this.ro.observe(el);
    this.redimensionar();
  }

  private redimensionar(): void {
    const w = Math.max(40, this.el.clientWidth);
    const h = Math.max(40, this.el.clientHeight);
    renderer().setSize(w, h);
    this.camara.aspect = w / h;
    this.camara.updateProjectionMatrix();
    this.pintar();
  }

  /** Pinta en el siguiente fotograma (varios cambios seguidos, una sola vez). */
  pintar(): void {
    if (this.pendiente) return;
    this.pendiente = requestAnimationFrame(() => {
      this.pendiente = 0;
      const r = renderer();
      if (r.domElement.parentElement !== this.el) return;
      r.setClearColor(new Color(this.colores.fondo));
      r.render(this.escena, this.camara);
    });
  }

  ponerColores(c: Colores3D): void {
    this.colores = c;
    this.construir();
  }

  ponerGeometria(g: Geometria3D): void {
    this.g = g;
    this.construir();
    if (!this.encuadrado) this.encuadrar();
  }

  ponerPlantaActiva(i: number | null): void {
    this.activa = i;
    this.construir();
  }

  /** Desplazamientos (3 por nudo, m) y su escala; null quita la deformada. */
  ponerDeformada(u: Float32Array | null, escala: number): void {
    this.u = u;
    this.escala = escala;
    this.construir();
  }

  encuadrar(): void {
    const g = this.g;
    if (!g || !g.nudos.length) return;
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < g.nudos.length; i += 3) {
      min.min(new Vector3(g.nudos[i], g.nudos[i + 1], g.nudos[i + 2]));
      max.max(new Vector3(g.nudos[i], g.nudos[i + 1], g.nudos[i + 2]));
    }
    const centro = min.clone().add(max).multiplyScalar(0.5);
    const radio = Math.max(1, max.clone().sub(min).length() / 2);
    const d = radio / Math.sin((this.camara.fov * Math.PI) / 360);
    this.camara.position.copy(centro).add(new Vector3(-0.55, -0.85, 0.5).normalize().multiplyScalar(d));
    this.camara.near = d / 100;
    this.camara.far = d * 10;
    this.camara.updateProjectionMatrix();
    this.controles.target.copy(centro);
    this.controles.update();
    this.encuadrado = true;
    this.pintar();
  }

  private posicion(n: number, out: Float32Array, o: number): void {
    const g = this.g!;
    const u = this.u;
    const k = this.escala;
    out[o] = g.nudos[3 * n]! + (u ? k * u[3 * n]! : 0);
    out[o + 1] = g.nudos[3 * n + 1]! + (u ? k * u[3 * n + 1]! : 0);
    out[o + 2] = g.nudos[3 * n + 2]! + (u ? k * u[3 * n + 2]! : 0);
  }

  private construir(): void {
    const g = this.g;
    for (const o of [this.laminas, this.barras, this.originales]) {
      if (!o) continue;
      this.escena.remove(o);
      o.geometry.dispose();
      (o.material as { dispose(): void }).dispose();
    }
    this.laminas = this.barras = this.originales = null;
    if (!g) return this.pintar();
    const c = this.colores;
    const col = (s: string) => new Color(s);
    const [cLosa, cMuro, cActiva] = [col(c.losa), col(c.muro), col(c.activa)];

    // Láminas: dos triángulos por cuadrilátero, sin índices (cada lámina su color)
    const nl = g.laminas.length / 4;
    const pos = new Float32Array(nl * 18);
    const colL = new Float32Array(nl * 18);
    for (let i = 0; i < nl; i++) {
      const ns = [g.laminas[4 * i]!, g.laminas[4 * i + 1]!, g.laminas[4 * i + 2]!, g.laminas[4 * i + 3]!];
      const cc = this.activa !== null && g.plantaLamina[i] === this.activa && !g.esMuro[i] ? cActiva : g.esMuro[i] ? cMuro : cLosa;
      [0, 1, 2, 0, 2, 3].forEach((a, v) => {
        this.posicion(ns[a]!, pos, 18 * i + 3 * v);
        colL.set([cc.r, cc.g, cc.b], 18 * i + 3 * v);
      });
    }
    const gl = new BufferGeometry();
    gl.setAttribute("position", new BufferAttribute(pos, 3));
    gl.setAttribute("color", new BufferAttribute(colL, 3));
    gl.computeVertexNormals();
    this.laminas = new Mesh(gl, new MeshLambertMaterial({ vertexColors: true, side: DoubleSide, transparent: true, opacity: 0.82, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    this.escena.add(this.laminas);

    // Barras
    const nb = g.barras.length / 2;
    const pb = new Float32Array(nb * 6);
    const cb = new Float32Array(nb * 6);
    const tipos = [col(c.pilar), col(c.viga), col(c.vigueta), col(c.viga)];
    for (let i = 0; i < nb; i++) {
      this.posicion(g.barras[2 * i]!, pb, 6 * i);
      this.posicion(g.barras[2 * i + 1]!, pb, 6 * i + 3);
      const cc = this.activa !== null && g.plantaBarra[i] === this.activa && g.tipoBarra[i] !== 0 ? cActiva : tipos[g.tipoBarra[i]!]!;
      cb.set([cc.r, cc.g, cc.b, cc.r, cc.g, cc.b], 6 * i);
    }
    const gb = new BufferGeometry();
    gb.setAttribute("position", new BufferAttribute(pb, 3));
    gb.setAttribute("color", new BufferAttribute(cb, 3));
    this.barras = new LineSegments(gb, new LineBasicMaterial({ vertexColors: true }));
    this.escena.add(this.barras);

    // Con deformada, las barras sin deformar en tenue
    if (this.u) {
      const po = new Float32Array(nb * 6);
      const u = this.u;
      this.u = null;
      for (let i = 0; i < nb; i++) {
        this.posicion(g.barras[2 * i]!, po, 6 * i);
        this.posicion(g.barras[2 * i + 1]!, po, 6 * i + 3);
      }
      this.u = u;
      const go = new BufferGeometry();
      go.setAttribute("position", new BufferAttribute(po, 3));
      this.originales = new LineSegments(go, new LineBasicMaterial({ color: col(c.original), transparent: true, opacity: 0.45 }));
      this.escena.add(this.originales);
    }
    this.pintar();
  }

  destruir(): void {
    this.ro.disconnect();
    this.controles.dispose();
    if (this.pendiente) cancelAnimationFrame(this.pendiente);
    this.g = null;
    this.construir();
    const r = renderer();
    if (r.domElement.parentElement === this.el) this.el.removeChild(r.domElement);
  }
}
