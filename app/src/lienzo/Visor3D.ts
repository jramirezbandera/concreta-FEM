/**
 * Visor 3D (H41, H42): Three.js directo, fuera de React. Un único `WebGLRenderer` de larga vida para
 * toda la página, que se engancha al contenedor que lo monta (Chrome no da más de 16 contextos, y
 * `dispose` no los libera). Una geometría para las láminas y otra para las barras, nunca un objeto
 * por elemento; se pinta sólo cuando algo cambia (la cámara, la geometría, el tema).
 *
 * Cambiar la deformada o su escala sólo reescribe las posiciones (y las normales); cambiar la planta
 * activa o el tema, sólo los colores: bucles planos sobre arrays, para no pasar de 50 ms en el hilo
 * principal con el edificio objetivo (33 000 láminas).
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
    rendererCompartido = new WebGLRenderer({ antialias: true });
    rendererCompartido.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  }
  return rendererCompartido;
}

/** Vértices de cada lámina: dos triángulos, 0-1-2 y 0-2-3. */
const ESQUINAS = [0, 1, 2, 0, 2, 3];

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
  private laminas: Mesh<BufferGeometry, MeshLambertMaterial> | null = null;
  private barras: LineSegments<BufferGeometry, LineBasicMaterial> | null = null;
  private originales: LineSegments<BufferGeometry, LineBasicMaterial> | null = null;
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
    this.pintarColores();
  }

  ponerGeometria(g: Geometria3D): void {
    if (g === this.g) return;
    this.g = g;
    this.construir();
    if (!this.encuadrado) this.encuadrar();
  }

  ponerPlantaActiva(i: number | null): void {
    if (i === this.activa) return;
    this.activa = i;
    this.pintarColores();
  }

  /** Desplazamientos (3 por nudo, m) y su escala; null quita la deformada. */
  ponerDeformada(u: Float32Array | null, escala: number): void {
    if (u === this.u && escala === this.escala) return;
    const habia = !!this.u;
    this.u = u;
    this.escala = escala;
    if (habia !== !!u) this.construir();
    else this.posiciones();
  }

  encuadrar(): void {
    const g = this.g;
    if (!g || !g.nudos.length) return;
    let [x0, y0, z0, x1, y1, z1] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < g.nudos.length; i += 3) {
      const [x, y, z] = [g.nudos[i]!, g.nudos[i + 1]!, g.nudos[i + 2]!];
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (z < z0) z0 = z;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      if (z > z1) z1 = z;
    }
    const centro = new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const radio = Math.max(1, Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2);
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

  private quitar(): void {
    for (const o of [this.laminas, this.barras, this.originales]) {
      if (!o) continue;
      this.escena.remove(o);
      o.geometry.dispose();
      o.material.dispose();
    }
    this.laminas = this.barras = this.originales = null;
  }

  /** Crea las geometrías (vacías) para la geometría y el modo actuales, y las rellena. */
  private construir(): void {
    this.quitar();
    const g = this.g;
    if (!g) return this.pintar();
    const nl = g.laminas.length / 4;
    const nb = g.barras.length / 2;
    const gl = new BufferGeometry();
    gl.setAttribute("position", new BufferAttribute(new Float32Array(nl * 18), 3));
    gl.setAttribute("normal", new BufferAttribute(new Float32Array(nl * 18), 3));
    gl.setAttribute("color", new BufferAttribute(new Float32Array(nl * 18), 3));
    this.laminas = new Mesh(gl, new MeshLambertMaterial({ vertexColors: true, side: DoubleSide, transparent: true, opacity: 0.82, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    const gb = new BufferGeometry();
    gb.setAttribute("position", new BufferAttribute(new Float32Array(nb * 6), 3));
    gb.setAttribute("color", new BufferAttribute(new Float32Array(nb * 6), 3));
    this.barras = new LineSegments(gb, new LineBasicMaterial({ vertexColors: true }));
    this.escena.add(this.laminas, this.barras);
    if (this.u) {
      // Las barras sin deformar, en tenue
      const po = new Float32Array(nb * 6);
      for (let i = 0; i < nb; i++)
        for (let e = 0; e < 2; e++) {
          const n = 3 * g.barras[2 * i + e]!;
          po[6 * i + 3 * e] = g.nudos[n]!;
          po[6 * i + 3 * e + 1] = g.nudos[n + 1]!;
          po[6 * i + 3 * e + 2] = g.nudos[n + 2]!;
        }
      const go = new BufferGeometry();
      go.setAttribute("position", new BufferAttribute(po, 3));
      this.originales = new LineSegments(go, new LineBasicMaterial({ transparent: true, opacity: 0.45 }));
      this.escena.add(this.originales);
    }
    this.posiciones();
    this.pintarColores();
  }

  /** Reescribe las posiciones (x + escala·u) y las normales de cada triángulo. */
  private posiciones(): void {
    const g = this.g;
    if (!g || !this.laminas || !this.barras) return;
    const X = g.nudos;
    const u = this.u;
    const k = u ? this.escala : 0;
    const pos = this.laminas.geometry.getAttribute("position") as BufferAttribute;
    const nor = this.laminas.geometry.getAttribute("normal") as BufferAttribute;
    const P = pos.array as Float32Array;
    const N = nor.array as Float32Array;
    const nl = g.laminas.length / 4;
    for (let i = 0; i < nl; i++) {
      for (let v = 0; v < 6; v++) {
        const n = 3 * g.laminas[4 * i + ESQUINAS[v]!]!;
        const o = 18 * i + 3 * v;
        P[o] = X[n]! + (u ? k * u[n]! : 0);
        P[o + 1] = X[n + 1]! + (u ? k * u[n + 1]! : 0);
        P[o + 2] = X[n + 2]! + (u ? k * u[n + 2]! : 0);
      }
      // Normal de cada triángulo (plana)
      for (let t = 0; t < 2; t++) {
        const o = 18 * i + 9 * t;
        const [ax, ay, az] = [P[o + 3]! - P[o]!, P[o + 4]! - P[o + 1]!, P[o + 5]! - P[o + 2]!];
        const [bx, by, bz] = [P[o + 6]! - P[o]!, P[o + 7]! - P[o + 1]!, P[o + 8]! - P[o + 2]!];
        let [nx, ny, nz] = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
        const l = Math.hypot(nx, ny, nz) || 1;
        [nx, ny, nz] = [nx / l, ny / l, nz / l];
        for (let v = 0; v < 3; v++) {
          N[o + 3 * v] = nx;
          N[o + 3 * v + 1] = ny;
          N[o + 3 * v + 2] = nz;
        }
      }
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    this.laminas.geometry.computeBoundingSphere();
    const pb = this.barras.geometry.getAttribute("position") as BufferAttribute;
    const B = pb.array as Float32Array;
    const nb = g.barras.length / 2;
    for (let i = 0; i < nb; i++)
      for (let e = 0; e < 2; e++) {
        const n = 3 * g.barras[2 * i + e]!;
        const o = 6 * i + 3 * e;
        B[o] = X[n]! + (u ? k * u[n]! : 0);
        B[o + 1] = X[n + 1]! + (u ? k * u[n + 1]! : 0);
        B[o + 2] = X[n + 2]! + (u ? k * u[n + 2]! : 0);
      }
    pb.needsUpdate = true;
    this.barras.geometry.computeBoundingSphere();
    this.pintar();
  }

  /** Reescribe los colores (por tipo y planta activa). */
  private pintarColores(): void {
    const g = this.g;
    if (!g || !this.laminas || !this.barras) return this.pintar();
    const c = this.colores;
    const rgb = (s: string) => {
      const x = new Color(s);
      return [x.r, x.g, x.b] as const;
    };
    const [losa, muro, activa] = [rgb(c.losa), rgb(c.muro), rgb(c.activa)];
    const tipos = [rgb(c.pilar), rgb(c.viga), rgb(c.vigueta), rgb(c.viga)];
    const ca = this.laminas.geometry.getAttribute("color") as BufferAttribute;
    const C = ca.array as Float32Array;
    const nl = g.laminas.length / 4;
    for (let i = 0; i < nl; i++) {
      const cc = g.esMuro[i] ? muro : this.activa !== null && g.plantaLamina[i] === this.activa ? activa : losa;
      for (let v = 0; v < 6; v++) {
        const o = 18 * i + 3 * v;
        C[o] = cc[0];
        C[o + 1] = cc[1];
        C[o + 2] = cc[2];
      }
    }
    ca.needsUpdate = true;
    const cb = this.barras.geometry.getAttribute("color") as BufferAttribute;
    const CB = cb.array as Float32Array;
    const nb = g.barras.length / 2;
    for (let i = 0; i < nb; i++) {
      const t = g.tipoBarra[i]!;
      const cc = t !== 0 && this.activa !== null && g.plantaBarra[i] === this.activa ? activa : tipos[t]!;
      for (let e = 0; e < 2; e++) {
        const o = 6 * i + 3 * e;
        CB[o] = cc[0];
        CB[o + 1] = cc[1];
        CB[o + 2] = cc[2];
      }
    }
    cb.needsUpdate = true;
    this.originales?.material.color.set(c.original);
    this.pintar();
  }

  destruir(): void {
    this.ro.disconnect();
    this.controles.dispose();
    if (this.pendiente) cancelAnimationFrame(this.pendiente);
    this.g = null;
    this.quitar();
    const r = renderer();
    if (r.domElement.parentElement === this.el) this.el.removeChild(r.domElement);
  }
}
