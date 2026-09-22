// ============================================================================
// Vektor-PDF der Stundenzettel.
//
// Früher wurde jede Seite mit html2canvas als BILD aufgenommen und in die PDF
// gelegt: große Dateien, unscharfe/fehlende Gitterlinien, und ohne gecachte
// Schrift eine Serifen-Ersatzschrift. Jetzt wird die PDF direkt als Vektor
// gezeichnet – Text und Linien statt Pixel:
//   • gestochen scharfes Gitter auf jedem Gerät, winzige Dateien,
//   • eingebettete Schrift (Roboto) => offline korrekt, inkl. vietnamesischer
//     Namen (Nguyễn, Kiều, Hữu, Đức …), deutscher Umlaute/ß und €,
//   • keine Browser-Kopf-/Fußzeile (URL, Datum, Seitenzahl).
// ============================================================================

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { Employee, Schedule } from "../types";
import { buildTimesheet, type Timesheet } from "./stundenzettel";
import { ROBOTO_REGULAR_BASE64, ROBOTO_BOLD_BASE64 } from "./fonts/robotoFont";

const A4_W = 210;
const A4_H = 297;
const MARGIN = 12;
const CONTENT_W = A4_W - 2 * MARGIN;
const FONT = "Roboto";

// Slate-Farben wie in der App (Tailwind), als RGB.
const INK: [number, number, number] = [15, 23, 42]; // slate-900
const MUTED: [number, number, number] = [71, 85, 105]; // slate-600
const FAINT: [number, number, number] = [100, 116, 139]; // slate-500
const GRID: [number, number, number] = [203, 213, 225]; // slate-300
const HEAD_FILL: [number, number, number] = [241, 245, 249]; // slate-100
const SHADE_FILL: [number, number, number] = [248, 250, 252]; // slate-50

/** Dateiname säubern: Umlaute/Akzente weg, nur unbedenkliche Zeichen behalten. */
export function safeFileName(text: string): string {
  const plain = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // Akzente entfernen: "Tuấn" -> "Tuan"
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
  return plain.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "Stundenzettel";
}

/** Roboto (Regular + Bold) in das Dokument einbetten – einmal pro PDF. */
function registerFont(doc: jsPDF): void {
  doc.addFileToVFS("Roboto-Regular.ttf", ROBOTO_REGULAR_BASE64);
  doc.addFont("Roboto-Regular.ttf", FONT, "normal");
  doc.addFileToVFS("Roboto-Bold.ttf", ROBOTO_BOLD_BASE64);
  doc.addFont("Roboto-Bold.ttf", FONT, "bold");
  doc.setFont(FONT, "normal");
}

function setColor(doc: jsPDF, rgb: [number, number, number]): void {
  doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}

/** pt -> mm (für Höhenabschätzungen). */
const ptToMm = (pt: number) => (pt * 25.4) / 72;

/**
 * Schriftgröße für die Tabelle so wählen, dass ALLE Zeilen einer Person auf
 * genau eine A4-Seite passen (Checklist: „Seitenzahl = Mitarbeiterzahl",
 * „eine Person => genau 1 Seite"). Viele Tage / Split-Schichten => kleinere
 * Schrift, wie die bisherige „dense"-Vorschau.
 */
function pickTableFontSize(sheet: Timesheet, availableMm: number): number {
  const pad = 0.6; // cellPadding oben+unten je Zeile (mm)
  // Zeilen: Kopf + Fuß + je Tag min. 1, Split-Tage mehr (lineCount deckt das ab).
  const totalLines = sheet.lineCount + 2;
  for (const fs of [8.5, 8, 7.5, 7, 6.5, 6]) {
    const rowMm = ptToMm(fs) * 1.15 + 2 * pad;
    if (rowMm * totalLines <= availableMm) return fs;
  }
  return 6;
}

