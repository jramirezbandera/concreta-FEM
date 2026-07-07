# Contrato del corte F3-reticular · Forjado reticular como EMPARRILLADO de nervios

> Contrato de decisiones del corte que cierra `T-f3-pano-reticular` y
> `T-f3-pano-schema-union` (TODOS.md). Redactado al cierre de la Fase 0 (spike +
> normativa, 2026-07-07). Si una decisión de aquí contradice CLAUDE.md, gana CLAUDE.md.
>
> Fuentes de la Fase 0:
> - `src/solver/spikes/reticular_spike.md` — spike motor real (PyNite 2.0.2):
>   **NO-GO placa isótropa de espesor equivalente / GO emparrillado** (experimento (d)).
> - Informe normativo T0.2 (experto-normativa): CTE DB-SE-AE Tabla C.5 y Código
>   Estructural Anejo 19 §5.3.1(6), verificados contra PDF oficial. Los datos que este
>   corte necesita están consolidados AQUÍ (§3, §8) — el informe completo fue un
>   artefacto de sesión.
>
> Auditado por guardian-arquitectura (2026-07-07): **APTO CON RESERVAS**, las 4
> aplicadas en esta versión. Todas eran colisiones con el corte de MUROS/pantallas que
> aterrizó en `main` en paralelo (sesiones concurrentes): el esquema pasa a **v7**
> (v6 ya es de muros), la integración a **Paso 6f** (6e ya es de muros), la cita de
> `PANO_TIPO_NO_SOPORTADO` se actualiza y los gates por-tipo se enumeran con
> fichero:línea (§6).

---

## 1. Decisión de modelo (DP1) — emparrillado explícito de nervios

El paño `tipo:"reticular"` se discretiza como **members sintéticos de Capa 2 en DOS
direcciones** (grillage), NUNCA como placa de quads:

- Líneas de nervio en X y en Y a intereje efectivo `s = B/n` por dirección, con
  `n = max(1, round(B/intereje))` (mismo criterio objetivo→efectivo que viguetas y
  tamMalla→tamMallaEfectivo). Posiciones interiores `s·(k+½)` por dirección, MÁS las
  líneas de control por pilar interior (§5).
- Los cruces son **nudos compartidos** y los nervios son **CONTINUOS a través de los
  cruces** (members entre cruces consecutivos, SIN releases interiores: la continuidad
  es la rigidez del emparrillado). En los extremos de nervio NO hay releases de flexión
  por defecto (a diferencia de la vigueta biapoyada): el emparrillado continuo es el
  modelo; el comportamiento del borde lo da el apoyo (§4).
- **Por qué no placa:** la placa isótropa de espesor equivalente subestima la flecha
  entre −28% y −47% (insegura; H≈0,11·D real vs H=D asumido) y PyNite 2.0.2 no tiene
  quad ortótropo. Medido, no estimado: `reticular_spike.md` (a3) y (d1).

### Sección del nervio (DP1b)

Sección en T por nervio, sintética por paño (`RET-<idxPano>`, patrón `VIG-<idx>`):

- Cabeza = capa de compresión con **ancho eficaz = intereje efectivo `s`**; alma =
  `anchoNervio × canto` (canto TOTAL, incluida la capa).
- Propiedades: `A_T`, `I_fuerte` (flexión vertical) = I de la T respecto a su eje
  neutro real, `I_debil` (en el plano) = la del conjunto rectángulo+cabeza, y
  **`J = St. Venant del nervio` REAL — CONDICIÓN DEL GO del spike**: con J≈0 el modelo
  sigue estable (los cruces continuos rigidizan RX) pero la flecha se va +12% ((d2)).
  Cálculo de J: suma de rectángulos (alma + cabeza) con la fórmula de St. Venant del
  rectángulo (β(b/t)); para el canónico J = 1,293·10⁻⁴ m⁴ (pineado en test).
