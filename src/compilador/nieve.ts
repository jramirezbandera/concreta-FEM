/**
 * La nieve de la obra (2026-11-07, decisión del usuario): el programa da el valor y el tipo de caso,
 * no dónde va la carga. De la provincia y la altitud del emplazamiento (`acciones.emplazamiento`),
 * con lo que se fuerce en `acciones.nieve`, sale sk (tabla 3.8 si la obra está en la capital; si no,
 * la E.2 por la zona de clima invernal y la altitud), con el factor de exposición, y qn = μ·sk en una
 * cubierta plana (μ = 1). El caso S y sus cargas los escribe el usuario: la app le propone ese q, y
 * el compilador avisa si el ψ de un caso de nieve no es el de la altitud de la obra.
 */
import { ALTITUD_NIEVE_ALTA, cargaNieveTerreno, FACTOR_EXPOSICION_NIEVE, HIELO_VOLADIZOS, NIEVE_PLANA_SIMPLIFICADA, ZONAS_INVERNALES, type ExposicionNieve, type ZonaInvernal } from "../normas/cteNieve.ts";
import { esCapitalDeProvincia, type Provincia } from "../normas/provincias.ts";
import { emplazamientoDe, provinciaEmplazamiento } from "./emplazamiento.ts";
import type { ModeloFisico, NieveEdificio } from "./fisico.ts";

export interface ProblemaNieve {
  codigo: string;
  mensaje: string;
  ids?: string[];
}

export interface NieveObra {
  provincia: { ine: string; nombre: string } | null;
  zona: ZonaInvernal | null;
  zonaOrigen: "escrita" | "provincia" | null;
  /** Qué parte de la provincia cae en otra zona de clima invernal (si la zona es la de la provincia). */
  frontera?: string;
  altitud: number | null;
  /** sk sale de la tabla 3.8 (la obra está en la capital). */
  capital: { nombre: string; altitud: number; sk: number } | null;
  /** Sobrecarga sobre terreno horizontal, kN/m²; null si la altitud no está tabulada para la zona. */
  sk: number | null;
  skOrigen: "escrita" | "tabla3.8" | "anejoE";
  exposicion: ExposicionNieve;
  factor: number;
  /** sk × factor de exposición. */
  skEfectiva: number | null;
  /** μ·sk con μ = 1: una cubierta plana o de hasta 30°, kN/m². */
  qnPlana: number | null;
  /** El ψ del caso de nieve por la altitud (DB SE, tabla 4.2); null sin altitud. */
  psi: "nieve-hasta-1000" | "nieve-mas-de-1000" | null;
  /** Lo que conviene saber al poner las cargas: la simplificación de 1 kN/m², el hielo, la capital a otra altitud. */
  notas: string[];
}

const coma = (x: number, d = 2) => x.toFixed(d).replace(".", ",");
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Lo que se fuerza de la nieve, si es un objeto. */
function nieveDe(m: ModeloFisico): NieveEdificio {
  const n: unknown = esObjeto(m) && esObjeto(m.acciones) ? m.acciones.nieve : undefined;
  return esObjeto(n) ? (n as NieveEdificio) : {};
}

/** Lo que no vale de `acciones.nieve`. */
export function erroresNieve(m: ModeloFisico): ProblemaNieve[] {
  const bruto: unknown = esObjeto(m) && esObjeto(m.acciones) ? m.acciones.nieve : undefined;
  if (bruto === undefined) return [];
  if (!esObjeto(bruto)) return [{ codigo: "nieve/no-valida", mensaje: "La nieve de las acciones tiene que ser un objeto: lo que se fuerza (zonaInvernal, capital, exposicion, sk)." }];
  const n = bruto as NieveEdificio;
  const r: ProblemaNieve[] = [];
  if (n.zonaInvernal !== undefined && !ZONAS_INVERNALES.includes(n.zonaInvernal)) r.push({ codigo: "nieve/zona", mensaje: `La zona de clima invernal de la nieve va de 1 a 7 (figura E.2 del DB SE-AE; es ${JSON.stringify(n.zonaInvernal)}).` });
  if (n.capital !== undefined && typeof n.capital !== "boolean") r.push({ codigo: "nieve/no-valida", mensaje: "«capital» de la nieve es true (la tabla 3.8) o false (la E.2)." });
  if (n.exposicion !== undefined && !(n.exposicion in FACTOR_EXPOSICION_NIEVE)) r.push({ codigo: "nieve/no-valida", mensaje: `La exposición de la nieve es "normal", "protegida" o "expuesta" (es ${JSON.stringify(n.exposicion)}).` });
  if (n.sk !== undefined && !(typeof n.sk === "number" && Number.isFinite(n.sk) && n.sk > 0)) r.push({ codigo: "nieve/sk", mensaje: "La sobrecarga de nieve escrita, sk, tiene que ser un número mayor que cero, en kN/m²." });
  return r;
}

