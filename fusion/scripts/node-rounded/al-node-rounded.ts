import {adsk} from "@adsk/fusion";

const app = adsk.core.Application.get();
const ui = app ? app.userInterface : null;

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

    // 2. 4 Zylinder erzeugen und zu einem Tetrapod-Körper verschmelzen
    const tetrapodBody = createBaseTetrapod(rootComp, params);
    if (!tetrapodBody) {
      ui.messageBox('Fehler beim Erzeugen des Tetrapod-Grundkörpers.');
      return;
    }
    tetrapodBody.name = 'Rounded Tetrapod';

    // 3. 6 Knoten-Schnittkanten abrunden (Chord Length Fillet, 25mm, Tangential, Setback Corner)
    applyNodeFillets(rootComp, tetrapodBody, params);

    // 4. Äußere Stufen und durchgehende Bohrungen an allen 4 Armen erzeugen
    createArmStepsAndHoles(rootComp, tetrapodBody, params);

    console.log('Erfolgreich generiert!');

  } catch (e) {
    console.error(`Failed: ${e}`);
    if (ui) {
      ui.messageBox(`Kritischer Fehler beim Ausführen des Scripts:\n${e}`);
    }
  }
}

// =====================================================================
// MODULE & HILFSFUNKTIONEN
// =====================================================================

/**
 * Richtet die Benutzerparameter in Fusion 360 ein oder ruft bestehende ab.
 * Ermöglicht die dynamische Steuerung der Geometrie über die Parameter-Liste.
 *
 * @param design Das aktive Fusion 360 Design-Objekt.
 * @returns Ein Objekt mit allen relevanten UserParameters.
 */
function setupParameters(design: adsk.fusion.Design) {
  const params = design.userParameters;

  /** Hilfsfunktion zum Erstellen oder Abrufen eines Parameters */
  function getOrCreateParam(name: string, valueStr: string, unit: string, description: string): adsk.fusion.UserParameter {
    let p = params.itemByName(name);
    if (!p) {
      const valInput = adsk.core.ValueInput.createByString(valueStr);
      if (!valInput) {
        throw new Error(`Konnte ValueInput fuer Parameter ${name} nicht erstellen.`);
      }
      p = params.add(name, valInput, unit, description);
    }
    if (!p) {
      throw new Error(`Konnte UserParameter ${name} nicht erstellen.`);
    }
    return p;
  }

  return {
    armOuterDiameter: getOrCreateParam('arm_outer_diameter', '46mm', 'mm', 'Aussendurchmesser der Arme'),
    armDepthLong: getOrCreateParam('arm_depth_long', '80mm', 'mm', 'Armlaenge aller 4 Arme gemessen vom Zentrum'),
    ringInnerDiameter: getOrCreateParam('ring_inner_diameter', '40mm', 'mm', 'Durchmesser der erhabenen Stirnflaeche'),
    ringExtrudeDepth: getOrCreateParam('ring_extrude_depth', '17mm', 'mm', 'Tiefe des Rumpfabsatzes / Rücksprungs'),
    filletRadius: getOrCreateParam('fillet_radius', '25mm', 'mm', 'Radius fuer die Knotenabrundung (Sehnenlaenge)'),
    holeDiameter: getOrCreateParam('hole_diameter', '31.5mm', 'mm', 'Durchmesser der zentrischen Bohrung')
  };
}

/**
 * Erstellt 4 Zylinder im tetraedrischen Winkel und verschmilzt sie zu einem Tetrapod-Grundkörper.
 * - Ein Arm liegt auf der Z-Achse (von Z=0 nach -Z).
 * - Ein weiterer Arm liegt in der XZ-Ebene (rotiert um Y-Achse).
 * - Die Stirnflächen berühren den Ursprung (0,0,0).
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param params Die konfigurierten Benutzerparameter.
 * @returns Der verschmolzene (Join) BRepBody des Tetrapoden.
 */
