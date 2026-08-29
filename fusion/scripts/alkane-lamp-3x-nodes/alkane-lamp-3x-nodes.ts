import { adsk } from "@adsk/fusion";

const app = adsk.core.Application.get();
const ui = app ? app.userInterface : null;

// =====================================================================
// GEOMETRISCHE KONSTANTEN & SCHNITTKANTEN-MEASURES
// =====================================================================

/** Tetraeder-Bindungswinkel theta = arccos(-1/3) ≈ 109.47122° */
const TETRA_ANGLE_RAD = Math.acos(-1.0 / 3.0);
const TETRA_ANGLE_DEG_STR = '109.47122063449069deg';

/** Präzise Schnittkanten-Bogenlänge (in cm) für Knoten-Abrundung */
const EDGE_LEN_NODE_INTERSECTION_CM = 5.1514; // 51.514 mm Knoten-Schnittkanten

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

    // 2. Ersten Tetrapod (Node 1) im Ursprung (0,0,0) erzeugen & vollständig bearbeiten
    // (Arm 0: -Z, Arm 1: Tetraeder-Richtung v1, Arm 2 & 3: v2, v3)
    console.log('Erzeuge Node 1 im Ursprung...');
    const node1 = buildSingleTetrapodNode(rootComp, params, 'Node_1');

    // 3. Zweiten Tetrapod (Node 2, mittlerer Knoten) im Ursprung erzeugen & bearbeiten
    console.log('Erzeuge Node 2...');
    const node2 = buildSingleTetrapodNode(rootComp, params, 'Node_2');

    // 4. Node 2 positionieren:
    // Verschiebung entlang Arm 1 von Node 1 (Abstand 2 * armLength = 80mm)
    // Rotation um 180° um Y-Achse -> bewirkt 60° gestaffelte Alkan-Konformation (staggered)
    const center2 = positionSecondTetrapod(rootComp, node2, params);

    // 5. Dritten Tetrapod (Node 3) im Ursprung erzeugen & bearbeiten
    console.log('Erzeuge Node 3...');
    const node3 = buildSingleTetrapodNode(rootComp, params, 'Node_3');

    // 6. Node 3 positionieren:
    // Verschiebung entlang Arm 0 von Node 2 (Abstand 2 * armLength = 80mm in +Z)
    // Standard-Orientierung (Arm 0 zeigt in -Z zurück zu Node 2)
    const center3 = positionThirdTetrapod(rootComp, node3, center2, params);

    // 7. Alle 3 Knoten zu einem Gesamtkörper verschmelzen (wenn join_nodes = 1)
    let finalBody = combineNodes(rootComp, node1, node2, node3, params);

    // 8. Modell am Ende auf die beiden parallelen Beine auf der XY-Ebene (Z = 0) aufstellen
    finalBody = alignModelOnParallelLegs(rootComp, finalBody, params, [node1, node2, node3]);

    const isJoined = Math.round(params.joinNodes.value) === 1;
    const resultMsg = isJoined
      ? 'Erfolgreich als einteiliger Gesamtkörper (alkane-lamp-3x-nodes) auf 2 parallelen Beinen stehend generiert!'
      : 'Erfolgreich als 3 separate, auf 2 parallelen Beinen stehende Tetrapoden-Knoten generiert!';

    console.log(resultMsg);
    console.log(`Zentren: Node 1=(0,0,0), Node 2=(${center2.x.toFixed(2)}, ${center2.y.toFixed(2)}, ${center2.z.toFixed(2)}) cm, Node 3=(${center3.x.toFixed(2)}, ${center3.y.toFixed(2)}, ${center3.z.toFixed(2)}) cm`);

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
 * Ermittelt den aktuellen Live-BRepBody aus rootComp.bRepBodies.
 */
