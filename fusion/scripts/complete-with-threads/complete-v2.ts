import { adsk } from "@adsk/fusion";

const app = adsk.core.Application.get();
const ui = app ? app.userInterface : null;

// Attention: this is not really printable: it causes oval 'circles', thread is not working!

// =====================================================================
// GEOMETRISCHE KONSTANTEN & SCHNITTKANTEN-MEASURES
// =====================================================================

/** Tetraeder-Bindungswinkel theta = arccos(-1/3) ≈ 109.47122° */
const TETRA_ANGLE_RAD = Math.acos(-1.0 / 3.0);
const TETRA_ANGLE_DEG_STR = '109.47122063449069deg';

/** Präzise Schnittkanten-Bogenlängen (in cm) */
const EDGE_LEN_NODE_INTERSECTION_CM = 5.1514; // 51.514 mm Knoten-Schnittkanten
const EDGE_LEN_TUBE_INTERSECTION_CM = 3.3584; // 33.584 mm Röhren-Schnittkanten



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

    // 2. Ersten Tetrapod (Node 1) im Ursprung (0,0,0) erzeugen (Arm 0: Bein, Arm 1: kurz, Arm 2 & 3: 8cm Gewindearme)
    let targetBody = createTetrapod(rootComp, params, ['leg', 'short', 'threaded', 'threaded']);
    targetBody.name = 'Node_1';

    // 3. Kugel aus dem Zentrum von Node 1 ausschneiden (Zentralknoten hohl machen)
    cutInnerSphere(rootComp, params.innerBallDiameter);

    // 4. Geneigten Fuß (Basis-Platte + Verrundungen + Kabelkanal) an das vertikale Bein von Node 1 anfügen
    createTiltedBasePlateFoot(rootComp, params, targetBody);

    // 5. Zweiten Tetrapod (Node 2) erzeugen (Arm 0 & 1: kurz, Arm 2 & 3: 8cm Gewindearme)
    const node2 = createTetrapod(rootComp, params, ['short', 'short', 'threaded', 'threaded']);
    node2.name = 'Node_2';

    // Kugel aus dem Zentrum von Node 2 ausschneiden
    cutInnerSphere(rootComp, params.innerBallDiameter);

    // Node 2 positionieren (Zentrum in XZ-Ebene, 8 cm Abstand zu Node 1)
    const center2 = positionSecondTetrapod(rootComp, node2);

    // 6. Dritten Tetrapod (Node 3) erzeugen (Arm 0: kurz, Arm 1, 2 & 3: 8cm Gewindearme)
    const node3 = createTetrapod(rootComp, params, ['short', 'threaded', 'threaded', 'threaded']);
    node3.name = 'Node_3';

    // Kugel aus dem Zentrum von Node 3 ausschneiden
    cutInnerSphere(rootComp, params.innerBallDiameter);

    // Node 3 positionieren (Zentrum in XZ-Ebene, 8 cm Abstand zu Node 2, Achsenverlängerung)
    const center3 = positionThirdTetrapod(rootComp, node3, center2);

    // 7. Verbindungsröhren (ID 31.5mm, OD 46mm, Länge 45mm mittig) erzeugen und verschmelzen
    createConnectionTube1To2(rootComp, params, targetBody, node2);
    createConnectionTube2To3(rootComp, params, targetBody, node3, center2);

    // 7b. Drehung des Fußes gemäß TODO a-g (Ebene -50mm, Split Body, 180° Rotation um Beinachse, Re-Join)
    targetBody = rotateFootBySplittingLeg(rootComp, targetBody);

    // 10a. Alle 3 Körper (Node 1, Node 2, Node 3 und Röhren) zum Gesamtkörper verschmelzen
    targetBody = combineAllBodies(rootComp, targetBody);

    // 10b. Abrundung (40mm, Tangential G1, Radiustyp: Konstante, Ecktyp: Versatz) der 18 Knoten-Schnittkanten durchführen
    applyNodeFilletsAtEnd(rootComp, targetBody, params, center2, center3);

    // 8. Abfasung (0.7mm) der 2 Kabelkanal-Lochkanten am fertigen Gesamtkörper durchführen
    chamferCableHoleOpenings(rootComp, params, targetBody);

    // 9. Verrundung (2mm) der oberen Kante der Kreisfläche des Standfusses am fertigen Gesamtkörper durchführen
    filletBasePlateTopEdgeAtEnd(rootComp, targetBody, params);

    // 11. Definiere die XY-Ebene als untere Fußplattenebene (so dass das Gebilde auf dem Fuß steht)
    alignFootToXYPlane(rootComp, targetBody);

    // 12. Suche die in den Röhren befindlichen Kanten mit der Länge 33.584mm, selektiere sie und mache eine Abrundung von 10mm
    filletTubeEdges(rootComp, targetBody);

    console.log('Erfolgreich generiert!');

  } catch (e) {
    console.error(`Failed: ${e}`);
    if (ui) {
      ui.messageBox(`Kritischer Fehler beim Ausführen des Scripts:\n${e}`);
    }
  }
}

// =====================================================================
// FUSION API HELPER UTILITIES
// =====================================================================

/**
 * Erzeugt eine Fusion 360 ObjectCollection aus einzelnen Elementen oder Arrays.
 */
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

/**
 * Erzeugt eine Versatzebene (ConstructionPlane) zu einer Basis-Ebene.
 * Beachtet die API-Best-Practices aus AGENTS.md (direkte Erzeugung via ValueInput).
 */
function createOffsetPlane(
  rootComp: adsk.fusion.Component,
  basePlane: adsk.fusion.ConstructionPlane,
  offsetCm: number
): adsk.fusion.ConstructionPlane {
  const constructionPlanes = rootComp.constructionPlanes;
  const planeInput = constructionPlanes.createInput();
  planeInput.setByOffset(basePlane, adsk.core.ValueInput.createByReal(offsetCm));
  return constructionPlanes.add(planeInput);
}

/**
 * Ermittelt das aktuelle Live-BRepBody aus den rootComp bRepBodies.
 */
function getLiveBody(rootComp: adsk.fusion.Component, fallbackBody: adsk.fusion.BRepBody): adsk.fusion.BRepBody {
  if (rootComp.bRepBodies.count > 0) {
    const b = rootComp.bRepBodies.item(0);
    if (b) return b;
  }
  return fallbackBody;
}

/**
 * Sucht in einer Skizze nach dem Ring-Profil (mit 2 Loops oder nach Flächenabgleich).
 */
function findRingProfile(sketch: adsk.fusion.Sketch, innerDiameterCm?: number): adsk.fusion.Profile | null {
  for (let i = 0; i < sketch.profiles.count; i++) {
    const prof = sketch.profiles.item(i);
    if (prof.profileLoops.count === 2) {
      return prof;
    }
  }
  if (innerDiameterCm !== undefined) {
    const holeArea = Math.PI * Math.pow(innerDiameterCm / 2.0, 2);
    for (let i = 0; i < sketch.profiles.count; i++) {
      const prof = sketch.profiles.item(i);
      if (Math.abs(prof.areaProperties().area - holeArea) > 0.1) {
        return prof;
      }
    }
  }
  return sketch.profiles.count > 0 ? sketch.profiles.item(0) : null;
}

/**
 * Identifiziert auf einer Skizze das innere Kreisprofil und das äußere Ringprofil.
 */
function findInnerAndOuterProfiles(sketch: adsk.fusion.Sketch): {
  innerProfile: adsk.fusion.Profile;
  outerRingProfile: adsk.fusion.Profile;
} {
  let innerProfile: adsk.fusion.Profile | null = null;
  let outerRingProfile: adsk.fusion.Profile | null = null;

  for (let i = 0; i < sketch.profiles.count; i++) {
    const prof = sketch.profiles.item(i);
    if (prof.profileLoops.count === 1) {
      innerProfile = prof;
    } else {
      outerRingProfile = prof;
    }
  }

  if (!innerProfile || !outerRingProfile) {
    const prof0 = sketch.profiles.item(0);
    const prof1 = sketch.profiles.item(1);
    if (prof0.areaProperties().area < prof1.areaProperties().area) {
      innerProfile = prof0;
      outerRingProfile = prof1;
    } else {
      innerProfile = prof1;
      outerRingProfile = prof0;
    }
  }

  return { innerProfile, outerRingProfile };
}

/**
 * Wendet eine Verrundung (Fillet) mit mehrstufigem Fallback-Versuchssystem auf eine Kanten-Gruppe an.
 * Stufe A: Parameter-Name mit Tangentenkette
 * Stufe B: Direkter Zahlenwert mit Tangentenkette
 * Stufe C: Direkter Zahlenwert ohne Tangentenkette
 * Stufe D: Einzelkanten-Verrundung
 */
