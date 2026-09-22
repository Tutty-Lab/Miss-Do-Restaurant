import { describe, expect, it } from "vitest";
import { buildTimesheet } from "../stundenzettel";
import { emptySchedule } from "../scheduleDefaults";
import type { Employee, Shift } from "../../types";

const employee: Employee = {
  id: "e1",
  name: "Nguyễn Thị Kiều",
  persNr: "007",
  employmentType: "TEILZEIT",
  targetMinutes: 600,
};

function shift(partial: Partial<Shift> & Pick<Shift, "date" | "startMinutes" | "endMinutes" | "paidMinutes">): Shift {
  return {
    id: `s-${partial.date}-${partial.startMinutes}`,
    employeeId: "e1",
    pauseMinutes: 0,
    generated: false,
    shiftType: "CUSTOM",
    ...partial,
  };
}

// Januar 2026: 31 Tage, 01.01. ist Neujahr (Feiertag).
function janSchedule() {
  return {
    ...emptySchedule(),
    year: 2026,
    month: 1,
    companyName: "Miss Do",
    address: "Beispielstraße 1",
    employees: [employee],
    shifts: [
      // Mo 05.01.: 18–22 Uhr => am 20-Uhr-Punkt in zwei Zeilen gesplittet.
      shift({ date: "2026-01-05", startMinutes: 1080, endMinutes: 1320, paidMinutes: 240 }),
      // Di 06.01.: 10–14 Uhr, eine Zeile.
      shift({ date: "2026-01-06", startMinutes: 600, endMinutes: 840, paidMinutes: 240 }),
    ],
    dateOverrides: [{ date: "2026-01-07", closed: true, note: "Betriebsruhe Test" }],
  };
}

describe("buildTimesheet", () => {
  it("hat eine Zeile je Tag des Monats", () => {
    const sheet = buildTimesheet(janSchedule(), employee);
    expect(sheet.rows).toHaveLength(31);
  });

  it("markiert freie und Feiertage korrekt", () => {
    const sheet = buildTimesheet(janSchedule(), employee);
    const neujahr = sheet.rows[0]; // 01.01.
    expect(neujahr.lines).toHaveLength(0);
    expect(neujahr.rest).toBe("Frei (Feiertag: Neujahr)");
    expect(neujahr.shaded).toBe(true);

    const closed = sheet.rows.find((r) => r.date === "07.01.2026")!;
    expect(closed.lines).toHaveLength(0);
    expect(closed.rest).toBe("Betriebsruhe Test");
    expect(closed.shaded).toBe(true);
  });

  it("splittet einen Dienst nach 20 Uhr in zwei Zeilen mit Nachtbemerkung", () => {
    const sheet = buildTimesheet(janSchedule(), employee);
    const mon = sheet.rows.find((r) => r.date === "05.01.2026")!;
    expect(mon.lines).toHaveLength(2);
    expect(mon.lines[0].start).toBe("18:00");
    expect(mon.lines[0].end).toBe("20:00");
    expect(mon.lines[1].start).toBe("20:00");
    expect(mon.lines[1].end).toBe("22:00");
    expect(mon.lines[1].bemerkung).toContain("Nachtzuschlag");
  });

  it("summiert Stunden und Zuschläge im deutschen Format", () => {
    const sheet = buildTimesheet(janSchedule(), employee);
    expect(sheet.totalMinutes).toBe(480); // 4 h + 4 h
    expect(sheet.totalText).toBe("8,00");
    expect(sheet.nightHoursText).toBe("2,00"); // 20–22 Uhr
    expect(sheet.sundayHoursText).toBe("0,00");
  });

  it("zählt Zuschlags-Termine je Person (Abende / Sonntage)", () => {
    const sheet = buildTimesheet(janSchedule(), employee);
    expect(sheet.nightSessions).toBe(1); // nur der 05.01. hat Arbeit nach 20 Uhr
    expect(sheet.sundaySessions).toBe(0); // kein Sonntagsdienst

    // Mit einem Sonntagsdienst: ein gearbeiteter Sonntag, weiterhin 1 Abend.
    const withSunday = {
      ...janSchedule(),
      shifts: [
        ...janSchedule().shifts,
        {
          id: "so",
          employeeId: "e1",
          date: "2026-01-04", // Sonntag
          startMinutes: 540,
          endMinutes: 780,
          pauseMinutes: 0,
          paidMinutes: 240,
          generated: false,
          shiftType: "CUSTOM" as const,
        },
      ],
    };
    const s2 = buildTimesheet(withSunday, employee);
    expect(s2.sundaySessions).toBe(1);
    expect(s2.nightSessions).toBe(1);
  });

  it("zählt Split-Zeilen für die Seitenanpassung mit", () => {
    const sheet = buildTimesheet(janSchedule(), employee);
    // 31 Tage, davon einer mit 2 Zeilen => 32.
    expect(sheet.lineCount).toBe(32);
  });

  it("beschränkt sich mit dates auf den Wochenausschnitt", () => {
    const week = ["2026-01-05", "2026-01-06", "2026-01-07"];
    const sheet = buildTimesheet(janSchedule(), employee, week, "Woche 05.01.–11.01.2026");
    expect(sheet.rows).toHaveLength(3);
    expect(sheet.periodLabel).toBe("Woche 05.01.–11.01.2026");
    // Nur die drei Tage zählen für die Summe (4 h + 4 h, der 07. ist geschlossen).
    expect(sheet.totalText).toBe("8,00");
  });

  it("füllt Kopf-Infofelder, Sollstunden bleibt leer", () => {
    const sheet = buildTimesheet(janSchedule(), employee);
    const mitarbeiter = sheet.info.find((f) => f.label === "Mitarbeiter");
    expect(mitarbeiter?.value).toBe("Nguyễn Thị Kiều");
    const soll = sheet.info.find((f) => f.label === "Sollstunden");
    expect(soll?.blank).toBe(true);
  });
});
