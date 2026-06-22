# Área 4 — Modelo de dominio estructural y normativa española aplicable a un MVP de cálculo de pórticos (hormigón/acero)

> Investigación de mejores prácticas para **Concreta · Estructuras** (app FEM para arquitectos, interfaz calcada a CYPECAD, motor PyNite).
> Alcance: cargas, hipótesis, combinaciones, materiales y secciones **correctos** según normativa **española vigente** (CTE, EHE-08, Eurocódigos). Sin armado ni comprobación normativa todavía, pero el *input* del cálculo (cargas + combinaciones) debe ser exacto.
> Fecha: 2026-06-20.

---

## Resumen ejecutivo

- La normativa española de acciones para edificación es el **CTE DB-SE-AE** (Acciones en la edificación, edición abril 2009). De ahí salen los **valores característicos de sobrecarga de uso** (Tabla 3.1) y los **pesos propios** de materiales (Anejo C). Confianza **alta**: extraídos del PDF oficial de `codigotecnico.org`.
- Las **combinaciones de acciones** y los **coeficientes parciales (γ)** y de **simultaneidad (ψ0, ψ1, ψ2)** están en el **CTE DB-SE** (Seguridad Estructural), apartados 4.2 (ELU) y 4.3 (ELS), Tablas 4.1 y 4.2. Confianza **alta**: extraídos del PDF oficial. Estas fórmulas coinciden con EN 1990 (Eurocódigo 0), del que el CTE es transposición.
- Para el **MVP** basta implementar: ELU situación persistente/transitoria (ec. 4.3) y ELS característica/frecuente/casi-permanente (ec. 4.6/4.7/4.8). Sismo y accidental (ec. 4.4/4.5) son fase posterior (F2+).
- **Materiales hormigón (EHE-08):** la designación es `HA-fck` (HA-25, HA-30, HA-35…). Módulo de deformación secante **Ecm = 8500·fcm^(1/3)** (MPa), con **fcm = fck + 8** (MPa). Confianza **alta**.
- **Armadura pasiva (EHE-08):** **B500S**, fyk = 500 N/mm², Es = 200 000 N/mm². **Acero estructural (EC3 / EN 1993):** S235/S275/S355, **E = 210 000 N/mm²**, G ≈ 81 000 N/mm², ν = 0,3. Confianza **alta** salvo matices de valor exacto de G.
- **Secciones:** para el FEM PyNite necesita por barra `A, Iy, Iz, J` (y E, G). Para **rectangular de hormigón** hay fórmulas cerradas exactas (A=b·h, I=b·h³/12, J por fórmula de Saint-Venant con coeficiente β). Para **perfiles metálicos** se tabulan (EN 10365); no se calculan con fórmula. Confianza **alta** en fórmulas; **media** en valores tabulados concretos (verificar contra prontuario antes de cablear la biblioteca).
- **CYPECAD** organiza la obra en **plantas** (niveles con altura) agrupadas en **grupos** (plantas consecutivas e iguales, una única salida de resultados). La **categoría de uso**, la **sobrecarga de uso** y las **cargas muertas** se asignan **por grupo**. Esto encaja exactamente con el modelo de dominio del CLAUDE.md (`Grupo` lleva `categoriaUso`, `sobrecargaUso`, `cargasMuertas`). Confianza **alta**.
- **Hipótesis de carga (CYPECAD/CTE):** las cargas se introducen por **hipótesis** (peso propio, cargas muertas, sobrecarga de uso, viento, nieve, sismo). El discretizador debe mapear hipótesis → *load cases* PyNite y construir los *combos* aplicando γ y ψ. Confianza **alta** en el concepto.
- **Aviso de exactitud:** todos los valores numéricos de cargas y coeficientes de este documento están citados contra fuente oficial. Los **valores tabulados de perfiles metálicos** se dan como ilustrativos (confianza media) — deben cargarse desde una tabla EN 10365 verificada antes de producción.

---

## 1. Acciones y categorías de uso (CTE DB-SE-AE)

Fuente primaria: **CTE DB-SE-AE**, edición abril 2009 (PDF oficial). Tabla 3.1 "Valores característicos de las sobrecargas de uso" y Anejo C "Prontuario de pesos".
URL: https://www.codigotecnico.org/pdf/Documentos/SE/DBSE-AE.pdf

### Finding 1.1 — Sobrecargas de uso características (Tabla 3.1)
- **Claim:** Los valores característicos de sobrecarga de uso uniforme (qk) y carga concentrada (Qk) por categoría son los de la tabla siguiente (unidades: qk en **kN/m²**, Qk en **kN**):

