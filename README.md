# Dienstplan & Stundenzettel — Miss Do

Johannisthaler Chaussee 317, 12351 Berlin. Abgeleitet aus der Glory-Duck-App
(davor Kylan, VietHaus, Mrson, DongDo) – die stabilste der bestehenden Apps.

**Vorgaben des Betriebs:**

- **Arbeitszeit 9:30–20:00, Montag bis Samstag**, ein durchgehender Block.
- **Sonntag geschlossen** – bis auf **12 verkaufsoffene Sonntage im Jahr**, die
  je Datum als Ausnahme in *Cài đặt* geöffnet werden. **Feiertage** (Berlin)
  sind geschlossen (Einzelhandel).
- **Pause**: Stammkräfte mit **7 oder 8 Stunden am Tag = 1 Stunde Pause**, über
  6 h 30 Minuten; **Minijob 30 Minuten**. Die Pause verlängert die Anwesenheit,
  sie wird nicht vom Soll abgezogen.
- **Samstag ist der stärkste Tag** – "Umsatz thứ 7 cao hơn 40% ngày thường
  nghĩa là gần gấp đôi". Die beiden Zahlen widersprechen sich; maßgeblich ist
  "fast doppelt", also steht der Samstag in `DAY_WEIGHTS` auf **1,8**.
- **Stoßzeiten**: mittags **11:00–14:00** und nachmittags **16:00–19:00**, an
  jedem Öffnungstag.
- **Reinigung als eigene Töpfe (Zuschlag)**, je Person in *Nhân viên*:
  - **Nachtzuschlag** – Reinigung nach Ladenschluss, **20:00–23:00**, höchstens
    3 h/Tag, Mo–Sa.
  - **Sonntagszuschlag** – Reinigung sonntags, 10:00–20:00, höchstens 8 h je
    Sonntag.
  Beides zählt NICHT gegen das normale Monats-Soll (`targetMinutes`), sondern
  gegen `nightMinutes` / `sundayMinutes`. Wird ein Reinigungs-Soll nicht ganz
  getroffen, ist das eine **Warnung**, kein Fehler.
- **Feste Arbeitstage je Person** (`availableWeekdays`) und **Höchstzahl an
  Arbeitstagen je Woche** (`maxDaysPerWeek`), beides in *Nhân viên*. Leer =
  keine Einschränkung.
- Belegschaft laut Screenshot: **14 Personen**. Minijob-Sollstunden sind aus dem
  Monatslohn abgeleitet (z. B. 308 € = 21,5 h) und auf ganze Stunden gerundet –
  der Plan besteht aus Diensten in ganzen Stunden, maßgeblich ist der Euro-Betrag.

> **Annahmen, die der Betrieb noch bestätigen sollte.** Die Personenzahl je
> Stoßzeit hat der Betrieb nicht genannt – gesetzt sind **mindestens 2** ohne
> Obergrenze (`PEAK_WINDOWS_BY_WEEKDAY`). Das Sonntags-Reinigungsfenster
> (10:00–20:00, max 8 h) und die Vereinfachung, dass die Sechs-Tage-Regel für
> die Reinigung nicht mitzählt, sind ebenfalls Annahmen. Jede steht an genau
> einer Stelle im Code.

Web-App zur **automatischen Erstellung monatlicher Dienstpläne** und **druckbarer
deutscher Stundenzettel** für ein Restaurant / Geschäft in Deutschland.

- Kein eigener Server, kein Solver, kein KI-Modell.
- Deterministischer, heuristischer Greedy-Algorithmus.
- Der Plan trifft **jedes monatliche Soll exakt** und lässt sich anschließend
  manuell bearbeiten.
- Persistenz: **LocalStorage** als Offline-Puffer, zusätzlich **Supabase**
  (`store_data`), sofern `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY`
  gesetzt sind. Alle Filialen teilen sich eine Tabelle und werden nur über
  `STORE_ID` getrennt (siehe `src/lib/supabase.ts`) – diese Kennung MUSS je
  Repo eindeutig sein.
- Einfache Passwortsperre im Client (`src/lib/auth.ts`), keine echte
  Zugriffskontrolle.

## Tech-Stack

React · TypeScript · Vite · Tailwind CSS · date-fns · Browser-Druck (PDF) ·
LocalStorage · Vitest.

## Installation & Start

```bash
npm install
npm run dev
```

Die App läuft danach unter der von Vite angezeigten URL (Standard
`http://localhost:5173`).

## Weitere Befehle

```bash
npm run test     # Unit-Tests (Vitest)
npm run build    # Produktions-Build (tsc + vite build)
npm run preview  # Produktions-Build lokal ansehen
```

