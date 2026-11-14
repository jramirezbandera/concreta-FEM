# Fase DN: los desniveles de paño

Plan del 2026-11-14, desde la propuesta de `niveles.md` §3, que pidió el usuario el 2026-10-29. El orden lo decidió el usuario el 2026-11-08: DN, luego LC y luego CO. Estado: **plan, con DN-a medida; DN-a…DN-e decididas por el usuario el 2026-11-14 como se recomendaban** (§5); DN-f (la sombra), a falta del modelo de CYPECAD.

## 1. Qué se pide

Como en CYPECAD, cada forjado puede ir más alto o más bajo que la cota de su planta. Hay dos casos típicos:

- **la terraza:** 10 cm más baja, para que quepa el acabado de cubierta;
- **el enrase por abajo:** una losa maciza de 20 junto a un reticular de 30, con las caras inferiores a la misma altura (desnivel −0,10).

## 2. Cómo está hoy (RV-b)

- Con `planoForjado: "superior"` (por defecto), todo el forjado de una planta va en un plano, el de su cara superior, en la cota de la planta: los nudos de las losas, el eje de las vigas (con `insercion: "plano"`) y los nudos de los pilares. Las excentricidades (t/2 de cada losa y h/2 de cada viga) no se modelan, como en CYPECAD.
- Lo que el nudo físico de un pilar ocupa por debajo del plano (ZR1) es rígido. Es la cabeza del tramo de debajo: el espesor de la losa de su huella o el canto de la viga más alta que le llega. Por encima del plano, nada.
- El diafragma rígido de una planta exige todos sus nudos a la misma cota (E1, `restriccion/diafragma-no-plano`).

## 3. Lo medido para DN-a (`validacion/dn/medir.ts`, `out_medir.txt`)

**El modelo:** una retícula de 2 × 2 vanos de 6 m con pilares de 30 × 30 empotrados a 3 m. La losa A va en x ∈ [0, 6] y la B en x ∈ [6, 12], con el escalón en x = 6. Las cargas son G (peso propio) + CM (3 kN/m²) y Vx (100 kN). Se miden cuatro casos:

1. dos macizas de 25 y B 10 cm más baja, con una viga de 30 × 50 en el escalón;
2. la misma sin viga (el solape en canto es de 15 cm);
3. B 25 cm más baja (sin solape), con una viga de 30 × 60;
4. un reticular 25+5 con ábacos y una maciza de 20 enrasada por abajo, sin viga.

**Los modelos que se comparan:**

- **E, excéntrico** (el modelo elástico de referencia): cada losa en su plano medio (en el aligerado, el centroide de la T del nervio), con su desnivel, y cada viga en su eje. Los nudos compartidos se duplican a su cota y se unen con enlaces rígidos. Las uniones de LV y de C2-d ganan el brazo vertical.
- **P, plano** (RV-b): todo en la cota. Con desnivel, es la opción (a), en la que sólo cambia la zona rígida de los pilares.

Todos van sin diafragma, porque la referencia no cabe en uno. El error de RV-b sin desnivel es P0 frente a E0, y lo que ya se acepta; el de (a) es PΔ frente a EΔ.

**La primera referencia no servía.** Bajar sólo los nudos de B, con las vigas en la cara superior, crea entre la losa y la viga una acción mixta que no es del desnivel: la viga del escalón de 25 cm salía un 43 % baja. Por eso la referencia es el modelo excéntrico entero.

**Resultado con h = 0,25** (h = 0,5 da lo mismo; err0 → errΔ):