/** Kopf (Titel, Firma, Zeitraum) + Infofeld. Gibt die untere Y-Kante zurück. */
function drawHeader(doc: jsPDF, sheet: Timesheet): number {
  let y = MARGIN;

  doc.setFont(FONT, "bold");
  doc.setFontSize(16);
  setColor(doc, INK);
  doc.text("Stundenaufzeichnung", MARGIN, y + 5);

  doc.setFont(FONT, "normal");
  doc.setFontSize(10);
  setColor(doc, MUTED);
  doc.text(sheet.periodLabel, A4_W - MARGIN, y + 5, { align: "right" });

  y += 8;
  doc.setFontSize(10);
  setColor(doc, MUTED);
  doc.text(sheet.companyName, MARGIN, y);
  if (sheet.address) {
    y += 4;
    doc.setFontSize(8.5);
    setColor(doc, FAINT);
    doc.text(sheet.address, MARGIN, y);
  }

  y += 3;
  doc.setDrawColor(INK[0], INK[1], INK[2]);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, y, A4_W - MARGIN, y);

  // Infofeld: zwei Spalten.
  y += 5;
  const colX = [MARGIN, MARGIN + CONTENT_W / 2];
  const labelW = 26;
  doc.setFontSize(9);
  for (let i = 0; i < sheet.info.length; i++) {
    const f = sheet.info[i];
    const x = colX[i % 2];
    const rowY = y + Math.floor(i / 2) * 5.5;
    const label = `${f.label}:`;
    setColor(doc, FAINT);
    doc.setFont(FONT, "normal");
    doc.text(label, x, rowY);
    // Wert/Linie hinter dem Label – lange Labels (Beschäftigungsart …) messen,
    // damit nichts überlappt; kurze bündig an einer festen Spalte.
    const valX = x + Math.max(labelW, doc.getTextWidth(label) + 2);
    if (f.blank) {
      doc.setDrawColor(GRID[0], GRID[1], GRID[2]);
      doc.setLineWidth(0.2);
      doc.line(valX, rowY, x + CONTENT_W / 2 - 6, rowY);
    } else {
      setColor(doc, INK);
      doc.setFont(FONT, "bold");
      doc.text(f.value, valX, rowY);
    }
  }
  const rows = Math.ceil(sheet.info.length / 2);
  return y + rows * 5.5;
}

/** Zeilen der Stundentabelle in autoTable-Body-Form (Split-Schicht: Zeilenumbruch). */
function tableBody(sheet: Timesheet): string[][] {
  return sheet.rows.map((r) => {
    if (r.lines.length === 0) {
      return [r.date, r.weekday, "", "", "", "0,00", r.rest];
    }
    const nb = (s: string) => s || " ";
    return [
      r.date,
      r.weekday,
      r.lines.map((l) => l.start).join("\n"),
      r.lines.map((l) => l.end).join("\n"),
      r.lines.map((l) => l.pause).join("\n"),
      r.lines.map((l) => l.paid).join("\n"),
      r.lines.map((l) => nb(l.bemerkung)).join("\n"),
    ];
  });
}

