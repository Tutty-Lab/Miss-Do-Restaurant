import { useMemo, useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import type { Employee, EmploymentType } from "../types";
import { WEEKDAY_ORDER, WEEKDAY_SHORT_VI, type WeekdayKey } from "../lib/demand";
import { employmentLabelVi, employmentShortVi } from "../lib/employment";
import { splitTargetHours } from "../lib/splitTargetHours";

const inputClass =
  "rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

/**
 * Ab hier wird gewarnt. 192 h = 24 Tage à 8 h; darüber wird der Monat sehr
 * eng (6-Tage-Regel) und arbeitsrechtlich heikel.
 */
export const WARN_HOURS = 192;

/** Số ngày làm (= số ca) cho một mục tiêu, hoặc thông báo lỗi. */
function splitInfo(targetHours: number, type: EmploymentType): { ok: boolean; text: string } {
  try {
    const parts = splitTargetHours(targetHours, type);
    return { ok: true, text: `${parts.length} ca` };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : "không hợp lệ" };
  }
}

/**
 * Entwurf, während im Blatt getippt wird. Zahlen sind STRINGS, damit man ein
 * Feld leeren kann, ohne dass es auf 0 zurückspringt.
 */
type Draft = {
  name: string;
  employmentType: EmploymentType;
  hours: string;
  availableWeekdays: WeekdayKey[]; // [] = alle Tage
  maxDaysPerWeek: string;
  nightHours: string;
  sundayHours: string;
};

function draftFrom(emp?: Employee): Draft {
  return {
    name: emp?.name ?? "",
    employmentType: emp?.employmentType ?? "VOLLZEIT",
    hours: emp ? String(emp.targetMinutes / 60) : "176",
    availableWeekdays: emp?.availableWeekdays ?? [],
    maxDaysPerWeek: emp?.maxDaysPerWeek ? String(emp.maxDaysPerWeek) : "",
    nightHours: emp?.nightMinutes ? String(emp.nightMinutes / 60) : "",
    sundayHours: emp?.sundayMinutes ? String(emp.sundayMinutes / 60) : "",
  };
}

/** Entwurf -> Mitarbeiter-Felder (ohne id). Leere Optionen werden zu undefined. */
function draftToEmployee(d: Draft): Omit<Employee, "id"> {
  const stunden = Math.max(0, Math.round(Number(d.hours) || 0));
  const tage = Number(d.maxDaysPerWeek);
  const nacht = Number(d.nightHours);
  const sonntag = Number(d.sundayHours);
  return {
    name: d.name.trim() || "Nhân viên mới",
    employmentType: d.employmentType,
    targetMinutes: stunden * 60,
    availableWeekdays: d.availableWeekdays.length > 0 ? d.availableWeekdays : undefined,
    maxDaysPerWeek: d.maxDaysPerWeek === "" || tage < 1 ? undefined : Math.min(7, Math.round(tage)),
    nightMinutes: d.nightHours === "" || nacht <= 0 ? undefined : Math.round(nacht) * 60,
    sundayMinutes: d.sundayHours === "" || sonntag <= 0 ? undefined : Math.round(sonntag) * 60,
  };
}

