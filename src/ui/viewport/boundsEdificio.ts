// boundsEdificio: caja envolvente PURA de la obra en coordenadas de ESCENA (Z-up:
// x,y = planta; z = cota), para encuadrar la camara 3D al edificio completo (F2c).
// SIN React/three: testeable en Node. Proyecta los mismos puntos que GeometriaModelo
// (pilares en (x,y) a sus cotas; vigas en los (x,y) de sus nudos a la cota de su planta).
//
// ROBUSTEZ (failure mode G2): un modelo sin geometria devuelve null (el llamador NO
// mueve la camara); un modelo degenerado (un solo pilar, nudos colineales) produce un
// radio con SUELO minimo, para que la distancia de camara (~radio/tan(fov/2)) nunca sea
// 0 ni NaN (pantalla 3D en blanco silenciosa).
import type { Modelo } from "../../dominio";

export interface BoundsEdificio {
  min: [number, number, number];
  max: [number, number, number];
  centro: [number, number, number];
  // Semidiagonal de la caja, con suelo minimo (m): radio de la esfera a encuadrar.
  radio: number;
}

// Suelo del radio (m): evita distancia de camara 0/NaN en modelos degenerados.
const RADIO_MIN = 0.5;

export function boundsEdificio(modelo: Modelo): BoundsEdificio | null {
  const cotaPorPlanta = new Map(modelo.plantas.map((p) => [p.id, p.cota]));
  const nudoPorId = new Map(modelo.nudos.map((n) => [n.id, n]));

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let hay = false;

  const acumular = (x: number, y: number, z: number): void => {
    // Defensa: una coordenada no finita (NaN/Infinity de un modelo corrupto que se
    // colara) envenenaria min/max -> centro/radio NaN -> camara en NaN (3D en blanco
    // silencioso, sin que el guard `if (!b)` lo atrape). Se ignora ese punto.
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    hay = true;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  };

  for (const pilar of modelo.pilares) {
    const cotas = [pilar.plantaInicial, pilar.plantaFinal]
      .map((id) => cotaPorPlanta.get(id))
      .filter((z): z is number => z !== undefined);
    if (cotas.length === 0) {
      acumular(pilar.x, pilar.y, 0); // sin cota conocida: al menos enmarca x,y
    } else {
      for (const z of cotas) acumular(pilar.x, pilar.y, z);
    }
  }

  for (const viga of modelo.vigas) {
    const z = cotaPorPlanta.get(viga.plantaId) ?? 0;
    const ni = nudoPorId.get(viga.nudoI);
    const nj = nudoPorId.get(viga.nudoJ);
    if (ni) acumular(ni.x, ni.y, z);
    if (nj) acumular(nj.x, nj.y, z);
  }

  if (!hay) return null;

  const centro: [number, number, number] = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  ];
  const semidiag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2;
  const radio = Math.max(semidiag, RADIO_MIN);
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], centro, radio };
}

// Caja envolvente de UN elemento de obra (UX-3.2, doble clic en el arbol del
// Sidebar): mismos puntos que proyecta la geometria para ese elemento. null si el
// id no existe o sus referencias estan rotas (el llamador no mueve la camara).
export function boundsElemento(modelo: Modelo, id: string): BoundsEdificio | null {
  const cotaPorPlanta = new Map(modelo.plantas.map((p) => [p.id, p.cota]));
  const puntos: Array<[number, number, number]> = [];

  const pilar = modelo.pilares.find((p) => p.id === id);
  if (pilar) {
    for (const plantaId of [pilar.plantaInicial, pilar.plantaFinal]) {
      const z = cotaPorPlanta.get(plantaId);
      if (z !== undefined) puntos.push([pilar.x, pilar.y, z]);
    }
  }

  const viga = modelo.vigas.find((v) => v.id === id);
  if (viga) {
    const z = cotaPorPlanta.get(viga.plantaId) ?? 0;
    const nudoPorId = new Map(modelo.nudos.map((n) => [n.id, n]));
    for (const nudoId of [viga.nudoI, viga.nudoJ]) {
      const n = nudoPorId.get(nudoId);
      if (n) puntos.push([n.x, n.y, z]);
    }
  }

  const pano = modelo.panos.find((p) => p.id === id);
  if (pano) {
    const z = cotaPorPlanta.get(pano.plantaId) ?? 0;
    const nudoPorId = new Map(modelo.nudos.map((n) => [n.id, n]));
    for (const nudoId of pano.perimetro) {
      const n = nudoPorId.get(nudoId);
      if (n) puntos.push([n.x, n.y, z]);
    }
  }

  if (puntos.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const [x, y, z] of puntos) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) return null; // todos los puntos eran no finitos

  const centro: [number, number, number] = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  ];
  const semidiag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2;
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    centro,
    radio: Math.max(semidiag, RADIO_MIN),
  };
}
