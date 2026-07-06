# Spike T0.2 — Estabilidad de una VIGUETA biapoyada AISLADA (corte "forjado unidireccional")

**Estado: GO.** El patrón de apoyo nodal recomendado para una vigueta biarticulada
cuyo borde de apoyo **no tiene viga de contorno** (apoya en un nudo con apoyo nodal)
es, por extremo:

| Extremo | DX | DY | DZ | RX | RY | RZ |
|---------|----|----|----|----|----|----|
| **i** (arranque) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **j** (final)    | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |

Es decir: **cada extremo restringe TODO menos DX; DX se ancla solo en `i`.** Con ese
patrón el motor resuelve limpio y clava la analítica al bit: `M_max = 15.625 kN·m`
(err 0.0000 %) y `δ = 4.787934e-3 m` (err 0.0000 %).

- Script reproducible: [`vigueta_spike.py`](./vigueta_spike.py)
  (`python src/solver/spikes/vigueta_spike.py`, exit 0 = GO). **No** forma parte de `npm test`.
- Par del motor: PyNiteFEA **2.0.2** (el del proyecto, `src/solver/config.ts`).
  Ejecutado con PyNite local (numpy 2.4.4 / scipy 1.18.0). El algoritmo (`FEModel3D` +
  `analyze_linear(sparse=True)`) es Python puro e idéntico al que correrá en Pyodide/WASM.

---

## Hallazgo rector (verificado en el fuente de PyNite 2.0.2)

`Pynite/Analysis._check_stability(model, K)` recorre **cada término DIAGONAL** de la
matriz de rigidez `K`. Si `isclose(K[i,i], 0)` **y** ese GDL **no está soportado** por
`def_support`, imprime `* Nodal instability detected: node … is unstable …` y **lanza**
`Exception('Unstable node(s)')`. Es un chequeo **por GDL y por nudo, no global**.

Consecuencia directa para la vigueta biarticulada aislada: **todo GDL rotacional que
el member deja sin rigidez debe estar soportado en el nudo**, aunque físicamente sea
"inofensivo":

- **RY, RZ** — los liberan los `def_releases` del proyecto
  (`releasesDeExtremo("articulado","articulado", false)`: libera `Ry,Rz` de cada
  extremo). Un GDL liberado tiene `K[i,i]=0` en su nudo si nada lo retiene.
- **RX (torsión propia)** — el release **nunca** libera Rx (el member conecta Rx i↔j
  rígido), pero con `J = 0` (rectangular, decisión F1) la rigidez torsional `G·J = 0`,
  así que `K[RX,RX] = 0` también. **Confirma la sospecha del plan.**
- **DZ (traslación perpendicular al eje, horizontal)** — ninguna barra la coarta.

**El apoyo nodal retiene el giro del NUDO, no la rótula del MEMBER.** Restringir `RZ`/`RY`
en el nudo **no** empotra la vigueta: el `def_releases` sigue vivo y el member no
transmite momento a ese GDL. Lo prueba el número: con el patrón recomendado `M_max = qL²/8`
(biapoyado), **no** `qL²/12` ni `qL²/24` (empotrado). La rótula está viva.

---

## (1) Patrón de apoyo escalonado — qué hace PyNite en cada escalón

Vigueta horizontal a lo largo de **X** global (i en x=0, j en x=5), FEM Y-up
(`mapearEjes`: vertical = Y). Carga `w = −5 kN/m` en `FY`.

| Escalón | Apoyo i | Apoyo j | Resultado |
|---------|---------|---------|-----------|
| **(a)** | DY | DY | **LANZA.** Inestables en ambos nudos: **DZ, RX, RY, RZ**. |
| **(b)** candidato del plan | DY+DX+DZ | DY+DZ | **LANZA.** Ya resuelve traslaciones, pero **siguen inestables RX, RY, RZ en AMBOS** nudos. El candidato del plan **no basta**. |
| **(c)** +RX en i | DY+DX+DZ+RX | DY+DZ | **LANZA.** Falta RX en j, y RY+RZ en ambos. |
| **(d) RECOMENDADO** | DX+DY+DZ+RX+RY+RZ | DY+DZ+RX+RY+RZ | **OK.** M_max=15.625000 (err 0.0000 %), δ=4.787934e-3 (err 0.0000 %). |