## Bedienung

1. **Einstellungen** – Firmenname, Anschrift, Monat, Jahr; **Arbeitszeit-Fenster
   je Wochentag + Feiertag** (giờ làm; Standard: Mo–Sa 9:30–20:00, Sonntag
   geschlossen; mehrere Blöcke je Tag sind möglich).
   **Feiertage (Berlin)** werden automatisch erkannt
   und angezeigt. Unter **„Ngày đặc biệt"** lassen sich einzelne Tage
   überschreiben (geschlossen oder abweichende Zeiten, z.B. halber Tag).
2. **Mitarbeiter** – Vollzeit/Teilzeit und monatliche Sollstunden pflegen
   (Feld „Giờ định mức"); daneben steht, in wie viele Dienste sich das Soll
   zerlegen lässt.
3. **Dienstplan** – **„Dienstplan erstellen"** generiert den Monatsplan.
   Zellen sind anklickbar: Zeiten/Pause ändern, als *Frei* markieren,
   Schicht verschieben, hinzufügen, löschen. **„Auf Original zurücksetzen"**
   stellt den zuletzt generierten Plan wieder her. **CSV-Export** verfügbar.
4. **Stundenzettel** – druckbarer A4-Zettel je Mitarbeiter,
   einzeln oder alle (über den Druckdialog als PDF speichern).

## Geschäftsregeln (Kurzfassung)

Maßgeblich ist immer der Code; die Doku-Tabellen in der App (Tab **Tài liệu**)
werden direkt aus den Konstanten gerendert und können daher nicht veralten.

- Max. **9 bezahlte Stunden** pro Ladendienst, **ein Ladendienst** pro
  Mitarbeiter und Tag (Reinigung darf zusätzlich am selben Abend stehen).
- Höchstens **6 aufeinanderfolgende** Arbeitstage (Ladendienste).
- **Pause** (`calculatePause`): Stammkräfte ab 7 h = 60 Min, über 6 h = 30 Min;
  **Minijob 30 Min**. Das liegt auf/über dem ArbZG (§ 4); mehr Pause zu geben
  ist erlaubt, weniger nicht.
  Die Pause zählt **nicht** zum Soll, verlängert aber die Anwesenheit:
  `presence = paid + pause`. Eine 8-h-Schicht belegt damit 9 h und passt ins
  Fenster 9:30–20:00 (10,5 h).
- **Reinigung** (`scheduleZuschlag`): Nacht 20:00–23:00 (≤ 3 h/Tag, Mo–Sa) und
  Sonntag 10:00–20:00 (≤ 8 h). Eigene Töpfe (`nightMinutes`/`sundayMinutes`),
  getrennt vom Ladensoll; nicht ganz erreicht = Warnung.
- Schichtlängen: **3 bis 9 Stunden**.
  Etwa jede zehnte Schicht wird bewusst auf 4–5 h gekürzt
  (`SHORT_SHIFT_CHANCE`), damit die Pläne nicht mechanisch aussehen – aber nur,
  wenn der Tag keinen langen Dienst mehr für die Stoßzeit braucht.
- **Stoßzeiten** (`PEAK_WINDOWS_BY_WEEKDAY`, je Wochentag verschieden):
  **Fr/Sa 18:00–21:00, mindestens 2 Personen**, keine Obergrenze
  (`KEINE_OBERGRENZE`). An den übrigen Tagen ist keine Spitze hinterlegt.
  Geprüft wird über die **ganze Spanne**, nicht an einem einzelnen Zeitpunkt.
  - Der Apparat für eine **Obergrenze** ist vorhanden (`peakLengthCapHours`,
    `repairPeakExcess`) und stammt aus einer Filiale, die eine hat. Hier ist er
    schlicht nicht scharf gestellt – nennt der Betrieb später eine Höchstzahl,
    genügt der Wert in `PEAK_WINDOWS_BY_WEEKDAY`.
  - Reicht die Belegschaft für die 2 Personen nicht, bleibt der Plan gültig;
    das Dashboard weist die Tage als Warnung aus
    (`analyzeSchedule.peakViolations`).
- Nachfrage-Gewichte pro Wochentag (`DAY_WEIGHTS`): Montag ist der Anker mit
  1,0, **Fr/Sa stehen auf 2,0** – der doppelte Umsatz laut Betrieb. Die Tage
  dazwischen sind interpoliert, der **Sonntag ist geschätzt**. **Feiertage
  zählen wie Sonntag** (Nachfrage + Zeitfenster).
- **Arbeitszeit-Fenster je Tag** (giờ làm): Früh am Fenster-Beginn, Spät am
  Fenster-Ende. Geschlossene Tage bekommen keine Schicht; an verkürzten Tagen
  werden nur passende (kurze) Schichten geplant. Reicht das nicht, um beide
  Stoßzeiten zu decken, ordnet `layoutDayForPeaks` die Dienste innerhalb des
  Fensters neu an – Dauer und Pause bleiben dabei unverändert.
- **Sollstunden pflegt der Betrieb selbst** (Tab *Nhân viên*, Feld
  „Giờ định mức"). Ein Soll unter der kürzesten Schicht (3 h) ist nicht
  planbar und wird mit einer eigenen Meldung abgelehnt.

## Projektstruktur

```
src/
  types.ts                 zentrale Typen (intern immer Minuten als Integer)
  lib/
    time.ts                timeToMinutes, minutesToTime, calculatePause, ...
    shifts.ts              Schicht-Vorlagen (Früh/Spät)
    demand.ts              Tagesgewichte, Spätschicht-Quoten, Kalender
    splitTargetHours.ts    Zerlegung des Solls in Schichtlängen (DP)
    consecutive.ts         Ketten aufeinanderfolgender Tage, seeded RNG
    workHours.ts           Öffnungs-BLÖCKE je Tag (mehrere möglich) + Overrides
    holidays.ts            Berliner Feiertage (Osterformel/Computus)
    scheduler.ts           Greedy-Scheduler, Reparaturlauf, Stoßzeiten-Layout
    validation.ts          Prüfung aller Regeln
    analyze.ts             Auswertung: Stoßzeiten, Gewichtstreue, Abweichung
    storage.ts             LocalStorage
    supabase.ts            Client + STORE_ID dieser Filiale
    remote.ts              Laden/Speichern in store_data
    auth.ts                Passwortsperre (nur clientseitig)
    company.ts             Firmenname und Anschrift (fest)
    pdf.ts                 Druck/PDF des Stundenzettels
    sampleData.ts          Beispielbelegschaft (August 2026) – nur für Tests
    seedData.ts            drei Monate mit wechselnden Belegschaften (Tests)
    shiftOps.ts            manuelles Bearbeiten von Schichten
    dateFormat.ts          deutsche Monatsnamen / Formatierung
    __tests__/             Unit-Tests
  hooks/useSchedule.ts     zentrales State-Management + Persistenz
  components/              UI (Einstellungen, Mitarbeiter, Dienstplan, Stundenzettel)
```

## Tests

Getestet werden u. a. `timeToMinutes`, `minutesToTime`, `calculatePause`,
`calculatePaidMinutes`, `splitTargetHours`, die Berechnung aufeinanderfolgender
Tage und die Monats-Validierung.

`seedMonths.test.ts` fährt den Scheduler gegen **drei Monate mit
unterschiedlichen Belegschaften** und prüft: jedes Einzelsoll exakt, höchstens
6 Tage am Stück, Schichtlängen 3..9 h mit passender Pause, keine Schicht
außerhalb des Fensters – und beide Stoßzeiten durchgehend doppelt besetzt.
Diese letzte Prüfung gibt es doppelt: einmal über `minCoverageOver`, einmal als
stumpfe Gegenprobe, die **jede Minute einzeln nachzählt**. Wäre die Abtastung
falsch, meldete die Auswertung sonst fälschlich „alles grün".

`guards.test.ts` deckt die zwei Fälle ab, die der Betrieb durch eigene Eingaben
auslöst: ein Soll unter 3 h (eigene Fehlermeldung statt Kapazitäts-Vortrag) und
eine zu dünne Belegschaft (Plan bleibt korrekt, Lücken werden gemeldet).

Der Report in `seedMonths.test.ts` schreibt zusätzlich Schichtlängen-Verteilung,
Gewichtstreue je Wochentag und die Abweichung vom Tages-Soll auf die Konsole.

## Hinweise / Grenzen (MVP)

- Sollstunden aktuell in **ganzen Stunden**, mindestens 3 h.
- `Schedule` hält immer **genau einen Monat**. Es gibt kein Archiv über
  mehrere Monate; ein Monatswechsel ersetzt den Stand.
- Schicht-Vorlagen sind exakt vorgegeben für 10:00–22:00 und nur für
  pausenfreie Längen; sonst werden Früh-/Spät-Zeiten generisch abgeleitet.
- Der Plan ist „operativ plausibel", nicht mathematisch optimal. Die mittlere
  Abweichung vom rechnerischen Tages-Soll liegt in den Testmonaten bei 1–2 %.