| Cat. | Subcat. | Descripción | qk [kN/m²] | Qk [kN] |
|---|---|---|---|---|
| A | A1 | Viviendas y zonas de habitaciones en hospitales y hoteles | **2** | 2 |
| A | A2 | Trasteros | **3** | 2 |
| B | — | Zonas administrativas (oficinas) | **2** | 2 |
| C | C1 | Zonas con mesas y sillas | **3** | 4 |
| C | C2 | Zonas con asientos fijos | **4** | 4 |
| C | C3 | Zonas sin obstáculos (vestíbulos públicos, salas de exposición…) | **5** | 4 |
| C | C4 | Gimnasios / actividades físicas | **5** | 7 |
| C | C5 | Zonas de aglomeración (conciertos, estadios…) | **5** | 4 |
| D | D1 | Locales comerciales | **5** | 4 |
| D | D2 | Supermercados, hipermercados, grandes superficies | **5** | 7 |
| E | — | Tráfico y aparcamiento de vehículos ligeros (< 30 kN) | **2** | 20 (¹) |
| F | — | Cubiertas transitables accesibles solo privadamente | **1** | 2 |
| G | G1 | Cubiertas accesibles solo para conservación, inclinación < 20° | **1** (²) | 2 |
| G | G1 | Cubiertas ligeras sobre correas (sin forjado) | **0,4** (²) | 1 |
| G | G2 | Cubiertas accesibles solo para conservación, inclinación > 40° | **0** | 2 |

(¹) La carga concentrada de E (20 kN) se descompone en 2 cargas de 10 kN separadas 1,8 m (o sustituible por una distribuida equivalente: 3,0 / 2,0 / 1,0 kN/m² según el elemento). (²) Sobre proyección horizontal. Para cubiertas con inclinación entre 20° y 40° se interpola linealmente entre G1 y G2.
- **Rationale:** Son los valores característicos Qk que el arquitecto asigna por grupo/zona; alimentan la hipótesis "Sobrecarga de uso" del modelo. Reglas adicionales relevantes para el MVP: en zonas de acceso/evacuación de categorías A y B (portales, mesetas, escaleras) se **incrementa en +1 kN/m²** el valor de la zona servida; balcones volados llevan además **+2 kN/m lineal en el borde**.
- **Sources:** https://www.codigotecnico.org/pdf/Documentos/SE/DBSE-AE.pdf (§3.1, Tabla 3.1, pág. 5 del DB); http://prontuarios.info/acciones/sobrecargasuso
- **Confidence:** **alta** (extraído del PDF oficial).

### Finding 1.2 — Reducción de sobrecargas
- **Claim:** El DB-SE-AE permite reducir la sobrecarga de uso por número de plantas y por superficie tributaria (§3.1.2). Para el MVP **no es obligatorio** implementarlo (queda del lado de la seguridad no reducir).
- **Rationale:** Simplifica el MVP; CYPECAD lo ofrece como opción, no por defecto.
- **Sources:** https://www.codigotecnico.org/pdf/Documentos/SE/DBSE-AE.pdf (§3.1.2)
- **Confidence:** **media** (concepto correcto; coeficientes exactos no extraídos, irrelevantes para MVP).

### Finding 1.3 — Pesos propios de materiales (Anejo C, Tabla C.1)
- **Claim:** Pesos específicos aparentes (peso por unidad de volumen, **kN/m³**):

| Material | Peso [kN/m³] |
|---|---|
| Hormigón normal (en masa) | **24,0** |
| Hormigón armado (armados usuales) | **25,0** (= 24 + 1) |
| Hormigón ligero | 9,0 a 20,0 |
| Acero | **77,0 a 78,5** |
| Aluminio | 27,0 |
| Fábrica de ladrillo cerámico macizo | 18,0 |
| Fábrica de ladrillo cerámico perforado | 15,0 |
| Fábrica de ladrillo cerámico hueco | 12,0 |
| Mortero de cemento | 19,0 a 23,0 |
| Vidrio | 25,0 |

- **Rationale:** El peso propio (hipótesis "Peso propio") puede calcularse automáticamente desde la geometría de la sección × longitud × peso específico. Para hormigón armado usar **25 kN/m³**; para acero **78,5 kN/m³** (valor habitual). En el MVP el peso propio puede ser opcional o introducido como carga muerta; el cálculo automático es roadmap F2 (CLAUDE.md §15).
- **Sources:** https://www.codigotecnico.org/pdf/Documentos/SE/DBSE-AE.pdf (Anejo C, Tabla C.1)
- **Confidence:** **alta** (extraído del PDF oficial).

