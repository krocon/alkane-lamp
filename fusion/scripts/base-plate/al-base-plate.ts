/** This file acts as the main module for this script. */


import { adsk } from "@adsk/fusion";

const app = adsk.core.Application.get();
const ui = app ? app.userInterface : null;

/** Toleranz für geometrische Such- und Prüfaufgaben (in mm). */
const TOL = 0.5;

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

        // 2. Basis-Platte: runder Körper (XY-Skizze, Extrusion) + Fillet der oberen Kante
        const baseBody = createBasePlate(rootComp, params);

        // 3. Geneigte Bein-Achse: Referenzskizze auf der XZ-Ebene (Achse als Konstruktionslinie)
        const legAxis = createLegAxis(rootComp, params);

        // 4. Konstruktionsebene, rechtwinklig auf der Achse am oberen Endpunkt (Plane Along Path)
        const tiltedPlane = createTiltedConstructionPlane(rootComp, legAxis);

        // 5. Röhrenkörper: zwei konzentrische Kreise auf der geneigten Ebene,
        //    Außenzylinder nach unten bis zur Platte extrudieren und per Join kombinieren
        const legTube = createLegTube(rootComp, params, tiltedPlane, legAxis, baseBody);

        // 6. Stufenabsatz: oberes Segment (ringExtrudeDepth) auf ringInnerDiameter zurückspringen (Cut)
        cutStepShoulder(rootComp, params, legTube.sketch, legTube.body, legAxis);

        // 7. Übergangsverrundung an der Verschneidungskante Bein/Basis-Platte (Fillet)
        filletLegPlateJunction(rootComp, params, legTube.body, legAxis);

        // 8. Durchgehende Innenbohrung (holeInnerDiameter) entlang der Beinachse (Cut)
        boreLegHole(rootComp, params, tiltedPlane, legTube.body, legAxis);

        // 9. Unterseite bündig schneiden (Überstand unterhalb z=0 abtrennen)
        trimBottomFlush(rootComp, params);

        // 10. Gebogener Kabelkanal an der Unterseite mit Zugsicherung
        createBottomCableChannel(rootComp, params);

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
 * Ermöglicht die dynamische Steuerung der Röhre über die Parameter-Liste.
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
            const value = adsk.core.ValueInput.createByString(valueStr);
            if (!value) {
                throw new Error(`Ungültiger Parameterwert für '${name}': ${valueStr}`);
            }
            p = params.add(name, value, unit, description);
            if (!p) {
                throw new Error(`Parameter '${name}' konnte nicht erstellt werden.`);
            }
        }
        return p;
    }

    return {
        basePlateDiameter: getOrCreateParam('base_plate_diameter', '160mm', 'mm', 'Durchmesser der runden Basis-Platte'),
        basePlateHeight: getOrCreateParam('base_plate_height', '10mm', 'mm', 'Höhe der runden Basis-Platte'),
        basePlateRounding: getOrCreateParam('base_plate_rounding', '3mm', 'mm', 'Abrundung der oberen Basis-Platte-Kante (Kreis)'),
        legOuterDiameter: getOrCreateParam('leg_outer_diameter', '46mm', 'mm', 'Aussendurchmesser der Röhre'),
        ringInnerDiameter: getOrCreateParam('ring_inner_diameter', '40mm', 'mm', 'Aussendurchmesser des oberen Röhrensegments (Stufenabsatz)'),
        ringExtrudeDepth: getOrCreateParam('ring_extrude_depth', '50mm', 'mm', 'Länge des oberen (dünnen) Röhrensegments / Stufenabsatz'),
        holeInnerDiameter: getOrCreateParam('hole_inner_diameter', '31.5mm', 'mm', 'Innendurchmesser der Röhre (Loch)'),
        legLength: getOrCreateParam('leg_length', '100mm', 'mm', 'Laenge der Röhre'),
        legAngle: getOrCreateParam('leg_angle', '120', 'degree', 'Winkel des Beines zur XY-Ebene (Innenwinkel an der Platte)'),
        legOffset: getOrCreateParam('leg_offset', '45mm', 'mm', 'Abstand des Bein-Fußpunktes vom Plattenmittelpunkt'),
        legPlateRounding: getOrCreateParam('leg_plate_rounding', '4mm', 'mm', 'Abrundung der Kante: Bein und Platte (wird bei Solver-Problemen automatisch verkleinert)'),
        cableChannelWidth: getOrCreateParam('cable_channel_width', '7.5mm', 'mm', 'Breite des unterseitigen Kabelkanals'),
        cableChannelDepth: getOrCreateParam('cable_channel_depth', '5mm', 'mm', 'Tiefe des unterseitigen Kabelkanals'),
        clampRecessWidth: getOrCreateParam('clamp_recess_width', '22mm', 'mm', 'Breite der Klemmsteg-Vertiefung quer zum Kanal'),
        clampRecessLength: getOrCreateParam('clamp_recess_length', '12mm', 'mm', 'Länge der Klemmsteg-Vertiefung entlang des Kanals'),
        clampRecessDepth: getOrCreateParam('clamp_recess_depth', '2.5mm', 'mm', 'Tiefe der Klemmsteg-Vertiefung an der Unterseite'),
        strainReliefScrewDiameter: getOrCreateParam('strain_relief_screw_diameter', '2.6mm', 'mm', 'Bohrungsdurchmesser für M3-Zugsicherungsschellen'),
        strainReliefScrewDepth: getOrCreateParam('strain_relief_screw_depth', '6mm', 'mm', 'Bohrungstiefe für M3-Zugsicherungsschellen')
    };
}

/** Typ für den Parameter-Satz (Wiederverwendung in den Funktionen). */
type Params = ReturnType<typeof setupParameters>;

/**
 * Geometrische Eckdaten der geneigten Beinachse (alle Werte in mm).
 * Die Achse startet im Ursprung (0,0,0) = Plattenmitte und verläuft in der
 * XZ-Ebene im Winkel `legAngle` zur XY-Ebene (Innenwinkel an der Platte).
 */
interface LegAxis {
    /** Startpunkt der Achse (Zentrum der Basis-Platte). */
    start: adsk.core.Point3D;
    /** Endpunkt der Achse (Mittelpunkt der oberen Stirnfläche). */
    end: adsk.core.Point3D;
    /** Normalisierte Richtung der Achse (von der Platte zum Kopf). */
    dir: { x: number, y: number, z: number };
    /** Skizzierte Achslinie (Konstruktionsgeometrie) in der XZ-Ebene. */
    line: adsk.fusion.SketchLine;
}

