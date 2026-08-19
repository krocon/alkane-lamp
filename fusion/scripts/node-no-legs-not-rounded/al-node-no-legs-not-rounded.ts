import {adsk} from "@adsk/fusion";

const app = adsk.core.Application.get();
const ui = app ? app.userInterface : null;

/**
 * Hauptfunktion (Orchestrator) für die Erstellung eines symmetrischen Tetrapoden.
 * Der Tetrapod besitzt 4 identische Anschlüsse/Beine mit Rumpfabsatz und zentrischer Bohrung.
 */
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

    // 2. Tetrapod erzeugen (Basisgeometrie aus 4 gleichen Anschlüssen)
    const targetBody = createTetrapod(rootComp, params);
    targetBody.name = 'Node';

    // 3. Kugel aus dem Zentrum ausschneiden (Zentralknoten hohl machen)
    cutInnerSphere(rootComp, params.innerBallDiameter);

    // 4. Zentrische Bohrungen in die 4 Arme einbringen (Durchmesser holeDiameter, vom Zentrum bis zum Ende)
    boreArmHoles(rootComp, targetBody, params);

    console.log('Tetrapod-Knoten erfolgreich generiert!');

  } catch (e) {
    console.error(`Failed: ${e}`);
    if (ui) {
      ui.messageBox(`Kritischer Fehler beim Ausführen des Scripts:\n${e}`);
    }
  }
}

// =====================================================================
// HILFSFUNKTIONEN FÜR TYPSICHERHEIT
// =====================================================================

/**
 * Erzeugt ein ValueInput-Objekt aus einem String und stellt sicher, dass es nicht null ist.
 */
function createValueInput(valStr: string): adsk.core.ValueInput {
  const val = adsk.core.ValueInput.createByString(valStr);
  if (!val) {
    throw new Error(`Konnte ValueInput aus String '${valStr}' nicht erzeugen.`);
  }
  return val;
}

// =====================================================================
// PARAMETER & GEOMETRIE-MODULE
// =====================================================================

/**
 * Richtet die Benutzerparameter in Fusion 360 ein oder ruft bestehende ab.
 * Ermöglicht die dynamische Steuerung der Geometrie über die Fusion-Parameterliste.
 *
 * @param design Das aktive Fusion 360 Design-Objekt.
 * @returns Ein Objekt mit allen relevanten UserParameters.
 */
function setupParameters(design: adsk.fusion.Design) {
  const params = design.userParameters;

  /** Hilfsfunktion zum Erstellen oder Abrufen eines Parameters */
  function getOrCreateParam(
    name: string,
    valueStr: string,
    unit: string,
    description: string
  ): adsk.fusion.UserParameter {
    let p = params.itemByName(name);
    if (!p) {
      p = params.add(name, createValueInput(valueStr), unit, description);
    }
    if (!p) {
      throw new Error(`Fehler beim Erstellen/Abrufen des Parameters '${name}'.`);
    }
    return p;
  }

  return {
    armOuterDiameter: getOrCreateParam('arm_outer_diameter', '46mm', 'mm', 'Aussendurchmesser aller 4 Arme'),
    armDepth: getOrCreateParam('arm_depth', '40mm', 'mm', 'Armlaenge gemessen vom Zentrum'),
    ringInnerDiameter: getOrCreateParam('ring_inner_diameter', '40mm', 'mm', 'Durchmesser der erhabenen Stirnflaeche'),
    ringExtrudeDepth: getOrCreateParam('ring_extrude_depth', '22mm', 'mm', 'Tiefe des Rumpfabsatzes / Rücksprungs'),
    holeDiameter: getOrCreateParam('hole_diameter', '31.5mm', 'mm', 'Durchmesser der zentrischen Bohrung'),
    innerBallDiameter: getOrCreateParam('inner_ball_diameter', '42mm', 'mm', 'Durchmesser des inneren Kugelloches')
  };
}

/**
 * Erstellt einen einzelnen Arm des Tetrapoden entlang der -Z-Achse.
 * Der Arm besitzt eine gestufte Außenkontur (Rumpfabsatz) sowie eine durchgehende zentrische Bohrung.
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param params Die konfigurierten Benutzerparameter.
 * @returns Der erzeugte (kombinierte) BRepBody des gestuften Arms.
 */