### Finding 1.4 — Cargas muertas (concepto)
- **Claim:** Las "cargas muertas" (peso de solados, tabiquería, falsos techos, revestimientos) son **acciones permanentes** distintas del peso propio estructural; se introducen como valor superficial (kN/m²) por grupo. Valores típicos de proyecto (no normativos, dependen de solución constructiva): solado ~1,0–1,5 kN/m²; tabiquería ~1,0 kN/m²; total cargas muertas residencial habitual ~2,0 kN/m².
- **Rationale:** CYPECAD pide "Cargas muertas" como dato por grupo. Son orientativos; el proyectista los fija. No hay tabla normativa única (salvo pesos del Anejo C para componerlos).
- **Sources:** https://www.codigotecnico.org/pdf/Documentos/SE/DBSE-AE.pdf (§2.1 Peso propio + Anejo C); https://info.cype.com/es/producto/cypecad-entrada-de-pilares/
- **Confidence:** **media** (valores típicos de proyecto, no constantes normativas).

---

## 2. Combinaciones de acciones (CTE DB-SE / EN 1990)

Fuente primaria: **CTE DB-SE**, apartado 4 "Verificaciones basadas en coeficientes parciales".
URL: https://www.codigotecnico.org/pdf/Documentos/SE/DBSE.pdf
Notación: G = permanente, P = pretensado, Q = variable, A = accidental; subíndice k = valor característico; γ = coeficiente parcial; ψ = coeficiente de simultaneidad.

### Finding 2.1 — ELU, situación persistente o transitoria (ec. 4.3)
- **Claim:** Combinación fundamental ELU (capacidad portante), expresión 4.3 del DB-SE:

```
Ed = Σ(j≥1) γG,j · Gk,j  +  γP · P  +  γQ,1 · Qk,1  +  Σ(i>1) γQ,i · ψ0,i · Qk,i
```

Es decir: todas las permanentes con su γG; **una** variable como "dominante" con γQ a valor pleno; el **resto** de variables con γQ·ψ0 (valor de combinación). Se itera tomando sucesivamente cada variable como dominante.
- **Rationale:** Es la combinación que genera los esfuerzos de dimensionado a resistencia. El discretizador debe generar **un combo ELU por cada variable tomada como dominante** (más adelante el armado). Coincide con EN 1990 ec. 6.10.
- **Sources:** https://www.codigotecnico.org/pdf/Documentos/SE/DBSE.pdf (§4.2.2, ec. 4.3)
- **Confidence:** **alta**.

### Finding 2.2 — Coeficientes parciales γ (Tabla 4.1)
- **Claim:** Coeficientes parciales de seguridad para las acciones, **situación persistente o transitoria**:

| Verificación | Acción | Desfavorable | Favorable |
|---|---|---|---|
| **Resistencia** | Permanente (peso propio, peso terreno) | **1,35** | **0,80** |
| Resistencia | Empuje del terreno | 1,35 | 0,70 |
| Resistencia | Presión del agua | 1,20 | 0,90 |
| Resistencia | **Variable** | **1,50** | **0** |
| **Estabilidad** | Permanente (peso propio, peso terreno) | 1,10 (desest.) | 0,90 (estab.) |
| Estabilidad | Empuje del terreno | 1,35 | 0,80 |
| Estabilidad | Presión del agua | 1,05 | 0,95 |
| Estabilidad | Variable | 1,50 | 0 |

Para el MVP (esfuerzos en pórticos, verificación de **resistencia**): **γG = 1,35** (permanente desfavorable), **γQ = 1,50** (variable desfavorable), y **γ = 0** para variables favorables, **γG = 0,80** para permanente favorable cuando proceda (p.ej. vuelco/levantamiento). En ELS todos los γ = 1,00.
- **Rationale:** Son los multiplicadores exactos que el discretizador inyecta en los `combos` de PyNite. El par (1,35·G + 1,50·Q) es el que cita el CLAUDE.md §7. **Crítico** distinguir desfavorable/favorable por acción para casos de vuelco/voladizo (alternancia de sobrecarga).
- **Sources:** https://www.codigotecnico.org/pdf/Documentos/SE/DBSE.pdf (§4.2.2, Tabla 4.1)
- **Confidence:** **alta**.

