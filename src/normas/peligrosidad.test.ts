/**
 * La tabla de peligrosidad sísmica (VS4, decisión VS-l de `docs/fem3d/viento-sismo.md`): los datos
 * copiados de Concreta (la capa del IGN con su suplemento) frente a su oráculo, el Anejo 1 de la
 * NCSE-02 leído del texto de la norma (`validacion/vs4/anejo1.py` → `__fixtures__/ncse02-anejo1.json`,
 * 2 615 entradas en el orden del texto).
 *
 * - (a) el JSON es el del manifiesto (sha256), y sus recuentos son los que dice;
 * - (b) cada municipio del Anejo 1 está en la tabla con su mismo ab y su mismo K;
 * - (c) al revés: cada fila de la tabla que no es de un municipio creado después de 2002 está en el
 *   Anejo 1;
 * - (d) el buscador y la consulta por código.
 *
 * Lo que no casa no se calla: son las listas `NOMBRES_DEL_ANEJO` (el mismo municipio con otro nombre),
 * `SOLO_EN_EL_ANEJO` y `SOLO_EN_LA_TABLA`, cada una con su motivo. Si una deja de hacer falta, la
 * prueba falla también.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buscarMunicipios, esNombreDe, MENSAJE_NO_ENCONTRADO, municipioPorIne, NUMERO_DE_MUNICIPIOS, plegarConsulta, textoProcedencia, type Procedencia } from "./peligrosidad.ts";
import { PROVINCIAS, provinciaDe, provinciaPorIne } from "./provincias.ts";

const DATOS = join(import.meta.dirname, "datos");
const bytes = readFileSync(join(DATOS, "ncse02.hazard.json"));
const tabla = JSON.parse(bytes.toString("utf8")) as { ine: string[]; nombre: string[]; clave: string[]; ab: number[]; k: number[]; abValores: number[]; kValores: number[]; procedencia: Record<string, Procedencia> };
const manifiesto = JSON.parse(readFileSync(join(DATOS, "ncse02.hazard.manifest.json"), "utf8")) as Record<string, unknown>;
const anejo = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "ncse02-anejo1.json"), "utf8")) as { comunidad: string; provincia: string; municipio: string; ab: number; K: number }[];

/** Las provincias, como las nombra el Anejo 1, con su código INE. */
const PROVINCIA_DEL_ANEJO: Record<string, string> = {
  Almería: "04",
  Cádiz: "11",
  Córdoba: "14",
  Granada: "18",
  Huelva: "21",
  Jaén: "23",
  Málaga: "29",
  Sevilla: "41",
  Huesca: "22",
  Zaragoza: "50",
  "Las Palmas": "35",
  "Santa Cruz de Tenerife": "38",
  Albacete: "02",
  Barcelona: "08",
  Girona: "17",
  Lleida: "25",
  Tarragona: "43",
  "Alicante/Alacant": "03",
  "Valencia/València": "46",
  Badajoz: "06",
  Cáceres: "10",
  "A Coruña": "15",
  Lugo: "27",
  Ourense: "32",
  Pontevedra: "36",
  "Illes Balears": "07",
  Murcia: "30",
  Navarra: "31",
  Álava: "01",
  Guipúzcoa: "20",
  "Ciudad de Ceuta": "51",
  "Ciudad de Melilla": "52",
};

/**
 * El mismo municipio, con otro nombre en el Anejo 1 que en la tabla (la del IGN lleva el nombre
 * oficial de hoy): [provincia, nombre en el anejo, código INE, motivo]. Ninguna cambia un valor: la
 * prueba compara el ab y el K de cada una como los de las demás.
 */
