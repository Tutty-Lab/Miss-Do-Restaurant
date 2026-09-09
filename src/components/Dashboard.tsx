import { useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import { minutesToDecimalHours } from "../lib/time";

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg bg-white border border-slate-200 px-2.5 py-1.5 sm:px-3 sm:py-2 shadow-sm">
      <div className="text-[11px] sm:text-xs text-slate-500 leading-tight">{label}</div>
      <div className={`text-base sm:text-lg font-semibold leading-tight ${accent ?? "text-slate-900"}`}>
        {value}
      </div>
    </div>
  );
}

/** "2026-08-27" -> "27.08." – kurz, weil oft mehrere Tage nebeneinander stehen. */
function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}.${month}.`;
}

export function Dashboard({ store }: { store: UseScheduleReturn }) {
  const { schedule, validation, peakGaps } = store;
  const [showPeak, setShowPeak] = useState(false);
  const vz = schedule.employees.filter((e) => e.employmentType === "VOLLZEIT").length;
  const tz = schedule.employees.filter((e) => e.employmentType === "TEILZEIT").length;
  const mj = schedule.employees.filter((e) => e.employmentType === "MINIJOB").length;
  const targetMin = schedule.employees.reduce((s, e) => s + e.targetMinutes, 0);
  const plannedMin = schedule.shifts.reduce((s, x) => s + x.paidMinutes, 0);
  const notGenerated = schedule.shifts.length === 0;

  // Trước khi tạo lịch: trạng thái trung tính (chưa xếp giờ nào nên chưa thể "lỗi").
  const statusValue = notGenerated
    ? "Chưa tạo lịch"
    : validation.valid
      ? "Hợp lệ"
      : `${validation.errors.length} lỗi`;
  const statusAccent = notGenerated
    ? "text-slate-500"
    : validation.valid
      ? "text-emerald-600"
      : "text-rose-600";

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <Stat label="Số nhân viên" value={String(schedule.employees.length)} />
        <Stat label="Toàn thời gian" value={String(vz)} />
        <Stat label="Bán thời gian" value={String(tz)} />
        <Stat label="Minijob" value={String(mj)} />
        <Stat label="Tổng giờ định mức" value={`${minutesToDecimalHours(targetMin)} h`} />
        <Stat label="Tổng giờ đã xếp" value={`${minutesToDecimalHours(plannedMin)} h`} />
        <Stat label="Trạng thái kiểm tra" value={statusValue} accent={statusAccent} />
      </div>
      {notGenerated && schedule.employees.length > 0 && (
        <div className="mt-2 rounded bg-sky-50 border border-sky-200 text-sky-800 text-sm px-3 py-2">
          Chưa có lịch. Sang tab „Lịch làm việc" và bấm „Tạo lịch làm việc".
        </div>
      )}
      {validation.valid && schedule.shifts.length > 0 && (
        <div className="mt-2 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-3 py-2">
          Tất cả giờ định mức đã được phân bổ chính xác.
        </div>
      )}
      {/*
        Giờ cao điểm thiếu người KHÔNG phải lỗi định mức — lịch vẫn đúng giờ
        công. Nó chỉ có nghĩa là tổng giờ trong ngày quá mỏng để lúc nào cũng
        có 2 người. Trước đây chuyện này diễn ra âm thầm, không ai biết.
      */}
      {/*
        Giờ cao điểm thiếu người là CẢNH BÁO, không phải lỗi định mức. Chi tiết
        được giấu sau nút (i), bấm mới hiện — để bảng tổng quan gọn.
      */}
      {peakGaps.length > 0 && (
        <div className="mt-2 rounded bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">
              {peakGaps.length} ngày chưa đúng số người trong giờ cao điểm.
            </span>
            <button
              onClick={() => setShowPeak((v) => !v)}
              aria-label="Chi tiết cảnh báo giờ cao điểm"
              aria-expanded={showPeak}
              className="shrink-0 font-bold text-rose-600 hover:text-rose-800 underline"
            >
              (i)
            </button>
          </div>
          {showPeak && (
            <div className="mt-2 border-t border-black/10 pt-2">
              <div className="space-y-0.5 max-h-48 overflow-auto">
                {peakGaps.map((d) => (
                  <div key={d.date}>
                    {shortDate(d.date)}{" "}
                    {d.peaks
                      .filter((p) => !p.ok)
                      .map((p) =>
                        p.minStaff < p.required
                          ? `${p.label} thiếu: ${p.minStaff}/${p.required} người`
                          : `${p.label} thừa: ${p.maxStaff}, tối đa ${p.allowed}`,
                      )
                      .join(" · ")}{" "}
                    <span className="opacity-70">({d.shiftCount} ca, {d.paidHours}h)</span>
                  </div>
                ))}
              </div>
              <div className="mt-1 opacity-80">
                Cách xử lý: tăng định mức cho nhân viên, thêm người, hoặc chấp nhận những ngày này.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