### Finding 2.3 — Coeficientes de simultaneidad ψ (Tabla 4.2)
- **Claim:** Coeficientes de simultaneidad ψ0 (combinación), ψ1 (frecuente), ψ2 (casi permanente):

| Acción variable | ψ0 | ψ1 | ψ2 |
|---|---|---|---|
| Sobrecarga uso — **Cat. A (residencial)** | **0,7** | **0,5** | **0,3** |
| Sobrecarga uso — **Cat. B (administrativo/oficinas)** | 0,7 | 0,5 | 0,3 |
| Sobrecarga uso — **Cat. C (pública)** | 0,7 | 0,7 | 0,6 |
| Sobrecarga uso — **Cat. D (comercial)** | 0,7 | 0,7 | 0,6 |
| Sobrecarga uso — **Cat. E (tráfico/aparcamiento <30 kN)** | 0,7 | 0,7 | 0,6 |
| Nieve — altitud > 1000 m | 0,7 | 0,5 | 0,2 |
| Nieve — altitud ≤ 1000 m | 0,5 | 0,2 | 0 |
| **Viento** | 0,6 | 0,5 | 0 |
| Temperatura | 0,6 | 0,5 | 0 |
| Acciones variables del terreno | 0,7 | 0,7 | 0,7 |

(Cubiertas F: se adopta el ψ del uso desde el que se accede. Cat. G de cubierta: no concomitante con otras variables.)
- **Rationale:** Estos ψ dependen de la **categoría de uso** (que en el modelo va por `Grupo`). El discretizador, al construir combos, debe consultar `grupo.categoriaUso` para elegir ψ0/ψ1/ψ2 correctos. Es exactamente la razón por la que el dominio lleva `categoriaUso` en el grupo.
- **Sources:** https://www.codigotecnico.org/pdf/Documentos/SE/DBSE.pdf (§4.2.2, Tabla 4.2)
- **Confidence:** **alta**.

### Finding 2.4 — ELS: característica, frecuente, casi permanente (ec. 4.6/4.7/4.8)
- **Claim:** Combinaciones de aptitud al servicio (γ = 1,00 en todas):

```
Característica (irreversibles, ec. 4.6):
  Ed = Σ Gk,j  +  P  +  Qk,1  +  Σ(i>1) ψ0,i · Qk,i

Frecuente (reversibles, ec. 4.7):
  Ed = Σ Gk,j  +  P  +  ψ1,1 · Qk,1  +  Σ(i>1) ψ2,i · Qk,i

Casi permanente (larga duración, ec. 4.8):
  Ed = Σ Gk,j  +  P  +  Σ(i≥1) ψ2,i · Qk,i
```

- **Rationale:** Para el MVP, la **deformada/flecha** se evalúa con la combinación **característica** (límites de flecha del §4.3.3.1: 1/500 con tabiques frágiles, 1/400 tabiques ordinarios, 1/300 resto; confort 1/350; apariencia 1/300 casi permanente). Implementar al menos la combinación característica para presentar deformada; frecuente/casi-permanente son útiles para fisuración/flecha diferida (fase posterior).
- **Sources:** https://www.codigotecnico.org/pdf/Documentos/SE/DBSE.pdf (§4.3.2 ec. 4.6–4.8; §4.3.3.1 flechas)
- **Confidence:** **alta**.

### Finding 2.5 — Accidental y sísmica (ec. 4.4 / 4.5) — fuera de MVP
- **Claim:** Situación extraordinaria (4.4): permanentes a valor de cálculo + acción accidental Ad + una variable a valor frecuente (ψ1) + resto casi permanente (ψ2). Sísmica (4.5): `Σ Gk,j + P + Ad + Σ ψ2,i·Qk,i` (todas las variables concomitantes a casi permanente). En extraordinaria los γ son 0 (favorable) o 1 (desfavorable).
- **Rationale:** Documentado para completitud; **roadmap F2+** (sismo NCSE-02). No implementar en F1.
- **Sources:** https://www.codigotecnico.org/pdf/Documentos/SE/DBSE.pdf (§4.2.2 ec. 4.4–4.5)
- **Confidence:** **alta**.

---

## 3. Materiales

