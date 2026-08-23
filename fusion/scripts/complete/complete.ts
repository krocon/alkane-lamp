
import { adsk } from "@adsk/fusion";

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

    // 2. Ersten Tetrapod (Node 1) im Ursprung (0,0,0) erzeugen (Arm 0: Bein, Arm 1: kurz, Arm 2 & 3: 8cm Gewindearme)
    const targetBody = createTetrapod(rootComp, params, ['leg', 'short', 'threaded', 'threaded']);
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

    // 8. Abfasung (0.7mm) der 2 Kabelkanal-Lochkanten am fertigen Gesamtkörper durchführen
    chamferCableHoleOpenings(rootComp, params, targetBody);

    // 9. Verrundung (2mm) der oberen Kante der Kreisfläche des Standfusses am fertigen Gesamtkörper durchführen
    filletBasePlateTopEdgeAtEnd(rootComp, targetBody, params);

    // 10. Abrundung (40mm, Tangential G1, Radiustyp: Konstante, Ecktyp: Versatz) der 18 Knoten-Schnittkanten am fertigen Gesamtkörper durchführen
    applyNodeFilletsAtEnd(rootComp, targetBody, params, center2, center3);

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
    holeDiameter: getOrCreateParam('hole_diameter', '31.5mm', 'mm', 'Durchmesser der zentrischen Bohrung'),
    innerBallDiameter: getOrCreateParam('inner_ball_diameter', '42mm', 'mm', 'Durchmesser des ineren Kugelloches'),
    // Parameter für den Fuß / Basis-Platte (wie in al-base-plate-simple-cable-hole.ts)
    basePlateDiameter: getOrCreateParam('base_plate_diameter', '160mm', 'mm', 'Durchmesser der runden Basis-Platte'),
    basePlateHeight: getOrCreateParam('base_plate_height', '10mm', 'mm', 'Höhe der runden Basis-Platte'),
    basePlateRounding: getOrCreateParam('base_plate_rounding', '2mm', 'mm', 'Abrundung der oberen Basis-Platte-Kante'),
    legLength: getOrCreateParam('leg_length', '100mm', 'mm', 'Länge des Beins von Node 1 zur Basis-Platte'),
    legAngle: getOrCreateParam('leg_angle', '100deg', 'deg', 'Winkel des Beines zur Basis-Platte'),
    // legAngle: getOrCreateParam('leg_angle', '109.47122063449069deg', 'deg', 'Winkel des Beines zur Basis-Platte (parallel zum Verbindungsarm Node 1 -> Node 2)'),
    legOffset: getOrCreateParam('leg_offset', '45mm', 'mm', 'Abstand des Bein-Fußpunktes vom Plattenmittelpunkt'),
    legPlateRounding: getOrCreateParam('leg_plate_rounding', '4mm', 'mm', 'Abrundung der Kante zwischen Bein und Basis-Platte'),
    cableHoleOffset: getOrCreateParam('cable_hole_offset', '90mm', 'mm', 'Versatz der Kabelkanal-Konstruktionsebene'),
    cableHoleDiameter: getOrCreateParam('cable_hole_diameter', '6mm', 'mm', 'Durchmesser des Kabelkanallochs'),
    cableHoleHeight: getOrCreateParam('cable_hole_height', '4.5mm', 'mm', 'Höhe des Kabelkanallochs über der Unterseite'),
    cableHoleChamfer: getOrCreateParam('cable_hole_chamfer', '0.7mm', 'mm', 'Abfasung der Lochkanten des Kabelkanals'),
    nodeFilletRadius: getOrCreateParam('node_fillet_radius', '40mm', 'mm', 'Radius fuer die Tetrapod-Knotenabrundung (40mm, Tangential G1, Konstante, Versatz)')
  };
}

/**
 * Erstellt den langen Arm des Tetrapoden.
 * Dieser Arm dient als Basis (entlang der Z-Achse nach unten orientiert).
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param params Die konfigurierten Benutzerparameter.
 * @returns Der erzeugte BRepBody des langen Arms.
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

  let innerProfile: adsk.fusion.Profile | null = null;
  let outerRingProfile: adsk.fusion.Profile | null = null;

  // Profile identifizieren: Wir unterscheiden zwischen dem inneren Kreis und dem äußeren Ring
  for (let i = 0; i < sketch.profiles.count; i++) {
    const prof = sketch.profiles.item(i);
    if (prof.profileLoops.count === 1) {
      innerProfile = prof; // Der volle Kreis (innen)
    } else {
      outerRingProfile = prof; // Der Ring (zwischen den Kreisen)
    }
  }

  // Fallback-Logik zur Profilfindung falls die Loop-Zählung nicht eindeutig ist
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

  // Extrusion des äußeren Rings
  const extInputRing = extrudeFeatures.createInput(outerRingProfile, adsk.fusion.FeatureOperations.NewBodyFeatureOperation);
  const distanceExtent = '-arm_depth_long'; // Negative Richtung entlang der normalen Achse (Z)
  extInputRing.setDistanceExtent(false, adsk.core.ValueInput.createByString(distanceExtent));
  return extrudeFeatures.add(extInputRing).bodies.item(0);
}

/**
 * Erstellt einen der kürzeren Arme mit einer Stufengeometrie (Ring + innerer Zylinder).
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param params Die konfigurierten Benutzerparameter.
 * @returns Der erzeugte (kombinierte) BRepBody des gestuften Arms.
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
  const toolColl = adsk.core.ObjectCollection.create();
  toolColl.add(innerBody);
  const combineInput = features.combineFeatures.createInput(ringBody, toolColl);
  combineInput.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation;
  features.combineFeatures.add(combineInput);

  return ringBody;
}

type ArmType = 'leg' | 'short' | 'threaded';

/**
 * Orchestriert den Zusammenbau des Tetrapoden.
 * Erzeugt vier Arme (Bein, kurzer Verbindungsarm oder 8cm Gewindearm), die im tetraedrischen Winkel angeordnet werden.
 *
 * @param rootComp Die Wurzelkomponente.
 * @param params Die Benutzerparameter.
 * @param armTypes Typen der 4 Arme: [Arm0, Arm1, Arm2, Arm3]
 * @returns Der finale, kombinierte Tetrapod-Körper.
 */
