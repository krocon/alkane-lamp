import { adsk } from "@adsk/fusion";

const app = adsk.core.Application.get();
const ui = app ? app.userInterface : null;

/**
 * @file thread-inlet-m40x2_5-clearance-0_25.ts
 * @description Fusion 360 Skript zur Erzeugung eines Gewinde-Inlets (M40x2.5 Innengewinde) für ein PLA-Rohr mit 43mm Innendurchmesser.
 *
 * ## Parameter:
 * - stopperOuterDiameter: 46mm (Außendurchmesser der Stopkante)
 * - stopperLength: 2mm (Dicke des Anschlagflansches)
 * - pipeLength: 60mm (Gesamtlänge des Inlets)
 * - pipeInnerDiameter: 40mm (Innendurchmesser der Kernbohrung)
 * - pipeOuterDiameter: 43mm (Nenn-Außendurchmesser des Inlets)
 * - pipeClearance: -0.2mm (Toleranz/Spiel für leichtes Einschieben in das 43mm PLA-Rohr -> eff. 42.8mm)
 * - threadClearance: -0.25mm (Gewindespiel für leichtes Einschrauben der Lampenfassung via Offset Faces)
 * - numRibs: 36 (Anzahl der Längsrillen/Riffelung am Außenumfang)
 * - ribDepth: 0.4mm (Tiefe der Riffelungs-Lamellen)
 * - threadChamfer: 1mm (Anfasung am Gewindeeingang an der Stopperseite)
 *
 * ## Konstruktionsschritte:
 * 1. Skizze auf XY-Ebene mit Innendurchmesser (40mm) und Stopper-Außendurchmesser (46mm)
 * 2. Ringextrusion auf Gesamtlänge (60mm)
 * 3. M40x2.5 6H Innengewinde (volle Länge, modelliert)
 * 4. Gewindeflächen-Offset von -0.25mm (Drücken/Ziehen für Gewindespiel)
 * 5. Reduzierung des Außenbereichs oberhalb des Stoppers (Z=2mm bis 60mm) auf eff. 42.8mm (43mm + pipeClearance)
 * 6. 36 Längsrillen (Riffelung) an der Außenwand für optimale Passung und geringe Reibung im PLA-Rohr
 * 7. Einführfase (1mm) an der Unterseite des Gewindeeingangs am Stopper
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

    // 2. Inlet mit Innengewinde, Gewindespiel, Stopperflansch, Außendurchmesser-Reduktion, Riffelung & Gewindeeingangs-Fase erzeugen
    const targetBody = createInlet(rootComp, params);
    targetBody.name = 'thread-inlet-m40x2_5-clearance-0_25';

    console.log('Thread-Inlet M40x2.5 (Gewindespiel -0.25mm, Rohrspiel -0.2mm) erfolgreich generiert!');

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
    pipesOuterDiameter: getOrCreateParam('pipes_outer_diameter', '43mm', 'mm', 'Außendurchmesser des Inlets an der Stopkante'),
    pipeLength: getOrCreateParam('pipe_length', '60mm', 'mm', 'Gesamtlänge des Inlets'),
    pipeInnerDiameter: getOrCreateParam('pipe_inner_diameter', '40mm', 'mm', 'Innendurchmesser des Inlets (Gewindebohrung)'),
    pipeOuterDiameter: getOrCreateParam('pipe_outer_diameter', '43mm', 'mm', 'Nenn-Außendurchmesser des Inlets (Röhrenbereich)'),
    pipeClearance: getOrCreateParam('pipe_clearance', '-0.2mm', 'mm', 'Spiel/Toleranz für den Außendurchmesser des Inlets (-0.2mm)'),
    threadClearance: getOrCreateParam('thread_clearance', '-0.25mm', 'mm', 'Gewindespiel (Drücken/Ziehen)'),
    numRibs: getOrCreateParam('num_ribs', '36', '', 'Anzahl der Riffelungs-Lamellen'),
    ribDepth: getOrCreateParam('rib_depth', '0.4mm', 'mm', 'Tiefe der Riffelungs-Rillen'),
    threadChamfer: getOrCreateParam('thread_chamfer', '1mm', 'mm', 'Fase am Gewindeeingang')
  };
}

/**
 * Erzeugt das vollständige Thread-Inlet gemäß allen angegebenen Konstruktionsschritten.
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
  const nominalPipeOD = params.pipeOuterDiameter.value; // e.g. 4.3 cm
  const pipeClearanceVal = params.pipeClearance.value; // e.g. -0.02 cm (-0.2mm)
  const effectivePipeOD = Math.max(pipeID + 0.1, nominalPipeOD + pipeClearanceVal); // e.g. 4.28 cm (42.8mm)
  const clearanceStr = params.threadClearance.expression || '-0.25mm';

  // Schritt 1 & 2: Erzeuge auf XY-Ebene eine Skizze mit 2 Kreisen (pipeInnerDiameter & stopperOuterDiameter)
  const sketchXY = sketches.add(rootComp.xYConstructionPlane);
  const centerXY = sketchXY.modelToSketchSpace(center3D);

  sketchXY.sketchCurves.sketchCircles.addByCenterRadius(centerXY, pipeID / 2.0);
  sketchXY.sketchCurves.sketchCircles.addByCenterRadius(centerXY, stopperOD / 2.0);

  // Profil für den Ring (zwischen innerem Bohrungsdurchmesser 40mm und Stopper-Außendurchmesser 46mm) ermitteln
  let baseRingProfile: adsk.fusion.Profile | null = null;
  for (let i = 0; i < sketchXY.profiles.count; i++) {
    const prof = sketchXY.profiles.item(i);
    if (prof && prof.profileLoops.count === 2) {
      baseRingProfile = prof;
      break;
    }
  }

  if (!baseRingProfile && sketchXY.profiles.count >= 2) {
    const p0 = sketchXY.profiles.item(0);
    const p1 = sketchXY.profiles.item(1);
    if (p0 && p1) {
      baseRingProfile = p0.areaProperties().area < p1.areaProperties().area ? p1 : p0;
    }
  }

  if (!baseRingProfile) {
    throw new Error('Konnte das Ringprofil für den Grundkörper nicht ermitteln.');
  }

  // Schritt 3: Extrudiere Ring um pipeLength (60mm)
  const extInputBase = extrudeFeatures.createInput(
    baseRingProfile,
    adsk.fusion.FeatureOperations.NewBodyFeatureOperation
  );
  extInputBase.setDistanceExtent(
    false,
    adsk.core.ValueInput.createByReal(pipeLen)
  );

  const baseExtrudeFeature = extrudeFeatures.add(extInputBase);
  if (!baseExtrudeFeature || baseExtrudeFeature.bodies.count === 0) {
    throw new Error('Erzeugung des Grundkörpers fehlgeschlagen.');
  }

  const targetBody = baseExtrudeFeature.bodies.item(0);

  // Schritt 4 & 5: Innengewinde M40x2.5 (volle Länge) & Gewindespiel -0.25mm (Drücken/Ziehen)
  addInternalThreadAndClearance(rootComp, targetBody, pipeID / 2.0, clearanceStr);

  // Schritt 6, 7 & 8: Skizze auf oberer Stirnfläche (Z = pipeLength), Kreis für eff. Außendurchmesser (42.8mm), Extrusion -58mm (Cut)
  cutOuterPipeDiameter(rootComp, pipeLen, stopperLen, stopperOD / 2.0, effectivePipeOD / 2.0);

  // Schritt 9: Riffelung an der Außenseite des Pipe-Bereichs (Längslamellen)
  addOuterRiffelung(rootComp, pipeLen, stopperLen, effectivePipeOD / 2.0, params.ribDepth.value, Math.round(params.numRibs.value));

  // Schritt 10: Fase am Gewindeeingang am Stopper-Ende (Z = 0)
  addEntranceChamfer(rootComp, targetBody, params.threadChamfer.value);

  return targetBody;
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
 * Selektiert die obere Röhrenstirn (Z = pipeLength) und schneidet den äußeren Ring
 * ab Z = 2mm (stopperLength) auf den effektiven Außendurchmesser (43mm + pipeClearance) mit Extrusion -58mm zurück.
 */