### Finding 3.1 — Hormigón EHE-08: designación y resistencias
- **Claim:** El hormigón se designa **HA-fck/consistencia/árido/ambiente** (HA = hormigón armado). Resistencias características fck normalizadas (N/mm²): **20, 25, 30, 35, 40, 45, 50** (y de alta resistencia 55–100). Habituales en edificación: **HA-25, HA-30**. fcm (resistencia media) = **fck + 8** (MPa). fct,m (tracción media) ≈ 0,30·fck^(2/3) para fck ≤ 50.
- **Rationale:** El material del MVP necesita E (módulo) y, para el FEM, también densidad (peso propio). fck no entra en el FEM lineal salvo para E; entra después en armado.
- **Sources:** https://www.transportes.gob.es/recursos_mfom/1820100.pdf (EHE-08, art. 39); https://estructurando.net/2019/06/18/los-modulos-de-elasticidad-del-hormigon/
- **Confidence:** **alta**.

### Finding 3.2 — Módulo de elasticidad del hormigón (EHE-08)
- **Claim:** Módulo de deformación longitudinal **secante** (el habitual en cálculo de servicio): **Ecm = 8500 · fcm^(1/3)** (MPa), con fcm = fck + 8. Módulo **instantáneo/inicial**: **E0 = 10000 · fcm^(1/3)** (MPa). Valores resultantes:

| Hormigón | fck (MPa) | fcm (MPa) | Ecm (MPa) = 8500·fcm^(1/3) |
|---|---|---|---|
| HA-25 | 25 | 33 | **27 264** |
| HA-30 | 30 | 38 | **28 577** |
| HA-35 | 35 | 43 | **29 779** |

> **CORRECCIÓN (verificación 2ª pasada):** los valores Ecm de una versión previa (30 100 / 31 850 / 33 460) estaban **sobrestimados ~10 %** y eran espurios (no salían ni de EHE-08 ni de EC2). Recálculo determinista confirmado: `8500·∛33 = 27 264`, `8500·∛38 = 28 577`, `8500·∛43 = 29 779` MPa. Impacto: Ecm es el `E` que entra en PyNite para el hormigón → un error aquí propaga directo a deformada y a esfuerzos hiperestáticos. Usar los valores corregidos.

- **Rationale:** Ecm es el módulo que se introduce en PyNite como **E** del material hormigón (en kN/m²: Ecm[MPa]·1000 = kN/m²; ej. HA-25 → ~27,3·10⁶ kN/m²). Para coeficiente de Poisson del hormigón usar **ν = 0,2** (EHE-08); G = E/(2(1+ν)). Nota: algunos textos usan Ecm = 22000·(fcm/10)^0,3 (Eurocódigo 2, EN 1992) que da valores ligeramente distintos (HA-25 → ~31 000 MPa). **Usar la fórmula EHE-08 (8500·fcm^(1/3)) por coherencia con normativa española**, y documentar la elección.
- **Sources:** https://www.transportes.gob.es/recursos_mfom/1820100.pdf (EHE-08, art. 39.6); https://estructurando.net/2019/06/18/los-modulos-de-elasticidad-del-hormigon/
- **Confidence:** **alta** (fórmula); **media** en el redondeo exacto del valor numérico (depende de redondeo de fcm^(1/3)).

### Finding 3.3 — Armadura pasiva B500S (EHE-08)
- **Claim:** Acero corrugado de armar **B500S** (también B500SD dúctil): límite elástico característico **fyk = 500 N/mm²**, módulo de elasticidad **Es = 200 000 N/mm²**, carga unitaria de rotura ≥ 575 N/mm². B400S = 400 N/mm².
- **Rationale:** No interviene en el FEM de F1 (no hay armado todavía), pero define la biblioteca de materiales para F4. E del acero de armar (200 GPa) ≠ E del acero estructural (210 GPa) — no confundir.
- **Sources:** https://www.transportes.gob.es/recursos_mfom/1820100.pdf (EHE-08, art. 32 y 38.4); https://gcampesa.com/Pdf/descargas/2-acero_B_500_SD.pdf
- **Confidence:** **alta**.

### Finding 3.4 — Acero estructural (EN 1993 / EC3)
- **Claim:** Aceros laminados S235 / S275 / S355 (fy nominal = 235 / 275 / 355 N/mm² para t ≤ 16 mm). Constantes elásticas: **E = 210 000 N/mm²**, módulo de cortante **G = 81 000 N/mm²** (≈ E/2(1+ν)), **ν = 0,3**, coeficiente de dilatación α = 12·10⁻⁶ /°C, densidad **7 850 kg/m³ ≈ 78,5 kN/m³**.
- **Rationale:** Para barras metálicas en PyNite: E = 210·10⁶ kN/m², G = 81·10⁶ kN/m². fy entra en comprobación EC3 (fase posterior), no en el FEM lineal.
- **Sources:** EN 1993-1-1 §3.2.6 (valores E, G, ν estándar EC3); https://eurocodeapplied.com/design/en1993/ipe-hea-heb-hem-design-properties
- **Confidence:** **alta** en E, ν, densidad; **alta** en G (81 GPa es el valor normativo EC3).

