import { test, expect, type Page, type Locator } from "@playwright/test";
import { abrirApp, bridge } from "./fixtures";

// =============================================================================
// F1.validacion.spec.ts (feature-16, T1.2) — la VALIDACION protege al motor.
//
// PROPOSITO: probar el invariante de producto "importar/modelar algo invalido
// nunca rompe la app NI dispara el motor". Una obra que el discretizador rechaza
// (ok:false) corta el pipeline ANTES de solverClient.calcular (useCalcular.ts:104):
//  (a) el panel de Calculo muestra el error en LENGUAJE DE OBRA (CLAUDE.md §2/§17:
//      cero jerga FEM; apunta al elemento culpable),
//  (b) el motor NO se llama — lo PROBAMOS con el contador del mock (#16): si la
//      validacion fallase y el codigo llegara al solver, contadorLlamadas() seria
//      > 0 y el test rojo.
//
// Ambos casos modelan obra INVALIDA por la costura `window.__concreta` y disparan
// Calcular por el BOTON. Tanto el boton como el menu "Calcular obra" alimentan hoy
// el mismo `calculoStore` (feature-17), pero calculamos por el BOTON por claridad y
// aislamiento: es el panel de Resultados quien renderiza el status con el error de
// obra que aseveramos. El mock del solver se instala en el arranque (abrirApp con
// mock:true) para que el worker real (Pyodide) nunca arranque y el contador sea fiable.
//
// `role=status` ACOTADO (#17): la pestana Resultados tiene VARIAS live-regions
// (PanelDiagramas, TablaReacciones, aviso de mosaico del Viewport...). Un
// getByRole('status') global seria ambiguo. Acotamos al panel de Calculo por su
// raiz estable `.cx-calcular` (className propio de BotonCalcular) y buscamos el
// status DENTRO.
// =============================================================================

// --- Helpers locales del spec (fixtures.ts es solo-lectura) ------------------

// El panel de Calculo (BotonCalcular): raiz estable `.cx-calcular`. Acota el
// role=status para no enganchar otra live-region de la pestana Resultados (#17).
function panelCalculo(page: Page): Locator {
  return page.locator(".cx-calcular");
}

// Navega a la pestana Resultados por ROL+nombre (las pestanas son Radix Tabs.Trigger
// con role="tab"; su nombre accesible incluye el numero, de ahi el match por
// substring "Resultados"). No usamos el helper irAPestana de fixtures.ts porque su
// selector [value="..."] no casa con Radix (Tabs.Trigger no emite `value` como
// atributo DOM). Role-first (D1), estable.
async function irAResultados(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Resultados" }).click();
}

// Pulsa el boton "Calcular" del panel de Calculo con un .click() real. Tras el
// refactor de zonas del HUD (feature-17), BotonCalcular vive en la zona top-center
// y el control de plantas del GroupRibbon en top-left: ya NO se solapan, asi que el
// hit-test del click aterriza limpio sobre "Calcular" (antes un boton vecino del HUD
// cubria la zona de impacto y obligaba a usar dispatchEvent para esquivar el z-order).
// El objetivo del test es el corte de validacion + el contador del motor.
async function pulsarCalcular(panel: Locator): Promise<void> {
  await panel.getByRole("button", { name: "Calcular" }).click();
}

