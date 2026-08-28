import { adsk } from "@adsk/fusion";

const app = adsk.core.Application.get();
const ui = app ? app.userInterface : null;

/**
 * @file alkane-lamp-connector-pipe-43mm.ts
 * @description Fusion 360 Skript zur Erzeugung eines Verbindungsrohres (Connector Pipe 43mm)
 * für die Alkane-Lamp Baugruppe (optimiert für den FDM-3D-Druck auf Bambu Lab P2S).
 *
 * ## Technische CAD-Kennwerte:
 * - Außendurchmesser (outer_diameter): 42.80 mm (Nennmaß 43.0 mm mit -0.20 mm Passungsspiel)
 * - Innendurchmesser (inner_diameter): 36.00 mm
 * - Gesamtlänge (pipe_length): 40.00 mm
 * - Äußere Einführfase (outer_chamfer): 1.00 mm an den äußeren Mantelkanten
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

    // 1. Parameter definieren / abrufen
    const params = setupParameters(design);

    // 2. Verbindungsrohr erzeugen
    const targetBody = createConnectorPipe(rootComp, params);
    targetBody.name = 'connector-pipe-43mm';

    console.log('Verbindungsrohr (Connector Pipe 43mm, AD=42.8mm, ID=36mm, L=40mm, Fase=1mm) erfolgreich generiert!');

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
    outerDiameter: getOrCreateParam('outer_diameter', '42.80mm', 'mm', 'Außendurchmesser des Rohres (43mm Nennmaß - 0.20mm Spiel)'),
    innerDiameter: getOrCreateParam('inner_diameter', '36mm', 'mm', 'Innendurchmesser des Rohres'),
    pipeLength: getOrCreateParam('pipe_length', '40mm', 'mm', 'Gesamtlänge des Verbindungsrohres'),
    outerChamfer: getOrCreateParam('outer_chamfer', '1mm', 'mm', 'Fase an den äußeren Kanten des Rohres')
  };
}

type Params = ReturnType<typeof setupParameters>;

/**
 * Erzeugt den zylindrischen Rohrkörper und fasst die äußeren Kanten leicht an.
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param params Das Objekt mit den benutzerdefinierten Parametern.
 * @returns Der erzeugte 3D-Körper (BRepBody).
 */
function createConnectorPipe(
  rootComp: adsk.fusion.Component,
  params: Params
): adsk.fusion.BRepBody {
  const extrudeFeatures = rootComp.features.extrudeFeatures;
  const sketches = rootComp.sketches;
  const center3D = adsk.core.Point3D.create(0, 0, 0);

  // Radien in cm für Fusion 360 API
  const outerRadiusCm = params.outerDiameter.value / 2.0;
  const innerRadiusCm = params.innerDiameter.value / 2.0;
  const pipeLenCm = params.pipeLength.value;

  if (outerRadiusCm <= innerRadiusCm) {
    throw new Error('Der Außendurchmesser muss größer sein als der Innendurchmesser.');
  }

  // 1. Skizze auf der XY-Konstruktionsebene
  const sketchXY = sketches.add(rootComp.xYConstructionPlane);
  const centerXY = sketchXY.modelToSketchSpace(center3D);

  sketchXY.sketchCurves.sketchCircles.addByCenterRadius(centerXY, innerRadiusCm);
  sketchXY.sketchCurves.sketchCircles.addByCenterRadius(centerXY, outerRadiusCm);

  // Ringprofil zwischen Innen- und Außendurchmesser finden
  let pipeProfile: adsk.fusion.Profile | null = null;
  for (let i = 0; i < sketchXY.profiles.count; i++) {
    const prof = sketchXY.profiles.item(i);
    if (prof && prof.profileLoops.count === 2) {
      pipeProfile = prof;
      break;
    }
  }

  if (!pipeProfile && sketchXY.profiles.count >= 2) {
    const p0 = sketchXY.profiles.item(0);
    const p1 = sketchXY.profiles.item(1);
    if (p0 && p1) {
      pipeProfile = p0.areaProperties().area < p1.areaProperties().area ? p1 : p0;
    }
  }

  if (!pipeProfile && sketchXY.profiles.count === 1) {
    pipeProfile = sketchXY.profiles.item(0);
  }

  if (!pipeProfile) {
    throw new Error('Konnte das Ringprofil für das Rohr nicht ermitteln.');
  }

  // 2. Extrusion des Rohrkörpers
  const extInput = extrudeFeatures.createInput(
    pipeProfile,
    adsk.fusion.FeatureOperations.NewBodyFeatureOperation
  );

  let distInput = adsk.core.ValueInput.createByString('pipe_length');
  if (!distInput) {
    distInput = adsk.core.ValueInput.createByReal(pipeLenCm);
  }
  extInput.setDistanceExtent(false, distInput);

  const extFeature = extrudeFeatures.add(extInput);
  if (!extFeature || extFeature.bodies.count === 0) {
    throw new Error('Erzeugung des Rohrkörpers fehlgeschlagen.');
  }

  const targetBody = extFeature.bodies.item(0);

  // 3. Äußere Kanten leicht anfasen
  applyOuterChamfers(rootComp, targetBody, outerRadiusCm, params);

  return targetBody;
}

