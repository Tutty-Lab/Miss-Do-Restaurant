import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { DEFAULT_WORK_HOURS, resolveDay } from "../workHours";
import { SAMPLE_EMPLOYEES } from "../sampleData";
import { datesOfMonth, parseIsoDate, weekdayKeyOf } from "../demand";
import { publicHolidays } from "../holidays";
import { calculateZuschlaege, normalizeSurchargeConfig, timesheetParts } from "../zuschlaege";
import type { Employee, Shift } from "../../types";

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

describe.each([8, 9, 10])("Cleaning included in monthly targets, month %i", (month) => {
  const employees: Employee[] = SAMPLE_EMPLOYEES.map((e, i) => ({ ...e,
    ...(i === 0 ? { availableWeekdays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as Employee["availableWeekdays"] } : {}),
    ...(i === 1 ? { maxDaysPerWeek: 3 } : {}),
  }));
  const input = { year: 2026, month, workHours: DEFAULT_WORK_HOURS, employees, sundayCleaningMinutes: 120 };
  const shifts = generateSchedule(input);

  it("meets each target, pause rule, weekday/week limit and six-day rule", () => {
    expect(validateSchedule(employees, shifts).errors).toEqual([]);
    expect(shifts.every((s) => s.nightMinutes === undefined)).toBe(true);
    expect(generateSchedule(input)).toEqual(shifts);
  });

  it("assigns one closer per open day and one rotating cleaner per closed Sunday", () => {
    const holidays = publicHolidays(2026);
    for (const date of datesOfMonth(2026, month)) {
      const day = resolveDay(DEFAULT_WORK_HOURS, date, holidays);
      const onDay = shifts.filter((s) => s.date === date);
      if (!day.closed) {
        const night = onDay.filter((s) => s.endMinutes > 1200);
        expect(night, date).toHaveLength(1);
        expect(night[0].endMinutes).toBe(1320);
        expect(night[0].startMinutes).toBeLessThan(1200);
      } else if (weekdayKeyOf(parseIsoDate(date)) === "sunday") {
        expect(onDay, date).toHaveLength(1);
        expect(onDay[0]).toMatchObject({ category: "SUNDAY", paidMinutes: 120, startMinutes: 600 });
        expect(onDay[0].employeeId).not.toBe(employees[0].id);
      } else expect(onDay).toEqual([]);
    }
    const cleaners = shifts.filter((s) => s.category === "SUNDAY");
    expect(new Set(cleaners.map((s) => s.employeeId)).size).toBe(cleaners.length);
  });
});

it("respects explicit days off and permits disabling Sunday cleaning", () => {
  const input = { year: 2026, month: 8, workHours: DEFAULT_WORK_HOURS, employees: SAMPLE_EMPLOYEES };
  expect(generateSchedule({ ...input, sundayCleaningMinutes: 0 }).every((s) => s.category !== "SUNDAY")).toBe(true);
  const shifts = generateSchedule({ ...input, sundayCleaningMinutes: 120,
    overrides: { "2026-08-09": { date: "2026-08-09", closed: true } } });
  expect(shifts.filter((s) => s.date === "2026-08-09")).toEqual([]);
  expect(shifts.filter((s) => s.category === "SUNDAY")).toHaveLength(4);
});

it("reports impossible/invalid Sunday cleaning instead of silently dropping it", () => {
  const input = { year: 2026, month: 8, workHours: DEFAULT_WORK_HOURS, employees: [] };
  expect(() => generateSchedule({ ...input, sundayCleaningMinutes: 120 })).toThrow(/Chủ nhật/);
  for (const value of [-60, 90, 540, NaN, Infinity]) {
    expect(() => generateSchedule({ ...input, sundayCleaningMinutes: value })).toThrow(/0 đến 8/);
  }
});
