import { adsk } from "@adsk/fusion";

const app = adsk.core.Application.get();
const ui = app ? app.userInterface : null;

/** Geometrische Toleranz für Such- und Prüfaufgaben (in cm). */
const TOL = 0.05; // 0.5 mm in cm

/**
 * Hauptfunktion (Orchestrator):
 * Erzeugt ausschließlich die untere Baugruppe (Basis-Platte mit Kabelkanal,
 * geneigtem Fußbein und oberem Anschluss-Steckzapfen).
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

    // 1. Parameter definieren
    const params = setupParameters(design);

    // 2. Basis-Platte: Runder Grundkörper (XY-Ebene) + Verrundung der oberen Kante
    const baseBody = createBasePlate(rootComp, params);

    // 3. Geneigte Bein-Achse: Referenzskizze auf der XZ-Ebene (Konstruktionslinie)
    const legAxis = createLegAxis(rootComp, params);

    // 4. Rechtwinklige Konstruktionsebene am oberen Endpunkt der Bein-Achse (Plane Along Path)
    const tiltedPlane = createTiltedConstructionPlane(rootComp, legAxis);

    // 5. Röhrenkörper: Außenzylinder nach unten bis zur Platte extrudieren und verschmelzen
    const legTube = createLegTube(rootComp, params, tiltedPlane, legAxis, baseBody);

    // 6. Oberer Anschluss-Steckzapfen (Stufenabsatz auf ringInnerDiameter zurückspringen)
    cutStepShoulder(rootComp, params, legTube.sketch, legTube.body, legAxis);

    // 7. Übergangsverrundung an der Verschneidungskante zwischen Bein und Basis-Platte
    filletLegPlateJunction(rootComp, params, legTube.body, legAxis);

    // 8. Durchgehende Innenbohrung entlang der Beinachse freischneiden
    boreLegHole(rootComp, params, tiltedPlane, legTube.body, legAxis);

    // 9. Unterseite bündig schneiden (Überstand unterhalb Z = 0 abtrennen)
    trimBottomFlush(rootComp, params);

    // 10. Kabelkanal mit Fase an der Unterseite / im Plattenbereich einbringen
    createCableHole(rootComp, params, legTube.body);

    // Zielkörper benennen
    const targetBody = getLiveBody(rootComp, legTube.body);
    targetBody.name = 'Plate_Foot';

    console.log('Baugruppe Plate_Foot erfolgreich generiert!');

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
  if (rootComp.bRepBodies.count > 0) {
    const b = rootComp.bRepBodies.item(0);
    if (b) return b;
  }
  return fallbackBody;
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
 * Wendet eine Verrundung (Fillet) mit mehrstufigem Fallback-Versuchssystem auf eine Kanten-Gruppe an.
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
// PARAMETER SETUP
// =====================================================================

/**
 * Richtet die Benutzerparameter für die untere Baugruppe in Fusion 360 ein.
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
        // Parameter konnte nicht aktualisiert werden
      }
    }
    return p;
  }

  return {
    basePlateDiameter: getOrCreateParam('base_plate_diameter', '160mm', 'mm', 'Durchmesser der runden Basis-Platte'),
    basePlateHeight: getOrCreateParam('base_plate_height', '10mm', 'mm', 'Höhe der runden Basis-Platte'),
    basePlateRounding: getOrCreateParam('base_plate_rounding', '2mm', 'mm', 'Abrundung der oberen Basis-Platte-Kante'),
    legOuterDiameter: getOrCreateParam('arm_outer_diameter', '48mm', 'mm', 'Aussendurchmesser des Fußbeines'),
    ringInnerDiameter: getOrCreateParam('ring_inner_diameter', '43mm', 'mm', 'Aussendurchmesser des oberen Anschluss-Steckzapfens'),
    ringExtrudeDepth: getOrCreateParam('ring_extrude_depth', '17mm', 'mm', 'Länge des oberen Anschluss-Steckzapfens / Stufenabsatzes'),
    footLegBoreDiameter: getOrCreateParam('foot_leg_bore_diameter', '34mm', 'mm', 'Innendurchmesser des Beins / Kabeldurchführung (34mm)'),
    legLength: getOrCreateParam('leg_length', '100mm', 'mm', 'Länge des Beins von der Basis-Platte zum oberen Anschluss'),
    legAngle: getOrCreateParam('leg_angle', '115deg', 'deg', 'Winkel des Beines zur Basis-Platte'),
    legOffset: getOrCreateParam('leg_offset', '25mm', 'mm', 'Abstand des Bein-Fußpunktes vom Plattenmittelpunkt'),
    legPlateRounding: getOrCreateParam('leg_plate_rounding', '4mm', 'mm', 'Abrundung der Kante zwischen Bein und Basis-Platte'),
    cableHoleOffset: getOrCreateParam('cable_hole_offset', '90mm', 'mm', 'Versatz der Kabelkanal-Konstruktionsebene'),
    cableHoleDepth: getOrCreateParam('cable_hole_depth', '70mm', 'mm', 'Schnitttiefe des Kabelkanals (70mm)'),
    cableHoleDiameter: getOrCreateParam('cable_hole_diameter', '7mm', 'mm', 'Durchmesser des Kabelkanallochs'),
    cableHoleHeight: getOrCreateParam('cable_hole_height', '5.0mm', 'mm', 'Höhe des Kabelkanallochs über der Unterseite'),
    cableHoleChamfer: getOrCreateParam('cable_hole_chamfer', '0.7mm', 'mm', 'Abfasung der Lochkanten des Kabelkanals')
  };
}

type Params = ReturnType<typeof setupParameters>;

/**
 * Geometrische Eckdaten der geneigten Beinachse.
 */
