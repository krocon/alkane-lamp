import { adsk } from "@adsk/fusion";

const app = adsk.core.Application.get();
const ui = app ? app.userInterface : null;

/*

# TODO Konstuiere ein Inlet, welches in ein Rohr mit 43mm Innendurchmesser geschoben werden kann

arbeite nur an fusion/scripts/thread-inlet-m40x2_5-clearance-0_15/thread-inlet-m40x2_5-clearance-0_15.ts

## Definiere folgende Parameter
- stopperOuterDiameter: 46mm
- stopperlength: 2 mm
- pipesOuterDiameter: Außendurchmesser des Inlets an der Stopkante (mm)
- pipeLength: 60mm
- pipeInnerDiameter: 40mm
- pipeOuterDiameter: 43mm
- Gewinde: M40x2.5
- Gewindespiel : -0.15mm

## Konstuktionsschritte:
- Erzeuge auf xy-Ebene eine Skizze
- Zeichne 2 Kreise, pipeInnerDiameter und pipeInnerDiameter
- Extrudiere Ring um pipeLength
- Selektiere inner Röhre und erzeuge ein Gewinde von oben : M40x2.5, 6H, Rechts, Metrisch, volle Länge
- Selektiere die 4 Gewindeflächen und erzeuge Gewindespiel von -0.15mm (Drücken/Ziehen)
- selektiere die obere Röhrenstirn (ring) und erzeuge dort eine Skizze
- Zeichne dort einen Kreis von 43 mm.
- Extrusion des Rings mit -58mm (2mm - pipeLength)
- Grosser Step: erzeuge eine Riffelung an der Aussenseite der 43mm-Pipe-Bereichs, so dass sich das Inlet leicht in eine 43mm-große Rohre (PLA) schieben lässt.
- Großer Step 2: Fase am Gewindeeingang (dort, wo Stopper ist), damit schraube leichter reingeht.

## Siehe Bild im Analyseschnitt: so ungefähr ist die Erwartung

 */

/** Hauptfunktion (Orchestrator) */
export function run(_context: string): void {
  try {
    if (!app || !ui) {
      return;
    }

    const design = app.activeProduct as adsk.fusion.Design;
    if (!design) {
      ui.messageBox('Bitte öffnen Sie ein aktives Dokument.');
      return;
    }

    const rootComp = design.rootComponent;

    // 1. Parameter definieren
    const params = setupParameters(design);

    // 2. Create Inlet
    // const targetBody = createInlet(rootComp, params);
    // targetBody.name = 'thread-inlet-m40x2_5-clearance-0_15';

    console.log('Verbindungsröhre erfolgreich generiert!');

  } catch (e) {
    console.error(`Failed: ${e}`);
    if (ui) {
      ui.messageBox(`Kritischer Fehler beim Ausführen des Scripts:\n${e}`);
    }
  }
}

/**
 * Richtet die Benutzerparameter in Fusion 360 ein oder ruft bestehende ab.
 * Ermöglicht die dynamische Steuerung der Geometrie über die Parameter-Liste.
 *
 * @param design Das aktive Fusion 360 Design-Objekt.
 * @returns Ein Objekt mit allen relevanten UserParameters.
 */
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
    }
    return p;
  }

  return {
    stopperOuterDiameter: getOrCreateParam('stopper_outer_diameter', '46mm', 'mm', 'Außendurchmesser des Inlets an der Stopkante'),
  };
}

