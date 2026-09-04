// ============================================================================
// Zentrales State-Management (ohne externe Bibliothek). Kapselt Schedule,
// LocalStorage-Persistenz und alle Aktionen (Generieren, Bearbeiten, Reset).
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Employee, EmploymentType, Schedule, Shift } from "../types";
import { generateSchedule } from "../lib/scheduler";
import { analyzeSchedule } from "../lib/analyze";
import { validateSchedule, type ValidationResult } from "../lib/validation";
import { clearState, loadState, saveState, type PersistedState } from "../lib/storage";
import { MIN_PASSWORD_LENGTH, hashPassword, passwordMatches } from "../lib/auth";
import { isRemoteConfigured, loadRemote, saveRemote, type RemoteStatus } from "../lib/remote";
import { createManualShift, updateShiftTimes } from "../lib/shiftOps";
import {
  DEFAULT_WORK_HOURS,
  normalizeWorkHours,
  type DateOverride,
  type OverrideMap,
} from "../lib/workHours";
import { COMPANY_ADDRESS, COMPANY_NAME } from "../lib/company";

/**
 * Steht in diesem Stand überhaupt etwas? Maßstab sind Mitarbeiter und
 * Schichten – Firmenname und Monat allein sind noch kein Inhalt.
 */
function hatInhalt(state: PersistedState): boolean {
  return state.schedule.employees.length > 0 || state.schedule.shifts.length > 0;
}

function emptySchedule(): Schedule {
  const now = new Date();
  return {
    companyName: COMPANY_NAME,
    address: COMPANY_ADDRESS,
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    workHours: structuredClone(DEFAULT_WORK_HOURS),
    dateOverrides: [],
    employees: [],
    shifts: [],
  };
}

/** Ausnahmen-Array -> nach Datum indizierte Map (für den Scheduler). */
function overridesToMap(list: DateOverride[]): OverrideMap {
  const map: OverrideMap = {};
  for (const ov of list) map[ov.date] = ov;
  return map;
}

/** Migriert einen (evtl. alten) gespeicherten Stand auf das aktuelle Schema. */
function normalizeSchedule(raw: Schedule | undefined): Schedule {
  const base = emptySchedule();
  if (!raw) return base;
  return {
    // Firmenname & Adresse sind fest (không cho sửa) – immer erzwingen.
    companyName: COMPANY_NAME,
    address: COMPANY_ADDRESS,
    year: raw.year ?? base.year,
    month: raw.month ?? base.month,
    workHours: normalizeWorkHours(raw.workHours),
    dateOverrides: Array.isArray(raw.dateOverrides) ? raw.dateOverrides : [],
    employees: raw.employees ?? [],
    shifts: raw.shifts ?? [],
    lockedAt: raw.lockedAt,
    printedWeeks: Array.isArray(raw.printedWeeks) ? raw.printedWeeks : [],
  };
}