/**
 * La nieve de la obra, o null con su motivo si falta lo que la decide (la provincia o la zona, y la
 * altitud). Con errores en `acciones.nieve`, null.
 */
export function nieveObra(m: ModeloFisico): { nieve: NieveObra | null; motivo?: string } {
  if (erroresNieve(m).length) return { nieve: null, motivo: "La nieve de las acciones tiene datos que no valen." };
  const n = nieveDe(m);
  const e = emplazamientoDe(m);
  const p: Provincia | undefined = provinciaEmplazamiento(e);
  const altitud = e && typeof e.altitud === "number" && Number.isFinite(e.altitud) ? e.altitud : null;
  const zona: ZonaInvernal | null = n.zonaInvernal ?? p?.zonaInvernal ?? null;
  if (n.sk === undefined && zona === null) return { nieve: null, motivo: "Falta la provincia del emplazamiento (de ella sale la zona de clima invernal)." };
  const esCapital = p ? (n.capital ?? (typeof e?.municipio === "string" && esCapitalDeProvincia(p.ine, e.municipio))) : false;
  const capital = esCapital && p ? { nombre: p.capital.capital, altitud: p.capital.altitud, sk: p.capital.sk } : null;
  if (n.sk === undefined && !capital && altitud === null) return { nieve: null, motivo: "Falta la altitud del emplazamiento (con la zona de clima invernal, da sk en la tabla E.2)." };
  const skOrigen: NieveObra["skOrigen"] = n.sk !== undefined ? "escrita" : capital ? "tabla3.8" : "anejoE";
  const sk = n.sk !== undefined ? n.sk : capital ? capital.sk : cargaNieveTerreno(zona!, altitud!);
  const exposicion = n.exposicion ?? "normal";
  const factor = FACTOR_EXPOSICION_NIEVE[exposicion];
  const skEfectiva = sk === null ? null : sk * factor;
  const notas: string[] = [];
  if (skOrigen === "tabla3.8" && capital && altitud !== null && altitud !== capital.altitud && zona !== null) {
    const e2 = cargaNieveTerreno(zona, altitud);
    if (e2 === null || Math.abs(e2 - capital.sk) >= 0.005)
      notas.push(`sk es el de la tabla 3.8 para ${capital.nombre}, a ${capital.altitud} m, y la obra está a ${altitud} m: la tabla E.2 daría ${e2 === null ? "una altitud fuera de tabla" : `${coma(e2)} kN/m²`}. Si la obra no está en la capital, elija la tabla E.2.`);
  }
  if (sk === null) notas.push(`La zona ${zona} no está tabulada a ${altitud} m en la tabla E.2: la carga de nieve la fija la ordenanza municipal o los datos empíricos disponibles (art. 3.5.2-3). Escriba sk.`);
  if (altitud !== null && altitud > HIELO_VOLADIZOS.altitudMin) notas.push(`Por encima de 1 000 m, los voladizos llevan además la carga lineal de hielo pn = ${HIELO_VOLADIZOS.k}·μ²·sk (art. 3.5.1-4).`);
  if (altitud !== null && altitud < NIEVE_PLANA_SIMPLIFICADA.altitudMax && skEfectiva !== null && skEfectiva <= NIEVE_PLANA_SIMPLIFICADA.carga)
    notas.push(`En cubiertas planas de edificios de pisos por debajo de 1 000 m basta considerar ${coma(NIEVE_PLANA_SIMPLIFICADA.carga, 1)} kN/m² (art. 3.5.1-1), del lado de la seguridad.`);
  return {
    nieve: {
      provincia: p ? { ine: p.ine, nombre: p.nombre } : null,
      zona,
      zonaOrigen: n.zonaInvernal !== undefined ? "escrita" : p ? "provincia" : null,
      ...(n.zonaInvernal === undefined && p?.fronteraInvernal ? { frontera: p.fronteraInvernal } : {}),
      altitud,
      capital,
      sk,
      skOrigen,
      exposicion,
      factor,
      skEfectiva,
      qnPlana: skEfectiva,
      psi: altitud === null ? null : altitud > ALTITUD_NIEVE_ALTA ? "nieve-mas-de-1000" : "nieve-hasta-1000",
      notas,
    },
  };
}

