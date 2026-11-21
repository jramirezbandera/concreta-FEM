import type { Quantity, QuantitySpec } from "./types.ts";

export const CATALOG: Record<Quantity, QuantitySpec> = {
  force: {
    siUnit: "kN",
    tecnicoUnit: "Tn",
    toTecnico: 0.101971621,
    precisionSi: 2,
    precisionTecnico: 2,
  },
  moment: {
    siUnit: "kNm",
    tecnicoUnit: "mt",
    toTecnico: 0.101971621,
    precisionSi: 2,
    precisionTecnico: 2,
  },
  // Momento por metro de ancho: el que se calcula en lo que se arma por metro
  // —el fuste de un muro, la punta y el talón de su zapata, el voladizo de una
  // placa de anclaje—. Mismo factor que el momento; la unidad NO es la misma y
  // rotularlo «kNm» sería falso.
  momentPerLength: {
    siUnit: "kNm/m",
    tecnicoUnit: "mt/m",
    toTecnico: 0.101971621,
    precisionSi: 2,
    precisionTecnico: 2,
  },
  linearLoad: {
    siUnit: "kN/m",
    tecnicoUnit: "kg/m",
    toTecnico: 101.971621,
    precisionSi: 2,
    precisionTecnico: 0,
  },
  areaLoad: {
    siUnit: "kN/m²",
    tecnicoUnit: "kg/m²",
    toTecnico: 101.971621,
    precisionSi: 2,
    precisionTecnico: 0,
  },
  stress: {
    siUnit: "N/mm²",
    tecnicoUnit: "kg/cm²",
    toTecnico: 10.1971621,
    precisionSi: 1,
    precisionTecnico: 1,
  },
  // Soil bearing pressure — stored internally in kPa, displayed in N/mm² (SI)
  // or kg/cm² (técnico). 1 N/mm² = 1000 kPa; 1 kg/cm² = 98.0665 kPa.
  soilPressure: {
    siUnit: "N/mm²",
    tecnicoUnit: "kg/cm²",
    toSi: 0.001,
    toTecnico: 1 / 98.0665,
    precisionSi: 3,
    precisionTecnico: 2,
  },
  youngModulus: {
    siUnit: "N/mm²",
    tecnicoUnit: "kg/cm²",
    toTecnico: 10.1971621,
    precisionSi: 0,
    precisionTecnico: 0,
  },
  // Soil unit weight (peso específico). Stored in kN/m³, displayed as kN/m³ in
  // SI or t/m³ in técnico. 1 kN/m³ ≈ 0.10197 t/m³ (typical 18 kN/m³ → 1.83 t/m³).
  weightDensity: {
    siUnit: "kN/m³",
    tecnicoUnit: "t/m³",
    toTecnico: 0.101971621,
    precisionSi: 1,
    precisionTecnico: 2,
  },
  // Cohesión efectiva c' (taludes/geotecnia). Almacenada en kPa; se muestra en
  // kPa (SI) o kg/cm² en técnico. 1 kg/cm² = 98.0665 kPa. A diferencia de
  // soilPressure (que se muestra en N/mm²), la cohesión es un valor pequeño que
  // se lee mejor en kPa, por eso tiene su propia entrada en lugar de reusar
  // soilPressure.
  cohesion: {
    siUnit: "kPa",
    tecnicoUnit: "kg/cm²",
    toTecnico: 1 / 98.0665,
    precisionSi: 1,
    precisionTecnico: 2,
  },
  // Ángulo (rozamiento interno φ', inclinación del talud β). Adimensional en la
  // práctica: idéntico en SI y en técnico, en grados sexagesimales — no hay
  // conversión (factor 1). Se cataloga para que el sufijo «°» salga del sistema
  // de unidades como cualquier otra magnitud.
  angle: {
    siUnit: "°",
    tecnicoUnit: "°",
    toTecnico: 1,
    precisionSi: 1,
    precisionTecnico: 1,
  },
};
