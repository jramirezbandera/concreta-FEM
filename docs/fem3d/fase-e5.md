# Fase E5 — Q y bandas: resultado

> **Fecha:** 2026-10-04. **Plan:** S7 de `investigacion-id.md` (fase E5: «SPR y corte por fuerzas nodales»), con H18 (el Q de la DKMQ no sirve para comprobar), H25 (las losas se dimensionan por bandas) y S5 #3 (precisión de un Q recuperado).
> **Veredicto: pasan los seis criterios.**
> - Un corte por fuerzas nodales es exacto: si separa el modelo en dos, cierra el equilibrio con las cargas y reacciones de un lado a ≤ 1,4e-12, también a través de huellas, diafragmas y barras. En el edificio objetivo, a 1,5e-11.
> - El Q recuperado por SPR converge con orden 2 y su error no depende del espesor. Con 16 elementos por vano queda en −1,8 %, frente al −17…−42 % del Q de la DKMQ (H18). **S5 #3 queda cerrada.**
> - Las bandas por «campos» valen en cualquier posición: My con orden 2 y las integrales de banda de Navier a ≤ 0,4 % con h = 0,125 m.
> - En el edificio objetivo, un mapa SPR cuesta 0,2–0,4 s por combinación, una banda 70 ms y un corte de planta 0,5 s, con los 24 casos.
>
> **Hallazgo principal (E5-5):** en la cara de un pilar, los valores puntuales recuperados se quedan cortos (la integral de Mx de la banda, un 7–21 % por debajo según la malla), mientras que la integral por fuerzas nodales es exacta y no depende de la malla. Las caras de los apoyos se dimensionan con el corte por fuerzas nodales; el compilador tiene que sembrar en la malla las caras y los bordes de las bandas.
>
> **Cómo leerlo:** la tabla resume los criterios, que se fijaron al empezar la fase. Cada sección da el detalle y la evidencia. Los hallazgos que cambian algo del plan están en «Hallazgos de E5».

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | Fuerzas nodales g = k·u − f_eq de barras y láminas, y fuerzas de las restricciones sobre sus nudos: k·u autoequilibrado y Σg = P + R + C en cada nudo, cadenas incluidas | **Pasa.** k·u ≤ 1,0e-13; equilibrio de los nudos ≤ 2,2e-12 con huellas encadenadas al diafragma | `src/motor/fuerzasNodales.test.ts`; `validacion/e5/out_resumen.txt` |
| 2 | Corte por fuerzas nodales: un corte completo = −(cargas + reacciones del lado A) a ≤ 1e-9; soluciones cerradas isostáticas sin error de malla; una barra cortada da su diagrama; metamórficas ≤ 1e-9 | **Pasa.** Cortes completos ≤ 1,4e-12 en 6 modelos y 19 cortes. Losa unidireccional ≤ 3,7e-14; ménsula 9,5e-14; barra cortada = diagrama de E2 a 0; metamórficas ≤ 4,2e-12 | `src/motor/cortes.test.ts`; `out_resumen.txt` |
| 3 | SPR: exacto donde la DKMQ lo es (patch test, ménsula); orden 2 frente a Navier; Q ≤ 5 % con h/t ≈ 2 en la réplica de exp01d (S5 #3); metamórficas ≤ 1e-9 | **Pasa.** Patch test ≤ 5,4e-11; ménsula ≤ 1,7e-12, también con una sola fila. Q del centroide junto al apoyo: −1,8 % con 16 elementos por vano (h/t 1,6 y 2,5) y orden 2. Navier: M, Mxy y Q nodales ≤ 0,32 % con h = 0,125. Metamórficas ≤ 7,2e-13 | `src/motor/campos.test.ts`; `out_spr.txt`, `out_spr_variantes.txt` |
| 4 | Bandas por «campos» en cualquier posición: soluciones cerradas, integrales de banda de Navier y losa plana de H25 con huella; un corte alineado da lo mismo por los dos métodos | **Pasa.** Losa unidireccional fuera de la malla: My 0,34 % (orden 2), Vz 1,4 %. Navier: ∫Mx dy y ∫Qx dy ≤ 0,38 % con h = 0,125. Losa plana: «campos» = fuerzas nodales a 1e-9 en cortes alineados; banda de pilar en la cara estable a ±0,15 % entre mallas | `src/motor/bandas.test.ts`; `out_bandas.txt` |
| 5 | Diagnósticos de los cortes y de los campos; ningún falso positivo | **Pasa.** 8 situaciones, cada una con su código; los 19 cortes de la validación no dan ninguno | `cortes.test.ts`, `bandas.test.ts` |
| 6 | Edificio objetivo con 24 casos: mapas, bandas y cortes en una fracción del cálculo (3,1 s) | **Pasa.** SPR de un caso: 0,40 s (el primero) y 0,22 s (los siguientes). Corte de planta 0,51 s; corte vertical por los 7 diafragmas 1,5 s; banda por campos 69 ms | `validacion/e5/banco.ts` → `out_banco.txt` |

Además, como pide la regla de oro 1, hay una referencia congelada de cortes y campos de tres modelos (`src/motor/congelado-e5.test.ts`), con los dos solvers.

---

## 1. Qué hay nuevo

| Fichero | Qué hace |
|---|---|
| `src/motor/fuerzasNodales.ts` | `FuerzasNodales`: g = k·u − f_eq por barra y por lámina (con las equivalentes de cada elemento), Σg por nudo y las fuerzas de cada restricción sobre sus nudos, resueltas desde las hojas de las cadenas. Por lotes de casos: la rigidez de cada elemento se calcula una vez |
| `src/motor/cortes.ts` | `Cortes`: esfuerzos [N, Vy, Vz, T, My, Mz] que atraviesan un plano recortado a un rectángulo, por fuerzas nodales o por campos, con diagnósticos y, por campos, las muestras a lo largo del corte |
| `src/motor/campos.ts` | `CamposLaminas`: regiones, SPR con Q por equilibrio, evaluación en cualquier punto y el integrador de los cortes por campos |
| `src/motor/laminas.ts` | `cargasDeLaminasDelCaso` puede devolver las equivalentes de cada lámina |
| `validacion/e5/` | Medidas de los criterios, bandas, banco, resumen y referencia congelada |

**Uso:**

```ts
const r = calcular(modelo);                       // un cálculo válido
const cortes = new Cortes(modelo);
const campos = new CamposLaminas(modelo);         // regiones y parches, una vez

// Banda de pilar en la cara de un pilar (sigue la malla: exacto)
const cara = cortes.cortar({ origen: [6.3, 6, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-1.5, 1.5] }, r.casos);
cara.esfuerzos;                                   // [N, Vy, Vz, T, My, Mz] por caso (6·nc)

// Estación en el vano, fuera de la malla, con los valores punto a punto (Wood–Armer)
const vano = cortes.cortar({ origen: [3.1, 6, 0], x: [1, 0, 0], vz: [0, 0, 1], y: [-1.5, 1.5], metodo: "campos" }, r.casos, campos);
vano.muestras;                                    // puntos, pesos y [Nx … Qy] en ejes de la franja, por caso

// Mapas: valores nodales continuos (por región) de una combinación, con su u = Σ λₖ·uₖ
const u = new Float64Array(r.casos[0].u.length);
r.casos.forEach((c, k) => c.u.forEach((v, i) => (u[i] += factores[k] * v)));
campos.en(l, u, xi, eta);                         // [Nx, Ny, Nxy, Mx, My, Mxy, Qx, Qy] en los ejes de la lámina
campos.enNudos(l, u);                             // 4 × 8, continuos dentro de la región
```

Todo es lineal en (u, cargas): los esfuerzos de un corte en una combinación son la combinación de los de sus casos, y los campos de una combinación son los de su u combinado.

**Convenio de los cortes:** el de las barras (cabecera de `modelo.ts`), con el plano del corte como sección:
- **Ejes:** x = la normal del plano; z = `vz` proyectado; y = z × x.
- **Qué se mide:** lo que el lado +x (B) ejerce sobre el −x (A), reducido al origen del corte.
- **Signos:** My > 0 comprime la fibra +z y Mz > 0 la +y.
- **Lectura:**
  - una franja de losa cortada con z = la normal de la losa se lee como una viga: My es el momento de vano y Vz el cortante;
  - un machón de muro cortado en horizontal con x hacia arriba, como un pilar.
- **Nudos del corte:** los que están a menos de `TOL_CORTE` = 1e-6 m del plano (la tolerancia numérica de H28) son del lado B. Una carga nodal sobre ellos no entra, como una puntual en el extremo de una barra.

**Qué entra en un corte:**

| Objeto | Cómo |
|---|---|
| Lámina que toca el plano desde A, con el centroide dentro del rectángulo | Sus fuerzas nodales en los nudos del corte (los dos métodos) |
| Lámina que atraviesa el plano | Por fuerzas nodales, error; por campos, la integral de los campos recuperados a lo largo de su intersección, recortada al rectángulo, con la fuerza de borde libre de Kirchhoff si el tramo acaba en un borde libre (E5-4) |
| Barra que atraviesa el plano | Su esfuerzo exacto en el cruce (diagrama de E2), o la fuerza de su nudo del lado A si el cruce cae en un offset rígido |
| Barra que toca el plano en un nudo desde A | Su fuerza nodal en ese nudo |
| Restricción con nudos a los dos lados | Σ de sus fuerzas sobre sus nudos del lado A (E5-1) |
| Restricción partida por el borde del rectángulo | No se puede atribuir: sus componentes quedan en NaN, con aviso |

**Decisiones de diseño que conviene revisar:**
- **El corte es un plano recortado a un rectángulo,** como las *section cuts* de ETABS, no una polilínea:
  - cubre franjas de losa, machones de muro y plantas enteras;
  - un perímetro de punzonamiento (una polilínea cerrada) queda fuera (ver «Pendiente»).
- **El lado A de una lámina lo decide su centroide.** Si el borde del rectángulo no sigue la malla, la lámina entra o sale entera, con un aviso y la extensión real en `extension`.
- **«Campos» es mixto** (E5-6): donde el corte sigue la malla usa fuerzas nodales y sólo integra campos en las láminas que atraviesa.
- **SPR por centroides con parches de dos coronas,** no por puntos de Gauss (E5-2). Base cuadrática; en los bordes, la media de los parches interiores vecinos. Las regiones de una sola fila de láminas se degradan con aviso.
- **Una región por superficie y sección:** coplanaria, conexa y con el mismo material, multiplicadores y eje 1 si no es isótropa. En un borde entre regiones (losa–muro, ábaco–reticular), cada nudo tiene un valor por región. Las láminas de una huella (sus 4 nudos en un mismo enlace rígido) no entran en ninguna región.
- **Las muestras de un lado sobre el plano** las da la lámina coplanaria del lado A o, si ésa es rígida (la cara de una huella), la del lado B.

## 2. Criterio 1: fuerzas nodales

La fuerza nodal de un elemento es lo que sus nudos ejercen sobre él: g = k·u − f_eq. Con las cargas del propio elemento está en equilibrio. En cada nudo, la suma de las g de sus elementos es la carga nodal más la reacción más lo que le dan las restricciones: Σg = P + R + C.

Las fuerzas de cada restricción se calculan cuerpo a cuerpo. Un cuerpo rígido no tiene masa, así que:
- **en cada esclavo,** la fuerza del cuerpo es la C de su nudo (un GDL sólo es esclavo de una restricción), menos lo que reciba como maestro de otras;
- **en el maestro,** la que cierra el equilibrio del cuerpo.

En la cadena huella → cabeza de pilar → diafragma, primero se resuelve la huella y luego el diafragma. Un diafragma sólo da fuerzas en sus GDL (ux, uy, rz).

| Modelo | k·u autoequilibrado | Σg = P + R + C en todos los nudos y componentes |
|---|---|---|
| Lámina plegada | 1,0e-13 | 3,5e-13 |
| Edificio E3 con diafragma y huellas | 5,1e-14 | 2,2e-12 |
| Edificio E3 con muelles | 1,0e-13 | 1,1e-12 |

La comprobación de los nudos cubre a la vez los GDL libres de los esclavos, el cierre del equilibrio de cada cuerpo en su maestro y el reparto entre los dos cuerpos de una cadena.

## 3. Criterio 2: corte por fuerzas nodales

**Oráculo de equilibrio** (`validacion/e5/cortes.ts`): si un corte separa el modelo en dos, lo que B ejerce sobre A es exactamente −(cargas + reacciones de A). La resultante de las cargas se calcula por otro camino que el corte:
- con las resultantes reales de E2 y E3 (integrales cerradas, no las fuerzas equivalentes);
- partiendo las cargas de las barras que cruzan el plano;
- más las cargas nodales y las reacciones de los nudos de A.

| Modelo | Cortes | Peor error |
|---|---|---|
| Losa unidireccional (12 × 4) | 5 planos verticales | 6,2e-13 |
| Lámina plegada | x = 2, y = 1 (hacia −Y) y z = 1 | 3,2e-13 |
| Edificio E3 con diafragma y huellas | Planta (z = 3); x = 2, que atraviesa los diafragmas; x = 5 e y = 4, que atraviesan las huellas | 1,4e-12 |
| Edificio E3 con diafragma, sin muro | A media altura de las plantas 1 y 2 (pilares cortados por el tramo flexible, con cargas de viento partidas) | 8,6e-13 |
| Edificio E3 con muelles | Planta 2; x = 6 y x = 5 (huellas) | 2,5e-13 |
| Pórtico (offsets, rótula, cargas de barra) | Por la viga y por los pilares | 1,5e-15 |

**Soluciones cerradas isostáticas,** que el corte da sin error de malla:
- **Losa unidireccional** de 6 × 2 m con ν = 0,2 (con efecto de placa), en todas las líneas de dos mallas: My = −q·b·x(L − x)/2 a 3,7e-14, Vz = q·b(L/2 − x) a 2,3e-14 y N, Vy, T, Mz nulos a 7,2e-15.
- **Ménsula** con ν = 0,3: My = −F·b(L − x) y Vz = −F·b a 9,5e-14.

**Convenio:** una barra cortada por un plano normal a su eje, con su vz, da su diagrama de E2 exacto (a 0). Con la normal al revés, Vz y Mz cambian de signo y el resto no.

**Metamórficas** (giro del modelo y del corte, renumeración, inversión del sentido de las barras e inversión del orden de los nudos de las láminas): los esfuerzos no cambian, a ≤ 2,2e-12 (lámina plegada), 2,3e-14 (pórtico), 1,5e-12 (edificio con muelles) y 4,2e-12 (edificio con diafragma, girado en torno a Z).

## 4. Criterio 3: campos recuperados (SPR)

**Por qué SPR y no el Q de la DKMQ.** Con mallas de obra, el Q de la DKMQ (Hs·γ, con el factor φ/(1+φ)) queda un 30–50 % bajo y del lado inseguro (H18). El motor propio lo confirma (E3-4). En cambio, Q = −(∂Mx/∂x + ∂Mxy/∂y) sale del equilibrio y no depende del espesor, si las derivadas de M son buenas.

**Exactitud** (`campos.test.ts`, `out_resumen.txt`):

| Prueba | Peor valor |
|---|---|
| Patch test de MacNeal–Harder (5 cuadriláteros irregulares; N y M constantes, Q = 0), isótropo | N 1,5e-11 · M 1,5e-11 · Q 5,4e-11 |
| Ídem, reticular con el eje 1 a 30° | N 7,7e-15 · M 4,8e-15 · Q 2,0e-14 |
| Ménsula con ν = 0 (M lineal, Q constante) en todos los nudos, también los del borde: 8 × 2 / 3 × 3 / una fila | 5,7e-13 / 1,7e-12 / 1,2e-13 |
| Metamórficas, lámina plegada: giro / renumeración / inversión del orden de nudos | 4,8e-13 / 7,2e-13 / 3,0e-13 |
| Ejes de usuario mezclados en una región isótropa (eje 1 a 37° en la mitad de las láminas) | 7,5e-14 |

**Réplica de exp01d** (`out_spr.txt`). Placa cuadrada apoyada («hard») con carga uniforme, en los centroides de la fila central (los mismos puntos que midió H18):

| a/t | Malla | h/t | DKMQ junto al apoyo | DKMQ en a/4 | **SPR junto al apoyo** | **SPR en a/4** |
|---|---|---|---|---|---|---|
| 10 | 8 / 16 / 32 | 1,25 / 0,63 / 0,31 | −13,9 / −4,3 / −1,2 % | −21,9 / −7,1 / −1,9 % | −8,8 / −1,8 / −0,44 % | −2,7 / −0,71 / −0,18 % |
| 25 | 8 / 16 / 32 | 3,1 / 1,6 / 0,78 | −31,3 / −17,1 / −6,2 % | −49,0 / −27,7 / −10,2 % | −8,7 / −1,8 / −0,44 % | −2,7 / −0,69 / −0,18 % |
| 40 | 8 / 16 / 32 | 5,0 / 2,5 / 1,25 | −36,6 / −25,8 / −12,6 % | −57,1 / −41,7 / −20,7 % | −8,6 / −1,8 / −0,44 % | −2,6 / −0,68 / −0,18 % |
| 100 | 8 / 16 / 32 | 12,5 / 6,3 / 3,1 | −40,2 / −35,4 / −28,0 % | −62,8 / −57,3 / −46,3 % | −8,6 / −1,8 / −0,43 % | −2,6 / −0,67 / −0,17 % |

**Lecturas:**
- **El Q recuperado converge con orden 2 y no depende del espesor.** Las cuatro esbelteces dan lo mismo a 0,2 %.
- **S5 #3:** ≤ 5 % con h/t ≈ 2 (a/t = 25 y 40 con malla 16: −1,8 %), frente al −17 % y el −26 % de la DKMQ.
- **El error depende de los elementos por vano** (E5-3): −8,7 % con 8, −1,8 % con 16.

**Placas de Navier de E3** (6 × 4 m), valores nodales:

| Placa (h = 0,5 / 0,25 / 0,125 m) | Mx en el centro | Mxy en la esquina | Qx en el centro del borde | Qy en el centro del borde |
|---|---|---|---|---|
| Isótropa delgada (a/t = 100) | −1,8 / −0,44 / −0,11 % | +3,1 / +0,44 / +0,08 % | −10,0 / −2,1 / −0,31 % | −3,6 / −0,72 / −0,06 % |
| Isótropa gruesa (a/t = 15) | −2,0 / −0,50 / −0,13 % | +3,8 / +0,70 / +0,12 % | −10,1 / −2,2 / −0,32 % | −3,8 / −0,76 / −0,07 % |
| Ortótropa (reticular, a/t = 20) | −2,1 / −0,47 / −0,11 % | +3,1 / +0,48 / +0,10 % | −7,6 / −1,4 / −0,18 % | −5,6 / −1,1 / −0,14 % |

El Q en el nudo del apoyo es el punto más difícil: el polinomio se extrapola media lámina más allá del último centroide. Con 12 elementos por vano (h = 0,5) queda en −10 %. En el interior (a/4), con h = 0,5, es ≤ 0,5 % en las isótropas y −2,4 % en la ortótropa (siempre respecto al Q del borde).

**Variantes descartadas** (`out_spr_variantes.txt`, E5-2):

| Variante | Qx en el centro del borde, isótropa gruesa (h = 0,5 / 0,25 / 0,125) | Lectura |
|---|---|---|
| Puntos de Gauss, cuadrática | +2,6 / +6,0 / +6,8 % | No converge en placas gruesas |
| Puntos de Gauss, bilineal (la de Zienkiewicz–Zhu para Q4) | −23,7 / −9,5 / −1,4 % | Orden 1 en el borde |
| Centroides, bilineal | −37,1 / −21,6 / −11,6 % | Orden 1 en el borde |
| **Centroides, cuadrática** | **−10,1 / −2,2 / −0,32 %** | Orden 2 |

## 5. Criterio 4: bandas

**Losa unidireccional, estaciones fuera de la malla** (x = 0,37 … 5,6 m; el ancho completo es isostático):

| Malla | Error de My (÷ qbL²/8) | Error de Vz (÷ qbL/2) |
|---|---|---|
| 6 × 2 | 1,9e-1 | 3,9e-1 |
| 12 × 4 | 1,3e-2 | 1,0e-1 |
| 24 × 8 | 3,4e-3 | 1,4e-2 |

**Lecturas:**
- **My converge con orden 2.**
- **El error de Vz con 12 × 4** está en las estaciones junto a los apoyos (x = 0,37 y 5,6 m, dentro de la primera lámina): es el Q del borde del SPR.
- **Con 24 × 8 queda en 1,4 %,** el residuo de la capa límite del borde libre (E5-4). Con ν = 0 (sin efecto de placa) Vz es exacto fuera de la malla, a 1e-9.

**Placas de Navier**, integrales a lo ancho de toda la placa (`out_bandas.txt`):

| Placa (h = 0,5 / 0,25 / 0,125 m) | ∫Mx dy en x = 3 (línea de la malla) | ∫Mx dy en x = 1,3 (fuera) | ∫Qx dy en x = 1,3 (fuera) |
|---|---|---|---|
| Isótropa delgada | −1,33 / −0,29 / −0,04 % | −5,4 / −1,3 / −0,36 % | +1,5 / −0,25 / −0,03 % |
| Isótropa gruesa | −0,29 / +0,02 / +0,01 % | −5,7 / −1,4 / −0,38 % | +1,8 / −0,17 / −0,01 % |
| Ortótropa | −0,76 / −0,17 / −0,04 % | −5,4 / −1,3 / −0,35 % | −3,1 / −1,3 / −0,28 % |

En la línea de la malla, el corte usa fuerzas nodales (método mixto): es la integral de la propia solución de elementos finitos. Por eso es mejor que la de los campos fuera de ella.

**Losa plana de H25** (12 × 12 m, t = 0,25 m, 3 × 3 pilares con una huella de 0,6 × 0,6 m enlazada a la cabeza y q = 10 kN/m²). Banda de pilar de 3 m y pórtico virtual de 6 m:

| h | My banda, cara (x = 6,3) | My pórtico, cara | Vz banda, cara | My banda, vano (x = 3) | My pórtico, vano |
|---|---|---|---|---|---|
| 0,3 | −205,28 | −262,59 | −262,04 | 76,65 | 138,94 |
| 0,15 | −205,50 | −262,74 | −254,97 | 76,78 | 138,90 |
| 0,075 | −205,58 | −262,71 | −251,51 | 76,98 | 139,00 |

**Lecturas:**
- **La integral de banda en la cara no depende de la malla** (±0,15 %): es exacta en el sentido de los elementos finitos (H25: ±1 %).
- **En estos cortes alineados, «campos» da los mismos valores que las fuerzas nodales,** a 1e-9.
- **El cortante de la banda en la cara** baja un 4 % entre 0,3 y 0,075 m: el reparto entre la banda y el resto de la losa junto a la esquina de la huella es singular. El del pórtico (6 m) se mueve un 1 %.

**Muestras y Wood–Armer en la banda de pilar de la cara** (kN·m; E5-5):

| h | −My exacto | −∫Mx dy de las muestras | ∫ Wood–Armer superior en x, punto a punto | Wood–Armer de los momentos medios × ancho |
|---|---|---|---|---|
| 0,3 | 205,28 | 162,58 | 174,47 | 162,58 |
| 0,15 | 205,50 | 180,52 | 205,51 | 180,52 |
| 0,075 | 205,58 | 191,95 | 223,51 | 191,95 |

En el vano (sin singularidad), las muestras integran al My del corte a ≤ 1 %. En un corte que sólo atraviesa láminas, sin bordes libres ni barras, Σ peso·Mx = My y Σ peso·Qx = Vz a 1e-12.

## 6. Criterio 5: diagnósticos

| Código | Severidad | Cuándo |
|---|---|---|
| `corte/no-valido` | error | Origen, normal o vz no finitos, normal nula, vz paralelo a la normal, rango invertido o método desconocido |
| `corte/atraviesa-laminas` | error | Por fuerzas nodales, el plano atraviesa láminas dentro del rectángulo: el corte no sigue la malla. Sugiere «campos» o sembrar la línea |
| `corte/barra-ambigua` | error | Los offsets de una barra cruzan el plano y vuelven: el corte pasa entre un nudo y su tramo flexible |
| `corte/restriccion-partida` | aviso | Una restricción atraviesa el corte con nudos del lado A fuera del rectángulo. Sus componentes quedan en NaN: todas en un enlace rígido, las de su plano en un diafragma (N, Vy y Mz en una franja de losa) |
| `corte/borde-no-sigue-malla` | aviso | Por fuerzas nodales, láminas que entran enteras aunque parte de su lado quede fuera del rectángulo; la extensión real va en `extension` |
| `corte/vacio` | aviso | El corte no atraviesa nada (por ejemplo, una línea de apoyos: sus nudos son del lado B) |
| `corte/campos-degradados` | aviso | El corte por campos usa nudos de una región de una sola fila de láminas: su Q es aproximado |

Un corte con un error no es válido y no trae esfuerzos (todo NaN). Usar «campos» sin `CamposLaminas` es un error de uso (excepción). Los 19 cortes de la validación no dan ningún diagnóstico.

## 7. Criterio 6: rendimiento en el edificio objetivo

`validacion/e5/banco.ts` → `out_banco.txt`. Es el edificio de los bancos de E1–E3: 29 221 nudos, 28 280 láminas, 2 352 barras, diafragma rígido y 24 casos. El cálculo tarda 3,1 s (Node 24, Ryzen 9 5900X).

| Qué | Tiempo |
|---|---|
| `CamposLaminas`: regiones y plazas (442 regiones, 34 029 plazas) | 153 ms |
| SPR de todo el modelo, primer caso (con los parches) / caso siguiente | 403 / 224 ms |
| `Cortes`: preparación | 92 ms |
| Corte de planta (z = 3 m: 80 pilares y el muro), 24 casos, con las cargas de todos los casos por elemento | 514 ms |
| Corte vertical de todo el edificio (x = 3 m: atraviesa los 7 diafragmas), 24 casos | 1 536 ms |
| Banda de pilar por campos, fuera de la malla, 24 casos | 69 ms |

**Lecturas:**
- **El equilibrio de los dos cortes completos frente al oráculo** es de 1,2e-15 (planta) y 1,5e-11 (vertical): la exactitud se mantiene a escala.
- **El corte vertical es el caso caro:** las fuerzas de un diafragma necesitan las de todas las láminas de la losa. Al calcular la rigidez de cada elemento una vez para todos los casos, bajó de 7,0 s a 1,5 s.
- **La banda avisa de `corte/restriccion-partida`:** con diafragma rígido, su N, Vy y Mz no tienen valor, como se espera.

## Hallazgos de E5

| ID | Hallazgo | Consecuencia |
|---|---|---|
| E5-1 | **Las restricciones transmiten fuerza a través de un corte.** Sin ellas, un corte por una huella o por un diafragma no cierra el equilibrio: en la cara de un pilar, casi todo el momento entra en la huella. Las fuerzas de cada cuerpo se obtienen resolviendo las cadenas desde las hojas, y con ellas el corte es exacto. Con diafragma rígido, la losa no tiene esfuerzos de membrana y lo que transmite el diafragma no se puede repartir entre franjas | Una franja de losa con diafragma da Vz, T y My, y deja N, Vy y Mz en NaN con aviso, igual que ETABS/SAFE (sus losas con diafragma no tienen esfuerzos de membrana). Una planta o un corte completo, en cambio, dan las seis componentes |
| E5-2 | **El SPR con los puntos de Gauss no converge en Q en placas gruesas.** La DKMQ da a M una pendiente espuria dentro de cada lámina: con a/t = 10 y 32 × 32, −2,5 % y +2,2 % del momento máximo entre los dos puntos de Gauss de una fila. Ese diente de sierra decrece como h, así que su derivada no decrece. El centroide no lo tiene (es la media) | El SPR muestrea en los centroides, con parches de dos coronas y base cuadrática: orden 2 y sin depender del espesor. Los valores en los puntos de Gauss sirven como dato bruto, no para derivar |
| E5-3 | **El error del Q recuperado depende de los elementos por vano, no de h/t:** −8,7 %, −1,8 % y −0,44 % con 8, 16 y 32, para cualquier esbeltez. El nudo del apoyo es el peor punto (−10 % con 12 por vano). Cierra S5 #3 | Los mapas de Q son fiables con ≥ 16 elementos por vano. Para comprobar cortante en los apoyos (y la banda de cortante a «d» de la cara), el corte por fuerzas nodales, que es exacto. H18 deja de bloquear el cortante de láminas |
| E5-4 | **En un borde libre, la placa de Mindlin tiene una capa límite** (de anchura ~t) donde Mxy cae a cero y el cortante se concentra. La malla no la resuelve: el Mxy recuperado en el borde no es nulo, y ∫Qx dy pierde la fuerza de borde de Kirchhoff [Mxy] | El corte por campos suma ±Mxy·n en los extremos que acaban en un borde libre. Con eso, Vz de una losa unidireccional queda en 1,4 % (t = 0,25, 24 × 8) y 0,05–0,18 % (t = 0,05); con ν = 0, exacto. El residuo aparece cuando h < t y la malla empieza a resolver la capa |
| E5-5 | **En la cara de un pilar, los valores puntuales recuperados se quedan cortos:** la integral de Mx de las muestras de la banda queda un 21 %, 12 % y 7 % por debajo de la exacta con h = 0,3, 0,15 y 0,075 m. Wood–Armer punto a punto crece al refinar (174 → 206 → 224 kN·m) por los picos singulares de las esquinas de la huella (H25). La integral por fuerzas nodales es exacta y no depende de la malla (−205,3 / −205,5 / −205,6) | Las caras de los apoyos se dimensionan con los esfuerzos integrados por fuerzas nodales. El compilador siembra en la malla las caras y los bordes de las bandas (H29; SAFE también malla en los bordes de las franjas). Cómo combinar la banda con Wood–Armer (sobre los momentos medios con el My exacto, o repartiendo el My exacto con las muestras) se decide en la fase de dimensionado (D5, H34) |
| E5-6 | **Un corte por campos alineado con la malla debe dar lo mismo que por fuerzas nodales.** Integrar campos sobre un lado de lámina daba un 4–5 % más en la cara del pilar y un Vz errático, por la singularidad | «Campos» es mixto: fuerzas nodales donde el corte sigue la malla y campos sólo en las láminas que atraviesa. Un corte alineado da lo mismo por los dos métodos (1e-9), y uno que sólo atraviesa en parte aprovecha la exactitud donde la hay |
| E5-7 | **El SPR por regiones separa lo que debe estar separado:** el pliegue losa–muro y el borde ábaco–reticular tienen dos valores por nudo, y las huellas quedan fuera. En el edificio objetivo salen 442 regiones (los vanos alternos de reticular) | Los mapas muestran los saltos físicos de M y N entre superficies y secciones, en vez de promediarlos. El visor dibuja cada región con sus valores (H43: sin interpolar el color) |

## Pendiente

- **D5, quién define las bandas,** sigue abierta (la recomendación de S2 es (c): automáticas y editables). El motor recibe cortes. El compilador o la interfaz:
  - definen las bandas del Ap. I a partir de los ejes de los pilares;
  - y siembran sus bordes y las caras de los apoyos en la malla (E5-5).
- **Wood–Armer en bandas** (H25, H34): decidir en la fase de dimensionado entre:
  - (a) Wood–Armer sobre los momentos medios de la banda, con el My exacto del corte;
  - (b) repartir el My exacto según las muestras y aplicar Wood–Armer punto a punto.

  E5-5 descarta integrar Wood–Armer sobre las muestras crudas en la cara de un apoyo.
- **Punzonamiento:** la reacción del pilar y los momentos desequilibrados ya salen de los esfuerzos de barra del pilar o de un corte de planta. Un perímetro crítico a 2d necesitaría cortes por polilínea cerrada, que E5 no tiene. Se puede añadir sobre la misma base de fuerzas nodales si el módulo de punzonamiento lo pide.
- **Machones y dinteles de muros:** el corte ya los da (un rectángulo por machón, como un pilar). Falta que el compilador los defina a partir del modelo físico.
- **Láminas curvas** (cáscaras facetadas): cada faceta es su propia región y el SPR se degrada. No hace falta para edificios.
- **Aviso de calidad del SPR:** en el borde de una región (el nudo del apoyo), el Q recuperado tiene un error O(h²) mayor que en el interior (E5-3). Si los mapas de Q se usan para algo más que ver, convendría marcar los nudos de borde.
- **Pendiente de E0–E4:** medir en el móvil (el CI ya está en verde).

## Cómo reproducir

```sh
bun run test:run                                   # todos los tests (E0–E5 y Fase 1)
bun validacion/e5/resumen.ts                       # errores medidos de los criterios 1–3 → out_resumen.txt
bun validacion/e5/spr.ts                           # convergencia del SPR (exp01d y Navier) → out_spr.txt
bun validacion/e5/spr.ts --comparar                # variantes de muestreo y base (E5-2) → out_spr_variantes.txt
bun validacion/e5/bandas.ts                        # bandas: losa unidireccional, Navier y losa plana → out_bandas.txt
node validacion/e5/banco.ts > validacion/e5/out_banco.txt   # edificio objetivo con 24 casos
bun validacion/e5/congelar.ts                      # SÓLO a sabiendas: regenera la referencia congelada de E5
```