---

## 4. Secciones — propiedades geométricas para el FEM

PyNite necesita por barra: **A** (área), **Iy** e **Iz** (momentos de inercia respecto a ejes locales fuerte/débil), **J** (constante de torsión), además de E y G del material. Direcciones: ejes **locales en minúscula**, globales en MAYÚSCULA (CLAUDE.md §7 — error común).

### Finding 4.1 — Sección rectangular de hormigón (fórmulas cerradas)
- **Claim:** Para sección rectangular de base **b** y canto **h**:
  - Área: **A = b · h**
  - Inercia eje fuerte (flexión sobre canto h): **I = b · h³ / 12**
  - Inercia eje débil: **I = h · b³ / 12**
  - Constante de torsión de Saint-Venant: **J = β · h · b³**, con b ≤ h, donde **β** depende de h/b:

    | h/b | 1,0 | 1,5 | 2,0 | 3,0 | 6,0 | ∞ |
    |---|---|---|---|---|---|---|
    | β | 0,141 | 0,196 | 0,229 | 0,263 | 0,299 | 0,333 |

    Aproximación práctica (Roark): **J ≈ a·b³·[1/3 − 0,21·(b/a)·(1 − b⁴/(12·a⁴))]** con a = lado mayor, b = lado menor.
- **Rationale:** **Nunca** usar el momento polar Ip = (b·h/12)·(b²+h²) como J en secciones no circulares: sobreestima la rigidez torsional. Para el MVP de pórticos planos la torsión suele ser secundaria, pero PyNite exige J; usar β o la aproximación de Roark. **A, Iy, Iz** son exactos por fórmula.
- **Sources:** Roark's Formulas for Stress and Strain (tabla de torsión de barras rectangulares); https://calcresource.com / referencias St. Venant torsion: https://www.firgelliauto.com/blogs/engineering-calculators/torsional-constant-calculator
- **Confidence:** **alta** (A, I exactos; β tabulado estándar de ingeniería).

### Finding 4.2 — Perfiles metálicos laminados (tabulados, no calculados)
- **Claim:** Las propiedades de IPE/HEA/HEB/HEM/UPN se **tabulan** según **EN 10365** (dimensiones y masas) — no se calculan con fórmula por la presencia de radios de acuerdo. La biblioteca debe almacenar A, Iy, Iz, It (J), Wy, Wz, peso. Valores **ilustrativos** (verificar contra prontuario EN 10365 antes de producción):

| Perfil | A [cm²] | Iy [cm⁴] | Iz [cm⁴] | It (J) [cm⁴] | Peso [kg/m] |
|---|---|---|---|---|---|
| IPE 300 | ~53,8 | ~8 356 | ~604 | ~20,1 | 42,2 |
| HEA 200 | ~53,8 | ~3 692 | ~1 336 | ~21,0 | 42,3 |
| HEB 200 | ~78,1 | ~5 696 | ~2 003 | ~59,3 | 61,3 |

- **Rationale:** Para PyNite convertir cm⁴ → m⁴ (×10⁻⁸) y cm² → m² (×10⁻⁴). Estos valores deben cargarse desde una tabla oficial verificada (EN 10365 / prontuario CYPE / SteelConstruction). Los mostrados sirven de orden de magnitud y para golden tests, **no como fuente de verdad**.
- **Sources:** https://eurocodeapplied.com/design/en1993/ipe-hea-heb-hem-design-properties (tabla EN 10365)
- **Confidence:** **media** (IPE 300 Iy≈8356 verificado; resto requiere verificación contra tabla oficial antes de cablear la biblioteca).

---

## 5. Vocabulario y convenciones CYPECAD

