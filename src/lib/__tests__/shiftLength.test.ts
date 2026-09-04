import { describe, expect, it } from "vitest";
import { chooseShiftHours, maxShiftHoursForWindow } from "../scheduler";

describe("maxShiftHoursForWindow", () => {
  it("rechnet mit Anwesenheit inkl. Pause, nicht mit bezahlter Zeit", () => {
    // Hier gibt es Pausen (0 / 30 / 60), und sie verlängern die Anwesenheit.
    // Anwesenheit: 9h->600, 8h->540, 7h->450, 6h->360, 5h->300, 3h->180.
    // Wer das mit der bezahlten Zeit verwechselt, plant Schichten, die hinten
    // aus dem Fenster ragen.
    // Anwesenheit (Stammkraft-Pause): 3h=180 4h=240 5h=300 6h=360 7h=480 8h=540 9h=600.
    expect(maxShiftHoursForWindow(630)).toBe(9); // 9 h + 60 min = 600 passt
    expect(maxShiftHoursForWindow(600)).toBe(9); // exakt 9 h + 60 min Pause
    expect(maxShiftHoursForWindow(599)).toBe(8);
    expect(maxShiftHoursForWindow(540)).toBe(8); // 8 h + 60 min
    expect(maxShiftHoursForWindow(539)).toBe(7);
    expect(maxShiftHoursForWindow(480)).toBe(7); // 7 h + 60 min
    expect(maxShiftHoursForWindow(479)).toBe(6);
    expect(maxShiftHoursForWindow(360)).toBe(6); // 6 h, noch ohne Pause
    expect(maxShiftHoursForWindow(300)).toBe(5);
    expect(maxShiftHoursForWindow(3 * 60)).toBe(3);
    expect(maxShiftHoursForWindow(3 * 60 - 1)).toBe(0); // zu kurz für 3 h
  });
});

describe("chooseShiftHours – Vollzeit macht 8-Stunden-Tage", () => {
  it("nimmt 8 h, auch wenn das Fenster mehr hergäbe", () => {
    // Angabe des Betriebs: "Vollzeit 8 tiếng 1 ngày". Auch bei einem Fenster
    // für 9 h bleibt es bei 8 – 160 h im Monat sind genau 20 solcher Tage.
    expect(chooseShiftHours(160 * 60, 9, "VOLLZEIT")).toBe(8);
    expect(chooseShiftHours(160 * 60, 8, "VOLLZEIT")).toBe(8);
  });

  it("weicht nur aus, wenn 8 h den Monat nicht aufgehen lässt", () => {
    // 11 h Rest ist kein Vielfaches von 8. Statt den Monat platzen zu lassen,
    // greift der Rückfall auf alle Längen – Hauptsache, das Soll geht auf.
    const h = chooseShiftHours(11 * 60, 9, "VOLLZEIT");
    expect(h).toBeGreaterThan(0);
    expect(11 - h).toBeGreaterThanOrEqual(3); // Rest bleibt planbar
  });

  it("arbeitet an einem halben Tag eine KÜRZERE Schicht, statt frei zu haben", () => {
    // 5 h Fenster: 8 h passen nicht, also greift auch hier der Rückfall.
    const hours = chooseShiftHours(160 * 60, 5, "VOLLZEIT");
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

  it("hält den Rest auch in LANGEN Längen aufteilbar, wenn die Stoßzeit sie braucht", () => {
    // peakHours = 8 verlangt eine Schicht >= 8 h UND einen Rest, der sich
    // ebenfalls aus solchen Längen zusammensetzen lässt. 120 h = 15 x 8 h.
    expect(chooseShiftHours(120 * 60, 9, "TEILZEIT", 8, undefined, 8)).toBeGreaterThanOrEqual(8);
  });

  it("gibt 0 zurück, wenn keine gültige Länge möglich ist", () => {
    expect(chooseShiftHours(160 * 60, 2, "VOLLZEIT")).toBe(0); // Fenster < 3 h
    expect(chooseShiftHours(2 * 60, 8, "TEILZEIT")).toBe(0); // Rest zu klein (< 3 h)
  });
});
