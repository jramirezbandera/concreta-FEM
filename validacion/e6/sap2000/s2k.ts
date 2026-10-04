/**
 * Formato de texto de SAP2000 (.$2k / .s2k): las tablas de la base de datos interactiva, una por
 * bloque `TABLE:  "NOMBRE"`, con un registro por línea en pares `Campo=Valor` separados por espacios.
 * Un valor con espacios va entre comillas; una línea que acaba en « _» sigue en la siguiente; el
 * fichero acaba con `END TABLE DATA`. Las tablas de resultados que exporta SAP2000 como texto tienen
 * la misma forma. Además se aceptan tablas delimitadas (tabulador, «;» o «,») con una fila de
 * cabecera, precedidas de una línea con el nombre de la tabla (lo que da Excel → CSV).
 *
 * Escrito a partir de la forma de los ficheros que genera SAP2000 v14–v24; no se ha probado aún con
 * un fichero real del usuario.
 */

export type Registro = Record<string, string>;
export type Tablas = Map<string, Registro[]>;

/** Divide una línea de registro en pares Campo=Valor (los valores pueden ir entre comillas). */
function pares(linea: string): Registro {
  const r: Registro = {};
  const re = /([^\s=]+)=("([^"]*)"|\S*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(linea))) r[m[1]!] = m[3] ?? m[2]!;
  return r;
}

/** Lee un fichero de tablas de SAP2000 (formato $2k o delimitado). Los nombres de tabla van en mayúsculas. */
export function leerTablas(texto: string): Tablas {
  const tablas: Tablas = new Map();
  const lineas = texto.replace(/\r\n?/g, "\n").split("\n");
  // Une las líneas partidas con « _»
  const unidas: string[] = [];
  for (let i = 0; i < lineas.length; i++) {
    let l = lineas[i]!;
    while (/\s_\s*$/.test(l) && i + 1 < lineas.length) l = l.replace(/\s_\s*$/, " ") + lineas[++i]!.trim();
    unidas.push(l);
  }
  let actual: Registro[] | null = null;
  let cabecera: string[] | null = null;
  let separador: string | null = null;
  for (const l of unidas) {
    const t = l.trim();
    const tabla = /^TABLE:\s*"?([^"]+)"?\s*$/i.exec(t);
    if (tabla) {
      const nombre = tabla[1]!.trim().toUpperCase();
      if (!tablas.has(nombre)) tablas.set(nombre, []);
      actual = tablas.get(nombre)!;
      cabecera = null;
      separador = null;
      continue;
    }
    if (!t || /^END TABLE DATA/i.test(t) || t.startsWith(";") || t.startsWith("$")) continue;
    if (!actual) continue;
    if (t.includes("=")) {
      actual.push(pares(t));
      continue;
    }
    // Tabla delimitada: la primera fila es la cabecera; una segunda fila de unidades se salta
    const sep: string = separador ?? (t.includes("\t") ? "\t" : t.includes(";") ? ";" : ",");
    const celdas = t.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (!cabecera) {
      cabecera = celdas;
      separador = sep;
      continue;
    }
    if (celdas.every((c) => c === "" || /^(Text|Unitless|[A-Za-z]+(\/[A-Za-z0-9]+)?|[A-Za-z]+-[A-Za-z]+)$/.test(c)) && actual.length === 0) continue;
    const r: Registro = {};
    cabecera.forEach((c, i) => (r[c] = celdas[i] ?? ""));
    actual.push(r);
  }
  return tablas;
}

/** Escribe tablas en formato $2k (para generar modelos que se importan en SAP2000). */
export function escribirTablas(tablas: [string, Registro[]][], cabecera = "Generado por validacion/e6/sap2000 (Concreta FEM)"): string {
  const salida = [`File ${cabecera}`, ""];
  for (const [nombre, registros] of tablas) {
    salida.push(`TABLE:  "${nombre}"`);
    for (const r of registros) {
      salida.push(
        "   " +
          Object.entries(r)
            .map(([k, v]) => `${k}=${/\s/.test(v) || v === "" ? `"${v}"` : v}`)
            .join("   "),
      );
    }
    salida.push("");
  }
  salida.push("END TABLE DATA", "");
  return salida.join("\r\n");
}

/** Número de un campo (con coma o punto decimal); NaN si no está o no es un número. */
export function num(r: Registro, campo: string, porDefecto = Number.NaN): number {
  const v = r[campo];
  if (v === undefined || v.trim() === "") return porDefecto;
  const x = Number(v.trim().replace(",", "."));
  return Number.isFinite(x) ? x : Number.NaN;
}

/** Campo Sí/No de SAP2000. */
export const si = (r: Registro, campo: string) => /^(yes|y|true|1|s[ií])$/i.test(r[campo]?.trim() ?? "");