### Finding 5.1 — Plantas vs Grupos
- **Claim:** En CYPECAD: una **Planta** es un nivel con cota y altura. Un **Grupo** es un "conjunto de plantas consecutivas e iguales entre sí y con una única salida de resultados" (comparten cargas y armado). La **cimentación es el grupo 0**. La categoría de uso, sobrecarga de uso y cargas muertas se definen **por grupo** y se aplican como carga superficial automática a toda su superficie en planta. Recomendación CYPE: no agrupar más de 3-4 plantas.
- **Rationale:** Encaja exactamente con el dominio del CLAUDE.md: `Grupo = {categoriaUso, sobrecargaUso, cargasMuertas}` y `Planta = {cota, altura, grupoId}`. La UI debe replicar el diálogo "Plantas/Grupos" (menú Introducción de la pestaña Entrada de pilares).
- **Sources:** https://info.cype.com/es/producto/cypecad-entrada-de-pilares/ ; https://info.cype.com/es/producto/cypecad-opciones-del-menu-grupos-en-la-pestana-entrada-de-vigas/
- **Confidence:** **alta**.

### Finding 5.2 — Introducción de pilares y vigas
- **Claim:** Los **pilares** se definen entre dos plantas: arrancan en una "planta inicial" y mueren en una "planta final", con un "punto fijo" (cómo crece la sección verticalmente). Las **vigas** se introducen por planta entre nudos. Cargas en grupos = superficiales aplicadas a toda la planta; cargas en vigas/paños se introducen en su pestaña con asignación de **hipótesis**.
- **Rationale:** El modelo `Pilar {plantaInicial, plantaFinal, x, y}` y `Viga {plantaId, nudoI, nudoJ}` del CLAUDE.md replica esto. El discretizador genera nodos en cabezas/pies de pilar y encuentros de viga.
- **Sources:** https://info.cype.com/es/producto/cypecad-entrada-de-pilares/ ; https://info.cype.com/es/producto/cypecad-opciones-del-menu-cargas-en-la-pestana-entrada-de-vigas/
- **Confidence:** **alta**.

---

## 6. Hipótesis de carga y su combinación

### Finding 6.1 — Tipos de hipótesis
- **Claim:** Las hipótesis de carga básicas en edificación española son: **Peso propio** (permanente, estructural), **Cargas muertas** (permanente, no estructural), **Sobrecarga de uso** (variable, una o varias por categoría/zona), **Viento** (variable, por dirección), **Nieve** (variable), **Sismo** (accidental). Cada carga introducida pertenece a una hipótesis. A efectos de combinación, las sobrecargas de **distinto uso** son acciones diferentes.
- **Rationale:** El dominio lleva `Hipotesis[]` y cada `Carga.hipotesisId`. El discretizador mapea: hipótesis → *load case* PyNite (`case=`), y construye *combos* combinando casos con γ (Tabla 4.1) y ψ (Tabla 4.2). Peso propio + cargas muertas → categoría "permanente" (γG=1,35); sobrecarga/viento/nieve → "variable" (γQ=1,50, con ψ según tipo).
- **Sources:** https://www.codigotecnico.org/pdf/Documentos/SE/DBSE-AE.pdf (§3, clasificación de acciones variables); https://www.codigotecnico.org/pdf/Documentos/SE/DBSE.pdf (§4.2.2)
- **Confidence:** **alta**.

### Finding 6.2 — Generación de combinaciones para el MVP
- **Claim:** Para F1, con hipótesis {PP, CM, SU} (sobrecarga de uso única), las combinaciones mínimas son:
  - **ELU persistente:** `1,35·(PP+CM) + 1,50·SU` (SU dominante; sin otras variables no hay término ψ0). Si hay viento V: añadir `1,35·(PP+CM) + 1,50·SU + 1,50·ψ0,V·V` y `1,35·(PP+CM) + 1,50·V + 1,50·ψ0,SU·SU`.
  - **ELS característica (flecha):** `1,0·(PP+CM) + 1,0·SU` (+ ψ0 si otras variables).
  - Caso favorable de permanente (vuelco/voladizo): `0,80·(PP+CM) + 1,50·SU`.
- **Rationale:** Cubre el corte vertical fino F1 (CLAUDE.md §15). El discretizador genera estos `combos` en el JSON de Capa 2; PyNite resuelve cada combo y devuelve esfuerzos/deformada. Golden tests: viga biapoyada con q uniforme bajo combo ELU 1,35G+1,5Q debe dar M = (1,35·g + 1,5·q)·L²/8.
- **Sources:** https://www.codigotecnico.org/pdf/Documentos/SE/DBSE.pdf (§4.2.2, 4.3.2)
- **Confidence:** **alta**.

---

## Recomendaciones accionables

