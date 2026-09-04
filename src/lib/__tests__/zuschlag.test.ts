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

// Eine kleine, gemischte Belegschaft mit Reinigungs-Töpfen. Die Abend-Sollwerte
// sind so gewählt, dass sie mit dieser Besetzung noch aufgehen (genug Tage, an
// denen ein Schließer verlängert werden kann, ohne die Öffnung leer zu lassen).
const team = (): Employee[] => [
  emp("a", "VOLLZEIT", 120, { nightMinutes: 20 * 60, sundayMinutes: 31 * 60 }),
  emp("b", "TEILZEIT", 115, { nightMinutes: 24 * 60, sundayMinutes: 20 * 60 }),
  emp("c", "TEILZEIT", 50, { sundayMinutes: 20 * 60 }),
  emp("d", "TEILZEIT", 90),
  emp("e", "MINIJOB", 40),
];

describe("Zuschlag – Reinigung Abend und Sonntag", () => {
  for (const month of [8, 9, 10]) {
    const shifts = generateSchedule({ year: 2026, month, workHours: DEFAULT_WORK_HOURS, employees: team() });

    it(`tháng ${month}: floor + CN đúng giờ; đêm không vượt (thiếu thì cảnh báo)`, () => {
      const v = validateSchedule(team(), shifts);
      for (const e of team()) {
        const floor = shifts.filter((s) => s.employeeId === e.id && isFloor(s)).reduce((a, s) => a + s.paidMinutes - (s.nightMinutes ?? 0), 0);
        const night = shifts.filter((s) => s.employeeId === e.id).reduce((a, s) => a + (s.nightMinutes ?? 0), 0);
        const sun = shifts.filter((s) => s.employeeId === e.id && s.category === "SUNDAY").reduce((a, s) => a + s.paidMinutes, 0);
        expect(floor).toBe(e.targetMinutes); // Ladensoll immer exakt
        expect(sun).toBe(e.sundayMinutes ?? 0); // Sonntag geht immer auf (Sonntage frei)
        // Abendreinigung ist best effort: nie MEHR als das Soll; wird es nicht
        // ganz getroffen, steht dazu eine Warnung.
        expect(night).toBeLessThanOrEqual(e.nightMinutes ?? 0);
        if ((e.nightMinutes ?? 0) > 0 && night < (e.nightMinutes ?? 0)) {
          const w = v.errors.find((x) => x.employeeId === e.id && x.severity === "warning" && x.message.includes("buổi tối"));
          expect(w).toBeDefined();
        }
      }
    });

    it(`tháng ${month}: ca tối nối liền tới 23h (ko ngắt ca), ca CN đúng vào CN`, () => {
      for (const s of shifts.filter((x) => (x.nightMinutes ?? 0) > 0)) {
        // Một ca FLOOR liền mạch kéo qua 20:00, phần sau là nightMinutes.
        expect(s.category ?? "FLOOR").toBe("FLOOR");
        expect(s.endMinutes - 20 * 60).toBe(s.nightMinutes);
        expect(s.endMinutes).toBeLessThanOrEqual(23 * 60);
        expect(new Date(`${s.date}T12:00:00Z`).getUTCDay()).not.toBe(0);
      }
      for (const s of shifts.filter((x) => x.category === "SUNDAY")) {
        expect(new Date(`${s.date}T12:00:00Z`).getUTCDay()).toBe(0);
      }
    });

    it(`tháng ${month}: ca floor bắt đầu >= 9:30, kết thúc <= 20:00 (hoặc 23:00 nếu có lau đêm)`, () => {
      for (const s of shifts.filter(isFloor)) {
        expect(s.startMinutes).toBeGreaterThanOrEqual(9 * 60 + 30);
        expect(s.endMinutes).toBeLessThanOrEqual((s.nightMinutes ?? 0) > 0 ? 23 * 60 : 20 * 60);
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
