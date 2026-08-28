import { adsk } from "@adsk/fusion";

const app = adsk.core.Application.get();
const ui = app ? app.userInterface : null;

/**
 * @file thread-inlet-m40x2_5.ts
 * @description Fusion 360 Skript zur Erzeugung einer dauerhaft festsitzenden Steckverbindung
 * für ein PLA-Rohr mit 43.0 mm Nenn-Innendurchmesser (optimiert für FDM-3D-Druck auf Bambu Lab P2S).
 *
 * ## Konstruktionsprinzip & FDM-Optimierung:
 * - Glatter zylindrischer Schaft (keine Klemmrippen)
 * - Nenn-Außendurchmesser: 43.0 mm
 * - Außendurchmesser-Passungsspiel (outer_clearance): -0.2 mm (effektiver Außendurchmesser 42.8 mm)
 * - Konische Einführzone (3.0 mm Länge am Rohreingang) für leichte Montage
 * - M40x2.5 Innengewinde mit -0.2 mm Gewindespiel (thread_clearance via Offset Faces) für leichtgängiges Einschrauben
 * - 1.0 mm Fase am Gewindeeingang der Stopperseite
 *
 * ## Technische CAD-Kennwerte:
 * - Nenn-Außendurchmesser: 43.0 mm
 * - Passungsspiel Außendurchmesser: -0.2 mm -> Effektiver Außendurchmesser: 42.8 mm
 * - Gewindespiel (thread_clearance): -0.2 mm
 * - Stopper-Außendurchmesser: 46.0 mm
 * - Gesamtlänge: 40.0 mm
 * - Einführfase / Anlaufzone: 3.0 mm konischer Übergang
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

    // 2. Inlet mit glattem Schaft, Einführzone, Innengewinde & Gewindespiel erzeugen
    const targetBody = createInlet(rootComp, params);
    targetBody.name = 'thread-inlet-m40x2_5-fit-43mm';

    console.log('Thread-Inlet M40x2.5 (Passung 43.0mm Rohr, Außendurchmesser 42.8mm, thread_clearance -0.2mm) erfolgreich generiert!');

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
    stopperOuterDiameter: getOrCreateParam('stopper_outer_diameter', '48mm', 'mm', 'Außendurchmesser der Stopkante'),
    stopperLength: getOrCreateParam('stopper_length', '22mm', 'mm', 'Länge/Dicke der Stopkante'),
    pipeLength: getOrCreateParam('pipe_length', '40mm', 'mm', 'Gesamtlänge des Inlets'),
    pipeInnerDiameter: getOrCreateParam('pipe_inner_diameter', '40mm', 'mm', 'Innendurchmesser des Inlets (Gewindebohrung)'),
    tubeInnerDiameter: getOrCreateParam('tube_inner_diameter', '43mm', 'mm', 'Nenn-Innendurchmesser des Aufnahme-Rohres (43.0mm)'),
    outerDiameter: getOrCreateParam('outer_diameter', '43mm', 'mm', 'Nenn-Außendurchmesser des Inlets (43.0mm)'),
    outerClearance: getOrCreateParam('outer_clearance', '-0.2mm', 'mm', 'Passung/Spiel Außendurchmesser (-0.2mm)'),
    leadInLength: getOrCreateParam('lead_in_length', '3mm', 'mm', 'Länge der konischen Einführzone am Rohreingang'),
    threadClearance: getOrCreateParam('thread_clearance', '-0.2mm', 'mm', 'Gewindespiel (Drücken/Ziehen)'),
    threadChamfer: getOrCreateParam('thread_chamfer', '1mm', 'mm', 'Fase am Gewindeeingang an der Stopperseite')
  };
}

/**
 * Erzeugt das vollständige Thread-Inlet gemäß allen FDM-Passungsanforderungen.
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param params Das Objekt mit den benutzerdefinierten Parametern.
 * @returns Der erzeugte 3D-Körper (BRepBody).
 */
