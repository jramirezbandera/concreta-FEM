// Tests de la frontera de importacion (T2.2). Validacion pura: no toca
// IndexedDB pese a vivir bajo el project `persistencia`. Verifica robustez:
// importar datos corruptos o de otra version NUNCA debe lanzar (CLAUDE.md §2.8).
import { describe, it, expect } from "vitest";
import {
  migrarYValidar,
  type Migracion,
  type ResultadoImport,
} from "./migracion";
import { exportarProyectoComoTexto, importarProyecto } from "./serializacion";
import { crearModeloVacio } from "../dominio/helpers";
import { SCHEMA_VERSION } from "../dominio/comunes";
import type { Modelo } from "../dominio/modelo";
import type { Pilar } from "../dominio/pilar";
import type { Pano } from "../dominio/pano";

// Helper: estrecha el resultado a ok:false y devuelve sus errores.
function errores(r: ResultadoImport): string[] {
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("se esperaba ok:false");
  return r.errores;
}

describe("migrarYValidar — caso feliz", () => {
  it("acepta un Modelo vacio valido y lo devuelve equivalente", () => {
    const modelo = crearModeloVacio();
    const r = migrarYValidar(modelo);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("se esperaba ok:true");
    expect(r.modelo).toEqual(modelo);
    expect(r.avisos).toEqual([]); // sin migracion aplicada
  });

  it("acepta un Modelo con elementos de obra", () => {
    const modelo = crearModeloVacio();
    modelo.grupos.push({
      id: "g1",
      nombre: "Cubierta",
      categoriaUso: "A",
      sobrecargaUso: 2,
      cargasMuertas: 1,
    });
    modelo.plantas.push({
      id: "p1",
      nombre: "Planta 1",
      cota: 3,
      altura: 3,
      grupoId: "g1",
    });
    const pilar: Pilar = {
      id: "pi1",
      nombre: "P1",
      x: 0,
      y: 0,
      plantaInicial: "p1",
      plantaFinal: "p1",
      seccionId: "s1",
      materialId: "m1",
      angulo: 0,
      vinculacionExterior: true,
      arranque: "empotrado",
    };
    modelo.pilares.push(pilar);

    const r = migrarYValidar(modelo);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("se esperaba ok:true");
    expect(r.modelo).toEqual(modelo);
  });
});

describe("migrarYValidar — version incompatible", () => {
  it("rechaza una version de esquema futura con mensaje claro", () => {
    const futuro = { ...crearModeloVacio(), schemaVersion: 999 };
    const errs = errores(migrarYValidar(futuro));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/version mas reciente/i);
    expect(errs[0]).toContain("999");
    expect(errs[0]).toContain(String(SCHEMA_VERSION));
  });
});

describe("migrarYValidar — datos corruptos (no lanza)", () => {
  it("rechaza null", () => {
    const errs = errores(migrarYValidar(null));
    expect(errs.length).toBeGreaterThan(0);
  });

  it("rechaza un no-objeto (string)", () => {
    expect(() => migrarYValidar("basura")).not.toThrow();
    expect(errores(migrarYValidar("basura")).length).toBeGreaterThan(0);
  });

  it("rechaza un objeto sin schemaVersion", () => {
    const errs = errores(migrarYValidar({ foo: "bar" }));
    expect(errs[0]).toMatch(/version de esquema|corrupto/i);
  });

  it("rechaza schemaVersion no numerico", () => {
    const errs = errores(migrarYValidar({ schemaVersion: "uno" }));
    expect(errs.length).toBeGreaterThan(0);
  });

  it("rechaza undefined", () => {
    expect(() => migrarYValidar(undefined)).not.toThrow();
    expect(errores(migrarYValidar(undefined)).length).toBeGreaterThan(0);
  });
});

describe("migrarYValidar — campo invalido apunta al campo", () => {
  it("detecta `unidades` mal y referencia la ruta", () => {
    const malo = { ...crearModeloVacio(), unidades: "kg-cm" };
    const errs = errores(migrarYValidar(malo));
    expect(errs.some((e) => e.startsWith("unidades:"))).toBe(true);
  });

  it("detecta un pilar sin seccionId y referencia su ruta", () => {
    const modelo = crearModeloVacio() as unknown as {
      pilares: unknown[];
    };
    // Pilar al que le falta `seccionId` (campo obligatorio).
    modelo.pilares.push({
      id: "pi1",
      nombre: "P1",
      x: 0,
      y: 0,
      plantaInicial: "p1",
      plantaFinal: "p1",
      materialId: "m1",
      angulo: 0,
      vinculacionExterior: true,
      arranque: "empotrado",
    });
    const errs = errores(migrarYValidar(modelo));
    // La ruta de Zod incluye el indice del array y el campo: "pilares.0.seccionId".
    expect(errs.some((e) => e.includes("pilares.0.seccionId"))).toBe(true);
  });
});

