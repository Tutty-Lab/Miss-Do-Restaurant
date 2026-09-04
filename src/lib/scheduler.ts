// ============================================================================
// Deterministischer, greedy Scheduler (kein Solver, kein KI-Modell).
//
// Vorgehen:
//  1. Alle Tage des Monats + Nachfrage-Gewichte -> rohes Tages-Soll (Minuten).
//  2. Sollstunden jedes Mitarbeiters in Schicht-Token zerlegen.
//  3. Token rundenweise (rotierend) verteilen; große Vollzeit-Schichten zuerst.
//  4. Für jedes Token die beste Kalender-Datum wählen (Score + harte Regeln).
//  5. Früh/Spät anhand der gewünschten Spätschicht-Quote wählen.
//  6. Reparaturlauf: Schichten zwischen Tagen verschieben, um die Tages-
//     nachfrage besser zu treffen (Sollstunden bleiben exakt erhalten).
//
// Harte Regeln, die IMMER eingehalten werden:
//  - genau ein Dienst pro Mitarbeiter und Tag
//  - höchstens 6 aufeinanderfolgende Arbeitstage
//  - Token-Dauer wird nie verändert  => monatliches Soll bleibt exakt
// ============================================================================

import type { Employee, Shift } from "../types";
import {
  DAY_WEIGHTS,
  LATE_SHIFT_RATIOS,
  datesOfMonth,
  parseIsoDate,
  weekdayKeyOf,
  type WeekdayKey,
} from "./demand";
import { getShiftTemplate, type TemplateType } from "./shifts";
import { consecutiveRunLengthWith, seededRandom } from "./consecutive";
import { mayWorkOn } from "./availability";
import { weekStartOf } from "./weeks";
import { calculatePause, presenceFromPaid } from "./time";
import {
  effectiveWeekdayKey,
  frameOf,
  longestBlock,
  resolveDay,
  type DayBlocks,
  type DayWindow,
  type ResolvedDay,
  type OverrideMap,
  type WorkHoursConfig,
} from "./workHours";
import { publicHolidays } from "./holidays";

export type GenerateInput = {
  year: number;
  month: number; // 1-basiert
  /** Arbeitszeit-Fenster je Wochentag + Feiertag. */
  workHours: WorkHoursConfig;
  /** Ausnahmen für einzelne Daten (geschlossen / abweichende Zeiten). */
  overrides?: OverrideMap;
  employees: Employee[];
  /** Feiertage als ISO-Set; Standard: Sachsen-Feiertage des Jahres. */
  holidays?: Set<string>;
  /** Optionaler Seed; sonst aus Eingabedaten abgeleitet. */
  seed?: string;
};

type DateState = {
  totalPaid: number;
  latePaid: number;
  count: number;
};

type SchedulerState = {
  dates: string[];
  /** Mitarbeiter nach Id – die Umräum-Pässe sehen sonst nur Schichten. */
  byId: Map<string, Employee>;
  rawTarget: Map<string, number>; // ISO -> rohes Tages-Soll in Minuten
  dateState: Map<string, DateState>;
  worked: Map<string, Set<string>>; // employeeId -> Set<ISO>
  weekendCount: Map<string, number>; // employeeId -> Anzahl Fr/Sa-Schichten
  remaining: Map<string, number>; // employeeId -> noch zu verplanende Minuten
  shifts: Shift[];
  /** Für Nachfrage/Spätquote maßgeblicher Wochentag (Feiertag = Sonntag). */
  effKeyOf: (isoDate: string) => WeekdayKey;
  /** Aufgelöster Tag (geschlossen? + Arbeitszeit-Fenster) für ein Datum. */
  dayOf: (isoDate: string) => ResolvedDay;
  /** Stoßzeiten dieses Datums – je Wochentag verschieden. */
  peaksOf: (isoDate: string) => readonly PeakWindow[];
  rng: () => number;
  /** true = Schichtlängen mischen; false = immer die längste (Rückfallmodus). */
  varyLengths: boolean;
};

/**
 * Längster zusammenhängender Block des Tages (0 wenn geschlossen).
 *
 * Maßgeblich ist der längste EINZELNE Block, nicht der Rahmen von der ersten
 * Öffnung bis zur letzten Schließung: eine Schicht muss komplett in einen
 * Block passen. Bei 11:30–15:00 und 17:00–22:00 sind das 5 h, nicht 10,5 h.
 */
function windowLength(day: ResolvedDay): number {
  return day.closed ? 0 : longestBlock(day.blocks);
}


let shiftIdCounter = 0;
function nextShiftId(): string {
  shiftIdCounter += 1;
  return `gen-${shiftIdCounter}`;
}

function isWeekend(isoDate: string): boolean {
  const key = weekdayKeyOf(parseIsoDate(isoDate));
  return key === "friday" || key === "saturday";
}

const SHIFT_HOURS_DESC = [9, 8, 7, 6, 5, 4, 3] as const;

/** Längste zulässige Schicht in Stunden (bezahlt, ohne Pause). */
const MAX_SHIFT_HOURS = 9;

/** Kürzeste zulässige Schicht in Minuten – darunter geht ein Soll nicht auf. */
const MIN_SHIFT_MINUTES = 3 * 60;

/**
 * Erlaubte Schichtlängen je Anstellungsart (Vorgabe des Chefs).
 *
 * Vollzeit macht lange Dienste (6..9 h), Teilzeit die volle Bandbreite.
 *
 * Es gab zwischenzeitlich ein Kurzschicht-Budget, das einen langen Dienst
 * gelegentlich durch zwei kurze ersetzt hat (8 h -> 4 h + 4 h), damit die
 * Pläne abwechslungsreicher aussehen. Das ist wieder draußen: der Laden hat
 * drei Beschäftigte, da soll der Plan bewusst gleichförmig bleiben. Jede
 * Abwechslung kostet hier Besetzung in der Stoßzeit.
 */
const ALLOWED_HOURS: Record<Employee["employmentType"], readonly number[]> = {
  // Angabe des Betriebs auf die Frage nach 4/5/6/7/8-Stunden-Schichten:
  // "Vollzeit 8 tiếng 1 ngày". Also genau eine Länge, keine Auswahl.
  //
  // Das ist ungewöhnlich streng, geht hier aber auf: 160 h im Monat sind
  // exakt 20 Dienste zu 8 h. Sollte ein Soll einmal NICHT durch 8 teilbar
  // sein, greift in chooseShiftHours der Rückfall auf ALL_HOURS – lieber eine
  // krumme Schicht als ein Monat, der nicht aufgeht.
  VOLLZEIT: [8],
  TEILZEIT: [3, 4, 5, 6, 7, 8, 9],
  // Minijob ist arbeitsrechtlich eine Form der Teilzeit – gleiche Längen.
  // Begrenzt wird er über das Monats-Soll, nicht über die Schichtlänge.
  MINIJOB: [3, 4, 5, 6, 7, 8, 9],
};

/**
 * Wie oft darf eine Schicht bewusst kurz ausfallen (4 oder 5 h)?
 *
 * Vorgabe des Chefs: „nur etwa jede zehnte". Ganz ohne kurze Dienste sieht
 * jeder Monat gleich aus; zu viele davon kosten Besetzung in der Stoßzeit.
 * Greift nur, wenn der Tag ohnehin keinen langen Dienst mehr braucht und
 * genügend Reservetage übrig sind – das Monats-Soll bleibt in jedem Fall exakt.
 */
const SHORT_SHIFT_CHANCE = 0.1;

/** Längen, die als „kurze Schicht" im Sinne der 10-%-Regel gelten. */
const SHORT_SHIFT_HOURS: readonly number[] = [4, 5];

/** Alle überhaupt zulässigen Längen – Rückfall, wenn das Fenster eng ist. */
const ALL_HOURS: readonly number[] = [3, 4, 5, 6, 7, 8, 9];

// ── Stoßzeiten (peak windows) ───────────────────────────────────────────────
// Angabe des Betriebs: Spitzen mittags 11:00-14:00 und nachmittags 16:00-19:00.
// Gilt an jedem offenen Tag (Mo-Sa); am Samstag ist am meisten los.
//
// ANNAHME: die Personenzahl je Spitze hat der Betrieb NICHT genannt. Gesetzt
// sind "mindestens 2" ohne Obergrenze (KEINE_OBERGRENZE). Dass der Samstag der
// stärkste Tag ist, steckt bereits in DAY_WEIGHTS (1,8) – mehr Stunden am
// Samstag heißt automatisch mehr Leute, ohne dass die Mindestzahl steigen muss.
// Sobald der Betrieb konkrete Zahlen nennt, ist das hier die einzige Stelle,
// die sich ändert; Auswertung, Doku-Tab und Warnungen lesen alle von hier.
export type PeakWindow = {
  label: string;
  startMinutes: number;
  endMinutes: number;
  /** So viele müssen mindestens da sein. */
  minStaff: number;
  /** So viele dürfen höchstens da sein. KEINE_OBERGRENZE = beliebig viele. */
  maxStaff: number;
};

/**
 * Steht für "so viele wie nötig". Ein echter Zahlenwert statt undefined, damit
 * die Vergleiche in peakDeficit ohne Sonderfall auskommen; 99 Personen passen
 * in keinen dieser Läden.
 */
export const KEINE_OBERGRENZE = 99;

const MITTAG: PeakWindow = {
  label: "Trưa",
  startMinutes: 11 * 60,
  endMinutes: 14 * 60,
  minStaff: 2,
  maxStaff: KEINE_OBERGRENZE,
};

const NACHMITTAG: PeakWindow = {
  label: "Chiều",
  startMinutes: 16 * 60,
  endMinutes: 19 * 60,
  minStaff: 2,
  maxStaff: KEINE_OBERGRENZE,
};

/**
 * Stoßzeiten je Wochentag: beide Spitzen an jedem Werktag (Mo-Sa). Sonntag ist
 * normal geschlossen; an einem verkaufsoffenen Sonntag greifen dieselben zwei
 * Spitzen. Feiertage werden wie Sonntag behandelt (effectiveWeekdayKey), sind
 * aber ohnehin geschlossen.
 */
const WERKTAG_SPITZEN: readonly PeakWindow[] = [MITTAG, NACHMITTAG];

export const PEAK_WINDOWS_BY_WEEKDAY: Record<WeekdayKey, readonly PeakWindow[]> = {
  monday: WERKTAG_SPITZEN,
  tuesday: WERKTAG_SPITZEN,
  wednesday: WERKTAG_SPITZEN,
  thursday: WERKTAG_SPITZEN,
  friday: WERKTAG_SPITZEN,
  saturday: WERKTAG_SPITZEN,
  sunday: WERKTAG_SPITZEN,
};

/** Wie viele Leute sind zum Zeitpunkt `t` anwesend (Anwesenheit inkl. Pause)? */
function coverageAt(shifts: Shift[], t: number): number {
  let n = 0;
  for (const s of shifts) if (s.startMinutes <= t && s.endMinutes > t) n++;
  return n;
}

/**
 * Kleinste Besetzung im halboffenen Intervall [from, to).
 * Die Besetzung ändert sich nur an Schichtgrenzen, deshalb genügt es, den
 * Anfang und jede Grenze innerhalb des Intervalls zu prüfen.
 */
export function minCoverageOver(shifts: Shift[], from: number, to: number): number {
  const probes = new Set<number>([from]);
  for (const s of shifts) {
    if (s.startMinutes > from && s.startMinutes < to) probes.add(s.startMinutes);
    if (s.endMinutes > from && s.endMinutes < to) probes.add(s.endMinutes);
  }
  let min = Number.POSITIVE_INFINITY;
  for (const t of probes) min = Math.min(min, coverageAt(shifts, t));
  return Number.isFinite(min) ? min : 0;
}

/**
 * Größte Besetzung im halboffenen Intervall [from, to).
 * Gegenstück zu minCoverageOver – für die Obergrenze ("höchstens zwei").
 */
export function maxCoverageOver(shifts: Shift[], from: number, to: number): number {
  const probes = new Set<number>([from]);
  for (const s of shifts) {
    if (s.startMinutes > from && s.startMinutes < to) probes.add(s.startMinutes);
    if (s.endMinutes > from && s.endMinutes < to) probes.add(s.endMinutes);
  }
  let max = 0;
  for (const t of probes) max = Math.max(max, coverageAt(shifts, t));
  return max;
}

/**
 * Wie weit liegt der Tag neben der erlaubten Besetzung der Stoßzeiten?
 *
 * Gezählt wird BEIDES: fehlende Personen und zu viele. Der Laden ist klein –
 * "höchstens zwei, den Chef mitgerechnet" ist genauso eine Vorgabe wie
 * "mindestens zwei". Weil Anordnung und Reparatur alle über diese eine Zahl
 * gesteuert werden, wirkt die Obergrenze damit überall, ohne dass jede
 * Funktion sie einzeln kennen muss.
 *
 * 0 = alle Spitzen des Tages liegen im erlaubten Band. Spitzen, die gar nicht
 * ins Arbeitszeit-Fenster fallen, zählen nicht mit.
 */