/** Ergebnis der Bein-Röhren-Erstellung (kombinierter Körper + Skizze für den Stufenabsatz). */
interface LegTubeResult {
    body: adsk.fusion.BRepBody;
    sketch: adsk.fusion.Sketch;
}

/**
 * 1) Basis-Platte:
 *    - Skizze auf der XY-Ebene mit einem Kreis (basePlateDiameter) im Ursprung
 *    - Extrusion um basePlateHeight nach oben (+Z)
 *    - Fillet (basePlateRounding) an der oberen umlaufenden Kante
 *
 * @returns Der BRepBody der Basis-Platte (Zielkörper für den späteren Join).
 */
function createBasePlate(rootComp: adsk.fusion.Component, params: Params): adsk.fusion.BRepBody {
    const center = adsk.core.Point3D.create(0, 0, 0);
    if (!center) {
        throw new Error('Konnte den Mittelpunkt (0,0,0) nicht erstellen.');
    }

    // Skizze auf der XY-Ebene mit einem Kreis im Ursprung
    const sketch = rootComp.sketches.add(rootComp.xYConstructionPlane);
    if (!sketch) {
        throw new Error('Skizze konnte nicht auf der XY-Ebene erstellt werden.');
    }
    sketch.sketchCurves.sketchCircles.addByCenterRadius(center, params.basePlateDiameter.value / 2.0);

    if (sketch.profiles.count === 0) {
        throw new Error('Kein Profil in der Basis-Platten-Skizze gefunden.');
    }
    const profile = sketch.profiles.item(0);
    if (!profile) {
        throw new Error('Profil der Basis-Platte konnte nicht gelesen werden.');
    }

    // Extrusion nach oben (+Z = Normalenrichtung der XY-Ebene)
    const extInput = rootComp.features.extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.NewBodyFeatureOperation);
    if (!extInput) {
        throw new Error('Extrusions-Input für die Basis-Platte konnte nicht erstellt werden.');
    }
    extInput.setDistanceExtent(false, adsk.core.ValueInput.createByString('base_plate_height')!);
    const extFeature = rootComp.features.extrudeFeatures.add(extInput);
    if (!extFeature || extFeature.bodies.count === 0) {
        throw new Error('Basis-Platte konnte nicht extrudiert werden.');
    }
    const plateBody = extFeature.bodies.item(0);
    if (!plateBody) {
        throw new Error('Kein Körper nach der Extrusion der Basis-Platte gefunden.');
    }

    // Verrundung der oberen umlaufenden Kante (Kreis bei z = base_plate_height)
    const topEdge = findCircularEdgeAtZ(plateBody, params.basePlateHeight.value, params.basePlateDiameter.value / 2.0);
    if (!topEdge) {
        throw new Error('Obere Kante der Basis-Platte konnte nicht gefunden werden.');
    }

    const filletInput = rootComp.features.filletFeatures.createInput();
    if (!filletInput) {
        throw new Error('Fillet-Input für die Basis-Platte konnte nicht erstellt werden.');
    }
    const edgeColl = adsk.core.ObjectCollection.create();
    edgeColl.add(topEdge);
    filletInput.edgeSetInputs.addConstantRadiusEdgeSet(
        edgeColl,
        adsk.core.ValueInput.createByString('base_plate_rounding')!,
        false
    );
    const filletFeature = rootComp.features.filletFeatures.add(filletInput);
    if (!filletFeature) {
        throw new Error('Verrundung der Basis-Platte konnte nicht erstellt werden.');
    }

    return plateBody;
}

/**
 * Findet die umlaufende (kreisförmige) Kante eines Körpers auf der Höhe `z`,
 * deren Kantenlänge näherungsweise dem Kreisumfang `2 * PI * radius` entspricht.
 */
function findCircularEdgeAtZ(body: adsk.fusion.BRepBody, z: number, radius: number): adsk.fusion.BRepEdge | null {
    const expectedLength = 2.0 * Math.PI * radius;
    for (let i = 0; i < body.edges.count; i++) {
        const edge = body.edges.item(i);
        if (!edge) {
            continue;
        }
        const bb = edge.boundingBox;
        if (!bb) {
            continue;
        }
        // Kante muss flach auf der Höhe z liegen
        if (Math.abs(bb.minPoint.z - z) > TOL || Math.abs(bb.maxPoint.z - z) > TOL) {
            continue;
        }
        // Kantenlänge muss näherungsweise dem Kreisumfang entsprechen
        if (Math.abs(edge.length - expectedLength) <= Math.max(1.0, expectedLength * 0.02)) {
            return edge;
        }
    }
    return null;
}

/**
 * 2) Geneigte Bein-Achse: Referenzskizze auf der XZ-Ebene.
 *    Die Achse (Länge legLength, Winkel legAngle zur XY-Ebene) wird vom
 *    Ursprung (Plattenmitte) bis zum oberen Endpunkt als Konstruktionslinie gezeichnet.
 */
function createLegAxis(rootComp: adsk.fusion.Component, params: Params): LegAxis {
    // In der Fusion 360 API ist Parameter.value für Winkel bereits in Radiant (interne Database Units)
    const angleRad = params.legAngle.value;
    const dir = { x: Math.cos(angleRad), y: 0, z: Math.sin(angleRad) };
    const legLen = params.legLength.value;
    const offset = params.legOffset.value;

    const start = adsk.core.Point3D.create(offset, 0, 0);
    const end = adsk.core.Point3D.create(offset + legLen * dir.x, legLen * dir.y, legLen * dir.z);
    if (!start || !end) {
        throw new Error('Konnte die Achsenpunkte (Start/Ende) der Bein-Achse nicht erstellen.');
    }

    // Referenzskizze auf der XZ-Ebene
    const sketch = rootComp.sketches.add(rootComp.xZConstructionPlane);
    if (!sketch) {
        throw new Error('Referenzskizze konnte nicht auf der XZ-Ebene erstellt werden.');
    }

    // WICHTIG: 3D-Punkte (start/end) müssen mit modelToSketchSpace in den 2D-Skizzenraum
    // der XZ-Ebene transformiert werden, damit Z nicht als Y=0 verschluckt wird!
    const startSketch = sketch.modelToSketchSpace(start);
    const endSketch = sketch.modelToSketchSpace(end);
    if (!startSketch || !endSketch) {
        throw new Error('Skizzenpunkte der Bein-Achse konnten nicht transformiert werden.');
    }

    const line = sketch.sketchCurves.sketchLines.addByTwoPoints(startSketch, endSketch);
    if (!line) {
        throw new Error('Bein-Achse (Gerade) konnte nicht skizziert werden.');
    }
    line.isConstruction = true; // Referenz-/Konstruktionsgeometrie

    return { start, end, dir, line };
}