export function EmployeesTab({ store }: { store: UseScheduleReturn }) {
  const { schedule, addEmployee, updateEmployee, removeEmployee } = store;
  const locked = Boolean(schedule.lockedAt);

  // null = zu; "new" = anlegen; sonst = die id, die bearbeitet wird.
  const [offen, setOffen] = useState<null | "new" | string>(null);

  const bearbeitet = useMemo(
    () =>
      typeof offen === "string" && offen !== "new"
        ? schedule.employees.find((e) => e.id === offen)
        : undefined,
    [offen, schedule.employees],
  );

  return (
    <section className="rounded-lg bg-white border border-slate-200 p-4 sm:p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-slate-900">
          Nhân viên
          {schedule.employees.length > 0 && (
            <span className="ml-2 text-sm font-normal text-slate-400">
              {schedule.employees.length}
            </span>
          )}
        </h2>
        <button
          onClick={() => setOffen("new")}
          disabled={locked}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 active:bg-slate-800 disabled:opacity-40"
        >
          + Thêm
        </button>
      </div>

      {locked && (
        <div className="mb-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2">
          Lịch tháng này đã khoá vì đã in — mở khoá ở tab <b>Bảng chấm công</b> để sửa nhân viên.
        </div>
      )}

      {schedule.employees.length === 0 ? (
        <div className="py-8 text-center text-slate-400">
          Chưa có nhân viên. Bấm <b>+ Thêm</b> để tạo.
        </div>
      ) : (
        <ul className="space-y-2">
          {schedule.employees.map((emp) => (
            <li key={emp.id}>
              <button
                onClick={() => setOffen(emp.id)}
                className="w-full text-left rounded-lg border border-slate-200 p-3 flex items-center gap-3 hover:bg-slate-50 active:bg-slate-100 transition-colors"
              >
                <EmployeeSummaryRow emp={emp} />
                <span className="text-slate-300 text-lg leading-none">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Nút nổi trên mobile để thêm nhanh mà không phải cuộn lên đầu. */}
      {!locked && (
        <button
          onClick={() => setOffen("new")}
          aria-label="Thêm nhân viên"
          className="sm:hidden fixed bottom-5 right-5 z-40 h-14 w-14 rounded-full bg-slate-900 text-white text-2xl shadow-lg active:bg-slate-700 flex items-center justify-center"
        >
          +
        </button>
      )}

      {offen !== null && !locked && (
        <EmployeeSheet
          key={bearbeitet?.id ?? "new"}
          employee={bearbeitet}
          onClose={() => setOffen(null)}
          onSave={(felder) => {
            if (bearbeitet) updateEmployee(bearbeitet.id, felder);
            else addEmployee(felder);
            setOffen(null);
          }}
          onDelete={
            bearbeitet
              ? () => {
                  removeEmployee(bearbeitet.id);
                  setOffen(null);
                }
              : undefined
          }
        />
      )}
    </section>
  );
}

/** Kompakte Zeile in der Liste: Name, Art, Stunden, Besonderheiten. */
function EmployeeSummaryRow({ emp }: { emp: Employee }) {
  const stunden = emp.targetMinutes / 60;
  const info = splitInfo(stunden, emp.employmentType);
  const tooMany = stunden > WARN_HOURS;
  const tage = emp.availableWeekdays;

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className="font-medium text-slate-900 truncate">{emp.name}</span>
        <span className="shrink-0 rounded bg-slate-100 text-slate-600 text-[11px] px-1.5 py-0.5">
          {employmentShortVi(emp.employmentType)}
        </span>
        {tooMany && <span className="shrink-0 text-amber-600 text-xs">⚠</span>}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
        <span>
          {stunden}h · <span className={info.ok ? "" : "text-rose-600"}>{info.text}</span>
        </span>
        {tage && tage.length > 0 && (
          <span className="text-slate-400">
            · {tage.map((k) => WEEKDAY_SHORT_VI[k]).join(" ")}
          </span>
        )}
        {emp.maxDaysPerWeek ? (
          <span className="text-slate-400">· {emp.maxDaysPerWeek} ngày/tuần</span>
        ) : null}
        {emp.nightMinutes ? (
          <span className="rounded bg-indigo-50 text-indigo-700 px-1.5 py-0.5">
            tối {emp.nightMinutes / 60}h
          </span>
        ) : null}
        {emp.sundayMinutes ? (
          <span className="rounded bg-amber-50 text-amber-700 px-1.5 py-0.5">
            CN {emp.sundayMinutes / 60}h
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Ein Blatt zum Anlegen ODER Bearbeiten – auf dem Handy von unten, am Desktop
 * mittig. Alle Felder an einem Ort, statt weit unten in der Liste zu suchen.
 */
function EmployeeSheet({
  employee,
  onClose,
  onSave,
  onDelete,
}: {
  employee?: Employee;
  onClose: () => void;
  onSave: (felder: Omit<Employee, "id">) => void;
  onDelete?: () => void;
}) {
  const [d, setD] = useState<Draft>(() => draftFrom(employee));
  const [loeschFrage, setLoeschFrage] = useState(false);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));

  const alleTage = d.availableWeekdays.length === 0;
  const toggleWeekday = (key: WeekdayKey) => {
    const basis = alleTage ? [...WEEKDAY_ORDER] : d.availableWeekdays;
    const naechste = basis.includes(key) ? basis.filter((k) => k !== key) : [...basis, key];
    // Alle sieben angehakt = keine Einschränkung.
    set("availableWeekdays", naechste.length === WEEKDAY_ORDER.length ? [] : naechste);
  };

  const stunden = Math.max(0, Math.round(Number(d.hours) || 0));
  const info = splitInfo(stunden, d.employmentType);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-lg bg-white shadow-xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">
            {employee ? "Sửa nhân viên" : "Thêm nhân viên"}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <div className="px-4 py-3 space-y-4">
          <label className="block">
            <span className="text-xs text-slate-600">Tên</span>
            <input
              autoFocus={!employee}
              className={`${inputClass} w-full mt-1`}
              value={d.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Tên nhân viên"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-600">Hình thức</span>
              <select
                className={`${inputClass} w-full mt-1`}
                value={d.employmentType}
                onChange={(e) => set("employmentType", e.target.value as EmploymentType)}
              >
                <option value="VOLLZEIT">{employmentLabelVi("VOLLZEIT")}</option>
                <option value="TEILZEIT">{employmentLabelVi("TEILZEIT")}</option>
                <option value="MINIJOB">{employmentLabelVi("MINIJOB")}</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-600">Giờ định mức / tháng</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                className={`${inputClass} w-full mt-1`}
                value={d.hours}
                onChange={(e) => set("hours", e.target.value)}
              />
            </label>
          </div>
          <div className={`text-xs ${info.ok ? "text-slate-500" : "text-rose-600"}`}>
            {info.text}
            {stunden > WARN_HOURS && (
              <span className="text-amber-600"> · ⚠ trên {WARN_HOURS}h rất khó xếp</span>
            )}
          </div>

          <div>
            <div className="text-xs text-slate-600 mb-1.5">
              Ngày làm trong tuần
              {alleTage && <span className="text-slate-400"> — bỏ trống = làm mọi ngày</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_ORDER.map((key) => {
                const an = alleTage || d.availableWeekdays.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleWeekday(key)}
                    className={`rounded px-2.5 py-1.5 text-xs border transition-colors ${
                      an
                        ? "bg-slate-800 text-white border-slate-800"
                        : "bg-white text-slate-400 border-slate-200 line-through"
                    }`}
                  >
                    {WEEKDAY_SHORT_VI[key]}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-600">
            Số ngày làm mỗi tuần
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={7}
              placeholder="—"
              value={d.maxDaysPerWeek}
              onChange={(e) => set("maxDaysPerWeek", e.target.value)}
              className={`${inputClass} w-16`}
            />
            <span className="text-slate-400">bỏ trống = không giới hạn</span>
          </label>

          {/*
            Reinigung als eigene Töpfe: abends nach Schluss (Nachtzuschlag, hängt
            als Verlängerung am Schließer bis 23:00) und sonntags (Sonntagszuschlag).
          */}
          <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
            <label className="block">
              <span className="text-xs text-slate-600">Lau chùi buổi tối (tới 23h) — giờ/tháng</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                placeholder="0"
                value={d.nightHours}
                onChange={(e) => set("nightHours", e.target.value)}
                className={`${inputClass} w-full mt-1`}
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-600">Lau chùi chủ nhật — giờ/tháng</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                placeholder="0"
                value={d.sundayHours}
                onChange={(e) => set("sundayHours", e.target.value)}
                className={`${inputClass} w-full mt-1`}
              />
            </label>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-slate-200 px-4 py-3">
          {loeschFrage ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-600">Xoá nhân viên này?</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setLoeschFrage(false)}
                  className="rounded px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Không
                </button>
                <button
                  onClick={onDelete}
                  className="rounded bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700"
                >
                  Xoá
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              {onDelete ? (
                <button
                  onClick={() => setLoeschFrage(true)}
                  className="text-rose-600 hover:text-rose-800 text-sm font-medium"
                >
                  Xoá
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  Huỷ
                </button>
                <button
                  onClick={() => onSave(draftToEmployee(d))}
                  className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
                >
                  Lưu
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