- Hipótesis declarada (heredada de la práctica de emparrillado y coherente con la
  referencia ortótropa Dx=Dy=E·I_m): **cada dirección cuenta la cabeza completa por
  nervio** (doble conteo de la membrana de compresión). Se documenta en el módulo y en
  la nota de honestidad de UI, no se "corrige".
- OJO al intercambio Iy/Iz del contrato de barras (gotcha del catálogo): la I que
  gobierna la flexión FEM de la barra horizontal es la que el contrato llama como en
  `seccionFEMDeVigueta` — copiar esa disciplina, con test.

### Cargas (DP1c)

- **Todas las cargas de superficie del paño → cargas NODALES tributarias en los
  cruces** (`P = presión·s_x·s_y` interior; mitades/cuartos en borde/esquina), por
  hipótesis (`case = hipotesisId`, cases sintéticos de planta `auto-planta-*` igual que
  losa/unidireccional). ΣV exacto por construcción (invariante de golden, residuo
  ~1e-13 medido).
- **Peso propio: TABULADO** (`pesoPropio` kN/m² del paño, editable) emitido como cargas
  nodales tributarias en el case de peso propio persistido (`hip-peso-propio`).
  **NUNCA además ρ·A de los nervios** (evita doble conteo — mismo DP que viguetas). Los
  members sintéticos del paño quedan EXCLUIDOS del Paso 6b (peso propio automático de
  barras), igual que las viguetas.

### Masa modal (DP1d) — DIFERIDA con nota de honestidad (precedente unidireccional)

En modal, los nervios aportan masa vía `add_member_self_weight` (ρ·A_T), que
infravalora el peso tabulado (~87% en el canónico → f1 sobreestimada ~+7%) y no ve
casetones perdidos. Se acepta EN ESTE CORTE con la misma nota de honestidad del panel
de frecuencias que el unidireccional, y la deuda se agrega a `T-modal-masa-altitud`
(mover TODA la masa tabulada al discretizador de una vez). La receta correcta ya está
VALIDADA en el spike ((d4): masas nodales tributarias del peso tabulado, f1 +0,41% de
la teoría ortótropa) — cerrar la deuda será implementar lo ya medido. El golden modal
del corte DOCUMENTA el sesgo esperado (como U1 documentó el muestreo par), no lo tapa.

---

## 2. Capa 1 (DP2) — unión discriminada de `PanoSchema` (cierra T-f3-pano-schema-union)

`PanoSchema` pasa a `z.discriminatedUnion("tipo", ...)` con TRES variantes. Campos
comunes: `id`, `nombre`, `plantaId`, `perimetro`, `materialId`, `bordeApoyo`.

| Variante | Campos propios (todos OBLIGATORIOS en su variante) |
|---|---|
| `losa` | `espesor`, `tamMalla` |
| `unidireccional` | `direccionViguetas`, `intereje`, `canto`, `anchoNervio`, `pesoPropio` |
| `reticular` | `intereje`, `canto`, `anchoNervio`, `capaCompresion`, `pesoPropio` |

- El reticular NO lleva `espesor` ni `tamMalla` (no hay malla de quads: la retícula la
  fija el intereje) ni `direccionViguetas` (es bidireccional). `canto` es el TOTAL;
  `capaCompresion` es el espesor de la capa (mínimo normativo 0,05 m; 0,04 con casetón
  perdido — Código Estructural Anejo 19 §5.3.1(6), verificado).
- `PANO_UNI_CAMPOS` (presencia por validación) MUERE: la presencia la exige el esquema.
  Las validaciones de RANGO/coherencia (positivos, capa < canto, intereje ≤ 1,5 m,
  esbeltez nervio, §8) siguen en `validaciones.ts` con código `PANO_RET_CAMPOS`.
- Migración **v6→v7** (única del corte — OJO: v5→v6 YA ES la migración de MUROS,
  `migrarV5aV6` en migracion.ts:456, y `SCHEMA_VERSION` ya está en 6 en comunes.ts:38;
  reserva 1 del guardián): nueva `migrarV6aV7` (`MIGRACIONES[6]`) que discrimina por
  `tipo` y PODA los campos ajenos a cada variante (un `losa` v6 pierde los 5 campos uni
  si los arrastraba; un `unidireccional` pierde `espesor`/`tamMalla`, que estaban
  declaradamente ignorados). `SCHEMA_VERSION = 7`. Sin `.default` en la unión (un
  default contamina literales — gotcha documentado del corte 1).

