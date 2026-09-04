// ============================================================================
// Zentrale Datentypen. Intern wird IMMER in Minuten (Integer) gerechnet,
// niemals mit Fließkomma-Stunden.
// ============================================================================

import type { WeekdayKey } from "./lib/demand";
import type { DateOverride, WorkHoursConfig } from "./lib/workHours";

/**
 * Anstellungsart. MINIJOB ist arbeitsrechtlich eine Form der Teilzeit und wird
 * bei der Schichtplanung auch genauso behandelt – die Trennung dient der
 * Obergrenze und der Belegschaftsstruktur, nicht der Planung selbst.
 */
export type EmploymentType = "VOLLZEIT" | "TEILZEIT" | "MINIJOB";

/**
 * Für Kylan gibt es BEWUSST keine Zahlengrenzen bei der Belegschaft:
 * weder eine Obergrenze für die Anzahl der Beschäftigten noch eine eigene
 * Stundendecke für Minijobs.
 *
 * Andere Filialen haben so etwas, weil der Betrieb es ausdrücklich gesagt hat
 * ("höchstens 3 Stammkräfte und 5 Minijobs"). Hier wurde nur die heutige
 * Besetzung genannt. Die vertraglichen 43 h einer Minijob-Kraft stehen ohnehin
 * als deren Monats-Soll in der Mitarbeiterliste – eine zusätzliche Prüfung
 * dagegen wäre doppelt gemoppelt und würde beim Einstellen einer weiteren
 * Kraft grundlos meckern.
 *
 * MINIJOB bleibt als Anstellungsart erhalten: sie steht auf dem Stundenzettel
 * und in der Lohnabrechnung, nur eben ohne eigene Grenze.
 */

export type ShiftType = "EARLY" | "LATE" | "CUSTOM";

/** Lohn-relevante Art eines Dienstes. Fehlt = FLOOR (normaler Ladendienst). */
export type ShiftCategory = "FLOOR" | "NIGHT" | "SUNDAY";

export type Employee = {
  id: string;
  name: string;
  employmentType: EmploymentType;
  /** Monatliches Soll in Minuten (Integer). 176 h => 10560. */
  targetMinutes: number;
  /**
   * Wochentage, an denen diese Person überhaupt eingeplant werden darf.
   *
   * Fehlt das Feld oder ist es leer, gilt: jeder Tag ist möglich. Damit deckt
   * EIN Feld beide Wünsche ab – "die Aushilfe kommt fest Freitag und Sonntag"
   * (nur diese beiden ankreuzen) und "die Vollzeitkraft hat montags frei"
   * (Montag abwählen).
   *
   * Eine leere Liste als "arbeitet nie" zu lesen wäre die gefährlichere
   * Auslegung: wer noch kein Häkchen gesetzt hat, wäre plötzlich unplanbar.
   */
  availableWeekdays?: WeekdayKey[];
  /**
   * Höchstzahl der Arbeitstage je Woche.
   *
   * Etwas anderes als availableWeekdays: dort steht, WELCHE Tage in Frage
   * kommen, hier, WIE VIELE davon genutzt werden dürfen. Wer sieben mögliche
   * Tage hat, aber nur fünf arbeitet, braucht diese Zahl.
   *
   * Fehlt das Feld, begrenzt nur die Sechs-Tage-Regel des Gesetzes.
   */
  maxDaysPerWeek?: number;
  /**
   * Zusätzliche Reinigungsstunden am Abend nach Ladenschluss (Nachtzuschlag),
   * 20:00–23:00. Monats-Soll in Minuten. Fehlt/0 = diese Person reinigt abends
   * nicht.
   *
   * Das ist NICHT Teil von targetMinutes: die Ladenstunden (9:30–20:00) und die
   * Reinigung nach Schluss sind zwei getrennte Töpfe, damit der Nachtzuschlag
   * für die Lohnabrechnung sichtbar bleibt.
   */
  nightMinutes?: number;
  /**
   * Zusätzliche Reinigungsstunden am Sonntag (Sonntagszuschlag). Monats-Soll in
   * Minuten. Fehlt/0 = diese Person reinigt sonntags nicht.
   *
   * Der Laden ist sonntags normalerweise zu; die Sonntagsreinigung läuft
   * trotzdem und ist ein eigener Topf, getrennt von targetMinutes.
   */
  sundayMinutes?: number;
};

export type Shift = {
  id: string;
  employeeId: string;
  /** ISO-Datum "yyyy-MM-dd". */
  date: string;
  startMinutes: number;
  endMinutes: number;
  pauseMinutes: number;
  /** Bezahlte Arbeitszeit in Minuten = presence - pause. */
  paidMinutes: number;
  shiftType: ShiftType;
  /**
   * Art des Dienstes für die Lohnabrechnung:
   *   FLOOR   – normaler Ladendienst 9:30–20:00 (Standard, auch wenn das Feld fehlt).
   *   NIGHT   – Reinigung nach Schluss 20:00–23:00 (Nachtzuschlag).
   *   SUNDAY  – Reinigung am Sonntag (Sonntagszuschlag).
   * Nur NIGHT/SUNDAY zählen gegen nightMinutes/sundayMinutes, nicht gegen das
   * normale Monats-Soll.
   */
  category?: ShiftCategory;
  /** true = automatisch generiert, false = manuell hinzugefügt/geändert. */
  generated: boolean;
};

export type Schedule = {
  companyName: string;
  /** Anschrift des Betriebs (erscheint auf dem Stundenzettel). */
  address: string;
  year: number;
  /** 1-basiert: 1 = Januar ... 12 = Dezember. */
  month: number;
  /** Arbeitszeit-Fenster (giờ làm) je Wochentag + Feiertag. */
  workHours: WorkHoursConfig;
  /** Ausnahmen für einzelne Daten (geschlossen / abweichende Zeiten). */
  dateOverrides: DateOverride[];
  employees: Employee[];
  shifts: Shift[];
  /**
   * Zeitpunkt der ersten Wochen-Ausgabe (ISO). Gesetzt = der Monat ist
   * gesperrt und darf nicht mehr geändert werden.
   *
   * Hintergrund: sobald eine Woche ausgedruckt im Laden hängt, muss der Stand
   * im System exakt dem Papier entsprechen – bei einer Kontrolle wird genau
   * das verglichen. Entsperren geht nur bewusst über die Oberfläche.
   */
  lockedAt?: string;
  /** Bereits gedruckte Wochen, als ISO-Datum des jeweiligen Montags. */
  printedWeeks?: string[];
};

/** Ein einzelnes zu verplanendes Schicht-Token (Ergebnis von splitTargetHours). */
export type ShiftToken = {
  employeeId: string;
  paidMinutes: number;
};

