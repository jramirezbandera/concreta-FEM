// Helpers puros de consulta sobre el Modelo (Capa 1). Sin estado, sin efectos:
// solo lectura del modelo y filtrado por id. No validan integridad referencial.
import { SCHEMA_VERSION } from "./comunes";
import type { Modelo, Grupo, Planta } from "./modelo";
import type { Seccion } from "./seccion";
import type { Nudo } from "./nudo";
import type { Pilar } from "./pilar";
import type { Viga } from "./viga";
import type { Carga } from "./carga";

export function grupoPorId(modelo: Modelo, id: string): Grupo | undefined {
  return modelo.grupos.find((g) => g.id === id);
}

export function plantaPorId(modelo: Modelo, id: string): Planta | undefined {
  return modelo.plantas.find((p) => p.id === id);
}

export function plantasDeGrupo(modelo: Modelo, grupoId: string): Planta[] {
  return modelo.plantas.filter((p) => p.grupoId === grupoId);
}

export function nudoPorId(modelo: Modelo, id: string): Nudo | undefined {
  return modelo.nudos.find((n) => n.id === id);
}

export function seccionPorId(modelo: Modelo, id: string): Seccion | undefined {
  return modelo.secciones.find((s) => s.id === id);
}

// Limitacion conocida: un pilar abarca un tramo (plantaInicial..plantaFinal) pero
// aqui no tenemos acceso al orden por cota. Usamos un criterio simple de extremos:
// pertenece si la planta es su arranque o su cabeza. El criterio geometrico
// completo (pilares pasantes que cruzan plantas intermedias) corresponde al
// discretizador (feature-4), que si dispone de las cotas.
export function pilaresDePlanta(modelo: Modelo, plantaId: string): Pilar[] {
  return modelo.pilares.filter(
    (p) => p.plantaInicial === plantaId || p.plantaFinal === plantaId,
  );
}

export function vigasDePlanta(modelo: Modelo, plantaId: string): Viga[] {
  return modelo.vigas.filter((v) => v.plantaId === plantaId);
}

export function cargasDeHipotesis(modelo: Modelo, hipotesisId: string): Carga[] {
  return modelo.cargas.filter((c) => c.hipotesisId === hipotesisId);
}

// Factoria de un Modelo valido vacio: punto de partida para un proyecto nuevo.
export function crearModeloVacio(): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    grupos: [],
    plantas: [],
    secciones: [],
    nudos: [],
    pilares: [],
    vigas: [],
    panos: [],
    muros: [],
    cargas: [],
    hipotesis: [],
    analisis: { tipo: "lineal", comprobarEstatica: true },
  };
}
