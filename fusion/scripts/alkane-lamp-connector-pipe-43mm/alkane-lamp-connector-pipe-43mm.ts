import { adsk } from "@adsk/fusion";

const app = adsk.core.Application.get();
const ui = app ? app.userInterface : null;


/**
 * @file alkane-lamp-connector-pipe-43mm.ts
 * @description Fusion 360 Skript zur Erzeugung eines Verbindungsrohres (Connector Pipe 43mm)
 * mit optional separatem oder integriertem Anschlagring für die Alkane-Lamp Baugruppe
 * (optimiert für den FDM-3D-Druck auf Bambu Lab P2S).
 *
 * ## Technische CAD-Kennwerte:
 * - Nenn-Außendurchmesser (outer_diameter): 43.00 mm
 * - Passungsspiel Außendurchmesser (outer_clearance): -0.10 mm (effektiver Außendurchmesser: 42.90 mm)
 * - Innendurchmesser (inner_diameter): 36.00 mm (Kabelkanal)
 * - Gesamtlänge (pipe_length): 50.00 mm
 * - Separater Ring (ring_as_separate_body): 1 (1 = separates Bauteil auf XY-Ebene, 0 = integrierter Bund)
 * - Anschlagring Außendurchmesser (ring_outer_diameter): 48.00 mm
 * - Anschlagring Nenn-Innendurchmesser (ring_inner_diameter): 43.00 mm
 * - Anschlagring Passungsspiel (ring_inner_clearance): +0.05 mm (effektiver Ring-Innendurchmesser: 43.05 mm)
 * - Anschlagring Länge (ring_length): 3.00 mm
 * - Äußere Einführfase (outer_chamfer): 1.00 mm an den beiden Rohrenden
 */

/** Ergebnisstruktur der Erzeugung */
interface ConnectorPipeResult {
  pipeBody: adsk.fusion.BRepBody;
  ringBody?: adsk.fusion.BRepBody;
}

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

    // 2. Verbindungsrohr (und ggf. separaten Ring) erzeugen
    const result = createConnectorPipe(rootComp, params);
    result.pipeBody.name = 'connector-pipe-43mm';
    if (result.ringBody) {
      result.ringBody.name = 'connector-pipe-ring-48mm';
    }

    const isSeparate = Math.round(params.ringAsSeparateBody.value) === 1;
    const ringModeStr = isSeparate ? 'separater Ring ID=43.05mm auf XY-Ebene' : 'integrierter Mittenbund';
    console.log(`Verbindungsrohr (Connector Pipe 43mm, Nenn-AD=43mm, eff. AD=42.90mm, ID=36mm, L=50mm, Ring 48x3mm [${ringModeStr}], Fase=1mm) erfolgreich generiert!`);

  } catch (e) {
    console.error(`Failed: ${e}`);
    if (ui) {
      ui.messageBox(`Kritischer Fehler beim Ausführen des Scripts:\n${e}`);
    }
  }
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
    outerDiameter: getOrCreateParam('outer_diameter', '43mm', 'mm', 'Nenn-Außendurchmesser des Rohres (43mm)'),
    outerClearance: getOrCreateParam('outer_clearance', '-0.10mm', 'mm', 'Passungsspiel des Außendurchmessers (-0.10mm)'),
    innerDiameter: getOrCreateParam('inner_diameter', '36mm', 'mm', 'Innendurchmesser des Rohres (Kabelkanal)'),
    pipeLength: getOrCreateParam('pipe_length', '50mm', 'mm', 'Gesamtlänge des Verbindungsrohres'),
    ringAsSeparateBody: getOrCreateParam('ring_as_separate_body', '1', '', 'Ring als separates Bauteil erzeugen (1 = Ja auf XY-Ebene, 0 = Nein/integriert)'),
    ringOuterDiameter: getOrCreateParam('ring_outer_diameter', '48mm', 'mm', 'Außendurchmesser des Anschlagrings'),
    ringInnerDiameter: getOrCreateParam('ring_inner_diameter', '43mm', 'mm', 'Nenn-Innendurchmesser des separaten Anschlagrings'),
    ringInnerClearance: getOrCreateParam('ring_inner_clearance', '0.05mm', 'mm', 'Passungsspiel/Aufmaß des Ring-Innendurchmessers (+0.05mm)'),
    ringLength: getOrCreateParam('ring_length', '3mm', 'mm', 'Länge des Anschlagrings'),
    outerChamfer: getOrCreateParam('outer_chamfer', '1mm', 'mm', 'Fase an den äußeren Endkanten des Rohres')
  };
}

