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

        // 2. Einfache Röhre erzeugen (Verbindungs-Bein zwischen zwei Tetrapod-Knoten)
        const tubeBody = createLegTube(rootComp, params);
        tubeBody.name = 'Parametric_Tetrapod_Leg_Pipe';

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
        legOuterDiameter: getOrCreateParam('leg_outer_diameter', '46mm', 'mm', 'Aussendurchmesser der Röhre'),
        legInnerDiameter: getOrCreateParam('leg_inner_diameter', '40.05mm', 'mm', 'Innendurchmesser der Röhre'),
        legLength: getOrCreateParam('leg_length', '80mm', 'mm', 'Laenge der Röhre')
    };
}

/**
 * Erstellt eine einfache Röhre, die zwei Tetrapod-Knoten verbindet.
 * Geometrie: Zwei konzentrische Kreise (außen/innen) auf der XY-Ebene,
 * der resultierende Ring wird entlang der -Z-Achse um leg_length extrudiert.
 *
 * @param rootComp Die Wurzelkomponente des Designs.
 * @param params Die konfigurierten Benutzerparameter.
 * @returns Der erzeugte BRepBody der Röhre.
 */
function createLegTube(
  rootComp: adsk.fusion.Component,
  params: ReturnType<typeof setupParameters>
): adsk.fusion.BRepBody {

    const sketches = rootComp.sketches;
    const features = rootComp.features;
    const extrudeFeatures = features.extrudeFeatures;

    const center = adsk.core.Point3D.create(0, 0, 0);
    if (!center) {
        throw new Error('Konnte den Mittelpunkt (0,0,0) nicht erstellen.');
    }

    // Skizze auf der XY-Ebene erstellen (Außen- + Innenkreis -> Ring)
    const sketch = sketches.add(rootComp.xYConstructionPlane);
    if (!sketch) {
        throw new Error('Skizze konnte nicht auf der XY-Ebene erstellt werden.');
    }

    sketch.sketchCurves.sketchCircles.addByCenterRadius(center, params.legOuterDiameter.value / 2.0);
    sketch.sketchCurves.sketchCircles.addByCenterRadius(center, params.legInnerDiameter.value / 2.0);

    let ringProfile: adsk.fusion.Profile | null = null;

    // Profil identifizieren: Der Ring zwischen den Kreisen hat 2 Loops, der volle innere Kreis 1 Loop
    for (let i = 0; i < sketch.profiles.count; i++) {
        const prof = sketch.profiles.item(i);
        if (prof && prof.profileLoops.count === 2) {
            ringProfile = prof;
            break;
        }
    }

    // Fallback-Logik zur Profilfindung falls die Loop-Zählung nicht eindeutig ist
    if (!ringProfile && sketch.profiles.count >= 2) {
        const prof0 = sketch.profiles.item(0);
        const prof1 = sketch.profiles.item(1);
        if (prof0 && prof1) {
            // Der Ring hat die größere Fläche
            ringProfile = prof0.areaProperties().area < prof1.areaProperties().area ? prof1 : prof0;
        }
    }

    if (!ringProfile) {
        throw new Error('Konnte das Ring-Profil für die Röhre nicht finden.');
    }

    // Röhre: Äußeren Ring in -Z-Richtung extrudieren (Länge über Parameter gesteuert)
    const extInputRing = extrudeFeatures.createInput(ringProfile, adsk.fusion.FeatureOperations.NewBodyFeatureOperation);
    if (!extInputRing) {
        throw new Error('Extrusions-Input konnte nicht erstellt werden.');
    }

    const distanceExtent = adsk.core.ValueInput.createByString('-leg_length'); // Negative Richtung entlang der normalen Achse (Z)
    if (!distanceExtent) {
        throw new Error('Extrusionslänge konnte nicht erstellt werden.');
    }
    extInputRing.setDistanceExtent(false, distanceExtent);

    const extrudeFeature = extrudeFeatures.add(extInputRing);
    if (!extrudeFeature || extrudeFeature.bodies.count === 0) {
        throw new Error('Röhre konnte nicht extrudiert werden.');
    }

    const tubeBody = extrudeFeature.bodies.item(0);
    if (!tubeBody) {
        throw new Error('Kein Körper nach der Extrusion gefunden.');
    }
    return tubeBody;
}
