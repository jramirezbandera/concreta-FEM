# Verificación adversarial — Área 4: Dominio estructural y normativa española

> Documento verificado: `investigacion/areas/04-dominio-normativa.md`
> Verificador: ingeniero estructural (modo cazador de alucinaciones numéricas).
> Método: recálculo propio de fórmulas + contraste contra CTE/EHE-08/prontuarios.
> Fecha: 2026-06-20.

---

## Resumen de veredictos

| # | Afirmación | Veredicto |
|---|---|---|
| 1 | Tabla 3.1 sobrecargas de uso (todos los valores) | **VERIFICADO** |
| 2 | Coeficientes parciales γ (Tabla 4.1) | **VERIFICADO** |
| 3 | Coeficientes simultaneidad ψ (Tabla 4.2) | **VERIFICADO** |
| 4 | Fórmulas combinación ELU/ELS (4.3, 4.6–4.8) | **VERIFICADO** |
| 5 | Pesos: hormigón 25, acero 78,5 kN/m³ | **VERIFICADO** |
| 6 | **Ecm = 8500·fcm^(1/3) y valores HA-25/30/35** | **REFUTADO** (fórmula OK, valores numéricos MAL) |
| 7 | Aceros B500S Es=200000; estructural 210000/G=81000/ν=0,3 | **VERIFICADO** |
| 8 | Torsión J=β·h·b³ y tabla β | **VERIFICADO** |
| 9 | Límites de flecha 1/500, 1/400, 1/300 | **VERIFICADO** |
| 10 | IPE 300 (Iy≈8356, etc.) | **VERIFICADO** |

**1 REFUTADO de alto impacto** (los tres valores de Ecm). El resto verificado.

---

## Afirmación 1 — Tabla 3.1 CTE DB-SE-AE (sobrecargas de uso)

**Veredicto: VERIFICADO.**

Contrastado contra la versión renderizada del DB-SE-AE (normatia.com) y prontuarios. Cada par (qk, Qk) coincide exactamente con el documento:

| Cat. | qk doc | qk oficial | Qk doc | Qk oficial |
|---|---|---|---|---|
| A1 | 2 | 2 ✓ | 2 | 2 ✓ |
| A2 | 3 | 3 ✓ | 2 | 2 ✓ |
| B | 2 | 2 ✓ | 2 | 2 ✓ |
| C1 | 3 | 3 ✓ | 4 | 4 ✓ |
| C2 | 4 | 4 ✓ | 4 | 4 ✓ |
| C3 | 5 | 5 ✓ | 4 | 4 ✓ |
| C4 | 5 | 5 ✓ | 7 | 7 ✓ |
| C5 | 5 | 5 ✓ | 4 | 4 ✓ |
| D1 | 5 | 5 ✓ | 4 | 4 ✓ |
| D2 | 5 | 5 ✓ | 7 | 7 ✓ |
| E | 2 | 2 ✓ | 20 | 20 ✓ |
| F | 1 | 1 ✓ | 2 | 2 ✓ |
| G1 (<20°) | 1 | 1 ✓ | 2 | 2 ✓ |
| G1 ligera | 0,4 | 0,4 ✓ | 1 | 1 ✓ |
| G2 (>40°) | 0 | 0 ✓ | 2 | 2 ✓ |

La nota sobre la carga concentrada E (20 kN = 2×10 kN separadas 1,8 m) y la definición de cubierta ligera (peso del cerramiento ≤ 1 kN/m²) también se confirman. Los incrementos (+1 kN/m² en accesos/evacuación A y B; +2 kN/m en borde de balcones volados) son correctos según el DB-SE-AE.

- Evidencia: https://normatia.com/es/normativa/cte-db-se/ae-2009/3-acciones-variables/ ; https://www.codigotecnico.org/pdf/Documentos/SE/DBSE-AE.pdf
- Sin corrección necesaria.

---

## Afirmación 2 — Coeficientes parciales γ (Tabla 4.1 DB-SE)

**Veredicto: VERIFICADO.**

- Permanente desfavorable **1,35** / favorable **0,80** (resistencia) ✓
- Variable desfavorable **1,50** / favorable **0** ✓
- ELS: todos γ = **1,00** ✓
- Valores de estabilidad (1,10/0,90 permanente) y empuje/agua: coinciden con el DB-SE.