function createInlet(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>
): adsk.fusion.BRepBody {
  const extrudeFeatures = rootComp.features.extrudeFeatures;
  const sketches = rootComp.sketches;
  const center3D = adsk.core.Point3D.create(0, 0, 0);

  // Dimensionen in Zentimeter (Fusion 360 API Standardeinheit)
  const stopperOD = params.stopperOuterDiameter.value; // e.g. 4.6 cm
  const stopperLen = params.stopperLength.value; // e.g. 0.2 cm
  const pipeLen = params.pipeLength.value; // e.g. 4.0 cm
  const pipeID = params.pipeInnerDiameter.value; // e.g. 4.0 cm
  const outerDiameterCm = params.outerDiameter.value + params.outerClearance.value; // e.g. 4.3 + (-0.02) = 4.28 cm (42.8mm)
  const outerRadiusCm = outerDiameterCm / 2.0; // 2.14 cm
  const leadInLen = params.leadInLength.value; // e.g. 0.3 cm
  const clearanceStr = params.threadClearance.expression || '-0.2mm';

  // 1. Skizze auf XY-Ebene für den Stopperflansch (0 bis stopperLen = 2mm)
  const sketchXY = sketches.add(rootComp.xYConstructionPlane);
  const centerXY = sketchXY.modelToSketchSpace(center3D);

  sketchXY.sketchCurves.sketchCircles.addByCenterRadius(centerXY, pipeID / 2.0);
  sketchXY.sketchCurves.sketchCircles.addByCenterRadius(centerXY, stopperOD / 2.0);

  let stopperProfile: adsk.fusion.Profile | null = null;
  for (let i = 0; i < sketchXY.profiles.count; i++) {
    const prof = sketchXY.profiles.item(i);
    if (prof && prof.profileLoops.count === 2) {
      stopperProfile = prof;
      break;
    }
  }

  if (!stopperProfile && sketchXY.profiles.count >= 2) {
    const p0 = sketchXY.profiles.item(0);
    const p1 = sketchXY.profiles.item(1);
    if (p0 && p1) {
      stopperProfile = p0.areaProperties().area < p1.areaProperties().area ? p1 : p0;
    }
  }

  if (!stopperProfile) {
    throw new Error('Konnte das Ringprofil für den Stopperflansch nicht ermitteln.');
  }

  const extInputStopper = extrudeFeatures.createInput(
    stopperProfile,
    adsk.fusion.FeatureOperations.NewBodyFeatureOperation
  );
  extInputStopper.setDistanceExtent(false, adsk.core.ValueInput.createByReal(stopperLen));

  const stopperFeature = extrudeFeatures.add(extInputStopper);
  if (!stopperFeature || stopperFeature.bodies.count === 0) {
    throw new Error('Erzeugung des Stopperflansches fehlgeschlagen.');
  }
  const targetBody = stopperFeature.bodies.item(0);

  // 2. Glatten zylindrischen Schaft erzeugen (von Z = stopperLen bis Z = pipeLen, d.h. 2mm bis 40mm)
  createShaft(rootComp, stopperLen, pipeLen - stopperLen, pipeID / 2.0, outerRadiusCm);

  // 3. Konische Einführzone (3mm Lead-In Chamfer am Z=40mm Ende)
  createLeadInChamfer(rootComp, pipeLen, leadInLen, outerRadiusCm);

  // 4. M40x2.5 Innengewinde mit -0.2mm Spiel (Offset Faces)
  addInternalThreadAndClearance(rootComp, targetBody, pipeID / 2.0, clearanceStr);

  // 5. Gewindeeingangs-Fase (1mm) an der Stopper-Unterseite (Z = 0)
  addEntranceChamfer(rootComp, targetBody, params.threadChamfer.value);

  return targetBody;
}

/**
 * Erzeugt den glatten zylindrischen Hauptschaft des Inlets (ohne Klemmrippen).
 */
