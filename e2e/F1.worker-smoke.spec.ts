import { test, expect, type Page, type Locator } from "@playwright/test";
import { abrirApp, bridge } from "./fixtures";

// =============================================================================
// F1.worker-smoke.spec.ts — HUMO DE INTEGRACION del worker real (feature-16, T1.4,
// decision D9). Proyecto `e2e-real` (playwright.config.ts: testMatch de este
// fichero, timeout amplio). Se dispara con `npm run e2e:real` (E2E_REAL=1).
//
// QUE COMPRUEBA (y que NO): arranca Pyodide + PyNiteFEA DE VERDAD en Chromium
// (servidos de public/pyodide/, sin red), modela una biapoyada simple por la
// costura `window.__concreta`, pulsa Calcular POR EL BOTON y verifica que el motor
// real resuelve y que la salida llega a la UI con sentido fisico:
//   - hay resultados (pestana Resultados activa + tabla de reacciones con filas);
//   - EQUILIBRIO: ΣFY (suma de reacciones verticales) ≈ carga total aplicada
//     (q · L) en la combinacion ELS (factor 1.0), con signo correcto y tolerancia
//     holgada (~2 %);
//   - al menos una reaccion vertical es FINITA y NO trivial (≠ 0, no NaN).
//
// Lo que NO asevera (D9): NADA de qL²/8, flecha 5qL⁴/384EI ni valores exactos de
// esfuerzo. Esa validacion NUMERICA la cubren los golden de Node con PyNite real
// (tests/golden/pipeline.golden.test.ts). Aqui solo se valida el CABLEADO del
// worker en el navegador y el equilibrio global, que es barato y robusto frente a
// los detalles de modelado.
//
// POR QUE SIN MOCK: `abrirApp(page, { mock: false })` NO instala el doble del
// solver; la costura window.__concreta sigue montada (VITE_E2E) para colocar la
// obra, pero `usePrecargaMotor` arranca Pyodide+PyNite reales. De ahi el timeout
// generoso del paso de Calcular (la primera instanciacion de WASM tarda varios
// segundos; memoria feature-5: ~4-9 s de arranque, decenas de MB cacheables).
// =============================================================================

// Geometria de la biapoyada (planta): viga de luz L entre (0,0) y (L,0) en la
// planta superior; dos pilares de apoyo bajo cada extremo suben de la planta base
// (cota 0) a la superior (cota 3). Carga lineal gravitatoria q sobre la viga.
const L = 5; // luz de la viga, m
const Q = 10; // carga lineal, kN/m (hipotesis permanente "Cargas muertas")
const HIPOTESIS_PERMANENTE = "hip-cargas-muertas"; // existe en el modelo vacio

// Carga total vertical de la biapoyada en la combinacion ELS (factores 1.0): q·L.
// El equilibrio exige ΣFY ≈ +CARGA_TOTAL_ELS (reacciones hacia arriba compensan la
// carga gravitatoria hacia abajo). Se compara en ELS para NO acoplar el humo a los
// coeficientes parciales del CTE (ELU mayoraria por 1.35).
const CARGA_TOTAL_ELS = Q * L; // 50 kN

// Tolerancia HOLGADA del equilibrio (D9): es un humo, no una validacion numerica.
// 2 % cubre de sobra el redondeo de presentacion (2 decimales) y el peso propio
// (no se activa en F1; analisis lineal sin self-weight).
const TOL_REL = 0.02;

// Timeout del arranque + resolucion del motor real. La primera carga de Pyodide
// (instanciacion WASM + numpy/scipy + micropip de PyNite) domina; se da margen
// amplio. El timeout del test completo lo fija playwright.config.ts (proyecto
// e2e-real).
const TIMEOUT_MOTOR = 90_000;

// Crea grupo + dos plantas (cota 0 y cota 3) por el DIALOGO REAL. No se editan
// campos: los defaults del dialogo ya producen la geometria buscada — "Nueva
// planta" sugiere cota 0 la primera vez y cota (max+altura)=3 la segunda (ver
// DialogoGruposYPlantas.nuevaPlanta). Asi el humo no depende de teclear cotas en
// inputs con commit-en-blur (fragil), solo de tres clics de boton.
async function crearGrupoYPlantas(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Gestionar plantas y grupos…" }).click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toBeVisible();

  await dialogo.getByRole("button", { name: "Nuevo grupo" }).click();
  // Dos plantas: la 1ª nace en cota 0 (base), la 2ª en cota 3 (superior).
  await dialogo.getByRole("button", { name: "Nueva planta" }).click();
  await dialogo.getByRole("button", { name: "Nueva planta" }).click();

  // "Cerrar" casa dos botones (el × del dialogo con aria-label="Cerrar" y el ghost
  // del pie); se elige el del pie por texto exacto (el icono × tiene aria-label, no
  // texto, asi que getByText lo descarta).
  await dialogo.getByRole("button").filter({ hasText: /^Cerrar$/ }).click();
  await expect(dialogo).toBeHidden();
}