function createBaseTetrapod(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>
): adsk.fusion.BRepBody | null {
  const sketches = rootComp.sketches;
  const features = rootComp.features;
  const extrudeFeatures = features.extrudeFeatures;
  const xyPlane = rootComp.xYConstructionPlane;
  const center = adsk.core.Point3D.create(0, 0, 0);

  if (!xyPlane || !center) return null;

  // 1. Arm 0: Zylinder auf der Z-Achse
  const sketch0 = sketches.add(xyPlane);
  if (!sketch0) return null;
  sketch0.sketchCurves.sketchCircles.addByCenterRadius(center, params.armOuterDiameter.value / 2.0);
  const prof0 = sketch0.profiles.item(0);
  if (!prof0) return null;

  const extInput0 = extrudeFeatures.createInput(prof0, adsk.fusion.FeatureOperations.NewBodyFeatureOperation);
  const distVal0 = adsk.core.ValueInput.createByString('-arm_depth_long');
  if (!extInput0 || !distVal0) return null;
  extInput0.setDistanceExtent(false, distVal0);
  const extFeat0 = extrudeFeatures.add(extInput0);
  if (!extFeat0 || extFeat0.bodies.count === 0) return null;
  const arm0Body = extFeat0.bodies.item(0);
  if (!arm0Body) return null;

  // 2. Arm 1: Zylinder für die Rotation in die XZ-Ebene
  const sketch1 = sketches.add(xyPlane);
  if (!sketch1) return null;
  sketch1.sketchCurves.sketchCircles.addByCenterRadius(center, params.armOuterDiameter.value / 2.0);
  const prof1 = sketch1.profiles.item(0);
  if (!prof1) return null;

  const extInput1 = extrudeFeatures.createInput(prof1, adsk.fusion.FeatureOperations.NewBodyFeatureOperation);
  const distVal1 = adsk.core.ValueInput.createByString('-arm_depth_long');
  if (!extInput1 || !distVal1) return null;
  extInput1.setDistanceExtent(false, distVal1);
  const extFeat1 = extrudeFeatures.add(extInput1);
  if (!extFeat1 || extFeat1.bodies.count === 0) return null;
  const arm1Body = extFeat1.bodies.item(0);
  if (!arm1Body) return null;

  // Arm 1 um die Y-Achse in den tetraedrischen Winkel rotieren (liegt danach in der XZ-Ebene)
  const moveFeats = features.moveFeatures;
  const moveColl1 = adsk.core.ObjectCollection.create();
  if (!moveColl1) return null;
  moveColl1.add(arm1Body);
  const moveInput1 = moveFeats.createInput2(moveColl1);
  const tetraAngle = adsk.core.ValueInput.createByString('109.47122063449069deg');
  if (!moveInput1 || !tetraAngle) return null;
  moveInput1.defineAsRotate(rootComp.yConstructionAxis, tetraAngle);
  moveFeats.add(moveInput1);

  // 3. Arm 1 3-mal um die Z-Achse im 120°-Raster vervielfältigen
  const circPatterns = features.circularPatternFeatures;
  const entColl = adsk.core.ObjectCollection.create();
  if (!entColl) return null;
  entColl.add(arm1Body);
  const patternInput = circPatterns.createInput(entColl, rootComp.zConstructionAxis);
  const qVal = adsk.core.ValueInput.createByString('3');
  const aVal = adsk.core.ValueInput.createByString('360deg');
  if (!patternInput || !qVal || !aVal) return null;
  patternInput.quantity = qVal;
  patternInput.totalAngle = aVal;
  const patternFeat = circPatterns.add(patternInput);
  if (!patternFeat) return null;

  // 4. Alle 4 Arme zu einem einzigen Körper verschmelzen (Join)
  const toolBodies = adsk.core.ObjectCollection.create();
  if (!toolBodies) return null;
  toolBodies.add(arm1Body);
  for (let i = 0; i < patternFeat.bodies.count; i++) {
    const b = patternFeat.bodies.item(i);
    if (b && b.name !== arm0Body.name && b.name !== arm1Body.name) {
      toolBodies.add(b);
    }
  }

  const combineFeatures = features.combineFeatures;
  const combineInput = combineFeatures.createInput(arm0Body, toolBodies);
  if (!combineInput) return null;
  combineInput.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation;
  const combFeat = combineFeatures.add(combineInput);
  if (!combFeat || combFeat.bodies.count === 0) return null;

  return combFeat.bodies.item(0);
}