function createSingleArm(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>
): adsk.fusion.BRepBody {
  const sketches = rootComp.sketches;
  const features = rootComp.features;
  const extrudeFeatures = features.extrudeFeatures;
  const xyPlane = rootComp.xYConstructionPlane;
  const center = adsk.core.Point3D.create(0, 0, 0);
  if (!center) {
    throw new Error('Konnte Urspungspunkt Point3D(0,0,0) nicht erzeugen.');
  }

  // Skizze auf der XY-Ebene mit 3 konzentrischen Kreisen erstellen
  const sketch = sketches.add(xyPlane);
  if (!sketch) {
    throw new Error('Konnte Skizze auf XY-Ebene nicht erzeugen.');
  }

  sketch.sketchCurves.sketchCircles.addByCenterRadius(center, params.armOuterDiameter.value / 2.0);
  sketch.sketchCurves.sketchCircles.addByCenterRadius(center, params.ringInnerDiameter.value / 2.0);
  sketch.sketchCurves.sketchCircles.addByCenterRadius(center, params.holeDiameter.value / 2.0);

  // Profile analysieren und nach maximaler BoundingBox-Entfernung vom Ursprung sortieren:
  // Index 0: Äußerer Ring (armOuterDiameter <-> ringInnerDiameter)
  // Index 1: Mittlerer Ring (ringInnerDiameter <-> holeDiameter)
  // Index 2: Innere Bohrung (0 <-> holeDiameter)
  const profileData: Array<{ profile: adsk.fusion.Profile; maxDist: number }> = [];

  for (let i = 0; i < sketch.profiles.count; i++) {
    const prof = sketch.profiles.item(i);
    if (!prof) continue;
    const bbox = prof.boundingBox;
    if (!bbox) continue;

    const minPt = bbox.minPoint;
    const maxPt = bbox.maxPoint;
    if (!minPt || !maxPt) continue;

    const maxDist = Math.max(
      minPt.distanceTo(center),
      maxPt.distanceTo(center)
    );
    profileData.push({ profile: prof, maxDist });
  }

  if (profileData.length < 2) {
    throw new Error('Es wurden nicht genügend Profile in der Skizze gefunden.');
  }

  profileData.sort((a, b) => b.maxDist - a.maxDist);

  const outerRingProfile = profileData[0].profile;
  const middleRingProfile = profileData[1].profile;

  // 1. Äußeren Ring extrudieren (Rumpfabsatz / Schulter)
  const extInputOuter = extrudeFeatures.createInput(
    outerRingProfile,
    adsk.fusion.FeatureOperations.NewBodyFeatureOperation
  );
  if (!extInputOuter) {
    throw new Error('Konnte ExtrudeFeatureInput für äußeren Ring nicht erzeugen.');
  }
  const outerDistance = '-arm_depth + ring_extrude_depth';
  extInputOuter.setDistanceExtent(false, createValueInput(outerDistance));
  const outerFeature = extrudeFeatures.add(extInputOuter);
  if (!outerFeature || outerFeature.bodies.count === 0) {
    throw new Error('Fehler beim Extrudieren des äußeren Rings.');
  }
  const outerBody = outerFeature.bodies.item(0);
  if (!outerBody) {
    throw new Error('Fehler beim Abrufen des Körper-Objekts für den äußeren Ring.');
  }

  // 2. Mittleren Ring extrudieren (Innerer Zylinder der Stufe bis zur vollen Armlänge)
  const extInputMiddle = extrudeFeatures.createInput(
    middleRingProfile,
    adsk.fusion.FeatureOperations.NewBodyFeatureOperation
  );
  if (!extInputMiddle) {
    throw new Error('Konnte ExtrudeFeatureInput für mittleren Ring nicht erzeugen.');
  }
  const middleDistance = '-arm_depth';
  extInputMiddle.setDistanceExtent(false, createValueInput(middleDistance));
  const middleFeature = extrudeFeatures.add(extInputMiddle);
  if (!middleFeature || middleFeature.bodies.count === 0) {
    throw new Error('Fehler beim Extrudieren des mittleren Rings.');
  }
  const middleBody = middleFeature.bodies.item(0);
  if (!middleBody) {
    throw new Error('Fehler beim Abrufen des Körper-Objekts für den mittleren Ring.');
  }

  // 3. Beide Teile zu einem Arm zusammenfügen (Bohrung bleibt innen frei)
  const toolColl = adsk.core.ObjectCollection.create();
  if (!toolColl) {
    throw new Error('Konnte ObjectCollection nicht erzeugen.');
  }
  toolColl.add(middleBody);
  const combineInput = features.combineFeatures.createInput(outerBody, toolColl);
  if (!combineInput) {
    throw new Error('Konnte CombineFeatureInput nicht erzeugen.');
  }
  combineInput.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation;
  const combineFeature = features.combineFeatures.add(combineInput);
  if (!combineFeature || combineFeature.bodies.count === 0) {
    throw new Error('Fehler beim Verschmelzen von äußertem und mittlerem Ring.');
  }

  const resultBody = combineFeature.bodies.item(0);
  if (!resultBody) {
    throw new Error('Fehler beim Abrufen des resultierenden Arm-Körpers.');
  }
  return resultBody;
}