// Verifica que un proyecto ya en la version vigente NO se re-migra: la cadena no
// corre y no hay aviso de actualizacion (la migracion v1->v2 real se prueba abajo).
describe("migrarYValidar — cadena de migraciones (version vigente)", () => {
  it("no aplica migracion cuando ya esta en la version vigente (sin avisos)", () => {
    const r = migrarYValidar(crearModeloVacio());
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("se esperaba ok:true");
    expect(r.avisos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Migracion REAL de model-schema v1 -> v2 (F2.3 / E7). Construye proyectos v1
// crudos (sin los campos de F2a) y verifica el sembrado del peso propio, los
// defaults, la idempotencia, la colision de nombre y el reclamo silencioso.
// ---------------------------------------------------------------------------

const ID_AUTO = "hip-peso-propio";

// Estrecha el resultado a ok:true y devuelve el modelo migrado/validado.
function ok(r: ResultadoImport) {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("se esperaba ok:true");
  return r;
}

// Localiza la hipotesis automatica (id canonico) en un modelo migrado.
function autoDe(modelo: Modelo) {
  return modelo.hipotesis.filter((h) => h.id === ID_AUTO && h.automatica);
}

// Fabrica un proyecto v1 valido (forma de Modelo anterior a F2a): schemaVersion:1,
// `analisis` SIN `incluirPesoPropio`, hipotesis SIN `automatica`, sin la automatica.
function proyectoV1(
  hipotesis: { id: string; nombre: string; tipo: "permanente" | "variable" }[] = [
    { id: "hip-cargas-muertas", nombre: "Cargas muertas", tipo: "permanente" },
    { id: "hip-sobrecarga-uso", nombre: "Sobrecarga de uso", tipo: "variable" },
  ],
  analisis: Record<string, unknown> = { tipo: "lineal", comprobarEstatica: true },
): Record<string, unknown> {
  return {
    unidades: "kN-m",
    schemaVersion: 1,
    grupos: [],
    plantas: [],
    secciones: [],
    nudos: [],
    pilares: [],
    vigas: [],
    panos: [],
    muros: [],
    cargas: [],
    hipotesis,
    analisis,
  };
}

describe("migrarYValidar — v1 -> v2: sembrado y defaults", () => {
  it("migra un v1 sin campos nuevos: siembra la automatica + defaults", () => {
    const r = ok(migrarYValidar(proyectoV1()));
    // Aviso de actualizacion de esquema.
    expect(r.avisos.some((a) => /actualiz/i.test(a))).toBe(true);
    // Quedo en la version vigente.
    expect(r.modelo.schemaVersion).toBe(SCHEMA_VERSION);
    // Default nuevo del analisis.
    expect(r.modelo.analisis.incluirPesoPropio).toBe(true);
    // tipo previo preservado.
    expect(r.modelo.analisis.tipo).toBe("lineal");
    // Exactamente UNA automatica valida, "Peso propio", permanente.
    const autos = autoDe(r.modelo);
    expect(autos).toHaveLength(1);
    expect(autos[0]).toMatchObject({
      id: ID_AUTO,
      nombre: "Peso propio",
      tipo: "permanente",
      automatica: true,
    });
    // Las hipotesis de usuario reciben automatica:false.
    const muertas = r.modelo.hipotesis.find((h) => h.id === "hip-cargas-muertas");
    expect(muertas?.automatica).toBe(false);
  });

  it("preserva tipo 'general' previo", () => {
    const r = ok(
      migrarYValidar(
        proyectoV1(undefined, { tipo: "general", comprobarEstatica: false }),
      ),
    );
    expect(r.modelo.analisis.tipo).toBe("general");
  });

  it("es idempotente: migrar dos veces = una", () => {
    const r1 = ok(migrarYValidar(proyectoV1()));
    // El resultado ya es v2: re-pasarlo no debe re-migrar ni duplicar la automatica.
    const r2 = ok(migrarYValidar(r1.modelo));
    expect(r2.avisos).toEqual([]); // no corre la cadena
    expect(autoDe(r2.modelo)).toHaveLength(1);
    expect(r2.modelo).toEqual(r1.modelo);
  });
});

describe("migrarYValidar — v1 -> v2: colision de nombre (CV4-2)", () => {
  it("'Peso propio' ya ocupado por el usuario -> nombre seguro + aviso, datos intactos", () => {
    const v1 = proyectoV1([
      { id: "hip-usuario", nombre: "Peso propio", tipo: "variable" },
    ]);
    const r = ok(migrarYValidar(v1));
    // La hipotesis del usuario queda intacta (id, nombre y tipo).
    const usuario = r.modelo.hipotesis.find((h) => h.id === "hip-usuario");
    expect(usuario).toMatchObject({
      id: "hip-usuario",
      nombre: "Peso propio",
      tipo: "variable",
      automatica: false,
    });
    // La automatica se siembra con nombre seguro distinto.
    const autos = autoDe(r.modelo);
    expect(autos).toHaveLength(1);
    expect(autos[0].nombre).toBe("Peso propio (automatico)");
    // Aviso de posible duplicacion en lenguaje de obra.
    expect(r.avisos.some((a) => /posible duplicación/i.test(a))).toBe(true);
  });

  it("'Peso propio' y 'Peso propio (automatico)' ocupados -> sufijo libre", () => {
    const v1 = proyectoV1([
      { id: "h1", nombre: "Peso propio", tipo: "variable" },
      { id: "h2", nombre: "Peso propio (automatico)", tipo: "variable" },
    ]);
    const r = ok(migrarYValidar(v1));
    const autos = autoDe(r.modelo);
    expect(autos).toHaveLength(1);
    expect(autos[0].nombre).toBe("Peso propio (automatico) (2)");
    // Datos de usuario intactos.
    expect(r.modelo.hipotesis.find((h) => h.id === "h1")?.nombre).toBe(
      "Peso propio",
    );
    expect(r.modelo.hipotesis.find((h) => h.id === "h2")?.nombre).toBe(
      "Peso propio (automatico)",
    );
  });
});

describe("migrarYValidar — v1 -> v2: reclamo silencioso (CV4-2)", () => {
  it("id=hip-peso-propio con datos NO automaticos -> no se reclama, se reasigna", () => {
    // Un proyecto de usuario que casualmente uso ese id para una hipotesis suya.
    const v1 = proyectoV1([
      {
        id: ID_AUTO,
        nombre: "Mi hipotesis especial",
        tipo: "variable",
      },
    ]);
    const r = ok(migrarYValidar(v1));
    // Los datos de usuario sobreviven (nombre y tipo), aunque con id reasignado.
    const usuario = r.modelo.hipotesis.find(
      (h) => h.nombre === "Mi hipotesis especial",
    );
    expect(usuario).toBeDefined();
    expect(usuario?.id).not.toBe(ID_AUTO); // id reasignado, no adoptado
    expect(usuario?.tipo).toBe("variable");
    expect(usuario?.automatica).toBe(false);
    // Y existe EXACTAMENTE una automatica valida con el id canonico.
    const autos = autoDe(r.modelo);
    expect(autos).toHaveLength(1);
    expect(autos[0].nombre).toBe("Peso propio");
    // Aviso de que el id se conservo con identificador nuevo.
    expect(r.avisos.some((a) => /identificador nuevo/i.test(a))).toBe(true);
  });

  it("id=hip-peso-propio YA automatica valida -> idempotente, no se duplica", () => {
    // Un v1 que (atipicamente) ya trae la automatica: no debe duplicarse.
    const v1 = proyectoV1([
      { id: "hip-cargas-muertas", nombre: "Cargas muertas", tipo: "permanente" },
    ]);
    (v1.hipotesis as unknown[]).push({
      id: ID_AUTO,
      nombre: "Peso propio",
      tipo: "permanente",
      automatica: true,
    });
    const r = ok(migrarYValidar(v1));
    expect(autoDe(r.modelo)).toHaveLength(1);
  });
});

describe("migrarYValidar — version vigente nativa no se re-migra", () => {
  it("un Modelo de la version vigente (crearModeloVacio) pasa sin migrar y sigue valido", () => {
    const modelo = crearModeloVacio();
    const r = ok(migrarYValidar(modelo));
    expect(r.avisos).toEqual([]);
    expect(r.modelo).toEqual(modelo);
    // Sigue habiendo exactamente una automatica.
    expect(autoDe(r.modelo)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Migracion REAL de model-schema v2 -> v3 (F3 corte 1). En v1/v2 un `Pano` era un
// STUB reservado (solo `{id}`, sin geometria): NO se puede completar a la forma de
// LOSA de v3, asi que la migracion lo DESCARTA junto con sus cargas superficiales,
// dejando un AVISO (no rompe el import). Un proyecto v2 real tenia `panos: []`
// (no-op), pero la migracion debe ser robusta ante un .json heredado con stubs.
// ---------------------------------------------------------------------------

// Fabrica un proyecto v2 valido (forma de Modelo de F2a: schemaVersion:2, peso
// propio ya presente, hipotesis con `automatica`), parametrizando `panos`/`cargas`
// para ejercitar el descarte de stubs. Por defecto `panos: []` (el caso v2 real).
function proyectoV2(
  panos: unknown[] = [],
  cargas: unknown[] = [],
): Record<string, unknown> {
  return {
    unidades: "kN-m",
    schemaVersion: 2,
    grupos: [],
    plantas: [],
    secciones: [],
    nudos: [],
    pilares: [],
    vigas: [],
    panos,
    muros: [],
    cargas,
    hipotesis: [
      { id: "hip-cargas-muertas", nombre: "Cargas muertas", tipo: "permanente", automatica: false },
      { id: "hip-sobrecarga-uso", nombre: "Sobrecarga de uso", tipo: "variable", automatica: false },
      { id: ID_AUTO, nombre: "Peso propio", tipo: "permanente", automatica: true },
    ],
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: true },
  };
}

describe("migrarYValidar — v2 -> v3: descarta paños-stub", () => {
  it("v2 con panos:[] -> no-op, valida sin aviso de descarte", () => {
    const r = ok(migrarYValidar(proyectoV2()));
    expect(r.modelo.schemaVersion).toBe(SCHEMA_VERSION);
    expect(r.modelo.panos).toEqual([]);
    // No hay aviso de descarte de paños (solo, en su caso, el de actualizacion).
    expect(r.avisos.some((a) => /descartaron .* paño/i.test(a))).toBe(false);
    // El aviso de actualizacion de esquema si esta (la cadena corrio v2->v3).
    expect(r.avisos.some((a) => /actualiz/i.test(a))).toBe(true);
  });

  it("v2 con un paño-stub {id} + su carga superficial -> descarta ambos con aviso, valida", () => {
    const v2 = proyectoV2(
      [{ id: "p1" }],
      [
        { id: "c1", tipo: "superficial", ambito: "p1", valor: 5, hipotesisId: "hip-cargas-muertas" },
      ],
    );
    const r = ok(migrarYValidar(v2));
    // El paño-stub desaparece.
    expect(r.modelo.panos).toEqual([]);
    // Su carga superficial tambien (referencia colgante).
    expect(r.modelo.cargas).toEqual([]);
    // Aviso explicito en lenguaje de obra (1 paño descartado).
    expect(
      r.avisos.some((a) => /se descartaron 1 paño sin geometría/i.test(a)),
    ).toBe(true);
    // Quedo en la version vigente y valida (lo garantiza ok()).
    expect(r.modelo.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("descarta solo las superficiales del paño-stub; conserva el resto de cargas", () => {
    const v2 = proyectoV2(
      [{ id: "p1" }, { id: "p2" }],
      [
        // Superficial sobre paño descartado p1 -> se purga.
        { id: "c1", tipo: "superficial", ambito: "p1", valor: 5, hipotesisId: "hip-cargas-muertas" },
        // Superficial sobre paño descartado p2 -> se purga.
        { id: "c2", tipo: "superficial", ambito: "p2", valor: 3, hipotesisId: "hip-cargas-muertas" },
        // Lineal sobre una viga -> se conserva (no es superficial).
        { id: "c3", tipo: "lineal", ambito: "v1", valor: 10, hipotesisId: "hip-cargas-muertas" },
        // Superficial sobre un ambito que NO es paño descartado -> se conserva.
        { id: "c4", tipo: "superficial", ambito: "otro", valor: 2, hipotesisId: "hip-cargas-muertas" },
      ],
    );
    const r = ok(migrarYValidar(v2));
    expect(r.modelo.panos).toEqual([]);
    // Solo c3 (lineal) y c4 (superficial sobre otro ambito) sobreviven.
    expect(r.modelo.cargas.map((c) => c.id).sort()).toEqual(["c3", "c4"]);
    // Aviso plural (2 paños descartados).
    expect(
      r.avisos.some((a) => /se descartaron 2 paños sin geometría/i.test(a)),
    ).toBe(true);
  });

  it("conserva un paño con forma de LOSA v3 completa (no es stub)", () => {
    const losa = {
      id: "pano-losa",
      nombre: "Forjado 1",
      tipo: "losa",
      plantaId: "pl1",
      perimetro: ["n1", "n2", "n3", "n4"],
      espesor: 0.25,
      materialId: "mat-horm",
      tamMalla: 0.5,
      bordeApoyo: "simple",
    };
    const r = ok(migrarYValidar(proyectoV2([losa])));
    // El paño losa sobrevive intacto y valida contra PanoSchema v3.
    expect(r.modelo.panos).toHaveLength(1);
    expect(r.modelo.panos[0]).toMatchObject(losa);
    // Sin aviso de descarte (no habia stubs).
    expect(r.avisos.some((a) => /descartaron .* paño/i.test(a))).toBe(false);
  });
});

// Round-trip de un Modelo v3 nativo con un paño losa: export a texto -> import.
// La frontera Zod (migrarYValidar via importarProyecto) lo acepta y el paño losa
// sobrevive estable (no se descarta: ya esta en la forma v3).
describe("v3 con paño losa: round-trip export/import estable", () => {
  it("exportar e importar un Modelo con un Pano losa preserva el paño", () => {
    const modelo = crearModeloVacio();
    const losa: Pano = {
      id: "pano-losa",
      nombre: "Forjado 1",
      tipo: "losa",
      plantaId: "pl1",
      perimetro: ["n1", "n2", "n3", "n4"],
      espesor: 0.25,
      materialId: "mat-horm",
      tamMalla: 0.5,
      bordeApoyo: "empotrado",
    };
    modelo.panos.push(losa);

    const texto = exportarProyectoComoTexto("Proyecto con losa", modelo);
    const r = importarProyecto(texto);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("se esperaba ok:true");
    expect(r.nombre).toBe("Proyecto con losa");
    // El paño losa viaja intacto por la frontera (no se descarta: es forma v3).
    expect(r.modelo.panos).toHaveLength(1);
    expect(r.modelo.panos[0]).toEqual(losa);
    // Round-trip estable: el modelo importado es identico al original.
    expect(r.modelo).toEqual(modelo);
  });
});

// Ejercita la CADENA real (migracion.ts) inyectando un registro de migraciones
// sintetico (T3). Partimos de un raw con schemaVersion=0 (MENOR que el objetivo) y
// registramos una migracion por CADA paso 0 -> 1 -> ... -> SCHEMA_VERSION, de modo
// que el bucle corra de verdad y emita el aviso. Las migraciones inyectadas solo
// reetiquetan la version (la forma del modelo vacio ya es valida en la version
// vigente). No tocamos el comportamiento de produccion: el registro real (la
// migracion v1->v2 real) es F2.3; aqui solo se prueba el MECANISMO de la cadena.
describe("migrarYValidar — cadena de migraciones inyectada (T3)", () => {
  it("aplica la cadena 0 -> ... -> SCHEMA_VERSION inyectada: avanza la version y avisa", () => {
    // Modelo valido pero etiquetado en una version anterior a la vigente.
    const raw = { ...crearModeloVacio(), schemaVersion: 0 };
    // Una migracion sintetica por cada salto (v -> v+1); todas reetiquetan a v+1.
    const migraciones: Record<number, Migracion> = {};
    for (let v = 0; v < SCHEMA_VERSION; v++) {
      migraciones[v] = (datos) => ({
        ...(datos as Record<string, unknown>),
        schemaVersion: v + 1,
      });
    }

    const r = migrarYValidar(raw, migraciones);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("se esperaba ok:true");
    // Aviso de actualizacion de esquema (la cadena corrio al menos un paso).
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toMatch(/actualiz/i);
    // El modelo resultante quedo en la version vigente.
    expect(r.modelo.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("hueco en la cadena: registro vacio con schemaVersion menor -> error de migracion (T3)", () => {
    const raw = { ...crearModeloVacio(), schemaVersion: 0 };
    // Registro VACIO: no hay migracion 0 -> 1, la cadena no puede completarse.
    const r = migrarYValidar(raw, {});
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("se esperaba ok:false");
    expect(r.errores[0]).toMatch(/no es posible migrar/i);
    expect(r.errores[0]).toContain("v0");
  });
});