interface LegAxis {
  start: adsk.core.Point3D;
  end: adsk.core.Point3D;
  dir: { x: number; y: number; z: number };
  line: adsk.fusion.SketchLine;
}

/**
 * Ergebnis der Bein-Röhren-Erstellung.
 */
interface LegTubeResult {
  body: adsk.fusion.BRepBody;
  sketch: adsk.fusion.Sketch;
}

// =====================================================================
// GEOMETRIE-ERZEUGUNG
// =====================================================================

/**
 * 1. Basis-Platte: Runder Grundkörper auf der XY-Ebene mit Verrundung der oberen Kante.
 */
function createBasePlate(rootComp: adsk.fusion.Component, params: Params): adsk.fusion.BRepBody {
  const center = adsk.core.Point3D.create(0, 0, 0);
  const sketch = rootComp.sketches.add(rootComp.xYConstructionPlane);

  sketch.sketchCurves.sketchCircles.addByCenterRadius(center, params.basePlateDiameter.value / 2.0);

  if (sketch.profiles.count === 0) {
    throw new Error('Kein Profil in der Basis-Platten-Skizze gefunden.');
  }
  const profile = sketch.profiles.item(0);

  const extInput = rootComp.features.extrudeFeatures.createInput(
    profile,
    adsk.fusion.FeatureOperations.NewBodyFeatureOperation
  );
  extInput.setDistanceExtent(false, adsk.core.ValueInput.createByString('base_plate_height'));
  const extFeature = rootComp.features.extrudeFeatures.add(extInput);
  if (!extFeature || extFeature.bodies.count === 0) {
    throw new Error('Basis-Platte konnte nicht extrudiert werden.');
  }

  const plateBody = extFeature.bodies.item(0);

  // Verrundung der oberen umlaufenden Kante (bei Z = base_plate_height)
  const topEdge = findCircularEdgeAtZ(plateBody, params.basePlateHeight.value, params.basePlateDiameter.value / 2.0);
  if (topEdge) {
    applyFilletWithFallbacks(
      rootComp,
      [topEdge],
      params.basePlateRounding.value,
      'base_plate_rounding',
      'Basis-Platte Obere Kante'
    );
  }

  return plateBody;
}

/**
 * Findet die umlaufende Kante auf einer bestimmten Z-Höhe anhand des Radius.
 */