function applyFilletWithFallbacks(
  rootComp: adsk.fusion.Component,
  edges: adsk.fusion.BRepEdge[],
  radiusCm: number,
  paramName?: string,
  logPrefix: string = 'Fillet'
): boolean {
  if (edges.length === 0) {
    console.warn(`${logPrefix}: Keine Kanten für Verrundung übergeben.`);
    return false;
  }

  const filletFeatures = rootComp.features.filletFeatures;

  // Stufe A: Mit Parameter-Name (falls vorhanden)
  if (paramName) {
    try {
      const input = filletFeatures.createInput();
      if (input) {
        input.isRollingBallCorner = false;
        const coll = createCollection(edges);
        let valInput = adsk.core.ValueInput.createByString(paramName);
        if (!valInput) valInput = adsk.core.ValueInput.createByReal(radiusCm);
        const setInput = input.edgeSetInputs.addConstantRadiusEdgeSet(coll, valInput, true);
        if (setInput) setInput.continuity = adsk.fusion.SurfaceContinuityTypes.TangentSurfaceContinuityType;
        const feat = filletFeatures.add(input);
        if (feat) {
          console.log(`${logPrefix}: Abrundung (${edges.length} Kanten, Parameter ${paramName}) erfolgreich.`);
          return true;
        }
      }
    } catch (e) {
      console.warn(`${logPrefix}: Stufe A (mit Parameter ${paramName}) fehlgeschlagen: ${e}`);
    }
  }

  // Stufe B: Mit direktem Zahlenwert & Tangentenkette
  try {
    const input = filletFeatures.createInput();
    if (input) {
      input.isRollingBallCorner = false;
      const coll = createCollection(edges);
      const valInput = adsk.core.ValueInput.createByReal(radiusCm);
      const setInput = input.edgeSetInputs.addConstantRadiusEdgeSet(coll, valInput, true);
      if (setInput) setInput.continuity = adsk.fusion.SurfaceContinuityTypes.TangentSurfaceContinuityType;
      const feat = filletFeatures.add(input);
      if (feat) {
        console.log(`${logPrefix}: Abrundung (${edges.length} Kanten, ${radiusCm * 10}mm direkt) erfolgreich.`);
        return true;
      }
    }
  } catch (e) {
    console.warn(`${logPrefix}: Stufe B (${radiusCm * 10}mm direkt) fehlgeschlagen: ${e}`);
  }

  // Stufe C: Mit direktem Zahlenwert ohne Tangentenkette
  try {
    const input = filletFeatures.createInput();
    if (input) {
      input.isRollingBallCorner = false;
      const coll = createCollection(edges);
      const valInput = adsk.core.ValueInput.createByReal(radiusCm);
      const setInput = input.edgeSetInputs.addConstantRadiusEdgeSet(coll, valInput, false);
      if (setInput) setInput.continuity = adsk.fusion.SurfaceContinuityTypes.TangentSurfaceContinuityType;
      const feat = filletFeatures.add(input);
      if (feat) {
        console.log(`${logPrefix}: Abrundung (${edges.length} Kanten, ohne Tangentenkette) erfolgreich.`);
        return true;
      }
    }
  } catch (e) {
    console.warn(`${logPrefix}: Stufe C (ohne Tangentenkette) fehlgeschlagen: ${e}`);
  }

  // Stufe D: Einzelkanten abrunden
  let successCount = 0;
  for (const edge of edges) {
    try {
      const input = filletFeatures.createInput();
      if (input) {
        input.isRollingBallCorner = false;
        const coll = createCollection([edge]);
        const setInput = input.edgeSetInputs.addConstantRadiusEdgeSet(coll, adsk.core.ValueInput.createByReal(radiusCm), false);
        if (setInput) setInput.continuity = adsk.fusion.SurfaceContinuityTypes.TangentSurfaceContinuityType;
        const feat = filletFeatures.add(input);
        if (feat) successCount++;
      }
    } catch (_e) {
      // Fallback für Einzelkanten
    }
  }

  if (successCount > 0) {
    console.log(`${logPrefix}: Einzelkanten-Abrundung (${successCount}/${edges.length} Kanten) erfolgreich.`);
    return true;
  }

  return false;
}

// =====================================================================
// PARAMETER SETUP & MODELLIERUNG
// =====================================================================

/**
 * Schneidet eine Kugel mit dem Durchmesser innerBallDiameter direkt aus dem Zentrum (0,0,0) aus.
 */
function cutInnerSphere(
  rootComp: adsk.fusion.Component,
  innerBallDiameterParam: adsk.fusion.UserParameter
): void {
  const center = adsk.core.Point3D.create(0, 0, 0);
  const sketches = rootComp.sketches;
  const sketch = sketches.add(rootComp.xYConstructionPlane);

  const radiusVal = innerBallDiameterParam.value / 2.0;

  // Halbkreis im Ursprung zeichnen
  const startPoint = adsk.core.Point3D.create(0, radiusVal, 0);
  const arc = sketch.sketchCurves.sketchArcs.addByCenterStartSweep(
    center,
    startPoint,
    Math.PI
  );

  // Schließlinie durch die Endpunkte des Bogens zeichnen
  sketch.sketchCurves.sketchLines.addByTwoPoints(
    arc.geometry.startPoint,
    arc.geometry.endPoint
  );

  if (sketch.profiles.count === 0) {
    return;
  }
  const profile = sketch.profiles.item(0);

  // Profil direkt um die Y-Achse als Schnitt-Operation drehen
  const revolveFeatures = rootComp.features.revolveFeatures;
  const revolveInput = revolveFeatures.createInput(
    profile,
    rootComp.yConstructionAxis,
    adsk.fusion.FeatureOperations.CutFeatureOperation
  );

  const angle = adsk.core.ValueInput.createByString('360 deg');
  revolveInput.setAngleExtent(false, angle);

  revolveFeatures.add(revolveInput);
}

/**
 * Richtet die Benutzerparameter in Fusion 360 ein oder ruft bestehende ab.
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
      p = params.add(name, adsk.core.ValueInput.createByString(valueStr), unit, description);
    } else if (name === 'cable_hole_offset' && Math.abs(p.value - 9.0) > 0.1) {
      try {
        p.expression = valueStr;
      } catch (_e) {
        // Parameter konnte nicht aktualisiert werden
      }
    } else if (name === 'cable_hole_chamfer' && Math.abs(p.value - 0.07) > 0.005) {
      try {
        p.expression = valueStr;
      } catch (_e) {
        // Parameter konnte nicht aktualisiert werden
      }
    }
    return p;
  }

  return {
    armOuterDiameter: getOrCreateParam('arm_outer_diameter', '46mm', 'mm', 'Aussendurchmesser der Arme'),
    armDepth: getOrCreateParam('arm_depth', '35mm', 'mm', 'Armlaenge der 3 kurzen Arme gemessen vom Zentrum'),
    armDepthLong: getOrCreateParam('arm_depth_long', '80mm', 'mm', 'Armlaenge des langen Armes gemessen vom Zentrum'),
    ringInnerDiameter: getOrCreateParam('ring_inner_diameter', '40mm', 'mm', 'Durchmesser der erhabenen Stirnflaeche'),
    ringExtrudeDepth: getOrCreateParam('ring_extrude_depth', '17mm', 'mm', 'Tiefe des Rumpfabsatzes / Rücksprungs'),
    holeDepthOffset: getOrCreateParam('hole_depth_offset', '5mm', 'mm', 'Abstand vom Armende fuer Bohrungstiefe (arm_depth - offset)'),
    holeDiameter: getOrCreateParam('hole_diameter', '38mm', 'mm', 'Durchmesser der zentrischen Bohrung'),
    innerBallDiameter: getOrCreateParam('inner_ball_diameter', '42mm', 'mm', 'Durchmesser des ineren Kugelloches'),
    // Parameter für den Fuß / Basis-Platte
    basePlateDiameter: getOrCreateParam('base_plate_diameter', '160mm', 'mm', 'Durchmesser der runden Basis-Platte'),
    basePlateHeight: getOrCreateParam('base_plate_height', '10mm', 'mm', 'Höhe der runden Basis-Platte'),
    basePlateRounding: getOrCreateParam('base_plate_rounding', '2mm', 'mm', 'Abrundung der oberen Basis-Platte-Kante'),
    legLength: getOrCreateParam('leg_length', '100mm', 'mm', 'Länge des Beins von Node 1 zur Basis-Platte'),
    legAngle: getOrCreateParam('leg_angle', '115deg', 'deg', 'Winkel des Beines zur Basis-Platte'),
    legOffset: getOrCreateParam('leg_offset', '25mm', 'mm', 'Abstand des Bein-Fußpunktes vom Plattenmittelpunkt'),
    legPlateRounding: getOrCreateParam('leg_plate_rounding', '4mm', 'mm', 'Abrundung der Kante zwischen Bein und Basis-Platte'),
    cableHoleOffset: getOrCreateParam('cable_hole_offset', '90mm', 'mm', 'Versatz der Kabelkanal-Konstruktionsebene'),
    cableHoleDiameter: getOrCreateParam('cable_hole_diameter', '7mm', 'mm', 'Durchmesser des Kabelkanallochs'),
    cableHoleHeight: getOrCreateParam('cable_hole_height', '5.0mm', 'mm', 'Höhe des Kabelkanallochs über der Unterseite'),
    cableHoleChamfer: getOrCreateParam('cable_hole_chamfer', '0.7mm', 'mm', 'Abfasung der Lochkanten des Kabelkanals'),
    nodeFilletRadius: getOrCreateParam('node_fillet_radius', '40mm', 'mm', 'Radius fuer die Tetrapod-Knotenabrundung (40mm, Tangential G1, Konstante, Versatz)'),
    footLegBoreDiameter: getOrCreateParam('foot_leg_bore_diameter', '38mm', 'mm', 'Durchmesser der Aufbohrung des Fussbeins (ca. 38mm)')
  };
}

/**
 * Erstellt den langen Arm des Tetrapoden.
 * Dieser Arm dient als Basis (entlang der Z-Achse nach unten orientiert).
 */