const NOMBRES_DEL_ANEJO: readonly [string, string, string, string][] = [
  ["23", "Torreperojil", "23088", "grafía del anejo; es Torreperogil"],
  ["41", "Huévar de Aljarafe", "41051", "hoy, Huévar del Aljarafe"],
  ["22", "Llert", "22243", "el anejo nombra por su capital el municipio de Valle de Bardají (el único de Huesca que queda, y en su sitio alfabético)"],
  ["22", "Santa Cilia de Jaca", "22208", "hoy, Santa Cilia"],
  ["35", "San Nicolás de Tolentino", "35020", "hoy, La Aldea de San Nicolás"],
  ["17", "Boadella d’Empordà", "17029", "hoy, Boadella i les Escaules"],
  ["17", "Montagut", "17109", "hoy, Montagut i Oix"],
  ["17", "Santa Llogaia a’Àlguema", "17182", "errata de la edición; es Santa Llogaia d'Àlguema"],
  ["03", "Guadalest", "03075", "hoy, el Castell de Guadalest"],
  ["03", "Hondón de las Nieves", "03077", "hoy, el Fondó de les Neus/Hondón de las Nieves"],
  ["46", "Benisoda", "46068", "hoy, Benissoda"],
  ["46", "Guardamar", "46140", "hoy, Guardamar de la Safor"],
  ["46", "Lugar Nuevo de la Corona", "46152", "hoy, Llocnou de la Corona"],
  ["46", "Monserrat", "46172", "hoy, Montserrat"],
  ["46", "Rotglá y Corberá", "46217", "hoy, Rotglà i Corberà"],
  ["46", "Villanueva de Castellón", "46257", "hoy, Castelló (en la tabla, Castelló de la Ribera)"],
  ["36", "Igrexa, A", "36019", "el anejo nombra por su capital el municipio de Fornelos de Montes (en su sitio alfabético)"],
  ["36", "Mondariz Balneario o Troncoso", "36031", "hoy, Mondariz-Balneario"],
  ["36", "Pedreira, A", "36025", "por eliminación: el único municipio de Pontevedra que queda es A Lama, nombrado por su capital"],
  ["07", "Lloret de Vistaalegre", "07028", "hoy, Lloret de Vistalegre"],
  ["07", "San José", "07048", "hoy, Sant Josep de sa Talaia"],
  ["07", "Valldemosa", "07063", "hoy, Valldemossa"],
  ["31", "Berrrioplano", "31902", "errata de la edición; es Berrioplano"],
  ["31", "Orcoyen", "31906", "hoy, Orkoien"],
  ["31", "Urroz", "31243", "hoy, Urroz-Villa"],
  ["20", "Bidegoyan", "20024", "hoy, Bidania-Goiatz (en la tabla, Bidegoian)"],
  ["20", "Donosita San Sebastián", "20069", "errata de la edición; es Donostia-San Sebastián"],
];

/**
 * Entradas del Anejo 1 que no son una fila de la tabla: [provincia, nombre, ab, K, motivo].
 *
 * **Sant Joan de Mediona** es la capital del municipio de Mediona (08122), que el anejo nombra también
 * como «Mediona», con 0,04 g. El anejo da, pues, dos valores para un mismo término municipal (0,04 y
 * 0,05 g), y la tabla (la capa del IGN) tiene el menor. Queda para el ingeniero: en Mediona, ab se
 * puede escribir a mano (0,05, del lado de la seguridad).
 */
const SOLO_EN_EL_ANEJO: readonly [string, string, number, number, string][] = [["08", "Sant Joan de Mediona", 0.05, 1.0, "la capital de Mediona (08122), que el anejo nombra otra vez como «Mediona», con 0,04 g: dos valores para un municipio; la tabla tiene 0,04"]];

/**
 * Filas de la tabla, cosecha directa de la capa del IGN, que el texto del Anejo 1 no nombra:
 * [código INE, motivo]. Las dos, municipios segregados antes de 2002 que la capa trae con su
 * polígono y el anejo deja bajo su municipio de origen, con el mismo valor.
 */
const SOLO_EN_LA_TABLA: readonly [string, string][] = [
  ["20906", "Altzaga, segregado de Itsasondo en 1992: el anejo sólo nombra Itsasondo, con los mismos 0,04 g y K = 1,0"],
  ["31908", "Lekunberri, segregado de Larraun en 1995: el anejo sólo nombra Larraun, con los mismos 0,04 g y K = 1,0"],
];

const valores = (i: number) => ({ ab: tabla.abValores[tabla.ab[i]!]!, K: tabla.kValores[tabla.k[i]!]! });

/** Las formas de un nombre del anejo: entero, cada lado de un bilingüe y, con el artículo detrás («Ejido, El»), sin él y con él delante. */
function variantes(nombre: string): Set<string> {
  const out = new Set<string>();
  for (const t of [nombre, ...nombre.split("/")]) {
    out.add(plegarConsulta(t));
    const m = /^(.*?),\s*(.+)$/.exec(t.trim());
    if (m) {
      out.add(plegarConsulta(m[1]!));
      out.add(plegarConsulta(`${m[2]!} ${m[1]!}`));
    }
  }
  out.delete("");
  return out;
}

