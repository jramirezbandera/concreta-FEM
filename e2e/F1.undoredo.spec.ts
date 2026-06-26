// =============================================================================
// F1.undoredo.spec.ts - feature-16, T1.3 (decisiones D6/D10; Codex #15).
//
// QUE CUBRE (cableado del pipeline F1 en navegador real, NO la numerica):
//  A. UNDO/REDO de obra: crear pilar -> deshacer (ausente) -> rehacer (reaparece),
//     aseverando TANTO el resumen del modelo (costura) COMO su reflejo en el DOM
//     del arbol de obra (Sidebar: contador de "Pilares" en "Elementos propios").
//  B. INVALIDACION "obsoleto-en-gris" (#15 / T-stale-labels): tras un calculo,
//     EDITAR la obra NO borra los resultados; el panel de reacciones SIGUE PRESENTE
//     marcado obsoleto (clase `cx-reacciones--obsoleto` + aviso "Resultados
//     obsoletos…"), y el panel de diagramas avisa "Estos esfuerzos son del ultimo
//     calculo…". Aseveramos ese estado concreto, NUNCA "los resultados desaparecen".
//
// COMO (D10, costura pura): la obra se construye por `window.__concreta` (comandos
// de dominio ya existentes) + el DIALOGO REAL de Plantas/Grupos (UI). El calculo se
// dispara por el BOTON "Calcular" (no el menu: el menu no alimenta el sink, los
// errores/estado no se reflejarian) con el mock del solver controlable
// (usarMockSolver().resolver()). No se toca el canvas R3F (eso lo cubren los
// component tests, D10).
//
// AISLAMIENTO (D6): `abrirApp` limpia IndexedDB ANTES de navegar y espera app-ready;
// cada test corre en un contexto fresco (playwright.config.ts, fullyParallel).
//
// NOTA DE ROBUSTEZ (Vite dev): el chunk lazy de Plotly (PanelDiagramas) y three.js
// se importan la PRIMERA vez al entrar en Resultados; en frio, Vite re-optimiza deps
// y emite un full-reload que destruiria el modelo recien construido. Por eso NO
// cacheamos JSHandles de la costura (cada llamada re-resuelve `window.__concreta`
// dentro del evaluate, robusto a navegaciones) y, en el test de calculo, PRECALENTAMOS
// la pestaña Resultados ANTES de construir la obra (el reload, si ocurre, no pisa nada).
// =============================================================================

import { test, expect, type Page } from "@playwright/test";
import { abrirApp } from "./fixtures";

// --- Helpers locales del spec (no colisionan con fixtures.ts, solo-lectura) ----

// Hipotesis variable sembrada en todo Modelo nuevo (crearModeloVacio): la carga de
// la viga la cuelga de aqui para que el discretizador genere combinaciones CTE y el
// calculo tenga algo que repartir. Id ASCII fijo del dominio (helpers.ts).
const HIP_SOBRECARGA = "hip-sobrecarga-uso";

// Geometria del portico minimo calculable (misma topologia que los golden de Node):
// dos pilares de apoyo que suben de la planta de cimentacion (cota 0) a la planta de
// calculo (cota 3) en (0,0) y (L,0); una viga entre sus cabezas en la planta alta.
// El bridge fija vinculacionExterior+arranque empotrado, asi cada pie genera un apoyo.
const L = 5;

// Numero de pilares del modelo, leido por la costura DENTRO del evaluate. No cacheamos
// un JSHandle de `window.__concreta`: `page.evaluate` re-resuelve `window` en el
// contexto vigente en cada llamada, asi un full-reload de Vite en frio entre pasos no
// nos deja un handle invalido (causa de "Execution context was destroyed").
async function pilaresEnModelo(page: Page): Promise<number> {
  return page.evaluate(() => window.__concreta!.resumenModelo().pilares);
}

// Navega a una pestaña (BottomTabs, Radix) por su nombre accesible. Local al spec:
// el helper `irAPestana` de fixtures.ts apunta por `[value=...]`, atributo que Radix
// NO emite en el trigger (role=tab sin `value` en el DOM); por nombre es estable. El
// nombre incluye el numero de solapa ("3Resultados"): casamos por substring (regex).
async function activarPestana(page: Page, nombre: RegExp): Promise<void> {
  await page.getByRole("tab", { name: nombre }).click();
}

// Localiza la FILA del arbol de obra (Sidebar) cuyo label es exactamente `label` y
// devuelve su contador. El arbol vive en <aside aria-label="Árbol de obra">; la fila
// es un .cx-row con un .cx-row__label y un .cx-row__count (FilaArbol). Acotamos al
// aside para no enganchar contadores homonimos de otros paneles.
function contadorArbol(page: Page, label: string) {
  const arbol = page.getByRole("complementary", { name: "Árbol de obra" });
  // exact:true para que "Pilares" no case con "Pilares pasantes" u otros si los hubiera.
  const fila = arbol
    .locator(".cx-row")
    .filter({ has: page.getByText(label, { exact: true }) });
  return fila.locator(".cx-row__count");
}

