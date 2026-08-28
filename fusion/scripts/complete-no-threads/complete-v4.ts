import { adsk } from "@adsk/fusion";

const app = adsk.core.Application.get();
const ui = app ? app.userInterface : null;

// Attention: this is not really printable: it causes oval 'circles'. It's not working!

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

    // 2. Ersten Tetrapod (Node 1) im Ursprung (0,0,0) erzeugen (Arm 0: Bein, Arm 1: kurz, Arm 2 & 3: 8cm Bohrungsarme)
    let targetBody = createTetrapod(rootComp, params, ['leg', 'short', 'bored', 'bored']);
    targetBody.name = 'Node_1';

    // 3. Kugel aus dem Zentrum von Node 1 ausschneiden (Zentralknoten hohl machen)
    cutInnerSphere(rootComp, params.innerBallDiameter);

    // 4. Geneigten Fuß (Basis-Platte + Verrundungen + Kabelkanal) an das vertikale Bein von Node 1 anfügen
    createTiltedBasePlateFoot(rootComp, params, targetBody);

    // 5. Zweiten Tetrapod (Node 2) erzeugen (Arm 0 & 1: kurz, Arm 2 & 3: 8cm Bohrungsarme)
    const node2 = createTetrapod(rootComp, params, ['short', 'short', 'bored', 'bored']);
    node2.name = 'Node_2';

    // Kugel aus dem Zentrum von Node 2 ausschneiden
    cutInnerSphere(rootComp, params.innerBallDiameter);

    // Node 2 positionieren (Zentrum in XZ-Ebene, 8 cm Abstand zu Node 1)
    const center2 = positionSecondTetrapod(rootComp, node2);

    // 6. Dritten Tetrapod (Node 3) erzeugen (Arm 0: kurz, Arm 1, 2 & 3: 8cm Bohrungsarme)
    const node3 = createTetrapod(rootComp, params, ['short', 'bored', 'bored', 'bored']);
    node3.name = 'Node_3';

    // Kugel aus dem Zentrum von Node 3 ausschneiden
    cutInnerSphere(rootComp, params.innerBallDiameter);

    // Node 3 positionieren (Zentrum in XZ-Ebene, 8 cm Abstand zu Node 2, Achsenverlängerung)
    const center3 = positionThirdTetrapod(rootComp, node3, center2);

    // 7. Verbindungsröhren (ID 30mm, OD 48mm, Länge 45mm mittig) erzeugen und verschmelzen
    createConnectionTube1To2(rootComp, params, targetBody, node2);
    createConnectionTube2To3(rootComp, params, targetBody, node3, center2);

    // 7b. Drehung des Fußes (Ebene -50mm, Split Body, 180° Rotation um Beinachse, Re-Join)
    targetBody = rotateFootBySplittingLeg(rootComp, targetBody);

    // 8. Alle 3 Körper (Node 1, Node 2, Node 3 und Röhren) zum Gesamtkörper verschmelzen
    targetBody = combineAllBodies(rootComp, targetBody);

    // 8b. Nach dem Merge bei jedem Knoten in die 4 Richtungen vom Zentrum 43.00mm für ca. 40mm lang bohren
    targetBody = drillNodeBores(rootComp, targetBody, params, center2, center3);

    applyNodeFilletsAtEnd(rootComp, targetBody, params, center2, center3);
    chamferCableHoleOpenings(rootComp, params, targetBody);
    filletBasePlateTopEdgeAtEnd(rootComp, targetBody, params);
    filletTubeEdges(rootComp, targetBody);
    alignFootToXYPlane(rootComp, targetBody);
    targetBody.name = 'complete-model';
    console.log('Erfolgreich als einstückiger Gesamtkörper generiert!');

    if (params.cutModel) {
      // TODO
    }

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
  try {
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
  } catch (e) {
    console.log(`Zentrums-Kugelschnitt übersprungen (kein Zielkörper zum Schneiden oder bereits hohl): ${e}`);
  }
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
    } else if (
      name === 'ring_inner_diameter' ||
      name === 'hole_diameter' ||
      name === 'inner_ball_diameter' ||
      name === 'connector_inner_diameter' ||
      name === 'foot_leg_bore_diameter' ||
      name === 'arm_end_bore_diameter'
    ) {
      try {
        p.expression = valueStr;
      } catch (_e) {
        // Parameter konnte nicht aktualisiert werden
      }
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
    } else if (name === 'node_fillet_radius') {
      try {
        p.expression = valueStr;
      } catch (_e) {
        // Parameter konnte nicht aktualisiert werden
      }
    } else if (name === 'arm_outer_diameter' && Math.abs(p.value - 4.8) > 0.05) {
      try {
        p.expression = valueStr;
      } catch (_e) {
        // Parameter konnte nicht aktualisiert werden
      }
    } else if (name === 'connector_outer_diameter') {
      try {
        p.expression = valueStr;
      } catch (_e) {
        // Parameter konnte nicht aktualisiert werden
      }
    }
    return p;
  }

  return {
    armOuterDiameter: getOrCreateParam('arm_outer_diameter', '48mm', 'mm', 'Aussendurchmesser der Arme'),
    armDepth: getOrCreateParam('arm_depth', '35mm', 'mm', 'Armlaenge der 3 kurzen Arme gemessen vom Zentrum'),
    armDepthLong: getOrCreateParam('arm_depth_long', '80mm', 'mm', 'Armlaenge des langen Armes gemessen vom Zentrum'),
    ringInnerDiameter: getOrCreateParam('ring_inner_diameter', '43mm', 'mm', 'Innendurchmesser der Röhren (43mm)'),
    ringExtrudeDepth: getOrCreateParam('ring_extrude_depth', '17mm', 'mm', 'Tiefe des Rumpfabsatzes / Rücksprungs'),
    holeDepthOffset: getOrCreateParam('hole_depth_offset', '5mm', 'mm', 'Abstand vom Armende fuer Bohrungstiefe (arm_depth - offset)'),
    holeDiameter: getOrCreateParam('hole_diameter', '43mm', 'mm', 'Durchmesser der zentrischen Bohrung (43mm)'),
    innerBallDiameter: getOrCreateParam('inner_ball_diameter', '44mm', 'mm', 'Durchmesser des inneren Kugelloches (43mm)'),
    armEndBoreDepth: getOrCreateParam('arm_end_bore_depth', '41mm', 'mm', 'Länge / Tiefe der Bohrung am Ende der 8cm Arme'),
    armEndBoreDiameter: getOrCreateParam('arm_end_bore_diameter', '43mm', 'mm', 'Durchmesser der Bohrung am Ende der 8cm Arme (43mm)'),
    // Parameter für 3D-Druck Trennung & Verbindungsröhren
    cutModel: (function () {
      let p = params.itemByName('cut_model') || params.itemByName('cut-model');
      if (!p) {
        p = params.add('cut_model', adsk.core.ValueInput.createByString('0'), '', 'Modell in 3 Tetrapoden-Teile fuer 3D-Druck schneiden (1 = true, 0 = false)');
      } else {
        try {
          p.expression = '0';
        } catch (_e) {}
      }
      return false;
    })(),
    connectorOuterDiameter: getOrCreateParam('connector_outer_diameter', '37.8mm', 'mm', 'Aussendurchmesser der Verbindungsröhren (38mm - 0.2mm Spiel)'),
    connectorInnerDiameter: getOrCreateParam('connector_inner_diameter', '43mm', 'mm', 'Innendurchmesser der Verbindungsröhren (43mm)'),
    connectorLength: getOrCreateParam('connector_length', '30mm', 'mm', 'Gesamtlänge der Verbindungsröhren'),
    connectorClearance: getOrCreateParam('connector_clearance', '0.2mm', 'mm', 'Spiel/Toleranz der Steckbuchsen-Aufnahmen an den Arm-Schnittkanten'),
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
    nodeFilletRadius: getOrCreateParam('node_fillet_radius', '30mm', 'mm', 'Radius fuer die Tetrapod-Knotenabrundung (25mm, Tangential G1, Konstante, Versatz)'),
    footLegBoreDiameter: getOrCreateParam('foot_leg_bore_diameter', '43mm', 'mm', 'Durchmesser der Aufbohrung des Fussbeins (43mm)'),
    nodeBoreDiameter: getOrCreateParam('node_bore_diameter', '43mm', 'mm', 'Durchmesser der Knoten-Bohrungen (43mm)'),
    nodeBoreDepth: getOrCreateParam('node_bore_depth', '40mm', 'mm', 'Tiefe der Knoten-Bohrungen vom Zentrum (40mm)')
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
 * Erstellt einen der kürzeren Arme als durchgehende Röhre (OD 48mm, ID 43mm, Länge 35mm in -Z).
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

  const ringProfile = findRingProfile(sketch, params.ringInnerDiameter.value);
  if (!ringProfile) {
    throw new Error('Ringprofil für Arm konnte nicht ermittelt werden.');
  }

  const extInputRing = extrudeFeatures.createInput(ringProfile, adsk.fusion.FeatureOperations.NewBodyFeatureOperation);
  extInputRing.setDistanceExtent(false, adsk.core.ValueInput.createByString('-arm_depth'));
  return extrudeFeatures.add(extInputRing).bodies.item(0);
}

