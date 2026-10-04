/**
 * Pruebas de mutación de E6: ¿detecta la batería metamórfica (y la suite completa) un fallo
 * plausible del motor? Cada mutación cambia una línea del código fuente, se pasan 200 modelos
 * aleatorios (aleatorios.ts) y la suite de vitest, y el fichero se restaura.
 *
 * Una mutación se detecta si algún modelo deja de cumplir una relación o el motor rechaza el cálculo
 * (regla de oro 2: el equilibrio con la resultante real de las cargas).
 *
 * Uso: bun validacion/e6/mutaciones.ts → validacion/e6/out_mutaciones.txt (unos 3 minutos).
 * Exige que los ficheros mutados no tengan cambios sin commit (se restauran desde el disco).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(import.meta.dirname, "..", "..");

interface Mutacion {
  id: string;
  fichero: string;
  buscar: string;
  poner: string;
  descripcion: string;
}

const MUTACIONES: Mutacion[] = [
  {
    id: "M1",
    fichero: "src/motor/gdl.ts",
    buscar: "if (c === 0) t.push([M(5), -ry!]);",
    poner: "if (c === 0) t.push([M(5), ry!]);",
    descripcion: "diafragma: ux = uxm + Δy·rzm (signo del término de giro)",
  },
  {
    id: "M2",
    fichero: "src/motor/gdl.ts",
    buscar: "else if (c === 2) t.push([M(3), ry!], [M(4), -rx!]);",
    poner: "else if (c === 2) t.push([M(3), ry!], [M(4), rx!]);",
    descripcion: "enlace rígido: uz = uzm + θx·Δy + θy·Δx (signo de un término de θ × r)",
  },
  {
    id: "M3",
    fichero: "src/elementos/barra.ts",
    buscar: "const F = 12 * EI * flexibilidadCortante(s.G, s.Avy) / L ** 2;",
    poner: "const F = 6 * EI * flexibilidadCortante(s.G, s.Avy) / L ** 2;",
    descripcion: "barra de Timoshenko: Φy a la mitad (error de formulación coherente)",
  },
  {
    id: "M4",
    fichero: "src/elementos/barra.ts",
    buscar: "u[b + 1]! += tz * d[0]! - tx * d[2]!;",
    poner: "u[b + 1]! += tz * d[0]! + tx * d[2]!;",
    descripcion: "offsets: θ × d mal en la recuperación de los desplazamientos de extremo",
  },
  {
    id: "M5",
    fichero: "src/motor/barras.ts",
    buscar: 'const aLocal = (v: V3): V3 => (c.ejes === "local" ? v : local(R, v));',
    poner: 'const aLocal = (v: V3): V3 => (c.ejes === "local" ? v : global(R, v));',
    descripcion: "cargas de barra en globales pasadas a locales con Rᵀ en vez de R",
  },
  {
    id: "M6",
    fichero: "src/motor/laminas.ts",
    buscar: "for (let a = 0; a < 4; a++) for (let k = 0; k < 3; k++) f[6 * a + k] += N[a]! * (ga[k]! + s * (gb[k]! - ga[k]!)) * w;",
    poner: "for (let a = 0; a < 4; a++) for (let k = 0; k < 3; k++) f[6 * a + k] += N[a]! * (gb[k]! + s * (ga[k]! - gb[k]!)) * w;",
    descripcion: "carga de línea en lámina: la ley lineal al revés en las equivalentes",
  },
  {
    id: "M7",
    fichero: "src/motor/elementos.ts",
    buscar: "T[6 * (3 * b + i) + 3 * b + j] = R[3 * i + j]!;",
    poner: "T[6 * (3 * b + i) + 3 * b + j] = R[3 * j + i]!;",
    descripcion: "muelles con ejes: la matriz de giro traspuesta",
  },
  {
    id: "M8",
    fichero: "src/motor/calcular.ts",
    buscar: "const cb = deBarras[k]!.porBarra.get(e.indice);",
    poner: "const cb = deBarras[0]!.porBarra.get(e.indice);",
    descripcion: "recuperación de esfuerzos de barra con las cargas del primer caso",
  },
  {
    id: "M9",
    fichero: "src/motor/laminas.ts",
    buscar: 'const g = (v: Vec3): [number, number, number] => (c.ejes === "global" ? [v[0], v[1], v[2]] : aGlobal(R, v));',
    poner: 'const g = (v: Vec3): [number, number, number] => (c.ejes === "global" ? [v[0], v[1], v[2]] : aGlobal(R, [v[1], v[0], v[2]]));',
    descripcion: "cargas de lámina en locales: ejes 1 y 2 intercambiados",
  },
];

function suite(): string {
  const r = spawnSync("npx", ["vitest", "run"], { cwd: RAIZ, encoding: "utf8", shell: true, timeout: 600_000 });
  const linea = (r.stdout + r.stderr).split("\n").find((l) => /^\s+Tests\s/.test(l)) ?? "sin resumen";
  return linea.trim().replace(/\s+/g, " ");
}

const lineas = [`# validacion/e6/mutaciones.ts — ${new Date().toISOString().slice(0, 10)}; 200 modelos aleatorios por mutación`, ""];
const sucios = execFileSync("git", ["status", "--porcelain", ...new Set(MUTACIONES.map((m) => m.fichero))], { cwd: RAIZ, encoding: "utf8" }).trim();
if (sucios) throw new Error(`hay cambios sin commit en los ficheros que se mutan:\n${sucios}`);
lineas.push("Sin mutación (control): " + suite());
for (const m of MUTACIONES) {
  const ruta = join(RAIZ, m.fichero);
  const original = readFileSync(ruta, "utf8");
  if (original.split(m.buscar).length !== 2) throw new Error(`${m.id}: el texto a mutar no aparece una sola vez en ${m.fichero}`);
  try {
    writeFileSync(ruta, original.replace(m.buscar, m.poner));
    const salida = execFileSync("bun", [join("validacion", "e6", "aleatorios.ts"), "200", "--resumen"], { cwd: RAIZ, encoding: "utf8", timeout: 600_000 });
    const r = JSON.parse(salida.trim().split("\n").pop()!);
    const relaciones = Object.entries(r.detectadas as Record<string, number>).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`);
    const motor = r.excepciones ? `el motor rechaza ${r.excepciones}` : "";
    const veredicto = r.modelosConFallo ? "DETECTADA" : "no detectada";
    lineas.push(
      "",
      `${m.id} (${m.fichero}): ${m.descripcion}`,
      `  batería: ${veredicto} en ${r.modelosConFallo}/200 modelos${motor ? `; ${motor}` : ""}${relaciones.length ? `; relaciones: ${relaciones.join(", ")}` : ""}`,
      ...(r.primerFallo ? [`  primer fallo: ${String(r.primerFallo).slice(0, 220)}`] : []),
      `  suite completa: ${suite()}`,
    );
    console.log(lineas.slice(-4).join("\n"));
  } finally {
    writeFileSync(ruta, original);
  }
}
writeFileSync(join(import.meta.dirname, "out_mutaciones.txt"), lineas.join("\n") + "\n");
console.log(lineas.join("\n"));