function newEmployeeId(): string {
  return `emp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export function useSchedule() {
  const [schedule, setSchedule] = useState<Schedule>(() => {
    const persisted = loadState();
    return normalizeSchedule(persisted?.schedule);
  });
  const [passwordHash, setPasswordHash] = useState<string | undefined>(
    () => loadState()?.passwordHash,
  );
  const [originalShifts, setOriginalShifts] = useState<Shift[]>(() => {
    const persisted = loadState();
    return persisted?.originalShifts ?? [];
  });
  const [genError, setGenError] = useState<string | null>(null);
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus>(
    isRemoteConfigured ? "idle" : "off",
  );

  // Immer sofort lokal sichern – das ist der Offline-Puffer.
  useEffect(() => {
    saveState({ schedule, originalShifts, passwordHash });
  }, [schedule, originalShifts, passwordHash]);

  // Letzter Stand für Zugriffe außerhalb des Renders (siehe Erst-Upload).
  const latest = useRef<PersistedState>({ schedule, originalShifts, passwordHash });
  const ersterLauf = useRef(true);
  useEffect(() => {
    latest.current = { schedule, originalShifts, passwordHash };
    // Jede Änderung nach dem ersten Rendern kommt vom Nutzer – solange das
    // Laden noch läuft, ist das der Stand, den er vor sich sieht.
    if (ersterLauf.current) ersterLauf.current = false;
    else if (!hydrated.current) beruehrt.current = true;
  }, [schedule, originalShifts, passwordHash]);

  // Beim Start den Stand der Filiale aus der gemeinsamen Datenbank holen.
  // Vorher darf nicht hochgeladen werden, sonst überschreibt der lokale
  // (evtl. leere) Stand die Daten in der Datenbank.
  const hydrated = useRef(!isRemoteConfigured);
  /** Hat der Nutzer seit dem Start selbst etwas geändert? */
  const beruehrt = useRef(false);
  /** Stand in der Datenbank beim Start etwas drin? */
  const fernHatteInhalt = useRef(false);

  useEffect(() => {
    if (!isRemoteConfigured) return;
    let cancelled = false;
    let timer = 0;

    const versuch = async (anlauf: number): Promise<void> => {
      try {
        const remote = await loadRemote();
        if (cancelled) return;
        if (remote?.schedule) {
          fernHatteInhalt.current =
            (remote.schedule.employees?.length ?? 0) > 0 ||
            (remote.schedule.shifts?.length ?? 0) > 0;
          // Hat der Nutzer inzwischen selbst getippt – etwa weil erst der
          // dritte Anlauf durchkam –, bleibt SEIN Stand stehen. Ihm den
          // Bildschirm unter den Händen zurückzusetzen wäre der sichtbarste
          // Datenverlust von allen.
          if (beruehrt.current) {
            if (hatInhalt(latest.current)) await saveRemote(latest.current);
          } else {
            setSchedule(normalizeSchedule(remote.schedule));
            setOriginalShifts(remote.originalShifts ?? []);
            setPasswordHash(remote.passwordHash);
          }
        } else if (hatInhalt(latest.current)) {
          // Noch keine Zeile für diese Filiale: lokalen Stand hochladen –
          // aber nur, wenn lokal überhaupt etwas drinsteht. Eine leere Zeile
          // anzulegen bringt nichts und macht aus "noch nichts eingetragen"
          // versehentlich einen gespeicherten Leerstand.
          await saveRemote(latest.current);
        }
        if (cancelled) return;
        setRemoteStatus("idle");
        // NUR nach erfolgreichem Lesen darf hochgeladen werden.
        hydrated.current = true;
      } catch {
        if (cancelled) return;
        // Lesen fehlgeschlagen: hydrated bleibt false, es wird NICHTS
        // hochgeladen. Sonst überschreibt der leere lokale Stand die Daten in
        // der Datenbank – genau so ist eine Filiale schon einmal leer geräumt
        // worden: Netzfehler beim Start, danach ein Klick, und weg war alles.
        setRemoteStatus("error");
        // Aber es wird weiter versucht. Ohne diesen Anlauf blieb hydrated die
        // ganze Sitzung false: die App speicherte nur noch lokal und schickte
        // nichts mehr an die Datenbank. Auf dem Handy des Chefs fehlte dann
        // ein ganzer Abend Arbeit – lautlos, denn lokal sah alles richtig aus.
        const wartezeit = Math.min(30_000, 2000 * 2 ** anlauf);
        timer = window.setTimeout(() => void versuch(anlauf + 1), wartezeit);
      }
    };

    void versuch(0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  // Änderungen gebündelt hochladen (nicht bei jedem Tastendruck).
  useEffect(() => {
    if (!isRemoteConfigured || !hydrated.current) return;
    // Ein leerer Stand darf einen vollen nicht im Hintergrund überschreiben.
    // Das ist kein normaler Arbeitsschritt, sondern das Muster des Unfalls:
    // etwas lief beim Laden schief, der Bildschirm ist leer, und eine Sekunde
    // später steht dieser Leerstand in der Datenbank.
    if (fernHatteInhalt.current && !hatInhalt({ schedule, originalShifts, passwordHash })) {
      return;
    }
    const timer = window.setTimeout(() => {
      setRemoteStatus("saving");
      saveRemote({ schedule, originalShifts, passwordHash })
        .then(() => setRemoteStatus("idle"))
        .catch(() => setRemoteStatus("error"));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [schedule, originalShifts, passwordHash]);

  const validation: ValidationResult = useMemo(
    () => validateSchedule(schedule.employees, schedule.shifts),
    [schedule.employees, schedule.shifts],
  );

  /**
   * Tage, an denen eine Stoßzeit unterbesetzt ist.
   *
   * Das ist bewusst KEIN Validierungsfehler: der Plan ist rechnerisch korrekt,
   * es sind schlicht zu wenige Leute im Haus. Vorher fiel das nirgends auf –
   * der Scheduler tut sein Bestes und schweigt, wenn es nicht reicht.
   */
  const peakGaps = useMemo(() => {
    if (schedule.shifts.length === 0) return [];
    return analyzeSchedule({
      year: schedule.year,
      month: schedule.month,
      workHours: schedule.workHours,
      overrides: overridesToMap(schedule.dateOverrides),
      employees: schedule.employees,
      shifts: schedule.shifts,
    }).peakViolations;
  }, [
    schedule.year,
    schedule.month,
    schedule.workHours,
    schedule.dateOverrides,
    schedule.employees,
    schedule.shifts,
  ]);

  /**
   * Gesperrt = eine Woche dieses Monats wurde bereits ausgedruckt. Ab da darf
   * sich am Plan nichts mehr ändern, sonst weicht das Papier im Laden vom
   * Stand im System ab. Alle ändernden Aktionen prüfen das selbst – die
   * Oberfläche allein zu deaktivieren würde die Regel nicht durchsetzen.
   */
  const isLocked = Boolean(schedule.lockedAt);

  // ----- Firma / Monat / Öffnungszeiten -----
  const updateMeta = useCallback((patch: Partial<Schedule>) => {
    setSchedule((s) => {
      // Ein Monatswechsel beginnt einen neuen Plan: die Sperre des alten
      // Monats darf nicht mitwandern.
      const monthChanged =
        (patch.year !== undefined && patch.year !== s.year) ||
        (patch.month !== undefined && patch.month !== s.month);
      if (monthChanged) {
        return { ...s, ...patch, lockedAt: undefined, printedWeeks: [] };
      }
      return { ...s, ...patch };
    });
  }, []);

  /**
   * Sofort speichern, ohne die Entprell-Zeit abzuwarten.
   *
   * Der normale Upload wartet eine Sekunde, damit nicht bei jedem Tastendruck
   * geschrieben wird. Für Sperren und Entsperren ist das zu langsam: wer
   * direkt nach dem Klick neu lädt oder die App wechselt, holt sich beim
   * nächsten Start wieder den alten Stand aus der Datenbank – die Sperre wäre
   * dann scheinbar von selbst zurückgekommen.
   */
  const pushNow = useCallback(async (state: PersistedState) => {
    saveState(state);
    if (!isRemoteConfigured || !hydrated.current) return;
    setRemoteStatus("saving");
    try {
      await saveRemote(state);
      setRemoteStatus("idle");
    } catch {
      setRemoteStatus("error");
    }
  }, []);

  /**
   * Passwort der Filiale ändern. Gibt eine Meldung zurück oder null bei Erfolg.
   *
   * Das alte Passwort wird abgefragt, damit nicht jeder, der gerade vor dem
   * offenen Tablet steht, die Filiale aussperren kann. Geschrieben wird sofort
   * (pushNow), nicht über die Ein-Sekunden-Sammlung: wer nach dem Ändern gleich
   * neu lädt, säße sonst vor dem alten Passwort.
   */
  const changePassword = useCallback(
    async (alt: string, neu: string): Promise<string | null> => {
      if (!(await passwordMatches(alt, latest.current.passwordHash))) {
        return "Mật khẩu hiện tại không đúng.";
      }
      const sauber = neu.trim();
      if (sauber.length < MIN_PASSWORD_LENGTH) {
        return `Mật khẩu mới phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`;
      }
      const neuerHash = await hashPassword(sauber);
      setPasswordHash(neuerHash);
      await pushNow({ ...latest.current, passwordHash: neuerHash });
      return null;
    },
    [pushNow],
  );

  /** Merkt eine gedruckte Woche und sperrt den Monat beim ersten Mal. */
  const markWeekPrinted = useCallback(
    (weekStart: string) => {
      const current = latest.current;
      const weeks = current.schedule.printedWeeks ?? [];
      const next: Schedule = {
        ...current.schedule,
        printedWeeks: weeks.includes(weekStart) ? weeks : [...weeks, weekStart].sort(),
        lockedAt: current.schedule.lockedAt ?? new Date().toISOString(),
      };
      setSchedule(next);
      void pushNow({ ...current, schedule: next });
    },
    [pushNow],
  );

  /** Sperre wieder aufheben (die Oberfläche fragt vorher nach). */
  const unlockMonth = useCallback(() => {
    const current = latest.current;
    const next: Schedule = { ...current.schedule, lockedAt: undefined };
    setSchedule(next);
    void pushNow({ ...current, schedule: next });
  }, [pushNow]);

  // ----- Mitarbeiter -----
  const addEmployee = useCallback(
    (name: string, employmentType: EmploymentType, targetHours: number) => {
      const emp: Employee = {
        id: newEmployeeId(),
        name: name.trim() || "Neuer Mitarbeiter",
        employmentType,
        targetMinutes: Math.round(targetHours) * 60,
      };
      setSchedule((s) => {
        if (s.lockedAt) return s; // Monat gedruckt und gesperrt
        return { ...s, employees: [...s.employees, emp] };
      });
    },
    [],
  );

  const updateEmployee = useCallback((id: string, patch: Partial<Employee>) => {
    setSchedule((s) => {
      if (s.lockedAt) return s; // Monat gedruckt und gesperrt
      return {
        ...s,
        employees: s.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      };
    });
  }, []);

  const removeEmployee = useCallback((id: string) => {
    setSchedule((s) => {
      if (s.lockedAt) return s; // Monat gedruckt und gesperrt
      return {
        ...s,
        employees: s.employees.filter((e) => e.id !== id),
        shifts: s.shifts.filter((sh) => sh.employeeId !== id),
      };
    });
  }, []);

  // ----- Generierung -----
  const generate = useCallback(() => {
    if (isLocked) return;
    setGenError(null);
    try {
      const shifts = generateSchedule({
        year: schedule.year,
        month: schedule.month,
        workHours: schedule.workHours,
        overrides: overridesToMap(schedule.dateOverrides),
        employees: schedule.employees,
      });
      setSchedule((s) => ({ ...s, shifts }));
      setOriginalShifts(shifts.map((sh) => ({ ...sh })));
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
    }
  }, [
    schedule.year,
    schedule.month,
    schedule.workHours,
    schedule.dateOverrides,
    schedule.employees,
    isLocked,
  ]);

  const resetToOriginal = useCallback(() => {
    setSchedule((s) => {
      if (s.lockedAt) return s; // Monat gedruckt und gesperrt
      return { ...s, shifts: originalShifts.map((sh) => ({ ...sh })) };
    });
  }, [originalShifts]);

  const resetAll = useCallback(() => {
    clearState();
    setSchedule(emptySchedule());
    setOriginalShifts([]);
    setGenError(null);
  }, []);

  const saveNow = useCallback(() => {
    saveState({ schedule, originalShifts, passwordHash });
  }, [schedule, originalShifts, passwordHash]);

  // ----- Ausnahmen je Datum -----
  const upsertOverride = useCallback((override: DateOverride) => {
    setSchedule((s) => {
      const rest = s.dateOverrides.filter((o) => o.date !== override.date);
      const next = [...rest, override].sort((a, b) => a.date.localeCompare(b.date));
      return { ...s, dateOverrides: next };
    });
  }, []);

  const removeOverride = useCallback((date: string) => {
    setSchedule((s) => ({
      ...s,
      dateOverrides: s.dateOverrides.filter((o) => o.date !== date),
    }));
  }, []);

  // ----- Schicht-Bearbeitung -----
  const findShift = useCallback(
    (employeeId: string, date: string): Shift | undefined =>
      schedule.shifts.find((s) => s.employeeId === employeeId && s.date === date),
    [schedule.shifts],
  );

  const editShiftTimes = useCallback(
    (
      shiftId: string,
      changes: Partial<Pick<Shift, "startMinutes" | "endMinutes" | "pauseMinutes">>,
    ) => {
      setSchedule((s) => {
        if (s.lockedAt) return s; // Monat gedruckt und gesperrt
        return {
          ...s,
          shifts: s.shifts.map((sh) => (sh.id === shiftId ? updateShiftTimes(sh, changes) : sh)),
        };
      });
    },
    [],
  );

  const addShift = useCallback(
    (employeeId: string, date: string, start: number, end: number, pause: number) => {
      setSchedule((s) => {
        if (s.lockedAt) return s; // Monat gedruckt und gesperrt
        const exists = s.shifts.some((sh) => sh.employeeId === employeeId && sh.date === date);
        if (exists) return s;
        return { ...s, shifts: [...s.shifts, createManualShift(employeeId, date, start, end, pause)] };
      });
    },
    [],
  );

  const deleteShift = useCallback((shiftId: string) => {
    setSchedule((s) => {
      if (s.lockedAt) return s; // Monat gedruckt und gesperrt
      return { ...s, shifts: s.shifts.filter((sh) => sh.id !== shiftId) };
    });
  }, []);

  /** Markiert einen Tag als "Frei": entfernt eine bestehende Schicht. */
  const setFrei = useCallback((employeeId: string, date: string) => {
    setSchedule((s) => {
      if (s.lockedAt) return s; // Monat gedruckt und gesperrt
      return {
        ...s,
        shifts: s.shifts.filter((sh) => !(sh.employeeId === employeeId && sh.date === date)),
      };
    });
  }, []);

  /** Verschiebt eine Schicht zu einem anderen Mitarbeiter (gleicher Tag). */
  const moveShiftToEmployee = useCallback((shiftId: string, targetEmployeeId: string) => {
    setSchedule((s) => {
      if (s.lockedAt) return s; // Monat gedruckt und gesperrt
      const shift = s.shifts.find((sh) => sh.id === shiftId);
      if (!shift) return s;
      const conflict = s.shifts.some(
        (sh) => sh.employeeId === targetEmployeeId && sh.date === shift.date,
      );
      if (conflict) return s;
      return {
        ...s,
        shifts: s.shifts.map((sh) =>
          sh.id === shiftId ? { ...sh, employeeId: targetEmployeeId, generated: false } : sh,
        ),
      };
    });
  }, []);

  return {
    schedule,
    originalShifts,
    validation,
    peakGaps,
    isLocked,
    markWeekPrinted,
    unlockMonth,
    genError,
    hasOriginal: originalShifts.length > 0,
    updateMeta,
    addEmployee,
    updateEmployee,
    removeEmployee,
    changePassword,
    hasOwnPassword: passwordHash !== undefined,
    generate,
    resetToOriginal,
    resetAll,
    remoteStatus,
    isRemoteConfigured,
    saveNow,
    upsertOverride,
    removeOverride,
    findShift,
    editShiftTimes,
    addShift,
    deleteShift,
    setFrei,
    moveShiftToEmployee,
  };
}

export type UseScheduleReturn = ReturnType<typeof useSchedule>;