export function peakDeficit(
  shifts: Shift[],
  window: { startMinutes: number; endMinutes: number },
  peaks: readonly PeakWindow[],
): number {
  let off = 0;
  for (const peak of peaks) {
    const from = Math.max(peak.startMinutes, window.startMinutes);
    const to = Math.min(peak.endMinutes, window.endMinutes);
    if (to <= from) continue; // Spitze liegt außerhalb der Arbeitszeit
    off += Math.max(0, peak.minStaff - minCoverageOver(shifts, from, to));
    off += Math.max(0, maxCoverageOver(shifts, from, to) - peak.maxStaff);
  }
  return off;
}

/**
 * Lässt sich `hours` restlos in Schichten aus `allowed` zerlegen?
 * Nötig, weil z.B. 11 h mit nur 6/7/8-h-Schichten nicht aufgeht – ohne diese
 * Prüfung liefe der Scheduler in eine Sackgasse und das Soll bliebe offen.
 */
const decomposeCache = new Map<string, boolean>();
function canDecompose(hours: number, allowed: readonly number[]): boolean {
  if (hours === 0) return true;
  if (hours < Math.min(...allowed)) return false;

  // Schlüssel über die WERTE, nicht die Länge: zwei verschiedene Längenmengen
  // mit gleich vielen Einträgen hätten sonst denselben Cache-Eintrag.
  const key = `${allowed.join(",")}:${hours}`;
  const cached = decomposeCache.get(key);
  if (cached !== undefined) return cached;

  let ok = false;
  for (const h of allowed) {
    if (canDecompose(hours - h, allowed)) {
      ok = true;
      break;
    }
  }
  decomposeCache.set(key, ok);
  return ok;
}

/** Längstmögliche Schicht je Anstellungsart – für die Kapazitätsrechnung. */
const PREFERRED_HOURS: Record<Employee["employmentType"], number> = {
  VOLLZEIT: MAX_SHIFT_HOURS,
  TEILZEIT: MAX_SHIFT_HOURS,
  MINIJOB: MAX_SHIFT_HOURS,
};

/** Größte Schichtlänge (Stunden), deren Anwesenheit noch ins Fenster passt (0 = keine). */
export function maxShiftHoursForWindow(windowMinutes: number): number {
  for (const hours of SHIFT_HOURS_DESC) {
    if (presenceFromPaid(hours * 60) <= windowMinutes) return hours;
  }
  return 0;
}

/**
 * Kürzeste Schichtlänge (Stunden), deren Anwesenheit mindestens `presence`
 * Minuten abdeckt. 0 = selbst die längste Schicht reicht nicht.
 */
export function shiftHoursForPresence(presenceMinutes: number): number {
  for (let i = SHIFT_HOURS_DESC.length - 1; i >= 0; i--) {
    const hours = SHIFT_HOURS_DESC[i];
    if (presenceFromPaid(hours * 60) >= presenceMinutes) return hours;
  }
  return 0;
}

/**
 * Wie viele bezahlte Minuten braucht ein Tag mindestens, damit die Stoßzeit
 * überhaupt besetzt werden KANN?
 *
 * Hintergrund: Früh hängt am Öffnen, Spät am Schließen. Eine Frühschicht deckt
 * die Stoßzeit nur, wenn sie bis zu deren Ende reicht; eine Spätschicht nur,
 * wenn sie vor deren Beginn anfängt. Bei 10:00–20:00 und einer Stoßzeit von
 * 12 bis 18 Uhr heißt das: beide brauchen 8 h Anwesenheitsspanne, also je eine
 * 8-h-Schicht. Zwei Personen => 16 h an dem Tag.
 *
 * Ohne diesen Boden verteilt die Gewichtung ruhigen Tagen so wenig Stunden,
 * dass dort nur kurze Dienste möglich sind – und die decken die Stoßzeit nie,
 * egal wie man sie schiebt.
 */
function peakFloorMinutes(day: ResolvedDay, peaks: readonly PeakWindow[]): number {
  if (day.closed) return 0;
  return cheapestPeakCover(day.blocks, peaks).reduce((sum, h) => sum + h * 60, 0);
}

const coverCache = new Map<string, number[]>();

/**
 * Billigste Kombination von Schichtlängen, mit der ein Tag ALLES erfüllt:
 * jemand sperrt auf, jemand sperrt zu, und die Stoßzeit ist durchgehend
 * besetzt. Ergebnis in Stunden, absteigend. Leer = gar nicht abdeckbar.
 *
 * Warum gesucht statt gerechnet: die naheliegende Formel „jeder Dienst muss
 * vom Öffnen bis zum Ende der Stoßzeit reichen" ergibt bei 10–20 Uhr und
 * Stoßzeit 12–18 Uhr zweimal 8 h = 16 h. Billiger geht es aber mit 9 h + 6 h
 * = 15 h: der 9-h-Dienst füllt das ganze Fenster und erledigt Aufsperren,
 * Zusperren und Stoßzeit in einem, der 6-h-Dienst stellt sich einfach mitten
 * hinein. Solche Kombinationen findet man nur, wenn man sie durchprobiert –
 * und zwar mit derselben Anordnungslogik, die später auch real läuft.
 */
export function cheapestPeakCover(blocks: DayBlocks, peaks: readonly PeakWindow[]): number[] {
  const key =
    blocks.map((b) => `${b.startMinutes}-${b.endMinutes}`).join("+") +
    "|" +
    peaks.map((p) => `${p.startMinutes}-${p.endMinutes}x${p.minStaff}-${p.maxStaff}`).join(",");
  const cached = coverCache.get(key);
  if (cached) return cached;

  // Eine Schicht muss komplett in EINEN Block passen.
  const span = longestBlock(blocks);
  const usable = ALL_HOURS.filter((h) => presenceFromPaid(h * 60) <= span);

  let found: number[] = [];
  // Erst lückenlos suchen; findet sich nichts, noch einmal mit der alten,
  // schwächeren Anforderung (nur auf- und zusperren).
  for (const streng of [true, false]) {
    if (found.length > 0) break;
  // Nach Anzahl der Dienste aufsteigend, innerhalb nach Gesamtstunden.
  for (let count = 1; count <= 4 && found.length === 0; count++) {
    let bestTotal = Number.POSITIVE_INFINITY;
    let best: number[] | null = null;
    const combo: number[] = [];

    const recurse = (from: number) => {
      if (combo.length === count) {
        const total = combo.reduce((a, b) => a + b, 0);
        if (total < bestTotal && canCoverDay(blocks, combo, peaks, streng)) {
          bestTotal = total;
          best = [...combo];
        }
        return;
      }
      for (let i = from; i < usable.length; i++) {
        combo.push(usable[i]);
        recurse(i); // Wiederholungen erlaubt
        combo.pop();
      }
    };
    recurse(0);

    if (best) found = (best as number[]).slice().sort((a, b) => b - a);
  }
  }

  coverCache.set(key, found);
  return found;
}

/**
 * Minuten, in denen der Laden GEÖFFNET ist, aber niemand da.
 *
 * Klingt selbstverständlich, war es aber nicht: geprüft wurde bisher nur, ob
 * jemand aufsperrt und jemand zusperrt. An einem Tag ohne Stoßzeit reichten
 * dafür zwei 3-h-Dienste – einer um 12:00, einer um 19:30 – und dazwischen
 * stand der Laden dreieinhalb Stunden offen und leer.
 */
function uncoveredMinutes(shifts: Shift[], blocks: DayBlocks): number {
  let offen = 0;
  for (const b of blocks) {
    const stuecke = shifts
      .filter((s) => s.endMinutes > b.startMinutes && s.startMinutes < b.endMinutes)
      .map((s) => [Math.max(s.startMinutes, b.startMinutes), Math.min(s.endMinutes, b.endMinutes)] as const)
      .sort((x, y) => x[0] - y[0]);

    let bisJetzt = b.startMinutes;
    for (const [von, bis] of stuecke) {
      if (von > bisJetzt) offen += von - bisJetzt;
      if (bis > bisJetzt) bisJetzt = bis;
      if (bisJetzt >= b.endMinutes) break;
    }
    if (bisJetzt < b.endMinutes) offen += b.endMinutes - bisJetzt;
  }
  return offen;
}

/**
 * Gesamtnote eines Tages, je kleiner desto besser: erst die Stoßzeit, dann die
 * Lücken. Eine fehlende Person in der Spitze wiegt mehr als jede Lücke, aber
 * eine Lücke wiegt eben NICHT null – das war der Fehler.
 */
function dayDefect(shifts: Shift[], blocks: DayBlocks, peaks: readonly PeakWindow[]): number {
  return peakDeficit(shifts, frameOf(blocks), peaks) * 10000 + uncoveredMinutes(shifts, blocks);
}

/** Lässt sich der Tag mit genau diesen Längen vollständig abdecken? */
function canCoverDay(
  blocks: DayBlocks,
  hours: number[],
  peaks: readonly PeakWindow[],
  /**
   * false = Lücken hinnehmen. Nur der Notausgang: gibt es zu einer Fensterform
   * überhaupt keine lückenlose Lösung (etwa weil ein Block 3,5 h lang ist, das
   * Modell aber nur ganze Stunden kennt), käme sonst eine LEERE Abdeckung
   * heraus – und eine leere Abdeckung schaltet die Besetzungslogik komplett ab.
   * Lieber die alte, schwächere Anforderung als gar keine.
   */
  luckenlos = true,
): boolean {
  const probe: Shift[] = hours.map((h, i) => ({
    id: `probe-${i}`,
    employeeId: `probe-${i}`,
    date: "probe",
    startMinutes: blocks[0].startMinutes,
    endMinutes: blocks[0].startMinutes + presenceFromPaid(h * 60),
    pauseMinutes: h * 60 - h * 60 + (presenceFromPaid(h * 60) - h * 60),
    paidMinutes: h * 60,
    shiftType: "EARLY",
    generated: true,
  }));

  arrangeForPeaks(blocks, probe, peaks);

  const frame = frameOf(blocks);
  const opens = probe.some((s) => s.startMinutes === frame.startMinutes);
  const closes = probe.some((s) => s.endMinutes === frame.endMinutes);
  if (!opens || !closes) return false;
  if (!luckenlos) return peakDeficit(probe, frame, peaks) === 0;
  return dayDefect(probe, blocks, peaks) === 0;
}

/** Bezahlte Stunden aller Dienste eines Tages. */
function dayPaidHours(state: SchedulerState, isoDate: string): number[] {
  const out: number[] = [];
  for (const s of state.shifts) if (s.date === isoDate) out.push(s.paidMinutes / 60);
  return out;
}

/**
 * Wie viele Anforderungen der billigsten Abdeckung deckt diese Menge von
 * Schichtlängen ab? Lange Dienste werden zuerst auf die größte offene
 * Anforderung gelegt.
 */
function coverFilledBy(cover: readonly number[], hours: number[]): number {
  const need = [...cover];
  let filled = 0;
  for (const h of [...hours].sort((a, b) => b - a)) {
    const idx = need.findIndex((n) => h >= n);
    if (idx >= 0) {
      need.splice(idx, 1);
      filled++;
    }
  }
  return filled;
}

/** Abdeckung eines Tages, wenn er GENAU diese Schichtlängen hätte. */
function coverFilledFor(state: SchedulerState, isoDate: string, hours: number[]): number {
  const day = state.dayOf(isoDate);
  if (day.closed) return Number.POSITIVE_INFINITY;
  const cover = cheapestPeakCover(day.blocks, state.peaksOf(isoDate));
  if (cover.length === 0) return Number.POSITIVE_INFINITY;
  return coverFilledBy(cover, hours);
}

/** Wie viele Dienste verlangt die billigste Abdeckung an diesem Tag? */
function coverSize(state: SchedulerState, isoDate: string): number {
  const day = state.dayOf(isoDate);
  if (day.closed) return 0;
  return cheapestPeakCover(day.blocks, state.peaksOf(isoDate)).length;
}

/**
 * Welche Länge fehlt diesem Tag noch, um die billigste Abdeckung zu erreichen?
 * 0 = der Tag hat schon genug passende Dienste.
 */
function missingCoverHours(state: SchedulerState, isoDate: string): number {
  const day = state.dayOf(isoDate);
  if (day.closed) return 0;
  const need = [...cheapestPeakCover(day.blocks, state.peaksOf(isoDate))];
  if (need.length === 0) return 0;

  for (const h of dayPaidHours(state, isoDate).sort((a, b) => b - a)) {
    const idx = need.findIndex((n) => h >= n);
    if (idx >= 0) need.splice(idx, 1);
  }
  return need.length === 0 ? 0 : Math.max(...need);
}

/**
 * Wie lang darf ein Dienst höchstens sein, wenn er eine Stoßzeit KOMPLETT
 * meiden soll? Das ist die längste Lücke, die neben dem Fenster noch übrig
 * bleibt – in irgendeinem Block des Tages.
 *
 * Samstag 13–22 Uhr mit Spitze 17–22: davor bleiben 4 h, danach nichts.
 * Dienstag 11:30–15 + 17–22 mit Spitze am Vormittag: der ganze Abendblock,
 * also 5 h.
 */
function dodgeLimitMinutes(blocks: DayBlocks, peak: PeakWindow): number {
  let best = 0;
  for (const b of blocks) {
    const vor = Math.min(b.endMinutes, peak.startMinutes) - b.startMinutes;
    const nach = b.endMinutes - Math.max(b.startMinutes, peak.endMinutes);
    best = Math.max(best, vor, nach);
  }
  return Math.max(0, best);
}