type Params = ReturnType<typeof setupParameters>;

/**
 * Ermittelt den aktuellen Live-BRepBody aus den rootComp bRepBodies.
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param fallbackBody Fallback-Körper, falls in rootComp keine Körper vorhanden sind.
 * @returns Der gefundene Live-Körper oder der Fallback-Körper.
 */
function getLiveBody(rootComp: adsk.fusion.Component, fallbackBody: adsk.fusion.BRepBody): adsk.fusion.BRepBody {
  if (rootComp.bRepBodies.count > 0) {
    const b = rootComp.bRepBodies.item(0);
    if (b) return b;
  }
  return fallbackBody;
}

/**
 * Erzeugt das Verbindungsrohr mit Basis-Zylinder, Anschlagring (separat oder integriert) und Endfasen.
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param params Das Objekt mit den benutzerdefinierten Parametern.
 * @returns Das Ergebnisobjekt mit dem Rohrkörper und optionalem separaten Ringkörper.
 */
function createConnectorPipe(
  rootComp: adsk.fusion.Component,
  params: Params
): ConnectorPipeResult {
  const extrudeFeatures = rootComp.features.extrudeFeatures;
  const sketches = rootComp.sketches;
  const center3D = adsk.core.Point3D.create(0, 0, 0);

  // Radien und Längen in cm für Fusion 360 API (unter Berücksichtigung der Passungsspiele)
  const outerDiameterCm = params.outerDiameter.value + params.outerClearance.value;
  const outerRadiusCm = outerDiameterCm / 2.0;
  const innerRadiusCm = params.innerDiameter.value / 2.0;
  const pipeLenCm = params.pipeLength.value;
  const ringOuterRadiusCm = params.ringOuterDiameter.value / 2.0;
  const ringInnerDiameterCm = params.ringInnerDiameter.value + params.ringInnerClearance.value;
  const ringInnerRadiusCm = ringInnerDiameterCm / 2.0;
  const ringLenCm = params.ringLength.value;
  const isSeparateRing = Math.round(params.ringAsSeparateBody.value) === 1;

  if (outerRadiusCm <= innerRadiusCm) {
    throw new Error('Der Außendurchmesser muss größer sein als der Innendurchmesser.');
  }

  if (pipeLenCm <= ringLenCm) {
    throw new Error('Die Gesamtlänge des Rohres muss größer sein als die Länge des Anschlagrings.');
  }

  // 1. Skizze auf der XY-Konstruktionsebene für das Basis-Rohr
  const sketchXY = sketches.add(rootComp.xYConstructionPlane);
  const centerXY = sketchXY.modelToSketchSpace(center3D);

  sketchXY.sketchCurves.sketchCircles.addByCenterRadius(centerXY, innerRadiusCm);
  sketchXY.sketchCurves.sketchCircles.addByCenterRadius(centerXY, outerRadiusCm);

  // Ringprofil zwischen Innen- und Außendurchmesser finden
  let pipeProfile: adsk.fusion.Profile | null = null;
  for (let i = 0; i < sketchXY.profiles.count; i++) {
    const prof = sketchXY.profiles.item(i);
    if (prof && prof.profileLoops.count === 2) {
      pipeProfile = prof;
      break;
    }
  }

  if (!pipeProfile && sketchXY.profiles.count >= 2) {
    const p0 = sketchXY.profiles.item(0);
    const p1 = sketchXY.profiles.item(1);
    if (p0 && p1) {
      pipeProfile = p0.areaProperties().area < p1.areaProperties().area ? p1 : p0;
    }
  }

  if (!pipeProfile && sketchXY.profiles.count === 1) {
    pipeProfile = sketchXY.profiles.item(0);
  }

  if (!pipeProfile) {
    throw new Error('Konnte das Ringprofil für das Basis-Rohr nicht ermitteln.');
  }

  // 2. Extrusion des Basis-Rohrkörpers
  const extInput = extrudeFeatures.createInput(
    pipeProfile,
    adsk.fusion.FeatureOperations.NewBodyFeatureOperation
  );

  let distInput = adsk.core.ValueInput.createByString('pipe_length');
  if (!distInput) {
    distInput = adsk.core.ValueInput.createByReal(pipeLenCm);
  }
  extInput.setDistanceExtent(false, distInput);

  const extFeature = extrudeFeatures.add(extInput);
  if (!extFeature || extFeature.bodies.count === 0) {
    throw new Error('Erzeugung des Rohrkörpers fehlgeschlagen.');
  }

  let pipeBody = extFeature.bodies.item(0);
  let ringBody: adsk.fusion.BRepBody | undefined;

  // 3. Anschlagring erzeugen: entweder separat auf XY-Ebene oder integriert in der Rohrmitte
  if (ringOuterRadiusCm > outerRadiusCm && ringLenCm > 0) {
    if (isSeparateRing) {
      // Separater Ring neben dem Rohr auf der XY-Ebene (Abstand ca. 15mm zwischen Außenkanten)
      const ringOffsetXCm = (params.outerDiameter.value + params.ringOuterDiameter.value) / 2.0 + 1.5;
      ringBody = createSeparateRing(rootComp, ringOffsetXCm, ringLenCm, ringInnerRadiusCm, ringOuterRadiusCm);
    } else {
      // Integrierter Ring in der Rohrmitte (Join-Operation)
      createIntegratedCenterRing(rootComp, pipeLenCm, ringLenCm, innerRadiusCm, ringOuterRadiusCm);
      pipeBody = getLiveBody(rootComp, pipeBody);
    }
  }

  // 4. Äußere Kanten an den beiden Rohrenden leicht anfasen
  applyOuterChamfers(rootComp, pipeBody, outerRadiusCm, pipeLenCm, params);

  return { pipeBody, ringBody };
}

