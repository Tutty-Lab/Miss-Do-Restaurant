// ============================================================================
// Kundennachfrage-Konzept: Tagesgewichte + gewünschte Spätschicht-Anteile.
// ============================================================================

import { eachDayOfInterval, endOfMonth, format, getDay, startOfMonth } from "date-fns";

export type WeekdayKey =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

/** Die Wochentage in der Reihenfolge, in der sie angezeigt werden. */
export const WEEKDAY_ORDER: readonly WeekdayKey[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

/**
 * Nachfrage-Gewichte je Wochentag.
 *
 * Angabe des Betriebs: "tiệm đông nhất thứ 7" und "Umsatz thứ 7 cao hơn 40%
 * ngày thường nghĩa là gần gấp đôi". Die beiden Zahlen widersprechen sich
 * (40 % mehr wäre 1,4×, "fast doppelt" eher 1,8×); maßgeblich ist die klare
 * Aussage "fast doppelt", also steht der Samstag auf 1,8. Alle anderen
 * Wochentage sind gleich (der Betrieb hat nur den Samstag hervorgehoben).
 *
 * Der Sonntag ist normal geschlossen; sein Gewicht greift nur an den zwölf
 * verkaufsoffenen Sonntagen im Jahr. Ist das falsch, ist das hier die einzige
 * Zeile, die sich ändert.
 */
export const DAY_WEIGHTS: Record<WeekdayKey, number> = {
  monday: 1.0,
  tuesday: 1.0,
  wednesday: 1.0,
  thursday: 1.0,
  friday: 1.0,
  saturday: 1.8,
  sunday: 1.2,
};

/**
 * Gewünschter Anteil an Spätschicht-Stunden je Wochentag.
 *
 * Miss Do ist ein TAG-Geschäft (9:30–20:00) mit zwei Spitzen: mittags 11–14
 * und nachmittags 16–19. Beide Enden sind ungefähr gleich stark, deshalb 0,5
 * – halb Frühdienste (Öffnen + Mittagsspitze), halb Spätdienste
 * (Nachmittagsspitze + Schließen). Kein Abendgeschäft wie bei den Restaurants.
 */
export const LATE_SHIFT_RATIOS: Record<WeekdayKey, number> = {
  monday: 0.5,
  tuesday: 0.5,
  wednesday: 0.5,
  thursday: 0.5,
  friday: 0.5,
  saturday: 0.5,
  sunday: 0.5,
};

/** date-fns getDay(): 0=So ... 6=Sa  ->  WeekdayKey. */
const WEEKDAY_BY_GETDAY: Record<number, WeekdayKey> = {
  0: "sunday",
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
  6: "saturday",
};

export const WEEKDAY_LABELS_DE: Record<WeekdayKey, string> = {
  monday: "Montag",
  tuesday: "Dienstag",
  wednesday: "Mittwoch",
  thursday: "Donnerstag",
  friday: "Freitag",
  saturday: "Samstag",
  sunday: "Sonntag",
};

export const WEEKDAY_SHORT_DE: Record<WeekdayKey, string> = {
  monday: "Mo",
  tuesday: "Di",
  wednesday: "Mi",
  thursday: "Do",
  friday: "Fr",
  saturday: "Sa",
  sunday: "So",
};

// Vietnamesische Wochentage – für die App-Oberfläche.
export const WEEKDAY_LABELS_VI: Record<WeekdayKey, string> = {
  monday: "Thứ Hai",
  tuesday: "Thứ Ba",
  wednesday: "Thứ Tư",
  thursday: "Thứ Năm",
  friday: "Thứ Sáu",
  saturday: "Thứ Bảy",
  sunday: "Chủ Nhật",
};

export const WEEKDAY_SHORT_VI: Record<WeekdayKey, string> = {
  monday: "T2",
  tuesday: "T3",
  wednesday: "T4",
  thursday: "T5",
  friday: "T6",
  saturday: "T7",
  sunday: "CN",
};

export function weekdayKeyOf(date: Date): WeekdayKey {
  return WEEKDAY_BY_GETDAY[getDay(date)];
}

/** Alle Kalendertage eines Monats als ISO-Strings "yyyy-MM-dd". month ist 1-basiert. */
export function datesOfMonth(year: number, month: number): string[] {
  const first = startOfMonth(new Date(year, month - 1, 1));
  const last = endOfMonth(first);
  return eachDayOfInterval({ start: first, end: last }).map((d) => format(d, "yyyy-MM-dd"));
}

export function dayWeightOf(isoDate: string): number {
  return DAY_WEIGHTS[weekdayKeyOf(parseIsoDate(isoDate))];
}

export function lateRatioOf(isoDate: string): number {
  return LATE_SHIFT_RATIOS[weekdayKeyOf(parseIsoDate(isoDate))];
}

/** ISO "yyyy-MM-dd" -> lokales Date (ohne Zeitzonen-Verschiebung). */
export function parseIsoDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d);
}
