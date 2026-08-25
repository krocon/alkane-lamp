import { adsk } from "@adsk/fusion";

const app = adsk.core.Application.get();
const ui = app ? app.userInterface : null;

/**
 * @file thread-inlet-m40x2_5-clearance-0_15.ts
 * @description Fusion 360 Skript zur Erzeugung einer dauerhaft festsitzenden, verdrehsicheren
 * Steckverbindung für ein PLA-Rohr mit exakt 42.0 mm Innendurchmesser (optimiert für FDM-3D-Druck auf Bambu Lab P2S).
 *
 * ## Konstruktionsprinzip & FDM-Optimierung:
 * - 8 gerundete Längs-Klemmrippen mit weicher cos^4-Wölbung (keine scharfen Kanten, keine Kerbwirkung)
 * - Nenn-Innendurchmesser des Rohres: 42.0 mm
 * - Außendurchmesser des Inlet-Grundkörpers: 41.2 mm (0.8 mm Durchmesser-Spiel zur Reduzierung von Reibung)
 * - Außendurchmesser über den 8 Klemmrippen: 42.85 mm (< 43.00 mm)
 * - Konische Einführzone (3.0 mm Länge am Rohreingang) für beschädigungsfreie und leichte Montage
 * - M40x2.5 Innengewinde mit -0.25 mm Gewindespiel (Offset Faces) für leichtgängiges Einschrauben
 * - 1.0 mm Fase am Gewindeeingang der Stopperseite
 *
 * ## Technische CAD-Kennwerte:
 * - Grundkörper-Außendurchmesser: 41.2 mm
 * - Spitzendurchmesser über Rippen: 42.85 mm (< 43.00 mm)
 * - Anzahl Klemmrippen: 8 (gleichmäßig 45° verteilt)
 * - Maximale Rippenhöhe: 0.825 mm (radial über Grundkörper)
 * - Klemm-Übermaß: +0.425 mm radial / +0.85 mm im Durchmesser (bezogen auf 42.0 mm Rohr-ID)
 * - Einführfase / Anlaufzone: 3.0 mm konischer Übergang
 * - Gerippte Klemmlänge: 35.0 mm (von Z = 2.0 mm bis Z = 37.0 mm)
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

    // 2. Inlet mit gerundeten Klemmrippen, Einführzone, Innengewinde & Gewindespiel erzeugen
    const targetBody = createInlet(rootComp, params);
    targetBody.name = 'thread-inlet-m40x2_5-pressfit-42mm';

    console.log('Thread-Inlet M40x2.5 (Passung 42.0mm Rohr, 8 Klemmrippen 42.85mm) erfolgreich generiert!');

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
    stopperOuterDiameter: getOrCreateParam('stopper_outer_diameter', '46mm', 'mm', 'Außendurchmesser der Stopkante'),
    stopperLength: getOrCreateParam('stopper_length', '2mm', 'mm', 'Länge/Dicke der Stopkante'),
    pipeLength: getOrCreateParam('pipe_length', '40mm', 'mm', 'Gesamtlänge des Inlets'),
    pipeInnerDiameter: getOrCreateParam('pipe_inner_diameter', '40mm', 'mm', 'Innendurchmesser des Inlets (Gewindebohrung)'),
    tubeInnerDiameter: getOrCreateParam('tube_inner_diameter', '42mm', 'mm', 'Nenn-Innendurchmesser des Aufnahme-Rohres (42.0mm)'),
    pipeBaseDiameter: getOrCreateParam('pipe_base_diameter', '41.2mm', 'mm', 'Außendurchmesser des Inlet-Grundkörpers (0.8mm Spiel)'),
    ribTipDiameter: getOrCreateParam('rib_tip_diameter', '42.85mm', 'mm', 'Außendurchmesser über den 8 Klemmrippen (< 43.00mm)'),
    numRibs: getOrCreateParam('num_ribs', '8', '', 'Anzahl der gerundeten Klemmrippen (6-8)'),
    leadInLength: getOrCreateParam('lead_in_length', '3mm', 'mm', 'Länge der konischen Einführzone am Rohreingang'),
    threadClearance: getOrCreateParam('thread_clearance', '-0.25mm', 'mm', 'Gewindespiel (Drücken/Ziehen)'),
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
  const pipeLen = params.pipeLength.value; // e.g. 6.0 cm
  const pipeID = params.pipeInnerDiameter.value; // e.g. 4.0 cm
  const baseOD = params.pipeBaseDiameter.value; // e.g. 4.12 cm
  const ribTipOD = params.ribTipDiameter.value; // e.g. 4.285 cm (< 4.30 cm)
  const numRibs = Math.max(4, Math.min(16, Math.round(params.numRibs.value))); // e.g. 8
  const leadInLen = params.leadInLength.value; // e.g. 0.3 cm
  const clearanceStr = params.threadClearance.expression || '-0.25mm';

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

  // 2. Gerippten Schaft mit 8 weich gerundeten Klemmrippen erzeugen (von Z = stopperLen bis Z = pipeLen, d.h. 2mm bis 40mm)
  createRibbedShaft(rootComp, stopperLen, pipeLen - stopperLen, pipeID / 2.0, baseOD / 2.0, ribTipOD / 2.0, numRibs);

  // 3. Konische Einführzone (3mm Lead-In Chamfer am Z=40mm Ende)
  createLeadInChamfer(rootComp, pipeLen, leadInLen, ribTipOD / 2.0);

  // 4. M40x2.5 Innengewinde mit -0.25mm Spiel (Offset Faces)
  addInternalThreadAndClearance(rootComp, targetBody, pipeID / 2.0, clearanceStr);

  // 5. Gewindeeingangs-Fase (1mm) an der Stopper-Unterseite (Z = 0)
  addEntranceChamfer(rootComp, targetBody, params.threadChamfer.value);

  return targetBody;
}

/**
 * Erzeugt den Hauptschaft des Inlets mit N weich gerundeten Längs-Klemmrippen
 * basierend auf einer C2-stetigen cos^4-Wölbung ohne Kerbwirkung.
 */