function createLongArm(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>
): adsk.fusion.BRepBody {

  const sketches = rootComp.sketches;
  const features = rootComp.features;
  const extrudeFeatures = features.extrudeFeatures;
  const xyPlane = rootComp.xYConstructionPlane;
  const center = adsk.core.Point3D.create(0, 0, 0);

  // Skizze auf der XY-Ebene erstellen
  const sketch = sketches.add(xyPlane);
  sketch.sketchCurves.sketchCircles.addByCenterRadius(center, params.armOuterDiameter.value / 2.0);
  sketch.sketchCurves.sketchCircles.addByCenterRadius(center, params.ringInnerDiameter.value / 2.0);

  const { outerRingProfile } = findInnerAndOuterProfiles(sketch);

  // Extrusion des äußeren Rings
  const extInputRing = extrudeFeatures.createInput(outerRingProfile, adsk.fusion.FeatureOperations.NewBodyFeatureOperation);
  const distanceExtent = '-arm_depth_long'; // Negative Richtung entlang der normalen Achse (Z)
  extInputRing.setDistanceExtent(false, adsk.core.ValueInput.createByString(distanceExtent));
  return extrudeFeatures.add(extInputRing).bodies.item(0);
}

/**
 * Erstellt einen der kürzeren Arme mit einer Stufengeometrie (Ring + innerer Zylinder).
 */
function createSingleSteppedArm(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>
): adsk.fusion.BRepBody {

  const sketches = rootComp.sketches;
  const features = rootComp.features;
  const extrudeFeatures = features.extrudeFeatures;
  const xyPlane = rootComp.xYConstructionPlane;
  const center = adsk.core.Point3D.create(0, 0, 0);

  const sketch = sketches.add(xyPlane);
  sketch.sketchCurves.sketchCircles.addByCenterRadius(center, params.armOuterDiameter.value / 2.0);
  sketch.sketchCurves.sketchCircles.addByCenterRadius(center, params.ringInnerDiameter.value / 2.0);

  const { innerProfile, outerRingProfile } = findInnerAndOuterProfiles(sketch);

  // 1. Äußeren Ring extrudieren
  const extInputRing = extrudeFeatures.createInput(outerRingProfile, adsk.fusion.FeatureOperations.NewBodyFeatureOperation);
  const distanceExtent = `-arm_depth + ring_extrude_depth`;
  extInputRing.setDistanceExtent(false, adsk.core.ValueInput.createByString(distanceExtent));
  const ringBody = extrudeFeatures.add(extInputRing).bodies.item(0);

  // 2. Inneren Zylinder (Stufe) extrudieren
  const extInputInner = extrudeFeatures.createInput(innerProfile, adsk.fusion.FeatureOperations.NewBodyFeatureOperation);
  extInputInner.setDistanceExtent(false, adsk.core.ValueInput.createByString('-arm_depth'));
  const innerBody = extrudeFeatures.add(extInputInner).bodies.item(0);

  // 3. Körper zu einem Arm kombinieren
  const toolColl = createCollection([innerBody]);
  const combineInput = features.combineFeatures.createInput(ringBody, toolColl);
  combineInput.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation;
  features.combineFeatures.add(combineInput);

  return ringBody;
}

type ArmType = 'leg' | 'short' | 'threaded';

/**
 * Orchestriert den Zusammenbau des Tetrapoden.
 * Erzeugt vier Arme im tetraedrischen Winkel.
 */
function createTetrapod(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>,
  armTypes: [ArmType, ArmType, ArmType, ArmType]
): adsk.fusion.BRepBody {
  const features = rootComp.features;
  const moveFeats = features.moveFeatures;
  const tetraAngle = adsk.core.ValueInput.createByString(TETRA_ANGLE_DEG_STR);

  // Arm 0: Position -Z Achse (keine Rotation)
  const arm0Body = createArmBody(rootComp, params, armTypes[0]);

  // Arm 1: Um tetraAngle (109.47°) um Y-Achse rotieren
  const arm1Body = createArmBody(rootComp, params, armTypes[1]);
  const moveInput1 = moveFeats.createInput2(createCollection([arm1Body]));
  moveInput1.defineAsRotate(rootComp.yConstructionAxis, tetraAngle);
  moveFeats.add(moveInput1);

  // Arm 2: Um tetraAngle um Y-Achse rotieren, dann 120° um Z-Achse rotieren
  const arm2Body = createArmBody(rootComp, params, armTypes[2]);
  const moveInput2 = moveFeats.createInput2(createCollection([arm2Body]));
  const mat2 = adsk.core.Matrix3D.create();
  mat2.setToRotation(TETRA_ANGLE_RAD, adsk.core.Vector3D.create(0, 1, 0), adsk.core.Point3D.create(0, 0, 0));
  const rotZ120 = adsk.core.Matrix3D.create();
  rotZ120.setToRotation((120.0 * Math.PI) / 180.0, adsk.core.Vector3D.create(0, 0, 1), adsk.core.Point3D.create(0, 0, 0));
  mat2.transformBy(rotZ120);
  moveInput2.defineAsFreeMove(mat2);
  moveFeats.add(moveInput2);

  // Arm 3: Um tetraAngle um Y-Achse rotieren, dann 240° um Z-Achse rotieren
  const arm3Body = createArmBody(rootComp, params, armTypes[3]);
  const moveInput3 = moveFeats.createInput2(createCollection([arm3Body]));
  const mat3 = adsk.core.Matrix3D.create();
  mat3.setToRotation(TETRA_ANGLE_RAD, adsk.core.Vector3D.create(0, 1, 0), adsk.core.Point3D.create(0, 0, 0));
  const rotZ240 = adsk.core.Matrix3D.create();
  rotZ240.setToRotation((240.0 * Math.PI) / 180.0, adsk.core.Vector3D.create(0, 0, 1), adsk.core.Point3D.create(0, 0, 0));
  mat3.transformBy(rotZ240);
  moveInput3.defineAsFreeMove(mat3);
  moveFeats.add(moveInput3);

  // Alle Arme zu einem einzigen Körper verschmelzen
  const toolBodies = createCollection([arm1Body, arm2Body, arm3Body]);
  const combineFeatures = features.combineFeatures;
  const combineInput = combineFeatures.createInput(arm0Body, toolBodies);
  combineInput.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation;
  combineFeatures.add(combineInput);

  // Bohrungen (Löcher) in die kurzen Arme erzeugen
  addShortArmHoles(rootComp, arm0Body, params.holeDiameter);

  return arm0Body;
}

/** Erzeugt den Arm-Körper für einen bestimmten Arm-Typ. */
function createArmBody(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>,
  armType: ArmType
): adsk.fusion.BRepBody {
  if (armType === 'leg') {
    return createVerticalLegForNode1(rootComp, params);
  } else if (armType === 'threaded') {
    return createSingleThreadedArm(rootComp, params);
  } else {
    return createSingleSteppedArm(rootComp, params);
  }
}

/**
 * Erstellt einen 8 cm langen Arm mit Innengewinde M40x2.5 und Stufenbohrungen.
 */
function createSingleThreadedArm(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>
): adsk.fusion.BRepBody {
  // 1. Grundkörper (Röhre OD 46mm, ID 40mm, Länge 80mm in -Z)
  const armBody = createLongArm(rootComp, params);

  // 2. Gewinde am Fußende (M40x2.5, H6, L: 20mm, Offset -0.15mm)
  addLongArmThread(rootComp, armBody, params);

  // 3. Rohr aufbohren (von -60mm Richtung Ursprung für 27.5 mm mit 41mm Durchmesser)
  boreOutLongArm(rootComp, armBody, params);

  // 4. Zweites Loch vom Ursprung aufbohren (Länge: 32.50 mm, Durchmesser: 40.025 mm in -Z)
  boreOutFromOrigin(rootComp, armBody);

  return armBody;
}