// Crea por el DIALOGO REAL un grupo con DOS plantas (cimentacion cota 0 + planta de
// calculo cota 3). Devuelve, leyendo la costura, los ids de planta en orden de
// creacion: [cimentacion, calculo] (crearPlanta hace push al final del array; la
// primera planta nueva queda en cota 0, la segunda apila encima a cota 3).
async function crearGrupoConDosPlantas(
  page: Page,
): Promise<{ plantaCimentacion: string; plantaCalculo: string }> {
  // Abrir el dialogo de Plantas y grupos desde el arbol de obra (entrada estable de UI).
  await page.getByRole("button", { name: "Gestionar plantas y grupos…" }).click();
  const dialogo = page.getByRole("dialog", { name: "Plantas y grupos" });
  await expect(dialogo).toBeVisible();

  // Un grupo nuevo (defaults residenciales) + dos plantas (la 2.ª apila sobre la 1.ª).
  await dialogo.getByRole("button", { name: "Nuevo grupo" }).click();
  await dialogo.getByRole("button", { name: "Nueva planta" }).click();
  await dialogo.getByRole("button", { name: "Nueva planta" }).click();

  // Cerrar el dialogo (el commit es en vivo: las plantas ya estan en el modelo).
  // Hay DOS "Cerrar" (la X de Radix con aria-label + el boton de pie ghost): tomamos
  // el boton de pie por su clase de primitiva para no chocar con la X.
  await dialogo.locator("button.cx-btn--ghost", { hasText: "Cerrar" }).click();
  await expect(dialogo).toBeHidden();

  // Resolver los ids por la costura (orden de creacion = orden del array de plantas).
  const plantas = await page.evaluate(() => window.__concreta!.estadoObra().plantas);
  expect(plantas.length).toBe(2);
  return {
    plantaCimentacion: plantas[0]!.id,
    plantaCalculo: plantas[1]!.id,
  };
}

// =============================================================================
// A. Undo / redo de obra (modelo + reflejo en el arbol)
// =============================================================================

test("undo/redo de un pilar: ausente al deshacer, reaparece al rehacer (modelo + árbol)", async ({
  page,
}) => {
  await abrirApp(page); // mock por defecto: el worker real nunca arranca

  // Estado inicial: sin pilares (modelo y arbol coinciden en 0).
  expect(await pilaresEnModelo(page)).toBe(0);
  await expect(contadorArbol(page, "Pilares")).toHaveText("0");

  // 1) Crear un pilar por la costura (comando de dominio real -> un paso de undo).
  await page.evaluate(() =>
    window.__concreta!.crearPilar({
      x: 0,
      y: 0,
      plantaInicial: "planta-test",
      plantaFinal: "planta-test",
    }),
  );
  expect(await pilaresEnModelo(page)).toBe(1);
  // El arbol refleja el alta: contador de "Pilares" = 1 (sin ambito activo, el
  // Sidebar cuenta el total de la obra).
  await expect(contadorArbol(page, "Pilares")).toHaveText("1");

  // 2) Deshacer: el pilar desaparece del modelo Y del arbol.
  await page.evaluate(() => window.__concreta!.deshacer());
  expect(await pilaresEnModelo(page)).toBe(0);
  await expect(contadorArbol(page, "Pilares")).toHaveText("0");

  // 3) Rehacer: reaparece en el modelo Y en el arbol.
  await page.evaluate(() => window.__concreta!.rehacer());
  expect(await pilaresEnModelo(page)).toBe(1);
  await expect(contadorArbol(page, "Pilares")).toHaveText("1");
});

// =============================================================================
// B. Invalidacion "obsoleto-en-gris": editar tras calcular conserva los resultados
//    marcados obsoletos (NO los borra). #15 / T-stale-labels.
// =============================================================================