/**
 * Orchestriert den Zusammenbau des symmetrischen Tetrapoden.
 * Erzeugt 4 identische Arme im tetraedrischen Winkel (arccos(-1/3) ≈ 109.47°).
 *
 * @param rootComp Die Wurzelkomponente.
 * @param params Die Benutzerparameter.
 * @returns Der finale, kombinierte Tetrapod-Körper.
 */
function createTetrapod(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>
): adsk.fusion.BRepBody {
  const features = rootComp.features;

  // 1. Ersten Arm erzeugen (Arm 0: zeigt nach unten entlang der -Z-Achse)
  const arm0Body = createSingleArm(rootComp, params);

  // 2. Zweiten Arm erzeugen (Arm 1: zeigt initial nach unten)
  const arm1Body = createSingleArm(rootComp, params);

  // 3. Arm 1 um den Tetraeder-Winkel (arccos(-1/3) ≈ 109.4712°) um die Y-Achse rotieren
  const moveFeats = features.moveFeatures;
  const moveColl = adsk.core.ObjectCollection.create();
  if (!moveColl) {
    throw new Error('Konnte ObjectCollection für MoveFeature nicht erzeugen.');
  }
  moveColl.add(arm1Body);
  const moveInput = moveFeats.createInput2(moveColl);
  if (!moveInput) {
    throw new Error('Konnte MoveFeatureInput nicht erzeugen.');
  }

  const tetraAngle = createValueInput('109.47122063449069deg');
  moveInput.defineAsRotate(rootComp.yConstructionAxis, tetraAngle);
  moveFeats.add(moveInput);

  // 4. Kreismuster (Circular Pattern): Arm 1 dreimal symmetrisch um die Z-Achse anordnen (Arm 1, 2, 3)
  const circPatterns = features.circularPatternFeatures;
  const patternColl = adsk.core.ObjectCollection.create();
  if (!patternColl) {
    throw new Error('Konnte ObjectCollection für CircularPattern nicht erzeugen.');
  }
  patternColl.add(arm1Body);
  const patternInput = circPatterns.createInput(patternColl, rootComp.zConstructionAxis);
  if (!patternInput) {
    throw new Error('Konnte CircularPatternFeatureInput nicht erzeugen.');
  }

  patternInput.quantity = createValueInput('3');
  patternInput.totalAngle = createValueInput('360deg');
  const patternFeat = circPatterns.add(patternInput);
  if (!patternFeat) {
    throw new Error('Fehler beim Erstellen des Kreismusters.');
  }

  // 5. Alle 4 Arm-Körper sammeln und zu einem Gesamtkörper verschmelzen
  const toolBodies = adsk.core.ObjectCollection.create();
  if (!toolBodies) {
    throw new Error('Konnte ObjectCollection für finale Combine-Operation nicht erzeugen.');
  }
  toolBodies.add(arm1Body);
  for (let i = 0; i < patternFeat.bodies.count; i++) {
    const b = patternFeat.bodies.item(i);
    if (b && b.name !== arm1Body.name) {
      toolBodies.add(b);
    }
  }

  const combineFeatures = features.combineFeatures;
  const combineInput = combineFeatures.createInput(arm0Body, toolBodies);
  if (!combineInput) {
    throw new Error('Konnte CombineFeatureInput für finalen Tetrapod nicht erzeugen.');
  }
  combineInput.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation;
  const combineFeat = combineFeatures.add(combineInput);
  if (!combineFeat || combineFeat.bodies.count === 0) {
    throw new Error('Fehler beim Verschmelzen aller Tetrapod-Arme.');
  }

  const resultBody = combineFeat.bodies.item(0);
  if (!resultBody) {
    throw new Error('Konnte finalen Tetrapod-Körper nicht abrufen.');
  }
  return resultBody;
}

/**
 * Schneidet eine Kugel mit dem Durchmesser innerBallDiameter direkt aus dem Zentrum (0,0,0) aus.
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param innerBallDiameterParam Der Parameter für den Kugel-Durchmesser.
 */
