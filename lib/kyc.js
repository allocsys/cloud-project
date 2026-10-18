// Verification rules shared by the browser form and the server, so both agree.
export const COUNTRIES = [
  'United States', 'United Kingdom', 'Canada', 'Germany', 'France', 'Spain', 'Italy',
  'Netherlands', 'Australia', 'United Arab Emirates', 'Other',
];
export const DOCS = ['Passport', 'ID card', 'Licence'];
export const MAX_PHOTO = 12 * 1024 * 1024; // bytes per photo

export function ageOf(s) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return 0;
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  const m = n.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a -= 1;
  return a;
}
