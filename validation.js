export function defaultPlanning() {
  return { entries: [], settings: { weeklyTargetMinutes: 1500, hourlyRateGross: 0, employeeLabel: 'Mon planning', ocrEmployeeName: '' } };
}

function text(value, max, fallback = '') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max) throw new Error('Texte invalide ou trop long.');
  return value;
}
function number(value, max, fallback = 0) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0 || value > max) throw new Error('Valeur numérique invalide.');
  return value;
}
export function validatePlanning(value) {
  if (!value || !Array.isArray(value.entries) || value.entries.length > 10000 || !value.settings) throw new Error('Sauvegarde de planning invalide.');
  const dates = new Set();
  const entries = value.entries.map(e => {
    if (!e || typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !Number.isFinite(Date.parse(e.date)) || new Date(e.date).toISOString().slice(0,10) !== e.date || dates.has(e.date)) throw new Error('Date invalide ou en double.');
    dates.add(e.date);
    if (!['work','rest','leave','sick','training'].includes(e.type) || !Array.isArray(e.segments) || e.segments.length > 24) throw new Error('Journée invalide.');
    return { date:e.date, type:e.type, note:text(e.note, 2000), segments:e.segments.map(s => {
      if (!s || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.end)) throw new Error('Horaire invalide.');
      // Ignore imported IDs: these values are interpolated in the legacy editor.
      return { id:crypto.randomUUID(), start:s.start, end:s.end, breakMinutes:number(s.breakMinutes, 1440) };
    }) };
  });
  const s = value.settings;
  return { entries:entries.sort((a,b)=>a.date.localeCompare(b.date)), settings: {
    weeklyTargetMinutes:number(s.weeklyTargetMinutes, 10080, 1500),
    hourlyRateGross:number(s.hourlyRateGross, 100000),
    employeeLabel:text(s.employeeLabel, 100, 'Mon planning'),
    ocrEmployeeName:text(s.ocrEmployeeName, 100)
  } };
}
