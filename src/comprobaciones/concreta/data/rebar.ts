// Standard rebar diameters and cross-section areas (mm²)
export interface RebarSize {
  diam: number; // mm
  area: number; // mm² single bar
}

export const rebarSizes: RebarSize[] = [
  { diam: 6,  area: 28.3 },
  { diam: 8,  area: 50.3 },
  { diam: 10, area: 78.5 },
  { diam: 12, area: 113.1 },
  { diam: 16, area: 201.1 },
  { diam: 20, area: 314.2 },
  { diam: 25, area: 490.9 },
  { diam: 32, area: 804.2 },
];

export const availableBarDiams = rebarSizes.map((r) => r.diam);

export function getBarArea(diam: number): number {
  const found = rebarSizes.find((r) => r.diam === diam);
  if (found) return found.area;
  return Math.PI * (diam / 2) ** 2;
}
