export type UnitSystem = "si" | "tecnico";

export type Quantity =
  | "force"
  | "moment"
  | "momentPerLength"
  | "linearLoad"
  | "areaLoad"
  | "stress"
  | "soilPressure"
  | "youngModulus"
  | "weightDensity"
  | "cohesion"
  | "angle";

export type QuantitySpec = {
  siUnit: string;
  tecnicoUnit: string;
  toTecnico: number;
  // Factor from internal SI-like value to the SI display unit. Defaults to 1.
  // Used when the internal representation differs from the SI label shown in
  // the UI — e.g. soil pressures are stored in kPa but displayed in N/mm².
  toSi?: number;
  precisionSi: number;
  precisionTecnico: number;
};