/**
 * Obergrenze für die Länge des NÄCHSTEN Dienstes an diesem Tag, damit die
 * Stoßzeit nicht überbesetzt wird. Unendlich, solange noch Platz im Fenster
 * ist.
 *
 * Der Grund für diese Prüfung: Verschieben allein rettet nichts mehr. An einem
 * Samstag 13–22 Uhr hat ein 9-h-Dienst genau EINE mögliche Lage. Standen dort
 * erst einmal drei 9-h-Dienste, waren zwangsläufig drei Leute im Abendfenster,
 * obwohl höchstens zwei erlaubt sind – kein Umsortieren konnte das heilen.
 * Also muss die Grenze schon bei der Wahl der LÄNGE greifen: sobald so viele
 * lange Dienste am Tag hängen, wie das Fenster Personen zulässt, darf der
 * nächste nur noch so lang sein, dass er komplett daneben passt.
 */
function peakLengthCapHours(
  blocks: DayBlocks,
  onDay: readonly Shift[],
  peaks: readonly PeakWindow[],
): number {
  let cap = Number.POSITIVE_INFINITY;
  for (const peak of peaks) {
    const dodge = dodgeLimitMinutes(blocks, peak);
    // Dienste, die länger sind als die Ausweichlücke, MÜSSEN ins Fenster
    // ragen – egal, wohin man sie schiebt.
    let unvermeidbar = 0;
    for (const s of onDay) {
      if (s.endMinutes - s.startMinutes > dodge) unvermeidbar++;
    }
    if (unvermeidbar >= peak.maxStaff) cap = Math.min(cap, dodge / 60);
  }
  return cap;
}

/**
 * Wählt die Länge (Stunden) der nächsten Schicht eines Mitarbeiters so, dass
 * - sie 3..9 h ist und ins Tagesfenster passt (<= maxHours),
 * - der verbleibende Rest exakt aufteilbar bleibt (0 oder >= 3 h),
 * - Vollzeit möglichst lange, Teilzeit eher kürzere Schichten bekommt.
 * Gibt 0 zurück, wenn an diesem Tag keine gültige Länge möglich ist.
 *
 * Dadurch arbeiten auch Vollzeit-Kräfte an einem „halben Tag" – nur mit einer
 * kürzeren Schicht – und das Monats-Soll bleibt trotzdem exakt.
 */
export function chooseShiftHours(
  remainingMinutes: number,
  maxHours: number,
  employmentType: Employee["employmentType"],
  /** Mindestlänge, um das Soll bis Monatsende noch zu schaffen (Stunden). */
  needHours = MAX_SHIFT_HOURS,
  /** Ohne Zufallsquelle wird deterministisch die kürzeste taugliche gewählt. */
  rng?: () => number,
  /**
   * Länge (Stunden), ab der ein Dienst die Stoßzeit decken kann. > 0 heißt:
   * dieser Tag braucht noch so einen Dienst.
   */
  peakHours = 0,
): number {
  const remainingHours = remainingMinutes / 60;
  const cap = Math.min(MAX_SHIFT_HOURS, maxHours, remainingHours);
  if (cap < 3) return 0;

  // Erlaubte Längen je Anstellungsart (Vorgabe des Chefs): Vollzeit macht keine
  // Kurzschichten, Teilzeit darf die ganze Bandbreite.
  const pick = (allowed: readonly number[]): number[] => {
    const out: number[] = [];
    for (const hours of allowed) {
      if (hours > cap) continue;
      // Der Rest muss mit denselben Längen restlos aufgehen. Bei Vollzeit
      // (6/7/8) sind z.B. 9, 10, 11 oder 17 Stunden Sackgassen.
      if (canDecompose(remainingHours - hours, allowed)) out.push(hours);
    }
    return out;
  };

  // Früher entschied eine feste Rangliste (Vollzeit 8, Teilzeit 5). Ergebnis:
  // jede Vollzeitschicht war 8 h, jede Teilzeitschicht 5 h – keinerlei
  // Abwechslung, und Teilzeit war faktisch auf 5 h/Tag gedeckelt.
  //
  // Jetzt: unter allen Längen zufällig wählen, aber nur solche, die das Tempo
  // halten. Wer noch viel Soll und wenig Tage hat, bekommt zwangsläufig lange
  // Schichten; wer gut liegt, bekommt Abwechslung.
  const choose = (valid: number[]): number => {
    const onPace = valid.filter((h) => h >= needHours).sort((a, b) => a - b);
    if (onPace.length === 0) return valid[valid.length - 1];

    // Ohne Zufallsquelle läuft der strenge Rückfallversuch (attempt(false)).
    // Dort zählt nur noch, dass das Soll überhaupt aufgeht: die LÄNGSTE Länge
    // braucht die wenigsten Tage und hat deshalb die besten Chancen.
    //
    // Diese Unterscheidung ist der eigentliche Sinn des Rückfalls. Fehlte sie,
    // verhielte sich der strenge Versuch exakt wie die vorherigen fünf – das
    // Sicherheitsnetz wäre keins mehr. Genau daran scheiterte der Plan bei
    // einem Laden, der SIEBEN Tage offen hat: dort erzwingt die Sechs-Tage-
    // Regel Lücken, das Soll geht knapp nicht auf, und ohne den Rückfall gab
    // es gar keinen Plan.
    if (!rng) return onPace[onPace.length - 1];

    // Im Normalfall die KÜRZESTE Länge, die das Tempo noch hält.
    //
    // needHours ist bereits das Mittel, das nötig ist, um das Soll bis
    // Monatsende genau aufzubrauchen. Wer länger arbeitet als dieses Mittel,
    // ist vorzeitig fertig – und steht dem Laden die restlichen Tage nicht
    // mehr zur Verfügung. Bei kleinen Deputaten fällt das brutal auf: 43 h in
    // 9-h-Diensten sind nach fünf Tagen weg, in 5-h-Diensten reichen sie für
    // neun.
    return onPace[0];
  };

  // Braucht der Tag noch einen stoßzeittauglichen Dienst, wird zuerst NUR mit
  // den langen Längen gerechnet – und zwar auch für den Rest. Ohne diese
  // zweite Bedingung bleibt am Monatsende ein Rest übrig, der sich nicht mehr
  // in lange Dienste zerlegen lässt (z.B. 13 h), und genau dort entstehen die
  // kurzen Schichten, die eine Stoßzeit nie decken können.
  if (peakHours > 0) {
    const longOnly = ALLOWED_HOURS[employmentType].filter((h) => h >= peakHours);
    const validLong = pick(longOnly);
    if (validLong.length > 0) return choose(validLong);
  }

  // Braucht der Tag keinen langen Dienst mehr, darf etwa jede zehnte Schicht
  // bewusst kurz ausfallen – nur dann bleibt der Rest auch aufteilbar.
  if (rng && peakHours === 0 && rng() < SHORT_SHIFT_CHANCE) {
    const shortValid = pick(
      ALLOWED_HOURS[employmentType].filter((h) => SHORT_SHIFT_HOURS.includes(h)),
    );
    if (shortValid.length > 0) return shortValid[Math.floor(rng() * shortValid.length)];
  }

  // Erst die für die Anstellungsart vorgesehenen Längen. Geht dort nichts –
  // etwa an einem halben Tag, an dem keine 6-h-Schicht mehr hineinpasst –
  // greift die volle Bandbreite, damit auch Vollzeit an dem Tag arbeiten kann.
  let valid = pick(ALLOWED_HOURS[employmentType]);
  if (valid.length === 0) valid = pick(ALL_HOURS);
  if (valid.length === 0) return 0;

  return choose(valid);
}