// Crea UN grupo y UNA planta por el DIALOGO REAL (Obra -> Plantas y grupos) y
// devuelve el id de la planta creada, leido por la costura `estadoObra()`. Es la
// minima base necesaria para que `crearViga` tenga una planta valida a la que
// colgarse. Conducimos UI real (menu Radix + dialogo Radix) para no inventar una
// via paralela: la creacion de obra-base pasa por donde pasa el usuario.
async function crearPlantaPorDialogo(page: Page): Promise<string> {
  // Abrir el menu "Obra" (Popover de Radix) y elegir "Plantas y grupos". `exact`
  // para no casar el boton "▶ Calcular obra" de la brandbar (contiene "obra").
  await page.getByRole("button", { name: "Obra", exact: true }).click();
  await page.getByRole("menuitem", { name: "Plantas y grupos" }).click();

  // El dialogo es modal (role=dialog); acotamos las acciones a el.
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toBeVisible();

  // Crear un grupo (se autoselecciona). Gateamos el siguiente paso en la FUENTE DE
  // VERDAD (el store via la costura), no en el timing de render de Radix: el detalle
  // del grupo —y con el el boton "Nueva planta"— solo se monta cuando hay un grupo
  // activo. Esperar a grupos>=1 elimina la carrera vista en --repeat-each (el clic en
  // "Nueva planta" caia antes de que el detalle del grupo se montara).
  const cx = await bridge(page);
  await dialogo.getByRole("button", { name: "Nuevo grupo" }).click();
  await expect
    .poll(() => cx.evaluate((c) => c.estadoObra().grupos.length))
    .toBeGreaterThanOrEqual(1);

  // Ahora el detalle del grupo esta montado: el boton "Nueva planta" existe. Click y
  // gateo de nuevo en el store (planta creada) antes de cerrar.
  await dialogo.getByRole("button", { name: "Nueva planta" }).click();
  await expect
    .poll(() => cx.evaluate((c) => c.estadoObra().plantas.length))
    .toBeGreaterThanOrEqual(1);

  // Cerrar el dialogo para liberar el foco/overlay modal antes de seguir. Escape
  // es la via canonica de cierre de un Dialog modal de Radix y evita la ambiguedad
  // entre el boton "×" (aria-label "Cerrar") y el "Cerrar" del pie (mismo nombre
  // accesible).
  await page.keyboard.press("Escape");
  await expect(dialogo).toBeHidden();

  // Resolver el id de la planta recien creada por la costura (sin hurgar el store).
  const plantaId = await cx.evaluate((c) => {
    const plantas = c.estadoObra().plantas;
    return plantas[plantas.length - 1]?.id ?? null;
  });
  expect(plantaId, "el dialogo deberia haber creado una planta").not.toBeNull();
  return plantaId as string;
}

// Lee el contador de llamadas al motor desde el mock. === 0 PRUEBA que el solver
// no se invoco (la validacion corto antes). usarMockSolver() reutiliza el control
// instalado en el arranque (no reinstala: conserva el contador).
async function llamadasAlMotor(page: Page): Promise<number> {
  return page.evaluate(() => window.__concreta!.usarMockSolver().contadorLlamadas());
}

// -----------------------------------------------------------------------------
// CASO A — Estructura no sujeta (mecanismo).
//
// Obra minima invalida: UNA planta y UNA viga, SIN ningun pilar que sujete la
// estructura al terreno. `validarSujecion` (validaciones.ts) dispara SIN_SUJECION
// (severidad "error"): hay vigas pero ningun pilar con vinculacionExterior, asi
// que la estructura "flota". discretizar() devuelve ok:false y el pipeline corta
// antes del motor.
//
// NB: crearPilar de la costura trae arranque empotrado + vinculacionExterior=true
// (un apoyo VALIDO), por eso el mecanismo se fuerza con una viga SIN pilares, no
// con un pilar "mal configurado".
// -----------------------------------------------------------------------------
test("estructura no sujeta (mecanismo): error en lenguaje de obra y el motor NO se llama", async ({
  page,
}) => {
  await abrirApp(page); // mock:true por defecto: el worker real nunca arranca.

  // Base: una planta (por el dialogo real). Sobre ella, una viga sin pilares.
  const plantaId = await crearPlantaPorDialogo(page);
  await (
    await bridge(page)
  ).evaluate((c, p) => {
    c.crearViga({ plantaId: p, xi: 0, yi: 0, xj: 5, yj: 0 });
  }, plantaId);

  // Sanidad: la obra tiene 1 viga y 0 pilares (el mecanismo que queremos probar).
  const resumen = await (await bridge(page)).evaluate((c) => c.resumenModelo());
  expect(resumen).toMatchObject({ pilares: 0, vigas: 1 });

  // A Resultados y CALCULAR POR EL BOTON. El error se renderiza en el panel de
  // Calculo (status acotado a `.cx-calcular`), de ahi que disparemos por el boton y
  // no por el menu, aunque ambos compartan el `calculoStore` (feature-17).
  await irAResultados(page);
  const panel = panelCalculo(page);
  await expect(panel).toBeVisible();
  // El panel se identifica por su cabecera "Calculo" y su boton, sin role propio.
  await expect(panel.getByText("Cálculo")).toBeVisible();
  await pulsarCalcular(panel);

  // (a) El error aparece en el role=status ACOTADO al panel de Calculo (#17) y su
  // TEXTO es lenguaje de obra: apunta al culpable (la estructura no esta sujeta),
  // en espanol, SIN jerga FEM ("nodo"/"member"/"release"/"DOF").
  const status = panel.getByRole("status");
  await expect(status).toBeVisible();
  await expect(status).toContainText(
    "Ningún pilar tiene arranque ni conexión con el terreno: la estructura no está sujeta y no se puede calcular.",
  );
  await expect(status).not.toContainText(/nodo|member|release|DOF/i);

  // (b) El motor NO se llamo: la validacion corto antes del solver (#16).
  const n = await llamadasAlMotor(page);
  expect(n).toBe(0);
});

