import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { DEFAULT_WORK_HOURS } from "../workHours";
import { SAMPLE_EMPLOYEES } from "../sampleData";
import { minCoverageOver } from "../scheduler";
import { datesOfMonth, parseIsoDate, weekdayKeyOf } from "../demand";
import type { Shift } from "../../types";

const sundayCleaners = (month: number) =>
  generateSchedule({
    year: 2026,
    month,
    workHours: DEFAULT_WORK_HOURS,
    employees: SAMPLE_EMPLOYEES,
  }).filter((s) => s.category === "SUNDAY");

describe("owner-level scheduling safeguards", () => {
  it("checks consecutive work dates in legacy accounting mode", () => {
    const employee = {
      id: "legacy-owner",
      name: "Legacy",
      employmentType: "TEILZEIT" as const,
      targetMinutes: 21 * 60,
    };
    const shifts: Shift[] = Array.from({ length: 7 }, (_, i) => ({
      id: `legacy-${i}`,
      employeeId: employee.id,
      date: `2026-08-${String(i + 3).padStart(2, "0")}`,
      startMinutes: 570,
      endMinutes: 750,
      pauseMinutes: 0,
      paidMinutes: 180,
      shiftType: "EARLY" as const,
      generated: true,
    }));
    const result = validateSchedule([employee], shifts, false);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.message.includes("quá 6 ngày liên tiếp"))).toBe(true);
  });

  it("assigns Sunday cleaning only to people with a Sunday quota, on Sundays", () => {
    const cleaners = sundayCleaners(8);
    expect(cleaners.length).toBeGreaterThan(0);
    const withQuota = new Set(
      SAMPLE_EMPLOYEES.filter((e) => (e.sundayMinutes ?? 0) > 0).map((e) => e.id),
    );
    for (const s of cleaners) {
      expect(weekdayKeyOf(parseIsoDate(s.date))).toBe("sunday");
      expect(withQuota.has(s.employeeId)).toBe(true);
    }
  });

  it("keeps the evening peak (18–20) staffed with three on Saturdays", () => {
    const actualOrder = [
      "ma-1", "ma-2", "ma-5", "ma-6", "ma-7", "ma-9", "ma-10", "ma-15", "ma-11", "ma-14", "ma-16", "ma-17", "ma-19",
    ];
    const employees = actualOrder.map((id) => ({ ...SAMPLE_EMPLOYEES.find((e) => e.id === id)! }));
    // Nur Do/Fr/Sa möglich (So zu) => bei max 6-h-Schichten passt ein kleineres
    // Soll; hier geht es nur um die Samstagsbesetzung.
    employees[0].availableWeekdays = ["saturday", "sunday", "friday", "thursday"];
    employees[0].maxDaysPerWeek = 4;
    employees[0].targetMinutes = 60 * 60;
    const shifts = generateSchedule({
      year: 2026,
      month: 8,
      workHours: DEFAULT_WORK_HOURS,
      employees,
    });
    for (const date of datesOfMonth(2026, 8).filter(
      (d) => weekdayKeyOf(parseIsoDate(d)) === "saturday" && shifts.some((s) => s.date === d),
    )) {
      const day = shifts.filter((s) => s.date === date && s.category !== "SUNDAY");
      expect(minCoverageOver(day, 18 * 60, 20 * 60), date).toBeGreaterThanOrEqual(3);
    }
  });

  it("leaves a legal break slot on every generated shift that needs one", () => {
    const shifts = generateSchedule({
      year: 2026,
      month: 8,
      workHours: DEFAULT_WORK_HOURS,
      employees: SAMPLE_EMPLOYEES,
    });
    for (const date of datesOfMonth(2026, 8)) {
      const day = shifts.filter((s) => s.date === date && s.category !== "SUNDAY");
      for (const shift of day.filter((s) => s.pauseMinutes > 0)) {
        let possible = false;
        for (let start = shift.startMinutes + 180; start + shift.pauseMinutes <= shift.endMinutes - 180; start += 15) {
          const ok = minCoverageOver(
            day.filter((s) => s !== shift),
            start,
            start + shift.pauseMinutes,
          ) >= 1;
          if (ok) {
            possible = true;
            break;
          }
        }
        expect(possible, `${date}/${shift.employeeId}`).toBe(true);
      }
    }
  });
});