test("editar la obra tras calcular deja los resultados OBSOLETOS pero PRESENTES en gris", async ({
  page,
}) => {
  await abrirApp(page);

  // PRECALENTADO (robustez Vite): entrar UNA vez en Resultados fuerza el import lazy
  // de Plotly/three; si Vite re-optimiza deps y emite un full-reload, ocurre AHORA,
  // antes de construir la obra (no se pierde nada). Luego volvemos a Pilares.
  await activarPestana(page, /Resultados/);
  await expect(page.getByRole("button", { name: "Calcular", exact: true })).toBeVisible();
  await activarPestana(page, /Entrada de pilares/);

  // --- Construir una obra calculable: grupo + 2 plantas + 2 pilares + viga + carga ---
  const { plantaCimentacion, plantaCalculo } = await crearGrupoConDosPlantas(page);

  // Dos pilares de apoyo (pie en cimentacion, cabeza en la planta de calculo) y la
  // viga entre sus cabezas; una carga lineal sobre la viga (hipotesis variable).
  const ids = await page.evaluate(
    ({ plantaCimentacion, plantaCalculo, L, HIP }) => {
      const c = window.__concreta!;
      c.crearPilar({ x: 0, y: 0, plantaInicial: plantaCimentacion, plantaFinal: plantaCalculo });
      c.crearPilar({ x: L, y: 0, plantaInicial: plantaCimentacion, plantaFinal: plantaCalculo });
      const vigaId = c.crearViga({ plantaId: plantaCalculo, xi: 0, yi: 0, xj: L, yj: 0 });
      c.anadirCargaLineal({ elementoId: vigaId, valor: 10, hipotesisId: HIP });
      return { vigaId, resumen: c.resumenModelo() };
    },
    { plantaCimentacion, plantaCalculo, L, HIP: HIP_SOBRECARGA },
  );
  expect(ids.resumen.pilares).toBe(2);
  expect(ids.resumen.vigas).toBe(1);
  expect(ids.resumen.cargas).toBe(1);

  // Asegurar el mock instalado (ya activo por abrirApp; usarMockSolver reusa el mismo
  // control singleton). No cacheamos su handle: lo re-resolvemos al resolver().
  await page.evaluate(() => {
    window.__concreta!.usarMockSolver();
  });

  // --- Calcular por el BOTON (no el menu): el boton alimenta el sink/estado ---
  await activarPestana(page, /Resultados/);
  // El motor mock reporta "listo": el boton muestra "Calcular" y esta habilitado.
  // exact:true para no chocar con el disparador del menu ("▶ Calcular obra", stub
  // deshabilitado): el calculo DEBE ir por el BotonCalcular (alimenta el sink/estado).
  const botonCalcular = page.getByRole("button", { name: "Calcular", exact: true });
  await expect(botonCalcular).toBeEnabled();
  // Disparamos con dispatchEvent('click') en vez de .click(): el gizmo de navegacion
  // de plantas del HUD ("↓ Planta inferior") se solapa con el panel de calculo y
  // intercepta el click de raton por z-order. dispatchEvent va al boton EXACTO ya
  // resuelto y dispara el onClick de React (delegado en la raiz) sin depender de la
  // geometria del HUD. El estado/sink siguen yendo por el BotonCalcular (no el menu).
  await botonCalcular.dispatchEvent("click");

  // El mock deja la promesa PENDIENTE: el boton pasa a "Calculando…" / aria-busy.
  const botonCalculando = page.getByRole("button", { name: "Calculando…" });
  await expect(botonCalculando).toHaveAttribute("aria-busy", "true");

  // Liberar el calculo: el mock resuelve con resultados conscientes del modelo.
  // usarMockSolver() devuelve el MISMO control singleton instalado arriba, asi que
  // resolver() cumple la promesa pendiente de este calculo.
  await page.evaluate(() => window.__concreta!.usarMockSolver().resolver());

  // --- Resultados VIGENTES: la tabla de reacciones muestra valores -----------
  const tablaReacciones = page.getByTestId("tabla-reacciones");
  await expect(tablaReacciones).toBeVisible();
  // El mock reparte CARGA_TOTAL_FY (100 kN) entre los 2 apoyos -> FY = 50.00 por
  // apoyo y ΣFY = 100.00. Valor concreto del mock consciente del modelo (D7).
  await expect(tablaReacciones).toContainText("50.00");
  await expect(tablaReacciones).toContainText("100.00");
  // Aun NO obsoleto: sin la clase ni el aviso de "obsoletos".
  await expect(tablaReacciones).not.toHaveClass(/cx-reacciones--obsoleto/);
  await expect(tablaReacciones).not.toContainText("Resultados obsoletos");

  // Seleccionar la viga para que el panel de diagramas resuelva una barra (su aviso
  // de obsoleto solo aparece con un diagrama "ok" en pantalla).
  await page.evaluate((vigaId) => window.__concreta!.seleccionar([vigaId]), ids.vigaId);
  const panelDiagramas = page.getByTestId("panel-diagramas");
  await expect(panelDiagramas).toBeVisible();
  await expect(panelDiagramas).not.toContainText("Estos esfuerzos son del último cálculo");

  // --- EDITAR la obra: invalida los resultados (vigente=false), NO los borra ---
  await page.evaluate(() =>
    window.__concreta!.crearPilar({
      x: 0,
      y: 5,
      plantaInicial: "planta-test",
      plantaFinal: "planta-test",
    }),
  );

  // El panel NO desaparece: sigue presente, ahora en gris (clase obsoleto + aviso).
  await expect(tablaReacciones).toBeVisible();
  await expect(tablaReacciones).toHaveClass(/cx-reacciones--obsoleto/);
  await expect(tablaReacciones).toContainText("Resultados obsoletos");
  // Y los valores del ULTIMO calculo siguen ahi (no se vacian, solo se grisan).
  await expect(tablaReacciones).toContainText("50.00");

  // El panel de diagramas tambien sigue presente y avisa que son del ultimo calculo.
  await expect(panelDiagramas).toBeVisible();
  await expect(panelDiagramas).toContainText("Estos esfuerzos son del último cálculo");
});
