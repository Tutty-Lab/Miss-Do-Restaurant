import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { maxConsecutiveRun } from "../consecutive";
import { SAMPLE_EMPLOYEES } from "../sampleData";
import { DEFAULT_WORK_HOURS } from "../workHours";
import { calculatePause } from "../time";
import type { Shift } from "../../types";

const isFloor = (s: Shift) => (s.category ?? "FLOOR") === "FLOOR";
const floorPaid = (s: Shift) => s.paidMinutes - (s.nightMinutes ?? 0);

describe("Scheduler – Beispielbelegschaft Miss Do (September 2026)", () => {
  const shifts = generateSchedule({
    year: 2026,
    month: 9,
    workHours: DEFAULT_WORK_HOURS,
    employees: SAMPLE_EMPLOYEES,
  });

  it("verteilt genau die Summe der Ladenstunden", () => {
    const soll = SAMPLE_EMPLOYEES.reduce((s, e) => s + e.targetMinutes, 0);
    const floor = shifts.filter(isFloor).reduce((s, x) => s + floorPaid(x), 0);
    expect(floor).toBe(soll);
  });

  it("trifft jedes einzelne Ladensoll exakt", () => {
    for (const emp of SAMPLE_EMPLOYEES) {
      const assigned = shifts
        .filter((s) => s.employeeId === emp.id && isFloor(s))
        .reduce((sum, s) => sum + floorPaid(s), 0);
      expect(assigned).toBe(emp.targetMinutes);
    }
  });

  it("trifft jeden Reinigungs-Topf (Nacht + Sonntag) exakt", () => {
    for (const emp of SAMPLE_EMPLOYEES) {
      const night = shifts
        .filter((s) => s.employeeId === emp.id)
        .reduce((sum, s) => sum + (s.nightMinutes ?? 0), 0);
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
      const ladenPaid = s.paidMinutes - (s.nightMinutes ?? 0);
      // Pause und 9-h-Grenze gelten nur für den Ladenanteil; die Abend-
      // verlängerung bringt keine Pause.
      expect(s.pauseMinutes).toBe(calculatePause(ladenPaid, typ));
      expect(s.endMinutes - s.startMinutes - s.pauseMinutes).toBe(s.paidMinutes);
      if (isFloor(s)) {
        expect(s.startMinutes).toBeGreaterThanOrEqual(9 * 60 + 30);
        expect(ladenPaid).toBeLessThanOrEqual(9 * 60);
        // Ende spätestens 20:00 – außer bei einer Abendverlängerung (bis 23:00).
        expect(s.endMinutes).toBeLessThanOrEqual((s.nightMinutes ?? 0) > 0 ? 23 * 60 : 20 * 60);
      }
    }
  });

  it("Abendreinigung verlängert einen schließenden Dienst über 20:00 (ko ngắt ca)", () => {
    for (const s of shifts.filter((x) => (x.nightMinutes ?? 0) > 0)) {
      // Ein durchgehender FLOOR-Dienst, der nach 20:00 weiterläuft.
      expect(s.category ?? "FLOOR").toBe("FLOOR");
      expect(s.endMinutes).toBeGreaterThan(20 * 60);
      expect(s.endMinutes).toBeLessThanOrEqual(23 * 60);
      // Der Ladenteil endet spätestens 20:00, der Rest ist nightMinutes.
      expect(s.endMinutes - 20 * 60).toBe(s.nightMinutes);
      expect(new Date(`${s.date}T12:00:00Z`).getUTCDay()).not.toBe(0);
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