/**
 * 2b) Konstruktionsebene, die rechtwinklig auf der Bein-Achse am oberen
 *     Endpunkt liegt ("Plane Along Path").
 *     Primär: setByDistanceOnPath(Achslinie, 1.0) am Kopfpunkt.
 *     Fallback: Ebene durch drei Punkte auf der Zielachse (setByThreePoints).
 */
function createTiltedConstructionPlane(
    rootComp: adsk.fusion.Component,
    legAxis: LegAxis
): adsk.fusion.ConstructionPlane {
    const planes = rootComp.constructionPlanes;

    // Primär: Ebene entlang der Pfadlinie am Bein-Kopf (Endpunkt, distance = 1.0)
    let input = planes.createInput();
    if (input) {
        if (input.setByDistanceOnPath(legAxis.line, adsk.core.ValueInput.createByReal(1.0)!)) {
            const plane = planes.add(input);
            if (plane) {
                return plane;
            }
        }
    }

    // Fallback: Ebene durch drei Punkte am Endpunkt der Achse
    // (Endpunkt + zwei voneinander linear unabhängige Senkrechte).
    // Die Achse liegt in der XZ-Ebene: Senkrechte 1 = Y-Achse (0, 1, 0),
    // Senkrechte 2 = (dir.z, 0, -dir.x) in der XZ-Ebene.
    const sketch = legAxis.line.parentSketch;
    const endPt = legAxis.line.endSketchPoint;
    const sketchPoints = sketch ? sketch.sketchPoints : null;
    const p1 = sketchPoints ? sketchPoints.add(adsk.core.Point3D.create(legAxis.end.x, legAxis.end.y + 1.0, legAxis.end.z)!) : null;
    const p2 = sketchPoints ? sketchPoints.add(adsk.core.Point3D.create(legAxis.end.x + legAxis.dir.z, legAxis.end.y, legAxis.end.z - legAxis.dir.x)!) : null;

    const fallback = planes.createInput();
    if (!fallback) {
        throw new Error('Konstruktionsebene-Input konnte nicht erstellt werden.');
    }
    if (p1 && p2 && endPt && fallback.setByThreePoints(endPt, p1, p2)) {
        const plane = planes.add(fallback);
        if (plane) {
            return plane;
        }
    }
    throw new Error('Geneigte Konstruktionsebene konnte nicht erstellt werden.');
}

/**
 * 3) Äußerer Röhrenkörper:
 *    - Skizze auf der geneigten Konstruktionsebene mit zwei konzentrischen
 *      Kreisen (legOuterDiameter, ringInnerDiameter) um den Achsen-Endpunkt
 *    - Außenzylinder (legOuterDiameter) entlang der Achse nach unten bis zur
 *      Basis-Platte extrudieren (der Fuß endet im Platteninneren)
 *    - Geometrie mit der Basis-Platte kombinieren (Join)
 *
 * @returns Der kombinierte Körper (Platte + Bein) und die Bein-Skizze (für den Stufenabsatz).
 */
function createLegTube(
    rootComp: adsk.fusion.Component,
    params: Params,
    tiltedPlane: adsk.fusion.ConstructionPlane,
    legAxis: LegAxis,
    baseBody: adsk.fusion.BRepBody
): LegTubeResult {
    const outerRadius = params.legOuterDiameter.value / 2.0;
    const innerRadius = params.ringInnerDiameter.value / 2.0;

    // Skizze auf der geneigten Konstruktionsebene
    const sketch = rootComp.sketches.add(tiltedPlane);
    if (!sketch) {
        throw new Error('Skizze auf der geneigten Konstruktionsebene konnte nicht erstellt werden.');
    }
    // Da tiltedPlane bereits am Achsen-Endpunkt zentriert ist, liegt der Mittelpunkt
    // in 2D-Skizzenkoordinaten exakt im Ursprung (0,0,0) der Skizze!
    const centerPoint = adsk.core.Point3D.create(0, 0, 0);
    if (!centerPoint) {
        throw new Error('Mittelpunkt (0,0,0) konnte nicht erstellt werden.');
    }
    // Zuerst nur den äußeren Kreis zeichnen, damit das Profil für den Außenzylinder eindeutig ist
    sketch.sketchCurves.sketchCircles.addByCenterRadius(centerPoint, outerRadius);

    if (sketch.profiles.count < 1) {
        throw new Error('Erwartetes Profil in der Bein-Skizze nicht gefunden.');
    }

    const legBody = extrudeAlongAxisDown(rootComp, sketch, params);

    // Anschließend den inneren Kreis für den Stufenabsatz (cutStepShoulder) hinzufügen
    sketch.sketchCurves.sketchCircles.addByCenterRadius(centerPoint, innerRadius);

    // Geometrie mit der Basis-Platte kombinieren (Join)
    const combined = joinBodies(rootComp, baseBody, [legBody]);

    return { body: combined, sketch };
}

