// ============================================================================
// Der Scheduler gegen drei Monate mit UNTERSCHIEDLICHEN Belegschaften.
//
// Ladendienste (FLOOR) und Reinigung (NIGHT/SUNDAY) sind getrennte Töpfe.
// Die Auswertung (analyze) prüft nur die Ladendienste – Nachfrage, Gewichte
// und Stoßzeiten gelten für den offenen Laden, nicht für die Reinigung.
// ============================================================================

import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { analyzeSchedule } from "../analyze";
import { validateSchedule } from "../validation";
import { maxConsecutiveRun } from "../consecutive";
import { SEED_MONTHS, totalTargetHours } from "../seedData";
import { DEFAULT_WORK_HOURS } from "../workHours";
import { calculatePause } from "../time";
import { PEAK_WINDOWS_BY_WEEKDAY } from "../scheduler";
import { publicHolidays } from "../holidays";
import { effectiveWeekdayKey, resolveDay } from "../workHours";
import type { Shift } from "../../types";

const isFloor = (s: Shift) => (s.category ?? "FLOOR") === "FLOOR";

const runs = SEED_MONTHS.map((seed) => {
  const shifts = generateSchedule({
    year: seed.year,
    month: seed.month,
    workHours: DEFAULT_WORK_HOURS,
    employees: seed.employees,
  });
  const floor = shifts.filter(isFloor);
  const analysis = analyzeSchedule({
    year: seed.year,
    month: seed.month,
    workHours: DEFAULT_WORK_HOURS,
    employees: seed.employees,
    shifts: floor,
  });
  return { seed, shifts, floor, analysis };
});