function findCircularEdgeAtZ(body: adsk.fusion.BRepBody, z: number, radius: number): adsk.fusion.BRepEdge | null {
  const expectedLength = 2.0 * Math.PI * radius;
  for (let i = 0; i < body.edges.count; i++) {
    const edge = body.edges.item(i);
    if (!edge) continue;

    const bb = edge.boundingBox;
    if (!bb) continue;

    if (Math.abs(bb.minPoint.z - z) <= TOL && Math.abs(bb.maxPoint.z - z) <= TOL) {
      if (Math.abs(edge.length - expectedLength) <= Math.max(0.1, expectedLength * 0.05)) {
        return edge;
      }
    }
  }
  return null;
}

/**
 * 2. Geneigte Bein-Achse: Referenzskizze auf der XZ-Ebene.
 */
function createLegAxis(rootComp: adsk.fusion.Component, params: Params): LegAxis {
  const angleRad = params.legAngle.value;
  const dir = { x: Math.cos(angleRad), y: 0, z: Math.sin(angleRad) };
  const legLen = params.legLength.value;
  const offset = params.legOffset.value;

  const start = adsk.core.Point3D.create(offset, 0, 0);
  const end = adsk.core.Point3D.create(offset + legLen * dir.x, legLen * dir.y, legLen * dir.z);

  const sketch = rootComp.sketches.add(rootComp.xZConstructionPlane);
  const startSketch = sketch.modelToSketchSpace(start);
  const endSketch = sketch.modelToSketchSpace(end);

  const line = sketch.sketchCurves.sketchLines.addByTwoPoints(startSketch, endSketch);
  line.isConstruction = true;

  return { start, end, dir, line };
}

/**
 * 3. Rechtwinklige Konstruktionsebene am oberen Endpunkt der Bein-Achse ("Plane Along Path").
 */
function createTiltedConstructionPlane(
  rootComp: adsk.fusion.Component,
  legAxis: LegAxis
): adsk.fusion.ConstructionPlane {
  const planes = rootComp.constructionPlanes;

  // Primär: Ebene entlang der Pfadlinie am Bein-Kopf (Endpunkt, distance = 1.0)
  const input = planes.createInput();
  if (input) {
    if (input.setByDistanceOnPath(legAxis.line, adsk.core.ValueInput.createByReal(1.0))) {
      const plane = planes.add(input);
      if (plane) return plane;
    }
  }

  // Fallback: Ebene durch 3 Punkte
  const sketch = legAxis.line.parentSketch;
  const endPt = legAxis.line.endSketchPoint;
  const sketchPoints = sketch ? sketch.sketchPoints : null;
  const p1 = sketchPoints ? sketchPoints.add(adsk.core.Point3D.create(legAxis.end.x, legAxis.end.y + 1.0, legAxis.end.z)) : null;
  const p2 = sketchPoints ? sketchPoints.add(adsk.core.Point3D.create(legAxis.end.x + legAxis.dir.z, legAxis.end.y, legAxis.end.z - legAxis.dir.x)) : null;

  const fallback = planes.createInput();
  if (fallback && p1 && p2 && endPt && fallback.setByThreePoints(endPt, p1, p2)) {
    const plane = planes.add(fallback);
    if (plane) return plane;
  }

  throw new Error('Geneigte Konstruktionsebene am Beinkopf konnte nicht erstellt werden.');
}

/**
 * 4. Äußerer Bein-Röhrenkörper:
 *    - Skizze auf der geneigten Konstruktionsebene mit Außenkreis (legOuterDiameter) und Innenkreis (ringInnerDiameter)
 *    - Extrusion nach unten bis zur Basis-Platte und Vereinigung per Join
 */
function createLegTube(
  rootComp: adsk.fusion.Component,
  params: Params,
  tiltedPlane: adsk.fusion.ConstructionPlane,
  _legAxis: LegAxis,
  baseBody: adsk.fusion.BRepBody
): LegTubeResult {
  const outerRadius = params.legOuterDiameter.value / 2.0;
  const innerRadius = params.ringInnerDiameter.value / 2.0;

  const sketch = rootComp.sketches.add(tiltedPlane);
  const centerPoint = adsk.core.Point3D.create(0, 0, 0);

  // Zuerst Außenkreis zeichnen
  sketch.sketchCurves.sketchCircles.addByCenterRadius(centerPoint, outerRadius);

  if (sketch.profiles.count < 1) {
    throw new Error('Erwartetes Profil in der Bein-Skizze nicht gefunden.');
  }

  const legBody = extrudeAlongAxisDown(rootComp, sketch, params);

  // Anschließend inneren Kreis für den Steckzapfen-Stufenabsatz hinzufügen
  sketch.sketchCurves.sketchCircles.addByCenterRadius(centerPoint, innerRadius);

  // Mit der Basis-Platte kombinieren (Join)
  const combined = joinBodies(rootComp, baseBody, [legBody]);

  return { body: combined, sketch };
}