| | terraza con viga | terraza sin viga | escalón de 25 con viga | enrase |
|---|---|---|---|---|
| flecha | +3,1 → +1,3…+2,3 % | −0,7 → +1,6…+2,6 % | +4,2 → +2,1…+5,1 % | +0,1…+0,8 → +0,3…+2,7 % |
| máx \|Mx\|, \|My\| de las losas | ≤ 5,7 → ≤ 4,3 % | −0,5 → **+14,0 %** (My) | ≤ 7,7 → −2,4…+8,4 % | ≤ 5,3 → −0,1…+6,0 % |
| N de los pilares | ≤ 1,1 → ≤ 1,0 % | ≤ 0,4 → ≤ 1,1 % | ≤ 1,1 → ≤ 1,3 % | ≤ 1,2 → ≤ 0,9 % |
| \|M\| en la cabeza de los pilares | +6,8…+21,6 → +7,3…+18,4 % | +4,5 → +7,3…+15,9 % | +7,6…+34,8 → +10,7…+40,5 % | +2,9…+4,4 → +5,5…+9,9 % |
| viga del escalón, My+ / My− | +15,1 / +14,6 → +11,0 / +8,4 % | — | +28,3 / +23,9 → +32,9 / +19,6 % | — |
| deriva con Vx | +1,6 → +2,2 % | +1,5 → +2,2 % | +1,9 → +4,0 % | +2,0 → +2,9 % |
| \|M\| de los pilares con Vx | ≤ 0,8 → −2,1…+1,2 % | ≤ 1,0 → −2,6…+2,7 % | ≤ 1,7 → −4,9…+3,2 % | ≤ 1,3 → −4,1…+3,8 % |

**Lo que sale:**

- **Con una viga en el escalón, (a) no añade nada** a lo que RV-b ya acepta. Las diferencias de la viga (+11…+33 %) son las de siempre: el modelo plano no ve la sección en T de la viga con la losa, y le da a la viga el momento que en el excéntrico va como par de fuerzas de membrana.
- **Sin viga, lo único nuevo es el momento de las losas a través del escalón: +14 %, del lado seguro.** En el modelo excéntrico, parte de ese momento pasa como par N·Δ, con fuerzas de membrana de hasta 590 kN/m en el escalón (12 kN/m en el plano). Es el problema local de armado de `niveles.md` §3: las barras superiores de una losa tienen que bajar Δ para seguir por las de la otra.
- **Del lado inseguro sólo hay valores pequeños:** el |My| de B con el escalón de 25 (−2,4 %) y el momento de un pilar con Vx (−2…−5 %, que sin desnivel ya era −0,1…−1,7 %).
- **La viga del escalón no tiene torsión nueva por las cargas verticales:** 0,05–0,18 kN·m con desnivel y 0 sin él. Lo dice `niveles.md` §3 y queda medido.
- **El diafragma rígido no cambia nada** en el modelo plano (≤ 0,5 %, salvo momentos de menos de 1 kN·m).
- **Para (b)** habría que meter en la lámina del motor un offset con su oráculo, y sólo serviría sin diafragma rígido: con uno, la lámina excéntrica sale rígida como una T de ala infinita (`viga/insercion-con-diafragma`). El diafragma rígido es lo de por defecto en todas las plantas con forjado, así que (b) casi nunca actuaría.

## 4. Propuesta (con DN-a = (a))

**En el modelo físico:** `desnivel?: number` (m; negativo, más bajo; por defecto 0) en `Losa` y en `PanoUnidireccional`. La cara superior del forjado queda en la cota de la planta más el desnivel; sus ábacos van con él.

**En el compilador**, una versión nueva (DN1). Sin desniveles, la misma salida bit a bit:

1. **Los nudos, en el plano de la planta,** como hoy (opción a). El diafragma, la malla, las cargas, el peso propio, las franjas y la unión con las vigas (LV) no cambian.
2. **Cada pieza ocupa en el nudo lo de su sitio real (ZR1 con el desnivel).** Lo que ocupa un nudo físico por debajo del plano es lo más bajo de lo que lo toca: losa de su huella −Δ + t, viga −Δ_v + h. Lo que ocupa por encima es lo más alto (+Δ, si alguna losa sube). Con `planoForjado: "medio"`, lo mismo respecto al plano medio.
   - La cabeza del tramo de debajo es rígida hasta la cara inferior más baja.
   - La base del tramo de encima arranca en la cara superior más alta de lo que lo toca. Si todo lo que llega a un pilar está más bajo, el tramo de encima es |Δ| más largo y su base va con un offset hacia abajo (DN-e).