/** Stabile Basisordnung: Vollzeit zuerst, dann nach Id. */
function orderedEmployees(employees: Employee[]): Employee[] {
  return [...employees].sort((a, b) => {
    if (a.employmentType !== b.employmentType) {
      return a.employmentType === "VOLLZEIT" ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });
}

function chooseTemplateType(
  state: SchedulerState,
  isoDate: string,
  employmentType: Employee["employmentType"],
): TemplateType {
  const ds = state.dateState.get(isoDate)!;
  const effKey = state.effKeyOf(isoDate);
  const desired = LATE_SHIFT_RATIOS[effKey];
  const currentLateRatio = ds.totalPaid > 0 ? ds.latePaid / ds.totalPaid : 0;

  // Teilzeit tendenziell in Spätschichten. Früher wurde sonntags zusätzlich
  // auf 0,95 hochgezwungen – damit stand am Sonntag praktisch niemand zur
  // Öffnung um 11:00 im Laden. Jetzt gilt die konfigurierte Quote.
  let threshold = desired;
  if (employmentType !== "VOLLZEIT") threshold += 0.15;

  return currentLateRatio < threshold ? "LATE" : "EARLY";
}

/**
 * In welchen Öffnungsblock gehört ein Dienst dieser Länge?
 *
 * Früh sucht von vorn, Spät von hinten – und beide nehmen den ersten Block,
 * der lang genug ist. Nötig, seit ein Tag MEHRERE Blöcke haben kann: Di–Fr ist
 * von 15:00 bis 17:00 zu. Vorher wurde stumpf der Rahmen des ganzen Tages
 * (11:30–22:00) benutzt, und eine 5-h-Frühschicht landete auf 11:30–16:30 –
 * anderthalb Stunden davon bei geschlossenem Laden. Betroffen war gut ein
 * Viertel aller Dienste.
 *
 * Gibt es keinen passenden Block, kommt der längste zurück; der Aufrufer hat
 * die Länge dann schon vorher auf longestBlock begrenzt.
 */
function blockForShift(blocks: DayBlocks, presence: number, type: TemplateType): DayWindow {
  const passend = blocks.filter((b) => b.endMinutes - b.startMinutes >= presence);
  if (passend.length === 0) {
    return blocks.reduce((a, b) =>
      b.endMinutes - b.startMinutes > a.endMinutes - a.startMinutes ? b : a,
    );
  }
  return type === "LATE" ? passend[passend.length - 1] : passend[0];
}

/**
 * Ein Öffnungsblock, in dem eine Stoßzeit liegt und in dem noch NIEMAND steht.
 *
 * Nötig, weil der Mittagsblock Di–Fr nur 3,5 h lang ist: Dienste ab 4 h passen
 * dort nicht hinein und wandern alle in den Abendblock. Ohne dieses Signal
 * stand der Laden Di–Fr von 11:30 bis 15:00 leer – ausgerechnet in der Zeit,
 * die die Chefin als die volle nennt. Vorher fiel das nicht auf, weil Dienste
 * damals über die Mittagsschließung hinweg geplant wurden.
 */
function uncoveredPeakBlock(state: SchedulerState, isoDate: string): DayWindow | null {
  const day = state.dayOf(isoDate);
  if (day.closed) return null;
  const peaks = state.peaksOf(isoDate);
  if (peaks.length === 0) return null;

  const imBlock = (block: DayWindow) =>
    state.shifts.filter(
      (sh) =>
        sh.date === isoDate &&
        sh.startMinutes >= block.startMinutes &&
        sh.endMinutes <= block.endMinutes,
    );

  for (const block of day.blocks) {
    for (const peak of peaks) {
      if (peak.minStaff <= 0) continue;
      const von = Math.max(peak.startMinutes, block.startMinutes);
      const bis = Math.min(peak.endMinutes, block.endMinutes);
      if (bis <= von) continue;

      // Nicht nur "steht da überhaupt jemand", sondern "ist die Spanne
      // LÜCKENLOS besetzt". Der Mittagsblock ist 3,5 h lang, ein Dienst aber
      // höchstens 3 h (ganze Stunden) – eine einzelne Kraft lässt also immer
      // eine halbe Stunde offen. Erst ein zweiter, versetzter Dienst schließt
      // sie; das Anordnen übernimmt danach arrangeForPeaks.
      if (minCoverageOver(imBlock(block), von, bis) < peak.minStaff) return block;
    }
  }
  return null;
}

function makeShift(
  state: SchedulerState,
  employee: Employee,
  isoDate: string,
  paidMinutes: number,
  /** Erzwingt einen bestimmten Öffnungsblock (siehe uncoveredPeakBlock). */
  forceBlock?: DayWindow,
): Shift {
  const type = chooseTemplateType(state, isoDate, employee.employmentType);
  const block =
    forceBlock ??
    blockForShift(state.dayOf(isoDate).blocks, presenceFromPaid(paidMinutes), type);
  const tpl = getShiftTemplate(
    paidMinutes / 60,
    type,
    block.startMinutes,
    block.endMinutes,
    employee.employmentType,
  );
  return {
    id: nextShiftId(),
    employeeId: employee.id,
    date: isoDate,
    startMinutes: tpl.startMinutes,
    endMinutes: tpl.endMinutes,
    pauseMinutes: tpl.pauseMinutes,
    paidMinutes: tpl.paidMinutes,
    shiftType: tpl.type,
    generated: true,
  };
}

function applyShift(state: SchedulerState, shift: Shift): void {
  const ds = state.dateState.get(shift.date)!;
  ds.totalPaid += shift.paidMinutes;
  if (shift.shiftType === "LATE") ds.latePaid += shift.paidMinutes;
  ds.count += 1;
  state.worked.get(shift.employeeId)!.add(shift.date);
  if (isWeekend(shift.date)) {
    state.weekendCount.set(
      shift.employeeId,
      (state.weekendCount.get(shift.employeeId) ?? 0) + 1,
    );
  }
  state.shifts.push(shift);
}

/**
 * Platziert genau eine Schicht für einen Mitarbeiter: bestes Datum wählen,
 * Schichtlänge an das Tagesfenster anpassen. Gibt true zurück, wenn platziert.
 */
function placeOneShift(state: SchedulerState, employee: Employee): boolean {
  const remaining = state.remaining.get(employee.id)!;
  if (remaining <= 0) return false;

  const worked = state.worked.get(employee.id)!;
  const weekendCount = state.weekendCount.get(employee.id) ?? 0;

  // Wie viele Tage kann dieser Mitarbeiter ab jetzt WIRKLICH noch arbeiten?
  //
  // Greedy von vorn durchspielen und dabei die Sechs-Tage-Regel mitführen –
  // dieselbe Rechnung wie in monthCapacity, nur für diese Person und ihren
  // aktuellen Stand. Das Ergebnis ist eine echte Obergrenze, kein Schätzwert.
  //
  // Vorher stand hier `daysLeft * 0.9`, ein pauschaler Sicherheitsabschlag von
  // zehn Prozent. Der reicht, solange der Laden einen festen Ruhetag hat: der
  // geschlossene Tag unterbricht die Kette, und fast jeder offene Tag bleibt
  // belegbar. Hat der Laden gar keinen Ruhetag, sind es aber höchstens sechs
  // von je sieben Tagen, also 85,7 Prozent – die Schätzung war zu optimistisch,
  // das Tempo dadurch zu langsam, und am Monatsende blieben Stunden übrig, für
  // die es keinen zulässigen Tag mehr gab. Der Plan scheiterte dann komplett.
  let usableDays = 0;
  const trial = new Set(worked);
  for (const isoDate of state.dates) {
    if (trial.has(isoDate)) continue;
    const day = state.dayOf(isoDate);
    if (day.closed) continue;
    // Feste Wochentage und der Wochendeckel zaehlen hier mit. Ohne das rechnet
    // eine Kraft mit "funf Tage die Woche" alle sieben offenen Tage mit, das
    // Tempo faellt zu niedrig aus, die Schichten werden zu kurz – und am
    // Monatsende fehlen Stunden, fuer die es laengst keine Tage mehr gibt.
    if (!tagErlaubtMitProbe(employee, isoDate, trial)) continue;
    if (maxShiftHoursForWindow(windowLength(day)) === 0) continue;
    if (consecutiveRunLengthWith(trial, isoDate) > 6) continue;
    trial.add(isoDate); // belegt – zählt für die Kette der folgenden Tage mit
    usableDays += 1;
  }

  const needHours =
    usableDays > 0 ? Math.ceil(remaining / 60 / usableDays) : MAX_SHIFT_HOURS;

  let bestDate: string | null = null;
  let bestHours = 0;
  let bestBlock: DayWindow | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const isoDate of state.dates) {
    if (worked.has(isoDate)) continue; // max. ein Dienst pro Tag
    if (!tagErlaubt(state, employee, isoDate)) continue; // fester freier Tag / Wochendeckel
    const day = state.dayOf(isoDate);
    if (day.closed) continue; // Betriebsruhe -> kein Dienst

    // ── Sonderregeln für den Chef ──────────────────────────────────────────
    // Er arbeitet mit, aber nach eigenem Rhythmus: fünf Tage die Woche, und
    // samstags ist er nicht im Laden. Beides sind harte Regeln wie die
    // Sechs-Tage-Regel – ein Tag, der sie bricht, wird gar nicht erst geprüft.


    const dsNow = state.dateState.get(isoDate)!;
    const wanted = coverSize(state, isoDate); // wie viele Leute der Tag braucht
    const bodiesMissing = Math.max(0, wanted - dsNow.count);

    // Längste Schicht, die ins Fenster passt UND den Rest exakt aufteilbar lässt.
    let maxHours = maxShiftHoursForWindow(windowLength(day));

    // Reichen die Stunden des Tages nicht für die volle Abdeckung, ist ZWEI
    // Personen wichtiger als eine lange. Vorher entstanden reihenweise Tage
    // mit einer einzigen 9-h-Schicht von 10 bis 20 Uhr: die Person steht den
    // ganzen Tag allein im Laden, und während ihrer Pause ist niemand da.
    // Deshalb die Länge so deckeln, dass für die fehlenden Personen noch
    // Stunden des Tages übrig bleiben.
    if (bodiesMissing > 1) {
      const leftHours = (state.rawTarget.get(isoDate)! - dsNow.totalPaid) / 60;
      const share = Math.floor(leftHours / bodiesMissing);
      // Der Deckel darf das EIGENE Tempo nie unterschreiten. Sonst macht er
      // den Monat unplanbar: braucht ein Tag drei Dienste (bei 11:30-22:00 und
      // einer Abendspitze schafft keine einzelne Schicht beides, Öffnen und
      // 21 Uhr), dann ist ein Drittel der Tagesstunden schnell weniger, als die
      // Kraft im Schnitt pro Tag braucht - und ihr Soll geht nie auf.
      let limit = Math.max(share, needHours);

      // Vollzeit macht laut Betrieb 8-Stunden-Tage. Der Deckel oben hat daraus
      // an ruhigen Tagen 6-h-Schichten gemacht: Montag hat nur rund 14 h zu
      // vergeben, geteilt durch zwei Personen sind das 7. Solange der Tag aber
      // noch 8 h PLUS eine kürzeste Schicht (3 h) hergibt, bleibt der Tag auch
      // mit einer vollen 8-h-Schicht zweifach besetzt – dann gibt es keinen
      // Grund, sie zu kürzen.
      if (employee.employmentType === "VOLLZEIT" && leftHours >= 11) {
        limit = Math.max(limit, 8);
      }

      if (limit >= 3) maxHours = Math.min(maxHours, limit);
    }

    // Solange der Tag noch nicht genug LANGE Dienste hat, um die Stoßzeit zu
    // decken, wird die Mindestlänge hochgezogen. Ohne das entstehen Tage mit
    // rechnerisch genug Stunden, aber falscher Aufteilung (16 h als 7 + 9),
    // und die Stoßzeit bleibt unbesetzt – verschieben hilft dann nicht mehr.
    //
    // ABER nur, wenn der Tag sich die Abdeckung überhaupt leisten kann. Sonst
    // erzwingt die Regel eine Form, die nie aufgeht, und richtet Schaden an:
    // die billigste Abdeckung ist 9 h + 6 h, also verlangte JEDER leere Tag
    // zuerst einen 9-h-Dienst. Bei 26 Tagen sind das 234 h allein dafür – bei
    // 317 h Gesamtsoll bleibt für die zweite Person kaum etwas übrig, und eine
    // Teilzeitkraft mit 55 h ist nach sechs Diensten durch.
    // Steht in einem Öffnungsblock noch niemand, hat dieser Dienst dort mehr
    // Wert als irgendwo sonst – auch wenn er dafür kürzer ausfallen muss.
    // Di–Fr betrifft das den Mittagsblock: er ist 3,5 h lang, also passt nur
    // ein 3-h-Dienst hinein, während alle längeren in den Abend wandern.
    const leererBlock = uncoveredPeakBlock(state, isoDate);
    const blockStunden = leererBlock
      ? Math.floor((leererBlock.endMinutes - leererBlock.startMinutes) / 60)
      : 0;
    // Wie überall gilt: der Deckel darf das eigene Tempo nicht unterlaufen.
    // Eine Kraft mit 150 h im Monat braucht rund 6 h am Tag; schickt man sie
    // in den 3-h-Mittagsblock, verbrennt sie einen ihrer wenigen möglichen
    // Tage und das Monats-Soll geht am Ende nicht auf. Den Mittag füllt, wer
    // es sich leisten kann – die Kräfte mit kleinem Soll.
    const fuellDenBlock =
      leererBlock !== null &&
      blockStunden >= 3 &&
      blockStunden < maxHours &&
      blockStunden >= needHours;
    if (fuellDenBlock) maxHours = blockStunden;

    // Deckel aus der Stoßzeit-Obergrenze (siehe peakLengthCapHours).
    const peakCap = peakLengthCapHours(
      day.blocks,
      state.shifts.filter((s) => s.date === isoDate),
      state.peaksOf(isoDate),
    );

    const coverHours = cheapestPeakCover(day.blocks, state.peaksOf(isoDate)).reduce((sum, h) => sum + h, 0);
    const dayTargetHours = state.rawTarget.get(isoDate)! / 60;
    const affordsCover = coverHours > 0 && dayTargetHours >= coverHours - 0.5;
    const stillNeedsLong = affordsCover
      ? Math.min(missingCoverHours(state, isoDate), maxHours)
      : 0;

    const laenge = (cap: number) =>
      cap < 3
        ? 0
        : chooseShiftHours(
            remaining,
            cap,
            employee.employmentType,
            stillNeedsLong > 0 ? Math.max(needHours, stillNeedsLong) : needHours,
            state.varyLengths ? state.rng : undefined,
            stillNeedsLong,
          );

    // Erst die Länge suchen, die unter der Stoßzeit-Obergrenze bleibt.
    const capBeisst = Number.isFinite(peakCap) && peakCap < maxHours;
    let hours = laenge(Math.min(maxHours, Math.floor(peakCap)));
    // Der Deckel darf das eigene Tempo nicht unterlaufen: sonst verbrät eine
    // Kraft mit hohem Soll ihre wenigen möglichen Tage an 4-h-Diensten und
    // steht am Monatsende mit offenen Stunden da. Dann lieber diesen Tag
    // auslassen und woanders suchen.
    if (capBeisst && hours > 0 && hours < needHours) hours = 0;
    let peakPenalty = 0;
    if (hours === 0) {
      // Nichts passt darunter. Der Deckel ist hier bewusst KEIN K.o.: sonst
      // bleibt am Monatsende ein Rest Sollstunden liegen und es entsteht gar
      // kein Plan. Ein Tag mit einer Person zu viel ist besser als kein Plan –
      // er wird in der Auswertung als Abweichung ausgewiesen. Die Strafe sorgt
      // dafür, dass das die allerletzte Wahl bleibt.
      hours = laenge(maxHours);
      if (Number.isFinite(peakCap)) peakPenalty = 60;
    }
    if (hours === 0) continue; // hier passt keine gültige Schicht

    // Harte Regel. Früher gab es hier einen Ausweichtag, der diese Prüfung
    // übersprungen hat – dabei entstanden lautlos Pläne mit bis zu 28
    // Arbeitstagen am Stück. Lieber gar keinen Plan als einen unzulässigen:
    // ohne gültigen Tag bleibt das Soll offen und generateSchedule wirft.
    const runLength = consecutiveRunLengthWith(worked, isoDate);
    if (runLength > 6) continue;

    const ds = state.dateState.get(isoDate)!;
    const deficitHours = (state.rawTarget.get(isoDate)! - ds.totalPaid) / 60;
    const dayWeight = DAY_WEIGHTS[state.effKeyOf(isoDate)];

    // Ein Tag ohne zweite Person wiegt schwerer als ein Tag, dem nur noch
    // Stunden fehlen. Ohne diesen Bonus jagt der Scheduler nur der Stundenzahl
    // hinterher und lässt halbe Monate mit Ein-Personen-Tagen zurück.
    const staffingBonus = bodiesMissing * 15;

    // Der Tag braucht noch einen langen Dienst, dieser hier ist aber zu kurz:
    // dann soll er lieber woanders hin und der Tag auf jemanden warten, der
    // die Länge liefern kann. Ohne das füllt der erste beste Kurzdienst die
    // Stunden des Tages auf und die Stoßzeit ist nicht mehr zu retten.
    const shapePenalty = stillNeedsLong > 0 && hours < stillNeedsLong ? 12 : 0;

    const consecutivePenalty = runLength >= 5 ? (runLength - 4) * 8 : 0;
    const weekendPenalty = isWeekend(isoDate) ? weekendCount * 1.5 : 0;

    const jitter = state.rng() * 0.01; // deterministisch (seeded), nur Tie-Break

    // Kräftig genug, um den Tag gegen einen anderen mit mehr offenen Stunden
    // zu gewinnen: ein leerer Block heißt offener Laden ohne Personal.
    const blockBonus = fuellDenBlock ? 25 : 0;

    const score =
      deficitHours * 10 +
      staffingBonus +
      blockBonus +
      dayWeight * 3 -
      shapePenalty -
      peakPenalty -
      consecutivePenalty -
      weekendPenalty +
      jitter;

    if (score > bestScore) {
      bestScore = score;
      bestDate = isoDate;
      bestHours = hours;
      bestBlock = fuellDenBlock ? leererBlock! : undefined;
    }
  }

  if (bestDate === null || bestHours === 0) return false;

  const shift = makeShift(state, employee, bestDate, bestHours * 60, bestBlock);
  applyShift(state, shift);
  state.remaining.set(employee.id, remaining - shift.paidMinutes);
  return true;
}

/**
 * Darf sich die Abdeckung eines Tages so verändern?
 *
 * Erlaubt ist alles, was die geforderte Abdeckung weiter trägt – und bei
 * Tagen, die sie ohnehin nicht erreichen, alles, was nichts verschlimmert.
 * Ohne diese Schranke räumt der Reparaturlauf die Stoßzeit wieder ab: er
 * optimiert nur die Tagesstunden und schiebt fröhlich einen zu kurzen Dienst
 * auf einen Tag, der die Länge braucht.
 */
