# Fase IG: la imperfección geométrica global

> Hecha el 2026-11-15, a petición del usuario: era la condición que dejó SO-g (`segundo-orden.md` §8) para poder usar el armado de pilares, y es el tramo CO0 del plan de comprobaciones (`comprobaciones.md`). Las decisiones IG-a…IG-h de §5 las ha tomado Claude al hacerla y están **por confirmar por el usuario**.

## 1. El problema

El Código Estructural (Anejo 19 §5.2, el EC2) obliga a tener en cuenta las imperfecciones geométricas en los estados límite últimos de las situaciones persistentes y accidentales (5.2(2)P); en servicio no hacen falta (5.2(3)). Hay dos, y no se sustituyen:

- **la del elemento aislado** (5.2(7)): una excentricidad e_i = l₀/400 del axil del pilar, o la excentricidad mínima de 6.1(4) (h/30, no menos de 2 cm). Es de la comprobación del pilar, y la tiene el módulo de pilares de Concreta;
- **la global** (5.2(5), (6) y (8)): una inclinación θ_i de toda la estructura, que se sustituye por fuerzas horizontales en cada nivel y entra en el análisis global con las demás acciones. Ésta es del cálculo, y hasta hoy el motor no la tenía: un edificio sin viento se calculaba sin ninguna acción horizontal.

Sin la global, los pilares de un edificio sin viento (o con poco) se quedan sin el momento que la norma pide, y el segundo orden global no tiene sobre qué actuar.

## 2. Lo que dice la norma

- **La inclinación** (5.2(5)): θ_i = θ₀·α_h·α_m, con θ₀ = 1/200, α_h = 2/√l entre 2/3 y 1, y α_m = √(0,5·(1 + 1/m)).
- **l y m para el efecto sobre el sistema de arriostramiento** (5.2(6)): l es la altura del edificio (m) y m, el número de elementos verticales que contribuyen a la fuerza horizontal sobre él. θ va así de 1/200 (un pilar de menos de 4 m) a 1/424 (muchos pilares y más de 9 m).
- **Las fuerzas** (5.2(8), figura 5.1): sobre el sistema de arriostramiento, H_i = θ_i·(N_b − N_a) en cada nivel, con N_a y N_b los axiles por encima y por debajo: θ por la carga vertical que entra en ese nivel.
- **El segundo orden** (apéndice H.2): la fuerza horizontal de primer orden que se amplifica, F_H,0Ed, es la «del viento, las imperfecciones, etc.».
- **Acero** (Anejo 22 §5.3.2): la misma forma, φ = φ₀·α_h·α_m con φ₀ = 1/200, con una exención (H_Ed ≥ 0,15·V_Ed) que aquí no se aplica (§7).

## 3. Lo que había

- El **generador de combinaciones** admitía ya casos N (nocionales, RES-17 de la investigación): derivados de un caso vertical (`derivadoDe`), con dirección y signo, sólo en ELU-PT, con el factor de su caso de origen y emparejados con el viento de la combinación. Nadie los creaba ni les ponía cargas.
- `fem2d` de Concreta las pone como casos derivados (`NG`, `NQ`…), y amplifica las nocionales con el mismo coeficiente que el viento.

## 4. Lo que se ha hecho

### 4.1 Las cargas: un caso derivado en el motor

Inclinar la estructura θ bajo unas cargas verticales equivale (a primer orden en θ) a dejarla recta y añadir, donde cada carga entra, una fuerza horizontal θ·P. El motor tiene ahora **casos derivados** (`CasoDerivado` en `modelo.ts`, `src/motor/derivados.ts`): un caso sin cargas propias cuya carga es, en cada nudo, `factor`·P_v en X o en Y, con P_v = −Fz de las fuerzas nodales equivalentes de su caso de origen (las que el cálculo ya ensambla: las puntuales y el reparto de las cargas de barra y de lámina; las mismas que usa el P·δ del segundo orden).

- Es H_i = θ·(N_b − N_a) nudo a nudo: lo que cada nudo añade a lo que baja. Con diafragma rígido, la fuerza de cada planta es θ por su carga, en el centro de sus cargas.
- No cambia las ecuaciones ni la factorización: es un lado derecho más por caso. Los demás casos salen con los mismos bits, y el orden de los casos no importa (los derivados se montan detrás).
- Cumple la regla de oro 2 como cualquier caso (su carga son fuerzas nodales), y lo que no vale es el error `carga/derivado-no-valido` (un origen que no existe o que es derivado, un GDL que no es X ni Y, un factor no finito, cargas propias).
- `FuerzasNodales` (cortes, enlaces) y `EsfuerzosPiezas` (los pares de la losa en las vigas) necesitan las cargas nodales de cada caso: las de un derivado las rehacen con las mismas cuentas (`pesosNodales`), una vez por caso de origen y sólo si hacen falta.