/** Cada entrada del anejo con la fila de la tabla que le toca (su índice), o -1. */
function casar(): number[] {
  const porProvincia = new Map<string, number[]>();
  tabla.ine.forEach((ine, i) => porProvincia.set(ine.slice(0, 2), [...(porProvincia.get(ine.slice(0, 2)) ?? []), i]));
  const alias = new Map(NOMBRES_DEL_ANEJO.map(([p, n, ine]) => [`${p}|${plegarConsulta(n)}`, ine]));
  return anejo.map((x) => {
    const p = PROVINCIA_DEL_ANEJO[x.provincia];
    if (!p) return -1;
    const filas = porProvincia.get(p) ?? [];
    const entero = plegarConsulta(x.municipio);
    // 1. El nombre oficial completo es el del anejo («Pinar, El» es «Pinar (El)», no «Píñar»)
    const completo = filas.filter((i) => plegarConsulta(tabla.nombre[i]!) === entero);
    if (completo.length === 1) return completo[0]!;
    // 2. Alguna clave de la tabla es una forma del nombre del anejo
    const vs = variantes(x.municipio);
    const porClave = filas.filter((i) => tabla.clave[i]!.split("|").some((c) => vs.has(c)));
    if (porClave.length === 1) return porClave[0]!;
    const oficial = porClave.filter((i) => vs.has(plegarConsulta(tabla.nombre[i]!)));
    if (oficial.length === 1) return oficial[0]!;
    // 3. La lista de nombres que han cambiado
    const ine = alias.get(`${p}|${entero}`);
    return ine === undefined ? -1 : tabla.ine.indexOf(ine);
  });
}

const casadas = casar();

describe("los datos son los de Concreta (VS-l)", () => {
  it("el sha256 del JSON es el de su manifiesto", () => {
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifiesto.sha256);
    expect(manifiesto.license).toBe("CC BY 4.0 ign.es");
    expect(manifiesto.layer).toBe("HazardArea2002.NCSE-02");
  });

  it("los recuentos del manifiesto: 2 635 filas; 6 del texto del BOE, 19 heredadas y 1 corregida", () => {
    expect(tabla.ine.length).toBe(2635);
    expect(NUMERO_DE_MUNICIPIOS).toBe(2635);
    expect(manifiesto.anejo1RecordCount).toBe(2635);
    for (const c of ["nombre", "clave", "ab", "k"] as const) expect(tabla[c].length).toBe(2635);
    const tipos = Object.values(tabla.procedencia).map((p) => p.tipo);
    const cuantos = (t: string) => tipos.filter((x) => x === t).length;
    expect([cuantos("anejo1-texto"), cuantos("segregado"), cuantos("correccion")]).toEqual([manifiesto.fromBoeRecordCount, manifiesto.inheritedRecordCount, manifiesto.correctedRecordCount]);
    expect([cuantos("anejo1-texto"), cuantos("segregado"), cuantos("correccion")]).toEqual([6, 19, 1]);
    expect(manifiesto.syntheticRecordCount).toBe(25);
    expect(manifiesto.harvestedRecordCount).toBe(2610);
    for (const ine of Object.keys(tabla.procedencia)) expect(tabla.ine).toContain(ine);
  });

  it("los códigos son de 5 cifras, van en orden y no se repiten; ab, de 0,04 a 0,25 g y K, de 1,0 a 1,3", () => {
    for (let i = 0; i < tabla.ine.length; i++) {
      expect(tabla.ine[i]).toMatch(/^\d{5}$/);
      if (i) expect(tabla.ine[i - 1]! < tabla.ine[i]!).toBe(true);
      const { ab, K } = valores(i);
      expect(ab).toBeGreaterThanOrEqual(0.04);
      expect(ab).toBeLessThanOrEqual(0.25);
      expect([1, 1.1, 1.2, 1.3]).toContain(K);
      expect(provinciaDe(tabla.ine[i]!)).not.toBe("");
    }
  });

  it("un municipio creado después de 2002 hereda el ab y el K de su municipio de origen", () => {
    for (const [ine, p] of Object.entries(tabla.procedencia)) {
      if (p.tipo !== "segregado") continue;
      expect(p.anio).toBeGreaterThan(2002);
      const hijo = municipioPorIne(ine)!;
      const padre = municipioPorIne(p.padre.ine);
      expect(padre, `${ine}: su municipio de origen, ${p.padre.ine}`).not.toBeNull();
      expect([ine, hijo.ab, hijo.K]).toEqual([ine, padre!.ab, padre!.K]);
    }
  });
});