/**
 * Extrudiert das Profil der Skizze (den vollen Außenzylinder legOuterDiameter) um eine Distanz,
 * die garantiert die Basis-Platte durchdringt. Die Richtung wird dynamisch ermittelt.
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
        if (!profileColl) {
            throw new Error('ObjectCollection konnte nicht erstellt werden.');
        }
        for (let i = 0; i < sketch.profiles.count; i++) {
            const prof = sketch.profiles.item(i);
            if (prof) {
                profileColl.add(prof);
            }
        }
        profileArg = profileColl;
    }

    const errors: string[] = [];
    const totalDistReal = params.legLength.value + params.basePlateHeight.value;

    const strategies: Array<{ name: string, run: () => adsk.fusion.ExtrudeFeature | null }> = [
        // Strategie 1: Positiv-String 'leg_length + base_plate_height' (entlang Normalenvektor nach unten)
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
        // Strategie 2: setOneSideExtent mit PositiveExtentDirection und positivem String
        {
            name: "setOneSideExtent (PositiveExtentDirection)",
            run: () => {
                const input = extrudeFeatures.createInput(profileArg, adsk.fusion.FeatureOperations.NewBodyFeatureOperation);
                const distVal = adsk.core.ValueInput.createByString('leg_length + base_plate_height');
                if (input && distVal) {
                    const distDef = adsk.fusion.DistanceExtentDefinition.create(distVal);
                    if (distDef) {
                        input.setOneSideExtent(distDef, adsk.fusion.ExtentDirections.PositiveExtentDirection);
                        return extrudeFeatures.add(input);
                    }
                }
                return null;
            }
        },
        // Strategie 3: Reale Distanz positiv (+totalDistReal)
        {
            name: "Reale Distanz positiv (+9.0 cm)",
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
        // Strategie 4: setOneSideExtent mit NegativeExtentDirection und positivem String
        {
            name: "setOneSideExtent (NegativeExtentDirection)",
            run: () => {
                const input = extrudeFeatures.createInput(profileArg, adsk.fusion.FeatureOperations.NewBodyFeatureOperation);
                const distVal = adsk.core.ValueInput.createByString('leg_length + base_plate_height');
                if (input && distVal) {
                    const distDef = adsk.fusion.DistanceExtentDefinition.create(distVal);
                    if (distDef) {
                        input.setOneSideExtent(distDef, adsk.fusion.ExtentDirections.NegativeExtentDirection);
                        return extrudeFeatures.add(input);
                    }
                }
                return null;
            }
        },
        // Strategie 5: Negative String-Expression (-leg_length - base_plate_height)
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
        // Strategie 6: Reale Distanz negativ (-totalDistReal)
        {
            name: "Reale Distanz negativ (-9.0 cm)",
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

    for (let idx = 0; idx < strategies.length; idx++) {
        const strat = strategies[idx];
        let extFeature: adsk.fusion.ExtrudeFeature | null = null;
        try {
            extFeature = strat.run();
        } catch (err) {
            errors.push(`${strat.name}: ${err instanceof Error ? err.message : String(err)}`);
            continue;
        }

        if (extFeature && extFeature.bodies.count > 0) {
            const body = extFeature.bodies.item(0);
            if (body) {
                const minZ = body.boundingBox.minPoint.z;
                if (minZ < targetZ + TOL) {
                    return body;
                }
                errors.push(`${strat.name}: minZ=${minZ.toFixed(2)} cm (erwartet < ${(targetZ + TOL).toFixed(2)} cm)`);
            }
            extFeature.deleteMe();
        } else if (extFeature) {
            extFeature.deleteMe();
            errors.push(`${strat.name}: Feature ohne Körper erzeugt`);
        } else {
            errors.push(`${strat.name}: createInput/add lieferte null`);
        }
    }

    throw new Error(`Extrusion des Beins in Richtung der Basis-Platte ist fehlgeschlagen.\nDetails:\n${errors.join('\n')}`);
}

/**
 * Kombiniert einen Werkzeugkörper mit dem Zielkörper per Join.
 * @returns Der Zielkörper (jetzt kombiniert).
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
    if (!combineInput) {
        throw new Error('Combine-Input für den Join konnte nicht erstellt werden.');
    }
    combineInput.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation;
    const combineFeature = rootComp.features.combineFeatures.add(combineInput);
    if (!combineFeature) {
        throw new Error('Körper konnten nicht kombiniert (Join) werden.');
    }
    return target;
}

/**
 * 3b) Stufenabsatz / Rücksprung: Das obere Röhren-Segment (Länge ringExtrudeDepth)
 *     wird auf den Durchmesser ringInnerDiameter zurückgeschnitten.
 *     Werkzeug: das Ring-Profil zwischen den beiden skizzierten Kreisen (Cut).
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
    const errors: string[] = [];

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
        throw new Error('Ring-Profil (2 Loops) für den Stufenabsatz in der Bein-Skizze nicht gefunden.');
    }

    const depthReal = params.ringExtrudeDepth.value;

    const strategies: Array<() => adsk.fusion.ExtrudeFeature | null> = [
        () => {
            const input = extrudeFeatures.createInput(ringProfile!, adsk.fusion.FeatureOperations.CutFeatureOperation);
            const dist = adsk.core.ValueInput.createByString('-ring_extrude_depth');
            if (input && dist) { input.setDistanceExtent(false, dist); return extrudeFeatures.add(input); }
            return null;
        },
        () => {
            const input = extrudeFeatures.createInput(ringProfile!, adsk.fusion.FeatureOperations.CutFeatureOperation);
            const distVal = adsk.core.ValueInput.createByString('ring_extrude_depth');
            if (input && distVal) {
                const distDef = adsk.fusion.DistanceExtentDefinition.create(distVal);
                if (distDef) { input.setOneSideExtent(distDef, adsk.fusion.ExtentDirections.NegativeExtentDirection); return extrudeFeatures.add(input); }
            }
            return null;
        },
        () => {
            const input = extrudeFeatures.createInput(ringProfile!, adsk.fusion.FeatureOperations.CutFeatureOperation);
            const dist = adsk.core.ValueInput.createByReal(-1.0 * depthReal);
            if (input && dist) { input.setDistanceExtent(false, dist); return extrudeFeatures.add(input); }
            return null;
        },
        () => {
            const input = extrudeFeatures.createInput(ringProfile!, adsk.fusion.FeatureOperations.CutFeatureOperation);
            const dist = adsk.core.ValueInput.createByString('ring_extrude_depth');
            if (input && dist) { input.setDistanceExtent(false, dist); return extrudeFeatures.add(input); }
            return null;
        },
        () => {
            const input = extrudeFeatures.createInput(ringProfile!, adsk.fusion.FeatureOperations.CutFeatureOperation);
            const distVal = adsk.core.ValueInput.createByString('ring_extrude_depth');
            if (input && distVal) {
                const distDef = adsk.fusion.DistanceExtentDefinition.create(distVal);
                if (distDef) { input.setOneSideExtent(distDef, adsk.fusion.ExtentDirections.PositiveExtentDirection); return extrudeFeatures.add(input); }
            }
            return null;
        },
        () => {
            const input = extrudeFeatures.createInput(ringProfile!, adsk.fusion.FeatureOperations.CutFeatureOperation);
            const dist = adsk.core.ValueInput.createByReal(depthReal);
            if (input && dist) { input.setDistanceExtent(false, dist); return extrudeFeatures.add(input); }
            return null;
        }
    ];

    for (let idx = 0; idx < strategies.length; idx++) {
        let cutFeature: adsk.fusion.ExtrudeFeature | null = null;
        try {
            cutFeature = strategies[idx]();
        } catch (err) {
            errors.push(`Strat ${idx + 1}: ${err instanceof Error ? err.message : String(err)}`);
            continue;
        }

        if (cutFeature) {
            if (hasCylinderOfRadius(body, innerRadius, legAxis.dir)) {
                return;
            }
            cutFeature.deleteMe();
            errors.push(`Strat ${idx + 1}: Cut ausgeführt, aber gesuchte Zylinderfläche nicht gefunden`);
        } else {
            errors.push(`Strat ${idx + 1}: createInput/add lieferte null`);
        }
    }

    throw new Error(`Stufenabsatz (Rücksprung auf ringInnerDiameter) konnte nicht erzeugt werden.\nDetails:\n${errors.join('\n')}`);
}

/**
 * Findet das Profil mit der größten Fläche in einer Profil-Sammlung.
 * (Einheitunabhängig: nur relative Größen werden verglichen, da die API die
 * Fläche in einer festen Einheit liefert, die von der Parameter-Einheit
 * abweichen kann.)
 */