test("humo de integracion: el worker real (Pyodide+PyNite) resuelve una biapoyada y la UI muestra ΣFY en equilibrio", async ({
  page,
}) => {
  test.skip(
    !process.env.E2E_REAL,
    "humo de motor real (arranca Pyodide+PyNite en el navegador); correr con E2E_REAL=1",
  );

  // 1) Abrir la app SIN mock: el solver real arrancara en segundo plano.
  await abrirApp(page, { mock: false });

  // 2) Construir la biapoyada.
  //    2a) Grupo + dos plantas por el dialogo real (cota 0 y cota 3).
  await crearGrupoYPlantas(page);

  //    2b) Pilares de apoyo + viga + carga lineal por la costura. Los ids de planta
  //    se leen de estadoObra() en orden de creacion: [0]=base (cota 0), [1]=superior
  //    (cota 3). Todo dentro de un unico page.evaluate para no ir y venir.
  const c = await bridge(page);
  const info = await c.evaluate(
    (
      api,
      { L, q, hip },
    ): { plantaBase: string; plantaSup: string; vigaId: string; cargaId: string } => {
      const obra = api.estadoObra();
      const plantaBase = obra.plantas[0]!.id; // cota 0
      const plantaSup = obra.plantas[1]!.id; // cota 3
      // Dos pilares de apoyo (base empotrada por defecto en la costura): suben de la
      // planta base a la superior bajo cada extremo de la viga.
      api.crearPilar({ x: 0, y: 0, plantaInicial: plantaBase, plantaFinal: plantaSup });
      api.crearPilar({ x: L, y: 0, plantaInicial: plantaBase, plantaFinal: plantaSup });
      // Viga en la planta superior entre los dos extremos. La costura reusa los nudos
      // de cabeza de pilar por snapping (mismo x,y) -> la viga comparte nudo con cada
      // pilar y nace la biapoyada.
      const vigaId = api.crearViga({ plantaId: plantaSup, xi: 0, yi: 0, xj: L, yj: 0 });
      // Carga lineal gravitatoria q sobre la viga, hipotesis permanente.
      const cargaId = api.anadirCargaLineal({ elementoId: vigaId, valor: q, hipotesisId: hip });
      return { plantaBase, plantaSup, vigaId, cargaId };
    },
    { L, q: Q, hip: HIPOTESIS_PERMANENTE },
  );

  // Sanidad de la obra construida (sin tocar el motor): 2 pilares, 1 viga, 1 carga.
  const resumen = await c.evaluate((api) => api.resumenModelo());
  expect(resumen, "la obra debe tener 2 pilares, 1 viga y 1 carga").toMatchObject({
    pilares: 2,
    vigas: 1,
    cargas: 1,
  });
  expect(info.vigaId).toBeTruthy();

  // 3) Ir a Resultados y Calcular POR EL BOTON (por claridad y aislamiento; tras
  //    feature-17 el menu tambien alimenta el calculoStore, pero aqui leemos el
  //    estado por el panel de Resultados). El motor real puede estar aun
  //    "Cargando motor…": se espera a que el boton quede habilitado ("Calcular").
  //    La pestana Radix se selecciona por su NOMBRE accesible ("3 Resultados"): el
  //    trigger NO emite un atributo `value` en el DOM, asi que el rol+nombre es el
  //    selector resiliente (no se usa el helper irAPestana, que asume `value=`).
  await page.getByRole("tab", { name: /Resultados/ }).click();

  // El boton de la pestana Resultados (BotonCalcular) vive en el panel ".cx-calcular"
  // y es el UNICO boton de ese panel. Se acota a el para NO confundirlo con el item
  // de brandbar "▶ Calcular obra" (que tras feature-17 tambien dispara el calculo y
  // esta habilitado): ambos comparten la clase primary, de ahi el alcance al panel.
  const boton = page.locator(".cx-calcular").getByRole("button");
  // Esperar a que el motor real termine de cargar: el boton pasa de "Cargando
  // motor…" a "Calcular" (habilitado). Margen amplio para la instanciacion WASM.
  await expect(boton).toHaveText("Calcular", { timeout: TIMEOUT_MOTOR });
  await expect(boton).toBeEnabled();

  // Disparar el click con .click() real: tras el refactor de zonas del HUD
  // (feature-17) BotonCalcular esta en la zona top-center y el control de planta del
  // GroupRibbon en top-left, asi que ya no se solapan y el hit-test aterriza limpio
  // sobre el boton (antes un overlay flotante interceptaba el puntero y obligaba a
  // dispatchEvent para esquivar el z-order).
  await boton.click();

  // 4) Esperar a que el motor REAL resuelva y la salida llegue a la UI. La senal
  //    fiable de exito es que la tabla de reacciones se PUEBLA (tbody con filas): el
  //    estado transitorio "Calculando…" es demasiado fugaz para aseverarlo de forma
  //    estable con el motor real. Margen amplio (resolucion + materializacion +
  //    validacion Zod del worker). Si la discretizacion fallara, esto NO se cumpliria
  //    y el fallo apuntaria aqui (con el reporte de error visible en el panel Calculo).
  const tablaReacciones = page.getByTestId("tabla-reacciones");
  await expect(tablaReacciones).toBeVisible({ timeout: TIMEOUT_MOTOR });

  const filasApoyo = tablaReacciones.locator("tbody tr");
  await expect(filasApoyo.first()).toBeVisible({ timeout: TIMEOUT_MOTOR });
  expect(await filasApoyo.count(), "debe haber filas de reaccion por apoyo").toBeGreaterThan(0);

  // Confirmar que el boton volvio a reposo (no quedo "Calculando…"/aria-busy): el
  // calculo termino limpio.
  await expect(boton).not.toHaveText("Calculando…");
  await expect(boton).not.toHaveAttribute("aria-busy", "true");

  // 5) Fijar la combinacion ELS (factores 1.0) para que la carga total sea q·L sin
  //    mayorar. Se elige por el ComboSelector real (Radix Select).
  await seleccionarCombinacion(page, "E.L.S. (servicio)");

  // 6) EQUILIBRIO (D9): leer ΣFY de la fila resumen de la tabla y comprobar que
  //    iguala (signo +) la carga total q·L dentro de la tolerancia holgada.
  const sumaFY = await leerSumaFY(tablaReacciones);
  expect(Number.isFinite(sumaFY), `ΣFY debe ser un numero finito, leido: ${sumaFY}`).toBe(true);

  // Signo correcto: las reacciones verticales empujan hacia ARRIBA (FY > 0) para
  // compensar la carga gravitatoria. ΣFY debe ser positivo y de magnitud ~q·L.
  expect(sumaFY, "ΣFY debe ser positivo (reacciones hacia arriba)").toBeGreaterThan(0);
  expect(
    Math.abs(sumaFY - CARGA_TOTAL_ELS),
    `equilibrio: |ΣFY - q·L| fuera de tolerancia. ΣFY=${sumaFY}, q·L=${CARGA_TOTAL_ELS}`,
  ).toBeLessThanOrEqual(CARGA_TOTAL_ELS * TOL_REL);

  // 7) Al menos una reaccion vertical de apoyo es FINITA y NO trivial (≠ 0, no NaN):
  //    confirma que el motor resolvio de verdad (no devolvio ceros/NaN de un
  //    mecanismo o de un fallo silencioso). Se lee la columna FY (2ª numerica) de la
  //    primera fila de apoyo.
  const fyPrimerApoyo = await leerFYApoyo(filasApoyo.first());
  expect(Number.isFinite(fyPrimerApoyo), `FY de apoyo debe ser finito: ${fyPrimerApoyo}`).toBe(true);
  expect(Math.abs(fyPrimerApoyo), "FY de apoyo no debe ser trivialmente cero").toBeGreaterThan(0.01);
});