function getLiveBody(rootComp: adsk.fusion.Component, fallbackBody: adsk.fusion.BRepBody): adsk.fusion.BRepBody {
  try {
    if (fallbackBody && fallbackBody.isValid) {
      return fallbackBody;
    }
  } catch (_e) { }

  if (fallbackBody && fallbackBody.name) {
    const b = rootComp.bRepBodies.itemByName(fallbackBody.name);
    if (b && b.isValid) return b;
  }
  return fallbackBody;
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
    armOuterDiameter: getOrCreateParam('arm_outer_diameter', '48mm', 'mm', 'Aussendurchmesser der Arme'),
    armDepthLong: getOrCreateParam('arm_depth_long', '40mm', 'mm', 'Armlaenge aller 4 Arme gemessen vom Zentrum'),
    ringInnerDiameter: getOrCreateParam('ring_inner_diameter', '43mm', 'mm', 'Innendurchmesser der Röhren (43mm)'),
    innerBallDiameter: getOrCreateParam('inner_ball_diameter', '44mm', 'mm', 'Durchmesser des inneren Kugelloches (44mm)'),
    nodeBoreDiameter: getOrCreateParam('node_bore_diameter', '43mm', 'mm', 'Durchmesser der Knoten-Bohrungen (43mm)'),
    nodeBoreDepth: getOrCreateParam('node_bore_depth', '40mm', 'mm', 'Tiefe der Knoten-Bohrungen vom Zentrum (40mm)'),
    nodeFilletRadius: getOrCreateParam('node_fillet_radius', '30mm', 'mm', 'Radius fuer die Tetrapod-Knotenabrundung (30mm)'),
    innerNodeFilletRadius: getOrCreateParam('inner_node_fillet_radius', '2mm', 'mm', 'Radius fuer die inneren 6 Knoten-Kanten (2mm)'),
    joinNodes: getOrCreateParam('join_nodes', '1', '', 'Knoten zu einem Gesamtkörper verschmelzen (1 = Ja, 0 = Nein)')
  };
}

/**
 * Erstellt einen einzelnen, vollständig bearbeiteten Tetrapoden-Knoten im Ursprung (0,0,0).
 * Führt alle geometrischen Operationen (Hohlkugel, 4-Wege Bohrung, Außen- und Innenverrundungen)
 * im lokalen Raum durch.
 */
function buildSingleTetrapodNode(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>,
  nodeName: string
): adsk.fusion.BRepBody {
  // 1. Roh-Tetrapod mit 4 Armen im Ursprung erzeugen
  let nodeBody = createTetrapod(rootComp, params);
  nodeBody.name = nodeName;

  // 2. Kugel aus dem Zentrum ausschneiden (Zentralknoten hohl machen)
  cutInnerSphere(rootComp, nodeBody, params.innerBallDiameter);
  nodeBody = getLiveBody(rootComp, nodeBody);

  // 3. In die 4 tetrahedralen Richtungen vom Zentrum bohren (43mm x 40mm)
  nodeBody = drillNodeBores(rootComp, nodeBody, params);

  // 4. Äußere Knoten-Schnittkanten abrunden (6 Kanten um das Zentrum mit 51.514 mm Länge, 30mm Fillet)
  applyNodeFillets(rootComp, nodeBody, params);
  nodeBody = getLiveBody(rootComp, nodeBody);

  // 5. Innere Knoten-Schnittkanten abrunden (6 Kanten um das Zentrum mit 2mm Fillet)
  applyInnerNodeFillets(rootComp, nodeBody, params);
  nodeBody = getLiveBody(rootComp, nodeBody);

  nodeBody.name = nodeName;
  return nodeBody;
}

/**
 * Erstellt einen Arm des Tetrapoden als durchgehende Röhre (OD 48mm, ID 43mm, Länge 40mm in -Z).
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
  const distanceExtent = '-arm_depth_long'; // Negative Richtung entlang der Z-Achse
  extInputRing.setDistanceExtent(false, adsk.core.ValueInput.createByString(distanceExtent));
  return extrudeFeatures.add(extInputRing).bodies.item(0);
}

/**
 * Orchestriert den Zusammenbau des einzelnen Tetrapoden.
 * Erzeugt 4 Arme im tetraedrischen Winkel.
 * - Arm 0 liegt auf der -Z Achse (parallel zur Z-Achse).
 * - Arm 1 liegt in der XZ-Ebene bei theta (109.47°).
 * - Arm 2 & 3 im 120° / 240° Winkel um die Z-Achse.
 */