function findMaxAreaProfile(
    profiles: adsk.fusion.Profiles
): adsk.fusion.Profile | null {
    let best: adsk.fusion.Profile | null = null;
    let bestArea = -1;
    for (let i = 0; i < profiles.count; i++) {
        const prof = profiles.item(i);
        if (!prof) {
            continue;
        }
        const area = prof.areaProperties().area;
        if (area > bestArea) {
            bestArea = area;
            best = prof;
        }
    }
    return best;
}

/**
 * Prüft, ob der Körper eine Zylinderfläche mit (ungefähr) dem Radius `radius`
 * trägt. Bei übergebener Achse muss zusätzlich die Zylinderachse parallel
 * zu `axisDir` verlaufen (sonst wird nur der Radius geprüft).
 */
function hasCylinderOfRadius(
    body: adsk.fusion.BRepBody,
    radius: number,
    axisDir?: { x: number, y: number, z: number }
): boolean {
    for (let i = 0; i < body.faces.count; i++) {
        const face = body.faces.item(i);
        if (!face) {
            continue;
        }
        if (face.geometry.surfaceType !== adsk.core.SurfaceTypes.CylinderSurfaceType) {
            continue;
        }
        // CylinderSurface-Attribute (radius, axis.direction) per Cast lesen
        const surf = face.geometry as unknown as {
            radius?: number;
            axis?: { direction?: { x: number, y: number, z: number } };
        };
        if (surf.radius === undefined || Math.abs(surf.radius - radius) > TOL) {
            continue;
        }
        if (axisDir) {
            const d = surf.axis && surf.axis.direction;
            if (d) {
                const dot = Math.abs(d.x * axisDir.x + d.y * axisDir.y + d.z * axisDir.z);
                if (dot < 0.99) {
                    continue; // Achse nicht parallel zur Bein-Achse -> nicht die gesuchte Fläche
                }
            }
        }
        return true;
    }
    return false;
}

/**
 * 4) Übergangsverrundung (Fillet) an der Verschneidungskante zwischen
 *    Zylinderfuß des Beins und der Oberfläche der Basis-Platte.
 *    Gesucht: die (elliptische) Kante, die flach auf der Plattenoberfläche
 *    (z = basePlateHeight) liegt und nahe am Bein-Außendurchmesser verläuft.
 */
function filletLegPlateJunction(
    rootComp: adsk.fusion.Component,
    params: Params,
    body: adsk.fusion.BRepBody,
    legAxis: LegAxis
): void {
    const plateTopZ = params.basePlateHeight.value;
    const legOuterRadius = params.legOuterDiameter.value / 2.0;

    // Kanten-Suche mit einstellbarer Toleranz (nahe am Bein-Außendurchmesser,
    // flach auf der Plattenoberfläche)
    const collectCandidates = (width: number): adsk.fusion.BRepEdge[] => {
        const candidates: adsk.fusion.BRepEdge[] = [];
        for (let i = 0; i < body.edges.count; i++) {
            const edge = body.edges.item(i);
            if (!edge) {
                continue;
            }
            const bb = edge.boundingBox;
            if (!bb) {
                continue;
            }
            if (Math.abs(bb.minPoint.z - plateTopZ) > TOL || Math.abs(bb.maxPoint.z - plateTopZ) > TOL) {
                continue;
            }
            const p = edge.pointOnEdge;
            const r = radialDistance(p, legAxis);
            if (Math.abs(r - legOuterRadius) < width) {
                candidates.push(edge);
            }
        }
        return candidates;
    };

    // Fallback-Kaskade: Fusion kann den Fillet auf der geneigten Verschneidungskante
    // je nach Topologie ablehnen (ASM_BL_CANNOT_REORDER). Dann wird mit
    // schmalerer Kantentoleranz und/oder kleinerem Radius erneut versucht.
    const radiusScaleSteps = [1.0, 0.5, 0.3];
    const widthSteps = [5.0, 2.5];
    let lastError: string = '';

    for (const width of widthSteps) {
        const candidates = collectCandidates(width);
        if (candidates.length === 0) {
            continue;
        }
        for (const scale of radiusScaleSteps) {
            // Radius als Parameter-Expression -> Einheit bleibt garantiert korrekt
            const expr = scale === 1.0 ? 'leg_plate_rounding' : `leg_plate_rounding * ${scale}`;
            try {
                if (applyConstantRadiusFillet(rootComp, candidates, expr)) {
                    if (scale < 1.0) {
                        console.log(`Hinweis: Bein-/Platten-Fillet mit reduziertem Radius (${(params.legPlateRounding.value * scale).toFixed(2)} statt ${params.legPlateRounding.value}, interne API-Einheiten) erstellt.`);
                    }
                    return;
                }
                lastError = `Fillet (Radius ${expr}) wurde abgelehnt (null) [width=${width}]`;
            } catch (err) {
                lastError = err instanceof Error ? err.message : String(err);
            }
        }
    }

    if (lastError) {
        throw new Error(`Übergangsverrundung Bein/Platte konnte nicht erstellt werden. Letzter Fehler: ${lastError}`);
    }
    throw new Error('Verschneidungskante Bein/Basis-Platte konnte nicht gefunden werden.');
}

/**
 * Wendet einen konstanten Radius-Fillet auf die übergebenen Kanten an.
 * @param rootComp
 * @param edges
 * @param radiusExpr Expression für den Radius (Parameter-Referenz, z. B. "leg_plate_rounding"),
 *                   damit die Längeneinheit über den Parameter übernommen wird.
 * @returns true, wenn das Fillet erfolgreich erstellt wurde.
 * @throws Wenn Fusion den Fillet aktiv ablehnt (z. B. ASM_BL_CANNOT_REORDER).
 */
function applyConstantRadiusFillet(
    rootComp: adsk.fusion.Component,
    edges: adsk.fusion.BRepEdge[],
    radiusExpr: string
): boolean {
    const filletInput = rootComp.features.filletFeatures.createInput();
    if (!filletInput) {
        throw new Error('Fillet-Input konnte nicht erstellt werden.');
    }
    const edgeColl = adsk.core.ObjectCollection.create();
    for (const e of edges) {
        edgeColl.add(e);
    }
    filletInput.edgeSetInputs.addConstantRadiusEdgeSet(
        edgeColl,
        adsk.core.ValueInput.createByString(radiusExpr)!,
        false
    );
    const filletFeature = rootComp.features.filletFeatures.add(filletInput);
    if (!filletFeature) {
        return false;
    }
    return true;
}

