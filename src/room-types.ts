// What kind of room an area is, recognized from its name (in the card's eight languages) or its
// icon. The type picks the room's icon, its size and furniture in the 3D house, and whether it
// is outdoors.

export type RoomType =
  | 'living'
  | 'kitchen'
  | 'dining'
  | 'bedroom'
  | 'kids'
  | 'guest'
  | 'bathroom'
  | 'office'
  | 'laundry'
  | 'garage'
  | 'media'
  | 'gym'
  | 'hallway'
  | 'stairs'
  | 'closet'
  | 'storage'
  | 'basement'
  | 'attic'
  | 'porch'
  | 'balcony'
  | 'garden'
  | 'driveway'
  | 'pool'
  | 'room';

export const OUTDOOR_TYPES: ReadonlySet<RoomType> = new Set(['porch', 'balcony', 'garden', 'driveway', 'pool']);

interface TypeRule {
  type: RoomType;
  icon: string;
  name: RegExp;
}

// First match wins, so specific rooms come before the general words they contain
// ("Kids Bedroom" is a kids room, "Guest Bedroom" a guest room, "Dining Room" not a living room).
const RULES: TypeRule[] = [
  {
    type: 'kids',
    icon: 'mdi:teddy-bear',
    name: /nursery|baby|kid|child|playroom|kinder|enfant|infantil|niños|cameretta|bambin|dziec|criança/i,
  },
  { type: 'guest', icon: 'mdi:bed-outline', name: /guest|gäste|gast|invités|invitados|ospiti|gości|hóspedes/i },
  {
    type: 'dining',
    icon: 'mdi:silverware-fork-knife',
    name: /dining|dinner|esszimmer|eetkamer|salle à manger|comedor|sala da pranzo|jadalnia|sala de jantar/i,
  },
  {
    type: 'media',
    icon: 'mdi:television',
    name: /media|theat|cinema|kino|\btv\b|game|spiel|bioscoop|cinéma|cine\b|home ?cinema/i,
  },
  {
    type: 'living',
    icon: 'mdi:sofa',
    name: /living|lounge|family|sitting|wohn|woonkamer|séjour|salon|salón|sala de estar|soggiorno|salotto|pokój dzienny|sala/i,
  },
  { type: 'kitchen', icon: 'mdi:stove', name: /kitchen|küche|keuken|cuisine|cocina|cucina|kuchnia|cozinha/i },
  {
    type: 'bathroom',
    icon: 'mdi:shower',
    name: /bath|shower|toilet|\bwc\b|restroom|powder|lavatory|\bbad\b|badezimmer|badkamer|salle de bain|salle d'eau|baño|aseo|bagno|łazienka|lazienka|banheiro|casa de banho/i,
  },
  {
    type: 'bedroom',
    icon: 'mdi:bed',
    name: /bed|sleep|master|schlaf|slaapkamer|chambre|dormitorio|habitación|camera da letto|camera|sypialnia|quarto/i,
  },
  {
    type: 'office',
    icon: 'mdi:desk',
    name: /office|study|\bden\b|work|büro|arbeitszimmer|kantoor|werkkamer|bureau|oficina|despacho|ufficio|studio|biuro|gabinet|escritório/i,
  },
  {
    type: 'laundry',
    icon: 'mdi:washing-machine',
    name: /laundry|utility|wasch|washok|wasruimte|buanderie|lavadero|lavanderia|pralnia/i,
  },
  { type: 'garage', icon: 'mdi:garage', name: /garage|carport|garaje|garagem|garaż/i },
  {
    type: 'basement',
    icon: 'mdi:stairs-down',
    name: /basement|cellar|keller|kelder|sous-sol|cave|sótano|cantina|seminterrato|piwnica|porão/i,
  },
  {
    type: 'attic',
    icon: 'mdi:home-roof',
    name: /attic|loft|dachboden|zolder|grenier|ático|buhardilla|soffitta|mansarda|strych|sótão/i,
  },
  { type: 'stairs', icon: 'mdi:stairs', name: /stair|landing|treppe|trap|escalier|escalera|scala|schody|escada/i },
  {
    type: 'hallway',
    icon: 'mdi:door',
    name: /hall|corridor|entry|entrance|foyer|vestibule|mudroom|flur|diele|gang|\bhal\b|couloir|entrée|pasillo|recibidor|corridoio|ingresso|korytarz|przedpokój|corredor|entrada/i,
  },
  { type: 'gym', icon: 'mdi:dumbbell', name: /gym|fitness|workout|sport|siłownia|academia|palestra/i },
  {
    type: 'closet',
    icon: 'mdi:hanger',
    name: /closet|wardrobe|dressing|ankleide|kleedkamer|vestidor|cabina armadio|garderob/i,
  },
  {
    type: 'storage',
    icon: 'mdi:package-variant',
    name: /pantry|storage|store|vorrat|abstell|berging|cellier|despensa|dispensa|spiżarnia/i,
  },
  { type: 'balcony', icon: 'mdi:balcony', name: /balcon|balkon|balcone|balcón|sacada/i },
  {
    type: 'porch',
    icon: 'mdi:outdoor-lamp',
    name: /porch|patio|deck|terrace|terras|terrasse|terraza|terrazzo|taras|varanda|veranda|front ?door|entrance/i,
  },
  {
    type: 'driveway',
    icon: 'mdi:road-variant',
    name: /driveway|carport|einfahrt|oprit|allée|entrada de coches|vialetto|podjazd/i,
  },
  { type: 'pool', icon: 'mdi:pool', name: /pool|piscine|piscina|zwembad|basen/i },
  {
    type: 'garden',
    icon: 'mdi:tree',
    name: /garden|yard|lawn|backyard|outdoor|outside|exterior|garten|tuin|jardin|jardín|giardino|ogród|ogrod|jardim|quintal|buiten|außen|aussen/i,
  },
];