/** Zeichnet die Stundentabelle ab startY und gibt die untere Y-Kante zurück. */
function drawTable(doc: jsPDF, sheet: Timesheet, startY: number, fontSize: number): number {
  const pad = 0.6;
  autoTable(doc, {
    startY,
    margin: { left: MARGIN, right: MARGIN },
    head: [["Datum", "Wochentag", "Arbeitsbeginn", "Arbeitsende", "Pause", "Arbeitszeit", "Bemerkung"]],
    body: tableBody(sheet),
    foot: [
      [
        { content: "Gesamtstunden", colSpan: 5, styles: { halign: "left" } },
        { content: sheet.totalText, styles: { halign: "center" } },
        "",
      ],
    ],
    theme: "grid",
    styles: {
      font: FONT,
      fontStyle: "normal",
      fontSize,
      cellPadding: { top: pad, bottom: pad, left: 1, right: 1 },
      lineColor: GRID,
      lineWidth: 0.15,
      textColor: INK,
      valign: "top",
      overflow: "linebreak",
    },
    headStyles: {
      font: FONT,
      fontStyle: "bold",
      fillColor: HEAD_FILL,
      textColor: INK,
      halign: "center",
    },
    footStyles: {
      font: FONT,
      fontStyle: "bold",
      fillColor: HEAD_FILL,
      textColor: INK,
    },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 22 },
      2: { cellWidth: 22, halign: "center" },
      3: { cellWidth: 22, halign: "center" },
      4: { cellWidth: 20, halign: "center" },
      5: { cellWidth: 22, halign: "center" },
      6: { cellWidth: CONTENT_W - 130, halign: "left", textColor: FAINT },
    },
    // Wochenende / Feiertag / geschlossen: Zeile grau hinterlegen.
    didParseCell: (data) => {
      if (data.section !== "body") return;
      if (sheet.rows[data.row.index]?.shaded) data.cell.styles.fillColor = SHADE_FILL;
    },
    // Split-Schicht (sáng/chiều): dünne Trennlinie zwischen den Teilen IM Feld.
    didDrawCell: (data) => {
      if (data.section !== "body" || data.column.index < 2) return;
      const n = sheet.rows[data.row.index]?.lines.length ?? 0;
      if (n < 2) return;
      const { x, y, width, height } = data.cell;
      const inner = height - 2 * pad;
      doc.setDrawColor(GRID[0], GRID[1], GRID[2]);
      doc.setLineWidth(0.1);
      for (let k = 1; k < n; k++) {
        const ly = y + pad + (inner * k) / n;
        doc.line(x, ly, x + width, ly);
      }
    },
  });
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

/** Zusammenfassung, Zuschläge und Unterschriften unter der Tabelle. */
function drawFooter(doc: jsPDF, sheet: Timesheet, startY: number): void {
  let y = startY + 6;
  const thirds = [MARGIN, MARGIN + CONTENT_W / 3, MARGIN + (2 * CONTENT_W) / 3];

  // Gesamtstunden / Sollstunden / Differenz.
  doc.setFontSize(9);
  setColor(doc, FAINT);
  doc.setFont(FONT, "normal");
  doc.text("Gesamtstunden", thirds[0], y);
  doc.text("Sollstunden", thirds[1], y);
  doc.text("Differenz", thirds[2], y);
  y += 5;
  setColor(doc, INK);
  doc.setFont(FONT, "bold");
  doc.text(`${sheet.totalText} h`, thirds[0], y);
  doc.setDrawColor(GRID[0], GRID[1], GRID[2]);
  doc.setLineWidth(0.2);
  doc.line(thirds[1], y, thirds[1] + 24, y); // Sollstunden: leer
  doc.line(thirds[2], y, thirds[2] + 24, y); // Differenz: leer

  // Zuschläge (nur Stundensumme).
  y += 8;
  doc.setDrawColor(GRID[0], GRID[1], GRID[2]);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, y - 3, A4_W - MARGIN, y - 3);
  doc.setFont(FONT, "bold");
  doc.setFontSize(8.5);
  setColor(doc, INK);
  doc.text("Zuschläge (nur Stundensumme)", MARGIN, y);
  y += 5;
  doc.setFont(FONT, "normal");
  setColor(doc, MUTED);
  doc.text(`Nachtzuschlag (Mo–Sa, ab 20:00): ${sheet.nightHoursText} h`, thirds[0], y);
  doc.text(`Sonntagszuschlag (Sonntag): ${sheet.sundayHoursText} h`, thirds[1], y);

  // Unterschriften.
  y += 16;
  const sig = ["Unterschrift Mitarbeiter", "Unterschrift Arbeitgeber", "Datum"];
  doc.setDrawColor(FAINT[0], FAINT[1], FAINT[2]);
  doc.setLineWidth(0.3);
  doc.setFontSize(8.5);
  setColor(doc, MUTED);
  for (let i = 0; i < 3; i++) {
    const x = thirds[i];
    doc.line(x, y, x + CONTENT_W / 3 - 8, y);
    doc.text(sig[i], x, y + 4);
  }
}

