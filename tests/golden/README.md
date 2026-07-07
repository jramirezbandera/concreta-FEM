# Golden tests — la red de seguridad del cálculo

Estos tests son la **red de seguridad del producto** (CLAUDE.md §13, I+D #9). Comparan el
pipeline real `obra → discretizar() → PyNite/Pyodide → resultados` contra **fórmulas
cerradas verificadas** (biapoyada, voladizo, pórtico…). Si un número se mueve por encima de
tolerancia, **el bug está en el discretizador o en las unidades, nunca en la fórmula**: no se
afloja la tolerancia ni se "ajusta" la fórmula para que pase (antipatrón explícito del proyecto).

## La pirámide: dos capas

| Capa | Fichero | Motor | Coste | Qué blinda |
|------|---------|-------|-------|------------|
| **A — Discretizador** | `discretizador.casos.test.ts` | NO (Node puro) | milisegundos | Estructura de la Capa 2 (nodos, barras, releases, apoyos, cargas, signo/dirección) que produce `discretizar()` para cada obra canónica. Independiente del solver. |
| **B — Pipeline E2E** | `pipeline.golden.test.ts` | Sí (PyNite real) | ~8-9 s | Números del motor: `M=qL²/8`, `V=qL/2`, reacciones, flechas, `check_statics`. Compara contra fórmula cerrada con tolerancia. |

Complementos de infraestructura:

- `humo.test.ts` — humo de los cimientos (fixtures discretizan, tolerancias se comportan,
  el arnés de motor arranca y cruza el pipeline). No verifica números.
- `_arnes/` — fixtures de obra canónica, comparador de tolerancias, arranque único del motor
  y helper de pipeline. Lo consumen las dos capas; no redefine sus propios números.

La **Capa A es la que se corre siempre** (rápida, sin Pyodide, caza el 90 % de las regresiones
del discretizador). La **Capa B** valida que el motor sigue dando los números de libro.

## Cómo correr cada capa

```bash
npm run test:golden:discretizador   # Capa A — solo discretizador, sin motor (milisegundos)
npm run test:golden:pipeline        # Capa B — motor real PyNite (~8-9 s)
npm run test:golden                 # ambas capas + humo (todo el directorio tests/golden)
npm run test                        # toda la suite del repo (Vitest run)
```

## Todo es OFFLINE (sin red, sin PyPI, sin CDN)

El arranque del motor en los tests **no toca la red** (regla de oro #9):

- **numpy / scipy / micropip / wcwidth (+ libopenblas)**: `loadPackage` los resuelve por el
  `pyodide-lock.json` con `indexURL` local. En los tests de **Node** el `indexURL` es
  `node_modules/pyodide` (donde están presentes al instalar). En el **navegador / GitHub Pages**
  el `indexURL` es `/pyodide/`, servido desde `public/pyodide/` — y ahí llegan **vendorizados**
  desde `vendor/wheels/`, porque el paquete `pyodide` de npm publica **solo el core** (13
  ficheros; su `package.json` `files` no incluye ningún wheel de paquete).
- **PyNiteFEA + PrettyTable**: **vendorizados** en `vendor/wheels/*.whl` e instalados con
  micropip desde una URL local. El orden y los flags (`deps`) son fuente única en
  `src/solver/config.ts` (`WHEELS_VENDOR`).

### Wheels vendorizados vs. `public/pyodide/`

- `vendor/wheels/` **se versiona en el repo**: es la fuente offline de **todo** wheel que
  Pyodide npm no publica. Dos familias: los que instala micropip (PyNiteFEA, PrettyTable) y los
  que resuelve `loadPackage` (numpy, scipy, libopenblas, micropip, wcwidth). Son la entrada, no
  un artefacto.
- `public/pyodide/` **es DERIVADO y NO se versiona** (`.gitignore`): lo regenera
  `scripts/copy-pyodide-assets.mjs` en `postinstall` + `buildStart` copiando el core de
  `node_modules/pyodide` y **todos** los wheels de `vendor/wheels/`. Si falta, basta
  `npm run copy-pyodide`.

> **Lección (bug del 404 en GitHub Pages):** antes numpy/scipy se copiaban solo desde
> `node_modules/pyodide`. En un `npm ci` limpio (CI) ese directorio es core-only, así que
> `public/pyodide` quedaba sin numpy/scipy → 404 en el sitio → el motor no arrancaba, y el deploy
> pasaba en verde porque la verificación post-copia no los miraba. Ahora van vendorizados y
> `PAQUETES_CRITICOS` los verifica (corta el build en rojo si faltan).

## Política de tolerancias

Fuente única: `_arnes/tolerancias.ts` (T1.1 y T1.2 la consumen, no inventan números). Combina
tolerancia **relativa** con un **piso absoluto** (cero numérico para teóricos ~0):

| Magnitud | Tolerancia relativa | Por qué |
|----------|---------------------|---------|
| Esfuerzos (M, V, N) y reacciones | **< 0,1 %** (`1e-3`) | En isostáticas no dependen de E·I; PyNite los resuelve por equilibrio exacto. El único error es coma flotante WASM + muestreo del diagrama. |
| Flechas / deformada | **< 1 %** (`1e-2`) | Dependen de E·I y del muestreo (`n_points`) del diagrama; el pico real puede caer entre dos estaciones. |

Pisos absolutos: `1e-6` kN/kN·m para esfuerzos/reacciones, `1e-9` m para flechas.

## Regla: los golden de motor van en UN único fichero

El arranque de Pyodide + numpy/scipy + PyNiteFEA cuesta ~7-9 s. El arnés (`_arnes/motor.ts`)
**cachea la promesa de arranque a nivel de módulo**, de modo que se paga una sola vez por
proceso. Pero **Vitest aísla cada fichero de test en su propio worker**, así que esa caché solo
se comparte entre los `it` de un mismo fichero.

Por eso **todos los golden que necesiten el motor real deben vivir en `pipeline.golden.test.ts`**
(un único fichero con un `beforeAll` que arranca el motor). Repartirlos en varios ficheros
multiplicaría el arranque de 8 s por el número de ficheros. La Capa A, en cambio, no arranca
motor: puede repartirse libremente.

## Estrategia de CI (cuando exista)

> A fecha de hoy este repo **no es un repositorio git** y **no hay configuración de CI**. No se
> ha inventado un pipeline. Cuando se monte CI, la estrategia recomendada es:

1. **Capa A en cada push** (rápida, sin motor, sin red):

   ```bash
   npm run test:golden:discretizador
   ```

   Más el resto de la suite unitaria (`npm run test`, `npm run typecheck`, `npm run lint`).

2. **Capa B en un job dedicado** (motor real, offline con los wheels vendorizados):

   ```bash
   npm run test:golden:pipeline
   ```

   - **No instalar de PyPI**: los wheels ya están en `vendor/wheels/` (versionados) y numpy/scipy
     en `node_modules/pyodide`. El job solo necesita `npm ci` (que dispara `postinstall` →
     `copy-pyodide`) y la ejecución; sin acceso a red para el cálculo.
   - Se puede separar del job rápido (matriz / job posterior) porque es más lento (~8-9 s de
     arranque) pero es **determinista y offline**.

Si en algún entorno de CI no se quiere arrancar Pyodide, la Capa B se **auto-salta** con un
mensaje claro (SKIP) en lugar de fallar en rojo (mismo criterio que el smoke test); aun así, la
recomendación es ejecutarla en CI porque es la validación numérica del motor.