function cutInnerSphere(
  rootComp: adsk.fusion.Component,
  innerBallDiameterParam: adsk.fusion.UserParameter
): void {
  const center = adsk.core.Point3D.create(0, 0, 0);
  if (!center) {
    throw new Error('Konnte Ursprungspunkt Point3D(0,0,0) nicht erzeugen.');
  }

  const sketches = rootComp.sketches;
  const sketch = sketches.add(rootComp.xYConstructionPlane);
  if (!sketch) {
    throw new Error('Konnte Skizze für Kugelanschnitt nicht erzeugen.');
  }

  const radiusVal = innerBallDiameterParam.value / 2.0;

  // Halbkreis im Ursprung zeichnen
  const startPoint = adsk.core.Point3D.create(0, radiusVal, 0);
  if (!startPoint) {
    throw new Error('Konnte Startpunkt für Halbkreis nicht erzeugen.');
  }

  const arc = sketch.sketchCurves.sketchArcs.addByCenterStartSweep(
    center,
    startPoint,
    Math.PI
  );
  if (!arc) {
    throw new Error('Konnte Halbkreisbogen nicht erzeugen.');
  }

  const arcStart = arc.geometry.startPoint;
  const arcEnd = arc.geometry.endPoint;
  if (!arcStart || !arcEnd) {
    throw new Error('Konnte Endpunkte des Halbkreises nicht abrufen.');
  }

  // Schließlinie durch die Endpunkte des Bogens zeichnen
  sketch.sketchCurves.sketchLines.addByTwoPoints(arcStart, arcEnd);

  if (sketch.profiles.count === 0) {
    return;
  }
  const profile = sketch.profiles.item(0);
  if (!profile) {
    throw new Error('Konnte Profil für Kugelrevolve nicht abrufen.');
  }

  // Profil um die Y-Achse drehen (Cut-Operation)
  const revolveFeatures = rootComp.features.revolveFeatures;
  const revolveInput = revolveFeatures.createInput(
    profile,
    rootComp.yConstructionAxis,
    adsk.fusion.FeatureOperations.CutFeatureOperation
  );
  if (!revolveInput) {
    throw new Error('Konnte RevolveFeatureInput für Kugel nicht erzeugen.');
  }

  revolveInput.setAngleExtent(false, createValueInput('360 deg'));
  revolveFeatures.add(revolveInput);
}

/**
 * Step 4: Bohrt in die 4 Arme jeweils ein Loch mit dem Durchmesser holeDiameter
 * vom Zentrum (0,0,0) bis zum Ende des Arms (-arm_depth).
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param targetBody Der Tetrapod-Körper.
 * @param params Die konfigurierten Benutzerparameter.
 */
