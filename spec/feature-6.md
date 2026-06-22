# feature-6 · Golden tests del discretizador y del pipeline

> Tier 1 · Motor · **LA RED DE SEGURIDAD** · **Dependencias: feature-4, feature-5** · Bloquea: 14, 16.

## Objetivo

Verificar el cálculo extremo a extremo (obra → `discretizar()` → PyNite → resultados) contra **casos de libro con solución analítica conocida**. Es la red de seguridad del producto y la única defensa contra el error nº1 (dirección de carga global/local).

## Alcance

**Incluye** (`/tests/golden`)
- Los **7 casos con fórmula cerrada** (hallazgo #9, todas verificadas sin error de coeficiente):
  1. Biapoyada UDL: `M=qL²/8`, `δ=5qL⁴/384EI`.
  2. Voladizo carga puntual: `M=PL`, `δ=PL³/3EI`.
  3. Voladizo UDL: `M=qL²/2`, `δ=qL⁴/8EI`.
  4. Biempotrada UDL: `M_emp=qL²/12`, `M_centro=qL²/24`, `δ=qL⁴/384EI`.
  5. Biapoyada carga puntual centro: `M=PL/4`, `δ=PL³/48EI`.
  6. Celosía (axiles conocidos).
  7. Pórtico simple.
- **Tolerancias:** <0,1 % en esfuerzos/reacciones; <1 % en flechas.
- **Test de dirección de carga** (global/local, MAYÚS/minús): caso que falla si se pasa la dirección equivocada (hallazgo #3).
- **Test de ejes locales de pilar vertical**: carga lateral en X y en Z, confirma la convención elegida en feature-4 (hallazgo #19).
- **Test de Y vertical**: gravedad = `FY` negativo da la deformada esperada (hallazgo #18).
- Dos niveles (hallazgo #17): suite normal mockea `solverClient` con golden **precomputados**; integración con **Pyodide real reutilizando una sola instancia**.

**Excluye**: tests de UI (RTL, en sus features), E2E (feature-16).

## Entradas de I+D

- Hallazgos #4, #9 (fórmulas), #3/#18/#19 (direcciones/ejes), #17 (testing por capas, Vitest `test.projects`, no `workspace`).
- Área 2 §7 y Área 5 §4.

## Criterios de aceptación

- Los 7 casos pasan dentro de tolerancia con PyNite real.
- **Golden del discretizador independiente del worker:** al menos un test que verifica la **Capa 2 generada** por `discretizar()` (nodos/members/releases/cargas/combos) contra un esperado fijo, **sin Pyodide** (solo feature-4). La red de seguridad del discretizador no debe acoplarse al solver.
- Existe la versión mockeada del pipeline (rápida, sin Pyodide) y la de integración (Pyodide, instancia única).
- El test de dirección de carga **falla** si se invierte global/local (prueba de que detecta el error nº1).
- `npm run test:golden` ejecuta esta suite (proyecto Vitest `node`).

## Notas / riesgos

- Si una fórmula y PyNite discrepan más de la tolerancia, **es un bug del discretizador o de unidades**, no de la fórmula (están verificadas). Investigar ahí primero.
- Reutilizar una sola instancia de Pyodide en CI por coste de arranque.