function createTetrapod(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>,
  armTypes: [ArmType, ArmType, ArmType, ArmType]
): adsk.fusion.BRepBody {
  const features = rootComp.features;
  const moveFeats = features.moveFeatures;
  const tetraAngle = adsk.core.ValueInput.createByString('109.47122063449069deg');
  const tetraAngleRad = Math.acos(-1.0 / 3.0);

  // Arm 0: Position -Z Achse (keine Rotation)
  const arm0Body = createArmBody(rootComp, params, armTypes[0]);

  // Arm 1: Um tetraAngle (109.47°) um Y-Achse rotieren
  const arm1Body = createArmBody(rootComp, params, armTypes[1]);
  const moveColl1 = adsk.core.ObjectCollection.create();
  moveColl1.add(arm1Body);
  const moveInput1 = moveFeats.createInput2(moveColl1);
  moveInput1.defineAsRotate(rootComp.yConstructionAxis, tetraAngle);
  moveFeats.add(moveInput1);

  // Arm 2: Um tetraAngle um Y-Achse rotieren, dann 120° um Z-Achse rotieren
  const arm2Body = createArmBody(rootComp, params, armTypes[2]);
  const moveColl2 = adsk.core.ObjectCollection.create();
  moveColl2.add(arm2Body);
  const moveInput2 = moveFeats.createInput2(moveColl2);
  const mat2 = adsk.core.Matrix3D.create();
  mat2.setToRotation(tetraAngleRad, adsk.core.Vector3D.create(0, 1, 0), adsk.core.Point3D.create(0, 0, 0));
  const rotZ120 = adsk.core.Matrix3D.create();
  rotZ120.setToRotation((120.0 * Math.PI) / 180.0, adsk.core.Vector3D.create(0, 0, 1), adsk.core.Point3D.create(0, 0, 0));
  mat2.transformBy(rotZ120);
  moveInput2.defineAsFreeMove(mat2);
  moveFeats.add(moveInput2);

  // Arm 3: Um tetraAngle um Y-Achse rotieren, dann 240° um Z-Achse rotieren
  const arm3Body = createArmBody(rootComp, params, armTypes[3]);
  const moveColl3 = adsk.core.ObjectCollection.create();
  moveColl3.add(arm3Body);
  const moveInput3 = moveFeats.createInput2(moveColl3);
  const mat3 = adsk.core.Matrix3D.create();
  mat3.setToRotation(tetraAngleRad, adsk.core.Vector3D.create(0, 1, 0), adsk.core.Point3D.create(0, 0, 0));
  const rotZ240 = adsk.core.Matrix3D.create();
  rotZ240.setToRotation((240.0 * Math.PI) / 180.0, adsk.core.Vector3D.create(0, 0, 1), adsk.core.Point3D.create(0, 0, 0));
  mat3.transformBy(rotZ240);
  moveInput3.defineAsFreeMove(mat3);
  moveFeats.add(moveInput3);

  // Alle Arme zu einem einzigen Körper verschmelzen
  const toolBodies = adsk.core.ObjectCollection.create();
  toolBodies.add(arm1Body);
  toolBodies.add(arm2Body);
  toolBodies.add(arm3Body);

  const combineFeatures = features.combineFeatures;
  const combineInput = combineFeatures.createInput(arm0Body, toolBodies);
  combineInput.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation;
  combineFeatures.add(combineInput);

  // Bohrungen (Löcher) in die kurzen Arme erzeugen
  addShortArmHoles(rootComp, arm0Body, params.holeDiameter);

  return arm0Body;
}

/**
 * Erzeugt den Arm-Körper für einen bestimmten Arm-Typ.
 */
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
 * Erstellt einen 8 cm langen Arm mit Innengewinde M40x2.5 und Stufenbohrungen
 * analog zu fusion/scripts/leg-with-thread/al-leg-with-thread.ts.
 */
function createSingleThreadedArm(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>
): adsk.fusion.BRepBody {
  // 1. Grundkörper (Röhre OD 46mm, ID 40mm, Länge 80mm in -Z)
  const armBody = createLongArm(rootComp, params);

  // 2. Gewinde am Fußende (M40x2.5, H6, L: 20mm, Offset -0.1mm)
  addLongArmThread(rootComp, armBody, params);

  // 3. Rohr aufbohren (von -60mm Richtung Ursprung für 27.5 mm mit 41mm Durchmesser)
  boreOutLongArm(rootComp, armBody, params);

  // 4. Zweites Loch vom Ursprung aufbohren (Länge: 32.50 mm, Durchmesser: 40.025 mm in -Z)
  boreOutFromOrigin(rootComp, armBody);

  return armBody;
}

/**
 * Fügt Bohrungen in die kurzen Arme ein.
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param armBody Der kombinierte Tetrapod-Körper.
 * @param holeDiameterParam Der Parameter für den Bohrungsdurchmesser.
 */
