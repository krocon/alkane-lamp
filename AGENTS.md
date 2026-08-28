# Anweisungsdatei für Antigravity AI Agent (Alkane-Lamp Projekt)

Diese Datei enthält verbindliche Richtlinien, Architekturvorgaben und Best Practices für alle automatisierten Änderungen und Code-Generierungen in diesem Repository (`alkane-lamp`).

---

## 1. Grundprinzipien

### 1.1 Minimale & zielgerichtete Änderungen
- **Präzise Edits:** Führe nur Änderungen durch, die für die Erfüllung der jeweiligen Aufgabe zwingend erforderlich sind.
- **Keine unerwünschten Re-writes:** Vermeide es, funktionierenden Code oder ganze Dateien komplett neu zu schreiben, wenn punktuelle Anpassungen ausreichen.
- **Erhalte Struktur & Kommentare:** Bestehende Dokumentationen, Kommentare, JSDocs und Code-Strukturen müssen bewahrt und bei Bedarf angepasst werden.

### 1.2 Wartbarer & Sauberer Code (Clean Code)
- **Modulare Struktur:** Lagere wiederkehrende Geometrie- und Vektorberechnungen in übersichtliche Hilfsfunktionen aus.
- **Klarheit & Benennung:** Verwende sprechende Variablen- und Funktionsnamen in konsistentem Stil (TypeScript camelCase für Funktionen/Variablen).
- **Orchestrator-Muster:** Jedes Skript besitzt eine zentrale `run(_context: string): void`-Funktion als Einstiegspunkt, die den Ablauf logisch in nummerierte Schritte gliedert.

### 1.3 Robuste Fehlerbehandlung & Logging
- **Try...Catch-Blöcke:** Verpacke Skript-Hauptfunktionen stets in `try...catch`-Blöcke.
- **Benutzer-Feedback:** Gib kritische Fehlermeldungen sowohl über die Fusion 360 Benutzeroberfläche (`ui.messageBox`) als auch über die Konsole (`console.error`) aus.
- **Weiche Fallbacks:** Bei geometrisch unkritischen Nachbearbeitungen (z. B. optische Kantenfasen oder Fillets) sollten Fehler abgefangen und via `console.warn` protokolliert werden, damit nicht das gesamte Modell fehlschlägt, wenn eine Kante im BRep nicht eindeutig zugeordnet werden kann.

---

## 2. Repository- & Skript-Architektur

### 2.1 Ordnerstruktur für Fusion 360 Skripte
Jedes parametrische Skript befindet sich in einem eigenen Unterordner unter `fusion/scripts/<script-name>/` und enthält standardmäßig:
- `<script-name>.ts`: Die TypeScript-Implementierung des Bauteil-Generators.
- `<script-name>.manifest`: Die Fusion 360 Manifest-Datei (JSON) mit Metadaten (`autodeskProduct: "Fusion"`, `type: "script"`, `editEnabled: true`, `supportedOS: "windows|mac"`).
- `tsconfig.json`: Lokale TypeScript-Konfiguration, die auf das Root-Verzeichnis verweist (`{"extends": "../../../tsconfig.json"}`).
- `ScriptIcon.svg`: Das UI-Icon für den Fusion 360 Skript-Dialog.

*Regel bei neuen Skripten:* Werden neue Skripte angelegt, müssen Begleitdateien (`.manifest`, `tsconfig.json`, `ScriptIcon.svg`) vollständig und mit konsistentem Namen erstellt werden.

### 2.2 TypeScript-Konfiguration & Modul-Imports
- Verwende für Autodesk Fusion APIs konsistent die konfigurierten Pfade:
  ```typescript
  import { adsk } from "@adsk/fusion";
  ```
- Greife auf Node/FS-Module ausschließlich über die typisierten Definitionen unter `fusion/lib/API/TypeScript/` zu.

---

## 3. Parameter-Management (`UserParameters`)