/**
 * Radiale Distanz eines Punktes von der Bein-Achse (in mm).
 */
function radialDistance(p: adsk.core.Point3D, legAxis: LegAxis): number {
    const vx = p.x - legAxis.start.x;
    const vy = p.y - legAxis.start.y;
    const vz = p.z - legAxis.start.z;
    const t = vx * legAxis.dir.x + vy * legAxis.dir.y + vz * legAxis.dir.z;
    const rx = vx - t * legAxis.dir.x;
    const ry = vy - t * legAxis.dir.y;
    const rz = vz - t * legAxis.dir.z;
    return Math.sqrt(rx * rx + ry * ry + rz * rz);
}

/**
 * 5) Innenbohrung: Skizze auf der Ebene der oberen Stirnfläche der Röhre
 *    (Koinzidenz mit der geneigten Konstruktionsebene) mit einem Kreis vom
 *    Durchmesser holeInnerDiameter; extrudierter Schnitt (Cut) entlang der
 *    Bein-Achse durch die gesamte Röhre (durchgehend).
 */
function boreLegHole(
    rootComp: adsk.fusion.Component,
    params: Params,
    tiltedPlane: adsk.fusion.ConstructionPlane,
    body: adsk.fusion.BRepBody,
    legAxis: LegAxis
): void {
    const holeRadius = params.holeInnerDiameter.value / 2.0;

    // Skizze in der Ebene der oberen Stirnfläche (geneigte Konstruktionsebene),
    // Kreis um den Achsen-Endpunkt (Zentrum der Stirnfläche)
    const sketch = rootComp.sketches.add(tiltedPlane);
    if (!sketch) {
        throw new Error('Skizze für die Innenbohrung konnte nicht erstellt werden.');
    }
    const centerPoint = adsk.core.Point3D.create(0, 0, 0);
    if (!centerPoint) {
        throw new Error('Mittelpunkt (0,0,0) konnte nicht erstellt werden.');
    }
    sketch.sketchCurves.sketchCircles.addByCenterRadius(centerPoint, holeRadius);

    if (sketch.profiles.count < 1) {
        throw new Error('Kein Profil für die Innenbohrung gefunden.');
    }
    const profile = findMaxAreaProfile(sketch.profiles);
    if (!profile) {
        throw new Error('Profil der Innenbohrung konnte nicht ermittelt werden.');
    }

    const extrudeFeatures = rootComp.features.extrudeFeatures;
    const errors: string[] = [];
    const totalDistReal = params.legLength.value + params.basePlateHeight.value;

    const strategies: Array<() => adsk.fusion.ExtrudeFeature | null> = [
        () => {
            const input = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation);
            const dist = adsk.core.ValueInput.createByString('-leg_length - base_plate_height');
            if (input && dist) { input.setDistanceExtent(false, dist); return extrudeFeatures.add(input); }
            return null;
        },
        () => {
            const input = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation);
            const distVal = adsk.core.ValueInput.createByString('leg_length + base_plate_height');
            if (input && distVal) {
                const distDef = adsk.fusion.DistanceExtentDefinition.create(distVal);
                if (distDef) { input.setOneSideExtent(distDef, adsk.fusion.ExtentDirections.NegativeExtentDirection); return extrudeFeatures.add(input); }
            }
            return null;
        },
        () => {
            const input = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation);
            const dist = adsk.core.ValueInput.createByReal(-1.0 * totalDistReal);
            if (input && dist) { input.setDistanceExtent(false, dist); return extrudeFeatures.add(input); }
            return null;
        },
        () => {
            const input = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation);
            const dist = adsk.core.ValueInput.createByString('leg_length + base_plate_height');
            if (input && dist) { input.setDistanceExtent(false, dist); return extrudeFeatures.add(input); }
            return null;
        },
        () => {
            const input = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation);
            const distVal = adsk.core.ValueInput.createByString('leg_length + base_plate_height');
            if (input && distVal) {
                const distDef = adsk.fusion.DistanceExtentDefinition.create(distVal);
                if (distDef) { input.setOneSideExtent(distDef, adsk.fusion.ExtentDirections.PositiveExtentDirection); return extrudeFeatures.add(input); }
            }
            return null;
        },
        () => {
            const input = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation);
            const dist = adsk.core.ValueInput.createByReal(totalDistReal);
            if (input && dist) { input.setDistanceExtent(false, dist); return extrudeFeatures.add(input); }
            return null;
        }
    ];

    for (let idx = 0; idx < strategies.length; idx++) {
        let cutFeature: adsk.fusion.ExtrudeFeature | null = null;
        try {
            cutFeature = strategies[idx]();
        } catch (err) {
            errors.push(`Strat ${idx + 1}: ${err instanceof Error ? err.message : String(err)}`);
            continue;
        }

        if (cutFeature) {
            if (hasCylinderOfRadius(body, holeRadius, legAxis.dir)) {
                return;
            }
            cutFeature.deleteMe();
            errors.push(`Strat ${idx + 1}: Cut ausgeführt, aber Bohrung-Zylinderfläche nicht gefunden`);
        } else {
            errors.push(`Strat ${idx + 1}: createInput/add lieferte null`);
        }
    }

    throw new Error(`Innenbohrung konnte nicht erzeugt werden.\nDetails:\n${errors.join('\n')}`);
}

/**
 * 9) Unterseite bündig schneiden:
 *    Schneidet jeglichen Geometrieüberstand unterhalb der XY-Ebene (z < 0) ab,
 *    sodass die Unterseite der Basis-Platte vollständig plan ist.
 */