function peakCapacityOk(required: number, oldCount: number, newCount: number): boolean {
  return newCount >= Math.min(required, oldCount);
}

/** Kosten eines Tages = |zugewiesene - rohe Soll-Minuten|. */
function dateCost(state: SchedulerState, isoDate: string): number {
  return Math.abs(
    state.dateState.get(isoDate)!.totalPaid - state.rawTarget.get(isoDate)!,
  );
}

function removeShift(state: SchedulerState, shift: Shift): void {
  const ds = state.dateState.get(shift.date)!;
  ds.totalPaid -= shift.paidMinutes;
  if (shift.shiftType === "LATE") ds.latePaid -= shift.paidMinutes;
  ds.count -= 1;
  state.worked.get(shift.employeeId)!.delete(shift.date);
  if (isWeekend(shift.date)) {
    state.weekendCount.set(
      shift.employeeId,
      (state.weekendCount.get(shift.employeeId) ?? 0) - 1,
    );
  }
  const idx = state.shifts.indexOf(shift);
  // Ohne diese Prüfung würde splice(-1, 1) die LETZTE Schicht löschen und das
  // Monats-Soll lautlos reißen.
  if (idx < 0) {
    throw new Error("removeShift: Schicht ist nicht (mehr) im Plan");
  }
  state.shifts.splice(idx, 1);
}

/**
 * Reparaturlauf: verschiebt einzelne Schichten auf andere Tage, wenn dadurch
 * die Tagesnachfrage besser getroffen wird. Ändert nie die Dauer eines Tokens
 * und verletzt nie die harten Regeln => Sollstunden bleiben exakt erhalten.
 */
function repairDemand(state: SchedulerState, employeesById: Map<string, Employee>): void {
  const MAX_PASSES = 6;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;
    // Kopie, da wir state.shifts während der Iteration verändern.
    for (const shift of [...state.shifts]) {
      const employee = employeesById.get(shift.employeeId)!;
      const from = shift.date;
      const worked = state.worked.get(employee.id)!;

      let bestTarget: string | null = null;
      let bestDelta = -1e-6; // nur echte Verbesserungen

      const oldCostFrom = dateCost(state, from);

      const presence = presenceFromPaid(shift.paidMinutes);
      for (const to of state.dates) {
        if (to === from || worked.has(to)) continue;
        if (!tagErlaubt(state, employee, to, from)) continue; // fester freier Tag / Wochendeckel
        const day = state.dayOf(to);
        if (day.closed || windowLength(day) < presence) continue; // geschlossen / passt nicht
        // 6-Tage-Regel prüfen, als ob "from" bereits entfernt wäre.
        const trial = new Set(worked);
        trial.delete(from);
        if (consecutiveRunLengthWith(trial, to) > 6) continue;

        // Die Stoßzeit darf durch einen Umzug nicht schlechter besetzbar werden.
        const hoursFrom = dayPaidHours(state, from);
        const hoursTo = dayPaidHours(state, to);
        const moved = shift.paidMinutes / 60;
        const withoutMoved = hoursFrom.filter((_, i) => i !== hoursFrom.indexOf(moved));
        if (
          !peakCapacityOk(
            coverSize(state, from),
            coverFilledFor(state, from, hoursFrom),
            coverFilledFor(state, from, withoutMoved),
          )
        ) {
          continue;
        }
        if (
          !peakCapacityOk(
            coverSize(state, to),
            coverFilledFor(state, to, hoursTo),
            coverFilledFor(state, to, [...hoursTo, moved]),
          )
        ) {
          continue;
        }

        const oldCostTo = dateCost(state, to);
        const newCostFrom = Math.abs(
          state.dateState.get(from)!.totalPaid - shift.paidMinutes - state.rawTarget.get(from)!,
        );
        const newCostTo = Math.abs(
          state.dateState.get(to)!.totalPaid + shift.paidMinutes - state.rawTarget.get(to)!,
        );
        const delta = newCostFrom + newCostTo - (oldCostFrom + oldCostTo);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestTarget = to;
        }
      }

      if (bestTarget) {
        removeShift(state, shift);
        applyShift(state, makeShift(state, employee, bestTarget, shift.paidMinutes));
        improved = true;
      }
    }
    if (trySwaps(state, employeesById)) improved = true;
    if (!improved) break;
  }
}

/**
 * Tauscht zwei Schichten zwischen zwei Tagen (verschiedene Mitarbeiter).
 *
 * Warum zusätzlich zum Umzug: ein Umzug verschiebt immer den GANZEN Block –
 * bei Schichten von 3..9 h springt das Tages-Soll dadurch grob. Ein Tausch
 * verschiebt nur die Differenz der beiden Längen (z.B. 9 h gegen 7 h = 2 h)
 * und trifft die Tagesnachfrage deutlich feiner.
 *
 * Wie der Umzug ändert der Tausch keine Dauer und verletzt keine harte Regel
 * => jedes Monats-Soll bleibt exakt erhalten.
 */
/**
 * Dürfen diese zwei Dienste die Tage tauschen, ohne eine harte Regel zu brechen?
 *
 * `allowSameEmployee` erlaubt den Sonderfall, dass BEIDE Dienste derselben
 * Person gehören. Dann tauschen faktisch nur die Längen zwischen zwei ihrer
 * Arbeitstage: die Arbeitstage selbst bleiben dieselben, also können weder die
 * Ein-Dienst-pro-Tag-Regel noch die Sechs-Tage-Regel verletzt werden. Für die
 * Stoßzeiten-Reparatur ist das der wichtigste Zug überhaupt – ein Tag, dem ein
 * langer Dienst fehlt, findet unter fremden Diensten oft keinen Spender, wohl
 * aber unter den eigenen Tagen desselben Mitarbeiters.
 */
/**
 * Darf diese Person an diesem Datum überhaupt stehen?
 *
 * Zwei Regeln des Betriebs, die nichts mit der Rechnung zu tun haben: feste
 * Wochentage ("kommt nur Freitag und Sonntag") und eine Höchstzahl an Tagen je
 * Woche ("arbeitet fünf Tage"). Beide müssen an JEDER Stelle gelten, die einen
 * Termin vergibt – beim ersten Verteilen genauso wie beim Verschieben und
 * Tauschen. Bei einer anderen Filiale standen solche Regeln nur im ersten
 * Schritt, und die Reparaturläufe danach haben sie klaglos wieder aufgehoben.
 *
 * `statt` ist der Tag, den die Person im selben Zug abgibt; er zählt beim
 * Wochenkontingent nicht mehr mit.
 */
function tagErlaubt(
  state: SchedulerState,
  employee: Employee,
  isoDate: string,
  statt?: string,
): boolean {
  if (!mayWorkOn(employee, isoDate)) return false;

  const grenze = employee.maxDaysPerWeek;
  if (!grenze) return true;
  const woche = weekStartOf(isoDate);
  let n = 0;
  for (const d of state.worked.get(employee.id) ?? []) {
    if (d === statt || d === isoDate) continue;
    if (weekStartOf(d) === woche) n++;
  }
  return n < grenze;
}

/**
 * Wie tagErlaubt, aber mit einer PROBE-Belegung statt des echten Standes –
 * fuer die Tempo-Rechnung, die den Monat gedanklich schon einmal durchspielt.
 */
function tagErlaubtMitProbe(
  employee: Employee,
  isoDate: string,
  probe: Set<string>,
): boolean {
  if (!mayWorkOn(employee, isoDate)) return false;
  const grenze = employee.maxDaysPerWeek;
  if (!grenze) return true;
  const woche = weekStartOf(isoDate);
  let n = 0;
  for (const d of probe) if (weekStartOf(d) === woche) n++;
  return n < grenze;
}

function canSwap(state: SchedulerState, a: Shift, b: Shift, allowSameEmployee = false): boolean {
  if (a.date === b.date) return false;

  const empA = state.byId.get(a.employeeId);
  const empB = state.byId.get(b.employeeId);
  if (empA && !tagErlaubt(state, empA, b.date, a.date)) return false;
  if (empB && !tagErlaubt(state, empB, a.date, b.date)) return false;

  const sameEmployee = a.employeeId === b.employeeId;
  if (sameEmployee && !allowSameEmployee) return false; // sonst wäre es ein Umzug

  if (!sameEmployee) {
    const workedA = state.worked.get(a.employeeId)!;
    const workedB = state.worked.get(b.employeeId)!;
    // Höchstens ein Dienst pro Mitarbeiter und Tag.
    if (workedA.has(b.date) || workedB.has(a.date)) return false;

    // 6-Tage-Regel für beide, jeweils ohne den eigenen alten Tag.
    const trialA = new Set(workedA);
    trialA.delete(a.date);
    if (consecutiveRunLengthWith(trialA, b.date) > 6) return false;
    const trialB = new Set(workedB);
    trialB.delete(b.date);
    if (consecutiveRunLengthWith(trialB, a.date) > 6) return false;
  }

  // Die getauschten Längen müssen in das jeweilige Fenster passen.
  if (windowLength(state.dayOf(a.date)) < presenceFromPaid(b.paidMinutes)) return false;
  if (windowLength(state.dayOf(b.date)) < presenceFromPaid(a.paidMinutes)) return false;

  return true;
}

/** Führt den Tausch aus: a wandert auf b.date, b auf a.date. Dauer bleibt. */
function performSwap(
  state: SchedulerState,
  a: Shift,
  b: Shift,
  employeesById: Map<string, Employee>,
): void {
  const empA = employeesById.get(a.employeeId)!;
  const empB = employeesById.get(b.employeeId)!;
  const dateA = a.date;
  const dateB = b.date;
  const paidA = a.paidMinutes;
  const paidB = b.paidMinutes;
  removeShift(state, a);
  removeShift(state, b);
  applyShift(state, makeShift(state, empA, dateB, paidA));
  applyShift(state, makeShift(state, empB, dateA, paidB));
}

/**
 * Zweiter Reparaturlauf, diesmal ausschließlich für die Stoßzeit.
 *
 * repairDemand optimiert nur die Tagesstunden. Ein Tag kann damit rechnerisch
 * genau richtig liegen und die Stoßzeit trotzdem nicht besetzen – etwa 16 h
 * als 7 h + 9 h statt 8 h + 8 h. Von selbst repariert sich das nie, weil jeder
 * Tausch, der die Form verbessert, die Stundenbilanz leicht verschlechtert und
 * deshalb dort abgelehnt wird.
 *
 * Hier gilt die umgekehrte Priorität: ein Tag ohne genug lange Dienste tauscht
 * einen kurzen gegen einen langen von einem Tag, der ihn entbehren kann. Die
 * Stundenverschiebung wird bewusst in Kauf genommen – die Stoßzeiten-Regel ist
 * eine Vorgabe des Betriebs, die Tagesgewichtung nur ein Richtwert.
 */
function repairPeakCapacity(state: SchedulerState, employeesById: Map<string, Employee>): void {
  const MAX_PASSES = 4;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;

    for (const isoDate of state.dates) {
      const needHours = missingCoverHours(state, isoDate);
      if (needHours === 0) continue; // Tag ist versorgt

      // Kürzeste zuerst hergeben: die reißt die geringste Lücke.
      const tooShort = state.shifts
        .filter((s) => s.date === isoDate && s.paidMinutes < needHours * 60)
        .sort((x, y) => x.paidMinutes - y.paidMinutes);

      let swapped = false;
      for (const short of tooShort) {
        for (const long of [...state.shifts]) {
          if (long.date === isoDate) continue;
          if (long.paidMinutes < needHours * 60) continue; // taugt hier nicht

          // Der abgebende Tag darf dadurch nicht selbst unterversorgt werden.
          const donorHours = dayPaidHours(state, long.date);
          const afterDonor = donorHours
            .filter((_, i) => i !== donorHours.indexOf(long.paidMinutes / 60))
            .concat(short.paidMinutes / 60);
          if (
            !peakCapacityOk(
              coverSize(state, long.date),
              coverFilledFor(state, long.date, donorHours),
              coverFilledFor(state, long.date, afterDonor),
            )
          ) {
            continue;
          }

          // Auch Tausche innerhalb derselben Person sind hier erlaubt.
          if (!canSwap(state, short, long, true)) continue;

          performSwap(state, short, long, employeesById);
          improved = true;
          swapped = true;
          break;
        }
        if (swapped) break;
      }
    }

    if (!improved) break;
  }
}

