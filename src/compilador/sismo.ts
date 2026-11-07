/**
 * El sismo del edificio (fase VS, `docs/fem3d/viento-sismo.md`).
 *
 * **Las masas (VS2, §3.2):** de `acciones.sismo` y de la acción de cada caso sale qué fracción de
 * sus cargas cuenta como masa (NCSE-02, art. 3.2; `src/normas/ncse02.ts`). El compilador las deja en
 * `modelo.modal`, y el motor hace con ellas las masas de cada diafragma y los modos de vibración
 * (`src/motor/modal.ts`). Nada se saca de un dato aparte: la masa es el peso que se calcula, con su
 * reparto. Lo que no se puede saber (un caso de uso sin su categoría, un caso sin acción) es un error
 * que pide su fracción, no un valor por defecto en silencio.
 *
 * **El espectro y los casos (VS3, §3.4):** con la aceleración básica `ab`, el análisis por espectros
 * de respuesta (art. 3.6.2). `calcularSismo` da el emplazamiento (cap. 2) y los coeficientes de la
 * respuesta; `sismoDelCalculo`, con los modos ya calculados, la respuesta en X y en Y y los cuatro
 * casos del programa (`EX+e`, `EX-e`, `EY+e`, `EY-e`) como casos lógicos sobre los modos
 * (`src/motor/espectral.ts`). Esos casos no tienen cargas ni entran en el modelo analítico: el
 * compilador y el motor no los ven, y `Consultas` los añade al final de los casos del modelo físico,
 * que es donde llevan su factor en las combinaciones (familias `EX` y `EY`, con su ± y el 30 % de la
 * otra dirección: el generador no cambia).
 *
 * **El municipio (VS4, VS-l):** `ab` y `K` salen también del municipio, por su código INE (`ine`), de
 * la tabla del Anejo 1 de la norma (`src/normas/peligrosidad.ts`). Los escritos mandan, cada uno por
 * su lado; un código que no está en la tabla es un error (no estar en el anejo no es estar exento), y
 * la hipótesis dice de dónde sale cada uno. `tieneEspectro` dice si el sismo lleva lo que da un
 * espectro: `ab` o el municipio.
 *
 * Convenio de la excentricidad, el del viento: `+e` desplaza la recta de acción hacia +Y con el sismo
 * según X y hacia +X con el sismo según Y.
 */
import { municipioFueraDelAnejo, sismoEfectivo } from "./emplazamiento.ts";
import {
  C_MESETA_LARGA,
  COEFICIENTE_RIESGO,
  COEFICIENTE_TERRENO,
  coeficienteModal,
  coeficienteTerrenoPonderado,
  emplazamiento,
  EXCENTRICIDAD_ACCIDENTAL,
  factorAmortiguamiento,
  FRACCION_MASA_NIEVE,
  FRACCION_MASA_PERMANENTE,
  FRACCION_MASA_USO,
  SISTEMAS_ESTRUCTURALES,
  USOS_FUERA_DE_LA_NORMA,
  type Emplazamiento,
  type Importancia,
  type SistemaEstructural,
} from "../normas/ncse02.ts";
import { esNombreDe, MENSAJE_NO_ENCONTRADO, municipioPorIne, textoProcedencia } from "../normas/peligrosidad.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import { casosModales, respuestaEspectral, TOL_TORSOR, type CasoEspectral, type CasoLogico, type RespuestaEspectral } from "../motor/espectral.ts";
import { GRAVEDAD, type CasoCarga, type ResultadoCaso, type ResultadoModal } from "../motor/modelo.ts";
import type { AccionCaso, CasoFisico, ModeloFisico, SismoEdificio } from "./fisico.ts";

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

/** El municipio del que salen ab y K (VS4): su fila de la tabla del Anejo 1 (`src/normas/peligrosidad.ts`). */
export interface MunicipioSismo {
  ine: string;
  nombre: string;
  provincia: string;
  /** Los de la tabla, se usen o no (un `ab` o un `K` escritos mandan). */
  ab: number;
  K: number;
  /** De dónde salen en la tabla, en una frase (`textoProcedencia`). */
  procedencia: string;
}