### 3.1 Standardisiertes Setup-Pattern
Verwende in jedem Skript eine zentrale Funktion `setupParameters(design: adsk.fusion.Design)`, die existierende Parameter abruft oder neu erzeugt:
```typescript
function setupParameters(design: adsk.fusion.Design) {
  const params = design.userParameters;

  function getOrCreateParam(name: string, valueStr: string, unit: string, description: string): adsk.fusion.UserParameter {
    let p = params.itemByName(name);
    if (!p) {
      const valInput = adsk.core.ValueInput.createByString(valueStr);
      if (!valInput) {
        throw new Error(`Ungültiger Parameterwert für '${name}': ${valueStr}`);
      }
      p = params.add(name, valInput, unit, description);
      if (!p) {
        throw new Error(`Parameter '${name}' konnte nicht erstellt werden.`);
      }
    } else {
      try {
        p.expression = valueStr;
      } catch (_e) {
        // Falls Parameter existiert, aktuellen Wert beibehalten
      }
    }
    return p;
  }

  return {
    outerDiameter: getOrCreateParam('outer_diameter', '42.80mm', 'mm', 'Außendurchmesser'),
    innerDiameter: getOrCreateParam('inner_diameter', '36mm', 'mm', 'Innendurchmesser'),
    pipeLength: getOrCreateParam('pipe_length', '40mm', 'mm', 'Gesamtlänge des Rohres')
  };
}

type Params = ReturnType<typeof setupParameters>;
```

### 3.2 Wichtige Namenskonvention für Parameter (Kritisch!)
- **Ausschließlich `snake_case` verwenden:** Verwende für Fusion 360 Parameternamen ausschließlich Unterstriche (z. B. `outer_diameter`, `pipe_length`, `thread_clearance`).
- **Niemals Bindestriche nutzen:** Verwende **niemals** Bindestriche (z. B. `pipe-length`), da Fusion 360 den Bindestrich als Minus-Operator (`pipe minus length`) interpretiert und beim Erstellen des Parameters mit einem Syntaxfehler abbricht.

---

## 4. Fusion 360 API Spezifika & Best Practices

### 4.1 Strikte Typenkonformität
- Alle API-Aufrufe müssen konform zu den Typdefinitionen unter `fusion/lib/API/TypeScript/@adsk/fusion/fusion.d.ts` und `core.d.ts` sein.
- Keine Methoden halluzinieren. Überprüfe Methodensignaturen und Parameter immer in `fusion.d.ts`.

### 4.2 Einheiten-System & Maße
- **Standardeinheit:** Die interne Standard-Längeneinheit der Fusion 360 API ist **Zentimeter (cm)**.
- `userParam.value` gibt Längenwerte immer in **cm** zurück.
- Bei direkter Angabe von mm-Werten in Rechnungen muss durch `10.0` geteilt werden (z. B. `const radiusCm = (43.0 / 2.0) / 10.0`).
- Bei Übergabe via `ValueInput` können Ausdrücke mit Maßeinheit (`adsk.core.ValueInput.createByString('42.8mm')`) oder direkte cm-Reals (`adsk.core.ValueInput.createByReal(4.28)`) genutzt werden.

### 4.3 Versatzebenen (`ConstructionPlaneInput`)
- Erzeuge Versatzebenen direkt mit `adsk.core.ValueInput.createByReal(offsetInCm)`.
- *Wichtig:* Führe **keine mehrfachen `setByOffset`-Aufrufe** auf demselben `planeInput`-Objekt durch. Ein fehlerhafter Aufruf korrumpiert das `planeInput`-Objekt, woraufhin Fusion fälschlicherweise eine unversetzte Ebene durch den Ursprung `(0,0,0)` erzeugt.

### 4.4 2D-Skizzenkoordinaten & `modelToSketchSpace`
- 2D-Skizzenfunktionen (z. B. `sketchCircles.addByCenterRadius`) werten nur `x` und `y` des übergebenen `Point3D` aus. Die `z`-Koordinate wird ignoriert.
- Verwende für Punkte im 3D-Modellraum stets den vollständigen 3D-Punkt inkl. Ebenen-Offset und konvertiere ihn mit `sketch.modelToSketchSpace(...)` in den lokalen Skizzenraum:
  ```typescript
  const center3D = adsk.core.Point3D.create(holeOffsetCm, 0, holeHeightCm);
  const centerPoint = sketch.modelToSketchSpace(center3D);
  sketch.sketchCurves.sketchCircles.addByCenterRadius(centerPoint, radiusCm);
  ```

### 4.5 Profil- und BRep-Selektion
- **Ringprofile bei Hohlkörpern:** Wenn eine Skizze zwei konzentrische Kreise enthält, wähle das Profil mit `prof.profileLoops.count === 2` oder das Profil mit der größeren Fläche:
  ```typescript
  let pipeProfile: adsk.fusion.Profile | null = null;
  for (let i = 0; i < sketch.profiles.count; i++) {
    const prof = sketch.profiles.item(i);
    if (prof && prof.profileLoops.count === 2) {
      pipeProfile = prof;
      break;
    }
  }
  ```
