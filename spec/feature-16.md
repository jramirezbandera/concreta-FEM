# feature-16 · E2E del flujo F1 (Playwright)

> Tier 5 · Verificación · **Dependencias: feature-10 a feature-14** · Bloquea: cierre de F1.

## Objetivo

Probar el **flujo completo F1** de extremo a extremo en navegador real con Playwright: definir plantas → introducir pilares → introducir vigas → asignar cargas → calcular → ver resultados.

## Alcance

**Incluye** (`/tests` E2E, config Playwright)
- Escenario feliz del flujo F1 completo sobre la app real.
- Verificaciones: se crean elementos, "Calcular" produce deformada/diagramas/reacciones, los valores caen dentro de tolerancia para un caso conocido (reutilizar un golden simple, p. ej. pórtico).
- **Solver**: dos modos según coste de CI (hallazgo #17): Pyodide **real** (instancia única, más lento) o `solverClient` **mockeado** con golden precomputados. Documentar cuál corre en CI.
- Comprobar persistencia básica: recargar restaura el proyecto (feature-8).
- Comprobar robustez: importar un `.json` corrupto no rompe la app.

**Excluye**: cobertura exhaustiva de UI (eso son los component tests de cada feature), F2–F4.

## Entradas de I+D / CLAUDE.md

- Hallazgo #17 (testing por capas; E2E Playwright del flujo F1).
- `CLAUDE.md §13` (testing), `§15` (alcance F1).

## Criterios de aceptación

- `npm run e2e` ejecuta el flujo F1 y pasa.
- El test cubre: plantas → pilares → vigas → cargas → calcular → resultados visibles y correctos (tolerancia).
- Recargar la página mantiene el proyecto.
- Importar un proyecto corrupto muestra error en lenguaje de obra sin crash.
- Documentado el modo de solver usado en CI (real vs mock) y su coste.

## Notas / riesgos

- Pyodide en CI es costoso: si se usa real, una sola instancia y timeouts holgados; si mock, mantener los golden sincronizados con feature-6.
- Mantener los selectores E2E estables (data-testid) para no acoplar a estilos.
