// ============================================================================
// Beispieldaten: die heutige Besetzung von VietHaus, Summe = 606 bezahlte Stunden.
// ============================================================================

import type { Employee, Schedule } from "../types";
import { DEFAULT_WORK_HOURS } from "./workHours";
import { COMPANY_ADDRESS, COMPANY_NAME } from "./company";

export function makeEmployee(
  id: string,
  name: string,
  employmentType: Employee["employmentType"],
  targetHours: number,
  /** Optional: zusätzliche Reinigungsstunden (Nacht/Sonntag), in Stunden. */
  extra: { nightHours?: number; sundayHours?: number } = {},
): Employee {
  return {
    id,
    name,
    employmentType,
    targetMinutes: targetHours * 60,
    ...(extra.nightHours ? { nightMinutes: extra.nightHours * 60 } : {}),
    ...(extra.sundayHours ? { sundayMinutes: extra.sundayHours * 60 } : {}),
  };
}

/**
 * Belegschaft laut Angabe des Betriebs (Miss Do), 14 Personen.
 *
 * Minijob-Sollstunden sind aus dem Monatslohn abgeleitet (z. B. 308 € =
 * 21,5 h) und auf ganze Stunden gerundet – der Plan besteht aus Diensten in
 * ganzen Stunden, und maßgeblich ist ohnehin der Euro-Betrag.
 *
 * nightHours = Nachtzuschlag (Reinigung 20:00–23:00), sundayHours =
 * Sonntagszuschlag (Reinigung sonntags). Beides sind eigene Töpfe neben dem
 * Monats-Soll.
 */
export const SAMPLE_EMPLOYEES: Employee[] = [
  makeEmployee("ma-1", "Nhân viên 1", "TEILZEIT", 79),
  makeEmployee("ma-2", "Nhân viên 2", "TEILZEIT", 68),
  makeEmployee("ma-3", "Nhân viên 3", "TEILZEIT", 50, { sundayHours: 20 }),
  makeEmployee("ma-4", "Nhân viên 4", "VOLLZEIT", 128),
  makeEmployee("ma-5", "Nhân viên 5", "TEILZEIT", 76, { sundayHours: 20 }),
  makeEmployee("ma-6", "Nhân viên 6", "TEILZEIT", 55, { sundayHours: 20 }),
  makeEmployee("ma-7", "Nhân viên 7", "TEILZEIT", 90),
  makeEmployee("ma-8", "Nhân viên 8", "MINIJOB", 22),
  makeEmployee("ma-9", "Nhân viên 9", "TEILZEIT", 115, { nightHours: 55, sundayHours: 20 }),
  makeEmployee("ma-10", "Nhân viên 10", "MINIJOB", 40),
  makeEmployee("ma-11", "Nhân viên 11", "VOLLZEIT", 120, { nightHours: 30, sundayHours: 31 }),
  makeEmployee("ma-12", "Nhân viên 12", "MINIJOB", 22),
  makeEmployee("ma-13", "Nhân viên 13", "MINIJOB", 22),
  makeEmployee("ma-14", "Nhân viên 14", "MINIJOB", 22),
];

export function createSampleSchedule(): Schedule {
  return {
    companyName: COMPANY_NAME,
    address: COMPANY_ADDRESS,
    year: 2026,
    month: 8, // August
    workHours: structuredClone(DEFAULT_WORK_HOURS),
    dateOverrides: [],
    employees: SAMPLE_EMPLOYEES.map((e) => ({ ...e })),
    shifts: [],
  };
}