// --- Helpers locales del spec (no se comparten; viven aqui, no en fixtures.ts) ---

// Selecciona una combinacion por su etiqueta legible en el ComboSelector (Radix
// Select, real en el navegador). Abre el listbox por su trigger y elige la opcion.
async function seleccionarCombinacion(page: Page, etiqueta: string): Promise<void> {
  await page.getByRole("combobox", { name: "Combinación activa" }).click();
  await page.getByRole("option", { name: etiqueta }).click();
}

// Lee el valor numerico de ΣFY de la fila resumen (tfoot) de la tabla de
// reacciones. La fila tiene un row-header "ΣFY" y, a continuacion, una celda vacia
// (columna FX) y la celda mono con la suma bajo la columna FY. Se localiza la fila
// por su texto y se toma su primera celda mono (.mono = el unico td con numero).
async function leerSumaFY(tabla: Locator): Promise<number> {
  const filaResumen = tabla.locator("tr.cx-reacciones__resumen");
  await expect(filaResumen).toBeVisible();
  const celdaMono = filaResumen.locator("td.mono").first();
  const texto = (await celdaMono.textContent())?.trim() ?? "";
  return parsearNumero(texto);
}

// Lee la reaccion FY (2ª columna numerica: FX, FY, FZ, MX, MY, MZ) de una fila de
// apoyo del cuerpo de la tabla. Las celdas numericas llevan clase .mono; FY es la 2ª.
async function leerFYApoyo(fila: Locator): Promise<number> {
  const celdasNum = fila.locator("td.mono");
  const texto = (await celdasNum.nth(1).textContent())?.trim() ?? "";
  return parsearNumero(texto);
}

// Parsea el texto mono de una celda a numero. La tabla formatea con punto decimal y
// sin separador de miles (toFixed), asi que Number() basta; se normaliza un posible
// "−" (minus unicode) por si acaso.
function parsearNumero(texto: string): number {
  return Number(texto.replace(/−/g, "-"));
}
