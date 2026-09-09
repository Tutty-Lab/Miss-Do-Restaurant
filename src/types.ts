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

/**
 * Lohn-relevante Art eines Dienstes. Fehlt = FLOOR (normaler Ladendienst).
 *
 * Der Abendteil (nach 20:00) ist KEINE eigene Kategorie: der schließende Dienst
 * läuft einfach bis 22:00 durch; die Minuten nach 20:00 sind Nachtzuschlag und
 * werden aus den Zeiten berechnet (lib/zuschlaege). Nur die SONNTAGsreinigung
 * ist ein eigener Dienst, weil der Laden sonntags zu ist.
 */
export type ShiftCategory = "FLOOR" | "SUNDAY";

/**
 * Zuschläge in Prozent (wie thienlong). Die Zuschläge werden AUS den geplanten
 * Zeiten berechnet, nicht mehr als eigene „Reinigungs"-Töpfe je Person geführt:
 *  - after20Percent: Aufschlag auf Minuten nach 20:00 (Mo–Sa).
 *  - sundayPercent:  Aufschlag auf am Sonntag gearbeitete Minuten.
 */
export type SurchargeConfig = {
  after20Percent: number;
  sundayPercent: number;
};

export type Employee = {
  id: string;
  name: string;
  /**
   * Personalnummer (Pers.-Nr.) laut Lohnbuchhaltung. Freitext, weil sie führende
   * Nullen oder Buchstaben enthalten kann. Rein informativ – steht auf dem
   * Stundenzettel, hat auf die Planung keinen Einfluss. Fehlt/leer = nicht
   * gesetzt.
   */
  persNr?: string;
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
   * Monatliche Abend-Reinigung nach 20:00 (Nachtzuschlag) in Minuten.
   *
   * Eigener Topf, ZUSÄTZLICH zum Tages-Soll (targetMinutes): der Betrieb gibt je
   * Person einen Monatswert vor ("A macht 10 h Abend, B 12 h ..."). Der Scheduler
   * streut die Summe auf ein paar zufällige Arbeitstage (zufällige Länge je
   * Abend, Ende meist 21–23 Uhr) – siehe planNightWork in scheduler.ts. Fehlt/0
   * = keine Abendreinigung.
   */
  nightMinutes?: number;
  /**
   * Monatliche Sonntagsreinigung (Sonntagszuschlag) in Minuten, ebenfalls
   * ZUSÄTZLICH zum Tages-Soll. Wird auf ein paar der geschlossenen Sonntage
   * gestreut (planSundayWork in scheduler.ts). Fehlt/0 = keine Sonntagsarbeit.
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
   * Art des Dienstes: FLOOR (Ladendienst, Standard) oder SUNDAY (Sonntags-
   * reinigung). Die Abendreinigung ist keine eigene Kategorie (siehe unten).
   */
  category?: ShiftCategory;
  /** Legacy night extension; new schedules derive surcharges from shift times. */
  nightMinutes?: number;
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
  /**
   * Modell für Nacht-/Sonntagsarbeit.
   *  - Fehlt/1: alte Stände (globale Sonntagsreinigung, Schließer bis 22:00).
   *  - 3: je Person eigener Monats-Topf für Abend (nach 20:00) und Sonntag,
   *       zusätzlich zum Tages-Soll – siehe Employee.nightMinutes/sundayMinutes.
   * (2 war ein Zwischenschritt: alle bezahlte Zeit gegen das Soll, Zuschläge aus
   *  den Zeiten. Bleibt als Zahl erhalten, wird aber nicht mehr erzeugt.)
   */
  surchargeModelVersion?: 1 | 2 | 3;
  /** Zuschläge in Prozent (Nacht nach 20:00, Sonntag). Fehlt = 0/0. */
  surchargeConfig?: SurchargeConfig;
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
