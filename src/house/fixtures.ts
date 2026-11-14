// What kind of fixture a light is, going by its name (in the card's eight languages). The kind
// picks the picture on the light's tile and the lamp that stands for it in the 3D house.

export type FixtureKind = 'ceiling' | 'pendant' | 'lamp' | 'strip';

const STRIP =
  /strip|led|backlight|bias|cove|cabinet|ambilight|gradient|band|string|fairy|streifen|lichterkette|striscia|tira|taśma|fita|ruban|guirlande|kast/i;
/** Lights that hang down on a cord, over a table or a kitchen island. */
export const PENDANT =
  /pendant|chandelier|island|pendel|hänge|kroonluchter|lustre|suspension|araña|lampadario|sospensione|żyrandol|pendente|luminaire/i;
const LAMP =
  /lamp|lampe|lámpara|lampada|lampa|luminária|candeeiro|abajur|bedside|nightstand|night ?light|reading|desk|table|floor|stehlampe|nachttisch|schreibtisch|leuchte|vloer|bureau|lampadaire|chevet|piantana|comodino|nocna|podłogowa|lantern|laterne|lanterna|latarnia|sconce/i;

export function fixtureKind(name: string): FixtureKind {
  if (STRIP.test(name)) return 'strip';
  if (PENDANT.test(name)) return 'pendant';
  if (LAMP.test(name)) return 'lamp';
  return 'ceiling';
}