describe("el Anejo 1 de la NCSE-02 es el oráculo (VS-l)", () => {
  it("el anejo leído: 2 615 entradas de 32 provincias", () => {
    expect(anejo.length).toBe(2615);
    expect(new Set(anejo.map((x) => x.provincia)).size).toBe(32);
    for (const x of anejo) expect(PROVINCIA_DEL_ANEJO[x.provincia], x.provincia).toBeDefined();
    // Los nombres de provincia que coinciden con los de la tabla de provincias, con su código
    for (const [nombre, ine] of Object.entries(PROVINCIA_DEL_ANEJO)) if (PROVINCIAS.some((p) => p.nombre === nombre)) expect(provinciaDe(ine)).toBe(nombre);
  });

  it("(b) cada municipio del anejo está en la tabla con el mismo ab y el mismo K", () => {
    const soloAnejo = new Set(SOLO_EN_EL_ANEJO.map(([p, n]) => `${p}|${n}`));
    const sinCasar: string[] = [];
    const distintos: string[] = [];
    let iguales = 0;
    anejo.forEach((x, k) => {
      const i = casadas[k]!;
      const donde = `${x.municipio} (${x.provincia}) ${x.ab} (${x.K})`;
      if (i < 0) {
        if (!soloAnejo.has(`${PROVINCIA_DEL_ANEJO[x.provincia]}|${x.municipio}`)) sinCasar.push(donde);
        return;
      }
      const m = municipioPorIne(tabla.ine[i]!)!;
      if (m.ab === x.ab && m.K === x.K) iguales++;
      else distintos.push(`${donde} ≠ ${m.ine} ${m.nombre} ${m.ab} (${m.K})`);
    });
    expect(sinCasar).toEqual([]);
    expect(distintos).toEqual([]);
    expect(iguales).toBe(2614);
    // Las que el anejo tiene de más, tal como se listan (con su valor), y ninguna de ellas casada
    expect(anejo.filter((_, k) => casadas[k]! < 0).map((x) => [PROVINCIA_DEL_ANEJO[x.provincia], x.municipio, x.ab, x.K])).toEqual(SOLO_EN_EL_ANEJO.map(([p, n, ab, K]) => [p, n, ab, K]));
    // Mediona, el municipio de esa capital: en el anejo y en la tabla, 0,04 g
    expect(anejo.find((x) => x.municipio === "Mediona")).toMatchObject({ ab: 0.04, K: 1 });
    expect(municipioPorIne("08122")).toMatchObject({ nombre: "Mediona", ab: 0.04, K: 1 });
  });

  it("ninguna fila de la tabla sirve a dos entradas del anejo, y los nombres cambiados hacen falta todos", () => {
    const usadas = casadas.filter((i) => i >= 0);
    expect(new Set(usadas).size).toBe(usadas.length);
    // Sin la lista de nombres cambiados, cada uno de ellos se quedaría sin casar: ninguno sobra
    for (const [p, nombre, ine] of NOMBRES_DEL_ANEJO) {
      const k = anejo.findIndex((x) => PROVINCIA_DEL_ANEJO[x.provincia] === p && x.municipio === nombre);
      expect(k, `${nombre} está en el anejo`).toBeGreaterThanOrEqual(0);
      expect(tabla.ine[casadas[k]!]).toBe(ine);
      expect(ine.slice(0, 2)).toBe(p);
      expect(esNombreDe(ine, nombre), `${nombre} no es ya un nombre de ${ine}`).toBe(false);
    }
  });

  it("(c) cada fila de la tabla que no es de un municipio creado después de 2002 está en el anejo", () => {
    const usadas = new Set(casadas);
    const soloTabla = new Set(SOLO_EN_LA_TABLA.map(([ine]) => ine));
    const faltan: string[] = [];
    const segregadosEnElAnejo: string[] = [];
    tabla.ine.forEach((ine, i) => {
      const tipo = tabla.procedencia[ine]?.tipo;
      if (tipo === "segregado") {
        // No tienen por qué estar; y si alguno casara, sería con otro municipio del mismo nombre
        if (usadas.has(i)) segregadosEnElAnejo.push(`${ine} ${tabla.nombre[i]}`);
      } else if (!usadas.has(i) && !soloTabla.has(ine)) faltan.push(`${ine} ${tabla.nombre[i]} ${valores(i).ab} (${valores(i).K})`);
    });
    expect(faltan).toEqual([]);
    expect(segregadosEnElAnejo).toEqual([]);
    // Las que la tabla tiene de más: están, no casan y valen lo que su municipio de origen
    for (const [ine] of SOLO_EN_LA_TABLA) expect(usadas.has(tabla.ine.indexOf(ine)), ine).toBe(false);
    expect(municipioPorIne("20906")).toMatchObject({ nombre: "Altzaga", ab: 0.04, K: 1, procedencia: null });
    expect(anejo.find((x) => x.municipio === "Itsasondo")).toMatchObject({ ab: 0.04, K: 1 });
    expect(municipioPorIne("31908")).toMatchObject({ nombre: "Lekunberri", ab: 0.04, K: 1, procedencia: null });
    expect(anejo.find((x) => x.municipio === "Larraun")).toMatchObject({ ab: 0.04, K: 1 });
    // Las cuentas: 2 635 filas = 2 614 del anejo + 19 creados después + 2 que el anejo no nombra
    expect(tabla.ine.length).toBe(new Set(casadas.filter((i) => i >= 0)).size + 19 + SOLO_EN_LA_TABLA.length);
    expect(anejo.length).toBe(2614 + SOLO_EN_EL_ANEJO.length);
  });

  it("las seis filas leídas del texto del BOE y la corregida son las del anejo", () => {
    const delTexto = Object.entries(tabla.procedencia).filter(([, p]) => p.tipo !== "segregado");
    expect(delTexto.length).toBe(7);
    for (const [ine] of delTexto) {
      const k = casadas.indexOf(tabla.ine.indexOf(ine));
      expect(k, ine).toBeGreaterThanOrEqual(0);
      const m = municipioPorIne(ine)!;
      expect([m.ine, m.ab, m.K]).toEqual([ine, anejo[k]!.ab, anejo[k]!.K]);
    }
    // La corregida: la capa del IGN da K = 1,4 en Benalup-Casas Viejas, que no existe en la norma
    expect(municipioPorIne("11901")).toMatchObject({ nombre: "Benalup-Casas Viejas", ab: 0.05, K: 1.2 });
    expect(anejo.find((x) => x.municipio === "Benalup Casas Viejas")).toMatchObject({ ab: 0.05, K: 1.2 });
    expect(municipioPorIne("51001")).toMatchObject({ ab: 0.05, K: 1.2, provincia: "Ceuta" });
    expect(municipioPorIne("52001")).toMatchObject({ ab: 0.08, K: 1, provincia: "Melilla" });
  });

  it("valores sueltos del anejo leído", () => {
    const de = (provincia: string, municipio: string) => {
      const x = anejo.find((y) => y.provincia === provincia && y.municipio === municipio)!;
      return [x.ab, x.K];
    };
    // En el texto, el valor no va en la línea de su municipio: es el k-ésimo de su columna. Carboneras,
    // contado a mano (el municipio 31 y el valor 31 de la primera columna; en su línea no hay valor,
    // y leído por líneas saldría otro). Los demás, valores conocidos de capitales y de la costa.
    expect(de("Almería", "Carboneras")).toEqual([0.12, 1]);
    expect(de("Almería", "Abla")).toEqual([0.14, 1]);
    expect(de("Granada", "Granada")).toEqual([0.23, 1]);
    expect(de("Málaga", "Alhaurín el Grande")).toEqual([0.08, 1]);
    expect(de("Sevilla", "Sevilla")).toEqual([0.07, 1.1]);
    expect(de("Murcia", "Murcia")).toEqual([0.15, 1]);
    expect(de("Barcelona", "Barcelona")).toEqual([0.04, 1]);
    expect(de("Huelva", "Ayamonte")).toEqual([0.14, 1.3]);
  });
});