function createTetrapod(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>
): adsk.fusion.BRepBody {
  const features = rootComp.features;
  const moveFeats = features.moveFeatures;
  const tetraAngle = adsk.core.ValueInput.createByString(TETRA_ANGLE_DEG_STR);

  // Arm 0: Position -Z Achse (keine Rotation, parallel zur Z-Achse)
  const arm0Body = createLongArm(rootComp, params);

  // Arm 1: Um tetraAngle (109.47°) um Y-Achse rotieren
  const arm1Body = createLongArm(rootComp, params);
  const moveInput1 = moveFeats.createInput2(createCollection([arm1Body]));
  moveInput1.defineAsRotate(rootComp.yConstructionAxis, tetraAngle);
  moveFeats.add(moveInput1);

  // Arm 2: Um tetraAngle um Y-Achse rotieren, dann 120° um Z-Achse rotieren
  const arm2Body = createLongArm(rootComp, params);
  const moveInput2 = moveFeats.createInput2(createCollection([arm2Body]));
  const mat2 = adsk.core.Matrix3D.create();
  mat2.setToRotation(TETRA_ANGLE_RAD, adsk.core.Vector3D.create(0, 1, 0), adsk.core.Point3D.create(0, 0, 0));
  const rotZ120 = adsk.core.Matrix3D.create();
  rotZ120.setToRotation((120.0 * Math.PI) / 180.0, adsk.core.Vector3D.create(0, 0, 1), adsk.core.Point3D.create(0, 0, 0));
  mat2.transformBy(rotZ120);
  moveInput2.defineAsFreeMove(mat2);
  moveFeats.add(moveInput2);

  // Arm 3: Um tetraAngle um Y-Achse rotieren, dann 240° um Z-Achse rotieren
  const arm3Body = createLongArm(rootComp, params);
  const moveInput3 = moveFeats.createInput2(createCollection([arm3Body]));
  const mat3 = adsk.core.Matrix3D.create();
  mat3.setToRotation(TETRA_ANGLE_RAD, adsk.core.Vector3D.create(0, 1, 0), adsk.core.Point3D.create(0, 0, 0));
  const rotZ240 = adsk.core.Matrix3D.create();
  rotZ240.setToRotation((240.0 * Math.PI) / 180.0, adsk.core.Vector3D.create(0, 0, 1), adsk.core.Point3D.create(0, 0, 0));
  mat3.transformBy(rotZ240);
  moveInput3.defineAsFreeMove(mat3);
  moveFeats.add(moveInput3);

  // Alle Arme zu einem einzigen Tetrapod-Körper verschmelzen
  const toolBodies = createCollection([arm1Body, arm2Body, arm3Body]);
  const combineFeatures = features.combineFeatures;
  const combineInput = combineFeatures.createInput(arm0Body, toolBodies);
  combineInput.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation;
  combineFeatures.add(combineInput);

  return arm0Body;
}

/**
 * Schneidet eine Kugel mit dem Durchmesser innerBallDiameter direkt aus dem Zentrum (0,0,0) aus.
 */
function cutInnerSphere(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody,
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
    revolveInput.participantBodies = [targetBody];

    const angle = adsk.core.ValueInput.createByString('360 deg');
    revolveInput.setAngleExtent(false, angle);

    revolveFeatures.add(revolveInput);
  } catch (e) {
    console.log(`Zentrums-Kugelschnitt übersprungen (kein Zielkörper zum Schneiden oder bereits hohl): ${e}`);
  }
}

/**
 * Bohrt am Knoten in die 4 tetrahedralen Richtungen vom Zentrum aus mit Durchmesser (43mm) und Tiefe (40mm).
 */