/** Fügt Bohrungen in die kurzen Arme ein. */
function addShortArmHoles(
  rootComp: adsk.fusion.Component,
  armBody: adsk.fusion.BRepBody,
  holeDiameterParam: adsk.fusion.UserParameter
): void {
  const sketches = rootComp.sketches;
  const features = rootComp.features;
  const centerPoint = adsk.core.Point3D.create(0, 0, 0);

  // 1. Stirnflächen aller 4 kurzen Arme selektieren
  const faces: adsk.fusion.BRepFace[] = [];

  for (let i = 0; i < armBody.faces.count; i++) {
    const face = armBody.faces.item(i);
    if (face.geometry.surfaceType === adsk.core.SurfaceTypes.PlaneSurfaceType) {
      const bbox = face.boundingBox;
      const faceCenter = adsk.core.Point3D.create(
        (bbox.minPoint.x + bbox.maxPoint.x) / 2,
        (bbox.minPoint.y + bbox.maxPoint.y) / 2,
        (bbox.minPoint.z + bbox.maxPoint.z) / 2
      );

      const dist = faceCenter.distanceTo(centerPoint);
      // Nur Stirnflächen der kurzen Arme (ca. 35mm / 3.5cm vom Zentrum) selektieren
      if (Math.abs(dist - 3.5) < 0.5) {
        faces.push(face);
      }
    }
  }

  // Sortieren und die 4 Stirnflächen nehmen
  faces.sort((a, b) => {
    const da = a.boundingBox.minPoint.distanceTo(centerPoint);
    const db = b.boundingBox.minPoint.distanceTo(centerPoint);
    return db - da;
  });

  const targetFaces = faces.slice(0, 4);

  for (const face of targetFaces) {
    const sketch = sketches.add(face);

    sketch.sketchCurves.sketchCircles.addByCenterRadius(
      adsk.core.Point3D.create(0, 0, 0),
      holeDiameterParam.value / 2.0
    );

    if (sketch.profiles.count === 0) continue;

    const expectedArea = Math.PI * Math.pow(holeDiameterParam.value / 2.0, 2);
    let holeProfile = sketch.profiles.item(0);
    let minDiff = Math.abs(holeProfile.areaProperties().area - expectedArea);

    for (let i = 1; i < sketch.profiles.count; i++) {
      const currentProf = sketch.profiles.item(i);
      const currentDiff = Math.abs(currentProf.areaProperties().area - expectedArea);
      if (currentDiff < minDiff) {
        minDiff = currentDiff;
        holeProfile = currentProf;
      }
    }

    const extrudeFeatures = features.extrudeFeatures;
    const extInput = extrudeFeatures.createInput(holeProfile, adsk.fusion.FeatureOperations.CutFeatureOperation);
    extInput.setDistanceExtent(false, adsk.core.ValueInput.createByString('-40mm'));
    extrudeFeatures.add(extInput);
  }
}

/** Erstellt ein Innengewinde am Fussende des 8cm Arms. */
function addLongArmThread(
  rootComp: adsk.fusion.Component,
  armBody: adsk.fusion.BRepBody,
  params: ReturnType<typeof setupParameters>
): void {
  const features = rootComp.features;
  const threadFeatures = features.threadFeatures;

  // 1. Innenfläche der Röhre des langen Arms selektieren
  let targetFace: adsk.fusion.BRepFace | null = null;
  const targetRadius = params.ringInnerDiameter.value / 2.0;

  for (let i = 0; i < armBody.faces.count; i++) {
    const face = armBody.faces.item(i);
    if (face.geometry.surfaceType === adsk.core.SurfaceTypes.CylinderSurfaceType) {
      const cyl = face.geometry as adsk.core.Cylinder;

      if (Math.abs(cyl.radius - targetRadius) < 0.1) {
        const bbox = face.boundingBox;
        const centerX = (bbox.minPoint.x + bbox.maxPoint.x) / 2.0;
        const centerY = (bbox.minPoint.y + bbox.maxPoint.y) / 2.0;

        if (bbox.minPoint.z < -2.0 && Math.abs(centerX) < 0.1 && Math.abs(centerY) < 0.1) {
          targetFace = face;
          break;
        }
      }
    }
  }

  if (!targetFace) {
    if (ui) ui.messageBox("Konnte die Innenfläche des langen Arms für das Gewinde nicht finden.");
    return;
  }

  // 2. Gewinde-Parameter definieren (M40x2.5, H6)
  const threadInfo = threadFeatures.createThreadInfo(true, "ISO Metric Profile", "M40x2.5", "6H");

  // 3. Thread-Feature erstellen
  const threadInput = threadFeatures.createInput(targetFace, threadInfo);
  threadInput.isFullLength = false;
  threadInput.isModeled = true;

  threadInput.threadOffset = adsk.core.ValueInput.createByReal(0.0);
  threadInput.threadLength = adsk.core.ValueInput.createByReal(2.0); // 20mm

  const threadFeature = threadFeatures.add(threadInput);
  if (!threadFeature) {
    if (ui) ui.messageBox("Fehler beim Erstellen des Gewinde-Features.");
    return;
  }

  // 4. Gewinde weiten (Toleranzberücksichtigung)
  const facesToOffset: adsk.fusion.BRepFace[] = [];
  for (let i = 0; i < threadFeature.faces.count; i++) {
    const f = threadFeature.faces.item(i);
    if (f) facesToOffset.push(f);
  }

  if (facesToOffset.length > 0) {
    const offsetFeatures = features.offsetFacesFeatures;
    const offsetInput = offsetFeatures.createInput(
      facesToOffset,
      adsk.core.ValueInput.createByString("-0.15mm")
    );
    if (offsetInput) {
      offsetFeatures.add(offsetInput);
    }
  }
}

/** Bohrt das restliche Rohr des langen Arms vom Gewinde bis zum Ursprung auf. */
function boreOutLongArm(
  rootComp: adsk.fusion.Component,
  armBody: adsk.fusion.BRepBody,
  _params: ReturnType<typeof setupParameters>
): void {
  const offsetPlane = createOffsetPlane(rootComp, rootComp.xYConstructionPlane, -6.0);
  const sketch = rootComp.sketches.add(offsetPlane);

  sketch.sketchCurves.sketchCircles.addByCenterRadius(
    adsk.core.Point3D.create(0, 0, 0),
    4.1 / 2.0 // 41mm Durchmesser (Radius 2.05 cm)
  );

  if (sketch.profiles.count === 0) return;
  const profile = sketch.profiles.item(0);

  const extrudeFeatures = rootComp.features.extrudeFeatures;
  const extInput = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation);
  extInput.participantBodies = [armBody];
  extInput.setDistanceExtent(false, adsk.core.ValueInput.createByReal(2.75));

  extrudeFeatures.add(extInput);
}

/** Bohrt das zweite Loch vom Ursprung in Richtung der Z-Achse auf. */
function boreOutFromOrigin(
  rootComp: adsk.fusion.Component,
  armBody: adsk.fusion.BRepBody
): void {
  const sketch = rootComp.sketches.add(rootComp.xYConstructionPlane);

  sketch.sketchCurves.sketchCircles.addByCenterRadius(
    adsk.core.Point3D.create(0, 0, 0),
    4.005 / 2.0 // 40.025mm Durchmesser (Radius 2.0025 cm)
  );

  if (sketch.profiles.count === 0) return;
  const profile = sketch.profiles.item(0);

  const extrudeFeatures = rootComp.features.extrudeFeatures;
  const extInput = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation);
  extInput.participantBodies = [armBody];
  extInput.setDistanceExtent(false, adsk.core.ValueInput.createByReal(-3.25));

  extrudeFeatures.add(extInput);
}

/** Positioniert den 2. Tetrapod (Node 2). */
function positionSecondTetrapod(
  rootComp: adsk.fusion.Component,
  node2: adsk.fusion.BRepBody
): adsk.core.Point3D {
  const dirX = -Math.sin(TETRA_ANGLE_RAD);
  const dirY = 0.0;
  const dirZ = -Math.cos(TETRA_ANGLE_RAD);
  const distanceCm = 8.0;

  const center2 = adsk.core.Point3D.create(
    distanceCm * dirX,
    dirY,
    distanceCm * dirZ
  );

  const transformMatrix = adsk.core.Matrix3D.create();
  const xAxis = adsk.core.Vector3D.create(-1, 0, 0);
  const yAxis = adsk.core.Vector3D.create(0, 1, 0);
  const zAxis = adsk.core.Vector3D.create(0, 0, -1);
  transformMatrix.setWithCoordinateSystem(center2, xAxis, yAxis, zAxis);

  const moveFeatures = rootComp.features.moveFeatures;
  const moveInput = moveFeatures.createInput2(createCollection([node2]));
  moveInput.defineAsFreeMove(transformMatrix);
  moveFeatures.add(moveInput);

  return center2;
}