describe.each(runs)("Seed-Monat: $seed.label", ({ seed, shifts, floor, analysis }) => {
  it("trifft die Summe der Ladensollstunden exakt", () => {
    expect(analysis.totalPaidHours).toBe(totalTargetHours(seed));
  });

  it("trifft jedes einzelne Ladensoll exakt", () => {
    for (const emp of seed.employees) {
      expect(analysis.hoursByEmployee.get(emp.id)).toBe(emp.targetMinutes / 60);
    }
  });

  it("trifft jeden Reinigungs-Topf (Nacht + Sonntag) exakt", () => {
    for (const emp of seed.employees) {
      const night = shifts
        .filter((s) => s.employeeId === emp.id)
        .reduce((sum, s) => sum + (s.nightMinutes ?? 0), 0);
      const sunday = shifts
        .filter((s) => s.employeeId === emp.id && s.category === "SUNDAY")
        .reduce((sum, s) => sum + s.paidMinutes, 0);
      expect(night).toBe(emp.nightMinutes ?? 0);
      expect(sunday).toBe(emp.sundayMinutes ?? 0);
    }
  });

  it("besteht die Validierung ohne harte Fehler", () => {
    const result = validateSchedule(seed.employees, shifts);
    expect(result.errors.filter((e) => e.severity !== "warning")).toEqual([]);
  });

  it("Ladendienste: höchstens 6 aufeinanderfolgende Arbeitstage", () => {
    for (const emp of seed.employees) {
      const dates = floor.filter((s) => s.employeeId === emp.id).map((s) => s.date);
      expect(maxConsecutiveRun(dates)).toBeLessThanOrEqual(6);
    }
  });

  it("Ladendienst 3..9 h, Reinigung ≤ 8 h, jeweils passende Pause", () => {
    const byId = new Map(seed.employees.map((e) => [e.id, e] as const));
    for (const s of shifts) {
      const typ = byId.get(s.employeeId)?.employmentType;
      const ladenPaid = s.paidMinutes - (s.nightMinutes ?? 0);
      // Pause und 9-h-Grenze gelten für den Ladenanteil; die Abendverlängerung
      // bringt keine Pause.
      expect(s.pauseMinutes).toBe(calculatePause(ladenPaid, typ));
      expect(s.endMinutes - s.startMinutes - s.pauseMinutes).toBe(s.paidMinutes);
      if (isFloor(s)) {
        expect(ladenPaid).toBeGreaterThanOrEqual(3 * 60);
        expect(ladenPaid).toBeLessThanOrEqual(9 * 60);
      } else {
        expect(s.paidMinutes).toBeLessThanOrEqual(8 * 60);
      }
    }
  });

  it("lässt den Laden nie offen und unbesetzt (nur Ladendienste zählen)", () => {
    const holidays = publicHolidays(seed.year);
    const proDatum = new Map<string, Shift[]>();
    for (const s of floor) {
      const l = proDatum.get(s.date);
      if (l) l.push(s);
      else proDatum.set(s.date, [s]);
    }
    const luecken: string[] = [];
    for (const [datum, amTag] of proDatum) {
      const day = resolveDay(DEFAULT_WORK_HOURS, datum, holidays, {});
      if (day.closed) continue;
      for (const b of day.blocks) {
        for (let t = b.startMinutes; t < b.endMinutes; t++) {
          const da = amTag.filter((s) => s.startMinutes <= t && s.endMinutes > t).length;
          if (da === 0) {
            luecken.push(`${datum} ${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`);
            break;
          }
        }
      }
    }
    expect(luecken).toEqual([]);
  });

  it("Ladendienst: Beginn ab 9:30, Ende 20:00 (oder Abendverlängerung bis 23:00)", () => {
    for (const s of floor) {
      expect(s.startMinutes).toBeGreaterThanOrEqual(9 * 60 + 30);
      expect(s.endMinutes).toBeLessThanOrEqual((s.nightMinutes ?? 0) > 0 ? 23 * 60 : 20 * 60);
    }
  });

  it("Abendreinigung verlängert einen Dienst über 20:00, Sonntag an Sonntagen", () => {
    for (const s of shifts.filter((x) => (x.nightMinutes ?? 0) > 0)) {
      expect(s.category ?? "FLOOR").toBe("FLOOR");
      expect(s.endMinutes - 20 * 60).toBe(s.nightMinutes);
      expect(s.endMinutes).toBeLessThanOrEqual(23 * 60);
      expect(new Date(`${s.date}T12:00:00Z`).getUTCDay()).not.toBe(0);
    }
    for (const s of shifts.filter((x) => x.category === "SUNDAY")) {
      expect(new Date(`${s.date}T12:00:00Z`).getUTCDay()).toBe(0);
    }
  });

  it("hält in der Stoßzeit die erlaubte Personenzahl ein", () => {
    expect(analysis.peakViolations.length).toBeLessThanOrEqual(seed.maxPeakGaps ?? 0);
  });

  it("Gegenprobe Minute für Minute: Stoßzeit nie unterbesetzt", () => {
    const byDate = new Map<string, Shift[]>();
    for (const s of floor) {
      const list = byDate.get(s.date);
      if (list) list.push(s);
      else byDate.set(s.date, [s]);
    }
    const holidays = publicHolidays(seed.year);
    const bad: string[] = [];
    for (const [date, onDay] of byDate) {
      const day = resolveDay(DEFAULT_WORK_HOURS, date, holidays, {});
      if (day.closed) continue;
      for (const peak of PEAK_WINDOWS_BY_WEEKDAY[effectiveWeekdayKey(date, holidays)]) {
        const from = Math.max(peak.startMinutes, day.window.startMinutes);
        const to = Math.min(peak.endMinutes, day.window.endMinutes);
        for (let t = from; t < to; t++) {
          const staff = onDay.filter((s) => s.startMinutes <= t && s.endMinutes > t).length;
          if (staff < peak.minStaff || staff > peak.maxStaff) {
            bad.push(`${date} ${peak.label}`);
            break;
          }
        }
      }
    }
    expect(new Set(bad.map((b) => b.slice(0, 10))).size).toBeLessThanOrEqual(seed.maxPeakGaps ?? 0);
  });
});

describe("Report", () => {
  it("schreibt die Auswertung auf die Konsole", () => {
    const lines: string[] = [];
    for (const { seed, floor, analysis } of runs) {
      lines.push("");
      lines.push(`=== ${seed.label} ===`);
      lines.push(
        `Mitarbeiter: ${seed.employees.length} · Ladensoll gesamt: ${totalTargetHours(seed)} h · ` +
          `offene Tage: ${analysis.openDays} · Ladendienste: ${floor.length}`,
      );
      const hist = [...analysis.lengthHistogram.entries()].sort((a, b) => a[0] - b[0]);
      lines.push("  " + hist.map(([h, n]) => `${h}h×${n}`).join("  "));
      lines.push(`Stoßzeiten außerhalb der erlaubten Personenzahl: ${analysis.peakViolations.length} Tage`);
    }
    // eslint-disable-next-line no-console
    console.log(lines.join("\n"));
    expect(runs.length).toBe(3);
  });
});
