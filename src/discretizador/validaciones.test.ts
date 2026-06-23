import { describe, it, expect } from "vitest";
import { validarModelo, type ErrorObra } from "./validaciones";
import { ModeloSchema, type Modelo } from "../dominio";
import { SCHEMA_VERSION } from "../dominio";

// Tests de las validaciones previas (feature-4, T1.2). Proyecto `node` (sin DOM):
// validaciones es puro. Un caso por `codigo` que verifica `codigo` + `elementoId`,
// que el `mensaje` no contiene jerga FEM, y un modelo valido -> [].

// Material real del catalogo (src/biblioteca): acero "S275". Las SECCIONES ya no se
// resuelven contra el catalogo sino contra `modelo.secciones` (cierre de hueco
// Fase 2): la seccion de obra "sec-ipe" referencia el perfil de catalogo "IPE300".
const MATERIAL_OK = "S275";
const SECCION_OK = "sec-ipe"; // id de la seccion de obra (en modelo.secciones)
const PERFIL_OK = "IPE300"; // id del perfil de catalogo que esa seccion referencia

// Modelo VALIDO de partida: un pilar sujeto (vinculacion exterior) y una viga entre
// dos nudos, con material y seccion del catalogo, y una hipotesis con carga. Sirve
// de base; cada test invalido lo clona y rompe una sola cosa.
function modeloValido(): Modelo {
  return {
    unidades: "kN-m",
    schemaVersion: SCHEMA_VERSION,
    grupos: [
      { id: "g1", nombre: "Grupo 1", categoriaUso: "A", sobrecargaUso: 2, cargasMuertas: 1 },
    ],
    plantas: [
      { id: "p0", nombre: "Cimentacion", cota: 0, altura: 3, grupoId: "g1" },
      { id: "p1", nombre: "Planta 1", cota: 3, altura: 3, grupoId: "g1" },
    ],
    secciones: [
      { id: SECCION_OK, nombre: "IPE 300", tipo: "perfilMetalico", perfilId: PERFIL_OK },
    ],
    nudos: [
      { id: "n1", x: 0, y: 0 },
      { id: "n2", x: 5, y: 0 },
    ],
    pilares: [
      {
        id: "pil1", nombre: "P1", x: 0, y: 0,
        plantaInicial: "p0", plantaFinal: "p1",
        seccionId: SECCION_OK, materialId: MATERIAL_OK, angulo: 0,
        vinculacionExterior: true, arranque: "empotrado",
      },
    ],
    vigas: [
      {
        id: "v1", nombre: "V1", plantaId: "p1", nudoI: "n1", nudoJ: "n2",
        seccionId: SECCION_OK, materialId: MATERIAL_OK,
        extremoI: "empotrado", extremoJ: "empotrado", tirante: false,
      },
    ],
    panos: [],
    muros: [],
    cargas: [{ id: "c1", tipo: "lineal", ambito: "v1", valor: -10, hipotesisId: "h1" }],
    hipotesis: [{ id: "h1", nombre: "Peso propio", tipo: "permanente" }],
    analisis: { tipo: "lineal", comprobarEstatica: true },
  };
}

// Termino prohibido = jerga FEM filtrada a texto de UI (CLAUDE.md regla de oro 2).
const JERGA_FEM = [
  "release", "nodo n", "member", "dof", "gdl", "node", "support",
  "rx", "ry", "rz", "fem", "stiffness", "rigidez",
];
function sinJergaFEM(e: ErrorObra): void {
  const m = e.mensaje.toLowerCase();
  for (const termino of JERGA_FEM) {
    expect(m, `mensaje no debe contener jerga FEM "${termino}": ${e.mensaje}`).not.toContain(termino);
  }
}

function codigos(errores: ErrorObra[]): string[] {
  return errores.map((e) => e.codigo);
}