function trimBottomFlush(rootComp: adsk.fusion.Component, params: Params): void {
    const sketch = rootComp.sketches.add(rootComp.xYConstructionPlane);
    if (!sketch) {
        throw new Error('Skizze für den Unterseiten-Schnitt konnte nicht erstellt werden.');
    }

    const center = adsk.core.Point3D.create(0, 0, 0);
    if (!center) {
        throw new Error('Mittelpunkt (0,0,0) für den Unterseiten-Schnitt konnte nicht erstellt werden.');
    }

    // Großes Profil (doppelter Plattendurchmesser), das garantiert alle überstehenden Teile erfasst
    const cutRadius = params.basePlateDiameter.value;
    sketch.sketchCurves.sketchCircles.addByCenterRadius(center, cutRadius);

    if (sketch.profiles.count === 0) {
        throw new Error('Kein Profil für den Unterseiten-Schnitt gefunden.');
    }
    const profile = sketch.profiles.item(0);
    if (!profile) {
        throw new Error('Profil für den Unterseiten-Schnitt konnte nicht gelesen werden.');
    }

    const extrudeFeatures = rootComp.features.extrudeFeatures;
    const cutInput = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation);
    if (!cutInput) {
        throw new Error('Cut-Input für den Unterseiten-Schnitt konnte nicht erstellt werden.');
    }

    // Extrusion nach unten (in negative Z-Richtung relativ zur XY-Ebene)
    const distVal = adsk.core.ValueInput.createByString('leg_length + base_plate_height');
    if (distVal) {
        const distDef = adsk.fusion.DistanceExtentDefinition.create(distVal);
        if (distDef) {
            cutInput.setOneSideExtent(distDef, adsk.fusion.ExtentDirections.NegativeExtentDirection);
            try {
                const cutFeat = extrudeFeatures.add(cutInput);
                if (cutFeat) {
                    return;
                }
            } catch (_err) {
                // Fallback unten
            }
        }
    }

    // Fallback mit createByReal wenn setOneSideExtent/String fehlschlägt
    const fallbackDist = adsk.core.ValueInput.createByReal(-1.0 * (params.legLength.value + params.basePlateHeight.value));
    if (fallbackDist) {
        const fallbackInput = extrudeFeatures.createInput(profile, adsk.fusion.FeatureOperations.CutFeatureOperation);
        if (fallbackInput) {
            fallbackInput.setDistanceExtent(false, fallbackDist);
            extrudeFeatures.add(fallbackInput);
        }
    }
}

/**
 * 10) Ringförmiger Kabelkanal an der Unterseite der Basis-Platte mit Zugsicherung:
 *     - Ein geradliniger Außenkanal führt vom Plattenrand (x ≈ 85mm) zur konzentrischen Ringnut.
 *     - Konzentrische Ringnut (Radius 25mm, Breite 7.5mm, Tiefe 5mm) um das Beinloch.
 *     - Ein Trennsteg am Eingang zwingt das Kabel in die kreisförmige Schleife.
 *     - Ein radialer Innendurchlass führt auf der gegenüberliegenden Seite (θ = 180°) in das Beinloch.
 *     - Flache Klemmsteg-Vertiefungen (22mm x 12mm, Tiefe 2.5mm) bei +90° und -90° mit M3-Schraublöchern.
 */
