// ============================================================================
// Wann darf eine Person überhaupt eingeplant werden?
//
// Alles steht hier an EINER Stelle, weil der Scheduler an mehreren Stellen
// Termine vergibt: beim ersten Verteilen, beim Verschieben, beim Tauschen und
// in den Reparaturläufen. Bei einer anderen Filiale standen Sonderregeln nur
// im ersten Schritt – die Läufe danach haben sie klaglos wieder kaputtgemacht.
// ============================================================================

import type { Employee } from "../types";
import { parseIsoDate, weekdayKeyOf } from "./demand";

/**
 * Arbeitet diese Person an diesem Wochentag überhaupt?
 *
 * Leere oder fehlende Liste heißt "keine Einschränkung".
 */
export function worksOnWeekday(employee: Employee, isoDate: string): boolean {
  const tage = employee.availableWeekdays;
  if (!tage || tage.length === 0) return true;
  return tage.includes(weekdayKeyOf(parseIsoDate(isoDate)));
}

/**
 * Die eine Frage, die jeder Planungsschritt stellen muss: darf diese Person an
 * diesem Datum arbeiten?
 */
export function mayWorkOn(employee: Employee, isoDate: string): boolean {
  return worksOnWeekday(employee, isoDate);
}
