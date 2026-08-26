import { adsk } from "@adsk/fusion";

const app = adsk.core.Application.get();
const ui = app ? app.userInterface : null;

/**
 * @file thread-m40x2_5-counternut.ts
 * @description Fusion 360 Skript zur Erzeugung einer M40x2.5 Kontermutter (Locknut)
 * mit 4mm Gesamtlänge, Außendurchmesser 46mm, abgerundeten Außenkanten und einer 
 * am Ende integrierten 85%-offenen Scheibe (34mm Öffnung).
 * Optimiert für den FDM-3D-Druck (z.B. Bambu Lab P2S) mit anpassbarem Gewindespiel.
 *
 * ## Technische CAD-Kennwerte:
 * - Nenn-Außendurchmesser (nut_outer_diameter): 46.0 mm
 * - Gesamtlänge / Nut-Dicke (nut_height): 4.0 mm
 * - Integrierte Endscheibe (disc_thickness): 1.0 mm
 * - Scheibenöffnung (disc_hole_diameter): 34.0 mm (85% des M40 Nenninnendurchmessers)
 * - Gewindebereich: M40x2.5 Innengewinde (ISO Metric Profile, 6H) über 3.0 mm Länge
 * - Gewindespiel (thread_clearance): -0.2 mm via Offset Faces für optimale FDM-Passung
 * - Abgerundete Außenkanten (outer_fillet): 0.8 mm Fillet für Haptik und Optik
 * - Gewindeeingangs-Fase (thread_chamfer): 0.5 mm Fase am Bohrungseingang
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

    // 1. Parameter definieren / abrufen
    const params = setupParameters(design);

    // 2. Kontermutter erzeugen
    const targetBody = createCounternut(rootComp, params);
    targetBody.name = 'thread-m40x2_5-counternut-4mm';

    console.log('M40x2.5 Kontermutter (4mm Länge, 46mm OD, 85% offene Endscheibe) erfolgreich erzeugt!');

  } catch (e) {
    console.error(`Failed: ${e}`);
    if (ui) {
      ui.messageBox(`Kritischer Fehler beim Erstellen der Kontermutter:\n${e}`);
    }
  }
}

/**
 * Richtet die Benutzerparameter in Fusion 360 ein oder ruft bestehende ab.
 * Ermöglicht die dynamische Steuerung der Geometrie über die Parameter-Liste.
 *
 * @param design Das aktive Fusion 360 Design-Objekt.
 * @returns Ein Objekt mit allen benutzerdefinierten UserParameters.
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
    nutOuterDiameter: getOrCreateParam('nut_outer_diameter', '46mm', 'mm', 'Außendurchmesser der Kontermutter'),
    nutHeight: getOrCreateParam('nut_height', '4mm', 'mm', 'Gesamtlänge / Höhe der Kontermutter'),
    innerDiameter: getOrCreateParam('inner_diameter', '40mm', 'mm', 'Nenn-Innendurchmesser der Gewindebohrung (M40)'),
    discThickness: getOrCreateParam('disc_thickness', '1mm', 'mm', 'Dicke der integrierten Endscheibe'),
    discHoleDiameter: getOrCreateParam('disc_hole_diameter', '34mm', 'mm', 'Innendurchmesser der Scheibenöffnung (85% von 40mm)'),
    threadClearance: getOrCreateParam('thread_clearance', '-0.2mm', 'mm', 'Gewindespiel (Drücken/Ziehen via Offset Faces)'),
    threadChamfer: getOrCreateParam('thread_chamfer', '0.5mm', 'mm', 'Fase am Gewindeeingang'),
    outerFillet: getOrCreateParam('outer_fillet', '0.8mm', 'mm', 'Abrundungsradius der äußeren Mantelkanten')
  };
}

/**
 * Erzeugt den 3D-Körper der M40x2.5 Kontermutter mit integrierter Endscheibe.
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param params Die Parameter der Kontermutter.
 * @returns Der erzeugte 3D-Körper (BRepBody).
 */