/** Eine A4-Seite (ein Mitarbeiter) zeichnen. */
function drawPage(doc: jsPDF, sheet: Timesheet): void {
  const infoBottom = drawHeader(doc, sheet);
  const tableTop = infoBottom + 3;
  // Platz für Fuß (Summe, Zuschläge, Unterschriften) freihalten.
  const footerReserve = 46;
  const available = A4_H - MARGIN - footerReserve - tableTop;
  const fontSize = pickTableFontSize(sheet, available);
  const tableBottom = drawTable(doc, sheet, tableTop, fontSize);
  drawFooter(doc, sheet, tableBottom);
}

/**
 * Baut das komplette Vektor-PDF (eine A4-Seite je Mitarbeiter) synchron und gibt
 * das jsPDF-Dokument zurück – ohne Ausliefern. Getrennt von der Auslieferung,
 * damit es in Tests und beim Erzeugen einer Musterdatei aufgerufen werden kann.
 */
export function buildStundenzettelDoc(
  schedule: Schedule,
  employees: Employee[],
  options: Pick<StundenzettelPdfOptions, "dates" | "periodLabel"> = {},
): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  registerFont(doc);
  employees.forEach((emp, i) => {
    if (i > 0) doc.addPage();
    drawPage(doc, buildTimesheet(schedule, emp, options.dates, options.periodLabel));
  });
  return doc;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

export type StundenzettelPdfOptions = {
  /** Nur diese Tage (Wochen-Stundenzettel); fehlend => ganzer Monat. */
  dates?: string[];
  /** Zeitraum-Text oben rechts; fehlend => Monat/Jahr. */
  periodLabel?: string;
  /** Fortschritt X/N während des Aufbaus (für die „Đang tạo…"-Anzeige). */
  onProgress?: (done: number, total: number) => void;
};

/**
 * Baut den Stundenzettel (eine A4-Seite je Mitarbeiter) als Vektor-PDF und
 * liefert die Datei aus. Seitenzahl = Mitarbeiterzahl.
 */
export async function stundenzettelToPdf(
  schedule: Schedule,
  employees: Employee[],
  filename: string,
  options: StundenzettelPdfOptions = {},
): Promise<void> {
  if (employees.length === 0) return;
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  registerFont(doc);

  const total = employees.length;
  for (let i = 0; i < total; i++) {
    if (i > 0) doc.addPage();
    const sheet = buildTimesheet(schedule, employees[i], options.dates, options.periodLabel);
    drawPage(doc, sheet);
    options.onProgress?.(i + 1, total);
    // Der Anzeige „X/N" Zeit zum Neuzeichnen geben (viele Mitarbeiter).
    if (i < total - 1) await nextFrame();
  }

  await deliver(doc.output("blob"), filename);
}

/**
 * Berührungsgerät (Handy/Tablet)? Nur DORT ist das System-Teilen-Menü der
 * richtige Weg. Am Rechner unterstützen Safari/Chrome navigator.share für
 * Dateien inzwischen ebenfalls – dann öffnete sich beim „Xuất PDF" das
 * Teilen-Menü (AirDrop, Nachrichten, Notizen …) STATT die Datei einfach
 * herunterzuladen. Deshalb wird geteilt nur bei grobem Zeiger (Touch), sonst
 * klassisch heruntergeladen.
 */
function isTouchDevice(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

/**
 * PDF ausliefern. Auf dem Handy NICHT einfach herunterladen: iOS Safari
 * ignoriert das download-Attribut und zeigt die PDF stattdessen nur an. Deshalb
 * dort zuerst das System-Teilen-Menü anbieten („In Dateien sichern", per Zalo/
 * Mail verschicken …). Am Rechner (feiner Zeiger/Maus) IMMER der klassische
 * Download in den Dateien-Ordner.
 */
async function deliver(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: "application/pdf" });

  if (isTouchDevice() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (err) {
      // Abbruch durch den Nutzer ist kein Fehler – dann gar nichts tun.
      if (err instanceof Error && err.name === "AbortError") return;
      // Sonst (z.B. abgelaufene Nutzerinteraktion) unten normal herunterladen.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