function addShortArmHoles(
  rootComp: adsk.fusion.Component,
  armBody: adsk.fusion.BRepBody,
  holeDiameterParam: adsk.fusion.UserParameter
): void {
  const sketches = rootComp.sketches;
  const features = rootComp.features;

  // 1. Stirnflächen aller 4 kurzen Arme selektieren
  const faces: adsk.fusion.BRepFace[] = [];
  const centerPoint = adsk.core.Point3D.create(0, 0, 0);

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

  // Wir erwarten 4 Stirnflächen für die 4 kurzen Arme
  faces.sort((a, b) => {
    const da = a.boundingBox.minPoint.distanceTo(centerPoint);
    const db = b.boundingBox.minPoint.distanceTo(centerPoint);
    return db - da;
  });

  // Alle 4 Stirnflächen nehmen
  const targetFaces = faces.slice(0, 4);

  for (const face of targetFaces) {
    // 2. Skizze auf der Stirnfläche erstellen
    const sketch = sketches.add(face);

    // 3. Zentrischen Kreis erstellen
    sketch.sketchCurves.sketchCircles.addByCenterRadius(
      adsk.core.Point3D.create(0, 0, 0),
      holeDiameterParam.value / 2.0
    );

    // 4. Extrudieren mit -40mm (Schnitt-Operation)
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

/**
 * Erstellt ein Innengewinde am Fussende des 8cm Arms.
 * M40x2.5, H6, rechts, Länge: 20mm, plus Toleranzweite -0.1mm.
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param armBody Der Arm-Körper.
 * @param params Die Benutzerparameter.
 */
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

      // Radius-Check (ca. 2.0 cm bei 40mm Durchmesser)
      if (Math.abs(cyl.radius - targetRadius) < 0.1) {
        const bbox = face.boundingBox;
        const centerX = (bbox.minPoint.x + bbox.maxPoint.x) / 2.0;
        const centerY = (bbox.minPoint.y + bbox.maxPoint.y) / 2.0;

        // Positions-Check (zentrisch zur Z-Achse und tief in -Z)
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
  const threadType = "ISO Metric Profile";
  const designator = "M40x2.5";
  const threadClass = "6H";

  const threadInfo = threadFeatures.createThreadInfo(true, threadType, designator, threadClass);

  // 3. Thread-Feature erstellen
  const threadInput = threadFeatures.createInput(targetFace, threadInfo);
  threadInput.isFullLength = false;
  threadInput.isModeled = true; // Modelliert für die physische Toleranzanpassung

  // Terminales Gewinde direkt am äußeren Armende (Z = -80mm bis -60mm)
  const threadLengthCm = 2.0; // 20mm
  threadInput.threadOffset = adsk.core.ValueInput.createByReal(0.0);
  threadInput.threadLength = adsk.core.ValueInput.createByReal(threadLengthCm);

  const threadFeature = threadFeatures.add(threadInput);
  if (!threadFeature) {
    if (ui) ui.messageBox("Fehler beim Erstellen des Gewinde-Features.");
    return;
  }

  // 4. Gewinde weiten (Toleranzberücksichtigung durch Drücken/Ziehen)
  const facesToOffset: adsk.fusion.BRepFace[] = [];
  for (let i = 0; i < threadFeature.faces.count; i++) {
    const f = threadFeature.faces.item(i);
    if (f) {
      facesToOffset.push(f);
    }
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

/**
 * Bohrt das restliche Rohr des langen Arms vom Gewinde bis zum Ursprung auf.
 * Ziel: 41mm Durchmesser, Tiefe 27.5mm ab 60mm vom Zentrum.
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param armBody Der Arm-Körper.
 * @param params Die Benutzerparameter.
 */
function boreOutLongArm(
  rootComp: adsk.fusion.Component,
  armBody: adsk.fusion.BRepBody,
  _params: ReturnType<typeof setupParameters>
): void {
  const constructionPlanes = rootComp.constructionPlanes;
  const planeInput = constructionPlanes.createInput();

  // Ebene orthogonal zur Z-Achse bei -60mm (6.0 cm)
  const offsetValue = adsk.core.ValueInput.createByReal(-6.0);
  planeInput.setByOffset(rootComp.xYConstructionPlane, offsetValue);
  const offsetPlane = constructionPlanes.add(planeInput);

  const sketches = rootComp.sketches;
  const sketch = sketches.add(offsetPlane);

  // Kreis mit 41mm Durchmesser (Radius 2.05 cm)
  const diameterCm = 4.1;
  sketch.sketchCurves.sketchCircles.addByCenterRadius(
    adsk.core.Point3D.create(0, 0, 0),
    diameterCm / 2.0
  );

  if (sketch.profiles.count === 0) return;
  const profile = sketch.profiles.item(0);

  // Extrusion (Cut) 27.5mm nach innen (Richtung Ursprung)
  const extrudeFeatures = rootComp.features.extrudeFeatures;
  const extInput = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation);
  extInput.participantBodies = [armBody];
  extInput.setDistanceExtent(false, adsk.core.ValueInput.createByReal(2.75));

  extrudeFeatures.add(extInput);
}

/**
 * Bohrt das zweite Loch vom Ursprung in Richtung der Z-Achse auf.
 * Ziel: 40.025mm Durchmesser, Länge 32.50mm in Richtung der Z-Achse (in das Rohr).
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param armBody Der Arm-Körper.
 */
function boreOutFromOrigin(
  rootComp: adsk.fusion.Component,
  armBody: adsk.fusion.BRepBody
): void {
  const sketches = rootComp.sketches;
  const sketch = sketches.add(rootComp.xYConstructionPlane);

  // Kreis mit 40.025mm Durchmesser (Radius: 2.0025 cm)
  const diameterCm = 4.005;
  sketch.sketchCurves.sketchCircles.addByCenterRadius(
    adsk.core.Point3D.create(0, 0, 0),
    diameterCm / 2.0
  );

  if (sketch.profiles.count === 0) return;
  const profile = sketch.profiles.item(0);

  // Extrusion (Cut) 32.50mm entlang der Z-Achse in das Rohr (-Z Richtung)
  const extrudeFeatures = rootComp.features.extrudeFeatures;
  const extInput = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation);
  extInput.participantBodies = [armBody];
  extInput.setDistanceExtent(false, adsk.core.ValueInput.createByReal(-3.25));

  extrudeFeatures.add(extInput);
}

/**
 * Positioniert den 2. Tetrapod (Node 2) gemäß folgenden mathematischen Anforderungen:
 * 1. Zentrum liegt in der xz-Ebene (y = 0).
 * 2. 2 Arme (bzw. deren Mittelachsen) des neuen Tetrapods liegen in der xz-Ebene.
 * 3. Die Mittelachse eines Arms des neuen Tetrapods ist eine Verlängerung der Mittelachse eines Arms des alten.
 * 4. Der Abstand der beiden Zentren (Schwerpunkte) beträgt 8 cm (8.0 cm = 80 mm).
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param node2 Der BRepBody des 2. Tetrapods.
 */
function positionSecondTetrapod(
  rootComp: adsk.fusion.Component,
  node2: adsk.fusion.BRepBody
): adsk.core.Point3D {
  // Tetraedrischer Bindungswinkel theta = arccos(-1/3) ≈ 109.47122°
  const tetraAngle = Math.acos(-1.0 / 3.0); // Radian

  // Einheitsvektor des kurzen Arms (Arm 1) im xz-Raum von Tetrapod 1:
  // Arm 1 in createTetrapod liegt nach Rotation um Y-Achse in der xz-Ebene (Y=0)
  // v1 = (-sin(tetraAngle), 0, -cos(tetraAngle)) = (-2*sqrt(2)/3, 0, 1/3)
  const dirX = -Math.sin(tetraAngle); // -2 * sqrt(2) / 3 ≈ -0.942809
  const dirY = 0.0;
  const dirZ = -Math.cos(tetraAngle); // 1 / 3 ≈ 0.333333

  // 4. Abstand der beiden Zentren: 8 cm
  const distanceCm = 8.0;

  // 1. Zentrum des 2. Tetrapods liegt in der xz-Ebene (y = 0)
  const center2 = adsk.core.Point3D.create(
    distanceCm * dirX,
    dirY,
    distanceCm * dirZ
  );

  // 2. & 3. Ausrichtung & Transformationsmatrix:
  // 180° Rotation um die Y-Achse ausführen, damit ein Arm von Node 2 entlang der Achsverlängerung (Richtung Node 1) zeigt.
  // Dadurch liegen Arm 0 (entlang +Z) und Arm 1 (entlang -v1) von Node 2 beide in der xz-Ebene.
  const transformMatrix = adsk.core.Matrix3D.create();
  const xAxis = adsk.core.Vector3D.create(-1, 0, 0);
  const yAxis = adsk.core.Vector3D.create(0, 1, 0);
  const zAxis = adsk.core.Vector3D.create(0, 0, -1);
  transformMatrix.setWithCoordinateSystem(center2, xAxis, yAxis, zAxis);

  // Verschiebung des Körpers in Fusion 360 ausführen
  const moveFeatures = rootComp.features.moveFeatures;
  const moveCollection = adsk.core.ObjectCollection.create();
  moveCollection.add(node2);

  const moveInput = moveFeatures.createInput2(moveCollection);
  moveInput.defineAsFreeMove(transformMatrix);
  moveFeatures.add(moveInput);

  return center2;
}

/**
 * Positioniert den 3. Tetrapod (Node 3) gemäß folgenden mathematischen Anforderungen:
 * 1. Zentrum liegt in der xz-Ebene (y = 0).
 * 2. 2 Arme des neuen Tetrapods liegen in der xz-Ebene.
 * 3. Die Mittelachse eines Arms von Node 3 ist eine Verlängerung der Mittelachse von Arm 0 des 2. Tetrapods.
 * 4. Der Abstand des Zentrums von Node 3 zum Zentrum von Node 2 beträgt 8 cm (8.0 cm = 80 mm).
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param node3 Der BRepBody des 3. Tetrapods.
 * @param center2 Das Zentrum des 2. Tetrapods.
 * @returns Das Zentrum (Point3D) von Node 3.
 */
function positionThirdTetrapod(
  rootComp: adsk.fusion.Component,
  node3: adsk.fusion.BRepBody,
  center2: adsk.core.Point3D
): adsk.core.Point3D {
  // Arm 0 von Node 2 zeigt entlang der +Z-Achse (0, 0, 1).
  // Zentrum von Node 3 liegt 8 cm entlang der +Z-Achse von Node 2:
  const distanceCm = 8.0;
  const center3 = adsk.core.Point3D.create(
    center2.x,
    0,
    center2.z + distanceCm
  );

  // Transformationsmatrix für Node 3:
  // Reine Translation nach center3. Dadurch zeigt Arm 0 von Node 3 entlang (0, 0, -1) zurück zu Node 2,
  // und Arm 1 von Node 3 zeigt in der xz-Ebene (-sin(theta), 0, -cos(theta)).
  const transformMatrix = adsk.core.Matrix3D.create();
  transformMatrix.translation = adsk.core.Vector3D.create(center3.x, center3.y, center3.z);

  const moveFeatures = rootComp.features.moveFeatures;
  const moveCollection = adsk.core.ObjectCollection.create();
  moveCollection.add(node3);

  const moveInput = moveFeatures.createInput2(moveCollection);
  moveInput.defineAsFreeMove(transformMatrix);
  moveFeatures.add(moveInput);

  return center3;
}

/**
 * Erzeugt einen Röhren-Körper im Ursprung (0,0,0) auf der XY-Ebene.
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param params Die Benutzerparameter.
 * @param lengthCm Die Länge der Röhre in cm (z.B. 8.0 für 80mm).
 * @param negativeDirection Wenn true, wird in negative Z-Richtung extrudiert, sonst in positive Z-Richtung.
 * @returns Der erzeugte Röhren-BRepBody.
 */
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

  // Kreise für Außen- (46mm) und Innendurchmesser (31.5mm) zeichnen
  sketch.sketchCurves.sketchCircles.addByCenterRadius(center, params.armOuterDiameter.value / 2.0);
  sketch.sketchCurves.sketchCircles.addByCenterRadius(center, params.holeDiameter.value / 2.0);

  let ringProfile: adsk.fusion.Profile | null = null;

  for (let i = 0; i < sketch.profiles.count; i++) {
    const prof = sketch.profiles.item(i);
    if (prof.profileLoops.count === 2) {
      ringProfile = prof;
      break;
    }
  }

  if (!ringProfile) {
    const holeArea = Math.PI * Math.pow(params.holeDiameter.value / 2.0, 2);
    for (let i = 0; i < sketch.profiles.count; i++) {
      const prof = sketch.profiles.item(i);
      if (Math.abs(prof.areaProperties().area - holeArea) > 0.1) {
        ringProfile = prof;
        break;
      }
    }
  }

  if (!ringProfile) {
    ringProfile = sketch.profiles.item(0);
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

/**
 * Erzeugt die Verbindungsröhre zwischen Node 1 und Node 2:
 * Länge 45 mm (4.5 cm), in der Mitte der beiden Arme platziert (von 1.75 cm bis 6.25 cm vom Zentrum).
 */
function createConnectionTube1To2(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>,
  node1: adsk.fusion.BRepBody,
  node2: adsk.fusion.BRepBody
): void {
  // 1. Röhre der Länge 4.5 cm (45mm) im Ursprung in -Z Richtung erzeugen
  const tubeLengthCm = 4.5;
  const tubeBody = createTubeBody(rootComp, params, tubeLengthCm, true);

  const tetraAngle = Math.acos(-1.0 / 3.0);
  const dirX = -Math.sin(tetraAngle); // -2*sqrt(2)/3
  const dirY = 0.0;
  const dirZ = -Math.cos(tetraAngle); // 1/3

  // Versatz, damit die 4.5 cm lange Röhre mittig liegt (von 1.75 cm bis 6.25 cm entlang der 8 cm Achse)
  const offsetCm = 1.75;
  const shiftVec = adsk.core.Vector3D.create(offsetCm * dirX, dirY, offsetCm * dirZ);

  // 2. Röhre rotieren (109.47° um Y-Achse) und um offsetCm entlang der Achse verschieben
  const transformMatrix = adsk.core.Matrix3D.create();
  transformMatrix.setToRotation(tetraAngle, adsk.core.Vector3D.create(0, 1, 0), adsk.core.Point3D.create(0, 0, 0));
  const transMatrix = adsk.core.Matrix3D.create();
  transMatrix.translation = shiftVec;
  transformMatrix.transformBy(transMatrix);

  const moveFeats = rootComp.features.moveFeatures;
  const moveColl = adsk.core.ObjectCollection.create();
  moveColl.add(tubeBody);
  const moveInput = moveFeats.createInput2(moveColl);
  moveInput.defineAsFreeMove(transformMatrix);
  moveFeats.add(moveInput);

  // 3. Röhre mit Node 1 und Node 2 verschmelzen (Combine Join)
  const combineFeatures = rootComp.features.combineFeatures;
  const toolColl = adsk.core.ObjectCollection.create();
  toolColl.add(tubeBody);
  toolColl.add(node2);
  const combineInput = combineFeatures.createInput(node1, toolColl);
  combineInput.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation;
  combineFeatures.add(combineInput);
}

/**
 * Erzeugt die Verbindungsröhre zwischen Node 2 und Node 3:
 * Länge 45 mm (4.5 cm), in der Mitte der beiden Arme platziert (von 1.75 cm bis 6.25 cm von C2).
 */
function createConnectionTube2To3(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>,
  node1: adsk.fusion.BRepBody,
  node3: adsk.fusion.BRepBody,
  center2: adsk.core.Point3D
): void {
  // 1. Röhre der Länge 4.5 cm (45mm) im Ursprung in +Z Richtung erzeugen
  const tubeLengthCm = 4.5;
  const tubeBody = createTubeBody(rootComp, params, tubeLengthCm, false);

  // 2. Röhre zum Mittelbereich (C2 + 1.75 cm entlang +Z) verschieben
  const offsetCm = 1.75;
  const transformMatrix = adsk.core.Matrix3D.create();
  transformMatrix.translation = adsk.core.Vector3D.create(
    center2.x,
    0,
    center2.z + offsetCm
  );

  const moveFeats = rootComp.features.moveFeatures;
  const moveColl = adsk.core.ObjectCollection.create();
  moveColl.add(tubeBody);
  const moveInput = moveFeats.createInput2(moveColl);
  moveInput.defineAsFreeMove(transformMatrix);
  moveFeats.add(moveInput);

  // 3. Röhre und Node 3 mit dem Gesamt-Körper (node1) verschmelzen
  const combineFeatures = rootComp.features.combineFeatures;
  const toolColl = adsk.core.ObjectCollection.create();
  toolColl.add(tubeBody);
  toolColl.add(node3);
  const combineInput = combineFeatures.createInput(node1, toolColl);
  combineInput.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation;
  combineFeatures.add(combineInput);
}

/**
 * Erzeugt das vertikale Bein von Node 1 (entlang der Z-Achse nach unten, zeigt direkt auf das Zentrum von Node 1).
 */
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
  sketch.sketchCurves.sketchCircles.addByCenterRadius(center, params.holeDiameter.value / 2.0);

  let ringProfile: adsk.fusion.Profile | null = null;
  for (let i = 0; i < sketch.profiles.count; i++) {
    const prof = sketch.profiles.item(i);
    if (prof.profileLoops.count === 2) {
      ringProfile = prof;
      break;
    }
  }

  if (!ringProfile) {
    const holeArea = Math.PI * Math.pow(params.holeDiameter.value / 2.0, 2);
    for (let i = 0; i < sketch.profiles.count; i++) {
      const prof = sketch.profiles.item(i);
      if (Math.abs(prof.areaProperties().area - holeArea) > 0.1) {
        ringProfile = prof;
        break;
      }
    }
  }

  if (!ringProfile) {
    ringProfile = sketch.profiles.item(0);
  }

  // Bein-Länge + Plattenhöhe extrudieren
  const totalLegLen = params.legLength.value + params.basePlateHeight.value + 2.0;
  const extInput = extrudeFeatures.createInput(ringProfile, adsk.fusion.FeatureOperations.NewBodyFeatureOperation);
  extInput.setDistanceExtent(false, adsk.core.ValueInput.createByReal(-totalLegLen));
  return extrudeFeatures.add(extInput).bodies.item(0);
}

/**
 * Erzeugt die im Tetraederwinkel geneigte Basis-Platte (Fuß) für Node 1.
 * Das Bein verläuft vertikal entlang der Z-Achse und zeigt direkt auf das Zentrum von Node 1 (0,0,0).
 * Der Kabelkanal verläuft 100% parallel zur geneigten Basis-Platte bis zur Fußarm-Mitte (X = 0).
 */
function createTiltedBasePlateFoot(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>,
  node1: adsk.fusion.BRepBody
): adsk.fusion.BRepBody {
  const constructionPlanes = rootComp.constructionPlanes;
  const sketches = rootComp.sketches;
  const features = rootComp.features;

  const legLenCm = params.legLength.value; // 10.0 cm
  const offsetCm = params.legOffset.value; // 4.5 cm
  const plateHeightCm = params.basePlateHeight.value; // 1.0 cm
  const plateTopZ = -legLenCm; // -10.0 cm
  const plateBottomZ = plateTopZ - plateHeightCm; // -11.0 cm

  // 1. Skizze & Extrusion für die Basis-Platte (160mm) bei plateTopZ
  const planeInput1 = constructionPlanes.createInput();
  planeInput1.setByOffset(rootComp.xYConstructionPlane, adsk.core.ValueInput.createByReal(plateTopZ));
  const topPlane = constructionPlanes.add(planeInput1);

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

  // 2. Skizze & Extrusion für das Unterseiten-Schneidwerkzeug (Trim-Tool, 320mm) bei plateBottomZ
  const planeInput2 = constructionPlanes.createInput();
  planeInput2.setByOffset(rootComp.xYConstructionPlane, adsk.core.ValueInput.createByReal(plateBottomZ));
  const bottomPlane = constructionPlanes.add(planeInput2);

  const sketch2 = sketches.add(bottomPlane);
  const centerPoint2 = sketch2.modelToSketchSpace(adsk.core.Point3D.create(-offsetCm, 0, plateBottomZ));
  sketch2.sketchCurves.sketchCircles.addByCenterRadius(centerPoint2, params.basePlateDiameter.value);

  let trimToolBody: adsk.fusion.BRepBody | null = null;
  if (sketch2.profiles.count > 0) {
    const extInput2 = features.extrudeFeatures.createInput(
      sketch2.profiles.item(0),
      adsk.fusion.FeatureOperations.NewBodyFeatureOperation
    );
    extInput2.setDistanceExtent(false, adsk.core.ValueInput.createByReal(-5.0)); // 5cm nach unten
    const trimFeat = features.extrudeFeatures.add(extInput2);
    if (trimFeat && trimFeat.bodies.count > 0) {
      trimToolBody = trimFeat.bodies.item(0);
    }
  }

  // 3. Skizze & Extrusion für das Kabelkanal-Werkzeug (Cable-Tool, 6mm)
  // Das Werkzeug verläuft von außerhalb des Plattenrands durch die Fußplatte nach innen bis in das Bein-Innere (X = -0.5 cm)
  let cableToolBody: adsk.fusion.BRepBody | null = null;
  const plateRadiusCm = params.basePlateDiameter.value / 2.0; // 8.0 cm
  // Position der Konstruktionsebene außerhalb des Plattenrands wählen (Plattenrand liegt bei -offsetCm + plateRadiusCm)
  const cableOffsetVal = Math.max(
    -offsetCm + params.cableHoleOffset.value,
    -offsetCm + plateRadiusCm + 1.0
  );
  const cablePlaneInput = constructionPlanes.createInput();
  cablePlaneInput.setByOffset(rootComp.yZConstructionPlane, adsk.core.ValueInput.createByReal(cableOffsetVal));
  const cablePlane = constructionPlanes.add(cablePlaneInput);

  const cableSketch = sketches.add(cablePlane);
  const holeRadius = params.cableHoleDiameter.value / 2.0; // 0.3 cm
  const holeH = params.cableHoleHeight.value; // 0.45 cm
  const holeZ = plateBottomZ + holeH;
  const cableCenterPoint = cableSketch.modelToSketchSpace(adsk.core.Point3D.create(cableOffsetVal, 0, holeZ));
  cableSketch.sketchCurves.sketchCircles.addByCenterRadius(cableCenterPoint, holeRadius);

  if (cableSketch.profiles.count > 0) {
    const cableExtInput = features.extrudeFeatures.createInput(
      cableSketch.profiles.item(0),
      adsk.fusion.FeatureOperations.NewBodyFeatureOperation
    );
    const cutDistanceCm = -(cableOffsetVal + 0.5); // von cableOffsetVal durch die Plattenaußenwand nach innen bis X = -0.5 cm
    cableExtInput.setDistanceExtent(false, adsk.core.ValueInput.createByReal(cutDistanceCm));
    const cableFeat = features.extrudeFeatures.add(cableExtInput);
    if (cableFeat && cableFeat.bodies.count > 0) {
      cableToolBody = cableFeat.bodies.item(0);
    }
  }

  // 4. Alle Werkzeug- und Plattenkörper zusammen um rotAngleRad drehen
  // Dadurch ist der Kabelkanal 100% exakt parallel zur geneigten Basis-Platte!
  const rotAngleRad = params.legAngle.value - Math.PI / 2.0;
  const transformMatrix = adsk.core.Matrix3D.create();
  transformMatrix.setToRotation(
    rotAngleRad,
    adsk.core.Vector3D.create(0, 1, 0),
    adsk.core.Point3D.create(0, 0, plateTopZ)
  );

  const moveFeats = features.moveFeatures;
  const moveColl = adsk.core.ObjectCollection.create();
  moveColl.add(plateBody);
  if (trimToolBody) moveColl.add(trimToolBody);
  if (cableToolBody) moveColl.add(cableToolBody);

  const moveInput = moveFeats.createInput2(moveColl);
  moveInput.defineAsFreeMove(transformMatrix);
  moveFeats.add(moveInput);


  // 6. Basis-Platte mit Node 1 verschmelzen (Join)
  const joinTools = adsk.core.ObjectCollection.create();
  joinTools.add(plateBody);
  features.combineFeatures.add(features.combineFeatures.createInput(node1, joinTools));

  // 7. Kabelkanal durch Schneiden des mitgedrehten Cable-Tools erzeugen (Cut)
  if (cableToolBody) {
    const cableTools = adsk.core.ObjectCollection.create();
    cableTools.add(cableToolBody);
    const cableCutInput = features.combineFeatures.createInput(node1, cableTools);
    cableCutInput.operation = adsk.fusion.FeatureOperations.CutFeatureOperation;
    try {
      features.combineFeatures.add(cableCutInput);
    } catch (_e) {
      // Fallback
    }
  }

  // 8. Geometrie unterhalb der geneigten Platten-Unterseite bündig abschneiden (Cut)
  if (trimToolBody) {
    const cutTools = adsk.core.ObjectCollection.create();
    cutTools.add(trimToolBody);
    const cutInput = features.combineFeatures.createInput(node1, cutTools);
    cutInput.operation = adsk.fusion.FeatureOperations.CutFeatureOperation;
    try {
      features.combineFeatures.add(cutInput);
    } catch (_e) {
      // Fallback
    }
  }

  // 9. Verrundung der Verschneidungskante zwischen Z-Bein und geneigter Basis-Platte (4mm)
  filletLegPlateJunction(rootComp, node1, plateTopZ, params.armOuterDiameter.value / 2.0, params);

  // 10. 31.5mm Innenbohrung durchgehend durch die Basis-Platte freischneiden
  boreVerticalLegHole(rootComp, params, node1);

  return node1;
}

/**
 * Schneidet die 31.5mm Innenbohrung des Z-Beins durchgehend durch die Basis-Platte frei.
 */
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
  sketch.sketchCurves.sketchCircles.addByCenterRadius(center, params.holeDiameter.value / 2.0);

  if (sketch.profiles.count === 0) return;
  const profile = sketch.profiles.item(0);

  const cutInput = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation);
  cutInput.participantBodies = [node1];
  cutInput.setDistanceExtent(false, adsk.core.ValueInput.createByReal(-15.0));
  try {
    extrudeFeatures.add(cutInput);
  } catch (_e) {
    // Fallback
  }
}

