// ============================================================================
// Verkaufsoffene Sonntage: der Laden hat sonntags zu, öffnet aber bis zu zwölf
// Sonntage im Jahr. Geprüft wird beides – das Kontingent-Rechnen und die
// Folge im Plan: an einem offenen Sonntag darf die Sonntagsreinigung NICHT
// zusätzlich zum Ladendienst stehen.
// ============================================================================

import { describe, expect, it } from "vitest";
import {
  OPEN_SUNDAYS_PER_YEAR,
  isOpenSundayOverride,
  isSunday,
  openSundayOverride,
  openSundaysOfYear,
  sundayWindowOf,
  sundaysOfMonth,
} from "../openSundays";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { DEFAULT_WORK_HOURS, type DateOverride, type OverrideMap } from "../workHours";
import { SAMPLE_EMPLOYEES } from "../sampleData";
import type { Employee, Shift } from "../../types";

const isFloor = (s: Shift) => (s.category ?? "FLOOR") === "FLOOR";

describe("Sonntage eines Monats", () => {
  it("findet alle Sonntage", () => {
    expect(sundaysOfMonth(2026, 9)).toEqual([
      "2026-09-06",
      "2026-09-13",
      "2026-09-20",
      "2026-09-27",
    ]);
  });

  it("erkennt einen Sonntag am Datum", () => {
    expect(isSunday("2026-09-06")).toBe(true);
    expect(isSunday("2026-09-07")).toBe(false);
  });
});

describe("Kontingent", () => {
  const offen = (date: string): DateOverride => openSundayOverride(date, DEFAULT_WORK_HOURS);

  it("zählt nur Sonntage, die mit eigenen Zeiten geöffnet sind", () => {
    const overrides: DateOverride[] = [
      offen("2026-09-06"),
      { date: "2026-09-13", closed: true }, // geschlossen: kein offener Sonntag
      { date: "2026-09-12", closed: false, window: { startMinutes: 600, endMinutes: 900 } }, // Samstag
      offen("2026-10-04"),
      offen("2025-12-21"), // anderes Jahr
    ];
    expect(openSundaysOfYear(overrides, 2026)).toEqual(["2026-09-06", "2026-10-04"]);
  });

  it("erkennt die Form einer Ausnahme, nicht ihre Notiz", () => {
    expect(isOpenSundayOverride(offen("2026-09-06"))).toBe(true);
    expect(isOpenSundayOverride({ date: "2026-09-06", closed: true })).toBe(false);
    expect(isOpenSundayOverride({ date: "2026-09-06", closed: false })).toBe(false);
  });

  it("hat zwölf als Jahresgrenze", () => {
    expect(OPEN_SUNDAYS_PER_YEAR).toBe(12);
  });
});

describe("Uhrzeiten eines offenen Sonntags", () => {
  it("nimmt die Sonntags-Zeile der Arbeitszeiten", () => {
    expect(sundayWindowOf(DEFAULT_WORK_HOURS)).toEqual({
      startMinutes: 9 * 60 + 30,
      endMinutes: 20 * 60,
    });
  });

  it("fällt auf den Samstag zurück, wenn die Sonntags-Zeile leer ist", () => {
    const config = {
      ...DEFAULT_WORK_HOURS,
      perWeekday: { ...DEFAULT_WORK_HOURS.perWeekday, sunday: [] },
    };
    expect(sundayWindowOf(config)).toEqual(sundayWindowOf(DEFAULT_WORK_HOURS));
  });
});