/**
 * Erzeugt den Anschlagring als separates Bauteil auf der XY-Ebene neben dem Rohr.
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param ringOffsetXCm X-Versatz für die Platzierung neben dem Rohr.
 * @param ringLenCm Länge/Höhe des Rings in cm.
 * @param ringInnerRadiusCm Innenradius des Rings in cm.
 * @param ringOuterRadiusCm Außenradius des Rings in cm.
 * @returns Der erzeugte separate Ring-Körper.
 */
function createSeparateRing(
  rootComp: adsk.fusion.Component,
  ringOffsetXCm: number,
  ringLenCm: number,
  ringInnerRadiusCm: number,
  ringOuterRadiusCm: number
): adsk.fusion.BRepBody {
  const extrudeFeatures = rootComp.features.extrudeFeatures;
  const sketches = rootComp.sketches;

  // Skizze auf der XY-Konstruktionsebene
  const sketchRing = sketches.add(rootComp.xYConstructionPlane);
  const center3D = adsk.core.Point3D.create(ringOffsetXCm, 0, 0);
  const centerPt = sketchRing.modelToSketchSpace(center3D);

  sketchRing.sketchCurves.sketchCircles.addByCenterRadius(centerPt, ringInnerRadiusCm);
  sketchRing.sketchCurves.sketchCircles.addByCenterRadius(centerPt, ringOuterRadiusCm);

  let ringProfile: adsk.fusion.Profile | null = null;
  for (let i = 0; i < sketchRing.profiles.count; i++) {
    const prof = sketchRing.profiles.item(i);
    if (prof && prof.profileLoops.count === 2) {
      ringProfile = prof;
      break;
    }
  }

  if (!ringProfile && sketchRing.profiles.count >= 2) {
    const p0 = sketchRing.profiles.item(0);
    const p1 = sketchRing.profiles.item(1);
    if (p0 && p1) {
      ringProfile = p0.areaProperties().area < p1.areaProperties().area ? p1 : p0;
    }
  }

  if (!ringProfile && sketchRing.profiles.count === 1) {
    ringProfile = sketchRing.profiles.item(0);
  }

  if (!ringProfile) {
    throw new Error('Ringprofil für den separaten Anschlagring konnte nicht ermittelt werden.');
  }

  const extInputRing = extrudeFeatures.createInput(
    ringProfile,
    adsk.fusion.FeatureOperations.NewBodyFeatureOperation
  );

  let ringDistInput = adsk.core.ValueInput.createByString('ring_length');
  if (!ringDistInput) {
    ringDistInput = adsk.core.ValueInput.createByReal(ringLenCm);
  }
  extInputRing.setDistanceExtent(false, ringDistInput);

  const extFeature = extrudeFeatures.add(extInputRing);
  if (!extFeature || extFeature.bodies.count === 0) {
    throw new Error('Erzeugung des separaten Anschlagrings fehlgeschlagen.');
  }

  const ringBody = extFeature.bodies.item(0);
  ringBody.name = 'connector-pipe-ring-48mm';
  console.log(`Separater Anschlagring (OD=48mm, ID=43mm, L=3mm, Offset X=${(ringOffsetXCm * 10).toFixed(1)}mm) erfolgreich auf XY-Ebene erzeugt.`);
  return ringBody;
}

