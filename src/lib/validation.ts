// ============================================================================
// Validierung des Dienstplans gegen alle geforderten Regeln.
// ============================================================================

import type { Employee, Shift } from "../types";
import { calculatePause } from "./time";
import { maxConsecutiveRun } from "./consecutive";
import { mayWorkOn } from "./availability";
import { weekStartOf } from "./weeks";

export type ValidationError = {
  employeeId?: string;
  date?: string;
  message: string;
  /**
   * "error" = der Plan ist unzulässig und muss korrigiert werden.
   * "warning" = der Plan ist benutzbar, etwas passt nur nicht ideal (z.B. die
   * Reinigungsstunden gehen nicht ganz auf). Fehlt das Feld, gilt "error".
   */
  severity?: "error" | "warning";
};

export type EmployeeSummary = {
  employee: Employee;
  assignedMinutes: number;
  targetMinutes: number;
  diffMinutes: number; // assigned - target
  maxConsecutiveDays: number;
  shiftCount: number;
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
  summaries: EmployeeSummary[];
};

/** Gesetzliche Höchstarbeitszeit je Tag (§ 3 ArbZG), bezahlt, ohne Pause. */
export const MAX_PAID_MINUTES = 9 * 60;
const MAX_CONSECUTIVE_DAYS = 6;