/**
 * Rundet die 6 Schnittkanten des Knotens ab:
 * - Typ: Abrunden (Fillet)
 * - Radius: 25.0mm (filletRadius)
 * - Kontinuitätstyp: Tangential (G1)
 * - Radiustyp: Sehnenlänge (Chord length fillet)
 * - Tangentenkette: ja (isTangentChain: true)
 * - Tangentialitätsgewicht: 1.0
 * - Ecktyp: Versatz (Setback corner)
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param targetBody Der verschmolzene Tetrapod-Körper.
 * @param params Die Benutzerparameter.
 */
function applyNodeFillets(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody,
  params: ReturnType<typeof setupParameters>
): void {
  const filletFeatures = rootComp.features.filletFeatures;
  const filletInput = filletFeatures.createInput();
  if (!filletInput) return;

  // Ecktyp: Versatz (Setback corner)
  filletInput.isRollingBallCorner = false;

  // 6 Schnittkanten im Zentrum identifizieren
  const edgeCollection = adsk.core.ObjectCollection.create();
  if (!edgeCollection) return;

  const center = adsk.core.Point3D.create(0, 0, 0);
  if (!center) return;
  const maxCenterDist = params.armDepthLong.value * 0.6; // Kanten nahe dem Ursprung

  for (let i = 0; i < targetBody.edges.count; i++) {
    const edge = targetBody.edges.item(i);
    if (!edge) continue;
    const midPoint = edge.pointOnEdge;
    if (midPoint && midPoint.distanceTo(center) < maxCenterDist) {
      edgeCollection.add(edge);
    }
  }

  console.log(`Gefundene Schnittkanten fuer Knotenabrundung: ${edgeCollection.count}`);

  if (edgeCollection.count === 0) {
    console.warn('Keine Schnittkanten fuer Abrundung gefunden.');
    return;
  }

  // Radiustyp: Sehnenlänge
  const chordLengthVal = adsk.core.ValueInput.createByReal(params.filletRadius.value);
  if (!chordLengthVal) return;

  const chordEdgeSet = filletInput.edgeSetInputs.addChordLengthEdgeSet(
    edgeCollection,
    chordLengthVal,
    true
  );
  if (!chordEdgeSet) return;

  // Kontinuitätstyp: Tangential
  chordEdgeSet.continuity = adsk.fusion.SurfaceContinuityTypes.TangentSurfaceContinuityType;

  // Tangentialitätsgewicht: 1.0
  const weightVal = adsk.core.ValueInput.createByReal(1.0);
  if (weightVal) {
    chordEdgeSet.tangencyWeight = weightVal;
  }

  filletFeatures.add(filletInput);
}

/**
 * Erzeugt an den äußeren Enden aller 4 Arme:
 * 1. Die gestufte Geometrie (äußerer Ring wird um ringExtrudeDepth zurückgeschnitten).
 * 2. Die durchgehende zentrische Bohrung (Durchmesser holeDiameter) vom Armende bis zum Ursprung (0,0,0).
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param targetBody Der abgerundete Tetrapod-Körper.
 * @param params Die Benutzerparameter.
 */
