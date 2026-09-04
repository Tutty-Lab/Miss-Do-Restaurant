// ============================================================================
// Reinigung als eigene Töpfe: Abend (Nachtzuschlag, 20:00–23:00) und Sonntag
// (Sonntagszuschlag). Der Betrieb gibt je Person ein eigenes Monats-Soll; die
// App verteilt es und hält es getrennt vom normalen Ladensoll.
// ============================================================================

import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { DEFAULT_WORK_HOURS } from "../workHours";
import type { Employee, Shift } from "../../types";

const isFloor = (s: Shift) => (s.category ?? "FLOOR") === "FLOOR";

const emp = (id: string, t: Employee["employmentType"], h: number, x: Partial<Employee> = {}): Employee => ({
  id, name: id, employmentType: t, targetMinutes: h * 60, ...x,
});

// Eine kleine, gemischte Belegschaft mit Reinigungs-Töpfen.
const team = (): Employee[] => [
  emp("a", "VOLLZEIT", 120, { nightMinutes: 30 * 60, sundayMinutes: 31 * 60 }),
  emp("b", "TEILZEIT", 115, { nightMinutes: 55 * 60, sundayMinutes: 20 * 60 }),
  emp("c", "TEILZEIT", 50, { sundayMinutes: 20 * 60 }),
  emp("d", "TEILZEIT", 90),
  emp("e", "MINIJOB", 40),
];

describe("Zuschlag – Reinigung Abend und Sonntag", () => {
  for (const month of [8, 9, 10]) {
    const shifts = generateSchedule({ year: 2026, month, workHours: DEFAULT_WORK_HOURS, employees: team() });

    it(`tháng ${month}: mỗi top (floor/tối/CN) đúng giờ`, () => {
      for (const e of team()) {
        const floor = shifts.filter((s) => s.employeeId === e.id && isFloor(s)).reduce((a, s) => a + s.paidMinutes, 0);
        const night = shifts.filter((s) => s.employeeId === e.id && s.category === "NIGHT").reduce((a, s) => a + s.paidMinutes, 0);
        const sun = shifts.filter((s) => s.employeeId === e.id && s.category === "SUNDAY").reduce((a, s) => a + s.paidMinutes, 0);
        expect(floor).toBe(e.targetMinutes);
        expect(night).toBe(e.nightMinutes ?? 0);
        expect(sun).toBe(e.sundayMinutes ?? 0);
      }
    });

    it(`tháng ${month}: ca tối 20–23h, ca CN đúng vào chủ nhật`, () => {
      for (const s of shifts.filter((x) => x.category === "NIGHT")) {
        expect(s.startMinutes).toBeGreaterThanOrEqual(20 * 60);
        expect(s.endMinutes).toBeLessThanOrEqual(23 * 60);
        expect(new Date(`${s.date}T12:00:00Z`).getUTCDay()).not.toBe(0);
      }
      for (const s of shifts.filter((x) => x.category === "SUNDAY")) {
        expect(new Date(`${s.date}T12:00:00Z`).getUTCDay()).toBe(0);
      }
    });

    it(`tháng ${month}: ca lau chùi KHÔNG dính vào giờ mở cửa (floor)`, () => {
      // Ladendienst 9:30–20:00; Reinigung liegt außerhalb.
      for (const s of shifts.filter(isFloor)) {
        expect(s.startMinutes).toBeGreaterThanOrEqual(9 * 60 + 30);
        expect(s.endMinutes).toBeLessThanOrEqual(20 * 60);
        expect(new Date(`${s.date}T12:00:00Z`).getUTCDay()).not.toBe(0);
      }
    });

    it(`tháng ${month}: validation không có lỗi cứng`, () => {
      const v = validateSchedule(team(), shifts);
      expect(v.errors.filter((x) => x.severity !== "warning")).toEqual([]);
    });
  }

  it("không đặt giờ lau chùi thì không sinh ca lau chùi", () => {
    const shifts = generateSchedule({
      year: 2026, month: 9, workHours: DEFAULT_WORK_HOURS,
      employees: [emp("x", "TEILZEIT", 90), emp("y", "VOLLZEIT", 120)],
    });
    expect(shifts.every(isFloor)).toBe(true);
  });
});