function drillNodeBores(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody,
  params: ReturnType<typeof setupParameters>
): adsk.fusion.BRepBody {
  const center = adsk.core.Point3D.create(0, 0, 0);

  const boreDiamCm = params.nodeBoreDiameter.value; // 4.3 cm (43mm)
  const boreDepthCm = params.nodeBoreDepth.value;   // 4.0 cm (40mm)

  // Richtungsvektoren in lokalem Tetrapod-Koordinatensystem
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

  const armVectors = [v0, v1, v2, v3];
  let currentBody = targetBody;

  for (let armIdx = 0; armIdx < 4; armIdx++) {
    const dirVec = armVectors[armIdx];
    currentBody = cutBoreCylinder(
      rootComp,
      currentBody,
      center,
      dirVec,
      boreDiamCm,
      boreDepthCm,
      `Node_Arm_${armIdx}`
    );
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
 * Findet die 6 echten 3D-Schnittkanten eines Tetrapod-Knotens um den Mittelpunkt.
 */
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

/**
 * Selektiert die 6 Außen-Schnittkanten um das Knoten-Zentrum und führt die Knotenabrundung durch.
 */
function applyNodeFillets(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody,
  params: ReturnType<typeof setupParameters>
): void {
  const liveBody = getLiveBody(rootComp, targetBody);
  const center = adsk.core.Point3D.create(0, 0, 0);

  if (ui) {
    try {
      ui.activeSelections.clear();
    } catch (_e) { }
  }

  const edges = findNodeIntersectionEdges(liveBody, center);

  if (ui) {
    for (const edge of edges) {
      try {
        ui.activeSelections.add(edge);
      } catch (_e) { }
    }
  }

  console.log(`Step: ${edges.length} von 6 Knoten-Schnittkanten (51.514mm) selektiert.`);

  if (edges.length > 0) {
    applyFilletWithFallbacks(
      rootComp,
      edges,
      params.nodeFilletRadius.value,
      'node_fillet_radius',
      'Knotenabrundung'
    );
  }
}

/**
 * Findet die 6 inneren 3D-Schnittkanten der inneren Röhrenwände eines Tetrapod-Knotens um den Mittelpunkt.
 */
function findInnerNodeIntersectionEdges(
  targetBody: adsk.fusion.BRepBody,
  center: adsk.core.Point3D,
  innerRadiusCm: number
): adsk.fusion.BRepEdge[] {
  const candidates: { edge: adsk.fusion.BRepEdge; dist: number; lenCm: number }[] = [];

  for (let i = 0; i < targetBody.edges.count; i++) {
    const edge = targetBody.edges.item(i);
    if (!edge) continue;

    const midPoint = edge.pointOnEdge;
    if (!midPoint) continue;

    const dist = midPoint.distanceTo(center);
    if (dist < 4.8) {
      let isInnerCylinderEdge = false;
      for (let f = 0; f < edge.faces.count; f++) {
        const face = edge.faces.item(f);
        if (face && face.geometry.surfaceType === adsk.core.SurfaceTypes.CylinderSurfaceType) {
          const cyl = face.geometry as adsk.core.Cylinder;
          if (Math.abs(cyl.radius - innerRadiusCm) < 0.15) {
            isInnerCylinderEdge = true;
            break;
          }
        }
      }

      if (isInnerCylinderEdge) {
        candidates.push({ edge, dist, lenCm: edge.length });
      }
    }
  }

  candidates.sort((a, b) => a.dist - b.dist);
  return candidates.slice(0, 6).map(c => c.edge);
}

/**
 * Selektiert die 6 inneren Schnittkanten um das Knoten-Zentrum und führt die Innenabrundung mit 2mm tangential durch.
 */
function applyInnerNodeFillets(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody,
  params: ReturnType<typeof setupParameters>
): void {
  const liveBody = getLiveBody(rootComp, targetBody);
  const center = adsk.core.Point3D.create(0, 0, 0);

  const innerRadiusCm = params.ringInnerDiameter.value / 2.0;
  const edges = findInnerNodeIntersectionEdges(liveBody, center, innerRadiusCm);

  if (ui) {
    for (const edge of edges) {
      try {
        ui.activeSelections.add(edge);
      } catch (_e) { }
    }
  }

  console.log(`Innere Abrundung: ${edges.length} von 6 inneren Knoten-Schnittkanten selektiert.`);

  if (edges.length > 0) {
    applyFilletWithFallbacks(
      rootComp,
      edges,
      params.innerNodeFilletRadius.value,
      'inner_node_fillet_radius',
      'Innere Knotenabrundung (2mm)'
    );
  }
}

// =====================================================================
// POSITIONIERUNG, VERBINDUNG & AUSRICHTUNG
// =====================================================================

/**
 * Positioniert den 2. Tetrapod (Node 2, mittlerer Knoten).
 * - Verschiebt das Zentrum entlang Arm 1 von Node 1 (Abstand 2 * armLength = 80mm).
 * - Rotiert Node 2 um 180° um die Y-Achse.
 *   Dies erzeugt die 60° gestaffelte Alkan-Konformation (staggered), bei der:
 *   - Arm 1 exakt zurück zu Node 1 weist (bildet mit Node 1 Arm 1 das Verbindungsbein),
 *   - Arm 0 in +Z Richtung weist (bildet die Verbindung zu Node 3),
 *   - Arm 2 und Arm 3 gestaffelt zu den Armen von Node 1 angeordnet sind.
 *
 * @returns Das Zentrum C2 von Node 2.
 */
function positionSecondTetrapod(
  rootComp: adsk.fusion.Component,
  node2: adsk.fusion.BRepBody,
  params: ReturnType<typeof setupParameters>
): adsk.core.Point3D {
  const dirX = -Math.sin(TETRA_ANGLE_RAD);
  const dirY = 0.0;
  const dirZ = -Math.cos(TETRA_ANGLE_RAD); // cos(109.47°) = -1/3, also dirZ = +1/3

  const armLengthCm = params.armDepthLong.value;
  const distanceCm = 2.0 * armLengthCm; // 8.0 cm (80 mm)

  const center2 = adsk.core.Point3D.create(
    distanceCm * dirX,
    dirY,
    distanceCm * dirZ
  );

  // 180° Drehung um Y-Achse (entspricht gestaffelter 60° Alkan-Konformation)
  const transform = adsk.core.Matrix3D.create();
  transform.setToRotation(Math.PI, adsk.core.Vector3D.create(0, 1, 0), adsk.core.Point3D.create(0, 0, 0));

  // Verschiebung zum berechneten Zentrum C2
  const shift = adsk.core.Matrix3D.create();
  shift.translation = adsk.core.Vector3D.create(center2.x, center2.y, center2.z);
  transform.transformBy(shift);

  const moveFeatures = rootComp.features.moveFeatures;
  const moveInput = moveFeatures.createInput2(createCollection([node2]));
  moveInput.defineAsFreeMove(transform);
  moveFeatures.add(moveInput);

  return center2;
}

/**
 * Positioniert den 3. Tetrapod (Node 3, oberer Knoten).
 * - Verschiebt das Zentrum entlang Arm 0 von Node 2 (Abstand 2 * armLength = 80mm in +Z).
 * - Standard-Orientierung: Arm 0 von Node 3 weist in -Z Richtung exakt zurück zu Node 2.
 *
 * @returns Das Zentrum C3 von Node 3.
 */
function positionThirdTetrapod(
  rootComp: adsk.fusion.Component,
  node3: adsk.fusion.BRepBody,
  center2: adsk.core.Point3D,
  params: ReturnType<typeof setupParameters>
): adsk.core.Point3D {
  const armLengthCm = params.armDepthLong.value;
  const distanceCm = 2.0 * armLengthCm; // 8.0 cm (80 mm) in +Z

  const center3 = adsk.core.Point3D.create(
    center2.x,
    0.0,
    center2.z + distanceCm
  );

  // Translation zu C3 mit Standard-Orientierung
  const transform = adsk.core.Matrix3D.create();
  transform.translation = adsk.core.Vector3D.create(center3.x, center3.y, center3.z);

  const moveFeatures = rootComp.features.moveFeatures;
  const moveInput = moveFeatures.createInput2(createCollection([node3]));
  moveInput.defineAsFreeMove(transform);
  moveFeatures.add(moveInput);

  return center3;
}

/**
 * Verschmilzt die 3 Tetrapoden-Knoten (Node 1, Node 2, Node 3) zu einem Gesamtkörper,
 * sofern join_nodes aktiviert ist (Standard: 1).
 */
function combineNodes(
  rootComp: adsk.fusion.Component,
  node1: adsk.fusion.BRepBody,
  node2: adsk.fusion.BRepBody,
  node3: adsk.fusion.BRepBody,
  params: ReturnType<typeof setupParameters>
): adsk.fusion.BRepBody {
  const shouldJoin = Math.round(params.joinNodes.value) === 1;
  if (!shouldJoin) {
    console.log('Knoten bleiben als 3 separate Körper erhalten (join_nodes = 0).');
    return node1;
  }

  const liveNode1 = getLiveBody(rootComp, node1);
  const liveNode2 = getLiveBody(rootComp, node2);
  const liveNode3 = getLiveBody(rootComp, node3);

  const combineFeatures = rootComp.features.combineFeatures;
  const toolBodies = createCollection([liveNode2, liveNode3]);
  const combineInput = combineFeatures.createInput(liveNode1, toolBodies);
  combineInput.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation;
  const combineFeat = combineFeatures.add(combineInput);

  if (combineFeat && combineFeat.bodies.count > 0) {
    const res = combineFeat.bodies.item(0);
    if (res) {
      res.name = 'alkane-lamp-3x-nodes';
      return res;
    }
  }

  return getLiveBody(rootComp, node1);
}

/**
 * Richtet das fertige Modell so aus, dass es auf den beiden parallelen Beinen (an Node 1 und Node 3)
 * vertikal nach unten (-Z) auf der XY-Konstruktionsebene (Z = 0) steht.
 */
function alignModelOnParallelLegs(
  rootComp: adsk.fusion.Component,
  finalBody: adsk.fusion.BRepBody,
  params: ReturnType<typeof setupParameters>,
  separateNodes?: adsk.fusion.BRepBody[]
): adsk.fusion.BRepBody {
  const isJoined = Math.round(params.joinNodes.value) === 1;
  const armLengthCm = params.armDepthLong.value;

  // Richtungsvektor der beiden parallelen Beine an Node 1 und Node 3:
  // In der ursprünglichen Tetrapod-Definition ist Arm 2:
  // v2 = (0.5 * sin(theta), -sqrt(3)/2 * sin(theta), -cos(theta))
  const tetraAngle = TETRA_ANGLE_RAD;
  const sinTetra = Math.sin(tetraAngle);
  const cosTetra = Math.cos(tetraAngle); // -1/3

  // Wir wählen den Vektor w der beiden parallelen Beine:
  const w = adsk.core.Vector3D.create(
    0.5 * sinTetra,
    -(Math.sqrt(3) / 2.0) * sinTetra,
    -cosTetra
  );
  w.normalize();

  // Spannvektor zwischen Node 1 (0,0,0) und Node 3
  // C3 - C1 = (-2 * armLength * sinTetra, 0, (2/3 + 2) * armLength) = (-2 * L * sinTetra, 0, 8/3 * L)
  const deltaC = adsk.core.Vector3D.create(
    -2.0 * armLengthCm * sinTetra,
    0.0,
    (8.0 / 3.0) * armLengthCm
  );
  const deltaCLen = deltaC.length;

  // Orthonormale Basis für die Ziel-Ausrichtung:
  // uZ = -w (sodass w nach der Transformation exakt in -Z = (0,0,-1) zeigt)
  const uZ = adsk.core.Vector3D.create(-w.x, -w.y, -w.z);
  uZ.normalize();

  // uX = deltaC / |deltaC| (sodass die beiden Beine entlang der X-Achse angeordnet sind)
  const uX = adsk.core.Vector3D.create(deltaC.x / deltaCLen, deltaC.y / deltaCLen, deltaC.z / deltaCLen);
  uX.normalize();

  // uY = uZ x uX (rechtshändiges Orthonormalsystem)
  const uY = uZ.crossProduct(uX);
  uY.normalize();

  // Transformationsmatrix aufstellen
  const mat = adsk.core.Matrix3D.create();

  // Zeile 0 (X-Achse zentrieren)
  mat.setCell(0, 0, uX.x);
  mat.setCell(0, 1, uX.y);
  mat.setCell(0, 2, uX.z);
  mat.setCell(0, 3, -deltaCLen / 2.0);

  // Zeile 1 (Y-Achse)
  mat.setCell(1, 0, uY.x);
  mat.setCell(1, 1, uY.y);
  mat.setCell(1, 2, uY.z);
  mat.setCell(1, 3, 0.0);

  // Zeile 2 (Z-Achse: Standhöhe so, dass die beiden Bein-Stirnflächen exakt auf Z = 0 aufliegen)
  mat.setCell(2, 0, uZ.x);
  mat.setCell(2, 1, uZ.y);
  mat.setCell(2, 2, uZ.z);
  mat.setCell(2, 3, armLengthCm);

  const moveFeatures = rootComp.features.moveFeatures;
  const bodiesToMove = isJoined
    ? createCollection([getLiveBody(rootComp, finalBody)])
    : createCollection(separateNodes ? separateNodes.map(b => getLiveBody(rootComp, b)) : [getLiveBody(rootComp, finalBody)]);

  const moveInput = moveFeatures.createInput2(bodiesToMove);
  moveInput.defineAsFreeMove(mat);
  moveFeatures.add(moveInput);

  console.log('Modell erfolgreich auf die beiden parallelen Beine auf der XY-Ebene (Z = 0) aufgestellt!');
  return getLiveBody(rootComp, finalBody);
}