Estos son los valores normativos consolidados del CTE DB-SE Tabla 4.1, coincidentes con EN 1990. No se detecta discrepancia.

- Evidencia: CTE DB-SE §4.2.2 Tabla 4.1 (https://www.codigotecnico.org/pdf/Documentos/SE/DBSE.pdf); corroborado en memorias de cálculo públicas.
- Sin corrección necesaria.

---

## Afirmación 3 — Coeficientes de simultaneidad ψ (Tabla 4.2 DB-SE)

**Veredicto: VERIFICADO.**

- Residencial Cat. A: ψ0/ψ1/ψ2 = **0,7 / 0,5 / 0,3** ✓
- Cat. B (oficinas): 0,7 / 0,5 / 0,3 ✓
- Cat. C (pública): **0,7 / 0,7 / 0,6** ✓
- Cat. D (comercial): 0,7 / 0,7 / 0,6 ✓
- Viento: **0,6 / 0,5 / 0** ✓
- Nieve altitud ≤ 1000 m: **0,5 / 0,2 / 0** ✓
- Nieve > 1000 m: 0,7 / 0,5 / 0,2 ✓

Todos coinciden con la Tabla 4.2 del DB-SE (idénticos a EN 1990 tabla A1.1 con la adaptación española). Correcto.

- Evidencia: CTE DB-SE §4.2.2 Tabla 4.2; corroborado por búsqueda y por memorias de cálculo.
- Sin corrección necesaria.

---

## Afirmación 4 — Fórmulas de combinación ELU/ELS

**Veredicto: VERIFICADO.**

- ELU persistente/transitoria (ec. 4.3): `ΣγG·Gk + γP·P + γQ,1·Qk,1 + ΣγQ,i·ψ0,i·Qk,i` — estructura correcta (una variable dominante a valor pleno, resto con ψ0). Coincide con EN 1990 ec. 6.10.
- ELS característica (4.6): `ΣGk + P + Qk,1 + Σψ0,i·Qk,i` ✓
- ELS frecuente (4.7): `ΣGk + P + ψ1,1·Qk,1 + Σψ2,i·Qk,i` ✓
- ELS casi permanente (4.8): `ΣGk + P + Σψ2,i·Qk,i` ✓

La estructura de las cuatro fórmulas es la normativa. Sin corrección.

- Evidencia: CTE DB-SE §4.2.2 / §4.3.2.

---

## Afirmación 5 — Pesos propios

**Veredicto: VERIFICADO.**

- Hormigón armado **25 kN/m³** (= 24 en masa + 1 por armado) ✓ — Anejo C DB-SE-AE.
- Acero **78,5 kN/m³** (rango normativo 77–78,5; valor de cálculo habitual 78,5, equivalente a 7850 kg/m³) ✓.
- Resto de pesos del Anejo C (aluminio 27, fábricas, mortero, vidrio): coherentes con valores tabulados habituales.

- Evidencia: DB-SE-AE Anejo C Tabla C.1; corroborado por fichas técnicas de acero (7850 kg/m³).
- Sin corrección necesaria.

---

## Afirmación 6 — Módulo de elasticidad del hormigón Ecm (EHE-08) — **REFUTADO**

**Veredicto: la FÓRMULA es correcta; los VALORES NUMÉRICOS son INCORRECTOS.**

Fórmula del documento: **Ecm = 8500·fcm^(1/3)** con **fcm = fck + 8** (MPa). Correcta — es el art. 39.6 de la EHE-08 (módulo de deformación longitudinal secante a 28 días, válido para σ ≤ 0,40·fcm).

**Recálculo propio (determinista):**

| Hormigón | fck | fcm | fcm^(1/3) | Ecm = 8500·fcm^(1/3) | Doc dice |
|---|---|---|---|---|---|
| HA-25 | 25 | 33 | 3,20753 | **27 264 MPa** | 30 100 ✗ |
| HA-30 | 30 | 38 | 3,36198 | **28 577 MPa** | 31 850 ✗ |
| HA-35 | 35 | 43 | 3,50340 | **29 779 MPa** | 33 460 ✗ |

Los tres valores del documento son ERRÓNEOS y sobrestiman la rigidez del hormigón en ~9–12 %:
- HA-25: doc 30 100 vs correcto **27 264** (error +10,4 %)
- HA-30: doc 31 850 vs correcto **28 577** (error +11,5 %)
- HA-35: doc 33 460 vs correcto **29 779** (error +12,4 %)

Los valores correctos (27264 / 28577 / 29779) son los tabulados canónicos de la EHE-08, confirmados por fuentes técnicas (estructurando.net y prontuarios reproducen exactamente 27264 para HA-25 y 28577 para HA-30).

**¿De dónde salen los valores del documento?** No corresponden ni a EHE-08 (8500·∛fcm) ni a EC2 (`22000·(fcm/10)^0,3` → 31476 / 32837 / 34077). Son valores espurios/alucinados; ni siquiera son internamente consistentes con la fórmula que el propio documento enuncia. El paréntesis "(≈27 264 si se redondea distinto)" junto a HA-25 es revelador: el autor tenía el valor correcto (27264) y lo etiquetó como variante de redondeo del valor erróneo (30100), cuando es justo al revés — **27 264 es el valor correcto y 30 100 el equivocado**.

Nota adicional: el "módulo instantáneo/inicial E0 = 10000·fcm^(1/3)" da HA-25 → 32075, HA-30 → 33620, HA-35 → 35034 (recalculado). Esa fórmula es la del módulo instantáneo de la EHE-08 y es correcta; conviene no confundirla con la secante.

**IMPACTO ALTO:** Ecm es el `E` que se inyecta en PyNite para el hormigón. Un error del 10–12 % en E propaga directamente a TODA la deformada (flechas sobrestimadas/infraestimadas) y al reparto de esfuerzos en estructuras hiperestáticas. Es exactamente el tipo de error que el CLAUDE.md §6/§14 quiere evitar.

- Evidencia: recálculo propio (8500·∛33 = 27264, etc.); https://estructurando.net/2019/06/18/los-modulos-de-elasticidad-del-hormigon/ ; EHE-08 art. 39.6 (https://www.transportes.gob.es/recursos_mfom/1820100.pdf).
- **Corrección obligatoria:** sustituir la tabla por HA-25 → **27 264**, HA-30 → **28 577**, HA-35 → **29 779** MPa (redondeables a 27300 / 28600 / 29800). Eliminar el paréntesis confuso. Mantener fcm=fck+8 y la fórmula 8500·∛fcm. La recomendación accionable nº 5 (calcular Ecm en código con la fórmula) es correcta y, de hecho, blinda contra este error si se calcula en lugar de cablear constantes erróneas.

---

## Afirmación 7 — Aceros

**Veredicto: VERIFICADO.**

- B500S: fyk = **500 N/mm²**, Es = **200 000 N/mm²**, carga de rotura ≥ 575 (≥ 1,05·fyk) ✓; B400S = 400 ✓.
- Acero estructural S235/S275/S355: E = **210 000**, G = **81 000** (= E/2(1+ν) ≈ 80769, redondeado a 81000 en EC3), ν = **0,3** ✓, α = 12·10⁻⁶ /°C ✓, densidad 7850 kg/m³ ≈ 78,5 kN/m³ ✓.
- El aviso de NO confundir Es(armadura)=200 GPa con E(estructural)=210 GPa es correcto y pertinente.

- Evidencia: EHE-08 art. 38.4 (Es=200000); EN 1993-1-1 §3.2.6 (E=210000, G=81000, ν=0,3); corroborado por búsqueda.
- Sin corrección necesaria.

---

## Afirmación 8 — Torsión rectangular J = β·h·b³

**Veredicto: VERIFICADO.**

- Tabla β confirmada exactamente: h/b = 1,0 → **0,141**; 1,5 → 0,196; 2,0 → 0,229; 3,0 → 0,263; 6,0 → 0,299; ∞ → 0,333. Son los coeficientes clásicos de Saint-Venant/Roark/Timoshenko.
- La advertencia de **NO usar el momento polar** Ip = (b·h/12)(b²+h²) como J en secciones no circulares es correcta y crítica (sobrestima la rigidez torsional). 
- La aproximación de Roark `J ≈ a·b³·[1/3 − 0,21·(b/a)·(1 − b⁴/(12·a⁴))]` es la fórmula estándar correcta.

Matiz menor (no error): A, Iy, Iz por fórmula cerrada son exactos; J por β/Roark es la vía adecuada. Todo correcto.

- Evidencia: Roark's Formulas; corroborado por calculadoras de constante torsional (firgelliauto, sectionproperties docs).
- Sin corrección necesaria.

---

## Afirmación 9 — Límites de flecha

**Veredicto: VERIFICADO.**

- 1/500 (tabiques/muros frágiles), 1/400 (tabiques ordinarios/pavimentos rígidos), 1/300 (resto de casos / apariencia) ✓ — DB-SE §4.3.3.1.
- El valor de confort/vibraciones 1/350 también es correcto.

- Evidencia: CTE DB-SE §4.3.3.1.
- Sin corrección necesaria.

---

## Afirmación 10 — Perfiles metálicos (IPE 300)

**Veredicto: VERIFICADO** (con la cautela ya declarada por el propio documento).

IPE 300 (EN 10365 / DIN 1025): A ≈ 53,8 cm², Iy ≈ **8356 cm⁴**, Iz ≈ 604 cm⁴, It (J) ≈ 20,1 cm⁴, peso ≈ 42,2 kg/m. Todos confirmados contra prontuarios y bases de datos (Dlubal/estructurando).

- HEA 200 (A≈53,8; Iy≈3692; Iz≈1336; It≈21,0; 42,3 kg/m) y HEB 200 (A≈78,1; Iy≈5696; Iz≈2003; It≈59,3; 61,3 kg/m): valores estándar correctos en orden de magnitud y cifra; coherentes con prontuario EN 10365.
- El factor de conversión cm⁴→m⁴ (×10⁻⁸) y cm²→m² (×10⁻⁴) para PyNite es correcto.

El documento ya marca estos como confianza media y exige verificación contra tabla oficial antes de cablear la biblioteca — cautela apropiada. IPE 300 queda verificado.

- Evidencia: https://eurocodeapplied.com/design/en1993/ipe-hea-heb-hem-design-properties ; prontuarios IPE (estructurando, dlubal).
- Sin corrección necesaria.

---

## CORRECCIONES NECESARIAS

1. **CRÍTICA — Ecm del hormigón (Finding 3.2):** los tres valores numéricos están mal. Reemplazar:
   - HA-25: ~~30 100~~ → **27 264 MPa**
   - HA-30: ~~31 850~~ → **28 577 MPa**
   - HA-35: ~~33 460~~ → **29 779 MPa**
   
   La fórmula (8500·fcm^(1/3), fcm=fck+8) es correcta; solo los resultados están mal calculados. Eliminar el inciso "(≈27 264 si se redondea distinto)" porque invierte cuál es el valor bueno. Verificar que la recomendación nº 5 y la biblioteca `hormigon.ts` calculen el valor con la fórmula (lo que evita el error) y no cableen las constantes equivocadas.

   Impacto: error +10 a +12 % en E del hormigón → propaga a deformada y a esfuerzos en estructura hiperestática. Es input directo de PyNite.

2. **Menor — densidad acero (Finding 1.3):** el rango "77,0 a 78,5" es correcto pero conviene fijar 78,5 kN/m³ como valor de cálculo (ya lo hace en el rationale). Sin acción obligatoria.

No se detectan más errores numéricos. Las afirmaciones 1–5 y 7–10 quedan confirmadas frente a fuente normativa.

---

## Confianza global

**Alta en 9 de 10 bloques.** El documento es sólido en cargas, coeficientes (γ/ψ), combinaciones, pesos, aceros, torsión, flechas y perfiles: todos esos valores resisten la verificación contra el CTE/EHE-08. 

El único fallo —pero **de alto impacto y fácil de propagar**— es el módulo de elasticidad del hormigón Ecm: la fórmula es correcta pero los tres valores tabulados están mal (sobrestimados ~10–12 %). Corregir esos tres números deja el documento apto como contrato de datos normativo del MVP. Recomendación reforzada: **calcular Ecm en código con la fórmula EHE-08, nunca cablear el número**, lo que habría evitado por completo esta alucinación.