- **Toleranzbasierte BRep-Selektion:** Vergleiche bei der Identifikation von BRep-Kanten (`BRepEdge`) oder Flächen (`BRepFace`) Radien und Positionen stets mit Toleranzen (`const TOL = 0.05; // 0.5 mm in cm`), niemals mit strikter Gleichheit (`===`).

### 4.6 Modellierte Gewinde & FDM-3D-Druck-Passungen
- **Gewindeerzeugung (`ThreadFeatures`):**
  - Nutze für gedruckte Gewinde stets `threadInput.isModeled = true` und `threadInput.isFullLength = true`.
  - Beispiel für metrisches ISO-Gewinde:
    ```typescript
    const threadInfo = threadFeatures.createThreadInfo(true, "ISO Metric Profile", "M40x2.5", "6H");
    const threadInput = threadFeatures.createInput(targetFace, threadInfo);
    threadInput.isModeled = true;
    ```
- **Gewindespiel via `OffsetFacesFeatures`:**
  - Im FDM-3D-Druck (z.B. Bambu Lab P2S) führen modellierte Gewinde ohne Spiel zu Schwergängigkeit.
  - Wende auf die resultierenden Gewindeflächen (`threadFeature.faces`) ein Offset-Faces-Feature mit negativem Spiel an (z. B. `thread_clearance = '-0.2mm'`):
    ```typescript
    const offsetFeatures = rootComp.features.offsetFacesFeatures;
    const offsetInput = offsetFeatures.createInput(facesToOffset, adsk.core.ValueInput.createByString(clearanceStr));
    if (offsetInput) offsetFeatures.add(offsetInput);
    ```

### 4.7 Fasen & Verrundungen (`ChamferFeatures` & `FilletFeatures`)
- Verwende für Fasen stets `chamferFeatures.createInput2()` (moderne API-Signatur).
- Sichere Fasen- und Fillet-Features mit Fallbacks ab:
  ```typescript
  let valInput = adsk.core.ValueInput.createByString('outer_chamfer');
  if (!valInput) {
    valInput = adsk.core.ValueInput.createByReal(chamferValCm);
  }
  chamferInput.chamferEdgeSets.addEqualDistanceChamferEdgeSet(edgeColl, valInput, true);
  ```

### 4.8 3D-Transformationen (`MoveFeatures`, `Matrix3D`)
- Führe Drehungen und Verschiebungen mathematisch exakt über `adsk.core.Matrix3D` und `adsk.core.Vector3D` durch:
  ```typescript
  const transform = adsk.core.Matrix3D.create();
  const centerPoint = adsk.core.Point3D.create(0, 0, totalHeightCm / 2.0);
  const axisVector = adsk.core.Vector3D.create(1, 0, 0); // X-Achse
  transform.setToRotation(Math.PI, axisVector, centerPoint); // 180° Drehung
  
  const moveInput = moveFeatures.createInput2(bodyColl);
  moveInput.defineAsFreeMove(transform);
  moveFeatures.add(moveInput);
  ```

---

## 5. Hilfsfunktionen (`Helper Utilities`)

Verwende für wiederkehrende Aufgaben standardisierte Hilfsfunktionen:
```typescript
/** Erzeugt eine Fusion 360 ObjectCollection aus Elementen oder Arrays */
function createCollection<T extends adsk.core.Base>(...items: (T | T[] | null | undefined)[]): adsk.core.ObjectCollection {
  const collection = adsk.core.ObjectCollection.create();
  for (const item of items) {
    if (!item) continue;
    if (Array.isArray(item)) {
      for (const subItem of item) {
        if (subItem) collection.add(subItem);
      }
    } else {
      collection.add(item);
    }
  }
  return collection;
}

/** Ermittelt den aktuellen Live-BRepBody aus rootComp.bRepBodies */
function getLiveBody(rootComp: adsk.fusion.Component, fallbackBody: adsk.fusion.BRepBody): adsk.fusion.BRepBody {
  if (rootComp.bRepBodies.count > 0) {
    const b = rootComp.bRepBodies.item(0);
    if (b) return b;
  }
  return fallbackBody;
}
```

---

## 6. Workflow & Verifikation

- **TypeScript-Kompilierung prüfen:** Führe nach Änderungen stets die Typprüfung im Projekt-Root aus:
  ```bash
  npm run typecheck
  ```
- **Alte Artefakte bereinigen:** Falls temporäre `.js`-Kompilate in `fusion/scripts/` liegen, entferne diese mit:
  ```bash
  npm run clean
  ```
- **Logische Verifikation:** Stelle sicher, dass Maße, Vorzeichen (z. B. Schnittrichtungen bei Extrusionen) und Toleranzen plausibel und konsistent zu den CAD-Spezifikationen sind.
