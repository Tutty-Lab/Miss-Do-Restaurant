// ============================================================================
// Datenmodell für den Stundenzettel, das die Vektor-PDF (pdf.ts) zeichnet. Die
// Bildschirm-Vorschau bettet dieselbe PDF ein – Vorschau und Ausdruck sind damit
// Zeichen für Zeichen identisch (Checklist: „Gesamtstunden = Summe der
// Stundenspalte = stimmt überein").
// ============================================================================

import type { Employee, Schedule, Shift } from "../types";
import {
  datesOfMonth,
  parseIsoDate,
  WEEKDAY_LABELS_DE,
  weekdayKeyOf,
} from "./demand";
import { minutesToDecimalHours, minutesToTime } from "./time";
import { MONTH_NAMES_DE } from "./dateFormat";
import { publicHolidayNames } from "./holidays";
import { format } from "date-fns";
import { zuschlagTotals, timesheetParts, shiftMinutesAfter20 } from "./zuschlaege";
import { employmentLabelDe } from "./employment";

/** Eine gedruckte Zeile innerhalb eines Arbeitstags (bei Split-Schicht mehrere). */
export type TimesheetLine = {
  start: string; // "10:00"
  end: string; // "17:00"
  pause: string; // "30 Min"
  paid: string; // "6,50" (deutsches Komma)
  bemerkung: string; // "Nachtzuschlag · Feiertag: …" oder ""
};

/** Eine Tageszeile der Tabelle. */
export type TimesheetRow = {
  date: string; // "22.09.2026"
  weekday: string; // "Montag"
  /** Wochenende / Feiertag / geschlossen -> Zeile grau hinterlegt. */
  shaded: boolean;
  /** Gearbeitete Teile (0..n). Leer => freier/geschlossener Tag. */
  lines: TimesheetLine[];
  /** Bei leeren Tagen der Bemerkungstext ("Frei", "Feiertag: …", Betriebsruhe). */
  rest: string;
};

/** Kopf-Infofeld; `blank` => von Hand auszufüllen (kein Wert). */
export type InfoField = { label: string; value: string; blank?: boolean };

/** Vollständige, druckfertige Daten eines Stundenzettels für eine Person. */
export type Timesheet = {
  companyName: string;
  address: string;
  employeeName: string;
  periodLabel: string; // oben rechts ("September 2026" oder Wochentitel)
  info: InfoField[];
  rows: TimesheetRow[];
  totalMinutes: number;
  totalText: string; // "128,50"
  nightHoursText: string; // Nachtzuschlag-Stunden
  sundayHoursText: string; // Sonntagszuschlag-Stunden
  /** Anzahl Abende mit Nachtzuschlag (Tage mit Arbeit nach 20:00, Mo–Sa). */
  nightSessions: number;
  /** Anzahl gearbeiteter Sonntage. */
  sundaySessions: number;
  /** Summe aller gedruckten Zeilen (Tage + zusätzliche Split-Zeilen) – für die
   * PDF-Schriftgröße, damit jede Person auf genau eine A4-Seite passt. */
  lineCount: number;
};

function monthLabelDe(year: number, month: number): string {
  return `${MONTH_NAMES_DE[month - 1]} ${year}`;
}

/**
 * Baut die druckfertigen Stundenzettel-Daten. `dates` fehlend => ganzer Monat,
 * sonst nur diese Tage (Wochen-Stundenzettel). Reine Funktion ohne DOM/PDF –
 * dadurch testbar und für Vorschau wie PDF identisch.
 */
export function buildTimesheet(
  schedule: Schedule,
  employee: Employee,
  dates?: string[],
  periodLabel?: string,
): Timesheet {
  const days = dates ?? datesOfMonth(schedule.year, schedule.month);

  const byDate = new Map<string, Shift[]>();
  for (const s of schedule.shifts) {
    if (s.employeeId === employee.id) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  }

  const shownShifts = days.flatMap((d) => byDate.get(d) ?? []);
  const totalMinutes = shownShifts.reduce((sum, s) => sum + s.paidMinutes, 0);
  const surcharges = zuschlagTotals(shownShifts);
  // Anzahl der Zuschlags-Termine je Person (Betrieb rechnet Zuschläge mit):
  // Abende mit Arbeit nach 20:00 (Mo–Sa) und gearbeitete Sonntage.
  const nightSessions = shownShifts.filter((s) => shiftMinutesAfter20(s) > 0).length;
  const sundaySessions = shownShifts.filter(
    (s) => weekdayKeyOf(parseIsoDate(s.date)) === "sunday",
  ).length;
  const holidayNames = publicHolidayNames(schedule.year);
  const closedByDate = new Map(
    schedule.dateOverrides.filter((o) => o.closed).map((o) => [o.date, o] as const),
  );

  let lineCount = 0;
  const rows: TimesheetRow[] = days.map((d) => {
    const shifts = (byDate.get(d) ?? []).slice().sort((a, b) => a.startMinutes - b.startMinutes);
    const parts = shifts.flatMap(timesheetParts);
    const weekday = WEEKDAY_LABELS_DE[weekdayKeyOf(parseIsoDate(d))];
    const holiday = holidayNames.get(d);
    const closed = closedByDate.get(d);
    const isWeekend = weekday === "Samstag" || weekday === "Sonntag";

    // Tages-Bemerkung wie in der bisherigen Vorschau.
    let rest: string;
    if (parts.length > 0) {
      rest = holiday ? `Feiertag: ${holiday}` : "";
    } else if (closed) {
      rest = closed.note || "Betriebsruhe";
    } else if (holiday) {
      rest = `Frei (Feiertag: ${holiday})`;
    } else {
      rest = "Frei";
    }

    const lines: TimesheetLine[] = parts.map((p) => ({
      start: minutesToTime(p.startMinutes),
      end: minutesToTime(p.endMinutes),
      pause: `${p.pauseMinutes} Min`,
      paid: minutesToDecimalHours(p.paidMinutes),
      bemerkung: [p.label, rest].filter(Boolean).join(" · "),
    }));

    // Freie Tage belegen eine Zeile; gearbeitete Tage je Teil eine.
    lineCount += Math.max(1, lines.length);

    return {
      date: format(parseIsoDate(d), "dd.MM.yyyy"),
      weekday,
      shaded: Boolean(isWeekend || holiday || closed),
      lines,
      rest,
    };
  });

  return {
    companyName: schedule.companyName || "—",
    address: schedule.address || "",
    employeeName: employee.name,
    periodLabel: periodLabel ?? monthLabelDe(schedule.year, schedule.month),
    info: [
      { label: "Firmenname", value: schedule.companyName || "—" },
      { label: "Beschäftigungsart", value: employmentLabelDe(employee.employmentType) },
      { label: "Mitarbeiter", value: employee.name },
      { label: "Personalnummer", value: employee.persNr || "—" },
      { label: "Monat", value: MONTH_NAMES_DE[schedule.month - 1] },
      // Sollstunden bleibt LEER: der Betrieb trägt den Wert von Hand ein.
      { label: "Sollstunden", value: "", blank: true },
      { label: "Jahr", value: String(schedule.year) },
    ],
    rows,
    totalMinutes,
    totalText: minutesToDecimalHours(totalMinutes),
    nightHoursText: minutesToDecimalHours(surcharges.after20Minutes),
    sundayHoursText: minutesToDecimalHours(surcharges.sundayMinutes),
    nightSessions,
    sundaySessions,
    lineCount,
  };
}
