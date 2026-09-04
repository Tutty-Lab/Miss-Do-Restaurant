// ============================================================================
// Die beiden Regeln, die der Betrieb selbst setzt: an welchen Wochentagen
// jemand arbeitet, und wie viele Tage der Woche davon.
//
// Geprüft wird das ENDERGEBNIS, nicht der einzelne Schritt: der Scheduler
// vergibt an mehreren Stellen Termine – beim ersten Verteilen, beim
// Verschieben und beim Tauschen. Bei einer anderen Filiale standen
// Sonderregeln nur im ersten Schritt, und die Reparaturläufe danach haben sie
// klaglos wieder kaputtgemacht.
// ============================================================================

import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { DEFAULT_WORK_HOURS } from "../workHours";
import { weekStartOf } from "../weeks";
import { parseIsoDate, weekdayKeyOf } from "../demand";
import type { Employee } from "../../types";

const YEAR = 2026;

const emp = (
  id: string,
  type: Employee["employmentType"],
  hours: number,
  extra: Partial<Employee> = {},
): Employee => ({ id, name: id, employmentType: type, targetMinutes: hours * 60, ...extra });

const plane = (employees: Employee[], month: number) =>
  generateSchedule({ year: YEAR, month, workHours: DEFAULT_WORK_HOURS, employees });

const voll = (extra: Partial<Employee> = {}) => [
  emp("vz-1", "VOLLZEIT", 160, extra),
  emp("vz-2", "VOLLZEIT", 160),
  emp("tz-1", "TEILZEIT", 90),
  emp("mj-1", "MINIJOB", 40),
  emp("mj-2", "MINIJOB", 40),
  emp("mj-3", "MINIJOB", 40),
  emp("mj-4", "MINIJOB", 35),
];

describe("Feste Arbeitstage", () => {
  for (const month of [8, 9, 10]) {
    it(`tháng ${month}: chỉ xếp vào đúng những thứ đã chọn`, () => {
      const mini = emp("mj-frso", "MINIJOB", 30, {
        availableWeekdays: ["friday", "sunday"],
      });
      const team = [...voll().slice(0, 6), mini];
      const shifts = plane(team, month);

      const seine = shifts.filter((s) => s.employeeId === mini.id);
      expect(seine.length).toBeGreaterThan(0);
      for (const s of seine) {
        const tag = weekdayKeyOf(parseIsoDate(s.date));
        expect(tag, `${s.date} không phải T6 hay CN`).toMatch(/^(friday|sunday)$/);
      }
    });
  }

  it("bỏ trống = làm mọi ngày", () => {
    const team = voll();
    const shifts = plane(team, 8);
    const tage = new Set(
      shifts.filter((s) => s.employeeId === "vz-1").map((s) => weekdayKeyOf(parseIsoDate(s.date))),
    );
    // Ohne Einschränkung darf jeder Wochentag vorkommen – geprüft wird nur,
    // dass die leere Liste NICHT als "arbeitet nie" gelesen wird.
    expect(tage.size).toBeGreaterThan(1);
  });
});

describe("Höchstzahl der Arbeitstage je Woche", () => {
  for (const month of [8, 9, 10]) {
    it(`tháng ${month}: giữ đúng giới hạn ở MỌI tuần`, () => {
      const team = voll({ maxDaysPerWeek: 5 });
      const shifts = plane(team, month);

      const proWoche = new Map<string, number>();
      for (const s of shifts.filter((x) => x.employeeId === "vz-1")) {
        const wk = weekStartOf(s.date);
        proWoche.set(wk, (proWoche.get(wk) ?? 0) + 1);
      }
      const drueber = [...proWoche].filter(([, n]) => n > 5);
      expect(drueber).toEqual([]);
    });
  }

  it("beides zusammen: feste Tage UND ein Wochendeckel", () => {
    const team = [
      ...voll().slice(0, 6),
      emp("tz-x", "TEILZEIT", 60, {
        availableWeekdays: ["tuesday", "wednesday", "thursday", "friday"],
        maxDaysPerWeek: 2,
      }),
    ];
    const shifts = plane(team, 8);
    const seine = shifts.filter((s) => s.employeeId === "tz-x");

    for (const s of seine) {
      expect(weekdayKeyOf(parseIsoDate(s.date))).toMatch(
        /^(tuesday|wednesday|thursday|friday)$/,
      );
    }
    const proWoche = new Map<string, number>();
    for (const s of seine) proWoche.set(weekStartOf(s.date), (proWoche.get(weekStartOf(s.date)) ?? 0) + 1);
    expect([...proWoche].filter(([, n]) => n > 2)).toEqual([]);
  });
});