---

## 3. Defaults y tabla normativa (DP3)

Defaults de la variante reticular (informe T0.2, coherentes con Anejo 19):

| Campo | Default | Nota |
|---|---|---|
| `canto` | 0,30 m (25+5) | comercial habitual |
| `intereje` | 0,80 m | ≤ 1,5 m de norma con holgura |
| `anchoNervio` | 0,12 m | esbeltez 2,08 ≤ 4 OK |
| `capaCompresion` | 0,05 m | = mínimo de norma (0,04 con casetón perdido) |
| `pesoPropio` | **4 kN/m²** | tramo C.5 "uni o bidireccional; grueso < 0,30" — MISMO precedente de lectura que `PESO_PROPIO_UNIDIRECCIONAL_DEFAULT` en forjados.ts (el spike usó 5 conservador para comparar; el default de producto sigue el precedente 4) |

`forjados.ts` gana `TABLA_BIDIRECCIONAL` (filas C.5: "< 0,30 → 4", "< 0,35 → 5",
fuera de rango → 5 conservador) + `pesoPropioOrientativoReticular(canto)` +
`PESO_PROPIO_RETICULAR_DEFAULT`, calcado al patrón existente (cita por fila + marca
VERIFICAR). Los pesos por tipo de casetón (recuperable/perdido) son orientación de
fabricante, NO norma: van como comentario/deuda, no como tabla.

---

## 4. Bordes y apoyos (DP4)

Espejo de la semántica de obra existente, traducida a extremos de nervio:

- **Borde con viga de contorno:** extremos de nervio REMAPEAN a los N* de la viga vía
  `subdivisionesViga` (disciplina exacta de viguetas, incl. muleta torsional {RX|RZ}
  SOLO en N* nacidos de subdivisión — revisar si con nervios continuos y J real la
  muleta sigue siendo necesaria; si no lo es, no emitirla y documentarlo).
- **`bordeApoyo:"simple"` sin viga:** apoyo nodal DY en los extremos de nervio del
  perímetro + anclaje mínimo de modos rígidos del plano (patrón spike (d): una esquina
  6 GDL, otra del mismo borde fija la deriva restante). El patrón exacto lo fija el
  módulo hoja y lo pina un golden.
- **`bordeApoyo:"empotrado"`:** se comporta como "simple" EN ESTE CORTE (los nervios
  continuos ya dan momentos negativos en apoyos interiores del emparrillado; el
  empotramiento del contorno queda diferido con la misma honestidad de UI que el
  unidireccional). Deuda hija.
- **`bordeApoyo:"libre"`:** sin apoyo de borde; exige sujeción por pilares (§5).

---

## 5. Pilar interior (DP5) — DENTRO DEL CORTE (decisión de usuario, 2026-07-07)

El caso de uso típico del reticular (losa aligerada sobre pilares) entra en el corte:

- **Línea de control por pilar:** por cada pilar interior al paño se FUERZA una línea
  de nervio en X y otra en Y pasando por su posición (desplazando la línea repartida
  más cercana, disciplina de clave de celda del corte losa plana en `mallado.ts`). La
  cabeza del pilar comparte el nudo del cruce (remap por celda, patrón losa plana).
- Umbrales espejo de losa plana: acople activo ≥2 sujeciones; paño con bordes libres
  necesita ≥3 pilares NO colineales (`PANO_PILARES_INSUFICIENTES`); el guard de
  colinealidad se replica (la basura silenciosa colineal-libre del corte losa plana).
