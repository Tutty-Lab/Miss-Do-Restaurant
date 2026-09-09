import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { DEFAULT_WORK_HOURS } from "../workHours";
import { SAMPLE_EMPLOYEES } from "../sampleData";
import { parseIsoDate, weekdayKeyOf } from "../demand";
import { calculateZuschlaege, normalizeSurchargeConfig, timesheetParts, zuschlagTotals } from "../zuschlaege";
import type { Shift } from "../../types";

const shift = (patch: Partial<Shift> = {}): Shift => ({
  id: "s", employeeId: "e", date: "2026-08-07", startMinutes: 780,
  endMinutes: 1320, paidMinutes: 480, pauseMinutes: 60, shiftType: "LATE",
  generated: true, ...patch,
});

describe("Actual-time surcharges", () => {
  it("calculates 25% night and 50% Sunday without counting Sunday twice", () => {
    const result = calculateZuschlaege([shift(), shift({ date: "2026-08-09" })],
      { after20Percent: 25, sundayPercent: 50 });
    expect(result).toMatchObject({ after20Minutes: 120, sundayMinutes: 480,
      after20BonusMinutes: 30, sundayBonusMinutes: 240, totalBonusMinutes: 270 });
  });

  it("supports one-hour nights, late starts and paid-time caps", () => {
    expect(calculateZuschlaege([shift({ endMinutes: 1260, paidMinutes: 420 })]).after20Minutes).toBe(60);
    expect(calculateZuschlaege([shift({ startMinutes: 1230, paidMinutes: 60, pauseMinutes: 30 })]).after20Minutes).toBe(60);
    expect(normalizeSurchargeConfig({ after20Percent: NaN, sundayPercent: -5 })).toEqual({ after20Percent: 0, sundayPercent: 0 });
  });

  it("splits the printed night portion with no extra paid time or pause", () => {
    expect(timesheetParts(shift())).toEqual([
      { startMinutes: 780, endMinutes: 1200, paidMinutes: 360, pauseMinutes: 60, label: "Arbeitszeit" },
      { startMinutes: 1200, endMinutes: 1320, paidMinutes: 120, pauseMinutes: 0, label: "Nachtzuschlag" },
    ]);
    for (const s of [shift(), shift({ startMinutes: 1190, paidMinutes: 100, pauseMinutes: 30 }),
      shift({ date: "2026-08-09" }), shift({ startMinutes: 1230, paidMinutes: 60, pauseMinutes: 30 })]) {
      const rows = timesheetParts(s);
      expect(rows.reduce((sum, p) => sum + p.paidMinutes, 0)).toBe(s.paidMinutes);
      expect(rows.reduce((sum, p) => sum + p.pauseMinutes, 0)).toBe(s.pauseMinutes);
      for (const p of rows) expect(p.endMinutes - p.startMinutes - p.pauseMinutes).toBe(p.paidMinutes);
    }
    expect(timesheetParts(shift({ date: "2026-08-09" }))).toHaveLength(1);
  });
});

describe.each([8, 9, 10])("Per-person night & Sunday quotas, month %i", (month) => {
  const employees = SAMPLE_EMPLOYEES.map((e) => ({ ...e }));
  const input = { year: 2026, month, workHours: DEFAULT_WORK_HOURS, employees };
  const shifts = generateSchedule(input);

  it("passes validation (v3 accounting) and is deterministic", () => {
    // combinedTargets=false: pause/9h rule only on the floor part (ohne nightMinutes).
    expect(validateSchedule(employees, shifts, false).errors).toEqual([]);
    expect(generateSchedule(input)).toEqual(shifts);
  });

  it("places each person's Sunday and after-20:00 hours exactly, on top of the day target", () => {
    for (const emp of employees) {
      const own = shifts.filter((s) => s.employeeId === emp.id);
      const totals = zuschlagTotals(own);
      expect(totals.sundayMinutes, `CN ${emp.name}`).toBe(emp.sundayMinutes ?? 0);
      expect(totals.after20Minutes, `đêm ${emp.name}`).toBe(emp.nightMinutes ?? 0);
      // Ladenstunden (Tag) = Soll: der Abendteil steckt in nightMinutes obendrauf.
      const floorPaid = own
        .filter((s) => (s.category ?? "FLOOR") === "FLOOR")
        .reduce((sum, s) => sum + s.paidMinutes - (s.nightMinutes ?? 0), 0);
      expect(floorPaid, `Soll ${emp.name}`).toBe(emp.targetMinutes);
    }
  });

  it("keeps floor service within 9:30–20:00; only night work runs past 20:00", () => {
    for (const s of shifts) {
      if (s.category === "SUNDAY") {
        expect(s.startMinutes).toBe(600); // Sonntagsreinigung ab 10:00
        continue;
      }
      expect(s.startMinutes).toBeGreaterThanOrEqual(570); // ab 9:30
      if (s.endMinutes > 1200) expect(s.nightMinutes ?? 0).toBeGreaterThan(0);
    }
  });
});

it("only cleans on closed Sundays; an explicit day off drops that day's shifts", () => {
  const employees = SAMPLE_EMPLOYEES.map((e) => ({ ...e }));
  const shifts = generateSchedule({
    year: 2026, month: 8, workHours: DEFAULT_WORK_HOURS, employees,
    overrides: { "2026-08-09": { date: "2026-08-09", closed: true } },
  });
  expect(shifts.filter((s) => s.date === "2026-08-09")).toEqual([]);
  // Alle Sonntagsreinigungen liegen an geschlossenen Sonntagen (Sonntag = getDay 0).
  for (const s of shifts.filter((s) => s.category === "SUNDAY")) {
    expect(weekdayKeyOf(parseIsoDate(s.date))).toBe("sunday");
  }
});

it("reports when a person's Sunday hours cannot be placed", () => {
  // Nur ein einziger (geschlossener) Sonntag ist im Bild, aber mayWorkOn schließt
  // ihn aus -> die Stunden können nirgends hin.
  const emp = { id: "e1", name: "Test", employmentType: "MINIJOB" as const,
    targetMinutes: 0, sundayMinutes: 5 * 60, availableWeekdays: ["monday"] as const };
  expect(() => generateSchedule({ year: 2026, month: 8, workHours: DEFAULT_WORK_HOURS,
    employees: [{ ...emp, availableWeekdays: [...emp.availableWeekdays] }] })).toThrow(/Chủ nhật/);
});
