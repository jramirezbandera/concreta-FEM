// Tests del helper puro de coherencia cotas/alturas (D16). Se ejecuta en Node (project
// por defecto): sin React, sin stores. Verifica huecos, solapes, el caso coherente sin
// aviso, tolerancia de coma flotante, y "un solo aviso por par".
import { describe, it, expect } from "vitest";
import { detectarIncoherenciasCotas } from "./coherenciaCotas";
import type { Planta } from "../../dominio";

// Fabrica una planta minima con lo que consume el helper (id, nombre, cota, altura).
// grupoId es indiferente aqui (el helper recibe ya las plantas de un grupo).
function planta(id: string, nombre: string, cota: number, altura: number): Planta {
  return { id, nombre, cota, altura, grupoId: "g1" };
}

describe("detectarIncoherenciasCotas", () => {
  it("no avisa cuando las plantas encajan (cabeza_i === arranque_i+1)", () => {
    const plantas = [
      planta("p1", "Planta 1", 0, 3),
      planta("p2", "Planta 2", 3, 3),
      planta("p3", "Planta 3", 6, 3),
    ];
    expect(detectarIncoherenciasCotas(plantas)).toEqual([]);
  });

  it("no avisa con una sola planta ni con la lista vacia", () => {
    expect(detectarIncoherenciasCotas([planta("p1", "Planta 1", 0, 3)])).toEqual([]);
    expect(detectarIncoherenciasCotas([])).toEqual([]);
  });

  it("avisa de un HUECO: la siguiente arranca mas arriba que la cabeza de la previa", () => {
    // Planta 1 termina a +3.00; Planta 2 arranca a +4.00 (hueco de 1 m).
    const plantas = [
      planta("p1", "Planta 1", 0, 3),
      planta("p2", "Planta 2", 4, 3),
    ];
    const avisos = detectarIncoherenciasCotas(plantas);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].plantaInferiorId).toBe("p1");
    expect(avisos[0].mensaje).toBe(
      'La planta "Planta 1" termina a +3.00 m pero "Planta 2" arranca a +4.00 m: revisa cotas y alturas.',
    );
  });

  it("avisa de un SOLAPE: la siguiente arranca dentro de la previa", () => {
    // Planta 1 termina a +3.00; Planta 2 arranca a +2.50 (solape de 0,5 m).
    const plantas = [
      planta("p1", "Planta 1", 0, 3),
      planta("p2", "Planta 2", 2.5, 3),
    ];
    const avisos = detectarIncoherenciasCotas(plantas);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].mensaje).toBe(
      'La planta "Planta 1" termina a +3.00 m pero "Planta 2" arranca a +2.50 m: revisa cotas y alturas.',
    );
  });

  it("un solo aviso POR PAR: dos huecos consecutivos -> dos avisos, uno por par", () => {
    // p1 (0..3), p2 arranca a 4 (hueco), p2 (4..7), p3 arranca a 8 (hueco).
    const plantas = [
      planta("p1", "Planta 1", 0, 3),
      planta("p2", "Planta 2", 4, 3),
      planta("p3", "Planta 3", 8, 3),
    ];
    const avisos = detectarIncoherenciasCotas(plantas);
    expect(avisos).toHaveLength(2);
    expect(avisos.map((a) => a.plantaInferiorId)).toEqual(["p1", "p2"]);
  });

  it("solo el par incoherente avisa cuando el resto encaja", () => {
    // p1 (0..3) encaja con p2 (3..6); p2 no encaja con p3 (arranca a 7).
    const plantas = [
      planta("p1", "Planta 1", 0, 3),
      planta("p2", "Planta 2", 3, 3),
      planta("p3", "Planta 3", 7, 3),
    ];
    const avisos = detectarIncoherenciasCotas(plantas);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].plantaInferiorId).toBe("p2");
  });

  it("ordena por cota ascendente sea cual sea el orden de entrada", () => {
    // Entradas desordenadas: el helper las ordena por cota antes de comparar pares.
    const plantas = [
      planta("p3", "Planta 3", 6, 3),
      planta("p1", "Planta 1", 0, 3),
      planta("p2", "Planta 2", 3, 3),
    ];
    // Encajan perfectamente una vez ordenadas: sin avisos.
    expect(detectarIncoherenciasCotas(plantas)).toEqual([]);
  });

  it("absorbe el ruido de coma flotante (0,30 + 2,70 == 3,00): sin aviso", () => {
    // 0.3 + 2.7 = 2.9999999999999996 en doble precision; dentro de tolerancia (1 mm).
    const plantas = [
      planta("p1", "Planta baja", 0.3, 2.7),
      planta("p2", "Planta 1", 3, 3),
    ];
    expect(detectarIncoherenciasCotas(plantas)).toEqual([]);
  });

  it("formatea cotas negativas con signo (sotano)", () => {
    // Sotano: p1 arranca a -3 y mide 2,5 (termina a -0,50); p2 arranca a 0 (hueco de 0,5).
    const plantas = [
      planta("p1", "Sótano", -3, 2.5),
      planta("p2", "Planta baja", 0, 3),
    ];
    const avisos = detectarIncoherenciasCotas(plantas);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].mensaje).toBe(
      'La planta "Sótano" termina a -0.50 m pero "Planta baja" arranca a +0.00 m: revisa cotas y alturas.',
    );
  });
});