- Estabilidad y equilibrio MEDIDOS: spike (d3) — 4 cruces apoyados, DY<0, ΣV exacto.
- Los **ábacos (macizados sobre pilar) NO se modelan** (rigidez uniforme del
  emparrillado hasta el pilar): flecha del lado conservador. Deuda hija con la
  geometría típica documentada (informe T0.2): ábaco ~L/6 por lado, canto = canto del
  forjado (macizado). Nota de honestidad en UI.

---

## 6. Validaciones y gates (DP6)

- `PANO_TIPO_NO_SOPORTADO` (bloque reticular en validaciones.ts:347-355) desaparece
  para `reticular`, y ese `return` se SUSTITUYE por el encaminado a una nueva
  `validarRefsPanoReticular` (espejo de `validarRefsPanoUnidireccional`,
  validaciones.ts:512; patrón de la rama unidireccional en :357-360). La cadena
  `PANO_RET_*` valida campos (rango §8), geometría (rectángulo de ejes, como losa/uni
  en este corte) y sujeción (§4/§5), con mensajes en lenguaje de obra.
- **Gates por-tipo a tocar, con fichero:línea y SENTIDO del cambio** (lección R-4 del
  corte unidireccional: los detectores gateados por `tipo` pierden bloqueos EN SILENCIO
  al añadir un tipo; lista cerrada por el guardián — F4 los recorre UNO A UNO):
  - `pilaresInterioresBajoPano` (acople.ts:961): el reticular ENTRA en el detector con
    la lógica de acople activo de la losa plana (`acoples.porPano`/`pilaresAcoplados`),
    NO cae al `return []` — es lo que materializa el §5.
  - `vigasInterioresBajoPano` (acople.ts:1028): el reticular entra para SEGUIR
    BLOQUEANDO viga interior (sentido OPUESTO al anterior).
  - `esReceptorDeCargaPlanta` (cargasPlanta.ts:41): el reticular SE UNE al OR — es un
    forjado y recibe las cargas de planta `auto-planta-*` (coherente con §1 DP1c;
    decisión CERRADA aquí, observación del guardián).
  - `haySujecionPano` (validaciones.ts:1009): el reticular deja de caer al
    `return false`; su sujeción es la de §4/§5 (bordes apoyados/remapeados y/o ≥3
    pilares no colineales).
  - `MODAL_SIN_MASA` (validaciones.ts:1416): el reticular cuenta como fuente de masa
    (self-weight de nervios, §1 DP1d).
  - CR (`prepararModeloCR`): el reticular no debe romper el CR — mismo aislamiento que
    malla/viguetas (la retícula nace después de `construirBaseFEM`).
  - P-Δ: corre con reticular (solo axil de pilares, como losa/uni).
- Trazabilidad: `panoAMembers[pano.id]` = todos los members de nervio (prefijo
  `PR<idxPano>-`), disjunto de N../M../PQ../PV..; `pilaresAcoplados` y compañía como
  losa plana donde aplique.

---

## 7. Módulo hoja y APIs (para F3)

`src/discretizador/emparrillado.ts` — HOJA y PURO (espejo de `viguetas.ts`: importa
solo dominio, biblioteca, geometria, mallado; jamás discretizar/validaciones):

- `repartoNervios(B, intereje)` → { n, s, posiciones } — COMPARTIDO con el rayado de UI
  (no repetir la deuda T-f3-uni-rayado-dry).
- `seccionFEMDeNervio(pano, s)` → SeccionFEM sintética (A, I fuerte/débil, J St.
  Venant) — con test que pina el canónico (A=0,0700; I_T=5,502976e-4; J=1,293473e-4).
- `generarEmparrillado(modelo, pano, lineasControl)` → nudos de cruce, members entre
  cruces, cargas nodales tributarias por hipótesis, extremos de borde con su
  clasificación (remap-a-viga | apoyo-aislado | libre) — todo determinista byte a byte,
  orden por índices ascendentes.
- Integración en `discretizar.ts` como **Paso 6f** (el 6e YA es el de MUROS,
  discretizar.ts:1269 — reserva 2 del guardián; espejo estructural del 6d), tras
  `construirBaseFEM` (el CR sigue aislado de la retícula).

