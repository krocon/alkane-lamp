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

        // 2. TODO

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

