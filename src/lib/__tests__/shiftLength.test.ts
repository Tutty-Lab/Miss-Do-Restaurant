import { describe, expect, it } from "vitest";
import { chooseShiftHours, maxShiftHoursForWindow } from "../scheduler";

describe("maxShiftHoursForWindow", () => {
  it("rechnet mit Anwesenheit inkl. Pause, nicht mit bezahlter Zeit", () => {
    // Anwesenheit (Stammkraft-Pause): 3h=180 4h=240 5h=300 6h=360 7h=480 8h=540 9h=600.
    expect(maxShiftHoursForWindow(630)).toBe(9); // 9 h + 60 min = 600 passt
    expect(maxShiftHoursForWindow(600)).toBe(9);
    expect(maxShiftHoursForWindow(599)).toBe(8);
    expect(maxShiftHoursForWindow(540)).toBe(8);
    expect(maxShiftHoursForWindow(539)).toBe(7);
    expect(maxShiftHoursForWindow(480)).toBe(7);
    expect(maxShiftHoursForWindow(479)).toBe(6);
    expect(maxShiftHoursForWindow(360)).toBe(6); // 6 h, noch ohne Pause
    expect(maxShiftHoursForWindow(300)).toBe(5);
    expect(maxShiftHoursForWindow(3 * 60)).toBe(3);
    expect(maxShiftHoursForWindow(3 * 60 - 1)).toBe(0); // zu kurz für 3 h
  });
});

describe("chooseShiftHours – kurz im Normalfall, lang nur bei Bedarf", () => {
  const rng = () => 0.5; // deterministischer „Zufall" für den Normalfall

  it("nimmt die KÜRZESTE Länge, die das Tempo (needHours) noch hält", () => {
    // needHours = 4 => kürzeste on-pace Länge ist 4 (nicht länger).
    expect(chooseShiftHours(80 * 60, 9, "TEILZEIT", 4, rng)).toBe(4);
    // needHours = 6 => 6, obwohl das Fenster 9 h hergäbe.
    expect(chooseShiftHours(120 * 60, 9, "VOLLZEIT", 6, rng)).toBe(6);
  });

  it("geht auf LANGE Dienste (7–9 h), wenn wenige Tage + viel Soll es verlangen", () => {
    // needHours = 8 (z. B. feste Do/Fr/Sa bei hohem Soll) => mind. 8 h.
    expect(chooseShiftHours(96 * 60, 9, "TEILZEIT", 8, rng)).toBeGreaterThanOrEqual(8);
  });

  it("arbeitet an einem halben Tag eine KÜRZERE Schicht, statt frei zu haben", () => {
    const hours = chooseShiftHours(120 * 60, 5, "VOLLZEIT", 6, rng); // Fenster nur 5 h
    expect(hours).toBeGreaterThanOrEqual(3);
    expect(hours).toBeLessThanOrEqual(5);
  });
});

describe("chooseShiftHours – Teilzeit und Minijob", () => {
  it("hält den Rest exakt aufteilbar", () => {
    // Teilzeit darf 3..9 h, ein Rest von 3 h ist also in Ordnung.
    expect(chooseShiftHours(8 * 60, 8, "TEILZEIT")).toBeGreaterThanOrEqual(3);
    const h = chooseShiftHours(11 * 60, 9, "TEILZEIT");
    expect(11 - h === 0 || 11 - h >= 3).toBe(true);
  });

  it("hält den Rest passend aufteilbar, wenn die Stoßzeit eine lange Schicht braucht", () => {
    // peakHours = 6 verlangt eine Schicht >= 6 h UND einen Rest, der sich
    // ebenfalls aus solchen Längen zusammensetzen lässt. 120 h = 20 × 6 h.
    expect(chooseShiftHours(120 * 60, 6, "TEILZEIT", 6, undefined, 6)).toBeGreaterThanOrEqual(6);
  });

  it("gibt 0 zurück, wenn keine gültige Länge möglich ist", () => {
    expect(chooseShiftHours(160 * 60, 2, "VOLLZEIT")).toBe(0); // Fenster < 3 h
    expect(chooseShiftHours(2 * 60, 8, "TEILZEIT")).toBe(0); // Rest zu klein (< 3 h)
  });
});
