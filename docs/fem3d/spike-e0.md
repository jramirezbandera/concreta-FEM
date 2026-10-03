# Spike E0 — resultado

> **Fecha:** 2026-10-03. **Plan:** S7 de `investigacion-id.md` (motor propio: TypeScript + núcleo `faer` en WASM).
> **Veredicto: pasan los cuatro criterios.** Se puede comprometer la Fase 1 (E1). Quedan dos cosas por cerrar fuera de la máquina: ver el CI en verde en GitHub (hace falta un push) y medir en móvil.
>
> **Cómo leerlo:** la tabla de abajo resume los criterios; cada sección da el detalle y la evidencia. Los hallazgos nuevos que cambian algo del plan están en «Hallazgos del spike».

| # | Criterio (S7) | Resultado | Evidencia |
|---|---|---|---|
| 1 | La DKMQ en TypeScript coincide con `Quad3D` de PyNite a 1e-10 en flexión pura | **Pasa.** k a 7e-16 en 35 elementos. En 5 placas: u a ≤ 2,3e-14, M a ≤ 3,8e-14 y Q a ≤ 8,2e-14 | `src/elementos/dkmq.test.ts`, `spike/e0/dkmq/out_criterio1.json` |
| 2 | Viga en el plano de un muro y muro 1×3 a ≤ 5 % de OpenSeesPy `ASDShellQ4` | **Pasa.** Muro 1×3: −3,9 %. Viga embebida según la regla de H05: −3,2 % a −0,1 % | `src/elementos/membrana.test.ts`, `spike/e0/membrana/out_explorar.txt` |
| 3 | faer-WASM: 360 000 GDL en ≤ 15 s y ≤ 2,5 GB; 165 000 GDL en ≤ 5 s | **Pasa, en Chrome 154.** 360 360 GDL: 8,5 s y 1,1 GB. 164 472 GDL (K real): 1,0 s y 277 MB | `spike/e0/solver/out_wasm_chrome.txt`, `out_wasm_node.txt` |
| 4 | `.wasm` ≤ 1,5 MB; toolchain de Rust en Windows y en CI | **Pasa en Windows:** 234 KiB (76 KiB gzip), sha256 reproducible. **CI:** workflow escrito, falta verlo correr en GitHub | `src/nucleo/pkg/MANIFIESTO.json`, `.github/workflows/ci.yml` |

---

## 1. Criterio 1: DKMQ frente a PyNite

**Qué se hizo.**
- `src/elementos/dkmq.ts` porta `ke_b`, `B_b`, `B_s`, `fer`, `moment` y `shear` de `Pynite/Quad3D.py` 3.2.0 (MIT, citado en `NOTICE`).
- **GDL:** [w, θx, θy] por nudo, con la regla de la mano derecha. Por dentro trabaja con los giros de Batoz (βx = θy, βy = −θx).
- **Esfuerzos:** convenio del motor tipo CSI (H02). Mx, My y Mxy tienen el signo contrario al de PyNite; Qx y Qy, el mismo.
- **Oráculo congelado** (`spike/e0/dkmq/oraculo_pynite.py` → `src/elementos/__fixtures__/dkmq-pynite.json`):
  - 35 elementos: cuadrados, rectángulos 4:1, paralelogramos, trapecios, distorsionados, 12 aleatorios girados en su plano y 3 inclinados en el espacio. Espesores de L/1000 a L/1,1 y ν de 0 a 0,45;
  - 5 placas: apoyadas delgada, gruesa y distorsionada; empotrada rectangular; empotrada distorsionada delgada.

**Resultado.**

| Qué | Error relativo máximo | Criterio |
|---|---|---|
| Rigidez de flexión 12×12 (35 elementos) | 7,0e-16 | 1e-10 |
| Carga nodal de presión | 3,3e-16 | 1e-10 |
| Desplazamientos (5 placas) | 2,3e-14 | 1e-10 |
| Momentos en el centroide y en un punto de Gauss | 3,8e-14 | 1e-10 |
| Cortantes | 8,2e-14 | 1e-10 |
| Equilibrio ΣF / ΣM (regla de oro 2) | 1,8e-14 / 9,9e-15 | 1e-9 |

**Propiedades:**
- simetría;
- exactamente 3 modos rígidos de flexión;
- K global invariante ante el nudo de inicio;
- patch test de flexión de MacNeal–Harder (t = 0,001 y 0,01): nudos interiores exactos, momentos constantes y cortante nulo.

## 2. Criterio 2: membrana con drilling frente a ASDShellQ4

### Formulación