function createArmStepsAndHoles(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody,
  params: ReturnType<typeof setupParameters>
): void {
  const center = adsk.core.Point3D.create(0, 0, 0);
  if (!center) return;
  const minFaceDist = params.armDepthLong.value * 0.7; // Äußere Stirnflächen der 4 Arme

  const endFaces: adsk.fusion.BRepFace[] = [];

  for (let i = 0; i < targetBody.faces.count; i++) {
    const face = targetBody.faces.item(i);
    if (face && face.geometry.surfaceType === adsk.core.SurfaceTypes.PlaneSurfaceType) {
      const bbox = face.boundingBox;
      if (bbox && bbox.minPoint && bbox.maxPoint) {
        const faceCenter = adsk.core.Point3D.create(
          (bbox.minPoint.x + bbox.maxPoint.x) / 2.0,
          (bbox.minPoint.y + bbox.maxPoint.y) / 2.0,
          (bbox.minPoint.z + bbox.maxPoint.z) / 2.0
        );
        if (faceCenter && faceCenter.distanceTo(center) >= minFaceDist) {
          endFaces.push(face);
        }
      }
    }
  }

  console.log(`Gefundene Stirnflaechen fuer Stufe & Bohrung: ${endFaces.length}`);

  const holeRadius = params.holeDiameter.value / 2.0;
  const innerRingRadius = params.ringInnerDiameter.value / 2.0;
  const outerArmRadius = params.armOuterDiameter.value / 2.0;

  const expectedHoleArea = Math.PI * Math.pow(holeRadius, 2);
  const expectedOuterRingArea = Math.PI * (Math.pow(outerArmRadius, 2) - Math.pow(innerRingRadius, 2));

  for (const face of endFaces) {
    const sketch = rootComp.sketches.add(face);
    if (!sketch) continue;
    const sketchOrigin = adsk.core.Point3D.create(0, 0, 0);
    if (!sketchOrigin) continue;

    // 3 konzentrische Kreise auf der Stirnfläche zeichnen
    sketch.sketchCurves.sketchCircles.addByCenterRadius(sketchOrigin, holeRadius);
    sketch.sketchCurves.sketchCircles.addByCenterRadius(sketchOrigin, innerRingRadius);
    sketch.sketchCurves.sketchCircles.addByCenterRadius(sketchOrigin, outerArmRadius);

    let holeProfile: adsk.fusion.Profile | null = null;
    let outerRingProfile: adsk.fusion.Profile | null = null;

    let minHoleDiff = Infinity;
    let minRingDiff = Infinity;

    for (let j = 0; j < sketch.profiles.count; j++) {
      const prof = sketch.profiles.item(j);
      if (!prof) continue;
      const area = prof.areaProperties().area;

      const holeDiff = Math.abs(area - expectedHoleArea);
      if (holeDiff < minHoleDiff) {
        minHoleDiff = holeDiff;
        holeProfile = prof;
      }

      const ringDiff = Math.abs(area - expectedOuterRingArea);
      if (ringDiff < minRingDiff) {
        minRingDiff = ringDiff;
        outerRingProfile = prof;
      }
    }

    const extrudeFeatures = rootComp.features.extrudeFeatures;

    // 1. Zentrische durchgehende Bohrung (Cut von Armende bis Ursprung)
    if (holeProfile) {
      const extHoleInput = extrudeFeatures.createInput(
        holeProfile,
        adsk.fusion.FeatureOperations.CutFeatureOperation
      );
      const distHoleVal = adsk.core.ValueInput.createByString('-arm_depth_long');
      if (extHoleInput && distHoleVal) {
        extHoleInput.setDistanceExtent(false, distHoleVal);
        extrudeFeatures.add(extHoleInput);
      }
    }

    // 2. Äußeren Ring für die Stufe extrudieren (Cut um ringExtrudeDepth)
    if (outerRingProfile) {
      const extRingInput = extrudeFeatures.createInput(
        outerRingProfile,
        adsk.fusion.FeatureOperations.CutFeatureOperation
      );
      const distRingVal = adsk.core.ValueInput.createByString('-ring_extrude_depth');
      if (extRingInput && distRingVal) {
        extRingInput.setDistanceExtent(false, distRingVal);
        extrudeFeatures.add(extRingInput);
      }
    }
  }
}