/** Area icons that say what a room is when its name doesn't. */
const ICON_TYPES: Record<string, RoomType> = {
  'mdi:sofa': 'living',
  'mdi:sofa-outline': 'living',
  'mdi:stove': 'kitchen',
  'mdi:fridge': 'kitchen',
  'mdi:silverware-fork-knife': 'dining',
  'mdi:table-chair': 'dining',
  'mdi:bed': 'bedroom',
  'mdi:bed-king': 'bedroom',
  'mdi:bed-double': 'bedroom',
  'mdi:bed-outline': 'guest',
  'mdi:bed-empty': 'guest',
  'mdi:teddy-bear': 'kids',
  'mdi:baby-carriage': 'kids',
  'mdi:shower': 'bathroom',
  'mdi:bathtub': 'bathroom',
  'mdi:toilet': 'bathroom',
  'mdi:desk': 'office',
  'mdi:laptop': 'office',
  'mdi:washing-machine': 'laundry',
  'mdi:garage': 'garage',
  'mdi:garage-variant': 'garage',
  'mdi:television': 'media',
  'mdi:theater': 'media',
  'mdi:dumbbell': 'gym',
  'mdi:door': 'hallway',
  'mdi:stairs': 'stairs',
  'mdi:hanger': 'closet',
  'mdi:home-roof': 'attic',
  'mdi:tree': 'garden',
  'mdi:flower': 'garden',
  'mdi:pool': 'pool',
  'mdi:balcony': 'balcony',
  'mdi:outdoor-lamp': 'porch',
  'mdi:road-variant': 'driveway',
};

// Whole words only, so "Finished Basement" isn't a shed and "Kindergarten" isn't a garden.
const OUTDOOR_WORDS =
  /(?:^|[^\p{L}])(?:garden|yard|front ?yard|backyard|lawn|patio|deck|terrace|porch|driveway|outdoors?|outside|exterior|front ?door|pool|shed|pergola|carport|gazebo|balcony|garten|vorgarten|hinterhof|terrasse|einfahrt|balkon|au(?:ß|ss)en(?:bereich)?|tuin|voortuin|achtertuin|oprit|buiten|jardin|extérieur|allée|balcon|jardín|terraza|porche|balcón|giardino|terrazzo|esterno|vialetto|balcone|ogród|ogrod|taras|podjazd|zewnątrz|jardim|terraço|quintal|varanda|sacada)(?:$|[^\p{L}])/iu;

/** A room-type noun keeps a space indoors: "Pool Room", "Garden Room", "Gartenzimmer". */
const INDOOR_WORDS =
  /(?:^|[^\p{L}])(?:room|house|hall|sunroom|zimmer|raum|kamer|chambre|salle|sala|stanza|pokój|quarto)(?:$|[^\p{L}])/iu;

export function isOutdoorName(name: string): boolean {
  return OUTDOOR_WORDS.test(name) && !INDOOR_WORDS.test(name);
}

/** The room type for an area name, falling back to its icon, then to a generic room. */
export function roomType(name: string, icon?: string | null, outdoor = isOutdoorName(name)): RoomType {
  for (const rule of RULES) {
    if (!rule.name.test(name)) continue;
    // "Pool Room" is indoors: outdoor types only count for outdoor areas, and vice versa.
    if (OUTDOOR_TYPES.has(rule.type) !== outdoor) continue;
    return rule.type;
  }
  const byIcon = icon ? ICON_TYPES[icon] : undefined;
  if (byIcon && OUTDOOR_TYPES.has(byIcon) === outdoor) return byIcon;
  return outdoor ? 'garden' : 'room';
}

export function roomIcon(name: string, icon?: string | null): string {
  if (icon) return icon;
  for (const rule of RULES) if (rule.name.test(name)) return rule.icon;
  return 'mdi:texture-box';
}