**Diagnóstico "quitar-de-a-uno"** (partiendo del patrón recomendado, se quita un GDL de
ambos extremos): quitar **DZ → LANZA**, **RX → LANZA**, **RY → LANZA**, **RZ → LANZA**.
Cada uno de los cinco GDL (DY implícito, DZ, RX, RY, RZ) es **necesario** en ambos extremos.

### El gotcha del proyecto (basura silenciosa) — matiz honesto

`_check_stability` **solo mira la diagonal**. Un mecanismo cuya singularidad **no** cae
en un término diagonal exactamente cero (sino en un acoplamiento fuera de la diagonal)
**no lo caza**: `scipy.spsolve` emite `MatrixRankWarning: Matrix is exactly singular` y
devuelve **NaN**, sin lanzar excepción — igual que la basculación colineal de la losa
plana. En este caso concreto de la vigueta aislada el guard nodal **sí cubre** los 5 GDL
(DZ ausente en ambos extremos se detecta como `K[DZ,DZ]=0`), pero **no debemos confiar
solo en que PyNite lance**: el corte (3) demuestra abajo un mecanismo que el guard nodal
sí caza pero que, sin él, habría sido NaN silencioso. **El discretizador debe emitir el
apoyo completo por construcción, no esperar a que el motor proteste.**

---

## (2) Analítica clavada con el patrón recomendado

Datos (sistema interno kN-m): `L=5 m`, sección `0.12×0.30` (b×h), HA-25, `w=5 kN/m`.

- **E de HA-25 REAL del proyecto** (`src/biblioteca/hormigon.ts`, Código Estructural):
  `Ecm = 22000·((25+8)/10)^0.3 = 31476 MPa = 3.147581e7 kN/m²`.
  (NO la fórmula EHE-08 derogada `8500·fcm^(1/3)`.) `ν=0.2`, `G=E/(2(1+ν))`.
- **Criterio Iy/Iz (swap C-1)** que apliqué al montar la Capa 2 a mano
  (`src/discretizador/propiedadesBarra.ts`, `seccionFEMParaPyNite`): la app tabula
  `Iy_app = b·h³/12` (eje **fuerte**, canto gobierna) e `Iz_app = h·b³/12` (eje débil);
  al emitir la Capa 2 se **intercambian**: `FEM Iy := Iz_app`, `FEM Iz := Iy_app`. Así la
  flexión vertical, que PyNite gobierna con su campo **`Iz`** (Member3D 2.0.2), usa el eje
  fuerte. Para 0.12×0.30: `I_flexión = b·h³/12 = 2.700000e-4 m⁴`. `J = 0`.
- **Lectura de resultados**: la vigueta es horizontal a lo largo de X ⇒ eje local x = X;
  para barra horizontal PyNite pone eje local y = Y (vertical). La flexión vertical vive
  en el plano local x-y ⇒ momento **`moment_array("Mz")`**, flecha **`deflection_array("dy")`**.

| Magnitud | Analítica | Motor (patrón recomendado) | Error |
|----------|-----------|----------------------------|-------|
| `M_max = qL²/8`          | **15.625000 kN·m** | 15.625000 kN·m | **0.0000 %** |
| `δ = 5qL⁴/(384·E·I)`     | **4.787934e-3 m**  | 4.787934e-3 m  | **0.0000 %** |

**Coincidencia exacta al bit.** Es esperable: con J=0 la torsión no interviene en flexión
pura, y un solo elemento con carga distribuida reproduce la solución de Euler-Bernoulli
exactamente (PyNite integra la carga con las funciones de forma cúbicas exactas).

**Tolerancias para el golden de Fase 3** (heredadas de esta medición): error real ≈ 0 %.
El golden puede usar `TOL_REL = 0.001` (0.1 %) con holgura sobrada para el cambio de build
numpy/scipy local↔Pyodide. No hace falta más margen: la solución es analíticamente exacta.

---

## (3) Vigueta ANCLADA al pórtico — hallazgo mayor