// -----------------------------------------------------------------------------
// CASO B — Viga degenerada (otro error de validacion que el discretizador rechaza).
//
// Por que esta y no "hipotesis sin cargas": COMBO_SIN_CARGAS es severidad "aviso"
// (NO bloquea; de hecho solo se muestra cuando ok:true, que llamaria al motor), asi
// que NO encaja en este spec ("motor NO llamado"). Necesitamos un error BLOQUEANTE
// que la costura pueda construir de forma fiable: una viga con sus dos extremos en
// el MISMO punto. crearViga reusa el nudo del primer extremo para el segundo (misma
// celda de snapping), produciendo nudoI === nudoJ; `validarRefsViga` lo detecta
// (VIGA_DEGENERADA, severidad "error") -> discretizar ok:false -> motor no llamado.
//
// La obra coincide ademas en ser un mecanismo (viga sin pilares), asi que el panel
// muestra DOS errores de obra a la vez (el discretizador los reporta todos juntos,
// no aborta en el primero). Aseveramos el mensaje propio de la viga degenerada y,
// de nuevo, contador === 0.
// -----------------------------------------------------------------------------
test("viga degenerada: error de obra (extremos en el mismo punto) y el motor NO se llama", async ({
  page,
}) => {
  await abrirApp(page);

  const plantaId = await crearPlantaPorDialogo(page);
  // Ambos extremos en el MISMO punto -> viga de longitud cero (extremos colapsan
  // en un solo nudo). La primera viga creada por la costura se llama "V1".
  await (
    await bridge(page)
  ).evaluate((c, p) => {
    c.crearViga({ plantaId: p, xi: 2, yi: 2, xj: 2, yj: 2 });
  }, plantaId);

  const resumen = await (await bridge(page)).evaluate((c) => c.resumenModelo());
  expect(resumen).toMatchObject({ vigas: 1 });

  await irAResultados(page);
  const panel = panelCalculo(page);
  await expect(panel).toBeVisible();
  await pulsarCalcular(panel);

  // (a) Mensaje de obra de la viga degenerada, dentro del status ACOTADO. Apunta al
  // elemento culpable por su nombre visible (V1), sin jerga FEM.
  const status = panel.getByRole("status");
  await expect(status).toBeVisible();
  await expect(status).toContainText(
    'La viga "V1" tiene sus dos extremos en el mismo punto.',
  );
  await expect(status).not.toContainText(/nodo|member|release|DOF/i);

  // (b) El motor NO se llamo.
  const n = await llamadasAlMotor(page);
  expect(n).toBe(0);
});