/**
 * Verrundet die obere Kante der Kreisfläche des Standfusses (2mm).
 * Wird als Schritt 9 zeitlich ganz am Ende am fertigen Gesamtkörper (Node 1) ausgeführt.
 */
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
    const filletFeatures = rootComp.features.filletFeatures;
    const filletInput = filletFeatures.createInput();
    const edgeColl = adsk.core.ObjectCollection.create();
    edgeColl.add(topEdge);

    let valInput = adsk.core.ValueInput.createByString('base_plate_rounding');
    if (!valInput) {
      valInput = adsk.core.ValueInput.createByReal(params.basePlateRounding.value);
    }

    filletInput.edgeSetInputs.addConstantRadiusEdgeSet(
      edgeColl,
      valInput,
      false
    );

    try {
      filletFeatures.add(filletInput);
      console.log('Obere Kante der Basis-Platte (2mm) in Step 9 erfolgreich verrundet.');
    } catch (e) {
      console.warn(`Fehler beim Verrunden der oberen Basis-Platten-Kante in Step 9: ${e}`);
      try {
        const fallbackInput = filletFeatures.createInput();
        const fallbackColl = adsk.core.ObjectCollection.create();
        fallbackColl.add(topEdge);
        fallbackInput.edgeSetInputs.addConstantRadiusEdgeSet(
          fallbackColl,
          adsk.core.ValueInput.createByReal(params.basePlateRounding.value),
          false
        );
        filletFeatures.add(fallbackInput);
      } catch (err2) {
        console.warn(`Fallback-Verrundung Step 9 ebenfalls fehlgeschlagen: ${err2}`);
      }
    }
  } else {
    console.warn('Keine obere Kante der Basis-Platte für Step 9 gefunden.');
  }
}