Los targets de golden del corte (motor real, TOL a justificar en cabecera ~1-3%):
flecha centro 2,7682·10⁻³ m; M nervio central 11,158 kN·m (referencia ortótropa
H=0,11·D: 2,8585·10⁻³ / 11,313); ΣV exacto; losa plana estable; f1 modal documentando
el sesgo de masa (§1 DP1d). Caso canónico: 6,4×6,4 m, q=5 kN/m², HA-25, geometría §3.

---

## 8. Rangos normativos que valida `PANO_RET_CAMPOS`

Código Estructural, Anejo 19 §5.3.1(6) (VERIFICADO contra PDF oficial MITMA, pág. 805):

- `capaCompresion ≥ 0,05 m` (0,04 con casetón perdido — este corte valida ≥0,04 y la
  UI recomienda 0,05; el tipo de casetón no es campo del corte).
- `intereje ≤ 1,5 m` (separación entre ejes de nervios).
- Esbeltez del nervio: `(canto − capaCompresion)/anchoNervio ≤ 4`.
- Coherencia: `0 < capaCompresion < canto`; `anchoNervio < intereje`; todos finitos y
  positivos; `pesoPropio ≥ 0` (0 legítimo, mismo criterio que unidireccional).

---

## 9. UI (para F5)

- Selector de tipo gana "Reticular"; campos condicionales de la variante con conversión
  mm↔m SOLO en el borde; botón "según CTE" → `pesoPropioOrientativoReticular`.
- Huella: retícula BIDIRECCIONAL con el intereje real vía `repartoNervios` compartido.
- Resultados: deformada con nervios (members, como viguetas); **Isovalores honesto**:
  para el reticular hay flecha NODAL en los cruces (interpolable a rampa de color);
  NO hay Mx/My de placa — el panel lo declara y remite a los esfuerzos por nervio
  (picking de nervios = deuda compartida con T-f3-uni-vigueta-diagramas).
- Notas de honestidad: sin ábacos (flecha conservadora), empotrado≈simple en contorno,
  masa modal infravalorada (§1 DP1d), doble conteo de cabeza declarado.

---

## 10. Fuera de alcance (deudas hijas a abrir en el cierre)

- `T-f3-ret-abacos` — macizados sobre pilar (rigidez local + geometría típica).
- `T-f3-ret-empotrado-borde` — empotramiento real del contorno.
- `T-f3-ret-esfuerzos-nervio` — picking/diagramas por nervio (junto a
  T-f3-uni-vigueta-diagramas).
- `T-f3-ret-casetones` — peso por tipo de casetón (recuperable/perdido, fabricante).
- Masa modal tabulada → se AGREGA a `T-modal-masa-altitud` (receta ya medida, (d4)).
- Paño reticular poligonal/huecos → cubierto por `T-f3-pano-poligonal` (sin cambio).
- Viga interior bajo reticular sigue bloqueando (como losa/uni).

---

## 11. Fases restantes del corte (plan operativo)

- **F2 · Capa 1** (paralelo): unión discriminada + barrido de consumidores
  (experto-discretizador) · migración v6→v7 + fixtures (experto-persistencia-testing) ·
  tabla bidireccional en forjados.ts (experto-normativa). Puerta: typecheck + suite.
- **F3 · Módulos** (paralelo): `emparrillado.ts` + tests Capa A
  (experto-discretizador) · verificación glue/exclusión peso propio sintético
  (experto-motor-fem) · goldens escritos contra §7 (experto-persistencia-testing).
- **F4 · Integración** (secuencial): Paso 6f + validaciones + gates de §6 + líneas de
  control por pilar (experto-discretizador). Puerta: goldens motor real en verde.
- **F5 · UI/UX** (paralelo): campos por tipo · retícula · Isovalores honesto
  (experto-frontend-cad ×3) · E2E (experto-persistencia-testing). Puerta: suite + E2E +
  build.
- **F6 · Cierre** (paralelo): TODOS.md + memoria (orquestador) · auditoría
  (guardian-arquitectura).