function trySwaps(state: SchedulerState, employeesById: Map<string, Employee>): boolean {
  let improved = false;
  const snapshot = [...state.shifts];

  for (let i = 0; i < snapshot.length; i++) {
    const a = snapshot[i];
    if (!state.shifts.includes(a)) continue; // schon getauscht
    for (let j = i + 1; j < snapshot.length; j++) {
      const b = snapshot[j];
      if (!state.shifts.includes(b)) continue;
      if (a.date === b.date) continue; // gleicher Tag => keine Wirkung
      if (a.paidMinutes === b.paidMinutes) continue; // gleiche Länge => keine Wirkung
      if (a.employeeId === b.employeeId) continue; // das wäre ein Umzug

      const empA = employeesById.get(a.employeeId)!;
      const empB = employeesById.get(b.employeeId)!;
      const workedA = state.worked.get(empA.id)!;
      const workedB = state.worked.get(empB.id)!;
      // Harte Regel: höchstens ein Dienst pro Mitarbeiter und Tag.
      if (workedA.has(b.date) || workedB.has(a.date)) continue;

      // Feste Wochentage und Wochendeckel gelten auch beim Tauschen. Ohne das
      // schob dieser Lauf die Aushilfe, die nur Freitag und Sonntag kommt,
      // klaglos auf einen Donnerstag.
      if (!tagErlaubt(state, empA, b.date, a.date)) continue;
      if (!tagErlaubt(state, empB, a.date, b.date)) continue;

      // Die getauschten Längen müssen in das jeweilige Fenster passen.
      const dayA = state.dayOf(a.date);
      const dayB = state.dayOf(b.date);
      if (windowLength(dayA) < presenceFromPaid(b.paidMinutes)) continue;
      if (windowLength(dayB) < presenceFromPaid(a.paidMinutes)) continue;

      // 6-Tage-Regel für beide prüfen, jeweils ohne den eigenen alten Tag.
      const trialA = new Set(workedA);
      trialA.delete(a.date);
      if (consecutiveRunLengthWith(trialA, b.date) > 6) continue;
      const trialB = new Set(workedB);
      trialB.delete(b.date);
      if (consecutiveRunLengthWith(trialB, a.date) > 6) continue;

      // Auch der Tausch darf die Stoßzeit nicht abräumen: a landet auf b.date
      // und umgekehrt, die Längen wandern also mit.
      const hoursA = dayPaidHours(state, a.date);
      const hoursB = dayPaidHours(state, b.date);
      const pa = a.paidMinutes / 60;
      const pb = b.paidMinutes / 60;
      const nextA = hoursA.filter((_, i) => i !== hoursA.indexOf(pa)).concat(pb);
      const nextB = hoursB.filter((_, i) => i !== hoursB.indexOf(pb)).concat(pa);
      if (
        !peakCapacityOk(
          coverSize(state, a.date),
          coverFilledFor(state, a.date, hoursA),
          coverFilledFor(state, a.date, nextA),
        )
      ) {
        continue;
      }
      if (
        !peakCapacityOk(
          coverSize(state, b.date),
          coverFilledFor(state, b.date, hoursB),
          coverFilledFor(state, b.date, nextB),
        )
      ) {
        continue;
      }

      const dsA = state.dateState.get(a.date)!;
      const dsB = state.dateState.get(b.date)!;
      const targetA = state.rawTarget.get(a.date)!;
      const targetB = state.rawTarget.get(b.date)!;
      const oldCost =
        Math.abs(dsA.totalPaid - targetA) + Math.abs(dsB.totalPaid - targetB);
      const newCost =
        Math.abs(dsA.totalPaid - a.paidMinutes + b.paidMinutes - targetA) +
        Math.abs(dsB.totalPaid - b.paidMinutes + a.paidMinutes - targetB);
      if (newCost >= oldCost - 1e-6) continue; // nur echte Verbesserungen

      const dateA = a.date;
      const dateB = b.date;
      const paidA = a.paidMinutes;
      const paidB = b.paidMinutes;
      removeShift(state, a);
      removeShift(state, b);
      applyShift(state, makeShift(state, empA, dateB, paidA));
      applyShift(state, makeShift(state, empB, dateA, paidB));
      improved = true;
      break; // a existiert nicht mehr – mit dem nächsten a weitermachen
    }
  }

  return improved;
}

/** Dreht NUR Früh/Spät um. Dauer bleibt gleich => Monats-Soll bleibt exakt. */
function retypeShift(state: SchedulerState, shift: Shift, type: TemplateType): void {
  if (shift.shiftType === type) return;
  const block = blockForShift(
    state.dayOf(shift.date).blocks,
    presenceFromPaid(shift.paidMinutes),
    type,
  );
  const tpl = getShiftTemplate(
    shift.paidMinutes / 60,
    type,
    block.startMinutes,
    block.endMinutes,
    state.byId.get(shift.employeeId)?.employmentType,
  );
  const ds = state.dateState.get(shift.date)!;

  if (shift.shiftType === "LATE") ds.latePaid -= shift.paidMinutes;
  shift.startMinutes = tpl.startMinutes;
  shift.endMinutes = tpl.endMinutes;
  shift.pauseMinutes = tpl.pauseMinutes;
  shift.shiftType = tpl.type;
  if (tpl.type === "LATE") ds.latePaid += shift.paidMinutes;
}

/**
 * Wie viele Personen zu viel stünden in der Stoßzeit, wenn dieser Tag GENAU
 * diese Schichtlängen hätte – plus die Lücken, die er dann nicht mehr decken
 * könnte.
 *
 * Gezählt wird nach LÄNGE, nicht nach Uhrzeit: ein Dienst, der länger ist als
 * die Lücke neben dem Fenster, ragt zwangsläufig hinein, egal wohin man ihn
 * schiebt. Genau deshalb hilft Umsortieren an solchen Tagen nicht mehr.
 *
 * Die Funktion rechnet nur, sie ändert nichts. Das ist Absicht: so lässt sich
 * ein Tausch bewerten, BEVOR er ausgeführt wird. Der frühere Ansatz – tauschen,
 * messen, notfalls zurücktauschen – ist daran gescheitert, dass performSwap die
 * alten Schicht-Objekte durch neue ersetzt; das Zurücktauschen griff dann ins
 * Leere.
 */
function dayPeakScore(state: SchedulerState, isoDate: string, paidHours: number[]): number {
  const day = state.dayOf(isoDate);
  if (day.closed) return 0;

  let score = 0;
  for (const peak of state.peaksOf(isoDate)) {
    const dodge = dodgeLimitMinutes(day.blocks, peak);
    const drin = paidHours.filter((h) => presenceFromPaid(h * 60) > dodge).length;
    score += Math.max(0, drin - peak.maxStaff);
  }

  const fehlt = coverSize(state, isoDate) - coverFilledFor(state, isoDate, paidHours);
  return score + Math.max(0, Number.isFinite(fehlt) ? fehlt : 0);
}

/** Liste ohne EIN Vorkommen von wert (nicht ohne alle). */
function ohneEins(werte: number[], wert: number): number[] {
  const out = [...werte];
  const i = out.indexOf(wert);
  if (i >= 0) out.splice(i, 1);
  return out;
}

/**
 * Dritter Reparaturlauf: Tage, an denen zu VIELE Leute in der Stoßzeit stehen.
 *
 * repairPeakCapacity kümmert sich um das Gegenteil (zu wenige). Beides über
 * einen Kamm zu scheren ginge nicht: dort wird ein kurzer Dienst gegen einen
 * langen getauscht, hier genau andersherum.
 *
 * Getauscht werden nur DATEN, die Dauer bleibt bei der Person – das Monats-Soll
 * bleibt also unangetastet. Ein Tausch wird nur ausgeführt, wenn er die Summe
 * beider betroffener Tage verbessert; einen Tag zu heilen und dafür den anderen
 * zu zerlegen bringt nichts.
 */
function repairPeakExcess(state: SchedulerState, employeesById: Map<string, Employee>): void {
  const MAX_PASSES = 4;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;

    for (const isoDate of state.dates) {
      const day = state.dayOf(isoDate);
      if (day.closed) continue;
      if (dayPeakScore(state, isoDate, dayPaidHours(state, isoDate)) === 0) continue;

      // Kleinste Ausweichlücke des Tages: darunter passt ein Dienst neben jede
      // Stoßzeit dieses Tages.
      let dodge = Number.POSITIVE_INFINITY;
      for (const peak of state.peaksOf(isoDate)) {
        dodge = Math.min(dodge, dodgeLimitMinutes(day.blocks, peak));
      }
      if (!Number.isFinite(dodge)) continue;

      // Die kürzesten der zu langen Dienste zuerst hergeben: für die findet
      // sich am ehesten ein Tauschpartner.
      const zuLang = state.shifts
        .filter((s) => s.date === isoDate && s.endMinutes - s.startMinutes > dodge)
        .sort((x, y) => x.paidMinutes - y.paidMinutes);

      for (const lang of zuLang) {
        const hierJetzt = dayPaidHours(state, isoDate);
        if (dayPeakScore(state, isoDate, hierJetzt) === 0) break;
        if (!state.shifts.includes(lang)) continue; // schon weggetauscht

        const kurz = state.shifts
          .filter((s) => s.date !== isoDate && presenceFromPaid(s.paidMinutes) <= dodge)
          .sort((x, y) => y.paidMinutes - x.paidMinutes); // größter Rest zuerst

        for (const partner of kurz) {
          if (!canSwap(state, lang, partner, true)) continue;

          const dortJetzt = dayPaidHours(state, partner.date);
          const langH = lang.paidMinutes / 60;
          const kurzH = partner.paidMinutes / 60;

          const vorher =
            dayPeakScore(state, isoDate, hierJetzt) +
            dayPeakScore(state, partner.date, dortJetzt);
          const nachher =
            dayPeakScore(state, isoDate, [...ohneEins(hierJetzt, langH), kurzH]) +
            dayPeakScore(state, partner.date, [...ohneEins(dortJetzt, kurzH), langH]);

          if (nachher >= vorher) continue;

          performSwap(state, lang, partner, employeesById);
          improved = true;
          break;
        }
      }
    }

    if (!improved) break;
  }
}

/**
 * Nachlauf über die Schichttypen. Zwei Ziele, in dieser Reihenfolge:
 *  1. Die Spätquote je Tag näher an den Sollwert bringen (vorher schwankte
 *     sie stark, obwohl für alle ruhigen Tage derselbe Wert gilt).
 *  2. Wichtiger als jede Quote: an jedem offenen Tag muss jemand aufsperren
 *     UND jemand zusperren. Vorher kam es vor, dass um 11:00 niemand da war.
 * Es wird ausschließlich der Typ gedreht, nie die Dauer – das Soll bleibt exakt.
 */
function balanceShiftTypes(state: SchedulerState): void {
  for (const isoDate of state.dates) {
    const day = state.dayOf(isoDate);
    if (day.closed) continue;

    const onDay = state.shifts.filter((s) => s.date === isoDate);
    if (onDay.length === 0) continue;

    const ds = state.dateState.get(isoDate)!;
    const desired = LATE_SHIFT_RATIOS[state.effKeyOf(isoDate)];

    // 1. Quote annähern: jeweils die Schicht drehen, die am meisten hilft.
    for (let step = 0; step < onDay.length * 2; step++) {
      if (ds.totalPaid === 0) break;
      let best: Shift | null = null;
      let bestDiff = Math.abs(ds.latePaid / ds.totalPaid - desired);
      for (const s of onDay) {
        const late =
          s.shiftType === "LATE" ? ds.latePaid - s.paidMinutes : ds.latePaid + s.paidMinutes;
        const diff = Math.abs(late / ds.totalPaid - desired);
        if (diff < bestDiff - 1e-9) {
          bestDiff = diff;
          best = s;
        }
      }
      if (!best) break;
      retypeShift(state, best, best.shiftType === "LATE" ? "EARLY" : "LATE");
    }

    // 2. Öffnen/Schließen sichern. Mit nur einer Schicht am Tag geht beides
    //    nicht – dann bleibt es bei der Quote-Entscheidung.
    if (onDay.length < 2) continue;

    const shortestOf = (list: Shift[]) =>
      list.length === 0 ? null : list.reduce((a, b) => (a.paidMinutes <= b.paidMinutes ? a : b));

    let flipped: Shift | null = null;
    if (!onDay.some((s) => s.startMinutes === day.window.startMinutes)) {
      const victim = shortestOf(onDay.filter((s) => s.shiftType === "LATE"));
      if (victim) {
        retypeShift(state, victim, "EARLY");
        flipped = victim;
      }
    }
    if (!onDay.some((s) => s.endMinutes === day.window.endMinutes)) {
      const victim = shortestOf(
        onDay.filter((s) => s.shiftType === "EARLY" && s !== flipped),
      );
      if (victim) retypeShift(state, victim, "LATE");
    }

    // 3. Stoßzeiten absichern (12–13 und 17–19 Uhr, je mindestens 2 Personen).
    //    Vorher deckte dieser Schritt nur einen Messpunkt zur Mittagszeit ab;
    //    der Abend war ungeprüft. Jetzt wird über beide Spannen die KLEINSTE
    //    Besetzung geprüft, nicht ein einzelner Zeitpunkt.
    //
    //    Zur Mechanik: Frühschichten hängen am Öffnen, Spätschichten am
    //    Schließen. Damit deckt jede Frühschicht den Mittag und jede
    //    Spätschicht den Abend; beide Spitzen zugleich schafft nur eine lange
    //    Schicht (8/9 h). Gedreht wird ausschließlich der Typ, nie die Dauer –
    //    das Monats-Soll bleibt exakt. Reicht die Tagesmasse nicht aus, bleibt
    //    eine Lücke bestehen; sie ist in analyzeSchedule sichtbar.
    const hasOpener = () => onDay.some((s) => s.startMinutes === day.window.startMinutes);
    const hasCloser = () => onDay.some((s) => s.endMinutes === day.window.endMinutes);

    for (let guard = 0; guard < onDay.length * 3; guard++) {
      const deficit = peakDeficit(onDay, day.window, state.peaksOf(isoDate));
      if (deficit === 0) break;

      let best: Shift | null = null;
      let bestDeficit = deficit;
      for (const s of onDay) {
        // shiftType kennt zusätzlich "CUSTOM"; erzeugte Schichten sind immer
        // EARLY oder LATE. Für die Probe wird alles andere wie EARLY behandelt.
        const back: TemplateType = s.shiftType === "LATE" ? "LATE" : "EARLY";
        const target: TemplateType = back === "LATE" ? "EARLY" : "LATE";
        retypeShift(state, s, target);
        // Öffnen/Schließen darf die Spitzenreparatur nicht kaputt machen.
        const ok = hasOpener() && hasCloser();
        const next = ok ? peakDeficit(onDay, day.window, state.peaksOf(isoDate)) : Number.POSITIVE_INFINITY;
        retypeShift(state, s, back);
        if (next < bestDeficit) {
          bestDeficit = next;
          best = s;
        }
      }

      if (!best) break; // keine Drehung verbessert noch etwas
      retypeShift(state, best, best.shiftType === "LATE" ? "EARLY" : "LATE");
    }

    // 4. Reicht Drehen nicht, die Dienste im Fenster neu ANORDNEN.
    layoutDayForPeaks(day.blocks, onDay, state.peaksOf(isoDate));
  }
}

