import { expect, it } from "vitest";
import { emptySchedule, normalizeSchedule, workHoursForGeneration } from "../scheduleDefaults";
import { validateSchedule } from "../validation";
import type { Schedule } from "../../types";

it("preserves legacy shifts, employee targets and print locks on load", () => {
  const old: Schedule = {
    ...emptySchedule(), surchargeModelVersion: undefined, surchargeConfig: undefined,
    lockedAt: "2026-09-01T12:00:00Z", printedWeeks: ["2026-08-03"],
    employees: [{ id: "e", name: "Legacy", employmentType: "TEILZEIT", targetMinutes: 480, nightMinutes: 120 }],
    shifts: [{ id: "s", employeeId: "e", date: "2026-08-07", startMinutes: 660, endMinutes: 1320,
      paidMinutes: 600, pauseMinutes: 60, nightMinutes: 120, generated: true, shiftType: "LATE" }],
  };
  // Alter Stand mit auf 22:00 hochgezogenem Fenster – die Erzeugung normalisiert es zurück.
  old.workHours.perWeekday.friday[0].endMinutes = 1320;
  const snapshot = JSON.stringify(old);
  const loaded = normalizeSchedule(old);
  expect(loaded.surchargeModelVersion).toBe(1);
  expect(loaded.shifts).toEqual(old.shifts);
  expect(loaded.employees).toEqual(old.employees);
  expect(loaded.lockedAt).toBe(old.lockedAt);
  expect(loaded.printedWeeks).toEqual(old.printedWeeks);
  expect(loaded.workHours.perWeekday.friday[0].endMinutes).toBe(1320);
  expect(validateSchedule(loaded.employees, loaded.shifts, false).errors).toEqual([]);
  expect(workHoursForGeneration(loaded).perWeekday.friday[0].endMinutes).toBe(1200);
  expect(JSON.stringify(old)).toBe(snapshot);
});

it("retains custom work hours and configured surcharge settings after reload", () => {
  const schedule = emptySchedule();
  schedule.surchargeConfig = { after20Percent: 25, sundayPercent: 50 };
  schedule.workHours.perWeekday.friday[0].endMinutes = 1260;
  const loaded = normalizeSchedule(JSON.parse(JSON.stringify(schedule)));
  expect(loaded.surchargeConfig).toEqual(schedule.surchargeConfig);
  // Ein eigenes Fenster (nicht das alte 22:00-Standardfenster) bleibt unangetastet.
  expect(workHoursForGeneration(loaded).perWeekday.friday[0].endMinutes).toBe(1260);
  loaded.surchargeModelVersion = 1;
  expect(workHoursForGeneration(loaded).perWeekday.friday[0].endMinutes).toBe(1260);
});
