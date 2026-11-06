/**
 * Las masas del sismo desde las cargas (fase VS2, `docs/fem3d/viento-sismo.md` §3.2): de
 * `acciones.sismo` y de la acción de cada caso sale qué fracción de sus cargas cuenta como masa
 * (NCSE-02, art. 3.2; `src/normas/ncse02.ts`). El compilador las deja en `modelo.modal`, y el motor
 * hace con ellas las masas de cada diafragma y los modos de vibración (`src/motor/modal.ts`).
 *
 * Nada se saca de un dato aparte: la masa es el peso que se calcula, con su reparto. Lo que no se
 * puede saber (un caso de uso sin su categoría, un caso sin acción) es un error que pide su
 * fracción, no un valor por defecto en silencio.
 */
import { FRACCION_MASA_NIEVE, FRACCION_MASA_PERMANENTE, FRACCION_MASA_USO, USOS_FUERA_DE_LA_NORMA } from "../normas/ncse02.ts";
import { GRAVEDAD } from "../motor/modelo.ts";
import type { CasoFisico, ModeloFisico, SismoEdificio } from "./fisico.ts";

export interface ProblemaSismo {
  codigo: string;
  mensaje: string;
  ids?: string[];
}

export interface MasaCaso {
  caso: string;
  fraccion: number;
  /** De dónde sale: escrita en `masas`, o por la acción del caso. */
  origen: "escrita" | "permanente" | "uso" | "nieve" | "no-cuenta";
  /** Por qué, para la hipótesis («uso-A», «permanece más de 30 días»…). */
  motivo: string;
}

export interface MasasSismo {
  /** Todos los casos, en su orden, con su fracción. */
  casos: MasaCaso[];
  /** ¿Se ha tomado por defecto la permanencia de la nieve (por el ψ del caso)? */
  nievePorDefecto: boolean;
}

export interface CalculoSismo {
  masas: MasasSismo | null;
  errores: ProblemaSismo[];
}

/**
 * Las fracciones de masa de los casos de `m` (con los del programa ya resueltos: los del viento
 * cuentan 0), o por qué no se pueden saber. Sin `acciones.sismo`, null.
 */