/**
 * Verrundet die Verschneidungskante zwischen Bein-Außenwand und Basis-Platte (4mm).
 */
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
    const filletInput = rootComp.features.filletFeatures.createInput();
    const edgeColl = adsk.core.ObjectCollection.create();
    for (const e of edges) {
      edgeColl.add(e);
    }
    filletInput.edgeSetInputs.addConstantRadiusEdgeSet(
      edgeColl,
      adsk.core.ValueInput.createByString('leg_plate_rounding'),
      false
    );
    try {
      rootComp.features.filletFeatures.add(filletInput);
    } catch (_e) {
      // Fallback
    }
  }
}

/**
 * Bringt eine Abfasung (0.7mm) an beiden Öffnungskanten des Kabelkanals (Eintritt & Austritt) an.
 * Wird am Ende des Gesamtprozesses aufgerufen, damit nachfolgende Features die Fase nicht aufheben.
 */
function chamferCableHoleOpenings(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>,
  body: adsk.fusion.BRepBody
): void {
  const chamferVal = params.cableHoleChamfer.value; // 0.07 cm = 0.7mm
  if (chamferVal <= 0) return;

  const targetRadius = params.cableHoleDiameter.value / 2.0; // 0.3 cm = 3mm
  const chamferEdges: adsk.fusion.BRepEdge[] = [];

  // Kanten suchen, die zu einer Zylinderfläche des Kabelkanals (Radius 3mm) gehören
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
    const edgeColl = adsk.core.ObjectCollection.create();
    for (const edge of chamferEdges) {
      edgeColl.add(edge);
    }

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
      // Fallback mit direktem Zahlenwert
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

/**
 * Schneidet Geometrieüberstände unterhalb der Unterseite der Basis-Platte plan ab, falls solche vorhanden sind.
 */
function trimBottomFlushAtZ(
  rootComp: adsk.fusion.Component,
  body: adsk.fusion.BRepBody,
  plateBottomZ: number,
  baseDiameterCm: number
): void {
  // Nur schneiden, wenn der Körper tatsächlich unter plateBottomZ herausragt!
  if (body.boundingBox.minPoint.z >= plateBottomZ - 0.05) {
    return; // Unterseite ist bereits plan/bündig
  }

  const planeInput = rootComp.constructionPlanes.createInput();
  planeInput.setByOffset(rootComp.xYConstructionPlane, adsk.core.ValueInput.createByReal(plateBottomZ));
  const bottomPlane = rootComp.constructionPlanes.add(planeInput);

  const sketch = rootComp.sketches.add(bottomPlane);
  const center = adsk.core.Point3D.create(0, 0, 0);
  sketch.sketchCurves.sketchCircles.addByCenterRadius(center, baseDiameterCm);

  if (sketch.profiles.count === 0) return;
  const profile = sketch.profiles.item(0);

  const extrudeFeatures = rootComp.features.extrudeFeatures;
  const cutInput = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation);
  cutInput.participantBodies = [body];
  cutInput.setDistanceExtent(false, adsk.core.ValueInput.createByReal(-5.0)); // 5cm nach unten schneiden
  try {
    extrudeFeatures.add(cutInput);
  } catch (_e) {
    // Falls kein Material geschnitten werden muss
  }
}

