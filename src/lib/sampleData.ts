// ============================================================================
// Beispieldaten: Belegschaft von Miss Do.
// ============================================================================

import type { Employee, Schedule } from "../types";
import { DEFAULT_WORK_HOURS } from "./workHours";
import { COMPANY_ADDRESS, COMPANY_NAME } from "./company";

export function makeEmployee(
  id: string,
  name: string,
  employmentType: Employee["employmentType"],
  targetHours: number,
  /** Optional: Pers.-Nr. + monatliche Sonntags-/Abendstunden (zusätzlich zum Soll). */
  extra: { persNr?: string; sundayHours?: number; nightHours?: number } = {},
): Employee {
  return {
    id,
    name,
    ...(extra.persNr ? { persNr: extra.persNr } : {}),
    employmentType,
    targetMinutes: targetHours * 60,
    ...(extra.sundayHours ? { sundayMinutes: extra.sundayHours * 60 } : {}),
    ...(extra.nightHours ? { nightMinutes: extra.nightHours * 60 } : {}),
  };
}

/**
 * Belegschaft laut Angabe des Betriebs (Miss Do), 13 Personen mit
 * Personalnummer (Pers.-Nr.).
 *
 * Minijob-Sollstunden sind aus dem Monatslohn abgeleitet (z. B. 21,5 h) und
 * meist auf ganze Stunden gerundet – maßgeblich ist ohnehin der Euro-Betrag.
 *
 */
export const SAMPLE_EMPLOYEES: Employee[] = [
  makeEmployee("ma-1", "Văn Diện Nguyen", "TEILZEIT", 90, { persNr: "1" }),
  makeEmployee("ma-2", "Anh Cong Le", "TEILZEIT", 55, { persNr: "2", sundayHours: 12 }),
  makeEmployee("ma-5", "Xuan Huan Hoang", "TEILZEIT", 76, { persNr: "5", sundayHours: 12 }),
  makeEmployee("ma-6", "Quoc Thai Pham", "VOLLZEIT", 128, { persNr: "6" }),
  makeEmployee("ma-7", "Thi Vo", "TEILZEIT", 50, { persNr: "7", sundayHours: 12 }),
  // Abendstunden (nightHours) sind bewusst moderat: die Abendreinigung endet
  // spätestens 23:00 (max 3h nach 20:00), verteilt auf ein paar Abende. Sehr hohe
  // Monatswerte lassen sich so nicht als „nach 20 Uhr" abbilden – hier als
  // Beispiel gerundet; die echten Werte trägt der Betrieb je Person in der App ein.
  makeEmployee("ma-9", "Thi Hien Nguyen", "TEILZEIT", 115, { sundayHours: 12, nightHours: 12 }),
  makeEmployee("ma-10", "Thi Hong Anh Le", "MINIJOB", 40, { persNr: "10" }),
  makeEmployee("ma-11", "Duc Binh Nguyen", "TEILZEIT", 68, { persNr: "11" }),
  makeEmployee("ma-14", "Van Dong Vu", "TEILZEIT", 79, { persNr: "14" }),
  makeEmployee("ma-15", "Nguyen Duy Toan", "VOLLZEIT", 120, { persNr: "15", sundayHours: 12, nightHours: 12 }),
  // Vertraglich 21,5 h; der Plan rechnet in ganzen Stunden (Minijob ist ohnehin
  // euro-basiert), deshalb hier auf 22 h gerundet.
  makeEmployee("ma-16", "Van Suu Pham", "MINIJOB", 22, { persNr: "16" }),
  makeEmployee("ma-17", "Van Linh Nguyen", "MINIJOB", 22, { persNr: "17" }),
  makeEmployee("ma-19", "Dieu Linh Vu", "MINIJOB", 22, { persNr: "19" }),
  makeEmployee("ma-20", "Phạm Minh Trí", "MINIJOB", 22, { persNr: "20" }),
];

export function createSampleSchedule(): Schedule {
  return {
    companyName: COMPANY_NAME,
    address: COMPANY_ADDRESS,
    year: 2026,
    month: 8, // August
    workHours: structuredClone(DEFAULT_WORK_HOURS),
    surchargeModelVersion: 3,
    surchargeConfig: { after20Percent: 0, sundayPercent: 0 },
    dateOverrides: [],
    employees: SAMPLE_EMPLOYEES.map((e) => ({ ...e })),
    shifts: [],
  };
}