`src/elementos/membrana.ts` implementa la membrana de Ibrahimbegovic–Taylor–Wilson (1990) sobre el funcional de Hughes–Brezzi (1989):
- desplazamientos tipo Allman;
- giro independiente bilineal (el GDL de drilling);
- penalización de (ω − ψ), integrada con Gauss 2×2, con γ = G.

Es código propio, escrito a partir de los artículos. No se copió nada de OpenSees.

**Modo espurio encontrado y corregido.** En los paralelogramos (también cuadrados y rectángulos) el elemento tiene un 4.º modo de energía nula: ψ en hourglass (+1, −1, +1, −1) con un campo de desplazamientos asociado.
- Se estabiliza con el vector hourglass de Flanagan–Belytschko sobre ψ, ortogonal a los campos lineales. No toca los modos rígidos ni el patch test.
- Coeficiente: 1e-2·γ·t·A. Los resultados no cambian entre 1e-3 y 1e-1.
- Con eso, cualquier forma tiene exactamente 3 modos rígidos de membrana y la lámina completa (DKMQ + membrana), 6.

### Exploración de variantes

Detalle en `spike/e0/membrana/explorar.ts` → `out_explorar.txt`. Error frente a `ASDShellQ4`:

| Variante | Muro 1×3 | Muro 2×6 con γ = G/1000 | MacNeal–Harder trapecio (cortante) | Viga 12×12 embebida 1 elemento |
|---|---|---|---|---|
| **2×2, γ = G (elegida)** | **−3,9 %** | **−0,1 %** | **0,78** | **−7,6 %** |
| 2×2 + modos incompatibles | 0,0 % | **+167 %** | 0,88 | −6,5 % |
| Drilling con integración reducida | −3,9 % | — | 0,80 | −7,2 % |
| Reducida + incompatibles | 0,0 % | +208 % con γ = G | — | inestable (6 modos nulos) |

**Por qué se descartan los modos incompatibles.** Mejoran MacNeal–Harder, pero hacen el elemento muy sensible a γ. La batería de S7 exige que el resultado aguante γ entre 1e-3·G y G.

**Insensibilidad a γ de la elegida:**
- muro 4×12: 1,5395 / 1,5412 / 1,5417 mm con γ = G, G/10 y G/1000;
- viga embebida 6×6: 6,14 / 6,23 / 6,27 mm.

### Resultados de la variante elegida

| Caso | Motor | ASDShellQ4 | Diferencia | Otra referencia |
|---|---|---|---|---|
| Muro 3×9, malla 1×3 | 1,4377 mm | 1,4956 mm | **−3,9 %** | Timoshenko 1,5552 (−7,6 %) |
| Muro 2×6 | 1,5145 | 1,5200 | −0,4 % | |
| Muro 4×12 | 1,5395 | 1,5409 | −0,1 % | |
| Muro 8×24 | 1,5473 | 1,5479 | −0,04 % | ASDShellQ4 16×48: 1,5500 |
| Viga en muro 6×6, embebida 1 elemento (= canto) | 6,138 mm | 6,340 | **−3,2 %** | |
| Viga en muro 6×6, embebida todo el ancho | 6,110 | 6,293 | −2,9 % | |
| Viga en muro 12×12, embebida 2 elementos (= canto) | 6,430 | 6,451 | **−0,3 %** | |
| Viga en muro 12×12, embebida todo el ancho | 6,360 | 6,367 | −0,1 % | |
| Viga en muro 12×12, embebida 1 elemento (0,25 m < canto) | 7,128 | 7,718 | −7,6 % | Fuera de la regla de H05 |
| Viga unida en un nudo, 6×6 / 12×12 | 8,2 / 17,7 mm | 356 / 1 333 mm | — | PyNite: 5 786 / 8 222 mm |

**Equilibrio.** ΣF y ΣM quedan a ≤ 2e-13 en todos los casos, también con la viga unida en un nudo (en PyNite, ΣM = 0,49). El giro de drilling tiene rigidez real: H05 queda resuelto.

**MacNeal–Harder** (cociente frente a la referencia):

| Malla | Carga | Motor | ASDShellQ4 | ShellDKGQ |
|---|---|---|---|---|
| Rectangular | Cortante | 0,904 | 0,987 | 0,904 |
| Rectangular | Momento | 0,910 | 0,994 | 0,910 |
| Trapezoidal | Cortante | 0,782 | **0,051** | 0,806 |
| Paralelogramo | Cortante | 0,787 | 0,592 | 0,873 |

### Lecturas

