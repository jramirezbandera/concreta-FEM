import { describe, it, expect } from "vitest";
import { validarModelo, type ErrorObra } from "./validaciones";
import { calcularAcoples } from "./acople";
import { ModeloSchema, type Modelo, crearModeloVacio } from "../dominio";
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
    hipotesis: [{ id: "h1", nombre: "Permanente", tipo: "permanente", automatica: false }],
    // incluirPesoPropio:false en la base: estos tests no siembran la automatica, y
    // con el flag activo dispararia E1 (FALTA_PESO_PROPIO). Los tests propios de E1
    // lo activan explicitamente.
    analisis: { tipo: "lineal", comprobarEstatica: true, incluirPesoPropio: false },
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
    m.hipotesis.push({ id: "h2", nombre: "Nieve", tipo: "variable", automatica: false });
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

  it("REF_SECCION: un perfil de catalogo referenciado DIRECTAMENTE por id es valido (como los materiales)", () => {
    const m = modeloValido();
    // Reproduce lo que produce el SelectSeccion al elegir un IPE/HEB: pilar y viga
    // referencian el id del perfil de catalogo ("IPE300"), y la obra puede no tener
    // esa seccion en modelo.secciones. No debe dar REF_SECCION (la UI ya lo da por
    // valido en validacionesPilar/Viga; el discretizador debe coincidir).
    m.secciones = [];
    m.pilares[0].seccionId = PERFIL_OK;
    m.vigas[0].seccionId = PERFIL_OK;
    const errores = validarModelo(m);
    expect(errores.filter((e) => e.codigo === "REF_SECCION")).toHaveLength(0);
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

  // [D22a] El mensaje NOMBRA el ámbito de la carga cuando resuelve a un elemento del
  // modelo ("la carga sobre la viga V1…"): la carga c1 apunta a la viga v1, que existe.
  it("REF_HIPOTESIS: el mensaje nombra el ámbito si resuelve (viga V1)", () => {
    const m = modeloValido();
    m.cargas[0].hipotesisId = "HIP_X";
    const e = validarModelo(m).find((x) => x.codigo === "REF_HIPOTESIS");
    expect(e).toBeDefined();
    expect(e!.mensaje).toContain('la viga "V1"');
    sinJergaFEM(e!);
  });

  // Si el ámbito NO resuelve (elemento borrado), el mensaje se queda genérico: nunca
  // inventa un nombre. Aquí la carga apunta a un ámbito inexistente y a una hipótesis
  // inexistente: REF_HIPOTESIS sale sin nombrar el ámbito.
  it("REF_HIPOTESIS: mensaje genérico si el ámbito no resuelve", () => {
    const m = modeloValido();
    m.cargas[0].ambito = "borrado-x";
    m.cargas[0].hipotesisId = "HIP_X";
    const e = validarModelo(m).find((x) => x.codigo === "REF_HIPOTESIS");
    expect(e).toBeDefined();
    expect(e!.mensaje).not.toContain(" sobre ");
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
    m.hipotesis.push({ id: "h2", nombre: "Nieve", tipo: "variable", automatica: false });
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

  // [D22a] FLOTANTE navegable: mensaje con la posición de obra + campo `posicion`
  // estructurado (coords de OBRA, no FEM) para que la UI pueda encuadrar/mostrarla.
  it("FLOTANTE: mensaje con la posición y campo posicion estructurado", () => {
    const m = modeloValido();
    m.nudos.push({ id: "n9", x: 4, y: 3 });
    const e = validarModelo(m).find((x) => x.codigo === "FLOTANTE");
    expect(e).toBeDefined();
    expect(e!.mensaje).toContain("(4.00, 3.00)");
    expect(e!.posicion).toEqual({ x: 4, y: 3 });
    sinJergaFEM(e!);
  });

  it("VARIAS_VARIABLES: 2 hipotesis variables con cargas -> 1 aviso no bloqueante", () => {
    // Red para la via de import .json: la UI restringe a 1 variable, pero un proyecto
    // importado puede traer 2+. Se anaden dos variables, cada una con su carga.
    const m = modeloValido();
    m.hipotesis = [
      { id: "h1", nombre: "Permanente", tipo: "permanente", automatica: false },
      { id: "h2", nombre: "Sobrecarga", tipo: "variable", automatica: false },
      { id: "h3", nombre: "Nieve", tipo: "variable", automatica: false },
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
      { id: "h1", nombre: "Permanente", tipo: "permanente", automatica: false },
      { id: "h2", nombre: "Sobrecarga", tipo: "variable", automatica: false },
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
      { id: "h1", nombre: "Permanente", tipo: "permanente", automatica: false },
      { id: "h2", nombre: "Sobrecarga", tipo: "variable", automatica: false },
      { id: "h3", nombre: "Nieve", tipo: "variable", automatica: false }, // sin cargas
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

  // --- Peso propio automatico (F2a, E1/E2/E3) ---------------------------------

  it("E1 FALTA_PESO_PROPIO: flag ON sin hip-peso-propio -> error bloqueante", () => {
    const m = modeloValido();
    m.analisis.incluirPesoPropio = true; // ON, pero la base NO siembra la automatica
    const e = validarModelo(m).find((x) => x.codigo === "FALTA_PESO_PROPIO");
    expect(e).toBeDefined();
    expect(e!.severidad).toBe("error");
    expect(e!.elementoTipo).toBe("modelo");
    sinJergaFEM(e!);
  });

  it("E1: flag ON CON hip-peso-propio sembrada -> sin error", () => {
    const m = modeloValido();
    m.analisis.incluirPesoPropio = true;
    m.hipotesis.push({
      id: "hip-peso-propio", nombre: "Peso propio", tipo: "permanente", automatica: true,
    });
    expect(codigos(validarModelo(m))).not.toContain("FALTA_PESO_PROPIO");
  });

  it("E1: flag OFF sin hip-peso-propio -> sin error (no se computa peso propio)", () => {
    const m = modeloValido();
    m.analisis.incluirPesoPropio = false;
    expect(codigos(validarModelo(m))).not.toContain("FALTA_PESO_PROPIO");
  });

  it("E2 CARGA_EN_AUTOMATICA: una carga asignada a hip-peso-propio -> error", () => {
    const m = modeloValido();
    m.hipotesis.push({
      id: "hip-peso-propio", nombre: "Peso propio", tipo: "permanente", automatica: true,
    });
    m.cargas.push({
      id: "cX", tipo: "lineal", ambito: "v1", valor: -3, hipotesisId: "hip-peso-propio",
    });
    const e = validarModelo(m).find((x) => x.codigo === "CARGA_EN_AUTOMATICA");
    expect(e).toBeDefined();
    expect(e!.severidad).toBe("error");
    expect(e!.elementoId).toBe("cX");
    // [D22a] El mensaje nombra el ámbito si resuelve (la carga cX apunta a la viga v1).
    expect(e!.mensaje).toContain('la viga "V1"');
    sinJergaFEM(e!);
  });

  it("E3: la hipotesis automatica SIN cargas no genera COMBO_SIN_CARGAS", () => {
    const m = modeloValido();
    m.hipotesis.push({
      id: "hip-peso-propio", nombre: "Peso propio", tipo: "permanente", automatica: true,
    });
    // No tiene cargas en modelo.cargas (las genera el discretizador): no debe avisarse.
    const avisoAuto = validarModelo(m).some(
      (x) => x.codigo === "COMBO_SIN_CARGAS" && x.elementoId === "hip-peso-propio",
    );
    expect(avisoAuto).toBe(false);
  });

  // --- Guardas EXCLUSIVAS del camino modal (F2b) ------------------------------
  // Solo corren cuando validarModelo recibe el contexto modal (2.º parametro). En el
  // calculo estatico NO deben aparecer nunca (no regresion).

  it("modal: el modelo valido base SIN contexto modal no genera guardas modales", () => {
    // Sanidad de no-regresion: sin el 2.º parametro, ninguna guarda modal corre.
    const cods = codigos(validarModelo(modeloValido()));
    expect(cods).not.toContain("MODAL_NUM_MODOS");
    expect(cods).not.toContain("MODAL_SIN_MASA");
  });

  it("modal: el modelo valido base CON contexto modal valido no genera guardas", () => {
    // El portico base tiene pilar+viga de acero (rho>0) y numModos>0: ambas guardas OK.
    const cods = codigos(validarModelo(modeloValido(), { numModos: 6 }));
    expect(cods).not.toContain("MODAL_NUM_MODOS");
    expect(cods).not.toContain("MODAL_SIN_MASA");
  });

  it("MODAL_NUM_MODOS: numModos 0 -> error bloqueante en lenguaje de obra", () => {
    const e = validarModelo(modeloValido(), { numModos: 0 }).find(
      (x) => x.codigo === "MODAL_NUM_MODOS",
    );
    expect(e).toBeDefined();
    expect(e!.severidad).toBe("error");
    expect(e!.elementoTipo).toBe("modelo");
    sinJergaFEM(e!);
  });

  it("MODAL_NUM_MODOS: numModos -1 (y no entero) -> error", () => {
    expect(
      codigos(validarModelo(modeloValido(), { numModos: -1 })),
    ).toContain("MODAL_NUM_MODOS");
    expect(
      codigos(validarModelo(modeloValido(), { numModos: 2.5 })),
    ).toContain("MODAL_NUM_MODOS");
  });

  it("MODAL_SIN_MASA: modelo sin pilares ni vigas -> error bloqueante", () => {
    // Sin elementos estructurales no hay masa que vibrar: el motor lanzaria 'massless';
    // esta red lo atrapa antes en lenguaje de obra.
    const m = modeloValido();
    m.pilares = [];
    m.vigas = [];
    m.cargas = []; // las cargas referenciaban v1 (ya borrada): se limpian para aislar
    const e = validarModelo(m, { numModos: 6 }).find((x) => x.codigo === "MODAL_SIN_MASA");
    expect(e).toBeDefined();
    expect(e!.severidad).toBe("error");
    expect(e!.elementoTipo).toBe("modelo");
    sinJergaFEM(e!);
  });

  it("MODAL_SIN_MASA: con al menos un pilar de material con peso -> sin error", () => {
    // El acero S275 del catalogo tiene peso>0: basta un pilar para tener masa.
    const cods = codigos(validarModelo(modeloValido(), { numModos: 6 }));
    expect(cods).not.toContain("MODAL_SIN_MASA");
  });

  // ============================================================================
  // [AUDITORIA M-1] IDS DUPLICADOS. El borde Zod no valida unicidad de ids y los
  // lookups del dominio son `.find()` (primer match): dos nudos con el mismo id y
  // posiciones DISTINTAS producian geometria silenciosamente erronea (la viga usa
  // el primero e ignora el segundo, ok:true). Un .json manipulado/corrupto no debe
  // poder calcular con geometria equivocada: BLOQUEA con ID_DUP.
  // ============================================================================
  describe("AUDITORIA M-1: ids duplicados bloquean", () => {
    it("dos nudos con el mismo id (posiciones distintas) -> error ID_DUP", () => {
      const m = modeloValido();
      m.nudos.push({ id: "n1", x: 99, y: 0 }); // colisiona con n1 en (0,0)
      const errores = validarModelo(m);
      const dup = errores.filter((e) => e.codigo === "ID_DUP");
      expect(dup.length).toBeGreaterThan(0);
      expect(dup[0].severidad).toBe("error");
      for (const e of dup) sinJergaFEM(e);
    });

    it("dos plantas con el mismo id -> error ID_DUP", () => {
      const m = modeloValido();
      m.plantas.push({ id: "p1", nombre: "Planta 1 bis", cota: 6, altura: 3, grupoId: "g1" });
      expect(codigos(validarModelo(m))).toContain("ID_DUP");
    });

    it("dos cargas con el mismo id -> error ID_DUP", () => {
      const m = modeloValido();
      m.cargas.push({ id: "c1", tipo: "lineal", ambito: "v1", valor: -5, hipotesisId: "h1" });
      expect(codigos(validarModelo(m))).toContain("ID_DUP");
    });
  });

  // ============================================================================
  // [AUDITORIA M-3] PILAR DEGENERADO (longitud 0). Un pilar con plantaInicial ===
  // plantaFinal (o dos plantas a la misma cota) no produce NINGUNA barra (el
  // troceo por cotas emite 0 tramos) pero SI emite su support de arranque: apoyo
  // fantasma sin barra que ademas cuenta como sujecion valida (haySujecionPilar).
  // Simetrico de VIGA_DEGENERADA: BLOQUEA con PILAR_DEGENERADO.
  // ============================================================================
  describe("AUDITORIA M-3: pilar degenerado (longitud 0) bloquea", () => {
    it("pilar con plantaInicial === plantaFinal -> error PILAR_DEGENERADO", () => {
      const m = modeloValido();
      m.pilares[0].plantaFinal = "p0"; // arranca y termina en cota 0: L=0
      const errores = validarModelo(m);
      const deg = errores.filter((e) => e.codigo === "PILAR_DEGENERADO");
      expect(deg.length).toBe(1);
      expect(deg[0].severidad).toBe("error");
      expect(deg[0].elementoId).toBe("pil1");
      sinJergaFEM(deg[0]);
    });

    it("pilar entre dos plantas DISTINTAS a la misma cota -> error PILAR_DEGENERADO", () => {
      const m = modeloValido();
      m.plantas.push({ id: "p0bis", nombre: "Cota cero bis", cota: 0, altura: 3, grupoId: "g1" });
      m.pilares[0].plantaFinal = "p0bis"; // p0(0) -> p0bis(0): L=0
      expect(codigos(validarModelo(m))).toContain("PILAR_DEGENERADO");
    });

    it("un pilar normal NO dispara PILAR_DEGENERADO", () => {
      expect(codigos(validarModelo(modeloValido()))).not.toContain("PILAR_DEGENERADO");
    });
  });

  // ============================================================================
  // [AUDITORIA M-5] LOSA con bordeApoyo="libre": en el corte 1 los paños son
  // AISLADOS (sin acople al portico), asi que una losa con todos los bordes
  // libres no tiene sujecion vertical POSIBLE: el motor siempre lanza inestable
  // (verificado con el motor real: PyNite _check_stability caza los GDL sin
  // rigidez), con un mensaje tecnico. Mejor bloquear ANTES en lenguaje de obra.
  // ============================================================================
  describe("AUDITORIA M-5: losa con borde libre (aislada) bloquea", () => {
    it("pano losa con bordeApoyo libre -> error PANO_SIN_APOYO", () => {
      const m = modeloValido();
      m.nudos.push(
        { id: "q1", x: 10, y: 10 },
        { id: "q2", x: 14, y: 10 },
        { id: "q3", x: 14, y: 13 },
        { id: "q4", x: 10, y: 13 },
      );
      m.panos.push({
        id: "pano1", nombre: "Losa", tipo: "losa", plantaId: "p1",
        perimetro: ["q1", "q2", "q3", "q4"],
        espesor: 0.2, materialId: "HA-25", tamMalla: 1, bordeApoyo: "libre",
      });
      const errores = validarModelo(m);
      const e = errores.filter((x) => x.codigo === "PANO_SIN_APOYO");
      expect(e.length).toBe(1);
      expect(e[0].severidad).toBe("error");
      expect(e[0].elementoId).toBe("pano1");
      sinJergaFEM(e[0]);
    });

    it("pano losa con borde simple/empotrado NO dispara PANO_SIN_APOYO", () => {
      const m = modeloValido();
      m.nudos.push(
        { id: "q1", x: 10, y: 10 },
        { id: "q2", x: 14, y: 10 },
        { id: "q3", x: 14, y: 13 },
        { id: "q4", x: 10, y: 13 },
      );
      m.panos.push({
        id: "pano1", nombre: "Losa", tipo: "losa", plantaId: "p1",
        perimetro: ["q1", "q2", "q3", "q4"],
        espesor: 0.2, materialId: "HA-25", tamMalla: 1, bordeApoyo: "simple",
      });
      expect(codigos(validarModelo(m))).not.toContain("PANO_SIN_APOYO");
    });
  });

  describe("AUDITORIA UX-VACIA: obra sin elementos bloquea el calculo", () => {
    it("obra vacia (sin pilares/vigas/panos) -> error OBRA_VACIA", () => {
      // El modelo vacio de partida (crearModeloVacio) trae hipotesis pero NINGUN elemento
      // estructural: calcular no tendria nada que resolver. Antes procedia en silencio
      // (validarSujecion hace early-return con obra vacia). Ahora se bloquea en lenguaje
      // de obra ANTES del motor.
      const e = validarModelo(crearModeloVacio()).find((x) => x.codigo === "OBRA_VACIA");
      expect(e).toBeDefined();
      expect(e!.severidad).toBe("error");
      expect(e!.elementoTipo).toBe("modelo");
      sinJergaFEM(e!);
    });

    it("obra con al menos un elemento NO dispara OBRA_VACIA", () => {
      // El modelo valido de base tiene pilar + viga: nunca es "obra vacia".
      expect(codigos(validarModelo(modeloValido()))).not.toContain("OBRA_VACIA");
    });

    it("obra con solo un pilar (sin vigas ni paños) NO dispara OBRA_VACIA", () => {
      const m = modeloValido();
      m.vigas = [];
      m.cargas = []; // la carga colgaba de la viga eliminada
      expect(codigos(validarModelo(m))).not.toContain("OBRA_VACIA");
    });
  });
});

// ============================================================================
// F3.2 · Validaciones del ACOPLE paño<->portico: relajacion de PANO_SIN_APOYO
// por borde COMPLETO [OV-2], avisos de acople parcial/insuficiente, errores de
// pilar/viga INTERIOR [OV-5/TODO-2], sujecion exacta respecto a lo emitido y
// equivalencia del parametro `acoples` [1A].
// ============================================================================
describe("F3.2 · validaciones del acople paño<->portico", () => {
  // Paño 5x3 sobre la viga v1 del fixture (n1(0,0)->n2(5,0), p1 cota 3): la arista
  // inferior queda ENTERA sobre v1. q3/q4 completan el rectangulo.
  function conPanoSobreViga(bordeApoyo: "libre" | "simple" | "empotrado"): Modelo {
    const m = modeloValido();
    m.nudos.push({ id: "q3", x: 5, y: 3 }, { id: "q4", x: 0, y: 3 });
    m.panos.push({
      id: "pano1", nombre: "Losa", tipo: "losa", plantaId: "p1",
      perimetro: ["n1", "n2", "q3", "q4"],
      espesor: 0.2, materialId: "HA-25", tamMalla: 1, bordeApoyo,
    });
    return m;
  }

  describe("PANO_SIN_APOYO relajado por borde completo [OV-2]", () => {
    it("losa LIBRE con un borde entero sobre una viga NO bloquea", () => {
      expect(codigos(validarModelo(conPanoSobreViga("libre")))).not.toContain(
        "PANO_SIN_APOYO",
      );
    });

    it("losa LIBRE tocando el portico solo en DOS ESQUINAS sueltas SI bloquea", () => {
      // Dos vigas cortas que cubren solo las esquinas (0,0) y (5,0): hay >=2 nudos
      // acoplados (acople activo) pero NINGUN borde completo -> dos puntos no son
      // un apoyo (la losa colgaria con flechas absurdas).
      const m = modeloValido();
      m.nudos.push(
        { id: "q3", x: 5, y: 3 },
        { id: "q4", x: 0, y: 3 },
        { id: "qa", x: 0.4, y: 0 },
        { id: "qb", x: 4.6, y: 0 },
      );
      m.vigas = [
        { ...m.vigas[0], id: "v-esq1", nudoI: "n1", nudoJ: "qa" }, // 0..0.4
        { ...m.vigas[0], id: "v-esq2", nudoI: "qb", nudoJ: "n2" }, // 4.6..5
      ];
      m.cargas = []; // la carga colgaba de v1
      m.panos.push({
        id: "pano1", nombre: "Losa", tipo: "losa", plantaId: "p1",
        perimetro: ["n1", "n2", "q3", "q4"],
        espesor: 0.2, materialId: "HA-25", tamMalla: 1, bordeApoyo: "libre",
      });
      const e = validarModelo(m).filter((x) => x.codigo === "PANO_SIN_APOYO");
      expect(e).toHaveLength(1);
      expect(e[0].severidad).toBe("error");
      sinJergaFEM(e[0]);
    });
  });

  describe("avisos del estado del acople [OV-2]", () => {
    it("acople PARCIAL con bordeApoyo elegido -> aviso PANO_BORDE_PARCIAL (no bloquea)", () => {
      // Solo la arista inferior sobre viga; el resto usa el apoyo simple.
      const e = validarModelo(conPanoSobreViga("simple")).filter(
        (x) => x.codigo === "PANO_BORDE_PARCIAL",
      );
      expect(e).toHaveLength(1);
      expect(e[0].severidad).toBe("aviso");
      expect(e[0].elementoId).toBe("pano1");
      sinJergaFEM(e[0]);
    });

    it("UN solo nudo tocando el portico -> aviso PANO_ACOPLE_INSUFICIENTE (degradado a aislado)", () => {
      const m = modeloValido();
      m.nudos.push(
        { id: "q3", x: 5, y: 3 },
        { id: "q4", x: 0, y: 3 },
        { id: "qa", x: 0.4, y: 0 },
      );
      // Una unica viga corta que cubre SOLO la esquina (0,0).
      m.vigas = [{ ...m.vigas[0], id: "v-esq", nudoI: "n1", nudoJ: "qa" }];
      m.cargas = [];
      m.panos.push({
        id: "pano1", nombre: "Losa", tipo: "losa", plantaId: "p1",
        perimetro: ["n1", "n2", "q3", "q4"],
        espesor: 0.2, materialId: "HA-25", tamMalla: 1, bordeApoyo: "simple",
      });
      const e = validarModelo(m).filter((x) => x.codigo === "PANO_ACOPLE_INSUFICIENTE");
      expect(e).toHaveLength(1);
      expect(e[0].severidad).toBe("aviso");
      sinJergaFEM(e[0]);
    });

    it("acople TOTAL (contorno completo) no emite avisos de borde", () => {
      // Contorno completo de vigas alrededor del paño.
      const m = conPanoSobreViga("simple");
      m.vigas.push(
        { ...m.vigas[0], id: "v-der", nudoI: "n2", nudoJ: "q3" },
        { ...m.vigas[0], id: "v-sup", nudoI: "q3", nudoJ: "q4" },
        { ...m.vigas[0], id: "v-izq", nudoI: "q4", nudoJ: "n1" },
      );
      const cods = codigos(validarModelo(m));
      expect(cods).not.toContain("PANO_BORDE_PARCIAL");
      expect(cods).not.toContain("PANO_ACOPLE_INSUFICIENTE");
    });
  });

  describe("elementos INTERIORES bajo la losa [OV-5 + TODO-2 + F2.0 losa plana]", () => {
    // Paño LIBRE cuadrado 5x5 SIN vigas: el unico apoyo posible viene de los pilares
    // interiores que se le pongan. bordeApoyo "simple" (apoyos de borde propios) evita
    // que PANO_SIN_APOYO enturbie los asserts: aisla el efecto de los pilares interiores.
    function panoAisladoSobrePilares(): Modelo {
      const m = modeloValido();
      m.vigas = []; // sin portico: la losa se apoya SOLO en los pilares que se acoplen
      m.cargas = []; // la carga colgaba de v1
      m.nudos.push(
        { id: "s1", x: 0, y: 0 }, { id: "s2", x: 5, y: 0 },
        { id: "s3", x: 5, y: 5 }, { id: "s4", x: 0, y: 5 },
      );
      m.panos.push({
        id: "pano1", nombre: "Losa", tipo: "losa", plantaId: "p1",
        perimetro: ["s1", "s2", "s3", "s4"],
        espesor: 0.2, materialId: "HA-25", tamMalla: 1, bordeApoyo: "simple",
      });
      return m;
    }
    function pilarInterior(id: string, nombre: string, x: number, y: number): Modelo["pilares"][number] {
      return {
        id, nombre, x, y, plantaInicial: "p0", plantaFinal: "p1",
        seccionId: SECCION_OK, materialId: MATERIAL_OK, angulo: 0,
        vinculacionExterior: true, arranque: "empotrado",
      };
    }

    it("[F2.0] losa sobre >=2 pilares interiores acoplados -> NO bloquea (la recoge la losa plana)", () => {
      const m = panoAisladoSobrePilares();
      m.pilares.push(
        pilarInterior("pia", "PA", 1.5, 2.5),
        pilarInterior("pib", "PB", 3.5, 2.5),
      );
      const cods = codigos(validarModelo(m));
      expect(cods).not.toContain("PANO_PILAR_INTERIOR"); // ambos acoplados = apoyo legitimo
      expect(cods).not.toContain("PANO_PILARES_JUNTOS");
    });

    it("[F2.0] pilar interior bajo un paño YA acoplado por vigas -> recogido (no bloquea)", () => {
      // conPanoSobreViga("simple") ya esta acopleActivo por su borde inferior sobre v1;
      // un pilar interior cae en un nudo de malla que la losa plana remapea a su N*.
      const m = conPanoSobreViga("simple");
      m.pilares.push(pilarInterior("pil-int", "P9", 2.5, 1.5));
      expect(codigos(validarModelo(m))).not.toContain("PANO_PILAR_INTERIOR");
    });

    it("[DP1] losa sobre UN solo pilar interior -> SI bloquea con PANO_PILAR_INTERIOR (>=2 apoyos)", () => {
      const m = panoAisladoSobrePilares();
      m.pilares.push(pilarInterior("pil-int", "P9", 2.5, 2.5));
      const e = validarModelo(m).filter((x) => x.codigo === "PANO_PILAR_INTERIOR");
      expect(e).toHaveLength(1);
      expect(e[0].severidad).toBe("error");
      expect(e[0].elementoId).toBe("pil-int");
      expect(e[0].posicion).toEqual({ x: 2.5, y: 2.5 });
      // Mensaje nuevo (ya no "en una fase posterior"): guia a añadir un segundo apoyo.
      expect(e[0].mensaje).toContain("al menos dos pilares");
      sinJergaFEM(e[0]);
    });

    it("[F2.0] dos pilares en la MISMA celda -> PANO_PILARES_JUNTOS (nombra los 2), sin PANO_PILAR_INTERIOR por ellos", () => {
      const m = panoAisladoSobrePilares();
      // Mismo punto (2.5,2.5): caen en la misma celda 2D de la malla (junta).
      m.pilares.push(
        pilarInterior("pja", "PJ-A", 2.5, 2.5),
        pilarInterior("pjb", "PJ-B", 2.5, 2.5),
      );
      const errores = validarModelo(m);
      const juntos = errores.filter((x) => x.codigo === "PANO_PILARES_JUNTOS");
      expect(juntos).toHaveLength(1);
      expect(juntos[0].severidad).toBe("error");
      expect(juntos[0].elementoTipo).toBe("pilar");
      expect(juntos[0].mensaje).toContain("PJ-A");
      expect(juntos[0].mensaje).toContain("PJ-B");
      expect(juntos[0].mensaje).toContain("Losa"); // nombre del paño
      sinJergaFEM(juntos[0]);
      // Esos pilares NO reciben ademas PANO_PILAR_INTERIOR (lo explica PANO_PILARES_JUNTOS).
      const interior = errores.filter((x) => x.codigo === "PANO_PILAR_INTERIOR");
      expect(interior.map((x) => x.elementoId)).not.toContain("pja");
      expect(interior.map((x) => x.elementoId)).not.toContain("pjb");
    });

    it("[F2.0/RESERVA-3] paño con demasiados pilares (cap) -> PANO_DEMASIADOS_PILARES una vez, sin PANO_PILAR_INTERIOR", () => {
      // Cap = la rejilla MINIMA de bordes + lineas de control ya supera CAP_QUADS (2000):
      // (nX+1)*(nY+1) > 2000. 45 pilares en diagonal con coords DISTINTAS dan 45 lineas de
      // control X + 45 Y -> (45+1)*(45+1)=2116 celdas minimas -> mallarPano falla ->
      // el paño cae en erroresMallado (fuera de porPano, XOR).
      const m = panoAisladoSobrePilares();
      for (let i = 1; i <= 45; i++) {
        const c = (i * 5) / 46; // en (0,5), estrictamente interior, todas distintas
        m.pilares.push(pilarInterior(`pc${i}`, `PC${i}`, c, c));
      }
      const errores = validarModelo(m);
      const cap = errores.filter((x) => x.codigo === "PANO_DEMASIADOS_PILARES");
      expect(cap).toHaveLength(1); // una sola vez por paño
      expect(cap[0].severidad).toBe("error");
      expect(cap[0].elementoTipo).toBe("pano");
      expect(cap[0].elementoId).toBe("pano1");
      sinJergaFEM(cap[0]);
      // Bajo cap NO se superpone PANO_PILAR_INTERIOR por cada pilar (RESERVA-3).
      expect(codigos(errores)).not.toContain("PANO_PILAR_INTERIOR");
    });

    it("[FIX3 · Codex #5] paño capado + par de pilares en la misma celda -> SOLO PANO_DEMASIADOS_PILARES, sin PANO_PILARES_JUNTOS", () => {
      // El cap (PANO_DEMASIADOS_PILARES) manda: aunque `acople.ts` detecte un par junto
      // (la deteccion corre ANTES de mallar), validarPilaresJuntos DEBE saltar el paño
      // capado. Sin el fix, el paño recibiria ademas PANO_PILARES_JUNTOS (doble error).
      const m = panoAisladoSobrePilares();
      // 45 pilares en diagonal con coords distintas -> supera CAP_QUADS (mismo patron
      // que el test RESERVA-3): el paño cae en erroresMallado.
      for (let i = 1; i <= 45; i++) {
        const c = (i * 5) / 46; // en (0,5), estrictamente interior, todas distintas
        m.pilares.push(pilarInterior(`pc${i}`, `PC${i}`, c, c));
      }
      // Un pilar EXTRA en la MISMA celda 2D que pc1 -> par junto (a < TOL de su cabeza).
      const cPar = (1 * 5) / 46;
      m.pilares.push(pilarInterior("pdup", "PDUP", cPar + 0.0004, cPar));
      const errores = validarModelo(m);
      const cods = codigos(errores);
      // El cap se emite (una vez); PANO_PILARES_JUNTOS NO (el cap manda).
      expect(cods.filter((c) => c === "PANO_DEMASIADOS_PILARES")).toHaveLength(1);
      expect(cods).not.toContain("PANO_PILARES_JUNTOS");
      expect(cods).not.toContain("PANO_PILAR_INTERIOR");
    });

    it("viga que cruza el paño por dentro -> error PANO_VIGA_INTERIOR; el contorno no dispara", () => {
      const m = conPanoSobreViga("simple");
      m.nudos.push({ id: "qm1", x: 0, y: 1.5 }, { id: "qm2", x: 5, y: 1.5 });
      m.vigas.push({ ...m.vigas[0], id: "v-mid", nudoI: "qm1", nudoJ: "qm2" });
      const e = validarModelo(m).filter((x) => x.codigo === "PANO_VIGA_INTERIOR");
      expect(e).toHaveLength(1);
      expect(e[0].severidad).toBe("error");
      expect(e[0].elementoId).toBe("v-mid"); // la culpable es la embrochalada, no v1
      sinJergaFEM(e[0]);
    });

    it("pilar en la ESQUINA o en el borde del paño no es interior (no bloquea)", () => {
      const m = conPanoSobreViga("simple"); // pil1 del fixture esta en (0,0) = esquina
      expect(codigos(validarModelo(m))).not.toContain("PANO_PILAR_INTERIOR");
    });
  });

  describe("sujecion de losa plana sobre pilares [F2.0/DP2]", () => {
    it("losa sobre >=2 pilares con arranque -> NO emite SIN_SUJECION", () => {
      const m = modeloValido();
      m.vigas = [];
      m.cargas = [];
      m.nudos.push(
        { id: "s1", x: 0, y: 0 }, { id: "s2", x: 5, y: 0 },
        { id: "s3", x: 5, y: 5 }, { id: "s4", x: 0, y: 5 },
      );
      m.panos.push({
        id: "pano1", nombre: "Losa", tipo: "losa", plantaId: "p1",
        perimetro: ["s1", "s2", "s3", "s4"],
        espesor: 0.2, materialId: "HA-25", tamMalla: 1, bordeApoyo: "libre",
      });
      // Solo pilares interiores con arranque (vinculacionExterior): su arranque sujeta.
      m.pilares = [
        {
          id: "pia", nombre: "PA", x: 1.5, y: 2.5, plantaInicial: "p0", plantaFinal: "p1",
          seccionId: SECCION_OK, materialId: MATERIAL_OK, angulo: 0,
          vinculacionExterior: true, arranque: "empotrado",
        },
        {
          id: "pib", nombre: "PB", x: 3.5, y: 2.5, plantaInicial: "p0", plantaFinal: "p1",
          seccionId: SECCION_OK, materialId: MATERIAL_OK, angulo: 0,
          vinculacionExterior: true, arranque: "empotrado",
        },
      ];
      const cods = codigos(validarModelo(m));
      expect(cods).not.toContain("SIN_SUJECION"); // el arranque de los pilares sujeta
      expect(cods).not.toContain("PANO_PILAR_INTERIOR"); // ambos acoplados a la losa plana
    });

    // [FIX FIX1 · gemelo de RESERVA-4] Una losa `bordeApoyo:"simple"` (emite apoyos de
    // borde propios) con MUCHOS pilares interiores acoplados y SIN pilar con
    // vinculacionExterior: sus apoyos de borde la sujetan, pero el conteo de sujecion
    // NO debe usar `nodosAcoplados.size` (que incluye las cabezas de pilar interiores y
    // supera el nº de nudos de borde) sino `nodosBordeAcoplados`. Con size>=nodosBorde
    // el bug emitia un FALSO SIN_SUJECION que BLOQUEABA una losa valida. FALLA antes del
    // fix (SIN_SUJECION presente), PASA despues (ausente).
    it("[FIX1] losa bordeApoyo simple con muchos pilares interiores y sin arranque -> NO da falso SIN_SUJECION", () => {
      const m = modeloValido();
      m.vigas = []; // sin portico: la sujecion viene de los apoyos de BORDE del paño
      m.cargas = []; // la carga colgaba de v1
      m.nudos.push(
        { id: "s1", x: 0, y: 0 }, { id: "s2", x: 5, y: 0 },
        { id: "s3", x: 5, y: 5 }, { id: "s4", x: 0, y: 5 },
      );
      m.panos.push({
        id: "pano1", nombre: "Losa", tipo: "losa", plantaId: "p1",
        perimetro: ["s1", "s2", "s3", "s4"],
        espesor: 0.2, materialId: "HA-25", tamMalla: 1, bordeApoyo: "simple",
      });
      // Rejilla 5x5 = 25 pilares interiores acoplados (sin vinculacionExterior): sus 25
      // cabezas inflan nodosAcoplados.size a 25 > 24 nudos de borde (con el bug: no
      // quedaria "apoyo propio" -> falso SIN_SUJECION). Todos acoplados => sin
      // PANO_PILAR_INTERIOR; bordeApoyo simple => sin PANO_SIN_APOYO.
      let idx = 0;
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
          const x = 0.5 + i; // 0.5 .. 4.5, estrictamente interior
          const y = 0.5 + j;
          m.pilares.push({
            id: `pi${String(idx).padStart(2, "0")}`, nombre: `PI${idx}`, x, y,
            plantaInicial: "p0", plantaFinal: "p1",
            seccionId: SECCION_OK, materialId: MATERIAL_OK, angulo: 0,
            vinculacionExterior: false, arranque: "empotrado", // NINGUNO ancla al terreno
          });
          idx++;
        }
      }
      const cods = codigos(validarModelo(m));
      expect(cods).not.toContain("SIN_SUJECION"); // los apoyos de borde del paño sujetan
      expect(cods).not.toContain("PANO_PILAR_INTERIOR"); // los 25 acoplados: apoyos legitimos
    });
  });

  // ============================================================================
  // [F2.3/T-f3-losa-plana] PANO_SIN_APOYO relajado por sujecion AUTONOMA de pilares.
  // Una losa "libre" sin ninguna viga de contorno (bordesCompletos=0) es la tipologia
  // estrella "forjado plano sobre pilares". F2.2 relajo PANO_PILAR_INTERIOR (los
  // pilares acoplados son apoyos legitimos) pero olvido aplicar el mismo criterio a
  // PANO_SIN_APOYO: HOY abortaba. Y hay un matiz de CORRECTNESS: una placa de bordes
  // libres necesita >=3 apoyos NO colineales (con 2 -siempre colineales- bascula y el
  // motor devuelve basura silenciosa bajo sparse). Criterio: >=3 pilares no alineados.
  // ============================================================================
  describe("PANO_SIN_APOYO relajado por >=3 pilares no colineales [F2.3]", () => {
    // Losa 5x5 "libre" SIN vigas (bordesCompletos=0): la sujeta SOLO lo que se le
    // acople por dentro. `interiores` = coords (x,y) de pilares interiores estrictos.
    function losaLibreSobrePilares(interiores: Array<[number, number]>): Modelo {
      const m = modeloValido();
      m.vigas = [];
      m.cargas = [];
      m.nudos.push(
        { id: "s1", x: 0, y: 0 }, { id: "s2", x: 5, y: 0 },
        { id: "s3", x: 5, y: 5 }, { id: "s4", x: 0, y: 5 },
      );
      m.panos.push({
        id: "pano1", nombre: "Losa", tipo: "losa", plantaId: "p1",
        perimetro: ["s1", "s2", "s3", "s4"],
        espesor: 0.2, materialId: "HA-25", tamMalla: 1, bordeApoyo: "libre",
      });
      m.pilares = interiores.map(([x, y], k) => ({
        id: `pi${k}`, nombre: `PI${k}`, x, y, plantaInicial: "p0", plantaFinal: "p1",
        seccionId: SECCION_OK, materialId: MATERIAL_OK, angulo: 0,
        vinculacionExterior: true, arranque: "empotrado",
      }));
      return m;
    }

    it("losa libre sobre >=3 pilares NO colineales -> NO bloquea (apoyo autonomo)", () => {
      const m = losaLibreSobrePilares([[1, 1], [4, 1], [2.5, 4]]); // triangulo
      const cods = codigos(validarModelo(m));
      expect(cods).not.toContain("PANO_SIN_APOYO");
      expect(cods).not.toContain("PANO_PILARES_INSUFICIENTES");
      expect(cods).not.toContain("PANO_PILAR_INTERIOR"); // los 3 acoplados
      expect(cods).not.toContain("SIN_SUJECION"); // sus arranques sujetan
    });

    it("losa libre sobre 2 pilares (colineales por definicion) -> PANO_PILARES_INSUFICIENTES", () => {
      const m = losaLibreSobrePilares([[1.5, 2.5], [3.5, 2.5]]);
      const e = validarModelo(m).filter((x) => x.codigo === "PANO_PILARES_INSUFICIENTES");
      expect(e).toHaveLength(1);
      expect(e[0].severidad).toBe("error");
      expect(e[0].elementoId).toBe("pano1");
      expect(e[0].elementoTipo).toBe("pano");
      sinJergaFEM(e[0]);
      // Los 2 pilares estan acoplados: NO se superpone PANO_PILAR_INTERIOR (sin contradiccion).
      expect(codigos(validarModelo(m))).not.toContain("PANO_PILAR_INTERIOR");
      // Y ya no cae el mensaje generico de "todos los bordes libres".
      expect(codigos(validarModelo(m))).not.toContain("PANO_SIN_APOYO");
    });

    it("losa libre sobre 3 pilares ALINEADOS -> PANO_PILARES_INSUFICIENTES (siguen basculando)", () => {
      const m = losaLibreSobrePilares([[1, 2.5], [2.5, 2.5], [4, 2.5]]); // los 3 en y=2.5
      const cods = codigos(validarModelo(m));
      expect(cods).toContain("PANO_PILARES_INSUFICIENTES");
      expect(cods).not.toContain("PANO_SIN_APOYO");
    });

    it("losa libre sin NINGUN pilar interior -> PANO_SIN_APOYO (mensaje generico)", () => {
      const m = losaLibreSobrePilares([]);
      const e = validarModelo(m).filter((x) => x.codigo === "PANO_SIN_APOYO");
      expect(e).toHaveLength(1);
      expect(e[0].severidad).toBe("error");
      expect(e[0].mensaje).toContain("todos los bordes libres");
      sinJergaFEM(e[0]);
      // No hay pilares: no aplica PANO_PILARES_INSUFICIENTES.
      expect(codigos(validarModelo(m))).not.toContain("PANO_PILARES_INSUFICIENTES");
    });

    it("[DP1] losa libre sobre 1 solo pilar -> PANO_PILAR_INTERIOR, sin PANO_SIN_APOYO (un solo mensaje)", () => {
      // 1 pilar: acopleActivo=false -> NO acoplado -> lo explica PANO_PILAR_INTERIOR (DP1).
      // No se emite ADEMAS PANO_SIN_APOYO (evita el doble reporte contradictorio).
      const m = losaLibreSobrePilares([[2.5, 2.5]]);
      const cods = codigos(validarModelo(m));
      expect(cods).toContain("PANO_PILAR_INTERIOR");
      expect(cods).not.toContain("PANO_SIN_APOYO");
      expect(cods).not.toContain("PANO_PILARES_INSUFICIENTES");
    });

    it("regresion: la relajacion por borde completo sobre viga sigue intacta (sin pilares)", () => {
      // Una losa libre con un borde entero sobre una viga NO bloquea (comportamiento OV-2),
      // aunque no tenga pilares interiores: la via del portico es independiente de la nueva.
      expect(codigos(validarModelo(conPanoSobreViga("libre")))).not.toContain(
        "PANO_SIN_APOYO",
      );
      expect(codigos(validarModelo(conPanoSobreViga("libre")))).not.toContain(
        "PANO_PILARES_INSUFICIENTES",
      );
    });
  });

  describe("sujecion exacta respecto a lo que emite el discretizador", () => {
    it("paño TOTALMENTE acoplado sin ningun pilar vinculado -> SIN_SUJECION", () => {
      // Contorno completo (el paño descarga en el portico, no emite apoyos propios)
      // pero el portico entero flota: nadie lo ancla al terreno.
      const m = conPanoSobreViga("simple");
      m.vigas.push(
        { ...m.vigas[0], id: "v-der", nudoI: "n2", nudoJ: "q3" },
        { ...m.vigas[0], id: "v-sup", nudoI: "q3", nudoJ: "q4" },
        { ...m.vigas[0], id: "v-izq", nudoI: "q4", nudoJ: "n1" },
      );
      m.pilares = m.pilares.map((p) => ({ ...p, vinculacionExterior: false }));
      expect(codigos(validarModelo(m))).toContain("SIN_SUJECION");
    });

    it("paño PARCIALMENTE acoplado con bordeApoyo simple sigue contando como sujecion", () => {
      // Emite apoyos propios en los nudos sin viga: sujeta (comportamiento corte 1).
      const m = conPanoSobreViga("simple");
      m.pilares = m.pilares.map((p) => ({ ...p, vinculacionExterior: false }));
      expect(codigos(validarModelo(m))).not.toContain("SIN_SUJECION");
    });
  });

  describe("[1A] el parametro `acoples` es equivalente al fallback interno", () => {
    it("validarModelo(m) === validarModelo(m, undefined, calcularAcoples(m))", () => {
      const m = conPanoSobreViga("simple");
      m.pilares.push({
        id: "pil-int", nombre: "P9", x: 2.5, y: 1.5,
        plantaInicial: "p0", plantaFinal: "p1",
        seccionId: SECCION_OK, materialId: MATERIAL_OK, angulo: 0,
        vinculacionExterior: true, arranque: "empotrado",
      });
      const sinParametro = validarModelo(m);
      const conParametro = validarModelo(m, undefined, calcularAcoples(m));
      expect(conParametro).toEqual(sinParametro);
    });
  });

  describe("cargas de grupo (D-1): red del borde y expectativas", () => {
    it("[GAP-C] valor NEGATIVO en el grupo con paños -> aviso GRUPO_VALOR_NEGATIVO (no se aplica en silencio)", () => {
      const m = conPanoSobreViga("simple");
      m.grupos = [{ ...m.grupos[0], cargasMuertas: -1 }];
      const e = validarModelo(m).filter((x) => x.codigo === "GRUPO_VALOR_NEGATIVO");
      expect(e).toHaveLength(1);
      expect(e[0].severidad).toBe("aviso");
      expect(e[0].mensaje).toContain(m.grupos[0].nombre);
      sinJergaFEM(e[0]);
    });

    it("valor negativo SIN paños que lo reciban -> sin aviso (el dato es inerte)", () => {
      const m = modeloValido();
      m.grupos = [{ ...m.grupos[0], sobrecargaUso: -2 }];
      expect(codigos(validarModelo(m))).not.toContain("GRUPO_VALOR_NEGATIVO");
    });

    it("[OV-1] paño con carga superficial MANUAL + cargas de grupo -> aviso de posible duplicidad", () => {
      const m = conPanoSobreViga("simple"); // grupo del fixture: qk=2, CM=1 (>0)
      m.cargas.push({ id: "c9", tipo: "superficial", ambito: "pano1", valor: 2, hipotesisId: "h1" });
      const e = validarModelo(m).filter((x) => x.codigo === "GRUPO_Y_SUPERFICIAL");
      expect(e).toHaveLength(1);
      expect(e[0].severidad).toBe("aviso");
      expect(e[0].elementoId).toBe("pano1");
      sinJergaFEM(e[0]);
    });

    it("[OV-1] sin carga manual (solo grupo) o grupo a cero -> sin aviso de duplicidad", () => {
      // Solo grupo: sin duplicidad posible.
      expect(codigos(validarModelo(conPanoSobreViga("simple")))).not.toContain(
        "GRUPO_Y_SUPERFICIAL",
      );
      // Grupo a cero + carga manual: tampoco (no hay carga automatica que duplicar).
      const m = conPanoSobreViga("simple");
      m.grupos = [{ ...m.grupos[0], sobrecargaUso: 0, cargasMuertas: 0 }];
      m.cargas.push({ id: "c9", tipo: "superficial", ambito: "pano1", valor: 2, hipotesisId: "h1" });
      expect(codigos(validarModelo(m))).not.toContain("GRUPO_Y_SUPERFICIAL");
    });

    it("hipotesis con id RESERVADO (case sintetico) -> error ID_RESERVADO (red tras el saneo de import)", () => {
      const m = modeloValido();
      m.hipotesis.push({
        id: "auto-grupo-cm", nombre: "Intrusa", tipo: "permanente", automatica: false,
      });
      const e = validarModelo(m).filter((x) => x.codigo === "ID_RESERVADO");
      expect(e).toHaveLength(1);
      expect(e[0].severidad).toBe("error");
      expect(e[0].elementoId).toBe("auto-grupo-cm");
      sinJergaFEM(e[0]);
    });
  });
});