describe("Plan an einem verkaufsoffenen Sonntag", () => {
  // Eine Person mit Sonntagsreinigung – genau die Kombination, die früher
  // doppelt geplant wurde.
  const employees: Employee[] = [
    {
      id: "e1",
      name: "Mai",
      employmentType: "TEILZEIT",
      targetMinutes: 80 * 60,
      sundayMinutes: 8 * 60,
    },
    {
      id: "e2",
      name: "Lan",
      employmentType: "TEILZEIT",
      targetMinutes: 80 * 60,
    },
  ];

  const offenerSonntag = "2026-09-13";
  const overrides: OverrideMap = {
    [offenerSonntag]: openSundayOverride(offenerSonntag, DEFAULT_WORK_HOURS),
  };

  const shifts = generateSchedule({
    year: 2026,
    month: 9,
    workHours: DEFAULT_WORK_HOURS,
    employees,
    overrides,
  });

  it("plant Ladendienste an diesem Sonntag", () => {
    const laden = shifts.filter((s) => s.date === offenerSonntag && isFloor(s));
    expect(laden.length).toBeGreaterThan(0);
  });

  it("legt dort KEINE Sonntagsreinigung dazu", () => {
    const reinigung = shifts.filter(
      (s) => s.date === offenerSonntag && s.category === "SUNDAY",
    );
    expect(reinigung).toEqual([]);
  });

  it("verlegt die Sonntagsreinigung auf geschlossene Sonntage", () => {
    const reinigung = shifts.filter((s) => s.category === "SUNDAY");
    expect(reinigung.length).toBeGreaterThan(0);
    for (const s of reinigung) {
      expect(sundaysOfMonth(2026, 9)).toContain(s.date);
      expect(s.date).not.toBe(offenerSonntag);
    }
  });

  it("erzeugt keine Überschneidung", () => {
    const result = validateSchedule(employees, shifts);
    const echte = result.errors.filter((e) => e.severity !== "warning");
    expect(echte).toEqual([]);
  });
});

describe("Überschneidungs-Prüfung", () => {
  const emp: Employee = {
    id: "e1",
    name: "Mai",
    employmentType: "TEILZEIT",
    targetMinutes: 8 * 60,
    sundayMinutes: 8 * 60,
  };

  const shift = (x: Partial<Shift>): Shift => ({
    id: "s",
    employeeId: "e1",
    date: "2026-09-13",
    startMinutes: 9 * 60 + 30,
    endMinutes: 18 * 60,
    pauseMinutes: 30,
    paidMinutes: 8 * 60,
    shiftType: "EARLY",
    generated: true,
    ...x,
  });

  it("meldet zwei Dienste, die sich am selben Tag überlappen", () => {
    const shifts: Shift[] = [
      shift({ id: "s1" }),
      shift({
        id: "s2",
        category: "SUNDAY",
        startMinutes: 10 * 60,
        endMinutes: 18 * 60 + 30,
        paidMinutes: 8 * 60,
      }),
    ];
    const result = validateSchedule([emp], shifts);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("trùng giờ"))).toBe(true);
  });

  it("lässt zwei Dienste nacheinander durch", () => {
    const shifts: Shift[] = [
      shift({ id: "s1", startMinutes: 9 * 60 + 30, endMinutes: 14 * 60, paidMinutes: 4 * 60 + 30, pauseMinutes: 0 }),
      shift({
        id: "s2",
        category: "SUNDAY",
        startMinutes: 14 * 60,
        endMinutes: 22 * 60,
        pauseMinutes: 30,
        paidMinutes: 7 * 60 + 30,
      }),
    ];
    const result = validateSchedule([emp], shifts);
    expect(result.errors.some((e) => e.message.includes("trùng giờ"))).toBe(false);
  });
});

describe("Ganzer Monat mit offenen Sonntagen", () => {
  // Die echte Belegschaft, zwei offene Sonntage: ein offener Sonntag schiebt
  // sich in eine Woche, die sonst mit dem Samstag endet – die Sechs-Tage-Regel
  // muss trotzdem halten.
  const overrides: OverrideMap = {
    "2026-09-13": openSundayOverride("2026-09-13", DEFAULT_WORK_HOURS),
    "2026-09-27": openSundayOverride("2026-09-27", DEFAULT_WORK_HOURS),
  };

  const shifts = generateSchedule({
    year: 2026,
    month: 9,
    workHours: DEFAULT_WORK_HOURS,
    employees: SAMPLE_EMPLOYEES,
    overrides,
  });

  it("bleibt regelkonform", () => {
    const result = validateSchedule(SAMPLE_EMPLOYEES, shifts);
    const echte = result.errors.filter((e) => e.severity !== "warning");
    expect(echte).toEqual([]);
  });

  it("arbeitet an beiden offenen Sonntagen im Laden", () => {
    for (const iso of Object.keys(overrides)) {
      expect(shifts.some((s) => s.date === iso && isFloor(s))).toBe(true);
      expect(shifts.some((s) => s.date === iso && s.category === "SUNDAY")).toBe(false);
    }
  });
});