- **La unión en un solo nudo sigue siendo singular** con cualquier formulación (S7 ya lo anticipaba): en `ASDShellQ4` pasa de 356 a 1 333 mm al refinar y aquí de 8 a 18 mm. Pero ya no es un mecanismo: el error pasa de ×1 200 (PyNite) a ×1,3–2,8.
  - **La regla del compilador de H05 se mantiene:** embeber la viga al menos max(1 elemento, canto).
  - El caso 12×12 embebido 1 elemento no cumple la regla, y es el único que queda fuera del 5 %.
- **`ASDShellQ4` bloquea mucho en mallas distorsionadas** (0,05 en el trapecio de MacNeal–Harder). Como oráculo de membrana sirve en mallas regulares; en las distorsionadas hay que contrastar también con `ShellDKGQ`.
- **La membrana elegida es tan rígida como `ShellDKGQ`** en la viga rectangular de MacNeal–Harder (0,90). Es el precio de no usar modos incompatibles. Mantener los ≥ 8 elementos por paño de H17 da ≤ 0,4 % en el muro.

## 3. Criterio 3: faer en WASM

**Núcleo** (`kernel/`, ~250 líneas de Rust):
- faer 0.24.4, un hilo, SIMD128;
- análisis simbólico con AMD o con una permutación dada;
- LDLᵀ supernodal repetible sobre el mismo patrón;
- resolución por bloques de lados derechos;
- diagonal D para la inercia y los pivotes.

**API WASM:** 5 funciones, sin copias de los arrays grandes (JS escribe directamente en la memoria WASM). El envoltorio TypeScript es `src/nucleo/index.ts`.

**Matrices:**
- las K reales del edificio objetivo (`vec_asm.py`, H51/H52; con barras de penalización);
- las sintéticas de 07-candidatos.

Se convierten a `.kcsc` con `spike/e0/solver/preparar_k.py`.

### Tiempos

Tiempos de factorización con 24 lados derechos. Ryzen 9 5900X; WASM en Chrome 154 (Worker) y en Node 24, que coinciden a ±3 %.

| K | GDL | nnz(L) | faer nativo, 1 hilo | **faer WASM (Chrome)** | Heap WASM | Total con 24 casos | Proxy CHOLMOD en Pyodide (H50) |
|---|---|---|---|---|---|---|---|
| V3 unidireccional | 44 268 | 5,3 M | 0,08 s | 0,33 s | 70 MB | 0,5 s | — |
| **V1 h = 0,75 (objetivo)** | **164 472** | 18,2 M | 0,27 s | **1,04 s** | **277 MB** | 1,7 s | SuperLU 3,6 s, 2,3–2,8 GB |
| V1 h = 0,5 | 312 816 | 41,4 M | 0,61 s | 2,46 s | 568 MB | 3,8 s | SuperLU 8,4 s, 4,0 GB |
| V2 reticular h = 0,5 | 377 454 | 44,2 M | 0,65 s | 2,69 s | 638 MB | 4,2 s | — |
| V1 h = 0,35 | 680 646 | 86,8 M | 1,30 s | 5,44 s | 1 210 MB | 8,3 s | — |
| Sintética n = 64 | 180 240 | 45,9 M | 0,73 s | 3,46 s | 526 MB | 4,5 s | 4,17 s, 1 035 MB |
| **Sintética n = 90** | **360 360** | 98,7 M | 1,85 s | **8,51 s** | **1 103 MB** | 10,6 s | 11,18 s, 1 920 MB |
| Sintética n = 113 | 566 538 | 154 M | 3,03 s | 13,86 s | 1 721 MB | 17,1 s | 21,96 s, 2 814 MB |

**Comparaciones:**
- **Frente al proxy de H50,** faer en WASM es más rápido que CHOLMOD supernodal (que es GPL) en Pyodide y ocupa un 40 % menos de memoria.
- **Las K reales del edificio son mucho más fáciles que las sintéticas:** la del tamaño objetivo cabe en 1 s.
- **Solver de perfil en TypeScript** (`src/solver/perfil.ts`, RCM; `out_perfil.txt`):
  - 39 096 GDL sintéticos: 107 s y 475 MB, frente a 0,65 s de faer (unas 165 veces más lento);
  - K real V1 h = 1,0 (94 206 GDL): 248 s y 1 069 MB, frente a 0,66 s (unas 375 veces);
  - K real V3 (44 268 GDL): más de 600 s, cortado.

  La vía «TS puro» queda descartada salvo como referencia en modelos pequeños. Coincide con faer a ≤ 1e-12.

## 4. Criterio 4: tamaño y toolchain