function boreArmHoles(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody,
  params: ReturnType<typeof setupParameters>
): void {
  const sketches = rootComp.sketches;
  const features = rootComp.features;
  const extrudeFeatures = features.extrudeFeatures;
  const xyPlane = rootComp.xYConstructionPlane;
  const center = adsk.core.Point3D.create(0, 0, 0);
  if (!center) {
    throw new Error('Konnte Ursprungspunkt Point3D(0,0,0) nicht erzeugen.');
  }

  // 1. Zylinder-Schneidkörper 0 erzeugen (Arm 0: entlang der -Z-Achse)
  const sketch0 = sketches.add(xyPlane);
  if (!sketch0) {
    throw new Error('Konnte Skizze für Bohrung 0 nicht erzeugen.');
  }
  sketch0.sketchCurves.sketchCircles.addByCenterRadius(
    center,
    params.holeDiameter.value / 2.0
  );
  if (sketch0.profiles.count === 0) {
    throw new Error('Konnte Profil für Bohrung 0 nicht finden.');
  }
  const prof0 = sketch0.profiles.item(0);
  if (!prof0) {
    throw new Error('Konnte Profil für Bohrung 0 nicht abrufen.');
  }

  const extInput0 = extrudeFeatures.createInput(
    prof0,
    adsk.fusion.FeatureOperations.NewBodyFeatureOperation
  );
  if (!extInput0) {
    throw new Error('Konnte ExtrudeFeatureInput für Bohrung 0 nicht erzeugen.');
  }
  extInput0.setDistanceExtent(false, createValueInput('-arm_depth'));
  const extFeat0 = extrudeFeatures.add(extInput0);
  if (!extFeat0 || extFeat0.bodies.count === 0) {
    throw new Error('Fehler beim Extrudieren des Schneidkörpers für Bohrung 0.');
  }
  const hole0Body = extFeat0.bodies.item(0);
  if (!hole0Body) {
    throw new Error('Konnte Schneidkörper für Bohrung 0 nicht abrufen.');
  }

  // 2. Zylinder-Schneidkörper 1 erzeugen (Arm 1: initial entlang -Z, dann rotieren)
  const sketch1 = sketches.add(xyPlane);
  if (!sketch1) {
    throw new Error('Konnte Skizze für Bohrung 1 nicht erzeugen.');
  }
  sketch1.sketchCurves.sketchCircles.addByCenterRadius(
    center,
    params.holeDiameter.value / 2.0
  );
  if (sketch1.profiles.count === 0) {
    throw new Error('Konnte Profil für Bohrung 1 nicht finden.');
  }
  const prof1 = sketch1.profiles.item(0);
  if (!prof1) {
    throw new Error('Konnte Profil für Bohrung 1 nicht abrufen.');
  }

  const extInput1 = extrudeFeatures.createInput(
    prof1,
    adsk.fusion.FeatureOperations.NewBodyFeatureOperation
  );
  if (!extInput1) {
    throw new Error('Konnte ExtrudeFeatureInput für Bohrung 1 nicht erzeugen.');
  }
  extInput1.setDistanceExtent(false, createValueInput('-arm_depth'));
  const extFeat1 = extrudeFeatures.add(extInput1);
  if (!extFeat1 || extFeat1.bodies.count === 0) {
    throw new Error('Fehler beim Extrudieren des Schneidkörpers für Bohrung 1.');
  }
  const hole1Body = extFeat1.bodies.item(0);
  if (!hole1Body) {
    throw new Error('Konnte Schneidkörper für Bohrung 1 nicht abrufen.');
  }

  // Schneidkörper 1 um den Tetraeder-Winkel (109.4712°) um die Y-Achse rotieren
  const moveFeats = features.moveFeatures;
  const moveColl = adsk.core.ObjectCollection.create();
  if (!moveColl) {
    throw new Error('Konnte ObjectCollection für MoveFeature der Bohrung nicht erzeugen.');
  }
  moveColl.add(hole1Body);
  const moveInput = moveFeats.createInput2(moveColl);
  if (!moveInput) {
    throw new Error('Konnte MoveFeatureInput für Bohrung 1 nicht erzeugen.');
  }
  const tetraAngle = createValueInput('109.47122063449069deg');
  moveInput.defineAsRotate(rootComp.yConstructionAxis, tetraAngle);
  moveFeats.add(moveInput);

  // 3. Kreismuster (Circular Pattern): Schneidkörper 1 dreimal symmetrisch um Z anordnen
  const circPatterns = features.circularPatternFeatures;
  const patternColl = adsk.core.ObjectCollection.create();
  if (!patternColl) {
    throw new Error('Konnte ObjectCollection für CircularPattern der Bohrungen nicht erzeugen.');
  }
  patternColl.add(hole1Body);
  const patternInput = circPatterns.createInput(patternColl, rootComp.zConstructionAxis);
  if (!patternInput) {
    throw new Error('Konnte CircularPatternFeatureInput für Bohrungen nicht erzeugen.');
  }
  patternInput.quantity = createValueInput('3');
  patternInput.totalAngle = createValueInput('360deg');
  const patternFeat = circPatterns.add(patternInput);
  if (!patternFeat) {
    throw new Error('Fehler beim Erstellen des Kreismusters für Bohrungen.');
  }

  // 4. Alle 4 Schneidkörper sammeln und aus targetBody herausschneiden (Combine Cut)
  const cutToolBodies = adsk.core.ObjectCollection.create();
  if (!cutToolBodies) {
    throw new Error('Konnte ObjectCollection für finale Bohrung-Cut-Operation nicht erzeugen.');
  }
  cutToolBodies.add(hole0Body);
  cutToolBodies.add(hole1Body);
  for (let i = 0; i < patternFeat.bodies.count; i++) {
    const b = patternFeat.bodies.item(i);
    if (b && b.name !== hole1Body.name) {
      cutToolBodies.add(b);
    }
  }

  const combineFeatures = features.combineFeatures;
  const combineInput = combineFeatures.createInput(targetBody, cutToolBodies);
  if (!combineInput) {
    throw new Error('Konnte CombineFeatureInput für Bohrungen nicht erzeugen.');
  }
  combineInput.operation = adsk.fusion.FeatureOperations.CutFeatureOperation;
  const combineFeat = combineFeatures.add(combineInput);
  if (!combineFeat) {
    throw new Error('Fehler beim Herausschneiden der 4 Bohrungen aus dem Tetrapod-Körper.');
  }
}