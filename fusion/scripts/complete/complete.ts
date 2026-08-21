
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

    // 2. Ersten Tetrapod (Node 1) im Ursprung (0,0,0) erzeugen
    const targetBody = createTetrapod(rootComp, params);
    targetBody.name = 'Node_1';

    // 3. Kugel aus dem Zentrum von Node 1 ausschneiden (Zentralknoten hohl machen)
    cutInnerSphere(rootComp, params.innerBallDiameter);

    // 4. Gewinde am Fussende des langen Arms von Node 1 erstellen
    addLongArmThread(rootComp, targetBody, params);

    // 5. Rohr aufbohren für Node 1
    boreOutLongArm(rootComp, params);

    // 6. Zweiten Tetrapod (Node 2) erzeugen
    const node2 = createTetrapod(rootComp, params);
    node2.name = 'Node_2';

    // Kugel, Gewinde und Bohrung für Node 2
    cutInnerSphere(rootComp, params.innerBallDiameter);
    addLongArmThread(rootComp, node2, params);
    boreOutLongArm(rootComp, params);

    // 7. Node 2 positionieren (Zentrum in XZ-Ebene, 8 cm Abstand, Achse ausgerichtet)
    positionSecondTetrapod(rootComp, node2);

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
    innerBallDiameter: getOrCreateParam('inner_ball_diameter', '42mm', 'mm', 'Durchmesser des ineren Kugelloches')
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

/**
 * Orchestriert den Zusammenbau des Tetrapoden.
 * Erzeugt einen langen Arm und drei gestufte Arme, die im tetraedrischen Winkel angeordnet werden.
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

  // Erzeuge die beiden Grundtypen von Armen
  const arm0Body = createLongArm(rootComp, params);
  const arm1Body = createSingleSteppedArm(rootComp, params);

  // Transformation: Kurzen Arm in den tetraedrischen Winkel rotieren
  // Der Winkel zwischen den Bindungen eines idealen Tetraeders beträgt arccos(-1/3) ≈ 109.47°
  const moveFeats = features.moveFeatures;
  const moveColl1 = adsk.core.ObjectCollection.create();
  moveColl1.add(arm1Body);
  const moveInput1 = moveFeats.createInput2(moveColl1);
  const tetraAngle = adsk.core.ValueInput.createByString('109.47122063449069deg');
  moveInput1.defineAsRotate(rootComp.yConstructionAxis, tetraAngle);
  moveFeats.add(moveInput1);

  // Muster: Den rotierten Arm 3-mal um die Z-Achse vervielfältigen
  const circPatterns = features.circularPatternFeatures;
  const entColl = adsk.core.ObjectCollection.create();
  entColl.add(arm1Body);
  const patternInput = circPatterns.createInput(entColl, rootComp.zConstructionAxis);
  patternInput.quantity = adsk.core.ValueInput.createByString('3');
  patternInput.totalAngle = adsk.core.ValueInput.createByString('360deg');
  const patternFeat = circPatterns.add(patternInput);

  // Alle erzeugten Körper für die finale Vereinigung (Join) sammeln
  const toolBodies = adsk.core.ObjectCollection.create();
  toolBodies.add(arm1Body);
  for (let i = 0; i < patternFeat.bodies.count; i++) {
    const b = patternFeat.bodies.item(i);
    if (b.name !== arm1Body.name) {
      toolBodies.add(b);
    }
  }

  // Alle Arme zu einem einzigen Körper verschmelzen
  const combineFeatures = features.combineFeatures;
  const combineInput = combineFeatures.createInput(arm0Body, toolBodies);
  combineInput.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation;
  combineFeatures.add(combineInput);

  // 3 Bohrungen (Löcher) in den drei kurzen Armen erzeugen
  // Jetzt auf dem verschmolzenen Körper (arm0Body)
  addShortArmHoles(rootComp, arm0Body, params.holeDiameter);

  return arm0Body;
}

/**
 * Fügt Bohrungen in die drei kurzen Arme ein.
 * Realisiert durch eine Bohrung im ersten Arm und anschließende kreisförmige Anordnung des Features.
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param armBody Einer der kurzen Arme (Referenz für die Geometrie).
 * @param holeDiameterParam Der Parameter für den Bohrungsdurchmesser.
 */