- **Tamaño:** el `.wasm` pesa 239 295 B (77 344 B en gzip); el límite era 1,5 MB.
- **Cadena:** rustc 1.99.0 (fijado en `kernel/rust-toolchain.toml`) → wasm-bindgen 0.2.129 → wasm-opt 133. Se lanza con `bun run nucleo:compilar`.
- **Reproducible:** el `.wasm` llevaba las rutas de la máquina en los mensajes de pánico.
  - Se reescriben con `--remap-path-prefix`, porque `trim-paths` aún no es estable en Cargo 1.99.
  - `bun run nucleo:verificar` recompila desde cero y compara el sha256.
  - Da el mismo hash con otro directorio `target` y con otro `CARGO_HOME` (crates descargados de nuevo).
- **CI:** `.github/workflows/ci.yml`, con dos jobs en Windows:
  - pruebas: bun, tsc y vitest, sin Rust;
  - núcleo: recompila, verifica el sha256 y pasa `cargo test`.

  Es Windows porque las barras de las rutas dependen del sistema. **No se ha ejecutado:** hace falta hacer push.

## Hallazgos del spike

| ID | Hallazgo | Consecuencia |
|---|---|---|
| E0-1 | **En WASM, faer va ~4,5× más lento que en nativo,** y quitar `+simd128` apenas cambia nada (3,43 s frente a 3,35 s). Los núcleos densos de los supernodos no aprovechan bien SIMD128 | Palanca de optimización para E4: relaxed-simd (FMA), revisar el *dispatch* de `pulp` en wasm32, factorizar en f32 y refinar. No hace falta para el objetivo |
| E0-2 | **Residuo de 1,5e-9 en la K de V3,** que tiene barras de penalización (α = 1e3). §2.7 pide 1e-10 | Añadir refinamiento iterativo al núcleo (E4). Sin penalización (MPC por transformación) la K estará mejor condicionada |
| E0-3 | **faer sólo da error con pivotes exactamente nulos,** y su índice va en base 1 en la simplicial y en base 0 en la supernodal (corregido en `kernel/src/factor.rs`) | Los mecanismos se diagnostican con `diagonal()`: D pequeño frente a la diagonal de K (H12), en E1 |
| E0-4 | **La membrana tipo Allman tiene un modo espurio en los paralelogramos.** Los modos incompatibles la hacen sensible a γ | Estabilización hourglass; formulación elegida en la §2 |
| E0-5 | **`ASDShellQ4` bloquea en MacNeal–Harder distorsionado** (0,05) | Contrastar las membranas también con `ShellDKGQ` |
| E0-6 | **La unión barra–lámina en un nudo** sigue siendo singular, pero deja de ser un mecanismo | Se mantiene la regla del compilador de H05 |
| E0-7 | **OpenSeesPy 3.8 no carga con Python 3.14 en Windows** (DLL) | Oráculo OpenSees en `.venv312` (Python 3.12.10 del gestor oficial `py install 3.12`) |
| E0-8 | **El solver de perfil en TS** es entre 165 y 375 veces más lento que faer-WASM | Sólo como oráculo diferencial y para modelos ≤ ~10 000 GDL (S7 decía 30 000) |

## Pendiente

- **Ver el CI en verde en GitHub.** Hace falta un push. Ojo: `gh` muestra el repositorio como **público**, aunque CLAUDE.md y el README dicen que es privado.
- **Medir en móvil y portátil** (S5 #2). El heap del objetivo es de 277 MB, dentro del rango estimado de iOS (300 MB–1 GB), pero sin medir.
- **Llevar a `src/pruebas/`** los modelos de membrana (`spike/e0/membrana/modelos.ts`), de los que ya dependen los tests de `src/`.

## Cómo reproducir

```sh
bun install
bun run test:run                                    # 119 tests (criterios 1 y 2, núcleo, perfil)
bun run nucleo:verificar                            # recompila y compara el sha256 (criterio 4)
.venv/Scripts/python.exe spike/e0/dkmq/oraculo_pynite.py          # oráculo PyNite (criterio 1)
.venv312/Scripts/python.exe spike/e0/membrana/oraculo_opensees.py # oráculo OpenSees (criterio 2)
bun spike/e0/membrana/explorar.ts todas             # variantes de la membrana
.venv/Scripts/python.exe spike/e0/solver/preparar_k.py npz <K11.npz> spike/e0/datos/X.kcsc
node spike/e0/solver/bench-wasm.mjs spike/e0/datos/X.kcsc         # criterio 3 en Node
node spike/e0/solver/bench-chrome.mjs X ...                       # criterio 3 en Chrome headless
cd kernel && cargo run --release --example bench -- ../spike/e0/datos/X.kcsc   # nativo
```

Las K del edificio (`K11_*.npz`) salen de `investigacion/experimentos/06-escala/exp_vec.py --save`. Las sintéticas se generan con `preparar_k.py sintetico <n>`.
