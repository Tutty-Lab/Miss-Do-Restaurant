// ============================================================================
// Reine Zeit-Hilfsfunktionen. Alles in Minuten seit Mitternacht (Integer).
// ============================================================================

import type { EmploymentType } from "../types";

/** "13:30" -> 810. Wirft bei ungültigem Format. */
export function timeToMinutes(time: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) {
    throw new Error(`Ungültiges Zeitformat: "${time}" (erwartet HH:mm)`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Ungültige Uhrzeit: "${time}"`);
  }
  return hours * 60 + minutes;
}

/** 810 -> "13:30". Immer zweistellig, 24h-Format. */
export function minutesToTime(totalMinutes: number): string {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Pausenregel (Miss Do). Angabe des Betriebs:
 *   - Stammkräfte (Voll-/Teilzeit) mit 7 oder 8 Stunden am Tag: 1 Stunde Pause.
 *   - Minijob: 30 Minuten.
 *
 * Daraus wird für Stammkräfte: ab 7 Stunden 60 Minuten, über 6 Stunden 30
 * Minuten, darunter keine. Für Minijob: 30 Minuten, sobald überhaupt eine
 * gesetzliche Pause fällig ist (über 6 Stunden) – Minijob-Dienste sind ohnehin
 * kurz. Beides liegt auf oder über der gesetzlichen Staffel (§ 4 ArbZG); mehr
 * Pause zu geben ist erlaubt, weniger nicht.
 *
 * Die Pause wird NICHT von der Arbeitszeit abgezogen, sondern verlängert die
 * Anwesenheit: presence = paid + pause.
 *
 * Ohne Anstellungsart gilt die Stammkraft-Regel (der längere Wert) – so
 * reserviert der Scheduler beim Einpassen im Zweifel eher zu viel Fensterzeit
 * als zu wenig. Der tatsächlich gespeicherte Pausenwert einer Schicht wird mit
 * der Anstellungsart der Person gerechnet (makeShift, Validierung, Anzeige).
 *
 * Einzige Stelle für Zeitrechnung dieser Art – alles andere leitet sich hier ab.
 */
export function calculatePause(paidMinutes: number, employmentType?: EmploymentType): number {
  if (employmentType === "MINIJOB") return paidMinutes > 6 * 60 ? 30 : 0;
  if (paidMinutes >= 7 * 60) return 60;
  if (paidMinutes > 6 * 60) return 30;
  return 0;
}

/**
 * Bezahlte Minuten aus Anwesenheit und Pause.
 * paidMinutes = presenceMinutes - pauseMinutes
 */
export function calculatePaidMinutes(
  startMinutes: number,
  endMinutes: number,
  pauseMinutes: number,
): number {
  return endMinutes - startMinutes - pauseMinutes;
}

/** Anwesenheit (inkl. Pause) aus bezahlter Zeit. */
export function presenceFromPaid(paidMinutes: number, employmentType?: EmploymentType): number {
  return paidMinutes + calculatePause(paidMinutes, employmentType);
}

/** Minuten -> Stunden als deutsche Dezimalzahl, z.B. 450 -> "7,50". */
export function minutesToDecimalHours(totalMinutes: number, fractionDigits = 2): string {
  const hours = totalMinutes / 60;
  return hours.toLocaleString("de-DE", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** Minuten -> kompakte Stundenangabe, z.B. 480 -> "8h", 450 -> "7,5h". */
export function minutesToShortHours(totalMinutes: number): string {
  const hours = totalMinutes / 60;
  const text = Number.isInteger(hours)
    ? String(hours)
    : hours.toLocaleString("de-DE", { maximumFractionDigits: 2 });
  return `${text}h`;
}