/** Verschiebt einen Dienst auf eine neue Startzeit; Dauer bleibt gleich. */
function moveShiftTo(shift: Shift, startMinutes: number): void {
  const presence = shift.endMinutes - shift.startMinutes;
  shift.startMinutes = startMinutes;
  shift.endMinutes = startMinutes + presence;
}

/**
 * Startzeiten, an denen ein Dienst überhaupt etwas Nützliches beiträgt:
 * aufsperren, zusperren, oder eine Stoßzeit vollständig abdecken.
 *
 * Der Dienst muss dabei KOMPLETT in einen Block passen. Über eine
 * Mittagsschließung hinweg gibt es keine Schicht – deshalb wird jeder Block
 * einzeln durchgerechnet.
 */
function candidateStarts(
  shift: Shift,
  blocks: DayBlocks,
  peaks: readonly PeakWindow[],
): number[] {
  const presence = shift.endMinutes - shift.startMinutes;
  const out = new Set<number>();

  for (const block of blocks) {
    const latest = block.endMinutes - presence;
    if (latest < block.startMinutes) continue; // passt nicht in diesen Block

    out.add(block.startMinutes); // am Blockanfang
    out.add(latest); // am Blockende

    for (const peak of peaks) {
      const from = Math.max(peak.startMinutes, block.startMinutes);
      const to = Math.min(peak.endMinutes, block.endMinutes);
      if (to <= from || presence < to - from) continue;
      const lo = Math.max(block.startMinutes, to - presence);
      const hi = Math.min(from, latest);
      if (lo <= hi) {
        out.add(lo);
        out.add(hi);
      }
    }
  }

  return [...out].sort((a, b) => a - b);
}

/**
 * Ordnet die Dienste eines Tages so an, dass beide Stoßzeiten besetzt sind
 * und trotzdem jemand auf- und zusperrt. Dauer und Pause bleiben unangetastet
 * => das Monats-Soll bleibt exakt erhalten.
 *
 * Warum nicht einfach Dienst für Dienst verschieben: das bleibt in einem
 * lokalen Optimum stecken. Beispiel 27.07. – eine 8-h-Frühschicht (10:00 bis
 * 18:30) und zwei 5-h-Spätschichten. Mittags steht nur einer im Laden. Wer
 * die Frühschicht verschieben will, nimmt dem Tag den Aufsperrer, also wird
 * der Zug verworfen; erst wenn VORHER eine Spätschicht auf 10:00 rückt, geht
 * es auf. Ein einzelner Zug kommt dort nie hin.
 *
 * Deshalb: Auf- und Zusperrer werden zuerst festgelegt (alle Paare werden
 * durchprobiert), der Rest wird danach frei eingeplant.
 */
function layoutDayForPeaks(blocks: DayBlocks, onDay: Shift[], peaks: readonly PeakWindow[]): void {
  if (onDay.length < 2) return;
  if (dayDefect(onDay, blocks, peaks) === 0) return; // schon gut
  arrangeForPeaks(blocks, onDay, peaks);
}

/**
 * Der eigentliche Suchlauf – ohne die Abkürzung oben. Wird auch von der
 * Kapazitätsrechnung benutzt, die wissen muss, ob eine Kombination von
 * Schichtlängen überhaupt aufgehen KANN.
 */
function arrangeForPeaks(blocks: DayBlocks, onDay: Shift[], peaks: readonly PeakWindow[]): void {
  if (onDay.length < 2) return;

  const first = blocks[0];
  const last = blocks[blocks.length - 1];

  const starts = onDay.map((s) => s.startMinutes);
  const restore = (list: number[]) => onDay.forEach((s, i) => moveShiftTo(s, list[i]));
  // Aufsperren = Anfang des ERSTEN Blocks, Zusperren = Ende des LETZTEN.
  const opensAndCloses = () =>
    onDay.some((s) => s.startMinutes === first.startMinutes) &&
    onDay.some((s) => s.endMinutes === last.endMinutes);

  let bestStarts = [...starts];
  // Eine Ausgangslage ohne Auf- oder Zusperrer zählt nicht als Lösung.
  let bestDeficit = opensAndCloses() ? dayDefect(onDay, blocks, peaks) : Number.POSITIVE_INFINITY;

  for (let i = 0; i < onDay.length && bestDeficit > 0; i++) {
    // i === j ist ausdrücklich erlaubt: ein Dienst, der das ganze Fenster
    // füllt (bei 10–20 Uhr eine 9-h-Schicht), sperrt auf UND zu. Schließt man
    // diesen Fall aus, findet die Suche nie die billigste Lösung – zwei
    // getrennte Anker kosten hier 8 + 8 h, ein Dienst über alles plus ein
    // frei stehender nur 9 + 6 h.
    for (let j = 0; j < onDay.length && bestDeficit > 0; j++) {
      restore(starts);

      // i sperrt auf, j sperrt zu.
      const closerStart = last.endMinutes - (onDay[j].endMinutes - onDay[j].startMinutes);
      if (closerStart < last.startMinutes) continue; // müsste über die Schließung hinweg
      // Dasselbe am anderen Ende: wer aufsperrt, muss in den ersten Block
      // passen. Di–Fr ist der nur 3,5 h lang, ein längerer Dienst ragte sonst
      // in die Mittagsschließung.
      if (onDay[i].endMinutes - onDay[i].startMinutes > first.endMinutes - first.startMinutes) {
        continue;
      }
      moveShiftTo(onDay[i], first.startMinutes);
      moveShiftTo(onDay[j], closerStart);

      // Alle übrigen Dienste greedy dorthin, wo sie am meisten helfen.
      for (let k = 0; k < onDay.length; k++) {
        if (k === i || k === j) continue;
        let pick = onDay[k].startMinutes;
        let pickDeficit = Number.POSITIVE_INFINITY;
        for (const c of candidateStarts(onDay[k], blocks, peaks)) {
          moveShiftTo(onDay[k], c);
          const d = dayDefect(onDay, blocks, peaks);
          if (d < pickDeficit) {
            pickDeficit = d;
            pick = c;
          }
        }
        moveShiftTo(onDay[k], pick);
      }

      const deficit = dayDefect(onDay, blocks, peaks);
      if (deficit < bestDeficit) {
        bestDeficit = deficit;
        bestStarts = onDay.map((s) => s.startMinutes);
      }
    }
  }

  restore(bestStarts);
}

/**
 * Obergrenze für EINEN Mitarbeiter: wie viele Tage und Stunden im Monat
 * überhaupt möglich sind. Greedy von vorn – an jedem offenen Tag arbeiten,
 * solange die 6-Tage-Regel es zulässt; danach zwingend ein freier Tag.
 * Das ist das Maximum, mehr geht rein rechnerisch nicht.
 */
function monthCapacity(
  dates: string[],
  dayOf: (isoDate: string) => ResolvedDay,
  capHours = MAX_SHIFT_HOURS,
): { openDays: number; maxDays: number; maxMinutes: number } {
  let openDays = 0;
  let maxDays = 0;
  let maxMinutes = 0;
  let run = 0;

  for (const isoDate of dates) {
    const day = dayOf(isoDate);
    if (day.closed) {
      run = 0; // geschlossener Tag zählt als Pause
      continue;
    }
    openDays += 1;
    const hours = Math.min(maxShiftHoursForWindow(windowLength(day)), capHours);
    if (hours < 3) continue; // Fenster zu kurz für die kürzeste Schicht (3 h)

    if (run >= 6) {
      run = 0; // Pflicht-Ruhetag
      continue;
    }
    run += 1;
    maxDays += 1;
    maxMinutes += hours * 60;
  }

  return { openDays, maxDays, maxMinutes };
}

/** Fehlermeldung, die auch sagt WARUM es nicht aufgeht. */
function buildUnmetMessage(
  state: SchedulerState,
  unmet: Employee[],
  dates: string[],
  dayOf: (isoDate: string) => ResolvedDay,
): string {
  const full = monthCapacity(dates, dayOf, PREFERRED_HOURS.VOLLZEIT);

  // Ein Soll unter der kürzesten Schicht ist ein EIGENER Fehlerfall. Vorher
  // fiel er in die Kapazitäts-Erklärung: Wer 2 h eintrug, bekam einen Vortrag
  // über die 6-Tage-Regel und eine Stundendecke von über 200 h – beides half
  // nicht weiter. Der wahre Grund ist schlicht, dass 2 h keine Schicht ergibt.
  const tooSmall = unmet.filter((e) => e.targetMinutes > 0 && e.targetMinutes < MIN_SHIFT_MINUTES);
  if (tooSmall.length === unmet.length) {
    const who = tooSmall
      .map((e) => `${e.name} (${e.targetMinutes / 60}h)`)
      .join(", ");
    return (
      `Định mức quá nhỏ: ${who}. ` +
      `Ca ngắn nhất là ${MIN_SHIFT_MINUTES / 60}h, nên định mức phải từ ` +
      `${MIN_SHIFT_MINUTES / 60}h trở lên. Hãy sửa ở tab Nhân viên.`
    );
  }

  const missing = unmet
    .map((e) => {
      const short = state.remaining.get(e.id)!;
      const done = (e.targetMinutes - short) / 60;
      if (e.targetMinutes < MIN_SHIFT_MINUTES) {
        return `${e.name} ${e.targetMinutes / 60}h (nhỏ hơn ca ngắn nhất ${MIN_SHIFT_MINUTES / 60}h)`;
      }
      const capMin = full.maxMinutes;
      const overCap = e.targetMinutes > capMin ? ` — vượt trần ${capMin / 60}h` : "";
      return `${e.name} chỉ xếp được ${done}h / ${e.targetMinutes / 60}h${overCap}`;
    })
    .join("; ");

  if (full.maxDays === 0) {
    return (
      `Không xếp được ca nào (${missing}). ` +
      `Tháng này có ${full.openDays} ngày mở cửa nhưng khung giờ làm quá ngắn — ` +
      `không đủ cho cả ca ngắn nhất (3h). Hãy nới khung giờ làm ở tab Cài đặt.`
    );
  }

  // maxMinutes ist eine OBERGRENZE (jeden erlaubten Tag die längste Schicht).
  // Der greedy Scheduler erreicht sie nicht immer – daher als Decke formulieren.
  return (
    `Không xếp đủ định mức: ${missing}. ` +
    `Tháng này có ${full.openDays} ngày mở cửa; do quy tắc tối đa 6 ngày làm ` +
    `liên tiếp, mỗi người làm được nhiều nhất ${full.maxDays} ngày — trần lý ` +
    `thuyết ${full.maxMinutes / 60}h/người, thực tế thấp hơn. ` +
    `Hãy giảm định mức, nới khung giờ làm, bớt ngày đóng cửa, hoặc thêm người.`
  );
}

/**
 * Hauptfunktion: erzeugt die Schichten für den Monat.
 * Gibt eine neue Liste generierter Shifts zurück (verändert keine Eingaben).
 */
// ── Zuschlag: Reinigung am Abend (Nacht) und am Sonntag ─────────────────────
// Zwei EIGENE Töpfe neben den Ladenstunden: Reinigung nach Schluss (20:00–23:00,
// Nachtzuschlag) und Reinigung am Sonntag (Sonntagszuschlag). Der Betrieb gibt
// je Person ein eigenes Monats-Soll dafür (nightMinutes / sundayMinutes); die
// App verteilt diese Stunden auf die passenden Tage.
//
// ANNAHMEN, die der Betrieb bestätigen sollte:
//   - Abendreinigung: die Person arbeitet bis 20:00 (Ladenschluss) und dann
//     DURCHGEHEND weiter, höchstens bis 23:00 (aus "tới 11g đêm"). Kein zweiter
//     Dienst, keine Lücke – der schließende Ladendienst wird einfach länger
//     ("ko ngắt ca"). Der Teil nach 20:00 ist der Nachtzuschlag.
//   - Sonntagsreinigung 10:00–20:00, höchstens 8 h je Sonntag; an JEDEM Sonntag
//     des Monats möglich, unabhängig davon, ob der Laden an dem Sonntag öffnet.
//     Sonntags ist der Laden zu, es gibt keinen Ladendienst zum Verlängern –
//     deshalb ist die Sonntagsreinigung ein eigener Dienst (Kategorie SUNDAY).
//   - Die Sechs-Tage-Regel wird für die Reinigung NICHT gesondert geprüft –
//     eine bewusste Vereinfachung dieser ersten Fassung.
const NIGHT_ANCHOR = 20 * 60; // normaler Ladenschluss, an den die Abendreinigung anschließt
const NIGHT_MAX_PAID = 3 * 60; // 20:00–23:00
const SUNDAY_CLEAN_START = 10 * 60;
const SUNDAY_MAX_PAID = 8 * 60;