/**
 * Extrudiert den vollen Außenzylinder entlang der Beinachse nach unten in die Basis-Platte.
 */
function extrudeAlongAxisDown(
  rootComp: adsk.fusion.Component,
  sketch: adsk.fusion.Sketch,
  params: Params
): adsk.fusion.BRepBody {
  const extrudeFeatures = rootComp.features.extrudeFeatures;
  const targetZ = params.basePlateHeight.value;

  let profileArg: adsk.core.Base;
  if (sketch.profiles.count === 1) {
    profileArg = sketch.profiles.item(0)!;
  } else {
    const profileColl = adsk.core.ObjectCollection.create();
    for (let i = 0; i < sketch.profiles.count; i++) {
      const prof = sketch.profiles.item(i);
      if (prof) profileColl.add(prof);
    }
    profileArg = profileColl;
  }

  const totalDistReal = params.legLength.value + params.basePlateHeight.value + 2.0;

  const strategies: Array<{ name: string; run: () => adsk.fusion.ExtrudeFeature | null }> = [
    {
      name: "Positiv-String ('leg_length + base_plate_height')",
      run: () => {
        const input = extrudeFeatures.createInput(profileArg, adsk.fusion.FeatureOperations.NewBodyFeatureOperation);
        const dist = adsk.core.ValueInput.createByString('leg_length + base_plate_height');
        if (input && dist) {
          input.setDistanceExtent(false, dist);
          return extrudeFeatures.add(input);
        }
        return null;
      }
    },
    {
      name: "Reale Distanz positiv",
      run: () => {
        const input = extrudeFeatures.createInput(profileArg, adsk.fusion.FeatureOperations.NewBodyFeatureOperation);
        const dist = adsk.core.ValueInput.createByReal(totalDistReal);
        if (input && dist) {
          input.setDistanceExtent(false, dist);
          return extrudeFeatures.add(input);
        }
        return null;
      }
    },
    {
      name: "Negativ-String ('-leg_length - base_plate_height')",
      run: () => {
        const input = extrudeFeatures.createInput(profileArg, adsk.fusion.FeatureOperations.NewBodyFeatureOperation);
        const dist = adsk.core.ValueInput.createByString('-leg_length - base_plate_height');
        if (input && dist) {
          input.setDistanceExtent(false, dist);
          return extrudeFeatures.add(input);
        }
        return null;
      }
    },
    {
      name: "Reale Distanz negativ",
      run: () => {
        const input = extrudeFeatures.createInput(profileArg, adsk.fusion.FeatureOperations.NewBodyFeatureOperation);
        const dist = adsk.core.ValueInput.createByReal(-1.0 * totalDistReal);
        if (input && dist) {
          input.setDistanceExtent(false, dist);
          return extrudeFeatures.add(input);
        }
        return null;
      }
    }
  ];

  for (const strat of strategies) {
    try {
      const extFeature = strat.run();
      if (extFeature && extFeature.bodies.count > 0) {
        const body = extFeature.bodies.item(0);
        if (body) {
          const minZ = body.boundingBox.minPoint.z;
          if (minZ < targetZ + TOL) {
            return body;
          }
        }
        extFeature.deleteMe();
      } else if (extFeature) {
        extFeature.deleteMe();
      }
    } catch (_err) {
      // Nächste Strategie testen
    }
  }

  throw new Error('Extrusion des Fußbeins in Richtung der Basis-Platte ist fehlgeschlagen.');
}

/**
 * Kombiniert Werkzeugkörper mit dem Zielkörper per Join.
 */