function createCounternut(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>
): adsk.fusion.BRepBody {
  const extrudeFeatures = rootComp.features.extrudeFeatures;
  const sketches = rootComp.sketches;
  const center3D = adsk.core.Point3D.create(0, 0, 0);

  // Dimensionen in Zentimetern (Fusion 360 API Standardeinheit)
  const outerRadiusCm = params.nutOuterDiameter.value / 2.0;   // 46mm / 2 = 2.3 cm
  const innerRadiusCm = params.innerDiameter.value / 2.0;      // 40mm / 2 = 2.0 cm
  const totalHeightCm = params.nutHeight.value;                 // 4mm = 0.4 cm
  const discThicknessCm = params.discThickness.value;           // 1mm = 0.1 cm
  const threadLengthCm = totalHeightCm - discThicknessCm;       // 3mm = 0.3 cm
  const discHoleRadiusCm = params.discHoleDiameter.value / 2.0; // 34mm / 2 = 1.7 cm (85% von 40mm)
  const clearanceStr = params.threadClearance.expression || '-0.2mm';

  if (threadLengthCm <= 0) {
    throw new Error('Gewindelänge muss größer als 0 sein (nut_height muss größer als disc_thickness sein).');
  }

  // 1. Skizze auf XY-Ebene für den Haupt-Gewindeabschnitt (Z = 0 bis Z = threadLengthCm)
  const sketchBase = sketches.add(rootComp.xYConstructionPlane);
  const centerBase = sketchBase.modelToSketchSpace(center3D);

  sketchBase.sketchCurves.sketchCircles.addByCenterRadius(centerBase, innerRadiusCm);
  sketchBase.sketchCurves.sketchCircles.addByCenterRadius(centerBase, outerRadiusCm);

  let baseProfile: adsk.fusion.Profile | null = null;
  for (let i = 0; i < sketchBase.profiles.count; i++) {
    const prof = sketchBase.profiles.item(i);
    if (prof && prof.profileLoops.count === 2) {
      baseProfile = prof;
      break;
    }
  }

  if (!baseProfile && sketchBase.profiles.count >= 2) {
    const p0 = sketchBase.profiles.item(0);
    const p1 = sketchBase.profiles.item(1);
    if (p0 && p1) {
      baseProfile = p0.areaProperties().area < p1.areaProperties().area ? p1 : p0;
    }
  }

  if (!baseProfile) {
    throw new Error('Ringprofil für den Gewindeabschnitt nicht gefunden.');
  }

  const extInputBase = extrudeFeatures.createInput(
    baseProfile,
    adsk.fusion.FeatureOperations.NewBodyFeatureOperation
  );
  extInputBase.setDistanceExtent(false, adsk.core.ValueInput.createByReal(threadLengthCm));

  const extFeatureBase = extrudeFeatures.add(extInputBase);
  if (!extFeatureBase || extFeatureBase.bodies.count === 0) {
    throw new Error('Erzeugung des Mutterngrundkörpers fehlgeschlagen.');
  }
  const targetBody = extFeatureBase.bodies.item(0);

  // 2. Integrierte Endscheibe (Z = threadLengthCm bis Z = totalHeightCm)
  const planeInput = rootComp.constructionPlanes.createInput();
  planeInput.setByOffset(
    rootComp.xYConstructionPlane,
    adsk.core.ValueInput.createByReal(threadLengthCm)
  );
  const discPlane = rootComp.constructionPlanes.add(planeInput);
  const sketchDisc = sketches.add(discPlane);

  const centerDisc3D = adsk.core.Point3D.create(0, 0, threadLengthCm);
  const centerDisc = sketchDisc.modelToSketchSpace(centerDisc3D);

  sketchDisc.sketchCurves.sketchCircles.addByCenterRadius(centerDisc, discHoleRadiusCm);
  sketchDisc.sketchCurves.sketchCircles.addByCenterRadius(centerDisc, outerRadiusCm);

  let discProfile: adsk.fusion.Profile | null = null;
  for (let i = 0; i < sketchDisc.profiles.count; i++) {
    const prof = sketchDisc.profiles.item(i);
    if (prof && prof.profileLoops.count === 2) {
      discProfile = prof;
      break;
    }
  }

  if (!discProfile && sketchDisc.profiles.count >= 2) {
    const p0 = sketchDisc.profiles.item(0);
    const p1 = sketchDisc.profiles.item(1);
    if (p0 && p1) {
      discProfile = p0.areaProperties().area < p1.areaProperties().area ? p1 : p0;
    }
  }

  if (!discProfile) {
    throw new Error('Profil für die Endscheibe nicht gefunden.');
  }

  const extInputDisc = extrudeFeatures.createInput(
    discProfile,
    adsk.fusion.FeatureOperations.JoinFeatureOperation
  );
  extInputDisc.setDistanceExtent(false, adsk.core.ValueInput.createByReal(discThicknessCm));
  extrudeFeatures.add(extInputDisc);

  // 3. M40x2.5 Innengewinde auf den 40mm Bohrungsabschnitt erzeugen
  addInternalThreadAndClearance(rootComp, targetBody, innerRadiusCm, clearanceStr);

  // 4. Gewindeeingangs-Fase (Z = 0)
  addEntranceChamfer(rootComp, targetBody, params.threadChamfer.value);

  // 5. Abgerundete Außenkante (Fillet) ausschließlich am Scheiben-Ende (Z = totalHeightCm) anbringen
  addOuterFilletAtDiscEnd(rootComp, targetBody, outerRadiusCm, params.outerFillet.value, totalHeightCm);

  // 6. Das gesamte Bauteil um 180 Grad drehen, sodass die Scheibe auf der XY-Ebene (Z = 0) liegt
  rotateNut180DegreesToXY(rootComp, targetBody, totalHeightCm);

  return targetBody;
}