/** El espectro del sismo (VS3): el emplazamiento y los coeficientes de la respuesta, de `acciones.sismo`. */
export interface EspectroSismo {
  /** Cap. 2: ab, K, ρ, C, S, ac (en g), TA y TB. */
  emplazamiento: Emplazamiento;
  /** VS4: el municipio (`ine`), si se dio. */
  municipio?: MunicipioSismo;
  /** VS4, con municipio: de dónde sale cada uno, escrito en el sismo o de la tabla. Sin municipio, los dos son los escritos. */
  origen?: { ab: "escrita" | "municipio"; K: "escrita" | "municipio" };
  importancia: Importancia;
  /** Cómo se dio el terreno, para la hipótesis. */
  terreno: string;
  /** Amortiguamiento Ω (%) y ν = (5/Ω)^0,4. */
  omega: number;
  nu: number;
  /** μ y β = ν/μ, según X y según Y. */
  mu: [number, number];
  beta: [number, number];
  regla: "srss" | "cqc";
  /** Excentricidad accidental, fracción de la dimensión de la planta perpendicular al sismo. */
  excentricidad: number;
  sistema?: SistemaEstructural;
}

export interface CalculoSismo {
  masas: MasasSismo | null;
  /** VS3: null sin `ab` (sólo masas y modos) o con errores. */
  espectro: EspectroSismo | null;
  errores: ProblemaSismo[];
  avisos: ProblemaSismo[];
}

/** Los cuatro casos del sismo del programa, en su orden: según X y según Y, con +e y −e. */
export const CASOS_SISMO: readonly { id: string; eje: 0 | 1; exc: 1 | -1 }[] = (["X", "Y"] as const).flatMap((d, eje) => ([1, -1] as const).map((exc) => ({ id: `E${d}${exc > 0 ? "+e" : "-e"}`, eje: eje as 0 | 1, exc })));

const accionSismo = (eje: 0 | 1): AccionCaso => ({ tipo: "E", direccion: eje === 0 ? "X" : "Y", familia: eje === 0 ? "EX" : "EY" });

/** Los casos del sismo del programa como casos del modelo físico (sin cargas: son casos lógicos). */
export function casosSismo(): CasoFisico[] {
  return CASOS_SISMO.map((c) => ({ id: c.id, nombre: `Sismo según ${c.eje === 0 ? "X" : "Y"}, excentricidad ${c.exc > 0 ? "+" : "−"}`, accion: accionSismo(c.eje) }));
}

/** ¿Lleva ya el modelo, al final de sus casos, los cuatro del sismo del programa (los añadió `Consultas`)? */
function conCasosDelPrograma(m: ModeloFisico): boolean {
  const n = m.casos.length - CASOS_SISMO.length;
  if (n < 0) return false;
  return CASOS_SISMO.every((c, i) => {
    const x = m.casos[n + i]!;
    const a = x.accion;
    return x.id === c.id && !x.pesoPropio && a?.tipo === "E" && a.direccion === (c.eje === 0 ? "X" : "Y") && a.familia === (c.eje === 0 ? "EX" : "EY");
  });
}

const esNumero = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * ¿Lleva el sismo de `m` lo que da un espectro: la aceleración básica `ab` escrita o el municipio
 * (`ine`), del que sale? Sin ninguno de los dos, sólo hay masas y modos.
 */
export function tieneEspectro(m: ModeloFisico | null | undefined): boolean {
  const s: unknown = sismoEfectivo(m);
  if (typeof s !== "object" || s === null) return false;
  return (s as SismoEdificio).ab !== undefined || (s as SismoEdificio).ine !== undefined;
}

/**
 * El sismo de `m` (con los casos del viento del programa ya resueltos: cuentan 0 como masa): las
 * fracciones de masa de sus casos y, con `ab`, el espectro; o por qué no se pueden saber. Sin
 * `acciones.sismo`, null.
 */