function createRibbedShaft(
  rootComp: adsk.fusion.Component,
  startZCm: number,
  shaftLenCm: number,
  innerRadiusCm: number,
  baseRadiusCm: number,
  ribTipRadiusCm: number,
  numRibs: number
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

  // Innere Durchgangsbohrung (40mm ID)
  sketch.sketchCurves.sketchCircles.addByCenterRadius(centerPt, innerRadiusCm);

  // Punkte für die weich gerundete N-Rippen-Außenkontur berechnen
  const ribHeightCm = ribTipRadiusCm - baseRadiusCm; // e.g. 0.0825 cm (0.825mm)
  const totalPoints = numRibs * 12; // 96 Punkte für maximale Oberflächenglätte
  const pointColl = adsk.core.ObjectCollection.create();

  for (let i = 0; i < totalPoints; i++) {
    const angle = (i * 2.0 * Math.PI) / totalPoints;

    // Relativer Winkel im Sektor der jeweiligen Rippe
    const sectorAngle = (2.0 * Math.PI) / numRibs;
    let relAngle = (angle % sectorAngle);
    if (relAngle > sectorAngle / 2.0) {
      relAngle -= sectorAngle;
    }

    // Weiche cos^4-Form für gerundete Rippenflanken und glatten Übergang zum Grundkörper
    const phi = (relAngle / (sectorAngle / 2.0)) * (Math.PI / 2.0);
    const r = baseRadiusCm + ribHeightCm * Math.pow(Math.cos(phi), 4);

    const x = r * Math.cos(angle);
    const y = r * Math.sin(angle);
    const p3D = adsk.core.Point3D.create(x, y, startZCm);
    pointColl.add(sketch.modelToSketchSpace(p3D));
  }

  // Schließe die Spline-Schleife mit dem ersten Punkt
  pointColl.add(pointColl.item(0));

  // Erzeuge die geschlossene gerundete Rippen-Spline-Kurve
  const spline = sketch.sketchCurves.sketchFittedSplines.add(pointColl);
  if (!spline) {
    throw new Error('Konnte die gerundete Klemmrippen-Kontur nicht erzeugen.');
  }

  // Ringprofil zwischen innerer Bohrung und der gerundeten Rippenaußenwand finden
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
    throw new Error('Profil für den gerippten Schaft konnte nicht ermittelt werden.');
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
 * Erzeugt eine konische Einführzone (Lead-In Chamfer) am oberen Ende des Inlets (Z = 40mm down to 57mm),
 * damit die Rippen beim Hineinschieben in das 42.0mm Rohr sanft zentriert und zerschneidungsfrei geführt werden.
 */
function createLeadInChamfer(
  rootComp: adsk.fusion.Component,
  totalLengthCm: number,
  leadInLenCm: number,
  ribTipRadiusCm: number
): void {
  if (leadInLenCm <= 0) return;

  const revolveFeatures = rootComp.features.revolveFeatures;
  const sketches = rootComp.sketches;

  // Skizze auf der XZ-Ebene für den 360°-Revolve Cut der Einführfase
  const sketch = sketches.add(rootComp.xZConstructionPlane);

  const topZ = totalLengthCm; // 6.0 cm
  const bottomZ = totalLengthCm - leadInLenCm; // 5.7 cm

  // Dreieckselement für den konischen Anschnitt am Z=40mm Ende:
  const rOuterCut = ribTipRadiusCm + 0.3; // 2.3925 cm (großzügige äußere Schnittgrenze)
  const rInnerCut = ribTipRadiusCm - 0.15; // 1.9425 cm (reduziert den Rohranfang auf ~38.8mm OD)

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
 * und wendet ein Gewindespiel von -0.25mm via Drücken/Ziehen (Offset Faces) an.
 */
function addInternalThreadAndClearance(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody,
  innerRadiusCm: number,
  clearanceStr: string
): void {
  const threadFeatures = rootComp.features.threadFeatures;

  // Innere Zylinderfläche selektieren
  let targetFace: adsk.fusion.BRepFace | null = null;
  for (let i = 0; i < targetBody.faces.count; i++) {
    const face = targetBody.faces.item(i);
    if (face && face.geometry.surfaceType === adsk.core.SurfaceTypes.CylinderSurfaceType) {
      const cyl = face.geometry as adsk.core.Cylinder;
      if (Math.abs(cyl.radius - innerRadiusCm) < 0.15) {
        targetFace = face;
        break;
      }
    }
  }

  if (!targetFace) {
    for (let i = 0; i < targetBody.faces.count; i++) {
      const face = targetBody.faces.item(i);
      if (face && face.geometry.surfaceType === adsk.core.SurfaceTypes.CylinderSurfaceType) {
        targetFace = face;
        break;
      }
    }
  }

  if (!targetFace) {
    throw new Error('Innenfläche für das Gewinde wurde nicht gefunden.');
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