/**
 * Erstellt das M40x2.5 Innengewinde an der 40mm Bohrungswand der Kontermutter
 * und wendet ein Gewindespiel via Offset Faces an.
 */
function addInternalThreadAndClearance(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody,
  innerRadiusCm: number,
  clearanceStr: string
): void {
  const threadFeatures = rootComp.features.threadFeatures;

  // Innere Zylinderfläche mit Radius ~ 2.0 cm (40mm Bohrung) selektieren
  let targetFace: adsk.fusion.BRepFace | null = null;
  let minDiff = Number.MAX_VALUE;

  for (let i = 0; i < targetBody.faces.count; i++) {
    const face = targetBody.faces.item(i);
    if (face && face.geometry.surfaceType === adsk.core.SurfaceTypes.CylinderSurfaceType) {
      const cyl = face.geometry as adsk.core.Cylinder;
      const diff = Math.abs(cyl.radius - innerRadiusCm);
      if (diff < minDiff) {
        minDiff = diff;
        targetFace = face;
      }
    }
  }

  if (!targetFace || minDiff > 0.05) {
    throw new Error(`Innenfläche für das Gewinde (Radius ca. ${(innerRadiusCm * 10).toFixed(1)}mm) wurde nicht gefunden.`);
  }

  // Gewinde: M40x2.5, 6H, Rechts, Metrisch, volle Länge des Bohrungsabschnitts
  const threadInfo = threadFeatures.createThreadInfo(true, "ISO Metric Profile", "M40x2.5", "6H");
  const threadInput = threadFeatures.createInput(targetFace, threadInfo);
  threadInput.isFullLength = true;
  threadInput.isModeled = true;

  const threadFeature = threadFeatures.add(threadInput);
  if (!threadFeature) {
    throw new Error('Fehler beim Erstellen des Gewinde-Features.');
  }

  // Gewindespiel anwenden (-0.2mm via Offset Faces)
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
 * Bringt eine Fase am Gewindeeingang (Z = 0) der Kontermutter an,
 * um das Ansetzen der Mutter auf das Gewinde zu erleichtern.
 */
function addEntranceChamfer(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody,
  chamferValCm: number
): void {
  if (chamferValCm <= 0) return;

  let entranceEdge: adsk.fusion.BRepEdge | null = null;

  for (let i = 0; i < targetBody.edges.count; i++) {
    const edge = targetBody.edges.item(i);
    if (edge && edge.geometry.curveType === adsk.core.Curve3DTypes.Circle3DCurveType) {
      const circ = edge.geometry as adsk.core.Circle3D;
      if (Math.abs(circ.center.z) < 0.05 && circ.radius >= 1.7 && circ.radius <= 2.15) {
        entranceEdge = edge;
        break;
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
        console.log("Gewindeeingangs-Fase am Z=0 Rand erfolgreich erstellt.");
      }
    } catch (e) {
      console.warn(`Fehler beim Erstellen der Gewindeeingangs-Fase: ${e}`);
    }
  }
}

/**
 * Erzeugt eine abgerundete Außenkante (Fillet) ausschließlich am Ende mit der Endscheibe (Z = discEndZCm).
 * Das Gewindeeingangs-Ende (Z = 0) bleibt außen ohne Abrundung (scharfe/flache Kante).
 */
function addOuterFilletAtDiscEnd(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody,
  outerRadiusCm: number,
  filletValCm: number,
  discEndZCm: number
): void {
  if (filletValCm <= 0) return;

  let discEndOuterEdge: adsk.fusion.BRepEdge | null = null;

  for (let i = 0; i < targetBody.edges.count; i++) {
    const edge = targetBody.edges.item(i);
    if (edge && edge.geometry.curveType === adsk.core.Curve3DTypes.Circle3DCurveType) {
      const circ = edge.geometry as adsk.core.Circle3D;
      if (
        Math.abs(circ.radius - outerRadiusCm) < 0.05 &&
        Math.abs(circ.center.z - discEndZCm) < 0.05
      ) {
        discEndOuterEdge = edge;
        break;
      }
    }
  }

  if (discEndOuterEdge) {
    try {
      const filletFeatures = rootComp.features.filletFeatures;
      const filletInput = filletFeatures.createInput();
      if (filletInput) {
        const edgeColl = adsk.core.ObjectCollection.create();
        edgeColl.add(discEndOuterEdge);
        let valInput = adsk.core.ValueInput.createByString('outer_fillet');
        if (!valInput) {
          valInput = adsk.core.ValueInput.createByReal(filletValCm);
        }
        filletInput.edgeSetInputs.addConstantRadiusEdgeSet(edgeColl, valInput, true);
        filletFeatures.add(filletInput);
        console.log("Außenkanten-Abrundung (Fillet am Scheiben-Ende) erfolgreich erstellt.");
      }
    } catch (e) {
      console.warn(`Fehler beim Erstellen der Außenkanten-Abrundung: ${e}`);
    }
  } else {
    console.warn("Konnte die Außenkante am Scheiben-Ende für das Fillet nicht finden.");
  }
}

/**
 * Dreht die erzeugte Kontermutter in Step 6 um 180 Grad um die X-Achse (Zentralpunkt Z = totalHeightCm / 2),
 * sodass die integrierte Endscheibe flach auf der XY-Ebene (Z = 0) zu liegen kommt.
 */
function rotateNut180DegreesToXY(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody,
  totalHeightCm: number
): void {
  try {
    const moveFeatures = rootComp.features.moveFeatures;
    const bodyColl = adsk.core.ObjectCollection.create();
    bodyColl.add(targetBody);

    const moveInput = moveFeatures.createInput2(bodyColl);
    if (!moveInput) {
      console.warn("Konnte MoveFeatureInput nicht erstellen.");
      return;
    }

    const transform = adsk.core.Matrix3D.create();
    const centerPoint = adsk.core.Point3D.create(0, 0, totalHeightCm / 2.0);
    const axisVector = adsk.core.Vector3D.create(1, 0, 0); // X-Achse
    transform.setToRotation(Math.PI, axisVector, centerPoint);

    moveInput.defineAsFreeMove(transform);
    moveFeatures.add(moveInput);
    console.log("Step 6: Kontermutter erfolgreich um 180° gedreht (Scheibe liegt nun flach auf der XY-Ebene Z=0).");
  } catch (e) {
    console.warn(`Fehler beim Drehen der Kontermutter um 180°: ${e}`);
  }
}