function cutOuterPipeDiameter(
  rootComp: adsk.fusion.Component,
  pipeLenCm: number,
  stopperLenCm: number,
  stopperRadiusCm: number,
  pipeRadiusCm: number
): void {
  const extrudeFeatures = rootComp.features.extrudeFeatures;

  // Versatzebene an der oberen Röhrenstirn (Z = pipeLength)
  const planeInput = rootComp.constructionPlanes.createInput();
  planeInput.setByOffset(
    rootComp.xYConstructionPlane,
    adsk.core.ValueInput.createByReal(pipeLenCm)
  );
  const topPlane = rootComp.constructionPlanes.add(planeInput);

  const sketch = rootComp.sketches.add(topPlane);
  const center3D = adsk.core.Point3D.create(0, 0, pipeLenCm);
  const centerPt = sketch.modelToSketchSpace(center3D);

  // Effektiver Außendurchmesser-Kreis & 46mm+ Kreis zur Abgrenzung des äußeren Schnittrings
  sketch.sketchCurves.sketchCircles.addByCenterRadius(centerPt, pipeRadiusCm);
  sketch.sketchCurves.sketchCircles.addByCenterRadius(centerPt, stopperRadiusCm + 0.5);

  // Äußeres Ringprofil finden
  let outerCutProfile: adsk.fusion.Profile | null = null;
  for (let i = 0; i < sketch.profiles.count; i++) {
    const prof = sketch.profiles.item(i);
    if (prof && prof.profileLoops.count === 2) {
      outerCutProfile = prof;
      break;
    }
  }

  if (!outerCutProfile && sketch.profiles.count >= 2) {
    const p0 = sketch.profiles.item(0);
    const p1 = sketch.profiles.item(1);
    if (p0 && p1) {
      outerCutProfile = p0.areaProperties().area > p1.areaProperties().area ? p0 : p1;
    }
  }

  if (!outerCutProfile && sketch.profiles.count === 1) {
    outerCutProfile = sketch.profiles.item(0);
  }

  if (!outerCutProfile) {
    throw new Error('Konnte Profil zum Reduzieren des Außendurchmessers nicht finden.');
  }

  // Extrusion (Cut) um -58mm (stopperLength - pipeLength = 2mm - 60mm)
  const cutDistance = stopperLenCm - pipeLenCm; // -5.8 cm
  const extInputCut = extrudeFeatures.createInput(
    outerCutProfile,
    adsk.fusion.FeatureOperations.CutFeatureOperation
  );
  extInputCut.setDistanceExtent(
    false,
    adsk.core.ValueInput.createByReal(cutDistance)
  );

  extrudeFeatures.add(extInputCut);
}