/** Wählt moeglichst gleichmaessig ueber die Liste verteilte Eintraege. */
function evenlySpaced<T>(items: T[], n: number): T[] {
  if (n >= items.length) return [...items];
  if (n <= 0) return [];
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    out.push(items[Math.round((i * (items.length - 1)) / (n - 1 || 1))]);
  }
  return out;
}

/**
 * Verlängert schließende Ladendienste eines Mitarbeiters über 20:00 hinaus, bis
 * sein Nacht-Soll (nightMinutes) verteilt ist. Ein Dienst, keine Lücke.
 *
 * Bevorzugt Tage, an denen die Person ohnehin schließt; reichen die nicht,
 * werden weitere ihrer Ladendienste zu Schließern umgedreht (retypeShift-Logik
 * von Hand, damit die Ladenstunden exakt bleiben). Der Teil nach 20:00 wird als
 * shift.nightMinutes vermerkt und bringt KEINE zusätzliche Pause.
 */
function extendNightShifts(
  state: SchedulerState,
  emp: Employee,
  dayOf: (iso: string) => ResolvedDay,
): void {
  const ziel = emp.nightMinutes ?? 0;
  if (ziel <= 0) return;

  const closeOf = (iso: string) => dayOf(iso).window.endMinutes;
  // Abendreinigung hängt nur an Tagen mit dem NORMALEN Ladenschluss 20:00 – an
  // einem verkürzten Tag (Override) oder Feiertag gibt es keine Abendreinigung
  // "tới 11g đêm".
  const floors = state.shifts
    .filter(
      (s) =>
        s.employeeId === emp.id &&
        (s.category ?? "FLOOR") === "FLOOR" &&
        weekdayKeyOf(parseIsoDate(s.date)) !== "sunday" &&
        closeOf(s.date) === NIGHT_ANCHOR,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  if (floors.length === 0) return;

  const need = Math.min(floors.length, Math.ceil(ziel / NIGHT_MAX_PAID));

  // Erst die schon vorhandenen Schließer, gleichmäßig übers Monat verteilt.
  const schliesser = floors.filter((s) => s.endMinutes === closeOf(s.date));
  let gewaehlt = evenlySpaced(schliesser, Math.min(need, schliesser.length));
  if (gewaehlt.length < need) {
    // Nicht genug Schließer: weitere Ladendienste zu Schließern umdrehen – aber
    // NUR, wenn der Laden dadurch nicht offen und unbesetzt zurückbleibt. Ein
    // umgedrehter Dienst nimmt der Öffnung seinen Aufsperrer; ohne diese Prüfung
    // stand der Laden morgens um 9:30 leer.
    const gesetzt = new Set(gewaehlt);
    const rest = floors.filter((s) => !gesetzt.has(s) && s.endMinutes !== closeOf(s.date));
    let fehlt = need - gewaehlt.length;
    for (const s of evenlySpaced(rest, rest.length)) {
      if (fehlt <= 0) break;
      const day = dayOf(s.date);
      const tpl = getShiftTemplate(
        s.paidMinutes / 60,
        "LATE",
        day.window.startMinutes,
        day.window.endMinutes,
        emp.employmentType,
      );
      // Probe: die anderen Dienste des Tages plus dieser, umgedreht.
      const andere = state.shifts.filter(
        (x) => x.date === s.date && x !== s && (x.category ?? "FLOOR") === "FLOOR",
      );
      const probe = [
        ...andere,
        { ...s, startMinutes: tpl.startMinutes, endMinutes: tpl.endMinutes },
      ];
      if (uncoveredMinutes(probe, day.blocks) > 0) continue; // würde eine Lücke reißen
      s.startMinutes = tpl.startMinutes;
      s.endMinutes = tpl.endMinutes;
      s.pauseMinutes = tpl.pauseMinutes;
      s.shiftType = tpl.type;
      gewaehlt.push(s);
      fehlt -= 1;
    }
    gewaehlt.sort((a, b) => a.date.localeCompare(b.date));
  }

  let rest = ziel;
  for (let i = 0; i < gewaehlt.length && rest > 0; i++) {
    const proTag = Math.min(NIGHT_MAX_PAID, Math.round(rest / (gewaehlt.length - i) / 15) * 15);
    const chunk = Math.min(proTag > 0 ? proTag : 15, rest, NIGHT_MAX_PAID);
    if (chunk < 15) break;
    const s = gewaehlt[i];
    s.endMinutes += chunk; // durchgehend über 20:00 hinaus
    s.paidMinutes += chunk;
    s.nightMinutes = (s.nightMinutes ?? 0) + chunk;
    rest -= chunk;
  }
}

/**
 * Legt die Sonntagsreinigung (eigene Dienste) für einen Mitarbeiter an und
 * verteilt sie gleichmäßig auf die Sonntage des Monats.
 */
function scheduleSundayCleaning(emp: Employee, sonntage: string[], out: Shift[]): void {
  const ziel = emp.sundayMinutes ?? 0;
  if (ziel <= 0 || sonntage.length === 0) return;
  const noetig = Math.min(sonntage.length, Math.ceil(ziel / SUNDAY_MAX_PAID));
  const gewaehlt = evenlySpaced(sonntage, noetig);
  let rest = ziel;
  for (let i = 0; i < gewaehlt.length && rest > 0; i++) {
    const proTag = Math.min(SUNDAY_MAX_PAID, Math.round(rest / (gewaehlt.length - i) / 15) * 15);
    const paid = Math.min(proTag > 0 ? proTag : 15, rest, SUNDAY_MAX_PAID);
    if (paid < 15) break;
    const pause = calculatePause(paid, emp.employmentType);
    out.push({
      id: nextShiftId(),
      employeeId: emp.id,
      date: gewaehlt[i],
      startMinutes: SUNDAY_CLEAN_START,
      endMinutes: SUNDAY_CLEAN_START + paid + pause,
      pauseMinutes: pause,
      paidMinutes: paid,
      shiftType: "CUSTOM",
      category: "SUNDAY",
      generated: true,
    });
    rest -= paid;
  }
}

/** Reinigung: Abend (Verlängerung) + Sonntag (eigene Dienste), für alle. */
function scheduleZuschlag(
  state: SchedulerState,
  employees: Employee[],
  dates: string[],
  dayOf: (iso: string) => ResolvedDay,
): void {
  // Nur Sonntage, an denen der Laden ZU ist. An einem verkaufsoffenen Sonntag
  // (Ausnahme mit eigenen Zeiten) steht dort schon ein Ladendienst – ein
  // zweiter Reinigungsdienst ab 10:00 würde dieselbe Person doppelt verplanen.
  const sonntage = dates.filter(
    (d) => weekdayKeyOf(parseIsoDate(d)) === "sunday" && dayOf(d).closed,
  );
  for (const emp of employees) {
    extendNightShifts(state, emp, dayOf);
    scheduleSundayCleaning(emp, sonntage, state.shifts);
  }
}

export function generateSchedule(input: GenerateInput): Shift[] {
  shiftIdCounter = 0;
  const { year, month, workHours, employees } = input;
  const holidays = input.holidays ?? publicHolidays(year);
  const overrides = input.overrides ?? {};

  const effKeyOf = (isoDate: string): WeekdayKey => effectiveWeekdayKey(isoDate, holidays);
  const dayOf = (isoDate: string): ResolvedDay => resolveDay(workHours, isoDate, holidays, overrides);
  // Nachfrage-Gewicht: geschlossene Tage tragen 0 (bekommen keine Stunden).
  const weightOf = (isoDate: string): number =>
    dayOf(isoDate).closed ? 0 : DAY_WEIGHTS[effKeyOf(isoDate)];

  const dates = datesOfMonth(year, month);
  const totalTargetMin = employees.reduce((sum, e) => sum + e.targetMinutes, 0);
  const totalWeight = dates.reduce((sum, d) => sum + weightOf(d), 0);

  // Erst der Boden für die Stoßzeit, dann die Gewichtung auf den Rest.
  // Reicht die Gesamtsumme nicht einmal für den Boden, wird rein nach Gewicht
  // verteilt – dann ist der Monat für die Stoßzeiten-Regel schlicht zu dünn
  // besetzt, und das Dashboard weist die Lücken aus.
  const floors = new Map<string, number>();
  let totalFloor = 0;
  for (const d of dates) {
    const f = peakFloorMinutes(dayOf(d), PEAK_WINDOWS_BY_WEEKDAY[effKeyOf(d)]);
    floors.set(d, f);
    totalFloor += f;
  }

  const rawTarget = new Map<string, number>();
  const spare = totalTargetMin - totalFloor;
  for (const d of dates) {
    if (totalWeight <= 0) {
      rawTarget.set(d, 0);
    } else if (spare >= 0) {
      rawTarget.set(d, floors.get(d)! + (spare * weightOf(d)) / totalWeight);
    } else {
      rawTarget.set(d, (totalTargetMin * weightOf(d)) / totalWeight);
    }
  }

  const dateState = new Map<string, DateState>();
  const worked = new Map<string, Set<string>>();
  const weekendCount = new Map<string, number>();
  const remaining = new Map<string, number>();
  for (const d of dates) dateState.set(d, { totalPaid: 0, latePaid: 0, count: 0 });
  for (const e of employees) {
    worked.set(e.id, new Set());
    weekendCount.set(e.id, 0);
    remaining.set(e.id, e.targetMinutes);
  }

  const seed =
    input.seed ??
    `${year}-${month}-${employees.map((e) => `${e.id}:${e.targetMinutes}`).join("|")}`;

  const employeesById = new Map(employees.map((e) => [e.id, e] as const));
  const ordered = orderedEmployees(employees);
  const n = ordered.length;

  /**
   * Ein kompletter Belegungsversuch. varyLengths=true mischt die Schichtlängen
   * (4..8 h statt immer die längste); das ist schöner, kann aber bei knappem
   * Soll die Tage aufbrauchen. Deshalb gibt es den zweiten, strengen Versuch.
   */
  function attempt(varyLengths: boolean, salt = ""): SchedulerState {
    shiftIdCounter = 0;
    const st: SchedulerState = {
      dates,
      byId: new Map(employees.map((e) => [e.id, e])),
      rawTarget,
      dateState: new Map(dates.map((d) => [d, { totalPaid: 0, latePaid: 0, count: 0 }])),
      worked: new Map(employees.map((e) => [e.id, new Set<string>()])),
      weekendCount: new Map(employees.map((e) => [e.id, 0])),
      remaining: new Map(employees.map((e) => [e.id, e.targetMinutes])),
      shifts: [],
      effKeyOf,
      dayOf,
      peaksOf: (isoDate: string) => PEAK_WINDOWS_BY_WEEKDAY[effKeyOf(isoDate)],
      rng: seededRandom(seed + salt),
      varyLengths,
    };

    // Rundenweise, rotierend platzieren: pro Runde eine Schicht je Mitarbeiter,
    // bis jedes Monats-Soll exakt erreicht ist.
    for (let round = 0; ; round++) {
      if (ordered.every((e) => st.remaining.get(e.id)! <= 0)) break;
      let progress = false;
      for (let i = 0; i < n; i++) {
        const emp = ordered[(i + round) % n];
        if (st.remaining.get(emp.id)! <= 0) continue;
        if (placeOneShift(st, emp)) progress = true;
      }
      if (!progress) break; // keine Platzierung mehr möglich
    }
    return st;
  }

  const incomplete = (st: SchedulerState) =>
    employees.some((e) => st.remaining.get(e.id)! > 0);

  // Mehrere Anläufe mit gemischten Längen (jeweils anderer Zufallsstrom).
  // Klappt keiner, wird streng die längste Schicht genommen – damit ist das
  // Ergebnis nie schlechter als ohne Abwechslung.
  let state = attempt(true);
  for (let k = 1; k < 5 && incomplete(state); k++) {
    state = attempt(true, `#${k}`);
  }
  if (incomplete(state)) state = attempt(false);

  const unmet = employees.filter((e) => state.remaining.get(e.id)! > 0);
  if (unmet.length > 0) {
    throw new Error(buildUnmetMessage(state, unmet, dates, dayOf));
  }

  repairDemand(state, employeesById);
  // Erst danach: die Stundenbilanz steht, jetzt die Form für die Stoßzeit.
  repairPeakCapacity(state, employeesById);
  // ... und der umgekehrte Fall: zu viele Leute in der Stoßzeit.
  repairPeakExcess(state, employeesById);
  balanceShiftTypes(state);

  // Reinigung (Nacht + Sonntag) als eigene Dienste anhaengen. Laeuft NACH dem
  // Ladenplan, weil sie eigene Toepfe sind und die Stosszeit-Logik nicht beruehrt.
  scheduleZuschlag(state, employees, dates, dayOf);

  // Stabil sortieren: nach Datum, dann Startzeit, dann Mitarbeiter.
  state.shifts.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startMinutes - b.startMinutes ||
      a.employeeId.localeCompare(b.employeeId),
  );
  return state.shifts;
}
