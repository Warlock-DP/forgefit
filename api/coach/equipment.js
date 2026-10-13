// Audited home movements. Unknown requirements are excluded, never guessed from
// the catalogue's single primary-equipment label.
const floor = new Set(['0662', '0259', '2398', '0283', '1311', '0815', '2368', '1460', '1685', '0871', '3420']);
const dumbbells = new Set(['0285', '0293', '0294', '0298', '0300', '0310', '0309', '0311', '1760', '0313', '0312', '3635', '0334', '0336', '0380', '0413', '0430', '0432']);
const bar = new Set(['0652', '0139', '0140', '1326', '1327', '1429', '1367']);
export function requirements(ex) {
  if (floor.has(ex.id)) return [];
  if (dumbbells.has(ex.id)) return ['dumbbell'];
  if (bar.has(ex.id)) return ['pull-up bar'];
  // Catalogue movements outside the audited set require a full-gym profile.
  return null;
}
export function compatible(ex, equipment = []) {
  const available = new Set((Array.isArray(equipment) ? equipment : []).map(x => String(x).toLowerCase()));
  if (available.has('full gym')) return true;
  const needed = requirements(ex);
  return needed !== null && needed.every(x => available.has(x));
}