function joinBodies(
  rootComp: adsk.fusion.Component,
  target: adsk.fusion.BRepBody,
  tools: adsk.fusion.BRepBody[]
): adsk.fusion.BRepBody {
  const toolColl = adsk.core.ObjectCollection.create();
  for (const t of tools) {
    toolColl.add(t);
  }
  const combineInput = rootComp.features.combineFeatures.createInput(target, toolColl);
  combineInput.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation;
  const combineFeature = rootComp.features.combineFeatures.add(combineInput);
  if (!combineFeature) {
    throw new Error('Körper konnten nicht per Join vereinigt werden.');
  }
  return target;
}

/**
 * 5. Oberer Anschluss-Steckzapfen:
 *    Schneidet das äußere Ring-Profil am oberen Ende um ringExtrudeDepth zurück,
 *    sodass der zylindrische Steckzapfen mit ringInnerDiameter stehen bleibt.
 */
function cutStepShoulder(
  rootComp: adsk.fusion.Component,
  params: Params,
  sketch: adsk.fusion.Sketch,
  body: adsk.fusion.BRepBody,
  legAxis: LegAxis
): void {
  const innerRadius = params.ringInnerDiameter.value / 2.0;
  const extrudeFeatures = rootComp.features.extrudeFeatures;

  // Ring-Profil in der Bein-Skizze suchen (2 Loops)
  let ringProfile: adsk.fusion.Profile | null = null;
  for (let i = 0; i < sketch.profiles.count; i++) {
    const prof = sketch.profiles.item(i);
    if (prof && prof.profileLoops.count === 2) {
      ringProfile = prof;
      break;
    }
  }

  if (!ringProfile) {
    throw new Error('Ring-Profil für den oberen Anschluss-Steckzapfen nicht gefunden.');
  }

  const depthReal = params.ringExtrudeDepth.value;

  const strategies: Array<() => adsk.fusion.ExtrudeFeature | null> = [
    () => {
      const input = extrudeFeatures.createInput(ringProfile!, adsk.fusion.FeatureOperations.CutFeatureOperation);
      const dist = adsk.core.ValueInput.createByString('-ring_extrude_depth');
      if (input && dist) {
        input.setDistanceExtent(false, dist);
        return extrudeFeatures.add(input);
      }
      return null;
    },
    () => {
      const input = extrudeFeatures.createInput(ringProfile!, adsk.fusion.FeatureOperations.CutFeatureOperation);
      const dist = adsk.core.ValueInput.createByReal(-1.0 * depthReal);
      if (input && dist) {
        input.setDistanceExtent(false, dist);
        return extrudeFeatures.add(input);
      }
      return null;
    },
    () => {
      const input = extrudeFeatures.createInput(ringProfile!, adsk.fusion.FeatureOperations.CutFeatureOperation);
      const dist = adsk.core.ValueInput.createByString('ring_extrude_depth');
      if (input && dist) {
        input.setDistanceExtent(false, dist);
        return extrudeFeatures.add(input);
      }
      return null;
    },
    () => {
      const input = extrudeFeatures.createInput(ringProfile!, adsk.fusion.FeatureOperations.CutFeatureOperation);
      const dist = adsk.core.ValueInput.createByReal(depthReal);
      if (input && dist) {
        input.setDistanceExtent(false, dist);
        return extrudeFeatures.add(input);
      }
      return null;
    }
  ];

  for (const strat of strategies) {
    try {
      const cutFeature = strat();
      if (cutFeature) {
        if (hasCylinderOfRadius(body, innerRadius, legAxis.dir)) {
          return;
        }
        cutFeature.deleteMe();
      }
    } catch (_err) {
      // Nächste Strategie testen
    }
  }

  throw new Error('Oberer Anschluss-Steckzapfen (Stufenabsatz) konnte nicht erzeugt werden.');
}

/**
 * Prüft, ob der Körper eine Zylinderfläche mit dem gesuchten Radius trägt.
 */
