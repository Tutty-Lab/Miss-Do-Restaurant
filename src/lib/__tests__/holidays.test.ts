import { describe, expect, it } from "vitest";
import { easterSunday, publicHolidays, publicHolidayNames } from "../holidays";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { DEFAULT_WORK_HOURS } from "../workHours";
import { SAMPLE_EMPLOYEES } from "../sampleData";
import { format } from "date-fns";
import type { Shift } from "../../types";

const isFloor = (s: Shift) => (s.category ?? "FLOOR") === "FLOOR";

describe("Feiertage (Berlin)", () => {
  it("berechnet Ostersonntag korrekt", () => {
    expect(format(easterSunday(2026), "yyyy-MM-dd")).toBe("2026-04-05");
    expect(format(easterSunday(2024), "yyyy-MM-dd")).toBe("2024-03-31");
  });

  it("enthält die festen und beweglichen Berliner Feiertage 2026", () => {
    const h = publicHolidays(2026);
    expect(h.has("2026-01-01")).toBe(true); // Neujahr
    expect(h.has("2026-03-08")).toBe(true); // Internationaler Frauentag – Berlin
    expect(h.has("2026-04-03")).toBe(true); // Karfreitag
    expect(h.has("2026-04-06")).toBe(true); // Ostermontag
    expect(h.has("2026-05-01")).toBe(true); // Tag der Arbeit
    expect(h.has("2026-05-14")).toBe(true); // Christi Himmelfahrt
    expect(h.has("2026-05-25")).toBe(true); // Pfingstmontag
    expect(h.has("2026-10-03")).toBe(true); // Deutsche Einheit
    expect(h.has("2026-12-25")).toBe(true);
    expect(h.has("2026-12-26")).toBe(true);
    expect(h.size).toBe(10);
  });

  it("enthält KEINE Feiertage anderer Bundesländer", () => {
    const h = publicHolidays(2026);
    expect(h.has("2026-04-05")).toBe(false); // Ostersonntag – nur Brandenburg
    expect(h.has("2026-05-24")).toBe(false); // Pfingstsonntag – nur Brandenburg
    expect(h.has("2026-06-04")).toBe(false); // Fronleichnam – nicht in Berlin
    expect(h.has("2026-11-01")).toBe(false); // Allerheiligen – nicht in Berlin
    expect(h.has("2026-11-18")).toBe(false); // Buß- und Bettag – nur Sachsen
    expect(h.has("2026-10-31")).toBe(false); // Reformationstag – nicht in Berlin
    expect(h.has("2025-05-08")).toBe(false); // 8. Mai galt nur 2025, einmalig
    expect(h.has("2026-01-06")).toBe(false); // Heilige Drei Könige – nicht in Berlin
  });



  it("Set und Namen bleiben deckungsgleich", () => {
    for (const year of [2024, 2026, 2027]) {
      expect(publicHolidays(year).size).toBe(publicHolidayNames(year).size);
    }
  });
});

describe("Scheduler mit Feiertagen (Dezember 2026)", () => {
  const shifts = generateSchedule({
    year: 2026,
    month: 12, // enthält 1. und 2. Weihnachtstag
    workHours: DEFAULT_WORK_HOURS,
    employees: SAMPLE_EMPLOYEES,
  });

  it("bleibt gültig und trifft jedes Ladensoll exakt", () => {
    const result = validateSchedule(SAMPLE_EMPLOYEES, shifts);
    expect(result.valid).toBe(true);
    const soll = SAMPLE_EMPLOYEES.reduce((sum, e) => sum + e.targetMinutes, 0);
    const floor = shifts.filter(isFloor).reduce((s, x) => s + x.paidMinutes, 0);
    expect(floor).toBe(soll);
  });

  it("plant an Feiertagen KEINEN Ladendienst (Einzelhandel hat zu)", () => {
    // 25.12. und 26.12. sind in Berlin Feiertage -> Laden geschlossen.
    for (const tag of ["2026-12-25", "2026-12-26"]) {
      expect(shifts.filter((s) => s.date === tag && isFloor(s))).toEqual([]);
    }
  });
});