function createShaft(
  rootComp: adsk.fusion.Component,
  startZCm: number,
  shaftLenCm: number,
  innerRadiusCm: number,
  outerRadiusCm: number
): void {
  const extrudeFeatures = rootComp.features.extrudeFeatures;
  const sketches = rootComp.sketches;

  // Versatzebene bei Z = startZCm (2mm)
  const planeInput = rootComp.constructionPlanes.createInput();
  planeInput.setByOffset(
    rootComp.xYConstructionPlane,
    adsk.core.ValueInput.createByReal(startZCm)
  );
  const shaftPlane = rootComp.constructionPlanes.add(planeInput);
  const sketch = sketches.add(shaftPlane);

  const center3D = adsk.core.Point3D.create(0, 0, startZCm);
  const centerPt = sketch.modelToSketchSpace(center3D);

  // Innere Durchgangsbohrung (40mm ID) & äußere Zylinderwand
  sketch.sketchCurves.sketchCircles.addByCenterRadius(centerPt, innerRadiusCm);
  sketch.sketchCurves.sketchCircles.addByCenterRadius(centerPt, outerRadiusCm);

  // Ringprofil zwischen innerer Bohrung und der Außenwand finden
  let shaftProfile: adsk.fusion.Profile | null = null;
  for (let i = 0; i < sketch.profiles.count; i++) {
    const prof = sketch.profiles.item(i);
    if (prof && prof.profileLoops.count === 2) {
      shaftProfile = prof;
      break;
    }
  }

  if (!shaftProfile && sketch.profiles.count >= 2) {
    const p0 = sketch.profiles.item(0);
    const p1 = sketch.profiles.item(1);
    if (p0 && p1) {
      shaftProfile = p0.areaProperties().area < p1.areaProperties().area ? p1 : p0;
    }
  }

  if (!shaftProfile && sketch.profiles.count === 1) {
    shaftProfile = sketch.profiles.item(0);
  }

  if (!shaftProfile) {
    throw new Error('Profil für den Schaft konnte nicht ermittelt werden.');
  }

  // Schaft extrudieren und mit dem Stopperflansch verbinden (Join)
  const extInputShaft = extrudeFeatures.createInput(
    shaftProfile,
    adsk.fusion.FeatureOperations.JoinFeatureOperation
  );
  extInputShaft.setDistanceExtent(false, adsk.core.ValueInput.createByReal(shaftLenCm));
  extrudeFeatures.add(extInputShaft);
}

/**
 * Erzeugt eine konische Einführzone (Lead-In Chamfer) am oberen Ende des Inlets (Z = 40mm),
 * damit das Inlet sanft und zentriert in das Rohr eingeführt werden kann.
 */
function createLeadInChamfer(
  rootComp: adsk.fusion.Component,
  totalLengthCm: number,
  leadInLenCm: number,
  outerRadiusCm: number
): void {
  if (leadInLenCm <= 0) return;

  const revolveFeatures = rootComp.features.revolveFeatures;
  const sketches = rootComp.sketches;

  // Skizze auf der XZ-Ebene für den 360°-Revolve Cut der Einführfase
  const sketch = sketches.add(rootComp.xZConstructionPlane);

  const topZ = totalLengthCm;
  const bottomZ = totalLengthCm - leadInLenCm;

  // Dreieckselement für den konischen Anschnitt am Z=40mm Ende:
  const rOuterCut = outerRadiusCm + 0.3; // großzügige äußere Schnittgrenze
  const rInnerCut = outerRadiusCm - 0.15; // verjüngter Anschnitt am Rohreingang (~38.8mm OD)

  const p1_3D = adsk.core.Point3D.create(rOuterCut, 0, bottomZ);
  const p2_3D = adsk.core.Point3D.create(rOuterCut, 0, topZ + 0.1);
  const p3_3D = adsk.core.Point3D.create(rInnerCut, 0, topZ + 0.1);

  const p1 = sketch.modelToSketchSpace(p1_3D);
  const p2 = sketch.modelToSketchSpace(p2_3D);
  const p3 = sketch.modelToSketchSpace(p3_3D);

  const lines = sketch.sketchCurves.sketchLines;
  lines.addByTwoPoints(p1, p2);
  lines.addByTwoPoints(p2, p3);
  lines.addByTwoPoints(p3, p1);

  if (sketch.profiles.count === 0) return;
  const cutProfile = sketch.profiles.item(0);

  const revInput = revolveFeatures.createInput(
    cutProfile,
    rootComp.zConstructionAxis,
    adsk.fusion.FeatureOperations.CutFeatureOperation
  );
  revInput.setAngleExtent(false, adsk.core.ValueInput.createByString('360 deg'));
  revolveFeatures.add(revInput);
}

/**
 * Erstellt ein Innengewinde M40x2.5 (volle Länge) an der Innenwand der Röhre
 * und wendet ein Gewindespiel von -0.2mm via Drücken/Ziehen (Offset Faces) an.
 */
