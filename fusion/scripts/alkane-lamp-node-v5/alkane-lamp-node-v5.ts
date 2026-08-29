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

    // 1. Parameter definieren
    const params = setupParameters(design);

    // 2. Einzelnen Tetrapod (Node 1) im Ursprung (0,0,0) erzeugen
    // (Arm 0: verläuft parallel zur Z-Achse nach unten (-Z), Arm 1-3: Tetraeder-Winkel)
    let nodeBody = createTetrapod(rootComp, params);
    nodeBody.name = 'Tetrapod_Node';

    // 3. Kugel aus dem Zentrum ausschneiden (Zentralknoten hohl machen)
    cutInnerSphere(rootComp, params.innerBallDiameter);

    // 4. In die 4 tetrahedralen Richtungen vom Zentrum bohren
    nodeBody = drillNodeBores(rootComp, nodeBody, params);

    // 5. Äußere Knoten-Schnittkanten abrunden (6 Kanten um das Zentrum mit 51.514 mm Länge)
    applyNodeFillets(rootComp, nodeBody, params);

    // 6. Innere Knoten-Schnittkanten abrunden (6 Kanten um das Zentrum mit 22.5 mm Radius, tangential)
    applyInnerNodeFillets(rootComp, nodeBody, params);

    nodeBody.name = 'tetrapod-node';
    console.log('Erfolgreich als einzelner Tetrapod-Knoten generiert!');

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
 * Ermittelt den aktuellen Live-BRepBody aus den rootComp bRepBodies.
 */
function getLiveBody(rootComp: adsk.fusion.Component, fallbackBody: adsk.fusion.BRepBody): adsk.fusion.BRepBody {
  if (rootComp.bRepBodies.count > 0) {
    const b = rootComp.bRepBodies.item(0);
    if (b) return b;
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
      p = params.add(name, adsk.core.ValueInput.createByString(valueStr), unit, description);
    } else {
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
    armDepthLong: getOrCreateParam('arm_depth_long', '40mm', 'mm', 'Armlaenge aller 4 Arme gemessen vom Zentrum'),
    ringInnerDiameter: getOrCreateParam('ring_inner_diameter', '43mm', 'mm', 'Innendurchmesser der Röhren (43mm)'),
    innerBallDiameter: getOrCreateParam('inner_ball_diameter', '44mm', 'mm', 'Durchmesser des inneren Kugelloches (44mm)'),
    nodeBoreDiameter: getOrCreateParam('node_bore_diameter', '43mm', 'mm', 'Durchmesser der Knoten-Bohrungen (43mm)'),
    nodeBoreDepth: getOrCreateParam('node_bore_depth', '40mm', 'mm', 'Tiefe der Knoten-Bohrungen vom Zentrum (40mm)'),
    nodeFilletRadius: getOrCreateParam('node_fillet_radius', '30mm', 'mm', 'Radius fuer die Tetrapod-Knotenabrundung (30mm)'),
    innerNodeFilletRadius: getOrCreateParam('inner_node_fillet_radius', '2mm', 'mm', 'Radius fuer die inneren 6 Knoten-Kanten (22.5mm)')
  };
}

/**
 * Erstellt den Arm des Tetrapoden als durchgehende Röhre (OD 48mm, ID 43mm, Länge 80mm in -Z).
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
 * Selektiert die 6 inneren Schnittkanten um das Knoten-Zentrum und führt die Innenabrundung mit 22.5mm tangential durch.
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
      'Innere Knotenabrundung (22.5mm)'
    );
  }
}