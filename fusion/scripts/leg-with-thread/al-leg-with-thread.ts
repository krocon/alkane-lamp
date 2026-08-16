/** This file acts as the main module for this script. */


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

        // 2. Tetrapod erzeugen (Basisgeometrie aus 4 Armen)
        const targetBody = createLongArm(rootComp, params);
        targetBody.name = 'leg-with-thread';

        // 3. Gewinde am Fussende des langen Arms erstellen
        addLongArmThread(rootComp, targetBody, params);

        // 4. Rohr aufbohren (vom Gewinde Richtung Ursprung für 27.5 mm)
        boreOutLongArm(rootComp, params);

        // 5. Zweites Loch vom Ursprung aufbohren (Länge: 32.50 mm, Durchmesser: 40.05 mm)
        boreOutFromOrigin(rootComp);
        
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
            p = params.add(name, adsk.core.ValueInput.createByString(valueStr)!, unit, description)!;
        }
        return p;
    }

    return {
        armOuterDiameter: getOrCreateParam('arm_outer_diameter', '46mm', 'mm', 'Aussendurchmesser der Arme'),
        armDepthLong: getOrCreateParam('arm_depth_long', '80mm', 'mm', 'Armlaenge des langen Armes gemessen vom Zentrum'),
        ringInnerDiameter: getOrCreateParam('ring_inner_diameter', '40mm', 'mm', 'Durchmesser der erhabenen Stirnflaeche')
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
    const center = adsk.core.Point3D.create(0, 0, 0)!;

    // Skizze auf der XY-Ebene erstellen
    const sketch = sketches.add(xyPlane)!;
    sketch.sketchCurves.sketchCircles.addByCenterRadius(center, params.armOuterDiameter.value / 2.0);
    sketch.sketchCurves.sketchCircles.addByCenterRadius(center, params.ringInnerDiameter.value / 2.0);

    let innerProfile: adsk.fusion.Profile | null = null;
    let outerRingProfile: adsk.fusion.Profile | null = null;

    // Profile identifizieren: Wir unterscheiden zwischen dem inneren Kreis und dem äußeren Ring
    for (let i = 0; i < sketch.profiles.count; i++) {
        const prof = sketch.profiles.item(i)!;
        if (prof.profileLoops.count === 1) {
            innerProfile = prof; // Der volle Kreis (innen)
        } else {
            outerRingProfile = prof; // Der Ring (zwischen den Kreisen)
        }
    }

    // Fallback-Logik zur Profilfindung falls die Loop-Zählung nicht eindeutig ist
    if (!innerProfile || !outerRingProfile) {
        const prof0 = sketch.profiles.item(0)!;
        const prof1 = sketch.profiles.item(1)!;
        if (prof0.areaProperties().area < prof1.areaProperties().area) {
            innerProfile = prof0;
            outerRingProfile = prof1;
        } else {
            innerProfile = prof1;
            outerRingProfile = prof0;
        }
    }

    // Extrusion des äußeren Rings
    const extInputRing = extrudeFeatures.createInput(outerRingProfile!, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)!;
    const distanceExtent = '-arm_depth_long'; // Negative Richtung entlang der normalen Achse (Z)
    extInputRing.setDistanceExtent(false, adsk.core.ValueInput.createByString(distanceExtent)!);
    return extrudeFeatures.add(extInputRing)!.bodies.item(0)!;
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
        const face = armBody.faces.item(i)!;
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

    // 2. Gewinde-Parameter definieren (M40x2.5, H6)
    const threadType = "ISO Metric Profile";
    const designator = "M40x2.5";
    const threadClass = "6H";

    const threadInfo = threadFeatures.createThreadInfo(true, threadType, designator, threadClass)!;

    // 3. Thread-Feature erstellen
    const threadInput = threadFeatures.createInput(targetFace, threadInfo);
    threadInput.isFullLength = false;
    threadInput.isModeled = true; // Modelliert für die physische Toleranzanpassung

    // Dynamische Berechnung des Offsets am Fussende
    const bbox = targetFace.boundingBox;
    const faceHeight = Math.abs(bbox.maxPoint.z - bbox.minPoint.z);
    const threadLengthCm = 2.0; // 20mm
    let offsetCm = faceHeight - threadLengthCm;
    if (offsetCm < 0) offsetCm = 0;

    threadInput.threadOffset = adsk.core.ValueInput.createByReal(offsetCm)!;
    threadInput.threadLength = adsk.core.ValueInput.createByReal(threadLengthCm)!;

    const threadFeature = threadFeatures.add(threadInput);
    if (!threadFeature) {
        if (ui) ui.messageBox("Fehler beim Erstellen des Gewinde-Features.");
        return;
    }

    // 4. Gewinde weiten (Toleranzberücksichtigung durch Drücken/Ziehen)
    const facesToOffset: adsk.fusion.BRepFace[] = [];
    for (let i = 0; i < threadFeature.faces.count; i++) {
        facesToOffset.push(threadFeature.faces.item(i)!);
    }

    if (facesToOffset.length > 0) {
        const offsetFeatures = features.offsetFacesFeatures;
        const offsetInput = offsetFeatures.createInput(
          facesToOffset,
          adsk.core.ValueInput.createByString("-0.1mm")!
        );
        if (offsetInput) {
            offsetFeatures.add(offsetInput);
        }
    }
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
    const planeInput = constructionPlanes.createInput()!;

    // Ebene orthogonal zur Z-Achse bei -60mm (6.0 cm)
    const offsetValue = adsk.core.ValueInput.createByReal(-6.0)!;
    planeInput.setByOffset(rootComp.xYConstructionPlane, offsetValue);
    const offsetPlane = constructionPlanes.add(planeInput)!;

    const sketches = rootComp.sketches;
    const sketch = sketches.add(offsetPlane)!;

    // Kreis mit 41mm Durchmesser (Radius 20.05 cm)
    const diameterCm = 4.1;
    sketch.sketchCurves.sketchCircles.addByCenterRadius(
      adsk.core.Point3D.create(0, 0, 0)!,
      diameterCm / 2.0
    );

    if (sketch.profiles.count === 0) return;
    const profile = sketch.profiles.item(0)!;

    // Extrusion (Cut) 60mm nach innen (Richtung Ursprung)
    const extrudeFeatures = rootComp.features.extrudeFeatures;
    const extInput = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation)!;
    extInput.setDistanceExtent(false, adsk.core.ValueInput.createByReal(2.75)!);

    extrudeFeatures.add(extInput);
}

/**
 * Bohrt das zweite Loch vom Ursprung in Richtung der Z-Achse auf.
 * Ziel: 40.05mm Durchmesser, Länge 32.50mm in Richtung der Z-Achse (in das Rohr).
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 */
function boreOutFromOrigin(rootComp: adsk.fusion.Component): void {
    const sketches = rootComp.sketches;
    const sketch = sketches.add(rootComp.xYConstructionPlane)!;

    // Kreis mit 40.05mm Durchmesser (Radius: 2.0025 cm)
    const diameterCm = 4.005;
    sketch.sketchCurves.sketchCircles.addByCenterRadius(
        adsk.core.Point3D.create(0, 0, 0)!,
        diameterCm / 2.0
    );

    if (sketch.profiles.count === 0) return;
    const profile = sketch.profiles.item(0)!;

    // Extrusion (Cut) 32.50mm entlang der Z-Achse in das Rohr (-Z Richtung)
    const extrudeFeatures = rootComp.features.extrudeFeatures;
    const extInput = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation)!;
    extInput.setDistanceExtent(false, adsk.core.ValueInput.createByReal(-3.25)!);

    extrudeFeatures.add(extInput);
}
