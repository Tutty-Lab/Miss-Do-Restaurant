import type { Schedule } from "../types";
import { COMPANY_ADDRESS, COMPANY_NAME } from "./company";
import { DEFAULT_WORK_HOURS, normalizeWorkHours, type WorkHoursConfig } from "./workHours";
import { normalizeSurchargeConfig } from "./zuschlaege";

/** Aktuelles Modell: je Person eigener Monats-Topf für Abend + Sonntag. */
export const SURCHARGE_MODEL_VERSION = 3;

export function emptySchedule(): Schedule {
  const now = new Date();
  return {
    companyName: COMPANY_NAME,
    address: COMPANY_ADDRESS,
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    workHours: structuredClone(DEFAULT_WORK_HOURS),
    surchargeModelVersion: SURCHARGE_MODEL_VERSION,
    surchargeConfig: normalizeSurchargeConfig(),
    dateOverrides: [],
    employees: [],
    shifts: [],
  };
}

export function normalizeSchedule(raw?: Schedule): Schedule {
  const base = emptySchedule();
  if (!raw) return base;
  const year = raw.year ?? base.year;
  const month = raw.month ?? base.month;
  // Nur Schichten des ANGEZEIGTEN Monats behalten. Ältere Stände (Monat gewechselt
  // ohne neu zu erzeugen) hatten sonst Schichten fremder Monate im Speicher: das
  // Raster zeigte lauter „Nghỉ", die Summen zählten die alten Schichten aber mit.
  const ym = `${year}-${String(month).padStart(2, "0")}-`;
  const shifts = (Array.isArray(raw.shifts) ? raw.shifts : []).filter(
    (s) => typeof s.date === "string" && s.date.startsWith(ym),
  );
  return {
    ...raw,
    companyName: COMPANY_NAME,
    address: COMPANY_ADDRESS,
    year,
    month,
    workHours: normalizeWorkHours(raw.workHours),
    surchargeModelVersion: raw.surchargeModelVersion ?? 1,
    surchargeConfig: normalizeSurchargeConfig(raw.surchargeConfig),
    dateOverrides: Array.isArray(raw.dateOverrides) ? raw.dateOverrides : [],
    employees: raw.employees ?? [],
    shifts,
    printedWeeks: Array.isArray(raw.printedWeeks) ? raw.printedWeeks : [],
  };
}

/**
 * Fenster für die Erzeugung. Das FLOOR-Fenster Mo–Sa endet immer um 20:00 – die
 * Abendreinigung nach 20:00 wird separat aus nightMinutes erzeugt (planNightWork).
 * Ältere Stände wurden auf 9:30–22:00 „hochgezogen"; hier wird das wieder auf
 * 20:00 normalisiert, damit der abendliche Teil nicht doppelt entsteht.
 */
export function workHoursForGeneration(schedule: Schedule): WorkHoursConfig {
  const hours = structuredClone(schedule.workHours);
  for (const key of ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const) {
    const blocks = hours.perWeekday[key];
    if (blocks.length === 1 && blocks[0].startMinutes === 570 && blocks[0].endMinutes === 1320) {
      blocks[0].endMinutes = 1200;
    }
  }
  return hours;
}
