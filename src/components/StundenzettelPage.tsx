import type { Employee, Schedule } from "../types";
import { buildTimesheet } from "../lib/stundenzettel";

/**
 * Ein A4-freundlicher Stundenzettel für einen Mitarbeiter (Bildschirm-Vorschau).
 * Die Daten kommen aus buildTimesheet – DERSELBEN Quelle wie die PDF, damit
 * Vorschau und Download Zeichen für Zeichen übereinstimmen.
 */
export function StundenzettelPage({
  schedule,
  employee,
  dates,
  periodLabel,
}: {
  schedule: Schedule;
  employee: Employee;
  /** Nur diese Tage zeigen (Wochen-Stundenzettel); fehlend => ganzer Monat. */
  dates?: string[];
  /** Zeitraum-Text oben rechts; fehlend => Monat/Jahr. */
  periodLabel?: string;
}) {
  const sheet = buildTimesheet(schedule, employee, dates, periodLabel);
  const extraLines = sheet.lineCount - sheet.rows.length;

  return (
    <div className={`stundenzettel-page miss-do-timesheet ${extraLines > 9 ? "miss-do-timesheet-dense" : ""} bg-white text-slate-900 mx-auto max-w-[210mm] p-6 text-[12px]`}>
      <div className="flex items-start justify-between border-b-2 border-slate-800 pb-2 mb-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Stundenaufzeichnung</h2>
          <p className="text-slate-600">{sheet.companyName}</p>
          {sheet.address && <p className="text-slate-500 text-[11px]">{sheet.address}</p>}
        </div>
        <div className="text-right text-slate-600">
          <div>{sheet.periodLabel}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-1 mb-3">
        {sheet.info.map((f) => (
          <Info key={f.label} label={f.label} value={f.value} blank={f.blank} />
        ))}
      </div>

      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="bg-slate-100">
            <Th>Datum</Th>
            <Th>Wochentag</Th>
            <Th>Arbeitsbeginn</Th>
            <Th>Arbeitsende</Th>
            <Th>Pause</Th>
            <Th>Arbeitszeit</Th>
            <Th className="text-left">Bemerkung</Th>
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((r) => (
            <tr key={r.date} className={r.shaded ? "bg-slate-50" : ""}>
              <Td>{r.date}</Td>
              <Td>{r.weekday}</Td>
              <Td className="text-center">{r.lines.map((l, i) => <div key={i}>{l.start}</div>)}</Td>
              <Td className="text-center">{r.lines.map((l, i) => <div key={i}>{l.end}</div>)}</Td>
              <Td className="text-center">{r.lines.map((l, i) => <div key={i}>{l.pause}</div>)}</Td>
              <Td className="text-center">{r.lines.length ? r.lines.map((l, i) => <div key={i}>{l.paid}</div>) : "0,00"}</Td>
              <Td className="text-left text-slate-500">{r.lines.length
                ? r.lines.map((l, i) => <div key={i}>{l.bemerkung || " "}</div>)
                : r.rest}</Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold bg-slate-100">
            <Td className="text-left" colSpan={5}>
              Gesamtstunden
            </Td>
            <Td className="text-center">{sheet.totalText}</Td>
            <Td />
          </tr>
        </tfoot>
      </table>

      {/*
        Nur die tatsächlich geleisteten Stunden werden gedruckt. Sollstunden und
        Differenz bleiben leer – sie werden auf dem Papier von Hand ergänzt.
      */}
      <div className="mt-3 grid grid-cols-3 gap-4 text-[12px]">
        <div>
          <div className="text-slate-500">Gesamtstunden</div>
          <div className="font-semibold">{sheet.totalText} h</div>
        </div>
        <div>
          <div className="text-slate-500">Sollstunden</div>
          <BlankLine />
        </div>
        <div>
          <div className="text-slate-500">Differenz</div>
          <BlankLine />
        </div>
      </div>

      <div className="mt-3 border-t border-slate-300 pt-2 text-[11px]">
        <div className="font-semibold mb-1">Zuschläge (nur Stundensumme)</div>
        <div className="grid grid-cols-2 gap-3">
          <div>Nachtzuschlag (Mo–Sa, ab 20:00)<br />
            <span className="font-semibold">{sheet.nightHoursText} h</span>
          </div>
          <div>Sonntagszuschlag (Sonntag)<br />
            <span className="font-semibold">{sheet.sundayHoursText} h</span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-8 text-[11px]">
        <Signature label="Unterschrift Mitarbeiter" />
        <Signature label="Unterschrift Arbeitgeber" />
        <Signature label="Datum" />
      </div>
    </div>
  );
}

/** `blank` = Feld zum Ausfüllen von Hand statt eines gedruckten Werts. */
function Info({ label, value, blank }: { label: string; value?: string; blank?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="text-slate-500 min-w-[110px]">{label}:</span>
      {blank ? (
        <span className="flex-1 border-b border-slate-400" />
      ) : (
        <span className="font-medium">{value}</span>
      )}
    </div>
  );
}

/** Leere Schreiblinie – markiert ein Feld, das von Hand ergänzt wird. */
function BlankLine() {
  return <div className="border-b border-slate-400 h-[1.2em] w-full max-w-[80px]" />;
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`border border-slate-300 px-2 py-1 text-center font-semibold ${className}`}>
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
  colSpan,
}: {
  children?: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`border border-slate-300 px-2 py-[3px] ${className}`}>
      {children}
    </td>
  );
}

function Signature({ label }: { label: string }) {
  return (
    <div>
      <div className="border-t border-slate-500 pt-1 mt-4 text-slate-600">{label}</div>
    </div>
  );
}