export function calcularSismo(m: ModeloFisico): CalculoSismo | null {
  if (typeof m !== "object" || m === null || !Array.isArray(m.casos)) return null;
  const s: SismoEdificio | undefined = sismoEfectivo(m);
  if (s === undefined) return null;
  const errores: ProblemaSismo[] = [];
  const avisos: ProblemaSismo[] = [];
  const err = (codigo: string, mensaje: string, ids?: string[]) => errores.push({ codigo, mensaje, ...(ids ? { ids } : {}) });
  if (typeof s !== "object" || s === null || Array.isArray(s)) {
    err("sismo/no-valido", "El sismo de las acciones tiene que ser un objeto (vacío, para las masas y los modos con las fracciones de la norma).");
    return { masas: null, espectro: null, errores, avisos };
  }
  if (s.nievePermanente !== undefined && typeof s.nievePermanente !== "boolean") err("sismo/no-valido", "«nievePermanente» del sismo tiene que ser true o false.");
  // Los casos del sismo del programa, si ya están (los pone `Consultas` al final), no son del usuario
  const resuelto = tieneEspectro(m) && conCasosDelPrograma(m);
  const casosM: readonly CasoFisico[] = resuelto ? m.casos.slice(0, m.casos.length - CASOS_SISMO.length) : m.casos;
  const escritas = new Map<string, number>();
  if (s.masas !== undefined) {
    if (!Array.isArray(s.masas) || !s.masas.every((x) => typeof x === "object" && x !== null && typeof x.caso === "string")) {
      err("sismo/no-valido", "Las masas del sismo tienen que ser una lista de { caso, fraccion }.");
      return { masas: null, espectro: null, errores, avisos };
    }
    const ids = new Set(casosM.map((c) => c.id));
    for (const x of s.masas as readonly { caso: string; fraccion: number }[]) {
      if (!ids.has(x.caso)) err("sismo/caso-no-existe", `Las masas del sismo nombran el caso ${x.caso}, que no existe.`, [x.caso]);
      else if (escritas.has(x.caso)) err("sismo/no-valido", `Las masas del sismo nombran dos veces el caso ${x.caso}.`, [x.caso]);
      else if (!(typeof x.fraccion === "number" && x.fraccion >= 0 && x.fraccion <= 1)) err("sismo/no-valido", `La fracción de masa del caso ${x.caso} tiene que estar entre 0 y 1.`, [x.caso]);
      escritas.set(x.caso, x.fraccion);
    }
  }
  let nievePorDefecto = false;
  const casos: MasaCaso[] = [];
  for (const c of casosM) {
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
  const espectro = espectroDe(s, casosM, m, err, avisos);
  const fuera = municipioFueraDelAnejo(m);
  if (fuera !== undefined && !espectro)
    avisos.push({
      codigo: "sismo/municipio-fuera-del-anejo",
      mensaje: `El municipio del emplazamiento, «${fuera}», no figura en el Anejo 1 de la NCSE-02, así que sin «ab» escrita no hay espectro ni casos del sismo: sólo las masas y los modos. ${MENSAJE_NO_ENCONTRADO}`,
    });
  return errores.length ? { masas: null, espectro: null, errores, avisos } : { masas: { casos, nievePorDefecto }, espectro, errores, avisos };
}

/** El espectro de `acciones.sismo` (VS3), o null sin `ab`; sus errores, con `err`. */
function espectroDe(s: SismoEdificio, casos: readonly CasoFisico[], m: ModeloFisico, err: (codigo: string, mensaje: string, ids?: string[]) => void, avisos: ProblemaSismo[]): EspectroSismo | null {
  const delEspectro = (["municipio", "K", "importancia", "terreno", "mu", "omega", "regla", "excentricidad", "sistema"] as const).filter((c) => s[c] !== undefined);
  if (s.ab === undefined && s.ine === undefined) {
    if (delEspectro.length)
      err(
        "sismo/sin-ab",
        `El sismo lleva ${delEspectro.join(", ")} y no la aceleración sísmica básica «ab» del emplazamiento (en g) ni el código INE de su municipio («ine», del que sale): sin ella no hay espectro ni casos del sismo, sólo las masas y los modos.` +
          (s.municipio !== undefined ? " El nombre del municipio no basta (hay municipios con el mismo nombre y distinta aceleración): su código se busca por su nombre, con «fem emplazamiento»." : ""),
      );
    return null;
  }
  let bien = true;
  const mal = (mensaje: string) => {
    err("sismo/dato-no-valido", mensaje);
    bien = false;
  };
  // VS4: el municipio, por su código INE; ab y K escritos mandan, cada uno por su lado
  let municipio: MunicipioSismo | undefined;
  const conNombre = typeof s.municipio === "string" && s.municipio.trim() !== "";
  if (s.municipio !== undefined && !conNombre) mal(`El «municipio» del sismo es su nombre, un texto (es ${JSON.stringify(s.municipio)}): no decide nada; el que cuenta es su código, «ine».`);
  if (s.ine !== undefined) {
    if (!(typeof s.ine === "string" && /^\d{5}$/.test(s.ine))) mal(`El «ine» del sismo es el código INE del municipio, un texto de 5 cifras ("29008"; es ${JSON.stringify(s.ine)}): se busca por el nombre del municipio, con «fem emplazamiento».`);
    else {
      const f = municipioPorIne(s.ine);
      if (!f) {
        err(
          "sismo/municipio-desconocido",
          `El municipio de código INE ${s.ine} no está en la tabla de peligrosidad sísmica. ${MENSAJE_NO_ENCONTRADO} No se da por exento en silencio: o se corrige el código (se busca por el nombre del municipio, con «fem emplazamiento»), o se quita «ine» y se escriben «ab» y «K», o se quitan «ab» e «ine» del sismo si de verdad no hay que calcularlo.`,
        );
        bien = false;
      } else if (conNombre && !esNombreDe(f.ine, s.municipio!)) {
        err("sismo/municipio-no-casa", `El sismo dice que el municipio es «${s.municipio}» y su código INE, ${s.ine}, es el de ${f.nombre} (${f.provincia}): uno de los dos está mal. El código de cada municipio se busca por su nombre, con «fem emplazamiento».`);
        bien = false;
      } else municipio = { ine: f.ine, nombre: f.nombre, provincia: f.provincia, ab: f.ab, K: f.K, procedencia: textoProcedencia(f.procedencia) };
    }
  }
  const ab = s.ab !== undefined ? s.ab : municipio?.ab;
  const K = s.K !== undefined ? s.K : municipio?.K;
  if (s.ab !== undefined && !(esNumero(s.ab) && s.ab > 0 && s.ab <= 0.5)) mal(`La aceleración sísmica básica «ab» va en g (0,11 es 0,11 g): tiene que estar entre 0 y 0,5 (es ${String(s.ab)}).`);
  if (s.K !== undefined) {
    if (!(esNumero(s.K) && s.K >= 1 && s.K <= 1.3)) mal(`El coeficiente de contribución «K» va de 1,0 a 1,3 (es ${String(s.K)}).`);
  } else if (s.ine === undefined) mal("Con «ab», el sismo necesita el coeficiente de contribución «K» del emplazamiento (anejo 1 de la NCSE-02: de 1,0 a 1,3), o el código INE del municipio («ine»), del que salen los dos.");
  if (s.importancia !== undefined && !(s.importancia in COEFICIENTE_RIESGO)) mal(`La importancia de la construcción es "normal" o "especial" (es ${JSON.stringify(s.importancia)}).`);
  const importancia: Importancia = s.importancia ?? "normal";
  // Terreno: su tipo, su C o los estratos
  let C = Number.NaN;
  let terreno = "";
  const cDe = (x: unknown): number => (typeof x === "string" && x in COEFICIENTE_TERRENO ? COEFICIENTE_TERRENO[x as keyof typeof COEFICIENTE_TERRENO] : Number.NaN);
  const cValido = (x: unknown): x is number => esNumero(x) && x >= 1 && x <= 2;
  if (s.terreno === undefined) mal('Con «ab», el sismo necesita el «terreno» de cimentación (art. 2.4): su tipo ("I", "II", "III" o "IV"), su coeficiente C o sus estratos.');
  else if (typeof s.terreno === "string") {
    C = cDe(s.terreno);
    terreno = `tipo ${s.terreno}`;
    if (Number.isNaN(C)) mal(`El tipo de terreno es "I", "II", "III" o "IV" (es ${JSON.stringify(s.terreno)}).`);
  } else if (typeof s.terreno === "number") {
    C = s.terreno;
    terreno = "C dado";
    if (!cValido(C)) mal(`El coeficiente del terreno C va de 1,0 (tipo I) a 2,0 (tipo IV) (es ${String(s.terreno)}).`);
  } else if (Array.isArray(s.terreno) && s.terreno.length) {
    const estratos: { C: number; espesor: number }[] = [];
    for (const e of s.terreno as readonly { tipo?: string; C?: number; espesor: number }[]) {
      const c = typeof e === "object" && e !== null ? (e.C !== undefined ? e.C : cDe(e.tipo)) : Number.NaN;
      if (typeof e !== "object" || e === null || (e.C !== undefined && e.tipo !== undefined) || !cValido(c) || !(esNumero(e.espesor) && e.espesor > 0)) {
        mal("Cada estrato del terreno lleva su tipo (\"I\" a \"IV\") o su C (de 1,0 a 2,0), uno de los dos, y su espesor en metros (> 0).");
        break;
      }
      estratos.push({ C: c, espesor: e.espesor });
    }
    if (estratos.length === s.terreno.length) {
      C = coeficienteTerrenoPonderado(estratos);
      const total = estratos.reduce((t, e) => t + e.espesor, 0);
      terreno = `${estratos.length} ${estratos.length === 1 ? "estrato" : "estratos"} (${coma(total)} m${total < 30 ? ", el último prolongado hasta los 30 m" : ""})`;
    }
  } else mal("El terreno del sismo es su tipo, su coeficiente C o una lista de estratos (no vacía).");
  // Ductilidad, por dirección
  let mu: [number, number] = [Number.NaN, Number.NaN];
  const muValida = (x: unknown): x is number => esNumero(x) && x >= 1 && x <= 4;
  if (s.mu === undefined) mal("Con «ab», el sismo necesita el coeficiente de comportamiento por ductilidad «mu» (art. 3.7.3.1: 1, sin ductilidad; 2, baja; 3, alta; 4, muy alta): no se toma uno por defecto.");
  else if (typeof s.mu === "number") mu = [s.mu, s.mu];
  else if (typeof s.mu === "object" && s.mu !== null) mu = [(s.mu as { x: number }).x, (s.mu as { y: number }).y];
  if (s.mu !== undefined && !(muValida(mu[0]) && muValida(mu[1]))) mal(`El coeficiente de ductilidad «mu» va de 1 a 4, uno para las dos direcciones o { "x": …, "y": … } (es ${JSON.stringify(s.mu)}).`);
  const omega = s.omega ?? 5;
  if (!(esNumero(omega) && omega > 0 && omega <= 20)) mal(`El amortiguamiento «omega» va en % del crítico, entre 0 y 20 (es ${String(s.omega)}).`);
  if (s.regla !== undefined && s.regla !== "srss" && s.regla !== "cqc") mal(`La regla de combinación de los modos es "srss" o "cqc" (es ${JSON.stringify(s.regla)}).`);
  const excentricidad = s.excentricidad ?? EXCENTRICIDAD_ACCIDENTAL;
  if (!(esNumero(excentricidad) && excentricidad >= 0 && excentricidad <= 0.5)) mal(`La excentricidad accidental es una fracción de la dimensión de la planta, entre 0 y 0,5 (es ${String(s.excentricidad)}).`);
  if (s.sistema !== undefined && !SISTEMAS_ESTRUCTURALES.includes(s.sistema)) mal(`El sistema estructural es uno de ${SISTEMAS_ESTRUCTURALES.map((x) => `"${x}"`).join(", ")} (es ${JSON.stringify(s.sistema)}).`);
  // Los casos del programa no se escriben
  const reservados = new Set(CASOS_SISMO.map((c) => c.id));
  const repetidos = casos.filter((c) => reservados.has(c.id)).map((c) => c.id);
  if (repetidos.length) {
    err("sismo/caso-existente", `Los casos ${repetidos.join(", ")} son los del sismo del programa: hay que renombrarlos o quitar «ab» (y «ine») del sismo de las acciones.`, repetidos);
    bien = false;
  }
  const enReservados = (m.cargas ?? []).filter((c) => reservados.has(c.caso)).map((c) => c.id);
  if (enReservados.length) {
    err("sismo/carga-en-caso-del-programa", `Las cargas ${enReservados.join(", ")} van en un caso del sismo del programa, que no se escribe: no lleva cargas.`, enReservados);
    bien = false;
  }
  if (!bien) return null;
  const aMano = casos.filter((c) => c.accion?.tipo === "E").map((c) => c.id);
  if (aMano.length) avisos.push({ codigo: "sismo/casos-a-mano", mensaje: `Además del sismo del programa hay casos de sismo escritos (${aMano.join(", ")}): los dos van en las combinaciones.`, ids: aMano });
  if (excentricidad < EXCENTRICIDAD_ACCIDENTAL) avisos.push({ codigo: "sismo/excentricidad-menor", mensaje: `La excentricidad accidental del sismo (${coma(excentricidad)}) es menor que el 1/20 que pide el art. 3.2 de la NCSE-02.` });
  const nu = factorAmortiguamiento(omega);
  return {
    emplazamiento: emplazamiento(ab!, K!, COEFICIENTE_RIESGO[importancia], C),
    ...(municipio ? { municipio, origen: { ab: s.ab !== undefined ? ("escrita" as const) : ("municipio" as const), K: s.K !== undefined ? ("escrita" as const) : ("municipio" as const) } } : {}),
    importancia,
    terreno,
    omega,
    nu,
    mu,
    beta: [nu / mu[0], nu / mu[1]],
    regla: s.regla ?? "srss",
    excentricidad,
    ...(s.sistema ? { sistema: s.sistema } : {}),
  };
}

const coma = (x: number, d = 4): string => String(Number(x.toFixed(d))).replace(".", ",");

/** La hipótesis del cálculo con las masas del sismo. */
export function hipotesisSismo(s: MasasSismo): string {
  const cuentan = s.casos.filter((c) => c.fraccion > 0);
  const no = s.casos.filter((c) => c.fraccion === 0).map((c) => c.caso);
  const fuera = cuentan.filter((c) => c.origen === "uso" && (USOS_FUERA_DE_LA_NORMA as readonly string[]).includes(c.motivo));
  return (
    `Masas y modos de vibración para el sismo (VS2; NCSE-02, art. 3.2). La masa sale de las cargas: de cada caso, la fracción que le toca de la componente vertical de sus cargas, entre g = ${coma(GRAVEDAD, 5)} m/s². ` +
    `Cuentan: ${cuentan.length ? cuentan.map((c) => `${c.caso} ×${coma(c.fraccion)} (${c.motivo})`).join("; ") : "ningún caso"}${no.length ? `. No cuentan: ${no.join(", ")}` : ""}. ` +
    (s.nievePorDefecto ? "La permanencia de la nieve se toma de su ψ (por encima de 1 000 m, más de 30 días al año); se cambia con «nievePermanente». " : "") +
    (fuera.length ? `La fracción de ${fuera.map((c) => `${c.caso} (${c.motivo})`).join(" y ")} no está en la norma: se toma 0,6 en la categoría E y 0 en la G. ` : "") +
    `La masa de cada nudo va al diafragma rígido de su planta, con su centro de masas y su inercia de giro; la de los nudos que no son de ningún diafragma (las filas intermedias de los muros, la planta más baja) se reparte por su cota entre el nivel de arriba y el de abajo, y la que les toca a los apoyos va al terreno. ` +
    `Sólo tiene inercia horizontal (tres grados de libertad por planta, art. 3.6.2.1), y los modos salen de la rigidez condensada a esos grados de libertad, que con toda la masa en ellos es exacta: todos los modos, con el 100 % de la masa.`
  );
}

/** La hipótesis del cálculo con el espectro y los casos del sismo (VS3). */
export function hipotesisEspectro(e: EspectroSismo): string {
  const em = e.emplazamiento;
  const una = e.mu[0] === e.mu[1];
  return (
    `Sismo de la NCSE-02 por espectros de respuesta (VS3; art. 3.6.2, el método de referencia): casos del programa ${CASOS_SISMO.map((c) => c.id).join(", ")} (familias EX y EY), que no llevan cargas. ` +
    `Emplazamiento: ab = ${coma(em.ab)} g, K = ${coma(em.K)}${deDonde(e)}, importancia ${e.importancia} (ρ = ${coma(em.rho)}), terreno ${e.terreno} con C = ${coma(em.C)}; S = ${coma(em.S)}, ac = S·ρ·ab = ${coma(em.ac)} g, TA = ${coma(em.TA)} s y TB = ${coma(em.TB)} s. ` +
    `Amortiguamiento Ω = ${coma(e.omega)} % (ν = ${coma(e.nu)})${s5(e)}; ductilidad μ = ${una ? coma(e.mu[0]) : `${coma(e.mu[0])} según X y ${coma(e.mu[1])} según Y`} (β = ν/μ = ${una ? coma(e.beta[0]) : `${coma(e.beta[0])} y ${coma(e.beta[1])}`}). ` +
    `Cada modo responde con la aceleración αᵢ·ac del art. 3.6.2.2 (αᵢ = α(Tᵢ)·β con Tᵢ ≥ TA, y 1 + (2,5·β − 1)·Tᵢ/TA por debajo), y los valores de todos los modos se combinan en cada resultado (esfuerzos, reacciones, desplazamientos: art. 3.6.2.4) ` +
    (e.regla === "cqc"
      ? "con la combinación cuadrática completa del comentario C.3.6.2.4 y ese amortiguamiento. "
      : "con la raíz de la suma de los cuadrados, sumando antes en valor absoluto los de cada par de modos con periodos a menos del 10 %. ") +
    `El signo de cada resultado es el del modo de más masa en esa dirección, el mismo para todos, y el ± lo ponen las combinaciones, con el 30 % de la otra dirección (art. 3.4). Los desplazamientos del sismo van multiplicados por μ. ` +
    (e.excentricidad > 0
      ? `Excentricidad accidental (art. 3.2): un par en cada planta, el de su fuerza equivalente (la diferencia de los cortantes combinados) por el ${coma(100 * e.excentricidad, 2)} % de la dimensión de la planta perpendicular al sismo, a un lado (+e) y al otro (−e); es un caso estático, sumado al de los modos.`
      : "Sin excentricidad accidental (escrita 0).")
  );
}

const s5 = (e: EspectroSismo): string => (e.omega === 5 ? ", el de referencia del espectro" : "");

/** De dónde salen ab y K, para la hipótesis: nada sin municipio (los dos, escritos), como antes de VS4. */
function deDonde(e: EspectroSismo): string {
  const m = e.municipio;
  if (!m) return "";
  const lugar = `${m.nombre} (${m.provincia})`;
  const escritos = (["ab", "K"] as const).filter((c) => e.origen?.[c] === "escrita");
  if (!escritos.length) return ` (de ${lugar}, código INE ${m.ine}: ${m.procedencia})`;
  const tabla = `ab = ${coma(m.ab)} g y K = ${coma(m.K)}`;
  if (escritos.length === 2) return ` (los dos, escritos en el sismo: mandan sobre los de ${lugar}, código INE ${m.ine}, que en la tabla tiene ${tabla}; ${m.procedencia})`;
  const escrito = escritos[0]!;
  const otro = escrito === "ab" ? "K" : "ab";
  return ` (${escrito}, escrit${escrito === "ab" ? "a" : "o"} en el sismo: manda sobre ${escrito === "ab" ? "la" : "el"} de la tabla; ${otro}, de ${lugar}, código INE ${m.ine}, que en la tabla tiene ${tabla}; ${m.procedencia})`;
}

// ─── Con los modos calculados: la respuesta y los casos lógicos ─────────────────────────────────

/** Lo que una planta mide en X y en Y, m (la caja de sus losas y paños): la dimensión de la excentricidad. */
export type DimensionesPlanta = (planta: string) => readonly [number, number] | null;

export interface SismoCalculado {
  espectro: EspectroSismo;
  /** La respuesta según X y según Y (`src/motor/espectral.ts`). */
  respuestas: [RespuestaEspectral, RespuestaEspectral];
  /** ¿Se ha tomado α = 2,5 por encima de TB (C > 1,8 con el periodo fundamental mayor que TB, art. 2.4)? Por dirección. */
  mesetaLarga: [boolean, boolean];
  /** Excentricidad de cada diafragma (en el orden del modal), m, según X y según Y. */
  excentricidades: [Float64Array, Float64Array];
  /** Los modos como casos base: sus cargas y sus resultados (van detrás de los casos del modelo). */
  casosBase: CasoCarga[];
  resultadosBase: ResultadoCaso[];
  /** Los cuatro casos del sismo: en el modelo físico (con su acción) y como casos lógicos sobre los modos. */
  casos: CasoFisico[];
  logicos: CasoLogico[];
  diagnosticos: Diagnostico[];
}

/**
 * El sismo de un cálculo: con el espectro de `acciones.sismo` y los modos, la respuesta en cada
 * dirección y los casos del programa. `nEstaticos`: los casos del modelo analítico (los casos base de
 * los modos van detrás). `plantaDe`: la planta de cada diafragma del modal. null sin espectro.
 */
export function sismoDelCalculo(espectro: EspectroSismo | null, modal: ResultadoModal | null | undefined, nEstaticos: number, plantaDe: (diafragma: number) => string, dimensiones: DimensionesPlanta): SismoCalculado | null {
  if (!espectro || !modal) return null;
  const em = espectro.emplazamiento;
  const diagnosticos: Diagnostico[] = [];
  const { casos: casosBase, resultados: resultadosBase } = casosModales(modal);
  const nm = modal.modos.length;
  const modos = Int32Array.from({ length: nm }, (_, i) => nEstaticos + i);
  const excentricidades: [Float64Array, Float64Array] = [new Float64Array(modal.diafragmas.length), new Float64Array(modal.diafragmas.length)];
  const sinDimension: string[] = [];
  modal.diafragmas.forEach((_, k) => {
    const planta = plantaDe(k);
    const dim = dimensiones(planta);
    if (!dim) {
      if (espectro.excentricidad > 0 && modal.diafragmas[k]!.masa > 0) sinDimension.push(planta);
      return;
    }
    // Sismo según X: la dimensión perpendicular es la de Y, y al revés
    excentricidades[0][k] = espectro.excentricidad * dim[1];
    excentricidades[1][k] = espectro.excentricidad * dim[0];
  });
  if (sinDimension.length) diagnosticos.push({ codigo: "sismo/planta-sin-dimension", severidad: "aviso", mensaje: `Las plantas ${sinDimension.join(", ")} tienen masa y no tienen losas ni paños de los que sacar su dimensión: van sin excentricidad accidental.`, ids: sinDimension });
  const mesetaLarga: [boolean, boolean] = [false, false];
  const respuestas = ([0, 1] as const).map((eje) => {
    const direccion: [number, number] = eje === 0 ? [1, 0] : [0, 1];
    const beta = espectro.beta[eje];
    // El periodo fundamental de la dirección: el del modo de más masa efectiva en ella
    let fundamental = 0;
    let mejor = -1;
    for (const m of modal.modos) {
      const g2 = m.participacion[eje] ** 2;
      if (g2 > mejor) [mejor, fundamental] = [g2, m.periodo];
    }
    const meseta = em.C > C_MESETA_LARGA && fundamental > em.TB;
    mesetaLarga[eje] = meseta;
    const aceleracion = (T: number) => coeficienteModal(T, em.TA, em.TB, beta, meseta) * em.ac * modal.g;
    return respuestaEspectral(modal, {
      direccion,
      aceleracion,
      ductilidad: espectro.mu[eje],
      regla: { tipo: espectro.regla, zeta: espectro.omega / 100 },
      ...(espectro.excentricidad > 0 ? { excentricidades: excentricidades[eje] } : {}),
    });
  }) as [RespuestaEspectral, RespuestaEspectral];
  if (mesetaLarga[0] || mesetaLarga[1])
    diagnosticos.push({
      codigo: "sismo/meseta-larga",
      severidad: "aviso",
      mensaje: `El coeficiente del terreno es C = ${coma(em.C)} > 1,8 y el periodo fundamental ${mesetaLarga[0] && mesetaLarga[1] ? "de las dos direcciones" : mesetaLarga[0] ? "según X" : "según Y"} es mayor que TB = ${coma(em.TB)} s: como dice el art. 2.4, se toma α(T) = 2,5 también por encima de TB, a falta de un espectro específico del emplazamiento.`,
    });
  const sinTorsor = respuestas.map((r, eje) => (espectro.excentricidad > 0 && r.pares?.some((p) => p !== 0) && !r.torsor ? (eje === 0 ? "X" : "Y") : null)).filter((x): x is "X" | "Y" => x !== null);
  if (sinTorsor.length) {
    const peor = Math.max(...respuestas.map((r) => r.residuoTorsor));
    diagnosticos.push({
      codigo: "sismo/torsor-no-representable",
      severidad: "error",
      mensaje: `El par de la excentricidad accidental del sismo según ${sinTorsor.join(" y ")} no se puede escribir con los modos de vibración (le falta un ${(100 * peor).toPrecision(2)} %; tolerancia ${TOL_TORSOR}): algún diafragma con masa no tiene inercia de giro (toda su masa en un punto) o tiene un grado de libertad coartado. Sin eso, o con "excentricidad": 0 en el sismo, se puede calcular.`,
    });
    return { espectro, respuestas, mesetaLarga, excentricidades, casosBase, resultadosBase, casos: [], logicos: [], diagnosticos };
  }
  const casos = casosSismo();
  const logicos: CasoLogico[] = CASOS_SISMO.map((c): CasoLogico => {
    const r = respuestas[c.eje];
    // +e: la recta de acción, hacia +Y con el sismo según X (par −F·e) y hacia +X según Y (par +F·e)
    const signo = (c.eje === 0 ? -1 : 1) * c.exc;
    const espectral: CasoEspectral = {
      modos,
      coeficientes: r.coeficientes,
      regla: r.regla,
      dominante: r.dominante,
      lineal: r.torsor ? r.torsor.map((t) => signo * t) : null,
      ductilidad: r.ductilidad,
    };
    return { id: c.id, espectral };
  });
  return { espectro, respuestas, mesetaLarga, excentricidades, casosBase, resultadosBase, casos, logicos, diagnosticos };
}
