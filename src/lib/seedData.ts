// ============================================================================
// Test-Belegschaften für drei Monate.
//
// Angaben des Betriebs (Glory Duck, Berlin):
//   - 7 Beschäftigte, Monats-Soll: 160, 160, 90, 40, 40, 40, 35 = 565 h
//   - Vollzeit arbeitet 8 Stunden am Tag
//   - Arbeitszeit 12:00-22:30 durchgehend, KEINE Mittagsschließung
//   - Pause 30-60 Minuten (Pause der Mitarbeiter, nicht des Ladens)
//   - Freitag und Samstag machen den doppelten Umsatz eines Montags und
//     brauchen mehr Leute
//   - kein fester Ruhetag genannt
//
// Zuordnung der Anstellungsart (vom Betrieb nicht ausdrücklich gesagt, aus den
// Stundenzahlen abgeleitet): 160 h ist Vollzeit, 90 h Teilzeit, alles um die
// 40 h im Monat liegt im Minijob-Bereich (rund 9 Stunden die Woche).
//
// Hinweis zum Datenmodell: Schedule hält immer GENAU EINEN Monat. Diese drei
// Monate existieren nebeneinander nur hier als Fixture.
// ============================================================================

import type { Employee, Schedule } from "../types";
import { COMPANY_ADDRESS, COMPANY_NAME } from "./company";
import { makeEmployee } from "./sampleData";
import { DEFAULT_WORK_HOURS } from "./workHours";

export type SeedMonth = {
  year: number;
  month: number; // 1-basiert
  label: string;
  employees: Employee[];
  /**
   * Wie viele Tage dürfen die Stoßzeit verfehlen? Normalfall 0.
   *
   * Bewusst hier sichtbar statt in der Prüfung versteckt: der Scheduler ist
   * eine Heuristik, keine vollständige Suche. Ein Wert > 0 heißt, dass die
   * Stundensumme rechnerisch reichen würde, der greedy Lauf die Verteilung
   * aber nicht findet - eine bekannte Schwäche, kein akzeptierter Zustand.
   */
  maxPeakGaps?: number;
};

/** Die volle Belegschaft laut Screenshot – inkl. Reinigungs-Töpfe. */
const VOLL: Employee[] = [
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

/** Juli 2026 – zwei Teilzeitkräfte im Urlaub, ihre Stunden fallen weg. */
const JULI: Employee[] = VOLL.filter((e) => e.id !== "ma-2" && e.id !== "ma-7");

/** August 2026 – eine Minijob-Kraft weniger. */
const AUGUST: Employee[] = VOLL.filter((e) => e.id !== "ma-14");

export const SEED_MONTHS: SeedMonth[] = [
  { year: 2026, month: 6, label: "Juni 2026", employees: VOLL.map((e) => ({ ...e })) },
  { year: 2026, month: 7, label: "Juli 2026", employees: JULI.map((e) => ({ ...e })) },
  { year: 2026, month: 8, label: "August 2026", employees: AUGUST.map((e) => ({ ...e })) },
];


/** Baut einen leeren Schedule (ohne Schichten) für einen Seed-Monat. */
export function scheduleForSeed(seed: SeedMonth): Schedule {
  return {
    companyName: COMPANY_NAME,
    address: COMPANY_ADDRESS,
    year: seed.year,
    month: seed.month,
    workHours: structuredClone(DEFAULT_WORK_HOURS),
    dateOverrides: [],
    employees: seed.employees.map((e) => ({ ...e })),
    shifts: [],
  };
}

/** Summe der Sollstunden eines Seed-Monats (für Kapazitäts-Checks). */
export function totalTargetHours(seed: SeedMonth): number {
  return seed.employees.reduce((sum, e) => sum + e.targetMinutes, 0) / 60;
}