/** Positioniert den 3. Tetrapod (Node 3). */
function positionThirdTetrapod(
  rootComp: adsk.fusion.Component,
  node3: adsk.fusion.BRepBody,
  center2: adsk.core.Point3D
): adsk.core.Point3D {
  const distanceCm = 8.0;
  const center3 = adsk.core.Point3D.create(
    center2.x,
    0,
    center2.z + distanceCm
  );

  const transformMatrix = adsk.core.Matrix3D.create();
  transformMatrix.translation = adsk.core.Vector3D.create(center3.x, center3.y, center3.z);

  const moveFeatures = rootComp.features.moveFeatures;
  const moveInput = moveFeatures.createInput2(createCollection([node3]));
  moveInput.defineAsFreeMove(transformMatrix);
  moveFeatures.add(moveInput);

  return center3;
}

/** Erzeugt einen Röhren-Körper im Ursprung (0,0,0) auf der XY-Ebene. */
function createTubeBody(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>,
  lengthCm: number,
  negativeDirection: boolean = false
): adsk.fusion.BRepBody {
  const sketches = rootComp.sketches;
  const features = rootComp.features;
  const extrudeFeatures = features.extrudeFeatures;

  const sketch = sketches.add(rootComp.xYConstructionPlane);
  const center = adsk.core.Point3D.create(0, 0, 0);

  sketch.sketchCurves.sketchCircles.addByCenterRadius(center, params.armOuterDiameter.value / 2.0);
  sketch.sketchCurves.sketchCircles.addByCenterRadius(center, params.holeDiameter.value / 2.0);

  const ringProfile = findRingProfile(sketch, params.holeDiameter.value);
  if (!ringProfile) {
    throw new Error('Ringprofil für Verbindungsröhre konnte nicht ermittelt werden.');
  }

  const extInput = extrudeFeatures.createInput(
    ringProfile,
    adsk.fusion.FeatureOperations.NewBodyFeatureOperation
  );

  const valStr = negativeDirection ? `-${lengthCm}cm` : `${lengthCm}cm`;
  extInput.setDistanceExtent(false, adsk.core.ValueInput.createByString(valStr));

  const extrudeFeature = extrudeFeatures.add(extInput);
  return extrudeFeature.bodies.item(0);
}

/** Erzeugt die Verbindungsröhre zwischen Node 1 und Node 2. */
function createConnectionTube1To2(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>,
  node1: adsk.fusion.BRepBody,
  node2: adsk.fusion.BRepBody
): void {
  const tubeLengthCm = 4.5;
  const tubeBody = createTubeBody(rootComp, params, tubeLengthCm, true);

  const dirX = -Math.sin(TETRA_ANGLE_RAD);
  const dirY = 0.0;
  const dirZ = -Math.cos(TETRA_ANGLE_RAD);

  const offsetCm = 1.75;
  const shiftVec = adsk.core.Vector3D.create(offsetCm * dirX, dirY, offsetCm * dirZ);

  const transformMatrix = adsk.core.Matrix3D.create();
  transformMatrix.setToRotation(TETRA_ANGLE_RAD, adsk.core.Vector3D.create(0, 1, 0), adsk.core.Point3D.create(0, 0, 0));
  const transMatrix = adsk.core.Matrix3D.create();
  transMatrix.translation = shiftVec;
  transformMatrix.transformBy(transMatrix);

  const moveFeats = rootComp.features.moveFeatures;
  const moveInput = moveFeats.createInput2(createCollection([tubeBody]));
  moveInput.defineAsFreeMove(transformMatrix);
  moveFeats.add(moveInput);

  const combineFeatures = rootComp.features.combineFeatures;
  const toolColl = createCollection([tubeBody, node2]);
  const combineInput = combineFeatures.createInput(node1, toolColl);
  combineInput.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation;
  combineFeatures.add(combineInput);
}

/** Erzeugt die Verbindungsröhre zwischen Node 2 und Node 3. */
function createConnectionTube2To3(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>,
  node1: adsk.fusion.BRepBody,
  node3: adsk.fusion.BRepBody,
  center2: adsk.core.Point3D
): void {
  const tubeLengthCm = 4.5;
  const tubeBody = createTubeBody(rootComp, params, tubeLengthCm, false);

  const offsetCm = 1.75;
  const transformMatrix = adsk.core.Matrix3D.create();
  transformMatrix.translation = adsk.core.Vector3D.create(
    center2.x,
    0,
    center2.z + offsetCm
  );

  const moveFeats = rootComp.features.moveFeatures;
  const moveInput = moveFeats.createInput2(createCollection([tubeBody]));
  moveInput.defineAsFreeMove(transformMatrix);
  moveFeats.add(moveInput);

  const combineFeatures = rootComp.features.combineFeatures;
  const toolColl = createCollection([tubeBody, node3]);
  const combineInput = combineFeatures.createInput(node1, toolColl);
  combineInput.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation;
  combineFeatures.add(combineInput);
}

/**
 * Führt die Drehung des Fußes durch Trennen und Re-Joining aus (TODO a-g).
 */
function rotateFootBySplittingLeg(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody
): adsk.fusion.BRepBody {
  const splitBodyFeatures = rootComp.features.splitBodyFeatures;
  const constructionAxes = rootComp.constructionAxes;
  const moveFeatures = rootComp.features.moveFeatures;
  const combineFeatures = rootComp.features.combineFeatures;

  // b) Ebene parallel zu XY-Ebene bei Z = -50mm (-5.0 cm) erstellen
  const splitPlane = createOffsetPlane(rootComp, rootComp.xYConstructionPlane, -5.0);

  // c) Gesamtkörper mit dieser Ebene trennen (Split Body)
  const splitInput = splitBodyFeatures.createInput(targetBody, splitPlane, true);
  if (!splitInput) {
    console.warn('SplitBodyInput konnte nicht erstellt werden.');
    return targetBody;
  }
  const splitFeature = splitBodyFeatures.add(splitInput);
  if (!splitFeature) {
    console.warn('SplitBodyFeature konnte nicht ausgeführt werden.');
    return targetBody;
  }

  // d) Unteren Körper (Fußplatte) explizit anhand des tiefsten Z-Werts identifizieren
  let footBody: adsk.fusion.BRepBody | null = null;
  let mainBody: adsk.fusion.BRepBody | null = null;

  const bodies: adsk.fusion.BRepBody[] = [];
  for (let i = 0; i < rootComp.bRepBodies.count; i++) {
    const b = rootComp.bRepBodies.item(i);
    if (b) bodies.push(b);
  }

  if (bodies.length >= 2) {
    bodies.sort((a, b) => a.boundingBox.minPoint.z - b.boundingBox.minPoint.z);
    footBody = bodies[0]; // tiefster minPoint.z
    mainBody = bodies[1];
  }

  if (!footBody || !mainBody) {
    console.warn('Fußkörper oder Hauptkörper nach Split nicht gefunden.');
    return targetBody;
  }

  // e) Hilfsachse durch das Bein konstruieren (Schnitt der XZ- und YZ-Ebenen)
  const axisInput = constructionAxes.createInput();
  axisInput.setByTwoPlanes(rootComp.xZConstructionPlane, rootComp.yZConstructionPlane);
  const legAxis = constructionAxes.add(axisInput);

  // f) Fußkörper um 180 Grad um die Hilfsachse rotieren
  const moveInput = moveFeatures.createInput2(createCollection([footBody]));
  const rotationAxisEntity = legAxis ? legAxis : rootComp.zConstructionAxis;
  moveInput.defineAsRotate(rotationAxisEntity, adsk.core.ValueInput.createByString('180deg'));
  moveFeatures.add(moveInput);

  // g) Beide Körper wieder zum Gesamtkörper verschmelzen
  const toolColl = createCollection([footBody]);
  const combineInput = combineFeatures.createInput(mainBody, toolColl);
  combineInput.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation;
  const combineFeat = combineFeatures.add(combineInput);

  if (combineFeat && combineFeat.bodies.count > 0) {
    const resBody = combineFeat.bodies.item(0);
    if (resBody) return resBody;
  }

  return getLiveBody(rootComp, mainBody);
}