### 4.2 La inclinación

`src/compilador/imperfeccion.ts`: θ = θ₀·α_h·α_m, la misma en X y en Y y para todo el edificio, con

- **l**, de la base del tramo más bajo de pilares y muros a la cabeza del más alto (con sótanos, desde su cimentación);
- **m**, los pilares y muros de la planta que menos tiene (el mayor α_m: del lado seguro, IG-b).

`acciones.imperfeccion.inclinacion` (en radianes) pone otra; no puede pasar de 1/20.

### 4.3 Los casos

De cada caso vertical (acción G, Q o S) salen dos **casos del programa**, `IMP-X(<caso>)` e `IMP-Y(<caso>)`: nocionales (N) derivadas de él, con su `inclinacion` y **sin signo** (el sentido lo pone el factor: así son 2 casos por caso vertical y no 4). Como los del viento, no están en el fichero: `resolverImperfeccion` los añade al final de `casos` (detrás de los del viento) en `fisicoResuelto`, en `compilar` y en `Consultas`, y sólo añade los que faltan, así que es idempotente. En el modelo analítico son casos derivados.

- **Por defecto, aplicada** en cuanto hay casos verticales con su acción y algún pilar o muro (IG-c). Un modelo cuyos casos no llevan `accion` (sin combinaciones), o sin pilares ni muros, no cambia. `acciones.imperfeccion.aplicar: false` la quita.
- Una nocional escrita con su `inclinacion` (un campo nuevo de la acción) es también un caso derivado, y el programa no la duplica. Una nocional con sus cargas escritas a mano sigue valiendo; si además está la del programa, lo dice el aviso `imperfeccion/nocional-a-mano`.
- Un caso de la imperfección no admite cargas ni el peso propio, y un caso con el id de uno del programa es el error `imperfeccion/id-existente`.

### 4.4 Las combinaciones

En el generador (`src/combinaciones/generador.ts`):

- las nocionales entran en **ELU-PT y ELU-ACC** (antes, sólo en ELU-PT), con el factor de su caso de origen; no en la situación sísmica ni en servicio, ni en las del terreno (GEO);
- con viento en la combinación, en su dirección y su sentido; sin viento, una combinación por dirección y sentido (+X, −X, +Y, −Y);
- una nocional sin `signo` es reversible: entra con el factor de su origen o con su opuesto.

### 4.5 El segundo orden

Las nocionales son ahora hipótesis horizontales (`esHipotesisHorizontal`): en cada combinación llevan su coeficiente de estabilidad global γz = 1/(1 − Q), como el viento (CE A19 H.2). Con ello el segundo orden global está activo también en un edificio sin viento ni sismo, y sus avisos (traslacional, fuera del método, inestable) también.

### 4.6 Lo demás

- **Versión del compilador: IG1.** El mismo fichero da ahora más casos, así que la huella cambia y los resultados guardados se recalculan una vez; la firma del modelo lleva además de quién deriva cada caso, en qué GDL y con qué factor.
- **CLI y agente:** `fem calcular` da `imperfeccion` (θ, su fracción, α_h, α_m y los casos); `fem resumen`, la fuerza de cada caso derivado; el informe de `fem revisar`, la sección «Imperfección geométrica global» con su θ (y con sus casos en la tabla del segundo orden); una hipótesis del cálculo lo cuenta; los casos valen en `--caso "IMP-X(G)"` y en las expresiones. La skill dice que la pone el programa y que no se escribe a mano.
- **App:** los casos, en el selector de Cargas, en el grupo del programa (sin cargas dibujadas: son θ·P en cada nudo); en la ficha «Viento y sismo», pestaña «Segundo orden», la casilla de la imperfección, su inclinación por su denominador (1/…) y lo que sale en el modelo.
- **Lo que rompe a quien use la librería:** un vector de factores escrito a mano lleva un factor por caso lógico, y ahora hay más casos. Las expresiones por id (`1.35*G + 1.5*Q`) no cambian.

## 5. Decisiones (de Claude, por confirmar)