3. **Una viga toma el desnivel de la losa más alta que la toca** (la de su ancho o la de sus caras, LV). Sin losas, el de la planta (DN-e). Ese desnivel sirve para la zona rígida, el peso que se le quita bajo la losa (C2-g), RV-a y el dibujo.
4. **El escalón:** donde dos forjados de la planta comparten un lado con desniveles distintos, el solape en canto es min(caras superiores) − max(caras inferiores).
   - Si el solape es ≤ 0 y en todo ese lado no hay una viga, un muro o un apoyo lineal, es el error `losa/escalon-sin-apoyo`.
   - Si el solape es menor que el de DN-b, es el aviso `losa/escalon-solape-corto`.
   - En los demás, las dos losas van unidas como hoy.
5. **La hipótesis** nombra los forjados con desnivel y dice que los nudos van en el plano de la planta.

**Fuera del compilador:**

- **El dibujo:** el alzado (sólido y analítico), el 3D sólido con su volumen exacto, las cargas y los isovalores en 3D en la cota real de cada forjado, y la cota del escalón en el alzado.
- **El editor:** la columna «desnivel» en la tabla Forjados y en la plantilla de Forjado; en la ficha, el croquis de la sección con la cota y «Enrasar por abajo con…» (DN-c). Mover, Copiar, Girar, Simetría y Estirar lo conservan.
- **El agente:** el esquema, `fem validar` y la skill, con la pregunta del desnivel en la lista de datos del encargo (MA1). Con el desnivel no cambian ni la sensatez de A3 ni la bajada tributaria: el peso no se mueve.
- **El escalón, como comprobación aparte** (`niveles.md` §3; DN-g, para más adelante). Por cada escalón, Δ, el momento de las franjas en las dos caras (ya hay estaciones allí), la pendiente Δ/b con el aviso de anclar por separado si pasa de 1/6, y la fuerza del tirante T·Δ/ℓ. Se haría con CO, porque es armado.

## 5. Decisiones

**Decididas el 2026-11-14:** DN-a (a), DN-b (error sin solape, aviso por debajo de t/2), DN-c (una orden), DN-d (positivos admitidos) y DN-e (vigas y pilares sin campo propio), todas como se recomendaban.

- **DN-a, el cálculo: (a), los nudos en el plano de la planta** (recomendado, §3). La (b), la lámina excéntrica, sólo serviría sin diafragma rígido, y con viga en el escalón da lo mismo que lo que ya se acepta.
- **DN-b, el solape mínimo en canto para dar continuidad sin viga.** Recomendado:
  - el error, sólo sin solape (≤ 0);
  - el aviso, con un solape menor que la mitad del espesor de la losa más delgada. En la terraza de 25 cm, eso es un desnivel de más de 12,5 cm sin viga.

  Es una regla de armado (la losa tiene que poder doblar o anclar sus barras en lo que solapan), no de cálculo.
- **DN-c, «enrasar por abajo»: una orden del editor** (recomendado) que escribe el desnivel con los cantos de ahora (Δ = t_esta − t_otra). La alternativa es un modo del desnivel (`enrase: "inferior"`), que lo recalcularía al cambiar un canto. La orden deja en el fichero lo que se calcula, como AC-b; el modo necesita una losa de referencia, y se rompe si ésta cambia o desaparece.
- **DN-d, desniveles positivos** (un forjado más alto que la cota de su planta): admitidos, con las mismas reglas (recomendado). La cota de la planta deja entonces de ser la cara superior más alta, y la hipótesis lo dice.
- **DN-e, las vigas y los pilares, sin campo propio** (recomendado):
  - la viga toma el desnivel de la losa más alta que la toca;
  - la base del pilar de encima arranca en la cara superior más alta, con un offset hacia abajo si todo está más bajo.

  La alternativa es un `desnivel` también en las vigas, para un zuncho que no siga a su losa.
- **DN-f, la sombra:** un modelo de CYPECAD del usuario con una terraza bajada y con un enrase, para comparar en sombra como VS5.