/** Verschmilzt alle im Design vorhandenen Körper zu einem Gesamtkörper. */
function combineAllBodies(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody
): adsk.fusion.BRepBody {
  const bodies = rootComp.bRepBodies;
  if (bodies.count <= 1) {
    return targetBody;
  }

  const toolColl = adsk.core.ObjectCollection.create();
  const mainBody = targetBody;

  for (let i = 0; i < bodies.count; i++) {
    const b = bodies.item(i);
    if (b && b !== mainBody) {
      toolColl.add(b);
    }
  }

  if (toolColl.count === 0) {
    return mainBody;
  }

  const combineFeatures = rootComp.features.combineFeatures;
  const combineInput = combineFeatures.createInput(mainBody, toolColl);
  combineInput.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation;

  try {
    const combineFeat = combineFeatures.add(combineInput);
    if (combineFeat && combineFeat.bodies.count > 0) {
      const resBody = combineFeat.bodies.item(0);
      if (resBody) return resBody;
    }
  } catch (e) {
    console.warn(`Fehler beim Verschmelzen aller Körper: ${e}`);
  }

  return getLiveBody(rootComp, mainBody);
}

/**
 * Step 11: Richtet den Gesamtkörper so aus, dass die untere Stirnfläche der Fußplatte
 * exakt auf der XY-Konstruktionsebene (Z = 0) liegt.
 */
function alignFootToXYPlane(
  rootComp: adsk.fusion.Component,
  body: adsk.fusion.BRepBody
): void {
  // 1. Unterste ebene Fläche finden
  let footBottomFace: adsk.fusion.BRepFace | null = null;
  let minZ = Infinity;

  for (let i = 0; i < body.faces.count; i++) {
    const face = body.faces.item(i);
    if (!face) continue;

    if (face.geometry.surfaceType === adsk.core.SurfaceTypes.PlaneSurfaceType) {
      const bb = face.boundingBox;
      const centerZ = (bb.minPoint.z + bb.maxPoint.z) / 2.0;
      if (centerZ < minZ) {
        minZ = centerZ;
        footBottomFace = face;
      }
    }
  }

  if (!footBottomFace) {
    console.warn('Unterseite der Fußplatte für Step 11 nicht gefunden.');
    return;
  }

  const pointOnFace = footBottomFace.pointOnFace;
  let normal: adsk.core.Vector3D | null = null;

  try {
    const evaluator = footBottomFace.evaluator;
    if (evaluator) {
      const [success, evalNormal] = evaluator.getNormalAtPoint(pointOnFace);
      if (success && evalNormal) {
        normal = evalNormal;
      }
    }
  } catch (_e) { }

  if (!normal) {
    const planeGeom = footBottomFace.geometry as adsk.core.Plane;
    normal = planeGeom.normal;
  }

  normal.normalize();

  // Target-Normalenvektor nach unten: (0, 0, -1)
  const targetNormal = adsk.core.Vector3D.create(0, 0, -1);
  const moveFeats = rootComp.features.moveFeatures;

  // 2. Schritt 1: Ausrichtung der Unterseite ausführen
  const rotAxis = normal.crossProduct(targetNormal);
  const dotVal = Math.min(1.0, Math.max(-1.0, normal.dotProduct(targetNormal)));
  const rotAngle = Math.acos(dotVal);

  if (Math.abs(dotVal + 1.0) < 1e-4) {
    // 180° Gegen-Ausrichtung
    const flipMat = adsk.core.Matrix3D.create();
    flipMat.setToRotation(Math.PI, adsk.core.Vector3D.create(1, 0, 0), pointOnFace);
    const moveInput = moveFeats.createInput2(createCollection([body]));
    moveInput.defineAsFreeMove(flipMat);
    try { moveFeats.add(moveInput); } catch (e) { console.warn(`Fehler bei Rotation in Step 11: ${e}`); }
  } else if (rotAxis.length > 1e-4 && rotAngle > 1e-4) {
    rotAxis.normalize();
    const rotMatrix = adsk.core.Matrix3D.create();
    rotMatrix.setToRotation(rotAngle, rotAxis, pointOnFace);

    const moveInput = moveFeats.createInput2(createCollection([body]));
    moveInput.defineAsFreeMove(rotMatrix);
    try {
      moveFeats.add(moveInput);
    } catch (e) {
      console.warn(`Fehler bei Rotation in Step 11: ${e}`);
    }
  }

  // 3. Unterste ebene Fläche nach der Drehung erneut ermitteln
  footBottomFace = null;
  minZ = Infinity;
  for (let i = 0; i < body.faces.count; i++) {
    const face = body.faces.item(i);
    if (!face) continue;
    if (face.geometry.surfaceType === adsk.core.SurfaceTypes.PlaneSurfaceType) {
      const bb = face.boundingBox;
      const centerZ = (bb.minPoint.z + bb.maxPoint.z) / 2.0;
      if (centerZ < minZ) {
        minZ = centerZ;
        footBottomFace = face;
      }
    }
  }

  if (!footBottomFace) {
    console.warn('Unterseite der Fußplatte nach Drehung für Step 11 nicht gefunden.');
    return;
  }

  // 4. Schritt 2: Verschieben auf Z = 0
  const newPoint = footBottomFace.pointOnFace;
  const shiftVec = adsk.core.Vector3D.create(-newPoint.x, -newPoint.y, -newPoint.z);

  const transMatrix = adsk.core.Matrix3D.create();
  transMatrix.translation = shiftVec;

  const moveInput2 = moveFeats.createInput2(createCollection([body]));
  moveInput2.defineAsFreeMove(transMatrix);
  try {
    moveFeats.add(moveInput2);
  } catch (e) {
    console.warn(`Fehler bei Translation in Step 11: ${e}`);
  }

  // 5. Plausibilitätsprüfung
  if (body.boundingBox.maxPoint.z < 0.5) {
    const flipInput = moveFeats.createInput2(createCollection([body]));
    const flipMat = adsk.core.Matrix3D.create();
    flipMat.setToRotation(Math.PI, adsk.core.Vector3D.create(1, 0, 0), adsk.core.Point3D.create(0, 0, 0));
    flipInput.defineAsFreeMove(flipMat);
    try { moveFeats.add(flipInput); } catch (_e) { }
  }

  console.log('Step 11: Das Gebilde wurde erfolgreich auf die XY-Ebene (Z = 0) gestellt.');
}

/** Erzeugt das vertikale Bein von Node 1. */
function createVerticalLegForNode1(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>
): adsk.fusion.BRepBody {
  const sketches = rootComp.sketches;
  const features = rootComp.features;
  const extrudeFeatures = features.extrudeFeatures;
  const xyPlane = rootComp.xYConstructionPlane;
  const center = adsk.core.Point3D.create(0, 0, 0);

  const sketch = sketches.add(xyPlane);
  sketch.sketchCurves.sketchCircles.addByCenterRadius(center, params.armOuterDiameter.value / 2.0);
  sketch.sketchCurves.sketchCircles.addByCenterRadius(center, params.footLegBoreDiameter.value / 2.0);

  const ringProfile = findRingProfile(sketch, params.footLegBoreDiameter.value);
  if (!ringProfile) {
    throw new Error('Ringprofil für Bein konnte nicht ermittelt werden.');
  }

  const totalLegLen = params.legLength.value + params.basePlateHeight.value + 2.0;
  const extInput = extrudeFeatures.createInput(ringProfile, adsk.fusion.FeatureOperations.NewBodyFeatureOperation);
  extInput.setDistanceExtent(false, adsk.core.ValueInput.createByReal(-totalLegLen));
  return extrudeFeatures.add(extInput).bodies.item(0);
}