/**
 * Erzeugt den zentrierten Anschlagring in der Mitte des Verbindungsrohres als integriertes Feature (Join).
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param pipeLenCm Gesamtlänge des Rohres in cm.
 * @param ringLenCm Länge des Anschlagrings in cm.
 * @param innerRadiusCm Innenradius des Rohres in cm.
 * @param ringOuterRadiusCm Außenradius des Anschlagrings in cm.
 */
function createIntegratedCenterRing(
  rootComp: adsk.fusion.Component,
  pipeLenCm: number,
  ringLenCm: number,
  innerRadiusCm: number,
  ringOuterRadiusCm: number
): void {
  const extrudeFeatures = rootComp.features.extrudeFeatures;
  const sketches = rootComp.sketches;

  // Versatzebene bei Z = (pipeLenCm - ringLenCm) / 2.0
  const startZCm = (pipeLenCm - ringLenCm) / 2.0;
  const planeInput = rootComp.constructionPlanes.createInput();
  planeInput.setByOffset(
    rootComp.xYConstructionPlane,
    adsk.core.ValueInput.createByReal(startZCm)
  );
  const ringPlane = rootComp.constructionPlanes.add(planeInput);
  const sketchRing = sketches.add(ringPlane);

  const center3D = adsk.core.Point3D.create(0, 0, startZCm);
  const centerPt = sketchRing.modelToSketchSpace(center3D);

  sketchRing.sketchCurves.sketchCircles.addByCenterRadius(centerPt, innerRadiusCm);
  sketchRing.sketchCurves.sketchCircles.addByCenterRadius(centerPt, ringOuterRadiusCm);

  let ringProfile: adsk.fusion.Profile | null = null;
  for (let i = 0; i < sketchRing.profiles.count; i++) {
    const prof = sketchRing.profiles.item(i);
    if (prof && prof.profileLoops.count === 2) {
      ringProfile = prof;
      break;
    }
  }

  if (!ringProfile && sketchRing.profiles.count >= 2) {
    const p0 = sketchRing.profiles.item(0);
    const p1 = sketchRing.profiles.item(1);
    if (p0 && p1) {
      ringProfile = p0.areaProperties().area < p1.areaProperties().area ? p1 : p0;
    }
  }

  if (!ringProfile && sketchRing.profiles.count === 1) {
    ringProfile = sketchRing.profiles.item(0);
  }

  if (!ringProfile) {
    throw new Error('Ringprofil für den Anschlagring konnte nicht ermittelt werden.');
  }

  const extInputRing = extrudeFeatures.createInput(
    ringProfile,
    adsk.fusion.FeatureOperations.JoinFeatureOperation
  );

  let ringDistInput = adsk.core.ValueInput.createByString('ring_length');
  if (!ringDistInput) {
    ringDistInput = adsk.core.ValueInput.createByReal(ringLenCm);
  }
  extInputRing.setDistanceExtent(false, ringDistInput);

  extrudeFeatures.add(extInputRing);
  console.log('Mittiger Anschlagring erfolgreich mit Join am Rohr integriert.');
}