/**
 * Prüft, ob eine Kante die Außen-Schnittkante zweier Zylinderarme ist (Länge ca. 51.5mm = 5.15cm).
 */
function isOuterTetrapodIntersectionEdgeByLength(
  edge: adsk.fusion.BRepEdge
): boolean {
  const lenCm = edge.length; // 3D-Bogenlänge in cm
  const expectedLenCm = 5.15; // 51.5mm
  return Math.abs(lenCm - expectedLenCm) < 0.6; // 45.5mm bis 57.5mm
}

/**
 * Rundet die 18 Außen-Schnittkanten aller 3 Tetrapoden-Knoten am fertigen Gesamtkörper in Step 10 ab:
 * - Radius: 40.0mm (nodeFilletRadius)
 * - Kontinuitätstyp: Tangential (G1)
 * - Radiustyp: Konstante (Constant radius fillet)
 * - Tangentenkette: ja (isTangentChain: true)
 * - Ecktyp: Versatz (Setback corner: isRollingBallCorner = false)
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param targetBody Der fertige Gesamtkörper.
 * @param params Die Benutzerparameter.
 * @param center2 Das Zentrum von Node 2.
 * @param center3 Das Zentrum von Node 3.
 */
function applyNodeFilletsAtEnd(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody,
  params: ReturnType<typeof setupParameters>,
  center2: adsk.core.Point3D,
  center3: adsk.core.Point3D
): void {
  const centers = [
    adsk.core.Point3D.create(0, 0, 0),
    center2,
    center3
  ];

  const selectedEdges: adsk.fusion.BRepEdge[] = [];

  for (let nodeIdx = 0; nodeIdx < centers.length; nodeIdx++) {
    const center = centers[nodeIdx];
    const nodeEdges: { edge: adsk.fusion.BRepEdge; dist: number; lenMm: number }[] = [];

    for (let i = 0; i < targetBody.edges.count; i++) {
      const edge = targetBody.edges.item(i);
      if (!edge) continue;

      const midPoint = edge.pointOnEdge;
      if (!midPoint) continue;

      const dist = midPoint.distanceTo(center);
      if (dist < 4.5) {
        if (isOuterTetrapodIntersectionEdgeByLength(edge)) {
          nodeEdges.push({
            edge,
            dist,
            lenMm: Math.round(edge.length * 100) / 10
          });
        }
      }
    }

    nodeEdges.sort((a, b) => a.dist - b.dist);
    const closest6 = nodeEdges.slice(0, 6);

    for (const item of closest6) {
      if (!selectedEdges.includes(item.edge)) {
        selectedEdges.push(item.edge);
        console.log(`Node ${nodeIdx + 1}: Kante mit Länge ${item.lenMm}mm gefunden.`);
      }
    }
  }

  // Fallback: Falls noch nicht 18 Kanten gefunden wurden, alle Kanten im Gesamtkörper nach Längetoleranz ~51.5mm absuchen
  if (selectedEdges.length < 18) {
    for (let i = 0; i < targetBody.edges.count; i++) {
      const edge = targetBody.edges.item(i);
      if (!edge) continue;
      if (isOuterTetrapodIntersectionEdgeByLength(edge) && !selectedEdges.includes(edge)) {
        selectedEdges.push(edge);
        if (selectedEdges.length === 18) break;
      }
    }
  }

  console.log(`Gefundene Knoten-Schnittkanten für Abrundung (Step 10): ${selectedEdges.length} von 18`);

  if (selectedEdges.length === 0) {
    console.warn('Keine Knoten-Schnittkanten für Abrundung gefunden.');
    return;
  }

  // Abrundung (40mm, Tangential G1, Konstante, Ecktyp: Versatz) ausführen
  const filletFeatures = rootComp.features.filletFeatures;
  const filletInput = filletFeatures.createInput();
  if (!filletInput) return;

  filletInput.isRollingBallCorner = false; // Ecktyp: Versatz (Setback corner)

  const edgeCollection = adsk.core.ObjectCollection.create();
  for (const edge of selectedEdges) {
    edgeCollection.add(edge);
  }

  // Radiustyp: Konstante (40mm / nodeFilletRadius)
  let valInput = adsk.core.ValueInput.createByString('node_fillet_radius');
  if (!valInput) {
    valInput = adsk.core.ValueInput.createByReal(params.nodeFilletRadius.value);
  }

  const constantEdgeSet = filletInput.edgeSetInputs.addConstantRadiusEdgeSet(
    edgeCollection,
    valInput,
    true
  );
  if (!constantEdgeSet) return;

  // Kontinuitätstyp: Tangential (G1)
  constantEdgeSet.continuity = adsk.fusion.SurfaceContinuityTypes.TangentSurfaceContinuityType;

  try {
    const feat = filletFeatures.add(filletInput);
    if (feat) {
      console.log(`Step 10: Abrundung (${selectedEdges.length} Kanten, 40mm, Tangential G1, Konstante, Versatz) erfolgreich angewendet.`);
    }
  } catch (e) {
    console.warn(`Fehler bei Knotenabrundung mit Parameter: ${e}`);
    // Fallback mit direktem ValueInput (4.0 cm = 40mm)
    try {
      const fallbackInput = filletFeatures.createInput();
      fallbackInput.isRollingBallCorner = false;
      const fallbackEdgeSet = fallbackInput.edgeSetInputs.addConstantRadiusEdgeSet(
        edgeCollection,
        adsk.core.ValueInput.createByReal(params.nodeFilletRadius.value),
        true
      );
      if (fallbackEdgeSet) {
        fallbackEdgeSet.continuity = adsk.fusion.SurfaceContinuityTypes.TangentSurfaceContinuityType;
      }
      filletFeatures.add(fallbackInput);
      console.log('Step 10: Fallback-Knotenabrundung mit 40mm erfolgreich angewendet.');
    } catch (err2) {
      console.warn(`Step 10: Fallback mit 40mm fehlgeschlagen: ${err2}`);
      if (ui) {
        ui.messageBox(`Fehler bei Knotenabrundung in Step 10:\n${err2}`);
      }
    }
  }
}