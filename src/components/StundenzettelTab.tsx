import { useEffect, useMemo, useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import { stundenzettelToPdf, buildStundenzettelDoc, safeFileName } from "../lib/pdf";
import { weeksOfMonth } from "../lib/weeks";

export function StundenzettelTab({ store }: { store: UseScheduleReturn }) {
  const { schedule, isLocked, markWeekPrinted, unlockMonth } = store;

  // ── Auswahl: WER (eine Person oder der ganze Laden) und WAS ─────────────
  // who: "all" = ganzer Laden, sonst eine employeeId.
  const [who, setWho] = useState<string>("all");
  // what: "stundenzettel" (Monats-Stundenzettel) | "sz-<weekStart>" (Woche).
  const [what, setWhat] = useState<string>("stundenzettel");

  const weeks = useMemo(
    () => weeksOfMonth(schedule.year, schedule.month),
    [schedule.year, schedule.month],
  );

  // Vektor-PDF: kein Offscreen-Rendern mehr nötig – direkt aus den Daten
  // gezeichnet. Fortschritt X/N für „cả quán" (viele Seiten).
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<{ done: number; total: number } | null>(null);

  /** Zweiter Klick für das Entsperren – ohne native Dialoge, siehe unten. */
  const [confirmUnlock, setConfirmUnlock] = useState(false);

  const monthTag = `${schedule.year}-${String(schedule.month).padStart(2, "0")}`;

  // Für WER: die betroffenen Mitarbeiter (Reihenfolge wie im Plan).
  const chosenEmployees =
    who === "all"
      ? schedule.employees
      : schedule.employees.filter((e) => e.id === who);
  // Für die Vorschau und die Dateinamen: eine konkrete Person.
  const previewEmployee =
    who === "all" ? schedule.employees[0] ?? null : chosenEmployees[0] ?? null;
  const whoTag = who === "all" ? "tat_ca" : safeFileName(previewEmployee?.name ?? who);

  // Wochen-Stundenzettel: nur die Tage dieser Woche, mit Wochentitel oben rechts.
  function szWeekFor(weekStart: string): { dates: string[]; label: string } | null {
    const w = weeks.find((x) => x.weekStart === weekStart);
    if (!w) return null;
    return { dates: w.dates, label: `Woche ${w.label}${schedule.year}` };
  }

  // Vorschau = die ECHTE PDF (als Blob im iframe), damit Bildschirm und Ausdruck
  // Zeichen für Zeichen identisch sind. Baut für die gewählte Person + Zeitraum neu.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!previewEmployee || schedule.shifts.length === 0) {
      setPreviewUrl(null);
      return;
    }
    let dates: string[] | undefined;
    let periodLabel: string | undefined;
    if (what.startsWith("sz-")) {
      const sz = szWeekFor(what.slice(3));
      dates = sz?.dates;
      periodLabel = sz?.label;
    }
    const blob = buildStundenzettelDoc(schedule, [previewEmployee], { dates, periodLabel }).output(
      "blob",
    );
    const url = URL.createObjectURL(blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
    // previewEmployee ist je Render neu; nur seine id ist stabil.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, previewEmployee?.id, what]);

  async function onPdf() {
    if (pdfBusy || chosenEmployees.length === 0) return;

    let filename: string;
    let dates: string[] | undefined;
    let periodLabel: string | undefined;
    let weekStart: string | undefined;

    if (what === "stundenzettel") {
      filename = `Stundenzettel_${whoTag}_${monthTag}.pdf`;
    } else if (what.startsWith("sz-")) {
      weekStart = what.slice(3);
      const sz = szWeekFor(weekStart);
      if (!sz) return;
      dates = sz.dates;
      periodLabel = sz.label;
      filename = `Stundenzettel_${whoTag}_${monthTag}_tuan_${weekStart}.pdf`;
    } else {
      return;
    }

    setPdfBusy(true);
    setPdfProgress({ done: 0, total: chosenEmployees.length });
    try {
      await stundenzettelToPdf(schedule, chosenEmployees, filename, {
        dates,
        periodLabel,
        onProgress: (done, total) => setPdfProgress({ done, total }),
      });
      // Wochen-Stundenzettel ausgegeben => Monat sperren (Wandaushang bleibt
      // synchron). Wie früher beim Dienstplan, jetzt am Stundenzettel.
      if (weekStart) markWeekPrinted(weekStart);
    } catch (err) {
      alert(`Không tạo được PDF: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPdfBusy(false);
      setPdfProgress(null);
    }
  }

  if (schedule.employees.length === 0) {
    return (
      <div className="no-print rounded bg-white border border-slate-200 p-6 text-center text-slate-400">
        Vui lòng thêm nhân viên và tạo lịch làm việc trước.
      </div>
    );
  }

  const hasSchedule = schedule.shifts.length > 0;

  return (
    <div className="no-print">
      {/* ---- Xuất PDF ---- */}
      <div className="rounded-lg border border-slate-200 bg-white p-3 mb-4">
        <div className="text-sm font-medium text-slate-700 mb-2">Xuất bảng chấm công (PDF)</div>

        <div className="flex flex-wrap items-end gap-3">
          {/* WER */}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Cho ai</span>
            <select
              className="rounded border border-slate-300 px-2 py-2 text-sm min-w-[10rem]"
              value={who}
              onChange={(e) => setWho(e.target.value)}
            >
              <option value="all">Tất cả (cả quán)</option>
              {schedule.employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>

          {/* WAS */}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Kỳ</span>
            <select
              className="rounded border border-slate-300 px-2 py-2 text-sm min-w-[14rem]"
              value={what}
              onChange={(e) => setWhat(e.target.value)}
            >
              <option value="stundenzettel">Cả tháng</option>
              {weeks.map((w) => {
                const printed = (schedule.printedWeeks ?? []).includes(w.weekStart);
                return (
                  <option key={`sz-${w.weekStart}`} value={`sz-${w.weekStart}`}>
                    Tuần {w.label}
                    {printed ? " ✓ (đã in)" : ""}
                  </option>
                );
              })}
            </select>
          </label>

          {/* Hành động */}
          <div className="flex items-center gap-2">
            <button
              disabled={pdfBusy || !hasSchedule}
              onClick={onPdf}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 active:bg-slate-800 disabled:opacity-40"
            >
              ⬇ Xuất PDF
            </button>
            {pdfBusy && (
              <span className="text-sm text-slate-500">
                Đang tạo PDF…
                {pdfProgress && pdfProgress.total > 1 ? ` ${pdfProgress.done}/${pdfProgress.total}` : ""}
              </span>
            )}
          </div>
        </div>

        {!hasSchedule && (
          <p className="mt-2 text-sm text-slate-400">
            Chưa có lịch. Sang tab „Lịch làm việc" để tạo.
          </p>
        )}

        <p className="mt-2 text-xs text-slate-500">
          <b>Bảng chấm công (Stundenzettel)</b> theo mẫu tiếng Đức để nộp — một tờ mỗi người, chọn cả
          tháng hoặc từng tuần. Bấm <b>Xuất PDF</b> để tải file về máy (trên điện thoại mở bảng Chia
          sẻ) — <b>muốn in thì mở file PDF đó rồi in</b>: kẻ bảng sắc nét, đủ mọi trang, không dính
          URL/ngày in. <b>Xuất bảng chấm công một tuần sẽ khóa lịch tháng</b> để bản treo luôn khớp
          với hệ thống.
        </p>

        {isLocked && (
          <div className="mt-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2">
            <div className="font-medium">
              Lịch tháng này đã khóa vì đã in
              {schedule.lockedAt &&
                ` lúc ${new Date(schedule.lockedAt).toLocaleString("vi-VN")}`}
              .
            </div>
            <div className="mt-0.5">
              Không sửa được ca, không đổi nhân viên. Vẫn in được bình thường. (Tạo lại lịch ở tab
              „Lịch làm việc" cũng sẽ mở khóa.)
            </div>

            {/*
              Bewusst KEIN window.confirm: In-App-Browser (Messenger, Facebook)
              unterdrücken die native Rückfrage teilweise. Sie liefert dann
              stillschweigend false, der Klick tut nichts, und niemand erfährt
              warum. Die Rückfrage steht deshalb direkt hier.
            */}
            {!confirmUnlock ? (
              <button
                onClick={() => setConfirmUnlock(true)}
                className="mt-2 rounded border border-amber-400 bg-white px-3 py-1 text-sm font-medium text-amber-900 hover:bg-amber-100"
              >
                Mở khóa
              </button>
            ) : (
              <div className="mt-2 rounded border border-amber-300 bg-white px-3 py-2">
                <div className="text-amber-900">
                  Mở khóa lịch tháng này? Bản đã in ở quán sẽ không còn khớp với hệ thống. Sau khi
                  sửa, hãy in lại tuần đó và thay bản cũ.
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => {
                      unlockMonth();
                      setConfirmUnlock(false);
                    }}
                    className="rounded bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-700"
                  >
                    Xác nhận mở khóa
                  </button>
                  <button
                    onClick={() => setConfirmUnlock(false)}
                    className="rounded border border-slate-300 bg-white px-3 py-1 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    Huỷ
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Xem trước = ĐÚNG file PDF sẽ in ra (nhúng thẳng), cho nhân viên đã chọn */}
      {previewEmployee && (
        <>
          <div className="mb-1 text-xs text-slate-500">
            Xem trước (đúng như bản in PDF): <b>{previewEmployee.name}</b>
            {who === "all" && " (chọn một người ở ô „Cho ai“ để xem người khác)"}
          </div>
          {previewUrl ? (
            <iframe
              title={`Stundenzettel ${previewEmployee.name}`}
              src={previewUrl}
              className="w-full aspect-[210/297] rounded-lg border border-slate-300 shadow-sm bg-white"
            />
          ) : (
            <div className="rounded-lg border border-slate-300 bg-white p-6 text-center text-sm text-slate-400">
              {hasSchedule ? "Đang tạo bản xem trước…" : "Chưa có lịch để xem trước."}
            </div>
          )}
        </>
      )}
    </div>
  );
}