function createBottomCableChannel(rootComp: adsk.fusion.Component, params: Params): void {
    const extrudeFeatures = rootComp.features.extrudeFeatures;

    const outerRadius = params.basePlateDiameter.value / 2.0; // cm (8.0cm)
    const legOffsetVal = params.legOffset.value; // cm (4.5cm)
    const widthVal = params.cableChannelWidth.value; // cm (0.75cm)
    const depthVal = params.cableChannelDepth.value; // cm (0.5cm)
    const recessWidth = params.clampRecessWidth.value; // cm (2.2cm)
    const recessLength = params.clampRecessLength.value; // cm (1.2cm)
    const recessDepth = params.clampRecessDepth.value; // cm (0.25cm)
    const screwDiameter = params.strainReliefScrewDiameter.value; // cm (0.26cm)
    const screwDepth = params.strainReliefScrewDepth.value; // cm (0.6cm)

    const center = adsk.core.Point3D.create(legOffsetVal, 0, 0);
    if (!center) {
        throw new Error('Mittelpunkt für Ringkanal konnte nicht erstellt werden.');
    }

    // =========================================================================
    // SCHRITT A: Klemmsteg-Vertiefungen (Flache Pockets 2.5mm an der Unterseite)
    // =========================================================================
    const recessSketch = rootComp.sketches.add(rootComp.xYConstructionPlane);
    if (!recessSketch) {
        throw new Error('Skizze für Klemmsteg-Vertiefungen konnte nicht erstellt werden.');
    }

    // Recess 1 bei (legOffsetVal, +2.5cm), Recess 2 bei (legOffsetVal, -2.5cm)
    const recessCenters = [
        { x: legOffsetVal, y: 2.5 },
        { x: legOffsetVal, y: -2.5 }
    ];

    for (const rc of recessCenters) {
        const halfX = recessLength / 2.0;
        const halfY = recessWidth / 2.0;
        const p1 = adsk.core.Point3D.create(rc.x - halfX, rc.y - halfY, 0);
        const p2 = adsk.core.Point3D.create(rc.x + halfX, rc.y - halfY, 0);
        const p3 = adsk.core.Point3D.create(rc.x + halfX, rc.y + halfY, 0);
        const p4 = adsk.core.Point3D.create(rc.x - halfX, rc.y + halfY, 0);
        if (p1 && p2 && p3 && p4) {
            const l = recessSketch.sketchCurves.sketchLines;
            l.addByTwoPoints(p1, p2);
            l.addByTwoPoints(p2, p3);
            l.addByTwoPoints(p3, p4);
            l.addByTwoPoints(p4, p1);
        }
    }

    if (recessSketch.profiles.count > 0) {
        const recessProfColl = adsk.core.ObjectCollection.create();
        if (recessProfColl) {
            for (let i = 0; i < recessSketch.profiles.count; i++) {
                const prof = recessSketch.profiles.item(i);
                if (prof) {
                    recessProfColl.add(prof);
                }
            }
            const recessCutInput = extrudeFeatures.createInput(recessProfColl, adsk.fusion.FeatureOperations.CutFeatureOperation);
            const recessDistVal = adsk.core.ValueInput.createByString('clamp_recess_depth');
            if (recessCutInput && recessDistVal) {
                recessCutInput.setDistanceExtent(false, recessDistVal);
                extrudeFeatures.add(recessCutInput);
            }
        }
    }

    // =========================================================================
    // SCHRITT B: Ringkanal, Außenkanal & Innendurchlass (Cut 5.0mm)
    // =========================================================================
    const channelSketch = rootComp.sketches.add(rootComp.xYConstructionPlane);
    if (!channelSketch) {
        throw new Error('Skizze für den Ringkanal konnte nicht erstellt werden.');
    }

    const ringRadius = 2.5; // cm
    const rIn = ringRadius - widthVal / 2.0; // 2.125 cm
    const rOut = ringRadius + widthVal / 2.0; // 2.875 cm

    // 1. Konzentrische Kreise der Ringnut um (legOffsetVal, 0)
    channelSketch.sketchCurves.sketchCircles.addByCenterRadius(center, rIn);
    channelSketch.sketchCurves.sketchCircles.addByCenterRadius(center, rOut);

    // 2. Außenkanal (Rechteck von x = outerRadius + 0.5 bis x = legOffsetVal + rOut)
    const xOuterStart = outerRadius + 0.5;
    const xOuterEnd = legOffsetVal + rOut;
    const halfW = widthVal / 2.0;

    const op1 = adsk.core.Point3D.create(xOuterEnd, -halfW, 0);
    const op2 = adsk.core.Point3D.create(xOuterStart, -halfW, 0);
    const op3 = adsk.core.Point3D.create(xOuterStart, halfW, 0);
    const op4 = adsk.core.Point3D.create(xOuterEnd, halfW, 0);
    if (op1 && op2 && op3 && op4) {
        const l = channelSketch.sketchCurves.sketchLines;
        l.addByTwoPoints(op1, op2);
        l.addByTwoPoints(op2, op3);
        l.addByTwoPoints(op3, op4);
        l.addByTwoPoints(op4, op1);
    }

    // 3. Innendurchlass zur Beinbohrung bei θ = 180° (x <= legOffsetVal - rIn)
    const xInnerStart = legOffsetVal - rOut;
    const xInnerEnd = legOffsetVal - 1.2; // in die Beinbohrung hinein

    const ip1 = adsk.core.Point3D.create(xInnerStart, -halfW, 0);
    const ip2 = adsk.core.Point3D.create(xInnerEnd, -halfW, 0);
    const ip3 = adsk.core.Point3D.create(xInnerEnd, halfW, 0);
    const ip4 = adsk.core.Point3D.create(xInnerStart, halfW, 0);
    if (ip1 && ip2 && ip3 && ip4) {
        const l = channelSketch.sketchCurves.sketchLines;
        l.addByTwoPoints(ip1, ip2);
        l.addByTwoPoints(ip2, ip3);
        l.addByTwoPoints(ip3, ip4);
        l.addByTwoPoints(ip4, ip1);
    }

    // 4. Trennsteg (Sperre): Ein vertikaler Steg bei x = legOffsetVal + 1.8cm, y ∈ [-halfW, halfW]
    // Damit das Kabel nicht direkt vom Außenkanal in die Beinbohrung springt, sondern durch die Ringnut läuft!
    const bp1 = adsk.core.Point3D.create(legOffsetVal + rIn, -halfW, 0);
    const bp2 = adsk.core.Point3D.create(legOffsetVal + rOut, -halfW, 0);
    const bp3 = adsk.core.Point3D.create(legOffsetVal + rOut, halfW, 0);
    const bp4 = adsk.core.Point3D.create(legOffsetVal + rIn, halfW, 0);
    if (bp1 && bp2 && bp3 && bp4) {
        const l = channelSketch.sketchCurves.sketchLines;
        l.addByTwoPoints(bp1, bp2);
        l.addByTwoPoints(bp2, bp3);
        l.addByTwoPoints(bp3, bp4);
        l.addByTwoPoints(bp4, bp1);
    }

    if (channelSketch.profiles.count > 0) {
        const channelProfColl = adsk.core.ObjectCollection.create();
        if (channelProfColl) {
            for (let i = 0; i < channelSketch.profiles.count; i++) {
                const prof = channelSketch.profiles.item(i);
                if (!prof) {
                    continue;
                }
                const bb = prof.boundingBox;
                if (!bb) {
                    continue;
                }
                // Filtere nur Profile im Bereich des Kabelkanals
                const minX = bb.minPoint.x;
                const maxX = bb.maxPoint.x;
                const minY = bb.minPoint.y;
                const maxY = bb.maxPoint.y;

                // Liegt das Profil im Kabelkanal-Bereich?
                if (maxX >= (legOffsetVal - rOut - 0.5) && minX <= (xOuterStart + 0.5) &&
                    minY >= (-rOut - 0.5) && maxY <= (rOut + 0.5)) {
                    // Ausschluss des ungeschnittenen Innenkerns (Beinbohrung), falls vorhanden
                    const centerX = (minX + maxX) / 2.0;
                    const centerY = (minY + maxY) / 2.0;
                    const distToCenter = Math.sqrt((centerX - legOffsetVal) * (centerX - legOffsetVal) + centerY * centerY);

                    // Profile der Nut liegen bei Distanz ~2.5cm oder Außen/Innendurchlass
                    if (distToCenter > 0.5 || minX > legOffsetVal + rIn) {
                        channelProfColl.add(prof);
                    }
                }
            }

            if (channelProfColl.count > 0) {
                const cutInput = extrudeFeatures.createInput(channelProfColl, adsk.fusion.FeatureOperations.CutFeatureOperation);
                const depthDistVal = adsk.core.ValueInput.createByString('cable_channel_depth');
                if (cutInput && depthDistVal) {
                    cutInput.setDistanceExtent(false, depthDistVal);
                    extrudeFeatures.add(cutInput);
                }
            }
        }
    }

    // =========================================================================
    // SCHRITT C: M3 Schraublöcher (Tiefe 6.0mm) in den Vertiefungen
    // =========================================================================
    const screwSketch = rootComp.sketches.add(rootComp.xYConstructionPlane);
    if (!screwSketch) {
        throw new Error('Skizze für Zugsicherungs-Bohrungen konnte nicht erstellt werden.');
    }

    const screwRadius = screwDiameter / 2.0;
    const screwOffsetFromCenter = 0.65; // cm (6.5mm seitlich)

    const screwPoints: Array<{ x: number, y: number }> = [
        // Recess 1 (oben bei y = 2.5): innen (y = 1.75cm) und außen (y = 3.25cm)
        { x: legOffsetVal, y: 2.5 - screwOffsetFromCenter },
        { x: legOffsetVal, y: 2.5 + screwOffsetFromCenter },
        // Recess 2 (unten bei y = -2.5): innen (y = -1.75cm) und außen (y = -3.25cm)
        { x: legOffsetVal, y: -2.5 + screwOffsetFromCenter },
        { x: legOffsetVal, y: -2.5 - screwOffsetFromCenter }
    ];

    for (const pt of screwPoints) {
        const centerPt = adsk.core.Point3D.create(pt.x, pt.y, 0);
        if (centerPt) {
            screwSketch.sketchCurves.sketchCircles.addByCenterRadius(centerPt, screwRadius);
        }
    }

    if (screwSketch.profiles.count > 0) {
        const screwProfColl = adsk.core.ObjectCollection.create();
        if (screwProfColl) {
            for (let i = 0; i < screwSketch.profiles.count; i++) {
                const prof = screwSketch.profiles.item(i);
                if (prof) {
                    screwProfColl.add(prof);
                }
            }
            const screwCutInput = extrudeFeatures.createInput(screwProfColl, adsk.fusion.FeatureOperations.CutFeatureOperation);
            const screwDepthDist = adsk.core.ValueInput.createByString('strain_relief_screw_depth');
            if (screwCutInput && screwDepthDist) {
                screwCutInput.setDistanceExtent(false, screwDepthDist);
                extrudeFeatures.add(screwCutInput);
            }
        }
    }
}