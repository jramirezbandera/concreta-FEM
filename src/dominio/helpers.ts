// Helpers puros de consulta sobre el Modelo (Capa 1). Sin estado, sin efectos:
// solo lectura del modelo y filtrado por id. No validan integridad referencial.
import { SCHEMA_VERSION } from "./comunes";
import type { Modelo, Grupo, Planta } from "./modelo";
import type { Seccion } from "./seccion";
import type { Nudo } from "./nudo";
import type { Pilar } from "./pilar";
import type { Viga } from "./viga";
import type { Carga, Hipotesis } from "./carga";

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

// Espejo de cargasDeHipotesis, pero filtra por AMBITO (id del elemento sobre el que
// actua la carga: viga/pilar/nudo). Punto unico de lectura para listar/contar las
// cargas de un elemento (SeccionCargas, inspectores), en vez de filtrar a mano.
export function cargasDeAmbito(modelo: Modelo, ambito: string): Carga[] {
  return modelo.cargas.filter((c) => c.ambito === ambito);
}

// Id fijo de la hipotesis automatica de peso propio. SOLO para SEMBRAR: es el id
// canonico que se asigna al CREAR la automatica (crearModeloVacio) y el que la
// migracion v1->v2 (F2.3) siembra en proyectos antiguos (idempotente por id).
// La IDENTIFICACION de "¿es ESTA la automatica?" NO se hace por id sino por el flag
// `automatica` (ver `esHipotesisAutomatica`): asi id y flag no pueden desincronizarse.
export const ID_HIP_PESO_PROPIO = "hip-peso-propio";

// Predicado UNICO de "hipotesis automatica" (la del sistema, p.ej. peso propio). El
// FLAG `automatica` es la fuente de verdad, NO el id: el discretizador, los combos,
// las validaciones y los comandos identifican la automatica por aqui para que id y
// flag jamas diverjan (un .json con automatica:true en un id no canonico se trata
// igual de automatico, y uno con el id canonico pero automatica:false, no).
export function esHipotesisAutomatica(h: Hipotesis): boolean {
  return h.automatica === true;
}

// Busca la (primera) hipotesis automatica del modelo, si existe. Atajo para los
// call sites que necesitan SU id (p.ej. el `case` del peso propio en el discretizador)
// sin reimplementar el filtro por el predicado.
export function hipotesisAutomatica(modelo: Modelo): Hipotesis | undefined {
  return modelo.hipotesis.find(esHipotesisAutomatica);
}

// Factoria de un Modelo valido vacio: punto de partida para un proyecto nuevo.
// Trae sembradas las hipotesis basicas: las dos de F1 (cargas muertas permanentes y
// sobrecarga de uso variable, en cabeza) y la AUTOMATICA de peso propio al FINAL
// (estilo CYPECAD; el discretizador genera sus cargas, automatica:true). Ids ASCII
// fijos y deterministas: el modelo vacio es siempre identico, lo que mantiene
// estables tests y golden. El resto de hipotesis las anade el usuario via comandos
// (F13). `incluirPesoPropio: true` por defecto (F2a): el peso propio se computa salvo
// que el usuario lo desactive.
//
// ORDEN: la automatica va la ULTIMA a proposito. El orden del array NO afecta a la
// Capa 2 (discretizador y `generarCombos` ordenan por id), pero el unico consumidor
// del orden en F1 es el fallback "primera hipotesis" de la UI de cargas
// (SeccionCargas): la primera debe ser ASIGNABLE (no la automatica, a la que no se
// pueden anadir cargas de usuario, E2). El filtro explicito de la automatica en
// SelectHipotesis / su presentacion read-only en DialogoHipotesis llegan en F2.4.
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
    hipotesis: [
      { id: "hip-cargas-muertas", nombre: "Cargas muertas", tipo: "permanente", automatica: false },
      { id: "hip-sobrecarga-uso", nombre: "Sobrecarga de uso", tipo: "variable", automatica: false },
      { id: ID_HIP_PESO_PROPIO, nombre: "Peso propio", tipo: "permanente", automatica: true },
    ],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: true },
  };
}