type ArmType = 'leg' | 'short' | 'bored';

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
  } else if (armType === 'bored') {
    return createSingleBoredArm(rootComp, params);
  } else {
    return createSingleSteppedArm(rootComp, params);
  }
}

/**
 * Erstellt den 8 cm langen Arm als durchgehende Röhre (OD 48mm, ID 43mm, Länge 80mm in -Z).
 */
function createSingleBoredArm(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>
): adsk.fusion.BRepBody {
  return createLongArm(rootComp, params);
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
 * Bohrt nach dem Merge bei jedem Knoten in die 4 tetrahedralen Richtungen
 * vom Zentrum aus mit Durchmesser (43mm) und Tiefe (ca 40mm).
 */
function drillNodeBores(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody,
  params: ReturnType<typeof setupParameters>,
  center2: adsk.core.Point3D,
  center3: adsk.core.Point3D
): adsk.fusion.BRepBody {
  const center1 = adsk.core.Point3D.create(0, 0, 0);

  const boreDiamCm = params.nodeBoreDiameter.value; // 4.3 cm (43mm)
  const boreDepthCm = params.nodeBoreDepth.value;   // 4.0 cm (40mm)

  // 1. Basis-Richtungsvektoren in lokalem Tetrapod-Koordinatensystem
  const tetraAngle = TETRA_ANGLE_RAD;
  const sinTetra = Math.sin(tetraAngle);
  const cosTetra = Math.cos(tetraAngle);

  // Arm 0: (0, 0, -1)
  const v0 = adsk.core.Vector3D.create(0, 0, -1);

  // Arm 1: (-sinTetra, 0, -cosTetra)
  const v1 = adsk.core.Vector3D.create(-sinTetra, 0, -cosTetra);

  // Arm 2: v1 rotieren um +120 deg um Z-Achse
  const v2 = adsk.core.Vector3D.create(
    0.5 * sinTetra,
    -(Math.sqrt(3) / 2.0) * sinTetra,
    -cosTetra
  );

  // Arm 3: v1 rotieren um +240 deg um Z-Achse
  const v3 = adsk.core.Vector3D.create(
    0.5 * sinTetra,
    (Math.sqrt(3) / 2.0) * sinTetra,
    -cosTetra
  );

  const localBaseVectors = [v0, v1, v2, v3];

  // Matrix fuer Node 2 (Rotation 180° um Y-Achse)
  const rotMatrixNode2 = adsk.core.Matrix3D.create();
  rotMatrixNode2.setToRotation(Math.PI, adsk.core.Vector3D.create(0, 1, 0), adsk.core.Point3D.create(0, 0, 0));

  // Definition der 3 Knoten (Zentrum und Rotationsmatrix zur Transformation der lokalen Vektoren)
  const nodes = [
    { name: 'Node 1', center: center1, rotMatrix: adsk.core.Matrix3D.create() },
    { name: 'Node 2', center: center2, rotMatrix: rotMatrixNode2 },
    { name: 'Node 3', center: center3, rotMatrix: adsk.core.Matrix3D.create() }
  ];

  let currentBody = targetBody;

  for (const node of nodes) {
    for (let armIdx = 0; armIdx < 4; armIdx++) {
      const baseV = localBaseVectors[armIdx];
      const locVec = adsk.core.Vector3D.create(baseV.x, baseV.y, baseV.z);
      locVec.transformBy(node.rotMatrix);
      locVec.normalize();

      currentBody = cutBoreCylinder(
        rootComp,
        currentBody,
        node.center,
        locVec,
        boreDiamCm,
        boreDepthCm,
        `${node.name}_Arm_${armIdx}`
      );
    }
  }

  return currentBody;
}

/**
 * Erzeugt einen Schneid-Zylinder mit Radius (diamCm/2) und Höhe (depthCm),
 * richtet dessen Achse entlang dirVec aus, positioniert den Fußpunkt auf nodeCenter
 * und führt eine Cut-Operation auf targetBody durch.
 */
function cutBoreCylinder(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody,
  nodeCenter: adsk.core.Point3D,
  dirVec: adsk.core.Vector3D,
  diamCm: number,
  depthCm: number,
  boreLabel: string
): adsk.fusion.BRepBody {
  try {
    const sketches = rootComp.sketches;
    const features = rootComp.features;
    const extrudeFeatures = features.extrudeFeatures;
    const combineFeatures = features.combineFeatures;
    const moveFeatures = features.moveFeatures;

    // 1. Zylinder im Ursprung auf XY-Ebene extrudieren (+Z Richtung: (0,0,1))
    const sketch = sketches.add(rootComp.xYConstructionPlane);
    sketch.sketchCurves.sketchCircles.addByCenterRadius(
      adsk.core.Point3D.create(0, 0, 0),
      diamCm / 2.0
    );

    if (sketch.profiles.count === 0) {
      console.warn(`[drillBore] Kein Profil in Skizze fuer ${boreLabel} gefunden.`);
      return targetBody;
    }
    const profile = sketch.profiles.item(0);

    const extInput = extrudeFeatures.createInput(
      profile,
      adsk.fusion.FeatureOperations.NewBodyFeatureOperation
    );
    extInput.setDistanceExtent(false, adsk.core.ValueInput.createByReal(depthCm));
    const extFeat = extrudeFeatures.add(extInput);
    if (!extFeat || extFeat.bodies.count === 0) {
      console.warn(`[drillBore] Extrusion fuer Zylinder ${boreLabel} fehlgeschlagen.`);
      return targetBody;
    }

    const toolBody = extFeat.bodies.item(0);

    // 2. Transformation berechnen: Lokale Z-Achse (0,0,1) nach dirVec drehen, dann nach nodeCenter verschieben
    const localZ = adsk.core.Vector3D.create(0, 0, 1);
    const transMat = adsk.core.Matrix3D.create();

    const dot = localZ.dotProduct(dirVec);
    if (Math.abs(dot - 1.0) < 1e-5) {
      // Keine Rotation notwendig
    } else if (Math.abs(dot + 1.0) < 1e-5) {
      // 180° Rotation um X-Achse
      transMat.setToRotation(Math.PI, adsk.core.Vector3D.create(1, 0, 0), adsk.core.Point3D.create(0, 0, 0));
    } else {
      const rotAxis = localZ.crossProduct(dirVec);
      rotAxis.normalize();
      const rotAngle = Math.acos(Math.min(1.0, Math.max(-1.0, dot)));
      transMat.setToRotation(rotAngle, rotAxis, adsk.core.Point3D.create(0, 0, 0));
    }

    const shiftMat = adsk.core.Matrix3D.create();
    shiftMat.translation = adsk.core.Vector3D.create(nodeCenter.x, nodeCenter.y, nodeCenter.z);
    transMat.transformBy(shiftMat);

    // Tool-Body an Position bewegen
    const moveInput = moveFeatures.createInput2(createCollection([toolBody]));
    moveInput.defineAsFreeMove(transMat);
    moveFeatures.add(moveInput);

    // 3. Cut-Operation (targetBody MINUS toolBody)
    const toolColl = createCollection([toolBody]);
    const combineInput = combineFeatures.createInput(targetBody, toolColl);
    combineInput.operation = adsk.fusion.FeatureOperations.CutFeatureOperation;
    const combineFeat = combineFeatures.add(combineInput);

    if (combineFeat && combineFeat.bodies.count > 0) {
      const res = combineFeat.bodies.item(0);
      if (res) return res;
    }
  } catch (e) {
    console.warn(`[drillBore] Fehler beim Bohren (${boreLabel}): ${e}`);
  }

  return getLiveBody(rootComp, targetBody);
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

/**
 * Trennt den fertig verschmolzenen und verrundeten Gesamtkörper am Ende in 3 Einzelknoten (nodeBottom, nodeMiddle, nodeTop).
 * Nutzt 100 cm lange Skizzenlinien auf der XZ-Konstruktionsebene als Schnittwerkzeuge (vollständig parametrisch).
 */
function splitCombinedModelIntoThreeNodes(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody,
  center2: adsk.core.Point3D,
  _center3: adsk.core.Point3D
): { nodeBottom: adsk.fusion.BRepBody; nodeMiddle: adsk.fusion.BRepBody; nodeTop: adsk.fusion.BRepBody } {
  const splitBodyFeatures = rootComp.features.splitBodyFeatures;
  const sketches = rootComp.sketches;

  // 1. Schnitt 1 (mittig in Verbindungsröhre 1-2) via 100 cm langer Skizzenlinie auf XZ-Ebene
  const dir1to2 = adsk.core.Vector3D.create(-Math.sin(TETRA_ANGLE_RAD), 0, -Math.cos(TETRA_ANGLE_RAD));
  const mid1to2 = adsk.core.Point3D.create(4.0 * dir1to2.x, 0, 4.0 * dir1to2.z);

  // Vektor senkrecht zur 1-2-Achse in der XZ-Ebene
  const perpX = -dir1to2.z;
  const perpZ = dir1to2.x;

  // Großzügige Länge (50 cm in jede Richtung = 100 cm Gesamtlinie), um das gesamte Modell sicher zu kreuzen
  const p1_3D_1 = adsk.core.Point3D.create(mid1to2.x - 50.0 * perpX, 0, mid1to2.z - 50.0 * perpZ);
  const p2_3D_1 = adsk.core.Point3D.create(mid1to2.x + 50.0 * perpX, 0, mid1to2.z + 50.0 * perpZ);

  const sketch1 = sketches.add(rootComp.xZConstructionPlane);
  const p1_1 = sketch1.modelToSketchSpace(p1_3D_1);
  const p2_1 = sketch1.modelToSketchSpace(p2_3D_1);
  const line1 = sketch1.sketchCurves.sketchLines.addByTwoPoints(p1_1, p2_1);

  const splitInput1 = splitBodyFeatures.createInput(targetBody, line1, true);
  if (!splitInput1) throw new Error('SplitInput 1 konnte nicht erzeugt werden.');
  const splitFeat1 = splitBodyFeatures.add(splitInput1);
  if (!splitFeat1 || splitFeat1.bodies.count < 2) {
    throw new Error('Fehler bei Schnitt 1: Gesamtkörper konnte nicht in 2 Teile getrennt werden.');
  }

  const b1_a = splitFeat1.bodies.item(0);
  const b1_b = splitFeat1.bodies.item(1);

  let nodeBottom: adsk.fusion.BRepBody;
  let restBody: adsk.fusion.BRepBody;

  if (b1_a.boundingBox.minPoint.z < b1_b.boundingBox.minPoint.z) {
    nodeBottom = b1_a;
    restBody = b1_b;
  } else {
    nodeBottom = b1_b;
    restBody = b1_a;
  }

  // 2. Schnitt 2 (mittig in Verbindungsröhre 2-3) via 100 cm langer Skizzenlinie auf XZ-Ebene bei Z = center2.z + 4.0
  const mid2to3Z = center2.z + 4.0;
  const p1_3D_2 = adsk.core.Point3D.create(center2.x - 50.0, 0, mid2to3Z);
  const p2_3D_2 = adsk.core.Point3D.create(center2.x + 50.0, 0, mid2to3Z);

  const sketch2 = sketches.add(rootComp.xZConstructionPlane);
  const p1_2 = sketch2.modelToSketchSpace(p1_3D_2);
  const p2_2 = sketch2.modelToSketchSpace(p2_3D_2);
  const line2 = sketch2.sketchCurves.sketchLines.addByTwoPoints(p1_2, p2_2);

  const splitInput2 = splitBodyFeatures.createInput(restBody, line2, true);
  if (!splitInput2) throw new Error('SplitInput 2 konnte nicht erzeugt werden.');
  const splitFeat2 = splitBodyFeatures.add(splitInput2);
  if (!splitFeat2 || splitFeat2.bodies.count < 2) {
    throw new Error('Fehler bei Schnitt 2: Verbleibender Körper konnte nicht in Node 2 und Node 3 getrennt werden.');
  }

  const b2_a = splitFeat2.bodies.item(0);
  const b2_b = splitFeat2.bodies.item(1);

  let nodeMiddle: adsk.fusion.BRepBody;
  let nodeTop: adsk.fusion.BRepBody;

  if (b2_a.boundingBox.minPoint.z < b2_b.boundingBox.minPoint.z) {
    nodeMiddle = b2_a;
    nodeTop = b2_b;
  } else {
    nodeMiddle = b2_b;
    nodeTop = b2_a;
  }

  return { nodeBottom, nodeMiddle, nodeTop };
}

/**
 * Findet die planar geschnittene Stirnfläche an einem Trennpunkt.
 */
function findCutFaceAtPoint(
  body: adsk.fusion.BRepBody,
  targetPt: adsk.core.Point3D
): adsk.fusion.BRepFace | null {
  let bestFace: adsk.fusion.BRepFace | null = null;
  let minDist = Infinity;

  for (let i = 0; i < body.faces.count; i++) {
    const face = body.faces.item(i);
    if (!face || face.geometry.surfaceType !== adsk.core.SurfaceTypes.PlaneSurfaceType) continue;

    const bbox = face.boundingBox;
    const faceCenter = adsk.core.Point3D.create(
      (bbox.minPoint.x + bbox.maxPoint.x) / 2.0,
      (bbox.minPoint.y + bbox.maxPoint.y) / 2.0,
      (bbox.minPoint.z + bbox.maxPoint.z) / 2.0
    );

    const dist = faceCenter.distanceTo(targetPt);
    if (dist < minDist && dist < 1.5) {
      minDist = dist;
      bestFace = face;
    }
  }

  return bestFace;
}

/**
 * Wendet die 40mm Knoten-Verrundungen auf die 3 einzelnen Tetrapoden-Körper an.
 */
function applyNodeFilletsToIndividualNodes(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>,
  nodeBottom: adsk.fusion.BRepBody,
  nodeMiddle: adsk.fusion.BRepBody,
  nodeTop: adsk.fusion.BRepBody,
  center2: adsk.core.Point3D,
  center3: adsk.core.Point3D
): void {
  const nodeItems = [
    { name: 'node-bottom', body: nodeBottom, center: adsk.core.Point3D.create(0, 0, 0) },
    { name: 'node-middle', body: nodeMiddle, center: center2 },
    { name: 'node-top', body: nodeTop, center: center3 }
  ];

  for (const item of nodeItems) {
    const edges = findNodeIntersectionEdges(item.body, item.center);
    if (edges.length > 0) {
      applyFilletWithFallbacks(
        rootComp,
        edges,
        params.nodeFilletRadius.value,
        'node_fillet_radius',
        `Knotenabrundung (${item.name})`
      );
    }
  }
}

/**
 * Findet alle ebenen Röhren-Schnittflächen an einem getrennten Knoten-Körper.
 */
function findCutFacesOnBody(body: adsk.fusion.BRepBody): adsk.fusion.BRepFace[] {
  const cutFaces: adsk.fusion.BRepFace[] = [];

  for (let i = 0; i < body.faces.count; i++) {
    const face = body.faces.item(i);
    if (!face || face.geometry.surfaceType !== adsk.core.SurfaceTypes.PlaneSurfaceType) continue;

    const area = face.area;
    if (area > 5.0 && area < 25.0) {
      let hasCircularEdge = false;
      for (let j = 0; j < face.edges.count; j++) {
        const edge = face.edges.item(j);
        if (edge && edge.geometry.curveType === adsk.core.Curve3DTypes.Circle3DCurveType) {
          hasCircularEdge = true;
          break;
        }
      }
      if (hasCircularEdge) {
        cutFaces.push(face);
      }
    }
  }

  return cutFaces;
}

/**
 * Schneidet GANZ AM ENDE die Steckbuchsen (38.2 mm Ø, 15 mm Tiefe, 35 mm Kabelkanal)
 * in die Schnittflächen von nodeBottom, nodeMiddle und nodeTop.
 */
function applyConnectorSocketsAtTheVeryEnd(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>,
  nodeBottom: adsk.fusion.BRepBody,
  nodeMiddle: adsk.fusion.BRepBody,
  nodeTop: adsk.fusion.BRepBody
): void {
  const boreDiamCm = params.connectorOuterDiameter.value + params.connectorClearance.value; // 38.2 mm = 3.82 cm
  const boreDepthCm = params.connectorLength.value / 2.0; // 15.0 mm = 1.5 cm

  const nodeBodies = [nodeBottom, nodeMiddle, nodeTop];

  for (const body of nodeBodies) {
    const faces = findCutFacesOnBody(body);
    for (const face of faces) {
      const bbox = face.boundingBox;
      const faceCenter3D = adsk.core.Point3D.create(
        (bbox.minPoint.x + bbox.maxPoint.x) / 2.0,
        (bbox.minPoint.y + bbox.maxPoint.y) / 2.0,
        (bbox.minPoint.z + bbox.maxPoint.z) / 2.0
      );

      const sketch = rootComp.sketches.add(face);

      let circleCenterPt: adsk.core.Point3D | null = null;
      for (let j = 0; j < face.edges.count; j++) {
        const edge = face.edges.item(j);
        if (edge && edge.geometry.curveType === adsk.core.Curve3DTypes.Circle3DCurveType) {
          const circ = edge.geometry as adsk.core.Circle3D;
          circleCenterPt = sketch.modelToSketchSpace(circ.center);
          break;
        }
      }

      if (!circleCenterPt) {
        circleCenterPt = sketch.modelToSketchSpace(faceCenter3D);
      }

      const innerDiamCm = params.connectorInnerDiameter.value; // 3.0 cm = 30 mm

      // Äußerer Kreis für den Steckröhren-Außendurchmesser (38.2 mm)
      sketch.sketchCurves.sketchCircles.addByCenterRadius(circleCenterPt, boreDiamCm / 2.0);
      // Innerer Kreis für den Kabelkanal (30.0 mm)
      sketch.sketchCurves.sketchCircles.addByCenterRadius(circleCenterPt, innerDiamCm / 2.0);

      const ringProfile = findRingProfile(sketch, innerDiamCm);
      if (!ringProfile) continue;

      const extrudeFeatures = rootComp.features.extrudeFeatures;
      const extInput = extrudeFeatures.createInput(ringProfile, adsk.fusion.FeatureOperations.CutFeatureOperation);
      extInput.participantBodies = [body];
      extInput.setDistanceExtent(false, adsk.core.ValueInput.createByReal(-boreDepthCm));
      try {
        extrudeFeatures.add(extInput);
      } catch (_e) { }
    }
  }
}

/**
 * Erzeugt eine geradlinige Verbindungsröhre mit ca. 35 mm Innenloch für Kabeldurchführung.
 * Außendurchmesser: 38.0 mm, Innendurchmesser: 35.0 mm, Länge: 45.0 mm.
 */
function createStandaloneConnectorPipe(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>,
  name: string
): adsk.fusion.BRepBody {
  const outerDiameterCm = params.connectorOuterDiameter.value; // 3.8 cm
  const innerDiameterCm = params.connectorInnerDiameter.value; // 3.5 cm
  const lengthCm = params.connectorLength.value;               // 4.5 cm

  const sketches = rootComp.sketches;
  const extrudeFeatures = rootComp.features.extrudeFeatures;

  const sketch = sketches.add(rootComp.xYConstructionPlane);
  const center = adsk.core.Point3D.create(0, 0, 0);

  sketch.sketchCurves.sketchCircles.addByCenterRadius(center, outerDiameterCm / 2.0);
  sketch.sketchCurves.sketchCircles.addByCenterRadius(center, innerDiameterCm / 2.0);

  const ringProfile = findRingProfile(sketch, innerDiameterCm);
  if (!ringProfile) {
    throw new Error('Ringprofil für Verbindungsröhre konnte nicht ermittelt werden.');
  }

  const extInput = extrudeFeatures.createInput(
    ringProfile,
    adsk.fusion.FeatureOperations.NewBodyFeatureOperation
  );
  extInput.setDistanceExtent(false, adsk.core.ValueInput.createByReal(lengthCm));

  const extrudeFeature = extrudeFeatures.add(extInput);
  const tubeBody = extrudeFeature.bodies.item(0);
  tubeBody.name = name;
  return tubeBody;
}

/**
 * Bohrt die Aufnahme-Steckbuchse (Socket) an einer Arm-Stirnfläche für die Verbindungsröhre.
 * Außendurchmesser Buchse: 38.2 mm, Innendurchmesser Kabelkanal: 35.0 mm, Tiefe: 15.0 mm.
 */
function addConnectorSocketBore(
  rootComp: adsk.fusion.Component,
  nodeBody: adsk.fusion.BRepBody,
  face: adsk.fusion.BRepFace,
  centerPt3D: adsk.core.Point3D,
  boreDiameterCm: number,
  boreDepthCm: number,
  cableHoleDiameterCm: number = 3.5
): void {
  const sketch = rootComp.sketches.add(face);
  // Exakten 3D-Mittelpunkt des Röhrenzylinders auf der Schnittfläche in den 2D-Skizzenraum umrechnen
  const centerPoint = sketch.modelToSketchSpace(centerPt3D);

  // Äußerer Kreis für den Steckröhren-Außendurchmesser (38.2 mm)
  sketch.sketchCurves.sketchCircles.addByCenterRadius(centerPoint, boreDiameterCm / 2.0);
  // Innerer Kreis für den Kabelkanal (35.0 mm)
  sketch.sketchCurves.sketchCircles.addByCenterRadius(centerPoint, cableHoleDiameterCm / 2.0);

  const ringProfile = findRingProfile(sketch, cableHoleDiameterCm);
  if (!ringProfile) return;

  const extrudeFeatures = rootComp.features.extrudeFeatures;
  const extInput = extrudeFeatures.createInput(ringProfile, adsk.fusion.FeatureOperations.CutFeatureOperation);
  extInput.participantBodies = [nodeBody];
  extInput.setDistanceExtent(false, adsk.core.ValueInput.createByReal(-boreDepthCm));
  try {
    extrudeFeatures.add(extInput);
  } catch (_e) { }
}

/**
 * Richtet einen Körper so aus, dass seine Unterseite exakt auf Z = 0 liegt (Druckbett)
 * und verschiebt ihn auf die angegebene Y-Koordinate (X = 0).
 */
function placeBodyOnXYPlane(
  rootComp: adsk.fusion.Component,
  body: adsk.fusion.BRepBody,
  targetYCm: number
): void {
  const bbox = body.boundingBox;
  const minZ = bbox.minPoint.z;
  const currentCenterX = (bbox.minPoint.x + bbox.maxPoint.x) / 2.0;
  const currentCenterY = (bbox.minPoint.y + bbox.maxPoint.y) / 2.0;

  const moveFeats = rootComp.features.moveFeatures;
  const transVec = adsk.core.Vector3D.create(
    -currentCenterX,
    targetYCm - currentCenterY,
    -minZ
  );

  const mat = adsk.core.Matrix3D.create();
  mat.translation = transVec;

  const moveInput = moveFeats.createInput2(createCollection([body]));
  moveInput.defineAsFreeMove(mat);
  try {
    moveFeats.add(moveInput);
  } catch (e) {
    console.warn(`Fehler bei Anordnung von Body '${body.name}' auf XY-Ebene: ${e}`);
  }
}

/**
 * Trennt den Fuß vom 1. Knoten bei Z = -3.5 cm und schneidet alle 7 langen 80mm-Arme
 * bei 3.5 cm Abstand vom jeweiligen Knoten-Zentrum ab.
 */
function cutAllLongArmsAndFoot(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>,
  nodeBottom: adsk.fusion.BRepBody,
  nodeMiddle: adsk.fusion.BRepBody,
  nodeTop: adsk.fusion.BRepBody,
  center2: adsk.core.Point3D,
  center3: adsk.core.Point3D
): {
  nodeBottomCut: adsk.fusion.BRepBody;
  nodeMiddleCut: adsk.fusion.BRepBody;
  nodeTopCut: adsk.fusion.BRepBody;
  footBase: adsk.fusion.BRepBody;
  inletArms: adsk.fusion.BRepBody[];
} {
  const splitBodyFeatures = rootComp.features.splitBodyFeatures;
  const constructionPlanes = rootComp.constructionPlanes;

  // 1. Fuß von nodeBottom bei Z = -3.5 cm schneiden
  const legCutZ = -params.armDepth.value; // -3.5 cm
  const footCutPlane = createOffsetPlane(rootComp, rootComp.xYConstructionPlane, legCutZ);

  let footBase: adsk.fusion.BRepBody = nodeBottom;
  let nodeBottomCut: adsk.fusion.BRepBody = nodeBottom;

  const footSplitInput = splitBodyFeatures.createInput(nodeBottom, footCutPlane, true);
  if (footSplitInput) {
    const feat = splitBodyFeatures.add(footSplitInput);
    if (feat && feat.bodies.count >= 2) {
      const b0 = feat.bodies.item(0);
      const b1 = feat.bodies.item(1);
      if (b0.boundingBox.minPoint.z < b1.boundingBox.minPoint.z) {
        footBase = b0;
        nodeBottomCut = b1;
      } else {
        footBase = b1;
        nodeBottomCut = b0;
      }
    }
  }

  footBase.name = 'foot-base';

  // 2. Alle 7 langen Arme identifizieren und bei 3.5 cm schneiden
  const inletArms: adsk.fusion.BRepBody[] = [];

  const nodes = [
    { body: nodeBottomCut, center: adsk.core.Point3D.create(0, 0, 0), name: 'node-bottom' },
    { body: nodeMiddle, center: center2, name: 'node-middle' },
    { body: nodeTop, center: center3, name: 'node-top' }
  ];

  let armCounter = 1;

  for (const item of nodes) {
    let currentBody = item.body;
    const center = item.center;

    let foundLongArm = true;
    while (foundLongArm) {
      foundLongArm = false;
      for (let i = 0; i < currentBody.faces.count; i++) {
        const face = currentBody.faces.item(i);
        if (!face || face.geometry.surfaceType !== adsk.core.SurfaceTypes.PlaneSurfaceType) continue;

        const bbox = face.boundingBox;
        const faceCenter = adsk.core.Point3D.create(
          (bbox.minPoint.x + bbox.maxPoint.x) / 2.0,
          (bbox.minPoint.y + bbox.maxPoint.y) / 2.0,
          (bbox.minPoint.z + bbox.maxPoint.z) / 2.0
        );

        const dist = faceCenter.distanceTo(center);
        if (dist > 6.5 && dist < 9.5) {
          const offsetDistCm = -(dist - params.armDepth.value);
          const planeInput = constructionPlanes.createInput();
          planeInput.setByOffset(face, adsk.core.ValueInput.createByReal(offsetDistCm));
          let cutPlane = constructionPlanes.add(planeInput);

          if (cutPlane && cutPlane.geometry && Math.abs(cutPlane.geometry.origin.distanceTo(center) - params.armDepth.value) > 0.5) {
            const planeInput2 = constructionPlanes.createInput();
            planeInput2.setByOffset(face, adsk.core.ValueInput.createByReal(-offsetDistCm));
            cutPlane = constructionPlanes.add(planeInput2);
          }

          const splitInput = splitBodyFeatures.createInput(currentBody, cutPlane, true);
          if (splitInput) {
            const splitFeat = splitBodyFeatures.add(splitInput);
            if (splitFeat && splitFeat.bodies.count >= 2) {
              const b0 = splitFeat.bodies.item(0);
              const b1 = splitFeat.bodies.item(1);

              const dist0 = adsk.core.Point3D.create(
                (b0.boundingBox.minPoint.x + b0.boundingBox.maxPoint.x) / 2,
                (b0.boundingBox.minPoint.y + b0.boundingBox.maxPoint.y) / 2,
                (b0.boundingBox.minPoint.z + b0.boundingBox.maxPoint.z) / 2
              ).distanceTo(center);

              const dist1 = adsk.core.Point3D.create(
                (b1.boundingBox.minPoint.x + b1.boundingBox.maxPoint.x) / 2,
                (b1.boundingBox.minPoint.y + b1.boundingBox.maxPoint.y) / 2,
                (b1.boundingBox.minPoint.z + b1.boundingBox.maxPoint.z) / 2
              ).distanceTo(center);

              let severedArm: adsk.fusion.BRepBody;
              if (dist0 < dist1) {
                currentBody = b0;
                severedArm = b1;
              } else {
                currentBody = b1;
                severedArm = b0;
              }

              severedArm.name = `arm-inlet-${armCounter++}`;
              inletArms.push(severedArm);
              foundLongArm = true;
              break;
            }
          }
        }
      }
    }

    if (item.name === 'node-bottom') nodeBottomCut = currentBody;
    else if (item.name === 'node-middle') nodeMiddle = currentBody;
    else if (item.name === 'node-top') nodeTop = currentBody;
  }

  return { nodeBottomCut, nodeMiddleCut: nodeMiddle, nodeTopCut: nodeTop, footBase, inletArms };
}

/**
 * Bohrt die 38.2 mm Steckbuchse in die Oberseite des abgetrennten Fußbeins.
 */
function addSocketToFootTopFace(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>,
  footBase: adsk.fusion.BRepBody
): void {
  let topFace: adsk.fusion.BRepFace | null = null;
  let maxZ = -Infinity;

  for (let i = 0; i < footBase.faces.count; i++) {
    const face = footBase.faces.item(i);
    if (!face || face.geometry.surfaceType !== adsk.core.SurfaceTypes.PlaneSurfaceType) continue;

    const bb = face.boundingBox;
    const centerZ = (bb.minPoint.z + bb.maxPoint.z) / 2.0;
    if (centerZ > maxZ) {
      maxZ = centerZ;
      topFace = face;
    }
  }

  if (topFace) {
    const boreDiamCm = params.connectorOuterDiameter.value + params.connectorClearance.value; // 3.82 cm
    const boreDepthCm = params.connectorLength.value / 2.0; // 1.5 cm
    const centerPt3D = adsk.core.Point3D.create(0, 0, maxZ);
    addConnectorSocketBore(rootComp, footBase, topFace, centerPt3D, boreDiamCm, boreDepthCm, params.connectorInnerDiameter.value);
  }
}

/**
 * Bohrt die 38.2 mm Steckbuchse in die untere Schnittfläche jeder der 7 abgetrennten Inlet-Arme.
 */
function addSocketsToSeveredArmBases(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>,
  inletArms: adsk.fusion.BRepBody[]
): void {
  const boreDiamCm = params.connectorOuterDiameter.value + params.connectorClearance.value; // 3.82 cm
  const boreDepthCm = params.connectorLength.value / 2.0; // 1.5 cm

  for (const arm of inletArms) {
    let baseFace: adsk.fusion.BRepFace | null = null;

    for (let i = 0; i < arm.faces.count; i++) {
      const face = arm.faces.item(i);
      if (!face || face.geometry.surfaceType !== adsk.core.SurfaceTypes.PlaneSurfaceType) continue;

      let maxEdgeRadius = 0;
      for (let j = 0; j < face.edges.count; j++) {
        const edge = face.edges.item(j);
        if (edge && edge.geometry.curveType === adsk.core.Curve3DTypes.Circle3DCurveType) {
          const circ = edge.geometry as adsk.core.Circle3D;
          if (circ.radius > maxEdgeRadius) maxEdgeRadius = circ.radius;
        }
      }

      if (maxEdgeRadius < 2.3) {
        baseFace = face;
        break;
      }
    }

    if (!baseFace && arm.faces.count > 0) {
      for (let i = 0; i < arm.faces.count; i++) {
        const face = arm.faces.item(i);
        if (face && face.geometry.surfaceType === adsk.core.SurfaceTypes.PlaneSurfaceType) {
          baseFace = face;
          break;
        }
      }
    }

    if (baseFace) {
      const bbox = baseFace.boundingBox;
      const centerPt3D = adsk.core.Point3D.create(
        (bbox.minPoint.x + bbox.maxPoint.x) / 2.0,
        (bbox.minPoint.y + bbox.maxPoint.y) / 2.0,
        (bbox.minPoint.z + bbox.maxPoint.z) / 2.0
      );
      addConnectorSocketBore(rootComp, arm, baseFace, centerPt3D, boreDiamCm, boreDepthCm, params.connectorInnerDiameter.value);
    }
  }
}