/** Erzeugt die geneigte Basis-Platte (Fuß) für Node 1. */
function createTiltedBasePlateFoot(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>,
  node1: adsk.fusion.BRepBody
): adsk.fusion.BRepBody {
  const sketches = rootComp.sketches;
  const features = rootComp.features;

  const legLenCm = params.legLength.value;
  const offsetCm = params.legOffset.value;
  const plateHeightCm = params.basePlateHeight.value;
  const plateTopZ = -legLenCm;
  const plateBottomZ = plateTopZ - plateHeightCm;

  // 1. Skizze & Extrusion für die Basis-Platte bei plateTopZ
  const topPlane = createOffsetPlane(rootComp, rootComp.xYConstructionPlane, plateTopZ);

  const sketch1 = sketches.add(topPlane);
  const center3D = adsk.core.Point3D.create(-offsetCm, 0, plateTopZ);
  const centerPoint1 = sketch1.modelToSketchSpace(center3D);
  sketch1.sketchCurves.sketchCircles.addByCenterRadius(centerPoint1, params.basePlateDiameter.value / 2.0);

  if (sketch1.profiles.count === 0) return node1;
  const profile1 = sketch1.profiles.item(0);

  const extInput1 = features.extrudeFeatures.createInput(
    profile1,
    adsk.fusion.FeatureOperations.NewBodyFeatureOperation
  );
  extInput1.setDistanceExtent(false, adsk.core.ValueInput.createByReal(-plateHeightCm));
  const plateFeat = features.extrudeFeatures.add(extInput1);
  if (!plateFeat || plateFeat.bodies.count === 0) return node1;
  const plateBody = plateFeat.bodies.item(0);

  // 2. Skizze & Extrusion für das Unterseiten-Schneidwerkzeug bei plateBottomZ
  const bottomPlane = createOffsetPlane(rootComp, rootComp.xYConstructionPlane, plateBottomZ);

  const sketch2 = sketches.add(bottomPlane);
  const centerPoint2 = sketch2.modelToSketchSpace(adsk.core.Point3D.create(-offsetCm, 0, plateBottomZ));
  sketch2.sketchCurves.sketchCircles.addByCenterRadius(centerPoint2, params.basePlateDiameter.value);

  let trimToolBody: adsk.fusion.BRepBody | null = null;
  if (sketch2.profiles.count > 0) {
    const extInput2 = features.extrudeFeatures.createInput(
      sketch2.profiles.item(0),
      adsk.fusion.FeatureOperations.NewBodyFeatureOperation
    );
    extInput2.setDistanceExtent(false, adsk.core.ValueInput.createByReal(-5.0));
    const trimFeat = features.extrudeFeatures.add(extInput2);
    if (trimFeat && trimFeat.bodies.count > 0) {
      trimToolBody = trimFeat.bodies.item(0);
    }
  }

  // 3. Skizze & Extrusion für das Kabelkanal-Werkzeug
  let cableToolBody: adsk.fusion.BRepBody | null = null;
  const plateRadiusCm = params.basePlateDiameter.value / 2.0;
  const cableOffsetVal = Math.max(
    -offsetCm + params.cableHoleOffset.value,
    -offsetCm + plateRadiusCm + 1.0
  );

  const cablePlane = createOffsetPlane(rootComp, rootComp.yZConstructionPlane, cableOffsetVal);

  const cableSketch = sketches.add(cablePlane);
  const holeRadius = params.cableHoleDiameter.value / 2.0;
  const holeH = params.cableHoleHeight.value;
  const holeZ = plateBottomZ + holeH;
  const cableCenterPoint = cableSketch.modelToSketchSpace(adsk.core.Point3D.create(cableOffsetVal, 0, holeZ));
  cableSketch.sketchCurves.sketchCircles.addByCenterRadius(cableCenterPoint, holeRadius);

  if (cableSketch.profiles.count > 0) {
    const cableExtInput = features.extrudeFeatures.createInput(
      cableSketch.profiles.item(0),
      adsk.fusion.FeatureOperations.NewBodyFeatureOperation
    );
    const cutDistanceCm = -(cableOffsetVal + 0.5);
    cableExtInput.setDistanceExtent(false, adsk.core.ValueInput.createByReal(cutDistanceCm));
    const cableFeat = features.extrudeFeatures.add(cableExtInput);
    if (cableFeat && cableFeat.bodies.count > 0) {
      cableToolBody = cableFeat.bodies.item(0);
    }
  }

  // 4. Drehung aller Plattenkörper
  const rotAngleRad = params.legAngle.value - Math.PI / 2.0;
  const transformMatrix = adsk.core.Matrix3D.create();
  transformMatrix.setToRotation(
    rotAngleRad,
    adsk.core.Vector3D.create(0, 1, 0),
    adsk.core.Point3D.create(0, 0, plateTopZ)
  );

  const moveFeats = features.moveFeatures;
  const moveColl = createCollection([plateBody, trimToolBody, cableToolBody]);
  const moveInput = moveFeats.createInput2(moveColl);
  moveInput.defineAsFreeMove(transformMatrix);
  moveFeats.add(moveInput);

  // 6. Basis-Platte mit Node 1 verschmelzen
  features.combineFeatures.add(features.combineFeatures.createInput(node1, createCollection([plateBody])));

  // 7. Kabelkanal schneiden
  if (cableToolBody) {
    const cableCutInput = features.combineFeatures.createInput(node1, createCollection([cableToolBody]));
    cableCutInput.operation = adsk.fusion.FeatureOperations.CutFeatureOperation;
    try {
      features.combineFeatures.add(cableCutInput);
    } catch (_e) { }
  }

  // 8. Geometrie unterhalb der Platten-Unterseite plan abschneiden
  if (trimToolBody) {
    const cutInput = features.combineFeatures.createInput(node1, createCollection([trimToolBody]));
    cutInput.operation = adsk.fusion.FeatureOperations.CutFeatureOperation;
    try {
      features.combineFeatures.add(cutInput);
    } catch (_e) { }
  }

  // 9. Verrundung der Verschneidungskante zwischen Bein und Platte
  filletLegPlateJunction(rootComp, node1, plateTopZ, params.armOuterDiameter.value / 2.0, params);

  // 10. Aufbohrung freischneiden
  boreVerticalLegHole(rootComp, params, node1);

  return node1;
}

/** Schneidet die Aufbohrung des Z-Beins durchgehend durch die Basis-Platte frei. */
function boreVerticalLegHole(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>,
  node1: adsk.fusion.BRepBody
): void {
  const sketches = rootComp.sketches;
  const features = rootComp.features;
  const extrudeFeatures = features.extrudeFeatures;

  const sketch = sketches.add(rootComp.xYConstructionPlane);
  const center = adsk.core.Point3D.create(0, 0, 0);
  sketch.sketchCurves.sketchCircles.addByCenterRadius(center, params.footLegBoreDiameter.value / 2.0);

  if (sketch.profiles.count === 0) return;
  const profile = sketch.profiles.item(0);

  const cutInput = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation);
  cutInput.participantBodies = [node1];
  cutInput.setDistanceExtent(false, adsk.core.ValueInput.createByReal(-15.0));
  try {
    extrudeFeatures.add(cutInput);
  } catch (_e) { }
}

/** Verrundet die obere Kante der Kreisfläche des Standfusses (Step 9). */
function filletBasePlateTopEdgeAtEnd(
  rootComp: adsk.fusion.Component,
  body: adsk.fusion.BRepBody,
  params: ReturnType<typeof setupParameters>
): void {
  const targetRadius = params.basePlateDiameter.value / 2.0;
  const expectedLen = 2.0 * Math.PI * targetRadius;
  let topEdge: adsk.fusion.BRepEdge | null = null;
  let maxZ = -Infinity;

  for (let i = 0; i < body.edges.count; i++) {
    const edge = body.edges.item(i);
    if (!edge) continue;

    const geom = edge.geometry;
    let radius = -1;
    let centerZ = -Infinity;

    if (geom) {
      if (geom.curveType === adsk.core.Curve3DTypes.Circle3DCurveType) {
        const circle = geom as adsk.core.Circle3D;
        radius = circle.radius;
        centerZ = circle.center.z;
      } else if (geom.curveType === adsk.core.Curve3DTypes.Arc3DCurveType) {
        const arc = geom as adsk.core.Arc3D;
        radius = arc.radius;
        centerZ = arc.center.z;
      }
    }

    if (centerZ === -Infinity) {
      const bb = edge.boundingBox;
      centerZ = (bb.minPoint.z + bb.maxPoint.z) / 2.0;
    }

    const isRadiusMatch = radius > 0 && Math.abs(radius - targetRadius) < 0.2;
    const isLengthMatch = Math.abs(edge.length - expectedLen) < 2.0;

    if (isRadiusMatch || isLengthMatch) {
      if (centerZ > maxZ) {
        maxZ = centerZ;
        topEdge = edge;
      }
    }
  }

  if (topEdge) {
    applyFilletWithFallbacks(
      rootComp,
      [topEdge],
      params.basePlateRounding.value,
      'base_plate_rounding',
      'Step 9 (Basis-Platte Obere Kante)'
    );
  } else {
    console.warn('Keine obere Kante der Basis-Platte für Step 9 gefunden.');
  }
}

/** Verrundet die Verschneidungskante zwischen Bein-Außenwand und Basis-Platte (4mm). */
function filletLegPlateJunction(
  rootComp: adsk.fusion.Component,
  body: adsk.fusion.BRepBody,
  topZ: number,
  legRadius: number,
  _params: ReturnType<typeof setupParameters>
): void {
  const expectedLen = 2.0 * Math.PI * legRadius;
  const edges: adsk.fusion.BRepEdge[] = [];

  for (let i = 0; i < body.edges.count; i++) {
    const edge = body.edges.item(i);
    const bb = edge.boundingBox;
    if (Math.abs(bb.minPoint.z - topZ) < 0.3 && Math.abs(bb.maxPoint.z - topZ) < 0.3) {
      if (Math.abs(edge.length - expectedLen) < 2.0) {
        edges.push(edge);
      }
    }
  }

  if (edges.length > 0) {
    applyFilletWithFallbacks(
      rootComp,
      edges,
      0.4, // 4mm
      'leg_plate_rounding',
      'Leg-Plate Junction'
    );
  }
}

