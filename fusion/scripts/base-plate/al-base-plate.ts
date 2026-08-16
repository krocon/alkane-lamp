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

        // 2.
        /* TODO

Verwende die folgende Schritt-für-Schritt-Anweisung als Prompt, um das Fusion-Skript zu erweitern:

---

**Anforderung zur Skript-Erstellung:**

Erweitere das Fusion-360-Python-Skript um die schrittweise Konstruktion des gezeigten Körpers unter Verwendung der definierten Parameter.

1. **Basis-Platte (Base Plate):**
* Erstelle eine Skizze auf der XY-Ebene.
* Zeichne einen Kreis im Ursprung mit dem Durchmesser `basePlateDiameter`.
* Extrudiere das Profil nach oben (Z-Achse) um den Wert `basePlateHeight`.
* Wende an der oberen umlaufenden Kante der Zylinderplatte eine Verrundung (`Fillet`) mit dem Radius `basePlateRounding` an.


2. **Geneigte Bein-Achse & Konstruktionsebene:**
* Erstelle eine Referenzskizze auf der XZ-Ebene.
* Zeichne die Mittelachse des Beins mit der Länge `legLength` im Winkel `legAngle` zur XY-Ebene.
* Erstelle eine Konstruktionsebene rechtwinklig am Endpunkt/Verlauf dieser Achse (`Plane Along Path` oder `Plane at Angle`).


3. **Äußerer Röhrenkörper & Stufenabsatz:**
* Erstelle eine Skizze auf der geneigten Konstruktionsebene.
* Zeichne zwei konzentrische Kreise um die Achse: den ersten mit `legOuterDiameter` und den zweiten mit `ringInnerDiameter`.
* Extrudiere den Zylinder mit `legOuterDiameter` entlang der Achse nach unten bis zur Basis-Platte und kombiniere die Geometrie (`Join`).
* Erzeuge den Stufenabsatz / Rücksprung am Bein mit dem Durchmesser `ringInnerDiameter` und der Tiefe `ringExtrudeDepth`.


4. **Übergangsverrundung (Bein zu Basis-Platte):**
* Wende an der Verschneidungskante zwischen dem Zylinderfuß des Beins und der Oberfläche der Basis-Platte eine Verrundung (`Fillet`) an.
* Nutze hierfür den Parameter/Radius `legPlateRounding`.


5. **Innenbohrung (Hole):**
* Erstelle auf der oberen Stirnfläche der Röhre eine Skizze mit einem Kreis vom Durchmesser `holeInnerDiameter`.
* Führe einen extrudierten Schnitt (`Cut`) entlang der Beinachse durch die gesamte Röhre aus, um die durchgehende Innenbohrung zu erzeugen.

        */
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

        ringInnerDiameter: getOrCreateParam('ring_inner_diameter', '40mm', 'mm', 'Durchmesser der erhabenen Stirnflaeche'),
        ringExtrudeDepth: getOrCreateParam('ring_extrude_depth', '50mm', 'mm', 'Tiefe des Rumpfabsatzes / Rücksprungs'),

        holeInnerDiameter: getOrCreateParam('hole_inner_diameter', '31.5.0mm', 'mm', 'Innendurchmesser der Röhre (Loch)'),
        legLength: getOrCreateParam('leg_length', '80mm', 'mm', 'Laenge der Röhre'),
        legAngle: getOrCreateParam('leg_angle', '120', 'degree', 'Winkel des Beines zur XY-Ebene'),
        legPlateRounding: getOrCreateParam('leg_plate_rounding', '120', 'degree', 'Abrundung der Kante: Bein und Platte')
    };
}

