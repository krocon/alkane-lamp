import { adsk } from "@adsk/fusion";
const app = adsk.core.Application.get();
const ui = app ? app.userInterface : null;
/** Hauptfunktion (Orchestrator) */
export function run(_context) {
    try {
        if (!app || !ui) {
            return;
        }
        const design = app.activeProduct;
        if (!design) {
            ui.messageBox('Bitte öffnen Sie ein aktives Dokument.');
            return;
        }
        const rootComp = design.rootComponent;
        // 1. Parameter definieren
        const params = setupParameters(design);
        // 2. Verbindungsröhre mit 36 Lamellen-Dreiecksrippen, Einführfasen & Anschlagring erzeugen
        const targetBody = createConnectorPipe(rootComp, params);
        targetBody.name = 'Connector_Pipe';
        console.log('Verbindungsröhre erfolgreich generiert!');
    }
    catch (e) {
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
function setupParameters(design) {
    const params = design.userParameters;
    function getOrCreateParam(name, valueStr, unit, description) {
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
        pipesDiameter: getOrCreateParam('pipes_diameter', '38mm', 'mm', 'Außendurchmesser des Verbinders an den Rippenspitzen'),
        innerHoleDiameter: getOrCreateParam('inner_hole_diameter', '34mm', 'mm', 'Durchmesser der durchgehenden inneren Bohrung'),
        connectorLength: getOrCreateParam('connector_length', '60mm', 'mm', 'Gesamtlänge des Verbindungsrohrs'),
        stopRingWidth: getOrCreateParam('stop_ring_width', '3mm', 'mm', 'Breite des Anschlagrings in der Mitte (0mm = deaktiviert)'),
        stopRingDiameter: getOrCreateParam('stop_ring_diameter', '46mm', 'mm', 'Außendurchmesser des Anschlagrings in der Mitte'),
        ribDepth: getOrCreateParam('rib_depth', '0.6mm', 'mm', 'Tiefe/Höhe der dreieckigen Lamellenrippen'),
        numRibs: getOrCreateParam('num_ribs', '36', '', 'Anzahl der umlaufenden Lamellenrippen (z. B. 36)'),
        chamferSize: getOrCreateParam('chamfer_size', '3mm', 'mm', 'Größe der Einführfasen an beiden Enden (3mm)')
    };
}
/**
 * Erzeugt die Verbindungsröhre mit geripptem Lamellen-Außenprofil, durchgehender Bohrung,
 * Anschlagring in der Mitte und Einführfasen an beiden Enden.
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param params Das Objekt mit den benutzerdefinierten Parametern.
 * @returns Der erzeugte 3D-Körper (BRepBody).
 */
function createConnectorPipe(rootComp, params) {
    // Dimensionen in cm (Standard-Einheit der Fusion 360 API)
    const rOuter = params.pipesDiameter.value / 2.0;
    const rInner = params.innerHoleDiameter.value / 2.0;
    const ribDepthVal = params.ribDepth.value;
    const rRoot = Math.max(rInner + 0.05, rOuter - ribDepthVal);
    const totalLength = params.connectorLength.value;
    const halfLength = totalLength / 2.0;
    const stopWidth = params.stopRingWidth.value;
    const halfStopWidth = stopWidth / 2.0;
    const rStop = params.stopRingDiameter.value / 2.0;
    const chamfer = params.chamferSize.value;
    const numRibs = Math.max(3, Math.round(params.numRibs.value));
    const extrudeFeatures = rootComp.features.extrudeFeatures;
    // 1. Skizze für den gerippten Grundkörper auf Versatzebene Z = -halfLength erstellen
    const planeInput = rootComp.constructionPlanes.createInput();
    planeInput.setByOffset(rootComp.xYConstructionPlane, adsk.core.ValueInput.createByReal(-halfLength));
    const startPlane = rootComp.constructionPlanes.add(planeInput);
    const sketch = rootComp.sketches.add(startPlane);
    // Innere Durchgangsbohrung zeichnen
    const center3D = adsk.core.Point3D.create(0, 0, -halfLength);
    const centerPt = sketch.modelToSketchSpace(center3D);
    sketch.sketchCurves.sketchCircles.addByCenterRadius(centerPt, rInner);
    // Outer Star/Rib Profile (36 umlaufende Dreiecksrippen)
    const points = [];
    for (let i = 0; i < numRibs; i++) {
        const tipAngle = (i * 2.0 * Math.PI) / numRibs;
        const valleyAngle = ((i + 0.5) * 2.0 * Math.PI) / numRibs;
        const tipX = rOuter * Math.cos(tipAngle);
        const tipY = rOuter * Math.sin(tipAngle);
        points.push(sketch.modelToSketchSpace(adsk.core.Point3D.create(tipX, tipY, -halfLength)));
        const valleyX = rRoot * Math.cos(valleyAngle);
        const valleyY = rRoot * Math.sin(valleyAngle);
        points.push(sketch.modelToSketchSpace(adsk.core.Point3D.create(valleyX, valleyY, -halfLength)));
    }
    const lines = sketch.sketchCurves.sketchLines;
    for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        lines.addByTwoPoints(p1, p2);
    }
    // Profil für die Röhrenwand finden (Ring-Profil zwischen Bohrung und Lamellenstern)
    let ringProfile = null;
    for (let i = 0; i < sketch.profiles.count; i++) {
        const prof = sketch.profiles.item(i);
        if (prof && prof.profileLoops.count === 2) {
            ringProfile = prof;
            break;
        }
    }
    if (!ringProfile && sketch.profiles.count >= 2) {
        const prof0 = sketch.profiles.item(0);
        const prof1 = sketch.profiles.item(1);
        if (prof0 && prof1) {
            ringProfile = prof0.areaProperties().area < prof1.areaProperties().area ? prof1 : prof0;
        }
    }
    if (!ringProfile && sketch.profiles.count === 1) {
        ringProfile = sketch.profiles.item(0);
    }
    if (!ringProfile) {
        throw new Error('Konnte das Profil für die Verbindungsröhre nicht ermitteln.');
    }
    // Grundkörper extrudieren (Länge: totalLength in Z-Richtung)
    const extInput = extrudeFeatures.createInput(ringProfile, 3 /* adsk.fusion.FeatureOperations.NewBodyFeatureOperation */);
    extInput.setDistanceExtent(false, adsk.core.ValueInput.createByReal(totalLength));
    const extrudeFeature = extrudeFeatures.add(extInput);
    if (!extrudeFeature || extrudeFeature.bodies.count === 0) {
        throw new Error('Erzeugung des Grundkörpers fehlgeschlagen.');
    }
    const targetBody = extrudeFeature.bodies.item(0);
    // 2. Mittelstopp / Anschlagring (falls stop_ring_width > 0)
    if (stopWidth > 0 && rStop > rInner) {
        const stopPlaneInput = rootComp.constructionPlanes.createInput();
        stopPlaneInput.setByOffset(rootComp.xYConstructionPlane, adsk.core.ValueInput.createByReal(-halfStopWidth));
        const stopPlane = rootComp.constructionPlanes.add(stopPlaneInput);
        const stopSketch = rootComp.sketches.add(stopPlane);
        const stopCenter3D = adsk.core.Point3D.create(0, 0, -halfStopWidth);
        const stopCenterPt = stopSketch.modelToSketchSpace(stopCenter3D);
        stopSketch.sketchCurves.sketchCircles.addByCenterRadius(stopCenterPt, rStop);
        stopSketch.sketchCurves.sketchCircles.addByCenterRadius(stopCenterPt, rInner);
        let stopRingProfile = null;
        for (let i = 0; i < stopSketch.profiles.count; i++) {
            const prof = stopSketch.profiles.item(i);
            if (prof && prof.profileLoops.count === 2) {
                stopRingProfile = prof;
                break;
            }
        }
        if (!stopRingProfile && stopSketch.profiles.count >= 2) {
            const prof0 = stopSketch.profiles.item(0);
            const prof1 = stopSketch.profiles.item(1);
            if (prof0 && prof1) {
                stopRingProfile = prof0.areaProperties().area < prof1.areaProperties().area ? prof1 : prof0;
            }
        }
        if (stopRingProfile) {
            const extStopInput = extrudeFeatures.createInput(stopRingProfile, 0 /* adsk.fusion.FeatureOperations.JoinFeatureOperation */);
            extStopInput.setDistanceExtent(false, adsk.core.ValueInput.createByReal(stopWidth));
            extrudeFeatures.add(extStopInput);
        }
    }
    // 3. Einführfasen (Schrägen an beiden Enden via Revolve-Cut)
    if (chamfer > 0) {
        const revolveFeatures = rootComp.features.revolveFeatures;
        const angle360 = adsk.core.ValueInput.createByString('360 deg');
        // Sicherstellen, dass die radiale Fasenbreite die Wandstärke nicht überschreitet
        const wallThickness = rOuter - rInner;
        const safeRadialChamfer = Math.min(chamfer, wallThickness * 0.75);
        const safeAxialChamfer = chamfer;
        // Oberer Fasenschnitt bei Z = +halfLength
        const topSketch = rootComp.sketches.add(rootComp.xZConstructionPlane);
        const topP1_3D = adsk.core.Point3D.create(rOuter, 0, halfLength - safeAxialChamfer);
        const topP2_3D = adsk.core.Point3D.create(rOuter - safeRadialChamfer, 0, halfLength);
        const topP3_3D = adsk.core.Point3D.create(rOuter + 0.5, 0, halfLength + 0.5);
        const topP4_3D = adsk.core.Point3D.create(rOuter + 0.5, 0, halfLength - safeAxialChamfer);
        const topP1 = topSketch.modelToSketchSpace(topP1_3D);
        const topP2 = topSketch.modelToSketchSpace(topP2_3D);
        const topP3 = topSketch.modelToSketchSpace(topP3_3D);
        const topP4 = topSketch.modelToSketchSpace(topP4_3D);
        topSketch.sketchCurves.sketchLines.addByTwoPoints(topP1, topP2);
        topSketch.sketchCurves.sketchLines.addByTwoPoints(topP2, topP3);
        topSketch.sketchCurves.sketchLines.addByTwoPoints(topP3, topP4);
        topSketch.sketchCurves.sketchLines.addByTwoPoints(topP4, topP1);
        if (topSketch.profiles.count > 0) {
            const topProfile = topSketch.profiles.item(0);
            const topRevInput = revolveFeatures.createInput(topProfile, rootComp.zConstructionAxis, 1 /* adsk.fusion.FeatureOperations.CutFeatureOperation */);
            topRevInput.participantBodies = [targetBody];
            topRevInput.setAngleExtent(false, angle360);
            revolveFeatures.add(topRevInput);
        }
        // Unterer Fasenschnitt bei Z = -halfLength
        const botSketch = rootComp.sketches.add(rootComp.xZConstructionPlane);
        const botP1_3D = adsk.core.Point3D.create(rOuter, 0, -halfLength + safeAxialChamfer);
        const botP2_3D = adsk.core.Point3D.create(rOuter - safeRadialChamfer, 0, -halfLength);
        const botP3_3D = adsk.core.Point3D.create(rOuter + 0.5, 0, -halfLength - 0.5);
        const botP4_3D = adsk.core.Point3D.create(rOuter + 0.5, 0, -halfLength + safeAxialChamfer);
        const botP1 = botSketch.modelToSketchSpace(botP1_3D);
        const botP2 = botSketch.modelToSketchSpace(botP2_3D);
        const botP3 = botSketch.modelToSketchSpace(botP3_3D);
        const botP4 = botSketch.modelToSketchSpace(botP4_3D);
        botSketch.sketchCurves.sketchLines.addByTwoPoints(botP1, botP2);
        botSketch.sketchCurves.sketchLines.addByTwoPoints(botP2, botP3);
        botSketch.sketchCurves.sketchLines.addByTwoPoints(botP3, botP4);
        botSketch.sketchCurves.sketchLines.addByTwoPoints(botP4, botP1);
        if (botSketch.profiles.count > 0) {
            const botProfile = botSketch.profiles.item(0);
            const botRevInput = revolveFeatures.createInput(botProfile, rootComp.zConstructionAxis, 1 /* adsk.fusion.FeatureOperations.CutFeatureOperation */);
            botRevInput.participantBodies = [targetBody];
            botRevInput.setAngleExtent(false, angle360);
            revolveFeatures.add(botRevInput);
        }
    }
    return targetBody;
}