Mini-modelo: 4 pilares empotrados + 2 vigas de contorno paralelas a X + 1 vigueta
paralela a Z, biarticulada (releases del proyecto), **compartiendo nudos** con las vigas.
Sin apoyos nodales extra en la vigueta. Carga solo sobre la vigueta.

- **Caso realista (J=0 en TODAS las barras, como el proyecto): INESTABLE.** Los nudos
  compartidos `vig_i`/`vig_j` salen **inestables en RX (torsión)**. Motivo: las vigas de
  contorno que llegan a esos nudos van en X; su única rigidez frente al giro RX del nudo
  sería su rigidez torsional `G·J`, y **con J=0 no aportan RX**. La cadena
  biarticulada + `J=0` deja RX sin rigidez en **cualquier** nudo cuyas barras adyacentes
  no lo retengan — **el problema de torsión no es exclusivo de la vigueta aislada, reaparece
  anclada al pórtico**.
- **Contraste (J=1e-5 ficticio, solo para aislar la causa): ESTABLE**, y la vigueta
  **descarga perfectamente** en las vigas: `ΣV_bases = 25.0000 kN` = `q·L_vigueta = 25 kN`
  (residuo 3.5e-15), cortantes en los extremos de la vigueta `+12.500 / −12.500 kN`. Físico:
  la mitad de la carga baja a cada viga de contorno; el pórtico la conduce a las bases.

**Implicación para el corte:** aunque el borde tenga viga de contorno (la vigueta comparte
nudo con una viga, no con un apoyo nodal), **con J=0 el nudo compartido puede quedar
inestable en RX**. El discretizador debe garantizar rigidez torsional en esos nudos.
Opciones a decidir en la Fase 1 (fuera del alcance de este spike, que solo mide):

1. **Coartar RX en el nudo de apoyo de la vigueta** (apoyo nodal en el borde sin viga) —
   ya cubierto por el patrón recomendado de (1). Para el borde CON viga de contorno,
   habría que fijar RX en el nudo compartido o…
2. **Dar una J≠0 realista a las barras** (constante de torsión de St. Venant con β(h/b),
   deuda ya anotada en `seccionRectangular`). Resolvería RX físicamente en todos los nudos,
   pero es un cambio transversal de la biblioteca (afecta a toda barra, no solo viguetas).

Este spike **no elige** entre las dos: mide, confirma el mecanismo y deja la decisión al
plan de la Fase 1.

---

## Recomendación final

**ApoyoFEM exacto por extremo para la vigueta AISLADA** (borde sin viga de contorno):

```
i (arranque):  { DX: true,  DY: true, DZ: true, RX: true, RY: true, RZ: true }
j (final):     { DX: false, DY: true, DZ: true, RX: true, RY: true, RZ: true }
```

Lectura: cada extremo restringe TODO salvo DX; DX se ancla solo en `i` (un member
biarticulado con carga transversal no tiene axil, así que un único DX fija el eje
longitudinal sin reacción espuria). Restringir RY/RZ **no** empotra: la rótula vive en el
`def_releases` del member, no en el nudo.

### Sorpresas

1. **El candidato del plan (i:DY+DX+DZ, j:DY+DZ) NO basta.** Faltan RX, RY, RZ en ambos
   extremos. El plan subestimó cuántos GDL rotacionales quedan sin rigidez con J=0 + releases.
2. **PyNite 2.0.2 CAZA estos mecanismos y lanza** (a diferencia de la basculación colineal
   de losa plana): `_check_stability` mira la diagonal y detecta `K[i,i]=0`. Aquí el guard
   nodal fue suficiente. Pero **no es una garantía general** — la singularidad por
   acoplamiento fuera de la diagonal sigue dando NaN silencioso.
3. **La torsión (RX con J=0) reaparece INCLUSO anclada al pórtico.** El nudo compartido con
   la viga de contorno queda inestable en RX porque ninguna barra da rigidez torsional con
   J=0. No es un problema solo del caso aislado.
4. **Coincidencia exacta al bit** con la analítica (error 0.0000 %): golden de Fase 3 con
   `TOL_REL = 0.001` es holgado.