## 6. Criterios (para fijar con las decisiones)

1. Sin desniveles, la salida del compilador bit a bit en todas las referencias congeladas; con `desnivel: 0` escrito, el mismo modelo analítico.
2. Con desnivel, el modelo analítico es el de sin desnivel salvo las zonas rígidas de los pilares y el peso de las vigas que dice §4. Se comprueba con un oráculo a mano (las estaciones [i, i′, j′, j] de los tramos y los offsets) a 1e-10, en los casos de §3, con desniveles positivos y negativos y con los dos planos de forjado.
3. `losa/escalon-sin-apoyo` y `losa/escalon-solape-corto` salen donde tienen que salir y no en ningún otro sitio. Hay una entrada nueva en el catálogo de no válidos, y las metamórficas (traslación, giro, orden de las listas) no cambian el diagnóstico.
4. El volumen del sólido de cada pieza con desnivel es el de sus datos (como en I3), y lo dibujado en el alzado y el 3D está en su cota real.
5. Las órdenes del editor (columna, «Enrasar por abajo con…», transformar) dan byte a byte lo que se escribiría a mano, y deshacer da los bytes de antes.
6. El coste: las mismas ecuaciones en los edificios objetivo (sin desniveles, ni un nudo más).
7. La sombra con CYPECAD (DN-f), cuando el usuario dé el modelo.

## 7. Tramos

- **DN1, el compilador:** el campo, las zonas rígidas, las vigas, el escalón y la hipótesis, con los criterios 1 a 3 y 6.
- **DN2, el dibujo y el editor:** el alzado, el 3D, la tabla, la ficha y «Enrasar», con los criterios 4 y 5.
- **DN3:** la skill, el esquema y la sombra (criterio 7).

## 8. DN1 hecho (2026-11-14)

Pasan los criterios 1, 2, 3 y 6. El compilador no cambia de versión, porque sin desniveles su salida es la misma bit a bit (como PF): la batería entera del compilador pasa con las referencias congeladas idénticas.

- **Modelo físico:** `desnivel` en `Losa` y en `PanoUnidireccional`; `validar` exige un número finito, y los esquemas están regenerados.
- **`src/compilador/desniveles.ts`** (puro, también para el dibujo):
  - `desnivelesVigas` (DN-e);
  - `escalones` y `avisarEscalones` (DN-b): el borde común sin una viga, un muro que llegue a la planta, un apoyo lineal o la huella de un pilar debajo. El error y el aviso nombran los dos forjados y el tramo, y no dependen del orden de las listas.
- **Lo que ocupa el nudo de un pilar** (`losas.ts`, `piezas.ts`): cada huella guarda lo que sus losas ocupan por debajo y por encima del plano (`HuellaL.bajo`, `encima`). Cada viga, con su cara superior en su desnivel. La cabeza va hasta lo más bajo y la base del tramo de encima, desde lo más alto. Con el plano en la cara superior, la base se mueve también hacia abajo cuando todo lo que llega está más bajo.
  - Sin desniveles, el camino de antes, con los mismos bits.
  - Con el plano medio y `zonaRigidaBase: false`, la base no se mueve: es la opción de antes de LV-d, y se queda así.
- **El peso de las vigas bajo el forjado** (C2-g, `cargas.ts`): se quita sólo lo que se solapan en canto la viga y el forjado (del pp del forjado, esa fracción). La sensatez de A3 lo replica, y el esperado es el calculado a 1e-6.
- **RV-a:** cuenta como plana la viga cuya cara inferior no queda por debajo de la del reticular.
- **La hipótesis** nombra los forjados con desnivel y las vigas que lo toman.
- **Pruebas:**
  - `src/compilador/desnivel.test.ts`: los offsets a mano con los dos planos y desniveles positivos y negativos, la viga, el peso con el de A3 y los escalones, con un apoyo entero o a medias, y sin depender del orden;
  - tres entradas nuevas en el catálogo de no válidos de C2.
- **Queda:** el peso de una viga por el eje de un muro (A-9) no mira el desnivel del forjado de al lado; es raro y se deja.