function addInternalThreadAndClearance(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody,
  innerRadiusCm: number,
  clearanceStr: string
): void {
  const threadFeatures = rootComp.features.threadFeatures;

  // Innere Zylinderfläche selektieren (Fläche mit minimaler Abweichung zum Innendurchmesser)
  let targetFace: adsk.fusion.BRepFace | null = null;
  let minDiff = Number.MAX_VALUE;

  for (let i = 0; i < targetBody.faces.count; i++) {
    const face = targetBody.faces.item(i);
    if (face && face.geometry.surfaceType === adsk.core.SurfaceTypes.CylinderSurfaceType) {
      const cyl = face.geometry as adsk.core.Cylinder;
      const diff = Math.abs(cyl.radius - innerRadiusCm);
      if (diff < minDiff) {
        minDiff = diff;
        targetFace = face;
      }
    }
  }

  if (!targetFace || minDiff > 0.05) {
    throw new Error(`Innenfläche für das Gewinde (Radius ca. ${(innerRadiusCm * 10).toFixed(1)}mm) wurde nicht gefunden.`);
  }

  // Gewinde-Parameter: M40x2.5, 6H, Rechts, Metrisch, volle Länge
  const threadInfo = threadFeatures.createThreadInfo(true, "ISO Metric Profile", "M40x2.5", "6H");
  const threadInput = threadFeatures.createInput(targetFace, threadInfo);
  threadInput.isFullLength = true;
  threadInput.isModeled = true;

  const threadFeature = threadFeatures.add(threadInput);
  if (!threadFeature) {
    throw new Error('Fehler beim Erstellen des Gewinde-Features.');
  }

  // Gewindeflächen selektieren und Gewindespiel (-0.25mm) via Drücken/Ziehen anwenden
  const facesToOffset: adsk.fusion.BRepFace[] = [];
  for (let i = 0; i < threadFeature.faces.count; i++) {
    const f = threadFeature.faces.item(i);
    if (f) {
      facesToOffset.push(f);
    }
  }

  if (facesToOffset.length > 0) {
    const offsetFeatures = rootComp.features.offsetFacesFeatures;
    const offsetInput = offsetFeatures.createInput(
      facesToOffset,
      adsk.core.ValueInput.createByString(clearanceStr)
    );
    if (offsetInput) {
      offsetFeatures.add(offsetInput);
    }
  }
}

/**
 * Erzeugt eine Fase am Gewindeeingang am Stopper-Ende (Z = 0),
 * damit die Schraube leicht angesetzt und eingedreht werden kann.
 */
function addEntranceChamfer(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody,
  chamferValCm: number
): void {
  if (chamferValCm <= 0) return;

  // Suche die Kante der Gewindebohrung an der Stopper-Unterseite (Z = 0)
  let entranceEdge: adsk.fusion.BRepEdge | null = null;

  for (let i = 0; i < targetBody.edges.count; i++) {
    const edge = targetBody.edges.item(i);
    if (edge && edge.geometry.curveType === adsk.core.Curve3DTypes.Circle3DCurveType) {
      const circ = edge.geometry as adsk.core.Circle3D;
      if (Math.abs(circ.center.z) < 0.05 && Math.abs(circ.center.x) < 0.05 && Math.abs(circ.center.y) < 0.05) {
        if (circ.radius >= 1.7 && circ.radius <= 2.1) {
          entranceEdge = edge;
          break;
        }
      }
    }
  }

  if (!entranceEdge) {
    for (let i = 0; i < targetBody.edges.count; i++) {
      const edge = targetBody.edges.item(i);
      if (edge && edge.geometry.curveType === adsk.core.Curve3DTypes.Circle3DCurveType) {
        const circ = edge.geometry as adsk.core.Circle3D;
        if (Math.abs(circ.center.z) < 0.05 && circ.radius < 2.2) {
          entranceEdge = edge;
          break;
        }
      }
    }
  }

  if (entranceEdge) {
    try {
      const chamferFeatures = rootComp.features.chamferFeatures;
      const chamferInput = chamferFeatures.createInput2();
      if (chamferInput) {
        const edgeColl = adsk.core.ObjectCollection.create();
        edgeColl.add(entranceEdge);

        let valInput = adsk.core.ValueInput.createByString('thread_chamfer');
        if (!valInput) {
          valInput = adsk.core.ValueInput.createByReal(chamferValCm);
        }
        chamferInput.chamferEdgeSets.addEqualDistanceChamferEdgeSet(edgeColl, valInput, true);
        chamferFeatures.add(chamferInput);
        console.log("Gewindeeingang-Fase am Stopper erfolgreich erstellt.");
      }
    } catch (e) {
      console.warn(`Fehler beim Erstellen der Gewindeeingangs-Fase: ${e}`);
    }
  } else {
    console.warn("Konnte die Gewindeeingangs-Kante am Stopper für die Fase nicht identifizieren.");
  }
}