function addShortArmHoles(
  rootComp: adsk.fusion.Component,
  armBody: adsk.fusion.BRepBody,
  holeDiameterParam: adsk.fusion.UserParameter
): void {
  const sketches = rootComp.sketches;
  const features = rootComp.features;

  // 1. Stirnflächen der kleinen Arme selektieren
  // Wir suchen die 3 Planarflächen, die am weitesten vom Zentrum entfernt sind und NICHT der lange Arm sind
  // Der lange Arm geht in -Z Richtung.
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

      // Nur Flächen betrachten, die deutlich über dem Ende des langen Arms liegen (Z > -1cm)
      if (faceCenter.z > -1.0) {
        const dist = faceCenter.distanceTo(centerPoint);
        // Die Stirnflächen der kurzen Arme sind ca. 35mm (3.5cm) vom Zentrum entfernt
        if (dist > 3.0) {
          faces.push(face);
        }
      }
    }
  }

  // Wir erwarten 3 Flächen. Falls die Logik oben mehr/weniger findet, sortieren wir nach Distanz.
  faces.sort((a, b) => {
    const da = a.boundingBox.minPoint.distanceTo(centerPoint);
    const db = b.boundingBox.minPoint.distanceTo(centerPoint);
    return db - da;
  });

  // Nur die Top 3 nehmen
  const targetFaces = faces.slice(0, 3);

  for (const face of targetFaces) {
    // 2. Skizze auf der Stirnfläche erstellen
    const sketch = sketches.add(face);

    // 3. Zentrischen Kreis erstellen
    // Da die Skizze auf der Fläche liegt, ist (0,0,0) in Skizzenkoordinaten das Zentrum der Fläche,
    // falls die Fläche kreisförmig ist und Fusion das so ausrichtet.
    // Sicherer ist es, den Mittelpunkt der Geometrie zu nehmen.
    sketch.sketchCurves.sketchCircles.addByCenterRadius(
      adsk.core.Point3D.create(0, 0, 0),
      holeDiameterParam.value / 2.0
    );

    // 4. Extrudieren mit -40mm (Schnitt-Operation)
    if (sketch.profiles.count === 0) continue;

    // Wir suchen das Profil mit der kleinsten Fläche (den inneren Kreis)
    // Wir vergleichen die Fläche mit der erwarteten Fläche des Kreises (PI * r^2)
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
 * Erstellt ein Innengewinde am Fussende der leeren Röhre des grossen (langen) Arms.
 * Aufgabe: M40x2.5, H6, rechts, Länge: 20mm, plus Toleranzweite -0.1mm.
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param armBody Der kombinierte Tetrapod-Körper.
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

        // Positions-Check (untere Hälfte des Tetrapoden und zentrisch zur Z-Achse)
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

  // // 2. Gewinde-Parameter definieren (M40x2.5, H6)
  // const threadType = "ISO Metric Profile";
  // const designator = "M40x2.5";
  // const threadClass = "6H";
  //
  // const threadInfo = threadFeatures.createThreadInfo(true, threadType, designator, threadClass);
  //
  // // 3. Thread-Feature erstellen
  // const threadInput = threadFeatures.createInput(targetFace, threadInfo);
  // threadInput.isFullLength = false;
  // threadInput.isModeled = true; // Modelliert für die physische Toleranzanpassung
  //
  // // Dynamische Berechnung des Offsets am Fussende
  // const bbox = targetFace.boundingBox;
  // const faceHeight = Math.abs(bbox.maxPoint.z - bbox.minPoint.z);
  // const threadLengthCm = 2.0; // 20mm
  // let offsetCm = faceHeight - threadLengthCm;
  // if (offsetCm < 0) offsetCm = 0;
  //
  // threadInput.threadOffset = adsk.core.ValueInput.createByReal(offsetCm);
  // threadInput.threadLength = adsk.core.ValueInput.createByReal(threadLengthCm);
  //
  // const threadFeature = threadFeatures.add(threadInput);
  // if (!threadFeature) {
  //   if (ui) ui.messageBox("Fehler beim Erstellen des Gewinde-Features.");
  //   return;
  // }
  //
  // // 4. Gewinde weiten (Toleranzberücksichtigung durch Drücken/Ziehen)
  // const facesToOffset: adsk.fusion.BRepFace[] = [];
  // for (let i = 0; i < threadFeature.faces.count; i++) {
  //   const f = threadFeature.faces.item(i);
  //   if (f) {
  //     facesToOffset.push(f);
  //   }
  // }
  //
  // if (facesToOffset.length > 0) {
  //   const offsetFeatures = features.offsetFacesFeatures;
  //   const offsetInput = offsetFeatures.createInput(
  //     facesToOffset,
  //     adsk.core.ValueInput.createByString("-0.1mm")
  //   );
  //   if (offsetInput) {
  //     offsetFeatures.add(offsetInput);
  //   }
  // }
}

/**
 * Bohrt das restliche Rohr des langen Arms vom Gewinde bis zum Ursprung auf.
 * Ziel: 41mm Durchmesser, Tiefe -60mm ab 60mm vom Zentrum.
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param params Die Benutzerparameter.
 */
function boreOutLongArm(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>
): void {
  const constructionPlanes = rootComp.constructionPlanes;
  const planeInput = constructionPlanes.createInput();

  // Ebene orthogonal zur Z-Achse bei -60mm (6.0 cm)
  const offsetValue = adsk.core.ValueInput.createByReal(-6.0);
  planeInput.setByOffset(rootComp.xYConstructionPlane, offsetValue);
  const offsetPlane = constructionPlanes.add(planeInput);

  const sketches = rootComp.sketches;
  const sketch = sketches.add(offsetPlane);

  // Kreis mit 41mm Durchmesser (Radius 20.05 cm)
  const diameterCm = 4.1;
  sketch.sketchCurves.sketchCircles.addByCenterRadius(
    adsk.core.Point3D.create(0, 0, 0),
    diameterCm / 2.0
  );

  if (sketch.profiles.count === 0) return;
  const profile = sketch.profiles.item(0);

  // Extrusion (Cut) 60mm nach innen (Richtung Ursprung)
  const extrudeFeatures = rootComp.features.extrudeFeatures;
  const extInput = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation);
  extInput.setDistanceExtent(false, adsk.core.ValueInput.createByReal(6.0));

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
): void {
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
}