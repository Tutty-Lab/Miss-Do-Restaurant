// ============================================================================
// Gesetzliche Feiertage in BERLIN – der Laden liegt in Berlin (10245).
// Bewegliche Feiertage werden über die Osterformel (Gauß/Computus) berechnet.
//
// Berlin hat als einziges Bundesland neben Mecklenburg-Vorpommern den
// Internationalen Frauentag (8.3.) als gesetzlichen Feiertag, seit 2019.
//
// KEINE Feiertage sind hier: Reformationstag (31.10., in den ostdeutschen
// Flächenländern und im Norden, aber nicht in Berlin), Fronleichnam und
// Allerheiligen (katholisch geprägte Länder), Buß- und Bettag (nur noch
// Sachsen), Ostersonntag/Pfingstsonntag (nur Brandenburg) und Heilige Drei
// Könige (Bayern, Baden-Württemberg, Sachsen-Anhalt).
//
// Einmalige Feiertage – etwa der 8. Mai 2025 zum 80. Jahrestag – stehen hier
// bewusst nicht: sie galten nur für ein Jahr. Für so etwas gibt es
// "Ngày đặc biệt" in den Einstellungen.
// ============================================================================
import { addDays, format } from "date-fns";

/** Ostersonntag eines Jahres (Gauß'sche Osterformel, gregorianisch). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = März, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function iso(date: Date): string {
  return format(date, "yyyy-MM-dd");
}


/** Datum -> Name aller gesetzlichen Feiertage in Berlin eines Jahres. */
export function publicHolidayNames(year: number): Map<string, string> {
  const easter = easterSunday(year);
  const map = new Map<string, string>();
  map.set(iso(new Date(year, 0, 1)), "Neujahr");
  // Nur Berlin: der Internationale Frauentag ist hier seit 2019 gesetzlicher
  // Feiertag. In keinem anderen Bundesland ausser Mecklenburg-Vorpommern.
  map.set(iso(new Date(year, 2, 8)), "Internationaler Frauentag");
  map.set(iso(addDays(easter, -2)), "Karfreitag");
  map.set(iso(addDays(easter, 1)), "Ostermontag");
  map.set(iso(new Date(year, 4, 1)), "Tag der Arbeit");
  map.set(iso(addDays(easter, 39)), "Christi Himmelfahrt");
  map.set(iso(addDays(easter, 50)), "Pfingstmontag");
  map.set(iso(new Date(year, 9, 3)), "Tag der Deutschen Einheit");
  map.set(iso(new Date(year, 11, 25)), "1. Weihnachtstag");
  map.set(iso(new Date(year, 11, 26)), "2. Weihnachtstag");
  return map;
}

/**
 * Alle gesetzlichen Feiertage in Berlin eines Jahres als ISO-Set
 * "yyyy-MM-dd". Leitet sich aus publicHolidayNames ab, damit Set und Namen
 * niemals auseinanderlaufen können.
 */
export function publicHolidays(year: number): Set<string> {
  return new Set(publicHolidayNames(year).keys());
}