1. **Cablear Tabla 3.1 (sobrecargas) y Tabla 4.2 (ψ) como constantes tipadas** en `/src/biblioteca` o `/src/dominio`, indexadas por categoría de uso (A1, A2, B, C1…G2). La categoría vive en `Grupo` (ya previsto). Un cambio de categoría debe recalcular qk y ψ automáticamente.
2. **Modelar las categorías de uso como enum cerrado** (`CategoriaUso = "A1"|"A2"|"B"|"C1"|...`) y derivar de él tanto `sobrecargaUso` por defecto (Tabla 3.1) como los `ψ0/ψ1/ψ2` (Tabla 4.2). Permitir override manual de la sobrecarga (CYPECAD lo permite).
3. **Implementar el generador de combinaciones en el discretizador** (`discretizar.ts`) con las fórmulas 4.3 (ELU) y 4.6/4.7/4.8 (ELS), aplicando γ de Tabla 4.1 y ψ de Tabla 4.2. Iterar la variable dominante. Para F1 basta ELU persistente + ELS característica.
4. **Distinguir permanente/variable y desfavorable/favorable** en cada hipótesis para aplicar γ correctos (1,35/0,80 permanente, 1,50/0 variable). Esto importa en voladizos y vuelco (alternancia de sobrecarga).
5. **Materiales:** biblioteca `hormigon.ts` con HA-25/30/35 calculando **Ecm = 8500·(fck+8)^(1/3)** MPa, ν=0,2, peso 25 kN/m³; `aceros.ts` con S235/S275/S355, E=210 000 N/mm², G=81 000, ν=0,3, peso 78,5 kN/m³. Convertir a kN/m² en el borde (×1000) antes de PyNite.
6. **Secciones de hormigón:** calcular A, Iy, Iz por fórmula exacta y **J por coeficiente β (o Roark)**, nunca por momento polar. Secciones metálicas: tabla EN 10365 verificada (no fórmula).
7. **Unidades:** confirmar conversión única en `/src/unidades`: secciones mm→m, E en MPa→kN/m² (×1000), inercias cm⁴→m⁴ (×1e-8). Coherente con sistema interno kN-m (CLAUDE.md §6/§14).
8. **Golden tests normativos:** viga biapoyada bajo `1,35·g+1,5·q` (M=wL²/8), voladizo con favorable 0,80·G, y verificación de que el ψ aplicado depende de la categoría del grupo. Casos de libro = red de seguridad (CLAUDE.md §13).
9. **Documentar la elección Ecm EHE-08 (8500·fcm^(1/3)) vs EC2 (22000·(fcm/10)^0,3)** en el código y fijar la española por defecto.
10. **Posponer a F2+:** reducción de sobrecargas (§3.1.2), combinaciones accidental/sísmica (4.4/4.5, NCSE-02), peso propio automático, viento (DB-SE-AE §3.3, Anejo D) y nieve (§3.5). En F1 introducir viento/nieve como cargas manuales si se desea, pero los ψ ya están tabulados arriba para cuando se automaticen.

---

## Fuentes oficiales consultadas

- **CTE DB-SE-AE** (Acciones en la edificación, abril 2009): https://www.codigotecnico.org/pdf/Documentos/SE/DBSE-AE.pdf
- **CTE DB-SE** (Seguridad Estructural): https://www.codigotecnico.org/pdf/Documentos/SE/DBSE.pdf
- **EHE-08** (Instrucción de Hormigón Estructural, Ministerio de Transportes): https://www.transportes.gob.es/recursos_mfom/1820100.pdf
- Módulos de elasticidad del hormigón (divulgación técnica, fórmulas EHE-08): https://estructurando.net/2019/06/18/los-modulos-de-elasticidad-del-hormigon/
- Acero B500SD (ficha técnica): https://gcampesa.com/Pdf/descargas/2-acero_B_500_SD.pdf
- Propiedades de perfiles EN 10365 (IPE/HEA/HEB, EC3): https://eurocodeapplied.com/design/en1993/ipe-hea-heb-hem-design-properties
- CYPECAD — Entrada de pilares (grupos/plantas): https://info.cype.com/es/producto/cypecad-entrada-de-pilares/
- CYPECAD — Grupos en Entrada de vigas: https://info.cype.com/es/producto/cypecad-opciones-del-menu-grupos-en-la-pestana-entrada-de-vigas/
- Prontuario sobrecargas de uso (referencia secundaria): http://prontuarios.info/acciones/sobrecargasuso