/** Los casos de nieve (acción S) del modelo. */
const casosNieve = (m: ModeloFisico) => (Array.isArray(m.casos) ? m.casos : []).filter((c) => c?.accion?.tipo === "S");

/**
 * Los avisos de la nieve: un caso de nieve con el ψ de la otra altitud, y la zona sin tabular a esa
 * altitud sin sk escrita (sólo con algún caso de nieve: sin él, la nieve no se ha pedido).
 */
export function avisosNieve(m: ModeloFisico): ProblemaNieve[] {
  const casos = casosNieve(m);
  if (!casos.length) return [];
  const { nieve } = nieveObra(m);
  if (!nieve) return [];
  const r: ProblemaNieve[] = [];
  if (nieve.psi) {
    const malos = casos.filter((c) => (c.accion!.psi === "nieve-hasta-1000" || c.accion!.psi === "nieve-mas-de-1000") && c.accion!.psi !== nieve.psi).map((c) => c.id);
    if (malos.length)
      r.push({
        codigo: "nieve/psi-altitud",
        mensaje: `La obra está a ${nieve.altitud} m, así que la nieve lleva el ψ de ${nieve.psi === "nieve-mas-de-1000" ? "más de 1 000 m (ψ₀ 0,7, ψ₁ 0,5, ψ₂ 0,2)" : "hasta 1 000 m (ψ₀ 0,5, ψ₁ 0,2, ψ₂ 0)"} (DB SE, tabla 4.2), y ${malos.length === 1 ? `el caso ${malos[0]} lleva` : `los casos ${malos.join(", ")} llevan`} el de la otra altitud.`,
        ids: malos,
      });
  }
  if (nieve.sk === null) r.push({ codigo: "nieve/fuera-de-tabla", mensaje: nieve.notas.find((x) => x.includes("art. 3.5.2-3")) ?? "La altitud no está tabulada para la zona de clima invernal." });
  return r;
}

/** La hipótesis de la nieve, con algún caso de nieve y sk conocida. */
export function hipotesisNieve(m: ModeloFisico): string | null {
  const casos = casosNieve(m);
  const { nieve: n } = nieveObra(m);
  if (!casos.length || !n || n.sk === null) return null;
  const origen =
    n.skOrigen === "escrita"
      ? "escrita"
      : n.skOrigen === "tabla3.8"
        ? `tabla 3.8, ${n.capital!.nombre}`
        : `tabla E.2, zona ${n.zona}${n.zonaOrigen === "provincia" && n.provincia ? ` (la de ${n.provincia.nombre})` : ""} a ${n.altitud} m`;
  const exp = n.exposicion === "normal" ? "" : `, ${n.exposicion === "protegida" ? "protegida (−20 %)" : "expuesta (+20 %)"} (art. 3.5.1-3)`;
  return (
    `Nieve del emplazamiento (DB SE-AE art. 3.5): sk = ${coma(n.sk)} kN/m² (${origen})${exp}, qn = μ·sk = ${coma(n.qnPlana!)} kN/m² en cubierta plana. ` +
    `Las cargas de ${casos.length === 1 ? `su caso, ${casos[0]!.id},` : `sus casos, ${casos.map((c) => c.id).join(", ")},`} las escribe el usuario donde van; el programa no las reparte.`
  );
}