function hasCylinderOfRadius(
  body: adsk.fusion.BRepBody,
  radius: number,
  axisDir?: { x: number; y: number; z: number }
): boolean {
  for (let i = 0; i < body.faces.count; i++) {
    const face = body.faces.item(i);
    if (!face || face.geometry.surfaceType !== adsk.core.SurfaceTypes.CylinderSurfaceType) continue;

    const surf = face.geometry as unknown as {
      radius?: number;
      axis?: { direction?: { x: number; y: number; z: number } };
    };

    if (surf.radius === undefined || Math.abs(surf.radius - radius) > TOL) {
      continue;
    }
    if (axisDir) {
      const d = surf.axis && surf.axis.direction;
      if (d) {
        const dot = Math.abs(d.x * axisDir.x + d.y * axisDir.y + d.z * axisDir.z);
        if (dot < 0.99) continue;
      }
    }
    return true;
  }
  return false;
}

/**
 * 6. Übergangsverrundung (Fillet) an der Verschneidungskante zwischen Bein und Basis-Platte.
 */
function filletLegPlateJunction(
  rootComp: adsk.fusion.Component,
  params: Params,
  body: adsk.fusion.BRepBody,
  _legAxis: LegAxis
): void {
  const plateTopZ = params.basePlateHeight.value;
  const legOuterRadius = params.legOuterDiameter.value / 2.0;
  const expectedLen = 2.0 * Math.PI * legOuterRadius;

  const edges: adsk.fusion.BRepEdge[] = [];
  for (let i = 0; i < body.edges.count; i++) {
    const edge = body.edges.item(i);
    if (!edge) continue;

    const bb = edge.boundingBox;
    if (!bb) continue;

    if (Math.abs(bb.minPoint.z - plateTopZ) <= TOL && Math.abs(bb.maxPoint.z - plateTopZ) <= TOL) {
      if (Math.abs(edge.length - expectedLen) <= Math.max(0.5, expectedLen * 0.4)) {
        edges.push(edge);
      }
    }
  }

  if (edges.length > 0) {
    applyFilletWithFallbacks(
      rootComp,
      edges,
      params.legPlateRounding.value,
      'leg_plate_rounding',
      'Leg-Plate Junction'
    );
  }
}

/**
 * 7. Durchgehende Innenbohrung:
 *    Skizze auf der oberen geneigten Konstruktionsebene mit footLegBoreDiameter
 *    als durchgehender Schnitt (Cut) entlang der Beinachse.
 */
function boreLegHole(
  rootComp: adsk.fusion.Component,
  params: Params,
  tiltedPlane: adsk.fusion.ConstructionPlane,
  body: adsk.fusion.BRepBody,
  legAxis: LegAxis
): void {
  const holeRadius = params.footLegBoreDiameter.value / 2.0;

  const sketch = rootComp.sketches.add(tiltedPlane);
  const centerPoint = adsk.core.Point3D.create(0, 0, 0);
  sketch.sketchCurves.sketchCircles.addByCenterRadius(centerPoint, holeRadius);

  if (sketch.profiles.count < 1) {
    throw new Error('Kein Profil für die Innenbohrung gefunden.');
  }
  const profile = sketch.profiles.item(0);

  const extrudeFeatures = rootComp.features.extrudeFeatures;
  const totalDistReal = params.legLength.value + params.basePlateHeight.value + 5.0;

  const strategies: Array<() => adsk.fusion.ExtrudeFeature | null> = [
    () => {
      const input = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation);
      const dist = adsk.core.ValueInput.createByString('-leg_length - base_plate_height - 50mm');
      if (input && dist) {
        input.setDistanceExtent(false, dist);
        return extrudeFeatures.add(input);
      }
      return null;
    },
    () => {
      const input = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation);
      const dist = adsk.core.ValueInput.createByReal(-1.0 * totalDistReal);
      if (input && dist) {
        input.setDistanceExtent(false, dist);
        return extrudeFeatures.add(input);
      }
      return null;
    },
    () => {
      const input = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation);
      const dist = adsk.core.ValueInput.createByString('leg_length + base_plate_height + 50mm');
      if (input && dist) {
        input.setDistanceExtent(false, dist);
        return extrudeFeatures.add(input);
      }
      return null;
    },
    () => {
      const input = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation);
      const dist = adsk.core.ValueInput.createByReal(totalDistReal);
      if (input && dist) {
        input.setDistanceExtent(false, dist);
        return extrudeFeatures.add(input);
      }
      return null;
    }
  ];

  for (const strat of strategies) {
    try {
      const cutFeature = strat();
      if (cutFeature) {
        if (hasCylinderOfRadius(body, holeRadius, legAxis.dir)) {
          return;
        }
        cutFeature.deleteMe();
      }
    } catch (_err) {
      // Nächste Strategie testen
    }
  }

  throw new Error('Durchgehende Innenbohrung des Fußbeins konnte nicht erzeugt werden.');
}