describe("validarModelo", () => {
  it("el modelo de partida es valido (sin errores)", () => {
    // Sanidad: la base cumple el schema y no dispara ninguna validacion.
    expect(ModeloSchema.safeParse(modeloValido()).success).toBe(true);
    expect(validarModelo(modeloValido())).toEqual([]);
  });

  it("severidad por codigo: REF_*/SIN_SUJECION/NOMBRE_DUP son 'error'; COMBO_SIN_CARGAS/FLOTANTE son 'aviso'", () => {
    // Criterio: aviso = no impide calcular; error = sí. Se construye un modelo que
    // dispara a la vez varios codigos de cada clase y se comprueba la severidad.
    const m = modeloValido();
    // error: nombre duplicado de viga (NOMBRE_DUP) + material inexistente (REF_MATERIAL).
    m.nudos.push({ id: "n3", x: 10, y: 0 });
    m.vigas.push({
      id: "v2", nombre: "V1", plantaId: "p1", nudoI: "n2", nudoJ: "n3",
      seccionId: SECCION_OK, materialId: "NO_EXISTE",
      extremoI: "empotrado", extremoJ: "empotrado", tirante: false,
    });
    // aviso: hipotesis sin cargas (COMBO_SIN_CARGAS) + nudo flotante (FLOTANTE).
    m.hipotesis.push({ id: "h2", nombre: "Nieve", tipo: "variable" });
    m.nudos.push({ id: "n9", x: 99, y: 99 });

    const sevPorCodigo = new Map<string, ErrorObra["severidad"]>();
    for (const e of validarModelo(m)) sevPorCodigo.set(e.codigo, e.severidad);

    expect(sevPorCodigo.get("NOMBRE_DUP")).toBe("error");
    expect(sevPorCodigo.get("REF_MATERIAL")).toBe("error");
    expect(sevPorCodigo.get("COMBO_SIN_CARGAS")).toBe("aviso");
    expect(sevPorCodigo.get("FLOTANTE")).toBe("aviso");
  });

  it("severidad: SIN_SUJECION es 'error'", () => {
    const m = modeloValido();
    m.pilares[0].vinculacionExterior = false;
    const e = validarModelo(m).find((x) => x.codigo === "SIN_SUJECION")!;
    expect(e.severidad).toBe("error");
  });

  it("NOMBRE_DUP: dos vigas con el mismo nombre", () => {
    const m = modeloValido();
    m.nudos.push({ id: "n3", x: 10, y: 0 });
    m.vigas.push({
      id: "v2", nombre: "V1", plantaId: "p1", nudoI: "n2", nudoJ: "n3",
      seccionId: SECCION_OK, materialId: MATERIAL_OK,
      extremoI: "empotrado", extremoJ: "empotrado", tirante: false,
    });
    const errores = validarModelo(m);
    const dup = errores.filter((e) => e.codigo === "NOMBRE_DUP");
    expect(dup).toHaveLength(1);
    expect(dup[0].elementoId).toBe("v2");
    expect(dup[0].elementoTipo).toBe("viga");
    sinJergaFEM(dup[0]);
  });

  it("REF_MATERIAL: pilar con material inexistente", () => {
    const m = modeloValido();
    m.pilares[0].materialId = "NO_EXISTE";
    const errores = validarModelo(m);
    const e = errores.find((x) => x.codigo === "REF_MATERIAL");
    expect(e).toBeDefined();
    expect(e!.elementoId).toBe("pil1");
    expect(e!.elementoTipo).toBe("pilar");
    sinJergaFEM(e!);
  });

  it("REF_SECCION: viga con seccion que no existe en la obra", () => {
    const m = modeloValido();
    m.vigas[0].seccionId = "SECCION_FANTASMA";
    const errores = validarModelo(m);
    const e = errores.find((x) => x.codigo === "REF_SECCION");
    expect(e).toBeDefined();
    expect(e!.elementoId).toBe("v1");
    expect(e!.elementoTipo).toBe("viga");
    sinJergaFEM(e!);
  });

  it("REF_SECCION: seccion de obra perfilMetalico con perfilId inexistente en el catalogo", () => {
    const m = modeloValido();
    // La seccion existe en la obra, pero su perfil no esta en el catalogo PERFILES.
    m.secciones[0] = {
      id: SECCION_OK, nombre: "Perfil raro", tipo: "perfilMetalico", perfilId: "IPE999",
    };
    const errores = validarModelo(m);
    const e = errores.find((x) => x.codigo === "REF_SECCION");
    expect(e).toBeDefined();
    sinJergaFEM(e!);
  });

  it("REF_SECCION: seccion de hormigon de obra se autoabastece (no error)", () => {
    const m = modeloValido();
    // Hormigon rectangular: existe en la obra y trae sus dimensiones; valido aunque
    // no este en el catalogo de perfiles.
    m.secciones[0] = {
      id: SECCION_OK, nombre: "30x50", tipo: "hormigonRectangular", b: 0.3, h: 0.5,
    };
    const errores = validarModelo(m);
    expect(errores.find((x) => x.codigo === "REF_SECCION")).toBeUndefined();
  });

  it("REF_PLANTA: pilar que arranca en una planta inexistente", () => {
    const m = modeloValido();
    m.pilares[0].plantaInicial = "PLANTA_X";
    const errores = validarModelo(m);
    const e = errores.find((x) => x.codigo === "REF_PLANTA");
    expect(e).toBeDefined();
    expect(e!.elementoId).toBe("pil1");
    expect(e!.elementoTipo).toBe("pilar");
    sinJergaFEM(e!);
  });

  it("REF_NUDO: viga con un extremo en un punto inexistente", () => {
    const m = modeloValido();
    m.vigas[0].nudoJ = "PUNTO_X";
    const errores = validarModelo(m);
    const e = errores.find((x) => x.codigo === "REF_NUDO");
    expect(e).toBeDefined();
    expect(e!.elementoId).toBe("v1");
    expect(e!.elementoTipo).toBe("viga");
    sinJergaFEM(e!);
  });

  it("VIGA_DEGENERADA: ambos extremos en la misma celda de rejilla", () => {
    // Red para vias no-UI (import .json, cargas F13): dos nudos en la misma celda
    // colapsarian en un unico nodo FEM => barra de longitud cero. Se mueve n2 a 0.4mm
    // de n1 (round(0.4)=0 => misma celda) y se comprueba el bloqueo en lenguaje de obra.
    const m = modeloValido();
    m.nudos[1] = { id: "n2", x: 0.0004, y: 0 };
    const errores = validarModelo(m);
    const e = errores.find((x) => x.codigo === "VIGA_DEGENERADA");
    expect(e).toBeDefined();
    expect(e!.severidad).toBe("error");
    expect(e!.elementoId).toBe("v1");
    expect(e!.elementoTipo).toBe("viga");
    sinJergaFEM(e!);
  });

  it("VIGA_DEGENERADA: caso diagonal que colapsa por clave de rejilla (no por euclideo)", () => {
    // Dos puntos en diagonal a (-0.49mm,-0.49mm) y (0.49mm,0.49mm): su distancia
    // euclidea (~1.39mm) es > TOL_NODO, pero ambos cuantizan a la MISMA celda de
    // rejilla (round(±0.49)=0) => mismo nodo FEM. El criterio correcto (clavePosicion)
    // lo bloquea; uno euclideo lo dejaria pasar (regresion que cazo la voz externa).
    const m = modeloValido();
    m.nudos[0] = { id: "n1", x: -0.00049, y: -0.00049 };
    m.nudos[1] = { id: "n2", x: 0.00049, y: 0.00049 };
    const e = validarModelo(m).find((x) => x.codigo === "VIGA_DEGENERADA");
    expect(e).toBeDefined();
    expect(e!.elementoId).toBe("v1");
  });

  it("VIGA_DEGENERADA: no se dispara para una viga con longitud normal", () => {
    // El modelo valido (n1=(0,0), n2=(5,0)) no debe marcar la viga como degenerada.
    expect(codigos(validarModelo(modeloValido()))).not.toContain("VIGA_DEGENERADA");
  });

  it("REF_AMBITO: carga sobre un elemento inexistente", () => {
    const m = modeloValido();
    m.cargas[0].ambito = "ELEMENTO_BORRADO";
    const errores = validarModelo(m);
    const e = errores.find((x) => x.codigo === "REF_AMBITO");
    expect(e).toBeDefined();
    expect(e!.elementoId).toBe("c1");
    expect(e!.elementoTipo).toBe("carga");
    sinJergaFEM(e!);
  });

  it("REF_HIPOTESIS: carga que apunta a una hipotesis inexistente", () => {
    const m = modeloValido();
    m.cargas[0].hipotesisId = "HIP_X";
    const errores = validarModelo(m);
    const e = errores.find((x) => x.codigo === "REF_HIPOTESIS");
    expect(e).toBeDefined();
    expect(e!.elementoId).toBe("c1");
    expect(e!.elementoTipo).toBe("carga");
    sinJergaFEM(e!);
  });

  it("SIN_SUJECION: ningun pilar con vinculacion exterior", () => {
    const m = modeloValido();
    m.pilares[0].vinculacionExterior = false;
    const errores = validarModelo(m);
    const e = errores.find((x) => x.codigo === "SIN_SUJECION");
    expect(e).toBeDefined();
    expect(e!.elementoTipo).toBe("modelo");
    sinJergaFEM(e!);
  });

  it("COMBO_SIN_CARGAS: hipotesis sin ninguna carga asociada", () => {
    const m = modeloValido();
    m.hipotesis.push({ id: "h2", nombre: "Nieve", tipo: "variable" });
    const errores = validarModelo(m);
    const e = errores.find((x) => x.codigo === "COMBO_SIN_CARGAS");
    expect(e).toBeDefined();
    expect(e!.elementoId).toBe("h2");
    expect(e!.elementoTipo).toBe("hipotesis");
    sinJergaFEM(e!);
  });

  it("FLOTANTE: punto de la obra que ninguna viga usa", () => {
    const m = modeloValido();
    m.nudos.push({ id: "n9", x: 99, y: 99 });
    const errores = validarModelo(m);
    const e = errores.find((x) => x.codigo === "FLOTANTE");
    expect(e).toBeDefined();
    expect(e!.elementoId).toBe("n9");
    expect(e!.elementoTipo).toBe("nudo");
    sinJergaFEM(e!);
  });

  it("VARIAS_VARIABLES: 2 hipotesis variables con cargas -> 1 aviso no bloqueante", () => {
    // Red para la via de import .json: la UI restringe a 1 variable, pero un proyecto
    // importado puede traer 2+. Se anaden dos variables, cada una con su carga.
    const m = modeloValido();
    m.hipotesis = [
      { id: "h1", nombre: "Peso propio", tipo: "permanente" },
      { id: "h2", nombre: "Sobrecarga", tipo: "variable" },
      { id: "h3", nombre: "Nieve", tipo: "variable" },
    ];
    m.cargas = [
      { id: "c1", tipo: "lineal", ambito: "v1", valor: -10, hipotesisId: "h1" },
      { id: "c2", tipo: "lineal", ambito: "v1", valor: -5, hipotesisId: "h2" },
      { id: "c3", tipo: "lineal", ambito: "v1", valor: -3, hipotesisId: "h3" },
    ];
    const avisos = validarModelo(m).filter((e) => e.codigo === "VARIAS_VARIABLES");
    expect(avisos).toHaveLength(1);
    expect(avisos[0].severidad).toBe("aviso"); // no bloquea: ok:true
    expect(avisos[0].elementoTipo).toBe("modelo");
    sinJergaFEM(avisos[0]);
  });

  it("VARIAS_VARIABLES: 1 sola hipotesis variable con cargas -> sin aviso", () => {
    const m = modeloValido();
    m.hipotesis = [
      { id: "h1", nombre: "Peso propio", tipo: "permanente" },
      { id: "h2", nombre: "Sobrecarga", tipo: "variable" },
    ];
    m.cargas = [
      { id: "c1", tipo: "lineal", ambito: "v1", valor: -10, hipotesisId: "h1" },
      { id: "c2", tipo: "lineal", ambito: "v1", valor: -5, hipotesisId: "h2" },
    ];
    expect(codigos(validarModelo(m))).not.toContain("VARIAS_VARIABLES");
  });

  it("VARIAS_VARIABLES: 2 variables pero una sin cargas -> sin aviso (solo cuentan las que suman esfuerzo)", () => {
    // Criterio documentado: una variable vacia no genera concomitancia real (ya la
    // avisa COMBO_SIN_CARGAS). Solo cuenta como variable la que tiene >=1 carga.
    const m = modeloValido();
    m.hipotesis = [
      { id: "h1", nombre: "Peso propio", tipo: "permanente" },
      { id: "h2", nombre: "Sobrecarga", tipo: "variable" },
      { id: "h3", nombre: "Nieve", tipo: "variable" }, // sin cargas
    ];
    m.cargas = [
      { id: "c1", tipo: "lineal", ambito: "v1", valor: -10, hipotesisId: "h1" },
      { id: "c2", tipo: "lineal", ambito: "v1", valor: -5, hipotesisId: "h2" },
    ];
    expect(codigos(validarModelo(m))).not.toContain("VARIAS_VARIABLES");
  });

  it("acumula varios errores independientes a la vez", () => {
    const m = modeloValido();
    m.pilares[0].materialId = "NO_EXISTE";
    m.pilares[0].vinculacionExterior = false;
    const cods = codigos(validarModelo(m));
    expect(cods).toContain("REF_MATERIAL");
    expect(cods).toContain("SIN_SUJECION");
  });
});