export function validateSchedule(
  employees: Employee[],
  shifts: Shift[],
  combinedTargets = true,
): ValidationResult {
  const errors: ValidationError[] = [];

  // Für Kylan gibt es bewusst KEINE Zahlengrenzen bei der Belegschaft –
  // weder für die Anzahl der Beschäftigten noch eine eigene Stundendecke für
  // Minijobs. Siehe Kommentar in types.ts.
  const shiftsByEmployee = new Map<string, Shift[]>();
  for (const emp of employees) shiftsByEmployee.set(emp.id, []);
  const employeeById = new Map(employees.map((e) => [e.id, e] as const));
  for (const shift of shifts) {
    if (!shiftsByEmployee.has(shift.employeeId)) {
      shiftsByEmployee.set(shift.employeeId, []);
    }
    shiftsByEmployee.get(shift.employeeId)!.push(shift);
  }

  // Regeln je einzelner Schicht.
  for (const shift of shifts) {
    const presence = shift.endMinutes - shift.startMinutes;
    const expectedPaid = presence - shift.pauseMinutes;
    // Only legacy plans exempted their night extension from the paid-hour CAP
    // (die 9-h-Grenze gilt nur für den Ladenteil). Die PAUSE dagegen richtet sich
    // nach der GESAMTEN bezahlten Zeit: wer inkl. Abendreinigung über 6 h kommt,
    // braucht die gesetzliche Pause – sonst stünde ein 10-h-Dienst ohne Pause da.
    const ladenPaid = shift.paidMinutes - (combinedTargets ? 0 : shift.nightMinutes ?? 0);
    const expectedPause = calculatePause(
      shift.paidMinutes,
      employeeById.get(shift.employeeId)?.employmentType,
    );

    if (shift.endMinutes <= shift.startMinutes) {
      errors.push({
        employeeId: shift.employeeId,
        date: shift.date,
        message: `Giờ ra không sau giờ vào (${shift.date}).`,
      });
    }
    if (ladenPaid > MAX_PAID_MINUTES) {
      errors.push({
        employeeId: shift.employeeId,
        date: shift.date,
        message: `Quá 9 giờ công ngày ${shift.date}.`,
      });
    }
    if (shift.paidMinutes !== expectedPaid) {
      errors.push({
        employeeId: shift.employeeId,
        date: shift.date,
        message: `Giờ công không khớp giờ vào/ra/nghỉ ngày ${shift.date}.`,
      });
    }
    if (shift.pauseMinutes !== expectedPause) {
      errors.push({
        employeeId: shift.employeeId,
        date: shift.date,
        message: `Sai giờ nghỉ ngày ${shift.date}: ${shift.pauseMinutes} thay vì ${expectedPause} phút.`,
      });
    }
  }

  const summaries: EmployeeSummary[] = [];

  for (const emp of employees) {
    const empShifts = shiftsByEmployee.get(emp.id) ?? [];

    // Retain the former accounting only when displaying a saved legacy plan.
    const floorShifts = empShifts.filter((s) => (s.category ?? "FLOOR") === "FLOOR");
    const sundayShifts = empShifts.filter((s) => s.category === "SUNDAY");

    // Höchstens EIN Ladendienst pro Tag. Reinigung darf zusätzlich am selben
    // Tag stehen (nach Ladenschluss), zählt hier also nicht mit.
    const seenDates = new Set<string>();
    for (const shift of floorShifts) {
      if (seenDates.has(shift.date)) {
        errors.push({
          employeeId: emp.id,
          date: shift.date,
          message: `Có nhiều hơn một ca ngày ${shift.date}.`,
        });
      }
      seenDates.add(shift.date);
    }

    // Zwei Dienste am selben Tag dürfen sich zeitlich nicht überschneiden.
    // "Höchstens ein Ladendienst pro Tag" allein reicht nicht: die
    // Sonntagsreinigung ist ein eigener Dienst und läge an einem
    // verkaufsoffenen Sonntag sonst unbemerkt über dem Ladendienst.
    const byDate = new Map<string, Shift[]>();
    for (const s of empShifts) {
      const liste = byDate.get(s.date);
      if (liste) liste.push(s);
      else byDate.set(s.date, [s]);
    }
    for (const [date, liste] of byDate) {
      if (liste.length < 2) continue;
      const sortiert = [...liste].sort((a, b) => a.startMinutes - b.startMinutes);
      for (let i = 1; i < sortiert.length; i++) {
        if (sortiert[i].startMinutes < sortiert[i - 1].endMinutes) {
          errors.push({
            employeeId: emp.id,
            date,
            message: `${emp.name}: hai ca trùng giờ ngày ${date}.`,
          });
          break; // eine Meldung je Tag genügt
        }
      }
    }
    // Historical plans retain their original accounting targets, but safety
    // constraints always inspect every actual work date (including Sunday
    // cleaning). Otherwise a legacy plan can appear valid while someone works
    // seven-plus consecutive days.
    const countedShifts = combinedTargets ? empShifts : floorShifts;
    const constraintShifts = empShifts;
    const assignedMinutes = countedShifts.reduce(
      (sum, s) => sum + s.paidMinutes - (combinedTargets ? 0 : s.nightMinutes ?? 0),
      0,
    );
    // Include Sunday in the six-day rule for the new model.
    const maxRun = maxConsecutiveRun(constraintShifts.map((s) => s.date));

    if (combinedTargets) {
      const weeks = new Map<string, number>();
      for (const date of new Set(empShifts.map((s) => s.date))) {
        if (!mayWorkOn(emp, date)) errors.push({ employeeId: emp.id, date,
          message: `${emp.name}: không được làm ngày ${date}.` });
        const week = weekStartOf(date);
        weeks.set(week, (weeks.get(week) ?? 0) + 1);
      }
      for (const [week, count] of weeks) {
        if (emp.maxDaysPerWeek && count > emp.maxDaysPerWeek) errors.push({ employeeId: emp.id,
          message: `${emp.name}: quá ${emp.maxDaysPerWeek} ngày làm trong tuần ${week}.` });
      }
    }

    if (assignedMinutes !== emp.targetMinutes) {
      errors.push({
        employeeId: emp.id,
        message: `${emp.name}: chưa đạt giờ định mức: ${assignedMinutes / 60} h thay vì ${emp.targetMinutes / 60} h.`,
      });
    }
    if (maxRun > MAX_CONSECUTIVE_DAYS) {
      errors.push({
        employeeId: emp.id,
        message: `${emp.name}: làm quá 6 ngày liên tiếp (${maxRun}).`,
      });
    }

    // Reinigungs-Töpfe: nur eine WARNUNG, wenn das Soll nicht genau getroffen
    // wird – die Verteilung ist eine Näherung (Tagesobergrenzen, wenige Sonntage).
    const nightMin = empShifts.reduce((sum, s) => sum + (s.nightMinutes ?? 0), 0);
    const zielNight = emp.nightMinutes ?? 0;
    if (!combinedTargets && nightMin !== zielNight) {
      errors.push({
        employeeId: emp.id,
        severity: "warning",
        message: `${emp.name}: lau chùi buổi tối ${nightMin / 60} h / ${zielNight / 60} h.`,
      });
    }
    const sundayMin = sundayShifts.reduce((sum, s) => sum + s.paidMinutes, 0);
    const zielSunday = emp.sundayMinutes ?? 0;
    if (!combinedTargets && sundayMin !== zielSunday) {
      errors.push({
        employeeId: emp.id,
        severity: "warning",
        message: `${emp.name}: lau chùi chủ nhật ${sundayMin / 60} h / ${zielSunday / 60} h.`,
      });
    }

    summaries.push({
      employee: emp,
      assignedMinutes,
      targetMinutes: emp.targetMinutes,
      diffMinutes: assignedMinutes - emp.targetMinutes,
      maxConsecutiveDays: maxRun,
      shiftCount: empShifts.length,
    });
  }

  // Warnungen machen den Plan nicht ungültig.
  const echteFehler = errors.filter((e) => e.severity !== "warning");
  return { valid: echteFehler.length === 0, errors, summaries };
}