/**
 * 8. Unterseite bündig schneiden:
 *    Schneidet alle Geometrieüberstände unterhalb der XY-Ebene (Z < 0) ab.
 */
function trimBottomFlush(rootComp: adsk.fusion.Component, params: Params): void {
  const sketch = rootComp.sketches.add(rootComp.xYConstructionPlane);
  const center = adsk.core.Point3D.create(0, 0, 0);

  const cutRadius = params.basePlateDiameter.value;
  sketch.sketchCurves.sketchCircles.addByCenterRadius(center, cutRadius);

  if (sketch.profiles.count === 0) return;
  const profile = sketch.profiles.item(0);

  const extrudeFeatures = rootComp.features.extrudeFeatures;
  const cutInput = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation);

  const fallbackDist = adsk.core.ValueInput.createByReal(-1.0 * (params.legLength.value + params.basePlateHeight.value));
  cutInput.setDistanceExtent(false, fallbackDist);
  try {
    extrudeFeatures.add(cutInput);
  } catch (_e) { }
}

/**
 * 9. Kabelkanal mit Fase:
 *    a) Versatzebene zur YZ-Ebene bei cableHoleOffset
 *    b) Kreis mit Durchmesser cableHoleDiameter bei Z = cableHoleHeight
 *    c) Extrusion (Cut) in das zentrale Fußbein
 *    d) Abfasung der Lochkanten mit cableHoleChamfer
 */
function createCableHole(
  rootComp: adsk.fusion.Component,
  params: Params,
  body: adsk.fusion.BRepBody
): void {
  const holeOffset = params.cableHoleOffset.value;
  const holeRadius = params.cableHoleDiameter.value / 2.0;
  const holeHeight = params.cableHoleHeight.value;

  const offsetPlane = createOffsetPlane(rootComp, rootComp.yZConstructionPlane, holeOffset);
  const sketch = rootComp.sketches.add(offsetPlane);

  const center3D = adsk.core.Point3D.create(holeOffset, 0, holeHeight);
  const centerPoint = sketch.modelToSketchSpace(center3D);
  sketch.sketchCurves.sketchCircles.addByCenterRadius(centerPoint, holeRadius);

  if (sketch.profiles.count === 0) {
    throw new Error('Profil für den Kabelkanal nicht gefunden.');
  }
  const profile = sketch.profiles.item(0);

  const extrudeFeatures = rootComp.features.extrudeFeatures;
  const cutInput = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation);

  // Extrusion in Richtung Ursprung / Fußbein (-70mm)
  let valInput = adsk.core.ValueInput.createByString('-cable_hole_depth');
  if (!valInput) {
    valInput = adsk.core.ValueInput.createByReal(-params.cableHoleDepth.value);
  }
  cutInput.setDistanceExtent(false, valInput);

  const cutFeature = extrudeFeatures.add(cutInput);
  if (!cutFeature) {
    throw new Error('Kabelkanal konnte nicht geschnitten werden.');
  }

  // Abfasung der Kabelkanalkanten
  const chamferVal = params.cableHoleChamfer.value;
  if (chamferVal > 0) {
    chamferCableHoleOpenings(rootComp, params, body);
  }
}

/**
 * Bringt eine Abfasung an den Öffnungskanten des Kabelkanals an.
 */
function chamferCableHoleOpenings(
  rootComp: adsk.fusion.Component,
  params: Params,
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
        const cyl = face.geometry as unknown as { radius?: number };
        if (cyl.radius !== undefined && Math.abs(cyl.radius - targetRadius) < 0.05) {
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
      chamferFeatures.add(chamferInput);
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
  }
}