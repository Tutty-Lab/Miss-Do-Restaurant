import { describe, expect, it } from "vitest";
import { chooseShiftHours, maxShiftHoursForWindow } from "../scheduler";

describe("maxShiftHoursForWindow", () => {
  it("rechnet mit Anwesenheit inkl. Pause, nicht mit bezahlter Zeit", () => {
    // Schichten sind jetzt höchstens 6 h und liegen damit unter der Pausenschwelle
    // (>6 h). Anwesenheit = bezahlte Zeit: 6h=360 5h=300 4h=240 3h=180.
    expect(maxShiftHoursForWindow(630)).toBe(6);
    expect(maxShiftHoursForWindow(600)).toBe(6);
    expect(maxShiftHoursForWindow(360)).toBe(6); // exakt 6 h
    expect(maxShiftHoursForWindow(359)).toBe(5);
    expect(maxShiftHoursForWindow(300)).toBe(5);
    expect(maxShiftHoursForWindow(299)).toBe(4);
    expect(maxShiftHoursForWindow(240)).toBe(4);
    expect(maxShiftHoursForWindow(3 * 60)).toBe(3);
    expect(maxShiftHoursForWindow(3 * 60 - 1)).toBe(0); // zu kurz für 3 h
  });
});

describe("chooseShiftHours – Vollzeit macht höchstens 6-Stunden-Tage", () => {
  it("nimmt 6 h, auch wenn das Fenster mehr hergäbe", () => {
    // Max 6 h; bei einem Fenster für 9 h bleibt es bei 6.
    expect(chooseShiftHours(120 * 60, 9, "VOLLZEIT")).toBe(6);
    expect(chooseShiftHours(120 * 60, 6, "VOLLZEIT")).toBe(6);
  });

  it("weicht nur aus, wenn 6 h den Monat nicht aufgehen lässt", () => {
    const h = chooseShiftHours(11 * 60, 9, "VOLLZEIT");
    expect(h).toBeGreaterThan(0);
    expect(11 - h).toBeGreaterThanOrEqual(3); // Rest bleibt planbar
  });

  it("arbeitet an einem halben Tag eine KÜRZERE Schicht, statt frei zu haben", () => {
    // 5 h Fenster: 6 h passen nicht, also greift auch hier der Rückfall.
    const hours = chooseShiftHours(120 * 60, 5, "VOLLZEIT");
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