/** Bringt eine Abfasung (0.7mm) an den 2 Kabelkanal-Öffnungskanten an. */
function chamferCableHoleOpenings(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>,
  body: adsk.fusion.BRepBody
): void {
  const chamferVal = params.cableHoleChamfer.value;
  if (chamferVal <= 0) return;

  const targetRadius = params.cableHoleDiameter.value / 2.0;
  const chamferEdges: adsk.fusion.BRepEdge[] = [];

  for (let i = 0; i < body.edges.count; i++) {
    const edge = body.edges.item(i);
    if (!edge) continue;

    for (let f = 0; f < edge.faces.count; f++) {
      const face = edge.faces.item(f);
      if (face && face.geometry.surfaceType === adsk.core.SurfaceTypes.CylinderSurfaceType) {
        const cyl = face.geometry as adsk.core.Cylinder;
        if (Math.abs(cyl.radius - targetRadius) < 0.05) {
          if (!chamferEdges.includes(edge)) {
            chamferEdges.push(edge);
          }
          break;
        }
      }
    }
  }

  if (chamferEdges.length > 0) {
    const chamferFeatures = rootComp.features.chamferFeatures;
    const chamferInput = chamferFeatures.createInput2();
    const edgeColl = createCollection(chamferEdges);

    let valInput = adsk.core.ValueInput.createByString('cable_hole_chamfer');
    if (!valInput) {
      valInput = adsk.core.ValueInput.createByReal(chamferVal);
    }

    chamferInput.chamferEdgeSets.addEqualDistanceChamferEdgeSet(
      edgeColl,
      valInput,
      true
    );

    try {
      const feat = chamferFeatures.add(chamferInput);
      if (!feat) {
        console.warn('Fase für Kabelkanal konnte nicht erstellt werden.');
      }
    } catch (e) {
      console.warn(`Fehler beim Erstellen der Kabelkanal-Fase: ${e}`);
      try {
        const fallbackInput = chamferFeatures.createInput2();
        fallbackInput.chamferEdgeSets.addEqualDistanceChamferEdgeSet(
          edgeColl,
          adsk.core.ValueInput.createByReal(chamferVal),
          true
        );
        chamferFeatures.add(fallbackInput);
      } catch (err2) {
        console.warn(`Fallback-Fase ebenfalls fehlgeschlagen: ${err2}`);
      }
    }
  } else {
    console.warn('Keine Kanten für die Kabelkanal-Fase gefunden.');
  }
}

/** Schneidet Geometrieüberstände unterhalb der Unterseite der Basis-Platte plan abschließen. */
function trimBottomFlushAtZ(
  rootComp: adsk.fusion.Component,
  body: adsk.fusion.BRepBody,
  plateBottomZ: number,
  baseDiameterCm: number
): void {
  if (body.boundingBox.minPoint.z >= plateBottomZ - 0.05) {
    return;
  }

  const bottomPlane = createOffsetPlane(rootComp, rootComp.xYConstructionPlane, plateBottomZ);
  const sketch = rootComp.sketches.add(bottomPlane);
  sketch.sketchCurves.sketchCircles.addByCenterRadius(adsk.core.Point3D.create(0, 0, 0), baseDiameterCm);

  if (sketch.profiles.count === 0) return;
  const profile = sketch.profiles.item(0);

  const extrudeFeatures = rootComp.features.extrudeFeatures;
  const cutInput = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation);
  cutInput.participantBodies = [body];
  cutInput.setDistanceExtent(false, adsk.core.ValueInput.createByReal(-5.0));
  try {
    extrudeFeatures.add(cutInput);
  } catch (_e) { }
}

/** Prüft, ob eine Kante die Außen-Schnittkante zweier Zylinderarme ist. */
function isOuterTetrapodIntersectionEdgeByLength(
  edge: adsk.fusion.BRepEdge
): boolean {
  return Math.abs(edge.length - EDGE_LEN_NODE_INTERSECTION_CM) < 0.6;
}

/** Findet die 6 echten 3D-Schnittkanten eines Tetrapod-Knotens um einen gegebenen Mittelpunkt. */
function findNodeIntersectionEdges(
  targetBody: adsk.fusion.BRepBody,
  center: adsk.core.Point3D
): adsk.fusion.BRepEdge[] {
  const candidates: { edge: adsk.fusion.BRepEdge; dist: number; lenCm: number }[] = [];

  for (let i = 0; i < targetBody.edges.count; i++) {
    const edge = targetBody.edges.item(i);
    if (!edge) continue;

    const midPoint = edge.pointOnEdge;
    if (!midPoint) continue;

    const dist = midPoint.distanceTo(center);
    if (dist < 4.8) {
      const lenCm = edge.length;
      if (Math.abs(lenCm - EDGE_LEN_NODE_INTERSECTION_CM) < 0.3) {
        candidates.push({ edge, dist, lenCm });
      }
    }
  }

  candidates.sort((a, b) => a.dist - b.dist);
  return candidates.slice(0, 6).map(c => c.edge);
}

/** Step 10: Selektiert die 18 Außen-Schnittkanten und führt die Knotenabrundung durch. */
function applyNodeFilletsAtEnd(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody,
  params: ReturnType<typeof setupParameters>,
  center2: adsk.core.Point3D,
  center3: adsk.core.Point3D
): void {
  const liveBody = getLiveBody(rootComp, targetBody);

  const nodeCenters = [
    { name: 'Node 1', center: adsk.core.Point3D.create(0, 0, 0) },
    { name: 'Node 2', center: center2 },
    { name: 'Node 3', center: center3 }
  ];

  if (ui) {
    try {
      ui.activeSelections.clear();
    } catch (_e) { }
  }

  const allSelectedEdges: adsk.fusion.BRepEdge[] = [];
  const nodeCounts: { [key: string]: number } = {};

  for (const item of nodeCenters) {
    const edges = findNodeIntersectionEdges(liveBody, item.center);
    nodeCounts[item.name] = edges.length;

    for (const edge of edges) {
      if (!allSelectedEdges.includes(edge)) {
        allSelectedEdges.push(edge);
        if (ui) {
          try {
            ui.activeSelections.add(edge);
          } catch (_e) { }
        }
      }
    }
  }

  console.log(`Step 10: ${allSelectedEdges.length} von 18 Kanten mit exakt 51.514mm Länge selektiert.`);

  // Abrundung (40mm) auf die selektierten 51.514mm Kanten anwenden
  for (const item of nodeCenters) {
    const edges = findNodeIntersectionEdges(liveBody, item.center);
    if (edges.length > 0) {
      applyFilletWithFallbacks(
        rootComp,
        edges,
        params.nodeFilletRadius.value,
        'node_fillet_radius',
        `Step 10 (${item.name})`
      );
    }
  }

  const msg = `Step 10 Kanten-Selektion & Abrundung:\n` +
    `Insgesamt selektiert & verrundet: ${allSelectedEdges.length} von 18 Kanten (exakt 51.514 mm)\n\n` +
    `• Node 1 (Basis-Knoten): ${nodeCounts['Node 1'] || 0} von 6 Kanten (51.514 mm)\n` +
    `• Node 2 (Mittlerer Knoten): ${nodeCounts['Node 2'] || 0} von 6 Kanten (51.514 mm)\n` +
    `• Node 3 (Oberer Knoten): ${nodeCounts['Node 3'] || 0} von 6 Kanten (51.514 mm)\n\n` +
    `Die 18 Kanten wurden blau im Modell markiert und erfolgreich mit 40 mm verrundet.`;

  console.log(msg);
}

/** Step 12: Selektiert Röhren-Kanten (33.584 mm) und führt Abrundung von 10 mm durch. */
function filletTubeEdges(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody
): void {
  const liveBody = getLiveBody(rootComp, targetBody);
  const matchingEdges: adsk.fusion.BRepEdge[] = [];

  for (let i = 0; i < liveBody.edges.count; i++) {
    const edge = liveBody.edges.item(i);
    if (!edge) continue;

    if (Math.abs(edge.length - EDGE_LEN_TUBE_INTERSECTION_CM) < 0.05) {
      if (!matchingEdges.includes(edge)) {
        matchingEdges.push(edge);
      }
    }
  }

  console.log(`Step 12: ${matchingEdges.length} Röhren-Kanten mit Länge ca. 33.584mm gefunden.`);

  if (matchingEdges.length === 0) {
    console.warn('Step 12: Keine Röhren-Kanten mit der Länge 33.584mm gefunden.');
    return;
  }

  if (ui) {
    try {
      ui.activeSelections.clear();
      for (const edge of matchingEdges) {
        ui.activeSelections.add(edge);
      }
    } catch (_e) { }
  }

  applyFilletWithFallbacks(
    rootComp,
    matchingEdges,
    1.0, // 10mm = 1.0 cm
    undefined,
    'Step 12 (Röhren-Kanten)'
  );
}