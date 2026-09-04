// ============================================================================
// Verkaufsoffene Sonntage.
//
// Miss Do hat sonntags zu (workHours.closedWeekdays.sunday = true), öffnet aber
// bis zu ZWÖLF Sonntage im Jahr. So ein Sonntag ist kein eigenes Feld, sondern
// eine Ausnahme mit eigenen Zeiten: resolveDay öffnet damit einen Tag, den der
// Wochentag sonst schließt. Deshalb braucht es kein neues Schema und der
// Scheduler versteht die offenen Sonntage ohne Zusatzregel.
//
// Warum als eigenes Modul und nicht in der Oberfläche: das Kontingent (12/Jahr)
// und die Frage "ist dieser Sonntag offen?" sind Fachlogik. Scheduler, Tests
// und Oberfläche müssen sie gleich beantworten.
// ============================================================================

import { datesOfMonth, parseIsoDate, weekdayKeyOf } from "./demand";
import { frameOf, type DateOverride, type DayWindow, type WorkHoursConfig } from "./workHours";

/** Vorgabe des Betriebs: zwölf verkaufsoffene Sonntage im Jahr. */
export const OPEN_SUNDAYS_PER_YEAR = 12;

/** Notiz, die ein angehakter Sonntag in der Ausnahmen-Liste trägt. */
export const OPEN_SUNDAY_NOTE = "Chủ nhật mở cửa";

export function isSunday(isoDate: string): boolean {
  return weekdayKeyOf(parseIsoDate(isoDate)) === "sunday";
}

/** Alle Sonntage eines Monats, aufsteigend. */
export function sundaysOfMonth(year: number, month: number): string[] {
  return datesOfMonth(year, month).filter(isSunday);
}

/**
 * Ein verkaufsoffener Sonntag = Ausnahme auf einem Sonntag, die den Tag mit
 * eigenen Zeiten ÖFFNET. Erkannt wird das an der Form (closed = false plus
 * Fenster), nicht an der Notiz – die kann der Betrieb überschreiben.
 */
export function isOpenSundayOverride(ov: DateOverride): boolean {
  return !ov.closed && !!ov.window && isSunday(ov.date);
}

/** Die offenen Sonntage eines Jahres, aufsteigend. */
export function openSundaysOfYear(overrides: DateOverride[], year: number): string[] {
  const praefix = `${year}-`;
  return overrides
    .filter((ov) => ov.date.startsWith(praefix) && isOpenSundayOverride(ov))
    .map((ov) => ov.date)
    .sort();
}

/**
 * Zeiten, mit denen ein neu angehakter Sonntag geöffnet wird: der Rahmen der
 * Sonntags-Zeile aus den Arbeitszeiten (bei Miss Do 9:30–20:00).
 *
 * Der Samstag ist die Rückfalllinie: wer die Sonntags-Zeile leer geräumt hat,
 * soll keinen Sonntag mit 0-Fenster aufmachen – das wäre ein offener Tag, an
 * dem niemand arbeiten darf.
 */
export function sundayWindowOf(config: WorkHoursConfig): DayWindow {
  const rahmen = frameOf(config.perWeekday.sunday);
  if (rahmen.endMinutes > rahmen.startMinutes) return rahmen;
  return frameOf(config.perWeekday.saturday);
}

/** Die Ausnahme, die diesen Sonntag öffnet. */
export function openSundayOverride(iso: string, config: WorkHoursConfig): DateOverride {
  return { date: iso, closed: false, window: sundayWindowOf(config), note: OPEN_SUNDAY_NOTE };
}