describe("el buscador y la consulta por código", () => {
  it("«granada» da primero Granada, no «Granada (La)»", () => {
    const r = buscarMunicipios("granada");
    expect(r[0]).toMatchObject({ ine: "18087", nombre: "Granada", provincia: "Granada", ab: 0.23, K: 1, procedencia: null });
    const laGranada = r.find((m) => m.nombre === "Granada (La)")!;
    expect(laGranada).toMatchObject({ provincia: "Barcelona", ab: 0.04 });
    expect(r.indexOf(laGranada)).toBe(1);
    // Los cuatro niveles, en su orden: el nombre completo, una clave, los que empiezan y los que contienen
    const nombres = buscarMunicipios("granada", 100).map((m) => m.nombre);
    expect(nombres.slice(0, 2)).toEqual(["Granada", "Granada (La)"]);
    expect(nombres.some((n) => plegarConsulta(n).includes("granada") && !plegarConsulta(n).startsWith("granada"))).toBe(true);
  });

  it("los dos Torrent se distinguen por su provincia", () => {
    const r = buscarMunicipios("torrent").filter((m) => m.nombre === "Torrent");
    expect(r.map((m) => [m.ine.slice(0, 2), m.provincia, m.ab])).toEqual([
      ["17", "Girona", 0.05],
      ["46", "Valencia", 0.07],
    ]);
  });

  it("sin tildes, con el artículo delante o detrás, y con el límite", () => {
    expect(buscarMunicipios("alhaurin el grande")[0]).toMatchObject({ ine: "29008", nombre: "Alhaurín el Grande", provincia: "Málaga", ab: 0.08, K: 1 });
    expect(buscarMunicipios("El Ejido")[0]!.ine).toBe(buscarMunicipios("ejido, el")[0]!.ine);
    expect(buscarMunicipios("san", 5).length).toBe(5);
    expect(buscarMunicipios("")).toEqual([]);
    expect(buscarMunicipios("  ·  ")).toEqual([]);
    expect(buscarMunicipios("zzzz")).toEqual([]);
    // Madrid no está en el anejo: que no figure no es que esté exento
    expect(buscarMunicipios("madrid").some((m) => m.ine.startsWith("28"))).toBe(false);
    expect(MENSAJE_NO_ENCONTRADO).toMatch(/Compruébalo antes de darlo por exento/);
  });

  it("municipioPorIne: todos los de la tabla y ninguno más", () => {
    tabla.ine.forEach((ine, i) => {
      const m = municipioPorIne(ine)!;
      expect([m.ine, m.nombre, m.ab, m.K]).toEqual([ine, tabla.nombre[i], valores(i).ab, valores(i).K]);
      expect(m.provincia).toBe(provinciaPorIne(ine)!.nombre);
    });
    for (const ine of ["28079", "00000", "99999", "2900", "290080", "", "29008 "]) expect(municipioPorIne(ine)).toBeNull();
    expect(esNombreDe("29008", "Alhaurin el Grande")).toBe(true);
    expect(esNombreDe("29008", "Alhaurín de la Torre")).toBe(false);
    expect(esNombreDe("04902", "El Ejido")).toBe(true);
    expect(esNombreDe("28079", "Madrid")).toBe(false);
  });

  it("la procedencia, en una frase", () => {
    expect(textoProcedencia(null)).toBe("Anejo 1 de la NCSE-02");
    expect(textoProcedencia(municipioPorIne("51001")!.procedencia)).toMatch(/leído del texto del BOE/);
    expect(textoProcedencia(municipioPorIne("11901")!.procedencia)).toMatch(/corregido contra el texto del BOE/);
    expect(textoProcedencia(municipioPorIne("29902")!.procedencia)).toBe("Heredado de Antequera · el municipio se creó en 2010 y el Anejo 1, de 2002, no lo nombra");
  });
});

describe("las provincias y su zona eólica", () => {
  it("las 52, con su código y su zona", () => {
    expect(PROVINCIAS.length).toBe(52);
    expect(PROVINCIAS.map((p) => p.ine)).toEqual(Array.from({ length: 52 }, (_, i) => String(i + 1).padStart(2, "0")));
    for (const p of PROVINCIAS) expect(["A", "B", "C"]).toContain(p.zonaEolica);
    expect(provinciaPorIne("29008")).toMatchObject({ nombre: "Málaga", zonaEolica: "A", frontera: { eolica: "El oeste (Estepona, Campo de Gibraltar) está en zona C." } });
    expect(provinciaPorIne("28")).toEqual({ ine: "28", nombre: "Madrid", zonaEolica: "A", zonaInvernal: 4, capital: { capital: "Madrid", altitud: 660, sk: 0.6 }, fronteraInvernal: "La sierra (norte) está en zona 3." });
    expect(provinciaPorIne("15")!.zonaEolica).toBe("C");
    expect(provinciaDe("99001")).toBe("");
  });
});