/**
 * Bringt eine leichte Fase an den beiden äußeren Stirnringkanten des Rohres an.
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param targetBody Der erzeugte Rohrkörper.
 * @param outerRadiusCm Der Außenradius in cm.
 * @param pipeLenCm Die Gesamtlänge des Rohres in cm.
 * @param params Das Parameter-Objekt.
 */
function applyOuterChamfers(
  rootComp: adsk.fusion.Component,
  targetBody: adsk.fusion.BRepBody,
  outerRadiusCm: number,
  pipeLenCm: number,
  params: Params
): void {
  const chamferValCm = params.outerChamfer.value;
  if (chamferValCm <= 0) return;

  const edgeColl = adsk.core.ObjectCollection.create();

  // Suche kreisförmige Außenkanten an den beiden Rohrenden (Z ≈ 0 und Z ≈ pipeLenCm)
  for (let i = 0; i < targetBody.edges.count; i++) {
    const edge = targetBody.edges.item(i);
    if (edge && edge.geometry.curveType === adsk.core.Curve3DTypes.Circle3DCurveType) {
      const circ = edge.geometry as adsk.core.Circle3D;
      const radiusDiff = Math.abs(circ.radius - outerRadiusCm);
      const isCentered = Math.abs(circ.center.x) < 0.05 && Math.abs(circ.center.y) < 0.05;
      const isEndFace = Math.abs(circ.center.z - 0) < 0.05 || Math.abs(circ.center.z - pipeLenCm) < 0.05;

      if (radiusDiff < 0.05 && isCentered && isEndFace) {
        edgeColl.add(edge);
      }
    }
  }

  if (edgeColl.count > 0) {
    try {
      const chamferFeatures = rootComp.features.chamferFeatures;
      const chamferInput = chamferFeatures.createInput2();
      if (chamferInput) {
        let valInput = adsk.core.ValueInput.createByString('outer_chamfer');
        if (!valInput) {
          valInput = adsk.core.ValueInput.createByReal(chamferValCm);
        }
        chamferInput.chamferEdgeSets.addEqualDistanceChamferEdgeSet(edgeColl, valInput, true);
        chamferFeatures.add(chamferInput);
        console.log(`Fase an ${edgeColl.count} Rohrenden-Außenkanten erfolgreich angewendet.`);
      }
    } catch (e) {
      console.warn(`Warnung beim Anfasen der Außenkanten: ${e}`);
      // Fallback mit absolutem cm-Wert versuchen
      try {
        const chamferFeatures = rootComp.features.chamferFeatures;
        const fallbackInput = chamferFeatures.createInput2();
        if (fallbackInput) {
          fallbackInput.chamferEdgeSets.addEqualDistanceChamferEdgeSet(
            edgeColl,
            adsk.core.ValueInput.createByReal(chamferValCm),
            true
          );
          chamferFeatures.add(fallbackInput);
          console.log(`Fallback-Fase an Rohrenden-Außenkanten erfolgreich angewendet.`);
        }
      } catch (err2) {
        console.warn(`Fallback beim Anfasen ebenfalls fehlgeschlagen: ${err2}`);
      }
    }
  } else {
    console.warn('Keine Rohrenden-Außenkanten für die Fase gefunden.');
  }
}

