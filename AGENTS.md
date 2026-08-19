# Anweisungsdatei für Antigravity AI Agent (Alkane-Lamp Projekt)

Diese Datei enthält Richtlinien und Best Practices für alle automatisierten Änderungen und Code-Generierungen in diesem Repository (`alkane-lamp`).

---

## 1. Grundprinzipien

### 1.1 Minimale & zielgerichtete Änderungen
- **Präzise Edits:** Führe nur Änderungen durch, die für die Erfüllung der jeweiligen Aufgabe zwingend erforderlich sind.
- **Keine unerwünschten Re-writes:** Vermeide es, funktionierenden Code oder ganze Dateien komplett neu zu schreiben, wenn punktuelle Anpassungen ausreichen.
- **Erhalte Struktur & Kommentare:** Bestehende Dokumentationen, Kommentare und Code-Strukturen müssen bewahrt und bei Bedarf angepasst werden.

### 1.2 Wartbarer & Sauberer Code (Clean Code)
- **Modulare Struktur:** Lagere wiederkehrende Geometrie- und Vektorberechnungen in übersichtliche Hilfsfunktionen aus.
- **Klarheit & Benennung:** Verwende sprechende Variablen- und Funktionsnamen in konsistentem Stil.
- **Fehlerbehandlung:** Verpacke Skript-Hauptfunktionen stets in `try...catch`-Blöcke und gib verständliche Fehlermeldungen über die Fusion 360 Benutzeroberfläche (`ui.messageBox`) und die Konsole aus.
- **Parametrisierbarkeit:** Halte Dimensionen und Modellparameter konfigurierbar (z.B. in `UserParameters` oder zentralen Parameter-Objekten).

---

## 2. Berücksichtigung der Fusion 360 API (`fusion.d.ts`)

### 2.1 Strikte Typenkonformität
- **Verwendung der Typendateien:** Alle Fusion-API-Zugriffe müssen konform zu den TypeScript-Typdefinitionen unter `fusion/lib/API/TypeScript/@adsk/fusion/` (insbesondere `fusion.d.ts`, `core.d.ts` etc.) sein.
- **Keine Halluzination von API-Methoden:** Überprüfe bei Unsicherheit bezüglich Methodennamen, Parameter-Reihenfolgen oder Rückgabetypen immer die echten Typdefinitionen in `fusion/lib/API/TypeScript/@adsk/fusion/fusion.d.ts`.
- **Import-Pfade:** Importiere Fusion 360 Typen und Module konsistent über die vorgegebenen Aliases (z.B. `import { adsk } from "@adsk/fusion";`).

### 2.2 Fusion 360 Spezifika
- **Einheiten:** Beachte, dass die interne Standardeinheit der Fusion 360 API für Längen **Zentimeter (cm)** ist. Verwende `adsk.core.ValueInput.createByString('... mm')` oder konvertiere mm-Werte korrekt durch Division mit `10`.
- **API-Struktur:** Achte auf die korrekte Trennung von `adsk.core` (Anwendung, UI, Geometrie-Primitiven wie Matrix3D, Point3D) und `adsk.fusion` (Design, Components, Features, BRepBody).
- **Transformationen & Ausrichtung:** Nutze für 3D-Ausrichtungen präzise Vektor- und Matrixberechnungen (`adsk.core.Matrix3D`, `adsk.core.Vector3D`) statt ungenauer Winkelannahmen.

---

## 3. Workflow & Verifikation

- **TypeScript-Kompilierung:** Stelle sicher, dass erstelle oder geänderte Skripte mit der im jeweiligen Ordner liegenden `tsconfig.json` typsicher kompilieren.
- **Verifizierung:** Teste und überprüfe Änderungen logisch, um sicherzustellen, dass keine Syntax- oder Typfehler vorliegen.