- **IG-a, nudo a nudo.** La fuerza va donde entra la carga (θ·P en cada nudo con carga vertical), no en el nudo de cada pilar con el salto de su axil. Las dos dan la misma fuerza por planta; ésta no necesita los resultados del caso de origen y es la que ya usa el P·δ del segundo orden. En un forjado sin diafragma rígido reparte la fuerza por la losa como su carga.
- **IG-b, θ.** Una sola para todo el edificio y las dos direcciones; l de la cimentación a la cabeza del tramo más alto; m de la planta con menos pilares y muros (α_m sale mayor que con la media o con la planta baja: del lado seguro; con 4 pilares en vez de 80, un 11 % más). Se puede escribir otra.
- **IG-c, por defecto activada.** Como el segundo orden (SO-b): la integración dará por hecho que está, y dejarla apagada sería el fallo silencioso. Sólo con casos que llevan su acción (sin ellos no hay combinaciones) y con pilares o muros.
- **IG-d, las situaciones.** ELU persistente y accidental (5.2(2)P), no la sísmica (el EC8 no la pide) ni servicio (5.2(3)). Tampoco en las combinaciones GEO (las acciones para el terreno del DB SE-C).
- **IG-e, con el viento.** En la dirección y el sentido del viento de la combinación; sin viento, las cuatro. No se combina la imperfección en una dirección con el viento en la otra (lo que decidió RES-17).
- **IG-f, amplificada por γz**, como hipótesis horizontal que es (CE A19 H.2 y lo que hace `fem2d`).
- **IG-g, los ids** `IMP-X(<caso>)` e `IMP-Y(<caso>)`, y un caso por caso vertical y dirección (reversible), no uno por sentido.
- **IG-h, los modelos de validación de antes**, sin ella: `conAcciones` (`validacion/c5/modelos.ts`) y las pruebas de SO y del sismo llevan `aplicar: false`, así que las referencias congeladas de C5 y F y la referencia fina de precisión salen idénticas. Lo nuevo se prueba en sus propios tests.

## 6. Validación

| criterio | estado |
|---|---|
| 1. El caso derivado da lo mismo que las fuerzas θ·P escritas a mano en cada nudo (cargas nodales, de barra y de lámina con reparto conocido), con y sin diafragma | pasa, a 1e-11 (`src/motor/derivados.test.ts`) |
| 2. Su resultante es θ·ΣP a la altura de las cargas; equilibrio ≤ 1e-9; el caso de origen, con los mismos bits; el orden de los casos no importa | pasa |
| 3. **La estructura inclinada:** el pórtico con los pilares inclinados θ bajo las cargas, menos el recto, es el caso derivado (momentos y cortantes de los extremos de todas las barras y desplazamientos) | pasa: 4e-4 sin el acortamiento de los pilares; 3e-3 en los esfuerzos y 8e-3 en los desplazamientos con los pilares de verdad, igual con θ = 1e-5 que con 1/200 (`validacion/ig/out_inclinada.txt`) |
| 4. `FuerzasNodales` da las cargas nodales del cálculo: Σ g = P + R en cada nudo | pasa, a 1e-9 |
| 5. θ a mano (α_h, α_m y sus límites; l y m con sótano y con pilares que no llegan arriba) | pasa (`src/compilador/imperfeccion.test.ts`) |
| 6. En el compilador, lo mismo que las fuerzas escritas como cargas físicas en un caso aparte | pasa, a 1e-10 |
| 7. En la vivienda (losas, vigas cargadas, peso propio): ΣH = θ·ΣP de cada caso a 1e-9, equilibrio ≤ 1e-9 y los casos del usuario con los mismos bits que sin ella | pasa |
| 8. Las combinaciones: factor del origen; sentido del viento o las cuatro; nunca en servicio ni con el sismo; una nocional reversible da las de una por sentido | pasa (`generador.test.ts`, `imperfeccion.test.ts`) |
| 9. El segundo orden: Q y γz de cada nocional a mano, y sus factores amplificados | pasa |
| 10. Sin casos con acción, sin pilares ni muros o con `aplicar: false`, nada cambia; resolver dos veces no añade nada | pasa |
| 11. Lo que no vale es un error; lo escrito a mano no se duplica | pasa |
| 12. La ficha de la app escribe sólo lo que no es lo de por defecto | pasa en vitest (`app/src/test/segundoOrden.test.tsx`); **los bancos de Chrome no se han pasado** |

**La estructura inclinada (criterio 3)** es la prueba de que las fuerzas son las que la norma define, no sólo de que el motor resuelve unas cargas nodales: se calcula el mismo pórtico de dos plantas (pilares, vigas y losas) con cada nudo desplazado θ·z, sólo con sus cargas verticales, y se le resta el recto. Lo que queda con los pilares de verdad (0,3–0,8 %) es su acortamiento, que en el pórtico inclinado tiene una componente horizontal θ·δ que las fuerzas equivalentes no tienen (del orden de 12·I/(A·h²)); sin él, 0,04 %.

**Las pruebas de antes:** las que tratan de otra cosa llevan la imperfección desactivada en su modelo (IG-h) y no cambian; cambian a sabiendas las que cuentan los casos (el muestrario, la vivienda con cargas de borde, los casos del programa en el visor).

## 7. Lo medido

`validacion/ig/medir.ts` (`out_medir.txt`), con y sin la imperfección:

