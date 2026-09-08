import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StundenzettelPage } from "../../components/StundenzettelPage";
import { emptySchedule } from "../scheduleDefaults";
import type { Employee, Shift } from "../../types";

it("prints all shifts on one date and limits weekly surcharges to the selected dates", () => {
  const employee: Employee = { id: "e", name: "Test", employmentType: "TEILZEIT", targetMinutes: 600 };
  const shift: Shift = { id: "s", employeeId: "e", date: "2026-08-07", startMinutes: 1080,
    endMinutes: 1320, pauseMinutes: 0, paidMinutes: 240, generated: false, shiftType: "CUSTOM" };
  const schedule = { ...emptySchedule(), year: 2026, month: 8, employees: [employee],
    surchargeConfig: { after20Percent: 25, sundayPercent: 50 },
    shifts: [shift, { ...shift, id: "s2", startMinutes: 600, endMinutes: 720, paidMinutes: 120 },
      { ...shift, id: "s3", date: "2026-08-09" }] };
  const html = renderToStaticMarkup(createElement(StundenzettelPage, {
    schedule, employee, dates: ["2026-08-07"], periodLabel: "Woche 03.08.–09.08.2026",
  }));
  expect(html).toContain("Woche 03.08.");
  expect(html).toContain("10:00");
  expect(html).toContain("18:00");
  expect(html).toContain("20:00");
  expect(html).toContain("22:00");
  expect(html).toContain("6,00 h");
  expect(html).toContain("+0,50 h");
  expect(html).not.toContain("09.08.2026</td>");
  expect(html).toContain("0,00 h × 50%");
});