/**
 * Erzeugt eine Riffelung (36 umlaufende V-Kerben / Lamellen) an der Außenseite des Pipe-Bereichs.
 * Ermöglicht ein leichtes Hineinschieben und präzises Klemmen in ein PLA-Rohr mit 43mm Innendurchmesser.
 */
function addOuterRiffelung(
  rootComp: adsk.fusion.Component,
  pipeLenCm: number,
  stopperLenCm: number,
  pipeRadiusCm: number,
  ribDepthCm: number,
  numRibs: number
): void {
  if (numRibs <= 0 || ribDepthCm <= 0) return;

  const extrudeFeatures = rootComp.features.extrudeFeatures;

  // Skizze auf der oberen Stirnebene Z = pipeLength
  const planeInput = rootComp.constructionPlanes.createInput();
  planeInput.setByOffset(
    rootComp.xYConstructionPlane,
    adsk.core.ValueInput.createByReal(pipeLenCm)
  );
  const topPlane = rootComp.constructionPlanes.add(planeInput);
  const sketch = rootComp.sketches.add(topPlane);

  const rOuter = pipeRadiusCm;
  const rRoot = Math.max(0.1, rOuter - ribDepthCm);

  const dAngle = (2.0 * Math.PI) / numRibs;
  const lines = sketch.sketchCurves.sketchLines;

  // 36 gleichmäßig verteilte V-förmige Einkerbungen entlang des Außenumfangs zeichnen
  for (let i = 0; i < numRibs; i++) {
    const angleCenter = i * dAngle;
    const angleLeft = angleCenter - dAngle * 0.25;
    const angleRight = angleCenter + dAngle * 0.25;

    const pLeft3D = adsk.core.Point3D.create(rOuter * Math.cos(angleLeft), rOuter * Math.sin(angleLeft), pipeLenCm);
    const pValley3D = adsk.core.Point3D.create(rRoot * Math.cos(angleCenter), rRoot * Math.sin(angleCenter), pipeLenCm);
    const pRight3D = adsk.core.Point3D.create(rOuter * Math.cos(angleRight), rOuter * Math.sin(angleRight), pipeLenCm);

    const pLeft = sketch.modelToSketchSpace(pLeft3D);
    const pValley = sketch.modelToSketchSpace(pValley3D);
    const pRight = sketch.modelToSketchSpace(pRight3D);

    lines.addByTwoPoints(pLeft, pValley);
    lines.addByTwoPoints(pValley, pRight);
    lines.addByTwoPoints(pRight, pLeft);
  }

  // Kerben-Profile sammeln
  const notchProfiles = adsk.core.ObjectCollection.create();
  for (let i = 0; i < sketch.profiles.count; i++) {
    const prof = sketch.profiles.item(i);
    if (prof) {
      notchProfiles.add(prof);
    }
  }

  if (notchProfiles.count > 0) {
    const cutDistance = stopperLenCm - pipeLenCm; // -5.8 cm
    const extCutInput = extrudeFeatures.createInput(
      notchProfiles,
      adsk.fusion.FeatureOperations.CutFeatureOperation
    );
    extCutInput.setDistanceExtent(
      false,
      adsk.core.ValueInput.createByReal(cutDistance)
    );
    extrudeFeatures.add(extCutInput);
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