/**
 * Bringt eine leichte Fase an den äußeren Ringkanten des Rohres an.
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param targetBody Der erzeugte Rohrkörper.
 * @param outerRadiusCm Der Außenradius in cm.
 * @param params Das Parameter-Objekt.
 */
function applyOuterChamfers(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody,
  outerRadiusCm: number,
  params: Params
): void {
  const chamferValCm = params.outerChamfer.value;
  if (chamferValCm <= 0) return;

  const edgeColl = adsk.core.ObjectCollection.create();

  // Suche alle kreisförmigen Außenkanten des Rohres (Radius nahe outerRadiusCm)
  for (let i = 0; i < targetBody.edges.count; i++) {
    const edge = targetBody.edges.item(i);
    if (edge && edge.geometry.curveType === adsk.core.Curve3DTypes.Circle3DCurveType) {
      const circ = edge.geometry as adsk.core.Circle3D;
      const radiusDiff = Math.abs(circ.radius - outerRadiusCm);
      const isCentered = Math.abs(circ.center.x) < 0.05 && Math.abs(circ.center.y) < 0.05;

      if (radiusDiff < 0.05 && isCentered) {
        edgeColl.add(edge);
      }
    }
  }

  if (edgeColl.count > 0) {
    try {
      const chamferFeatures = rootComp.features.chamferFeatures;
      const chamferInput = chamferFeatures.createInput2();
      if (chamferInput) {
        let valInput = adsk.core.ValueInput.createByString('outer_chamfer');
        if (!valInput) {
          valInput = adsk.core.ValueInput.createByReal(chamferValCm);
        }
        chamferInput.chamferEdgeSets.addEqualDistanceChamferEdgeSet(edgeColl, valInput, true);
        chamferFeatures.add(chamferInput);
        console.log(`Fase an ${edgeColl.count} Außenkanten erfolgreich angewendet.`);
      }
    } catch (e) {
      console.warn(`Warnung beim Anfasen der Außenkanten: ${e}`);
      // Fallback mit absolutem cm-Wert versuchen
      try {
        const chamferFeatures = rootComp.features.chamferFeatures;
        const fallbackInput = chamferFeatures.createInput2();
        if (fallbackInput) {
          fallbackInput.chamferEdgeSets.addEqualDistanceChamferEdgeSet(
            edgeColl,
            adsk.core.ValueInput.createByReal(chamferValCm),
            true
          );
          chamferFeatures.add(fallbackInput);
          console.log(`Fallback-Fase an Außenkanten erfolgreich angewendet.`);
        }
      } catch (err2) {
        console.warn(`Fallback beim Anfasen ebenfalls fehlgeschlagen: ${err2}`);
      }
    }
  } else {
    console.warn('Keine Außenkanten für die Fase gefunden.');
  }
}
