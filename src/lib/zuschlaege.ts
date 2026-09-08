// ============================================================================
// Zuschläge (tiền làm thêm) — wie thienlong: aus den geplanten Zeiten berechnet,
// nicht mehr als eigene „Reinigungs"-Töpfe je Person.
//   - Nachtzuschlag: bezahlte Minuten nach 20:00, Montag–Samstag.
//   - Sonntagszuschlag: am Sonntag gearbeitete Minuten (Sonntagsreinigung).
// Nacht und Sonntag schließen sich aus (Sonntag zählt nicht doppelt).
// ============================================================================

import type { Shift, SurchargeConfig } from "../types";
import { parseIsoDate, weekdayKeyOf } from "./demand";

const AFTER_20 = 20 * 60;

export const DEFAULT_SURCHARGE_CONFIG: SurchargeConfig = {
  after20Percent: 0,
  sundayPercent: 0,
};

function validPercent(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

export function normalizeSurchargeConfig(
  config?: Partial<SurchargeConfig>,
): SurchargeConfig {
  return {
    after20Percent: validPercent(config?.after20Percent),
    sundayPercent: validPercent(config?.sundayPercent),
  };
}

function isSunday(date: string): boolean {
  return weekdayKeyOf(parseIsoDate(date)) === "sunday";
}

/**
 * Bezahlte Nacht-Minuten nach 20:00, Montag–Samstag. Der Sonntag läuft über den
 * eigenen Sonntagszuschlag und darf hier nicht doppelt zählen. Ein Dienst hat
 * nur eine Zeitspanne (kein Split), die Pause liegt vor 20:00 – deshalb wird das
 * Ergebnis durch die bezahlte Zeit gedeckelt.
 */
export function shiftMinutesAfter20(shift: Shift): number {
  if (isSunday(shift.date)) return 0;
  const after20 = Math.max(0, shift.endMinutes - Math.max(AFTER_20, shift.startMinutes));
  return Math.max(0, Math.min(shift.paidMinutes, after20));
}

export type TimesheetPart = {
  startMinutes: number;
  endMinutes: number;
  paidMinutes: number;
  pauseMinutes: number;
  label: string;
};

/** Keep one continuous shift; split only its printed representation at 20:00. */
export function timesheetParts(shift: Shift): TimesheetPart[] {
  if (isSunday(shift.date)) {
    return [{ ...shift, label: shift.category === "SUNDAY" ? "Sonntag (Reinigung)" : "Sonntagszuschlag" }];
  }
  if (shift.endMinutes <= AFTER_20) return [{ ...shift, label: "" }];
  if (shift.startMinutes >= AFTER_20) return [{ ...shift, label: "Nachtzuschlag" }];
  const after20 = shiftMinutesAfter20(shift);
  const before20 = shift.paidMinutes - after20;
  return [
    { startMinutes: shift.startMinutes, endMinutes: AFTER_20, paidMinutes: before20,
      pauseMinutes: AFTER_20 - shift.startMinutes - before20, label: "Arbeitszeit" },
    { startMinutes: AFTER_20, endMinutes: shift.endMinutes, paidMinutes: after20,
      pauseMinutes: shift.endMinutes - AFTER_20 - after20, label: "Nachtzuschlag" },
  ];
}

export type ZuschlagTotals = {
  after20Minutes: number;
  sundayMinutes: number;
};

export function zuschlagTotals(shifts: readonly Shift[]): ZuschlagTotals {
  return shifts.reduce<ZuschlagTotals>(
    (totals, shift) => ({
      after20Minutes: totals.after20Minutes + shiftMinutesAfter20(shift),
      sundayMinutes: totals.sundayMinutes + (isSunday(shift.date) ? shift.paidMinutes : 0),
    }),
    { after20Minutes: 0, sundayMinutes: 0 },
  );
}

export type ZuschlagCalculation = ZuschlagTotals &
  SurchargeConfig & {
    after20BonusMinutes: number;
    sundayBonusMinutes: number;
    totalBonusMinutes: number;
  };

/**
 * Rechnet die Prozent-Zuschläge in Bonus-Minuten um. Sonntag und Nacht sind
 * getrennt; jedes Ergebnis wird auf ganze Minuten gerundet.
 */
export function calculateZuschlaege(
  shifts: readonly Shift[],
  config?: Partial<SurchargeConfig>,
): ZuschlagCalculation {
  const totals = zuschlagTotals(shifts);
  const normalized = normalizeSurchargeConfig(config);
  const after20BonusMinutes = Math.round(
    (totals.after20Minutes * normalized.after20Percent) / 100,
  );
  const sundayBonusMinutes = Math.round(
    (totals.sundayMinutes * normalized.sundayPercent) / 100,
  );

  return {
    ...totals,
    ...normalized,
    after20BonusMinutes,
    sundayBonusMinutes,
    totalBonusMinutes: after20BonusMinutes + sundayBonusMinutes,
  };
}
