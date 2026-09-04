import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { maxConsecutiveRun } from "../consecutive";
import { SAMPLE_EMPLOYEES } from "../sampleData";
import { DEFAULT_WORK_HOURS } from "../workHours";
import { calculatePause } from "../time";
import type { Shift } from "../../types";

const isFloor = (s: Shift) => (s.category ?? "FLOOR") === "FLOOR";

describe("Scheduler – Beispielbelegschaft Miss Do (September 2026)", () => {
  const shifts = generateSchedule({
    year: 2026,
    month: 9,
    workHours: DEFAULT_WORK_HOURS,
    employees: SAMPLE_EMPLOYEES,
  });

  it("verteilt genau die Summe der Ladenstunden", () => {
    const soll = SAMPLE_EMPLOYEES.reduce((s, e) => s + e.targetMinutes, 0);
    const floor = shifts.filter(isFloor).reduce((s, x) => s + x.paidMinutes, 0);
    expect(floor).toBe(soll);
  });

  it("trifft jedes einzelne Ladensoll exakt", () => {
    for (const emp of SAMPLE_EMPLOYEES) {
      const assigned = shifts
        .filter((s) => s.employeeId === emp.id && isFloor(s))
        .reduce((sum, s) => sum + s.paidMinutes, 0);
      expect(assigned).toBe(emp.targetMinutes);
    }
  });

  it("trifft jeden Reinigungs-Topf (Nacht + Sonntag) exakt", () => {
    for (const emp of SAMPLE_EMPLOYEES) {
      const night = shifts
        .filter((s) => s.employeeId === emp.id && s.category === "NIGHT")
        .reduce((sum, s) => sum + s.paidMinutes, 0);
      const sunday = shifts
        .filter((s) => s.employeeId === emp.id && s.category === "SUNDAY")
        .reduce((sum, s) => sum + s.paidMinutes, 0);
      expect(night).toBe(emp.nightMinutes ?? 0);
      expect(sunday).toBe(emp.sundayMinutes ?? 0);
    }
  });

  it("hält alle harten Regeln ein (Validierung grün)", () => {
    const result = validateSchedule(SAMPLE_EMPLOYEES, shifts);
    expect(result.errors.filter((e) => e.severity !== "warning")).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("höchstens ein LADENDIENST pro Mitarbeiter und Tag", () => {
    const seen = new Set<string>();
    for (const s of shifts.filter(isFloor)) {
      const key = `${s.employeeId}#${s.date}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("Ladendienste: nie mehr als 6 aufeinanderfolgende Tage", () => {
    for (const emp of SAMPLE_EMPLOYEES) {
      const dates = shifts
        .filter((s) => s.employeeId === emp.id && isFloor(s))
        .map((s) => s.date);
      expect(maxConsecutiveRun(dates)).toBeLessThanOrEqual(6);
    }
  });

  it("Ladendienst 9:30–20:00; jede Schicht mit korrekter Pause", () => {
    const byId = new Map(SAMPLE_EMPLOYEES.map((e) => [e.id, e] as const));
    for (const s of shifts) {
      const typ = byId.get(s.employeeId)?.employmentType;
      expect(s.pauseMinutes).toBe(calculatePause(s.paidMinutes, typ));
      expect(s.endMinutes - s.startMinutes - s.pauseMinutes).toBe(s.paidMinutes);
      if (isFloor(s)) {
        expect(s.startMinutes).toBeGreaterThanOrEqual(9 * 60 + 30);
        expect(s.endMinutes).toBeLessThanOrEqual(20 * 60);
        expect(s.paidMinutes).toBeLessThanOrEqual(9 * 60);
      }
    }
  });

  it("Nachtreinigung liegt 20:00–23:00, Sonntagsreinigung an Sonntagen", () => {
    for (const s of shifts.filter((x) => x.category === "NIGHT")) {
      expect(s.startMinutes).toBeGreaterThanOrEqual(20 * 60);
      expect(s.endMinutes).toBeLessThanOrEqual(23 * 60);
    }
    for (const s of shifts.filter((x) => x.category === "SUNDAY")) {
      expect(new Date(`${s.date}T12:00:00Z`).getUTCDay()).toBe(0);
    }
  });

  it("kein Ladendienst am Sonntag (Laden ist sonntags zu)", () => {
    for (const s of shifts.filter(isFloor)) {
      expect(new Date(`${s.date}T12:00:00Z`).getUTCDay()).not.toBe(0);
    }
  });

  it("ist deterministisch (gleiche Eingabe => gleiche Ausgabe)", () => {
    const again = generateSchedule({
      year: 2026,
      month: 9,
      workHours: DEFAULT_WORK_HOURS,
      employees: SAMPLE_EMPLOYEES,
    });
    const key = (s: Shift) => `${s.date}|${s.employeeId}|${s.paidMinutes}|${s.category ?? "FLOOR"}`;
    expect(again.map(key)).toEqual(shifts.map(key));
  });

  it("plant mehr Ladenstunden am Samstag als am Montag", () => {
    const byDate = new Map<string, number>();
    for (const s of shifts.filter(isFloor)) {
      byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.paidMinutes);
    }
    // 2026-09-05 ist Samstag, 2026-09-07 ist Montag.
    const sat = byDate.get("2026-09-05") ?? 0;
    const mon = byDate.get("2026-09-07") ?? 0;
    expect(sat).toBeGreaterThan(mon);
  });
});

describe("Scheduler – weitere Monate robust", () => {
  it("erzeugt gültige Pläne für Februar (28 Tage)", () => {
    const shifts = generateSchedule({
      year: 2026,
      month: 2,
      workHours: DEFAULT_WORK_HOURS,
      employees: SAMPLE_EMPLOYEES,
    });
    const result = validateSchedule(SAMPLE_EMPLOYEES, shifts);
    expect(result.valid).toBe(true);
  });
});