| | Edificio de SO (3 plantas, sólo barras) | Vivienda (sin viento) | Edificio objetivo con vigas (7 plantas) | Reticular objetivo (7 plantas) |
|---|---|---|---|---|
| θ | 1/402 (l = 9 m, m = 9) | 1/283 (l = 4,30 m, m = 13) | 1/422 (l = 19,5 m, m = 80) | 1/422 |
| Fuerza horizontal de la imperfección de las permanentes | 6,7 kN (θ·2 700) | 5,0 + 2,7 kN | 316 kN (θ·133 394) | 265 kN |
| Casos | 4 → 8 | 4 → 12 | 4 → 8 | 4 → 8 |
| Ecuaciones | 90, las mismas | 8 772, las mismas | 149 814, las mismas | 199 962, las mismas |
| Combinaciones de ELU-PT | 16 → 28 | 8 → 32 | 26 → 38 | 26 → 38 |
| γz máximo de la imperfección (el de las demás hipótesis) | 1,021 (1,021) | 1,021 (—) | 1,040 (1,041) | 1,034 (1,035) |
| Lo que sube el mayor momento de los pilares en ELU-PT, kN·m: mediana / percentil 90 / máximo | 1,0 / 2,5 / 3,0 | 0,5 / 1,2 / 2,2 | 3,6 / 6,7 / 9,9 | 3,0 / 5,8 / 8,5 |
| Ídem, sobre el momento con ella: mediana / percentil 90 | 8,5 % / 100 % | 10 % / 36 % | 35 % / 42 % | 32 % / 39 % |
| Ídem, frente al momento de la excentricidad mínima, N·máx(h/30; 2 cm): mediana / percentil 90 / máximo | 0,14 / 0,24 / 0,25 | 0,24 / 0,64 / 1,36 | 0,14 / 0,23 / 0,42 | 0,14 / 0,23 / 0,41 |
| Tiempo de calcular (información; mínimo de 3, alternando) | — | 0,27 → 0,32 s | 5,9 → 6,2 s | 6,9 → 7,6 s |
| Envolventes de todas las piezas (información; una pasada) | — | 0,1 → 0,3 s | 10,0 → 16,0 s | 9,1 → 16,3 s |

En todos los casos de la imperfección, el equilibrio queda en ≤ 1,2e-12.

Lo que se ve:

- **No es despreciable en un edificio pesado.** La imperfección de las permanentes del edificio objetivo son 316 kN de fuerza horizontal (el 0,24 % de su peso), del orden de lo que le hace el viento. En sus pilares, el mayor momento de ELU-PT sube 3,6 kN·m de mediana y hasta 9,9 kN·m; con el viento de prueba de ese modelo (pequeño) es un tercio del momento. En la vivienda, sin viento, 0,5 kN·m de mediana y 2,2 de máximo.
- **No la cubre la excentricidad mínima,** pero es menor que ella: del orden del 14–24 % del momento N·e_mín de mediana. Sólo en algún pilar poco cargado de la vivienda la supera (1,36).
- **El segundo orden la amplifica como al viento:** su γz es el de las demás hipótesis horizontales (1,02–1,04), como tiene que ser: Q casi no depende del reparto de la fuerza.
- **El coste:** las ecuaciones no cambian. Son dos casos más por caso vertical (el cálculo, +5–9 % de tiempo) y más combinaciones de ELU-PT (las de sin viento se multiplican por cuatro: de 8 a 32 en la vivienda, de 26 a 38 en el edificio objetivo), que es lo que se nota: las envolventes de todas las piezas pasan de 10 a 16 s en los edificios de 7 plantas. Los resultados guardados crecen con los casos (cada caso del edificio objetivo son ~13 MiB).

## 8. Fuera de esta fase

- **La imperfección del elemento aislado** (e_i = l₀/400, o la excentricidad mínima): es de la comprobación del pilar (CO1).
- **Las fuerzas sobre los diafragmas** de 5.2(8) (H_i = θ·(N_b + N_a)/2 en un forjado, θ·N_a en la cubierta), para dimensionar el propio forjado como diafragma.
- **La exención del acero** (CE A22 §5.3.2(4)B: sin imperfección si H_Ed ≥ 0,15·V_Ed) y la combinación de la imperfección en una dirección con el viento en la otra.
- **Dibujar las fuerzas** de un caso de la imperfección en la app (hoy el caso se elige, pero no pinta nada).
- **La sombra:** no sé si el CYPECAD del usuario aplica la imperfección global en hormigón (en lo leído de su memoria para SO no aparece). **Pendiente del usuario:** decirlo; si no la aplica, la comparación en sombra de los pilares (CO1) se hace con `aplicar: false` y, aparte, con ella.
- **Los bancos de Chrome**, y una referencia congelada con la imperfección (`-ig`).