export function calcularSismo(m: ModeloFisico): CalculoSismo | null {
  if (typeof m !== "object" || m === null || !Array.isArray(m.casos)) return null;
  const s: SismoEdificio | undefined = m.acciones?.sismo;
  if (s === undefined) return null;
  const errores: ProblemaSismo[] = [];
  const err = (codigo: string, mensaje: string, ids?: string[]) => errores.push({ codigo, mensaje, ...(ids ? { ids } : {}) });
  if (typeof s !== "object" || s === null || Array.isArray(s)) {
    err("sismo/no-valido", "El sismo de las acciones tiene que ser un objeto (vacío, para las masas y los modos con las fracciones de la norma).");
    return { masas: null, errores };
  }
  if (s.nievePermanente !== undefined && typeof s.nievePermanente !== "boolean") err("sismo/no-valido", "«nievePermanente» del sismo tiene que ser true o false.");
  const escritas = new Map<string, number>();
  if (s.masas !== undefined) {
    if (!Array.isArray(s.masas) || !s.masas.every((x) => typeof x === "object" && x !== null && typeof x.caso === "string")) {
      err("sismo/no-valido", "Las masas del sismo tienen que ser una lista de { caso, fraccion }.");
      return { masas: null, errores };
    }
    const ids = new Set(m.casos.map((c) => c.id));
    for (const x of s.masas as readonly { caso: string; fraccion: number }[]) {
      if (!ids.has(x.caso)) err("sismo/caso-no-existe", `Las masas del sismo nombran el caso ${x.caso}, que no existe.`, [x.caso]);
      else if (escritas.has(x.caso)) err("sismo/no-valido", `Las masas del sismo nombran dos veces el caso ${x.caso}.`, [x.caso]);
      else if (!(typeof x.fraccion === "number" && x.fraccion >= 0 && x.fraccion <= 1)) err("sismo/no-valido", `La fracción de masa del caso ${x.caso} tiene que estar entre 0 y 1.`, [x.caso]);
      escritas.set(x.caso, x.fraccion);
    }
  }
  let nievePorDefecto = false;
  const casos: MasaCaso[] = [];
  for (const c of m.casos as readonly CasoFisico[]) {
    const dada = escritas.get(c.id);
    if (dada !== undefined) {
      casos.push({ caso: c.id, fraccion: dada, origen: "escrita", motivo: "escrita" });
      continue;
    }
    const a = c.accion;
    const tipo = a?.tipo ?? (c.pesoPropio ? "G" : undefined);
    const falta = (que: string) =>
      err("sismo/caso-sin-fraccion", `No se puede saber qué fracción de las cargas del caso ${c.id} cuenta como masa en el sismo: ${que}. Póngala en acciones.sismo.masas ({ "caso": "${c.id}", "fraccion": … }).`, [c.id]);
    if (tipo === undefined) falta("el caso no tiene su acción");
    else if (tipo === "G") casos.push({ caso: c.id, fraccion: FRACCION_MASA_PERMANENTE, origen: "permanente", motivo: "permanente" });
    else if (tipo === "Q") {
      const psi = a?.psi;
      if (typeof psi === "string" && psi in FRACCION_MASA_USO) casos.push({ caso: c.id, fraccion: FRACCION_MASA_USO[psi as keyof typeof FRACCION_MASA_USO], origen: "uso", motivo: psi });
      else falta("es una sobrecarga de uso sin su categoría (el ψ por su nombre, de \"uso-A\" a \"uso-G\")");
    } else if (tipo === "S") {
      const psi = a?.psi;
      if (s.nievePermanente !== undefined) casos.push({ caso: c.id, fraccion: s.nievePermanente ? FRACCION_MASA_NIEVE : 0, origen: "nieve", motivo: s.nievePermanente ? "permanece más de 30 días al año" : "no permanece 30 días al año" });
      else if (psi === "nieve-mas-de-1000" || psi === "nieve-hasta-1000") {
        nievePorDefecto = true;
        casos.push({ caso: c.id, fraccion: psi === "nieve-mas-de-1000" ? FRACCION_MASA_NIEVE : 0, origen: "nieve", motivo: psi === "nieve-mas-de-1000" ? "a más de 1 000 m, se toma que permanece más de 30 días al año" : "hasta 1 000 m, se toma que no permanece 30 días al año" });
      } else falta("es nieve, y no se sabe si permanece más de 30 días al año (acciones.sismo.nievePermanente)");
    } else casos.push({ caso: c.id, fraccion: 0, origen: "no-cuenta", motivo: tipo });
  }
  return errores.length ? { masas: null, errores } : { masas: { casos, nievePorDefecto }, errores };
}

const coma = (x: number): string => String(x).replace(".", ",");

/** La hipótesis del cálculo con las masas del sismo. */
export function hipotesisSismo(s: MasasSismo): string {
  const cuentan = s.casos.filter((c) => c.fraccion > 0);
  const no = s.casos.filter((c) => c.fraccion === 0).map((c) => c.caso);
  const fuera = cuentan.filter((c) => c.origen === "uso" && (USOS_FUERA_DE_LA_NORMA as readonly string[]).includes(c.motivo));
  return (
    `Masas y modos de vibración para el sismo (VS2; NCSE-02, art. 3.2). La masa sale de las cargas: de cada caso, la fracción que le toca de la componente vertical de sus cargas, entre g = ${coma(GRAVEDAD)} m/s². ` +
    `Cuentan: ${cuentan.length ? cuentan.map((c) => `${c.caso} ×${coma(c.fraccion)} (${c.motivo})`).join("; ") : "ningún caso"}${no.length ? `. No cuentan: ${no.join(", ")}` : ""}. ` +
    (s.nievePorDefecto ? "La permanencia de la nieve se toma de su ψ (por encima de 1 000 m, más de 30 días al año); se cambia con «nievePermanente». " : "") +
    (fuera.length ? `La fracción de ${fuera.map((c) => `${c.caso} (${c.motivo})`).join(" y ")} no está en la norma: se toma 0,6 en la categoría E y 0 en la G. ` : "") +
    `La masa de cada nudo va al diafragma rígido de su planta, con su centro de masas y su inercia de giro; la de los nudos que no son de ningún diafragma (las filas intermedias de los muros, la planta más baja) se reparte por su cota entre el nivel de arriba y el de abajo, y la que les toca a los apoyos va al terreno. ` +
    `Sólo tiene inercia horizontal (tres grados de libertad por planta, art. 3.6.2.1), y los modos salen de la rigidez condensada a esos grados de libertad, que con toda la masa en ellos es exacta: todos los modos, con el 100 % de la masa.`
  );
}
