import type { Schedule } from "../types";
import { COMPANY_ADDRESS, COMPANY_NAME } from "./company";
import { DEFAULT_WORK_HOURS, normalizeWorkHours, type WorkHoursConfig } from "./workHours";
import { normalizeSurchargeConfig } from "./zuschlaege";

export const DEFAULT_SUNDAY_CLEANING_MINUTES = 120;

export function emptySchedule(): Schedule {
  const now = new Date();
  return {
    companyName: COMPANY_NAME,
    address: COMPANY_ADDRESS,
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    workHours: structuredClone(DEFAULT_WORK_HOURS),
    surchargeModelVersion: 2,
    surchargeConfig: normalizeSurchargeConfig(),
    sundayCleaningMinutes: DEFAULT_SUNDAY_CLEANING_MINUTES,
    dateOverrides: [],
    employees: [],
    shifts: [],
  };
}

export function normalizeSchedule(raw?: Schedule): Schedule {
  const base = emptySchedule();
  if (!raw) return base;
  return {
    ...raw,
    companyName: COMPANY_NAME,
    address: COMPANY_ADDRESS,
    year: raw.year ?? base.year,
    month: raw.month ?? base.month,
    workHours: normalizeWorkHours(raw.workHours),
    surchargeModelVersion: raw.surchargeModelVersion ?? 1,
    surchargeConfig: normalizeSurchargeConfig(raw.surchargeConfig),
    sundayCleaningMinutes: raw.sundayCleaningMinutes ?? DEFAULT_SUNDAY_CLEANING_MINUTES,
    dateOverrides: Array.isArray(raw.dateOverrides) ? raw.dateOverrides : [],
    employees: raw.employees ?? [],
    shifts: raw.shifts ?? [],
    printedWeeks: Array.isArray(raw.printedWeeks) ? raw.printedWeeks : [],
  };
}

/** Upgrade the former default window only when generating a new schedule. */
export function workHoursForGeneration(schedule: Schedule): WorkHoursConfig {
  const hours = structuredClone(schedule.workHours);
  if (schedule.surchargeModelVersion === 2) return hours;
  for (const key of ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const) {
    const blocks = hours.perWeekday[key];
    if (blocks.length === 1 && blocks[0].startMinutes === 570 && blocks[0].endMinutes === 1200) {
      blocks[0].endMinutes = 1320;
    }
  }
  return hours;
}
