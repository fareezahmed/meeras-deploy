#!/usr/bin/env node
/* Headless tests for the farāʾiḍ engine embedded in index.html.
 *
 *   npm test                      (or: node tests/faraid-engine.test.js)
 *   MAWARITH=/path/to/Mawarith-Calculator.html npm test
 *
 * The engine is pure JavaScript (no DOM), so the script slices section 3 of
 * index.html out and evaluates it in a vm sandbox with a fake STATE. If the
 * Al-Mawārīth calculator is found (default: ../mawarith/Mawarith-Calculator.html,
 * or $MAWARITH) its engine is loaded into the same process and 5,000 random
 * families drawn from the Meeras heir model are compared under the default
 * rules and under the Ḥanafī rules. Exit code 1 on any failure.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadMeeras(file) {
  const html = fs.readFileSync(file, 'utf8');
  const start = html.indexOf('// 3.  FARĀʾIḌ ENGINE');
  const end = html.indexOf('// 4.  STATE METADATA');
  if (start < 0 || end < 0) throw new Error('engine markers not found in ' + file);
  const src = html.slice(start, end);
  const ctx = { console, Math, JSON, Object, Array, String, Number, Error, STATE: null };
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.__api = { calculateFaraid, rulesForMadhhab, MADHHABS, fracToString };', ctx, { filename: file });
  const api = ctx.__api;
  api.setState = s => { ctx.STATE = s; };
  return api;
}

function loadMawarith(file) {
  const html = fs.readFileSync(file, 'utf8');
  const start = html.indexOf('const gcd = (a, b) =>');
  const endMarker = html.indexOf('* COLOUR PALETTE FOR SHARES');
  if (start < 0 || endMarker < 0) throw new Error('engine markers not found in ' + file);
  let src = html.slice(start, endMarker);
  src = src.slice(0, src.lastIndexOf('/*'));
  const ctx = {
    console, Intl, Math, JSON, Number, String, Object, Array, Promise, Error,
    setTimeout, clearTimeout,
    navigator: { language: 'en-AU' },
    fetch: () => Promise.reject(new Error('offline')),
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    window: {}, document: {}
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.__api = { calcSunni, defaultHeirs, f, fStr, fVal };', ctx, { filename: file });
  return ctx.__api;
}

const M = loadMeeras(path.join(ROOT, 'index.html'));
const { calculateFaraid, rulesForMadhhab, fracToString } = M;

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; return; }
  fail++;
  console.error('  FAIL  ' + name + (detail !== undefined ? '  ->  ' + JSON.stringify(detail) : ''));
};

/* ---- Family builder in the Meeras heir model ------------------------------
 * H({ wives: 2, husband: true, sons, daughters, father, mother, pgf, pgm, mgm,
 *     fullBrothers, fullSisters }) -> Meeras heirs object; sex is passed to run(). */
const H = o => {
  o = o || {};
  const spouses = [];
  if (o.husband) spouses.push({ name: 'Husband' });
  for (let i = 1; i <= (o.wives || 0); i++) spouses.push({ name: 'Wife ' + i });
  return {
    spouses,
    sons: o.sons || 0, daughters: o.daughters || 0,
    fatherAlive: !!o.father, motherAlive: !!o.mother,
    fullBrothers: o.fullBrothers || 0, fullSisters: o.fullSisters || 0,
    paternalGrandfatherAlive: !!o.pgf, paternalGrandmotherAlive: !!o.pgm, maternalGrandmotherAlive: !!o.mgm,
    rulings: {}, sex: null,
  };
};
const run = (heirs, sex, rules) => {
  M.setState({ heirs, testatorSex: sex, bequests: [] });
  return calculateFaraid(rules || {});
};
const fval = fr => fr.num / fr.den;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const addF = (a, b) => { const n = a.num * b.den + b.num * a.den, d = a.den * b.den, g = gcd(Math.abs(n), d) || 1; return { num: n / g, den: d / g }; };
// Sum of the fractions of every row in a category, as "n/d".
const cat = (r, category) => {
  const rows = r.shares.filter(s => s.category === category);
  if (!rows.length) return null;
  return fracToString(rows.reduce((a, s) => addF(a, s.fraction), { num: 0, den: 1 }));
};
// Fraction of the first row whose name matches.
const named = (r, re) => { const s = r.shares.find(x => re.test(x.name)); return s ? fracToString(s.fraction) : null; };
const total = r => r.shares.reduce((a, s) => a + fval(s.fraction), 0);
const sumsToOne = r => r.shares.length > 0 && Math.abs(total(r) - 1) < 1e-9;
const names = r => r.shares.map(s => s.name + ' ' + fracToString(s.fraction));
const HANAFI = rulesForMadhhab('hanafi');
const MAJORITY = { pgmWithFather: false };
const HANBALI = rulesForMadhhab('hanbali');

console.log('Rules helper');
check('no school: both flags true', JSON.stringify(rulesForMadhhab(null)) === JSON.stringify({ madhhab: null, pgmWithFather: true, jaddMuqasama: true, raddToHeirs: true, distantKindred: true }), rulesForMadhhab(null));
check('hanafi: both flags false', HANAFI.pgmWithFather === false && HANAFI.jaddMuqasama === false, HANAFI);
check('maliki, shafii: grandmother excluded, Zayd applied', ['maliki', 'shafii'].every(id => rulesForMadhhab(id).pgmWithFather === false && rulesForMadhhab(id).jaddMuqasama === true));
check('hanbali: both flags true', HANBALI.pgmWithFather === true && HANBALI.jaddMuqasama === true);

console.log('1a. Paternal grandmother alongside the father');
let r = run(H({ father: true, pgm: true, sons: 1 }), 'male');
check('default: she takes 1/6 with the father alive', cat(r, 'grandmother') === '1/6', names(r));
check('default: father 1/6, son 2/3', cat(r, 'father-fixed') === '1/6' && cat(r, 'son') === '2/3', names(r));
check('default: sums to 1', sumsToOne(r), total(r));
check('default: difference recorded as applied', r.schoolDifferences.length === 1 && r.schoolDifferences[0].applied === true, r.schoolDifferences);
check('default: no school named in notes, warnings or reasons', !r.warnings.concat(r.notes).concat(r.shares.map(s => s.reason)).some(t => /Ḥanbalī|Ḥanafī|Shāfiʿī|Mālikī/.test(t)), r.warnings.concat(r.notes));
r = run(H({ father: true, pgm: true, sons: 1 }), 'male', MAJORITY);
check('majority: the father excludes her', cat(r, 'grandmother') === null && cat(r, 'father-fixed') === '1/6' && cat(r, 'son') === '5/6', names(r));
check('majority: sums to 1', sumsToOne(r));
check('majority: difference recorded, not applied', r.schoolDifferences.length === 1 && r.schoolDifferences[0].applied === false);
check('majority: exclusion note names the selected ruling', r.notes.some(n => /Ḥanafī, Shāfiʿī and Mālikī ruling selected/.test(n)), r.notes);
r = run(H({ father: true, pgm: true, mgm: true, sons: 1 }), 'male');
check('both grandmothers with the father: 1/12 each', named(r, /^Paternal Grandmother$/) === '1/12' && named(r, /^Maternal Grandmother$/) === '1/12', names(r));
r = run(H({ father: true, pgm: true, mgm: true, sons: 1 }), 'male', MAJORITY);
check('majority: maternal grandmother alone takes 1/6', named(r, /^Maternal Grandmother$/) === '1/6' && !named(r, /^Paternal Grandmother$/), names(r));
r = run(H({ father: true, mother: true, pgm: true, sons: 1 }), 'male');
check('mother alive excludes every grandmother; no difference recorded', cat(r, 'grandmother') === null && r.schoolDifferences.length === 0, names(r));
const r1 = run(H({ pgm: true, sons: 1 }), 'male'), r2 = run(H({ pgm: true, sons: 1 }), 'male', MAJORITY);
check('father absent: 1/6 under both settings, nothing flagged', cat(r1, 'grandmother') === '1/6' && cat(r2, 'grandmother') === '1/6' && r1.schoolDifferences.length === 0 && r2.schoolDifferences.length === 0);
r = run(H({ husband: true, daughters: 2, father: true, pgm: true }), 'female');
check('ʿawl with the extra sixth: husband 1/5, daughters 8/15, grandmother 2/15', r.awlApplied && cat(r, 'spouse') === '1/5' && cat(r, 'daughter') === '8/15' && cat(r, 'grandmother') === '2/15', names(r));
r = run(H({ husband: true, daughters: 2, father: true, pgm: true }), 'female', MAJORITY);
check('ʿawl (majority): husband 3/13, no grandmother', cat(r, 'spouse') === '3/13' && cat(r, 'grandmother') === null && sumsToOne(r), names(r));
r = run(H({ daughters: 1, pgm: true }), 'male');
check('radd: daughter 3/4, grandmother 1/4', cat(r, 'daughter') === '3/4' && cat(r, 'grandmother') === '1/4' && r.raddApplied, names(r));
r = run(H({ wives: 2, sons: 1, father: true, pgm: true }), 'male');
check('2 wives 1/8, father 1/6, grandmother 1/6, son 13/24', cat(r, 'spouse') === '1/8' && cat(r, 'grandmother') === '1/6' && cat(r, 'son') === '13/24' && sumsToOne(r), names(r));

console.log('1b. Grandfather with brothers and sisters (Zayd ibn Thābit\'s method)');
r = run(H({ pgf: true, fullBrothers: 1 }), 'male');
check('gf + 1 brother: 1/2 each', cat(r, 'pgf-residue') === '1/2' && cat(r, 'full-brother') === '1/2' && sumsToOne(r), names(r));
check('gf + 1 brother: explained in plain words', r.warnings.some(w => /best of .*here sharing as a brother.*shared the rest/.test(w)), r.warnings);
r = run(H({ pgf: true, fullBrothers: 3 }), 'male');
check('gf + 3 brothers: gf 1/3, brothers 2/3', cat(r, 'pgf-residue') === '1/3' && cat(r, 'full-brother') === '2/3', names(r));
r = run(H({ pgf: true, fullSisters: 1 }), 'male');
check('gf + 1 sister: 2/3 and 1/3, no fixed half', cat(r, 'pgf-residue') === '2/3' && cat(r, 'full-sister') === '1/3', names(r));
r = run(H({ husband: true, pgf: true, fullBrothers: 1 }), 'female');
check('husband + gf + brother: 1/2, 1/4, 1/4', cat(r, 'spouse') === '1/2' && cat(r, 'pgf-residue') === '1/4' && cat(r, 'full-brother') === '1/4', names(r));
r = run(H({ pgf: true, mother: true, fullBrothers: 2 }), 'male');
check('gf + mother + 2 brothers: 1/6, 5/18, 5/9', cat(r, 'mother') === '1/6' && cat(r, 'pgf-residue') === '5/18' && cat(r, 'full-brother') === '5/9', names(r));
r = run(H({ daughters: 1, pgf: true, fullSisters: 1 }), 'male');
check('daughter + gf + sister: 1/2, 1/3, 1/6', cat(r, 'daughter') === '1/2' && cat(r, 'pgf-residue') === '1/3' && cat(r, 'full-sister') === '1/6', names(r));
r = run(H({ husband: true, mother: true, pgf: true, fullBrothers: 1 }), 'female');
check('only a sixth left: gf keeps 1/6, brother nothing', cat(r, 'pgf-fixed') === '1/6' && cat(r, 'full-brother') === null && sumsToOne(r), names(r));
check('only a sixth left: explained', r.notes.some(n => /never takes less than a sixth/.test(n)), r.notes);
r = run(H({ husband: true, mother: true, pgf: true, fullSisters: 1 }), 'female');
check('al-Akdariyyah: 1/3, 2/9, 8/27, 4/27', cat(r, 'spouse') === '1/3' && cat(r, 'mother') === '2/9' && cat(r, 'pgf-fixed') === '8/27' && cat(r, 'full-sister') === '4/27', names(r));
check('al-Akdariyyah: sums to 1 and is explained', sumsToOne(r) && r.akdariyya && r.warnings.some(w => /Akdariyyah/.test(w)));
r = run(H({ pgf: true, fullBrothers: 2, fullSisters: 1 }), 'male', HANAFI);
check('Ḥanafī: gf takes all, siblings excluded', cat(r, 'pgf-residue') === '1' && cat(r, 'full-brother') === null && cat(r, 'full-sister') === null, names(r));
check('Ḥanafī: exclusion note names the ruling', r.notes.some(n => /Ḥanafī ruling selected/.test(n)), r.notes);
r = run(H({ pgf: true, fullSisters: 1 }), 'male', HANAFI);
check('Ḥanafī: a lone full sister gets nothing beside the grandfather', cat(r, 'full-sister') === null && cat(r, 'pgf-residue') === '1', names(r));
r = run(H({ husband: true, mother: true, pgf: true, fullSisters: 1 }), 'female', HANAFI);
check('Ḥanafī al-Akdariyyah family: husband 1/2, mother 1/3, gf 1/6, sister nothing', cat(r, 'spouse') === '1/2' && cat(r, 'mother') === '1/3' && cat(r, 'pgf-residue') === '1/6' && cat(r, 'full-sister') === null && sumsToOne(r), names(r));
r = run(H({ pgf: true, sons: 1, fullBrothers: 1 }), 'male');
check('with a son: gf 1/6, son 5/6, brother excluded in every school', cat(r, 'pgf-fixed') === '1/6' && cat(r, 'son') === '5/6' && cat(r, 'full-brother') === null, names(r));
check('difference recorded for the grandfather case', run(H({ pgf: true, fullBrothers: 1 }), 'male').schoolDifferences.some(d => d.key === 'jaddMuqasama' && d.applied));

console.log('1c. Radd and distant kindred wording');
r = run(H({ daughters: 1, mother: true }), 'male');
check('radd wording: Ḥanafī and Ḥanbalī position, later fatwā of Mālikī and Shāfiʿī', r.warnings.some(w => /Ḥanafī and Ḥanbalī position and the later fatwā of the Mālikī and Shāfiʿī schools/.test(w)), r.warnings);
r = run(H({ daughters: 1, mother: true }), 'male', rulesForMadhhab('shafii'));
check('radd under Shāfiʿī: treasury note added', r.warnings.some(w => /public treasury/.test(w)), r.warnings);
r = run(H({}), 'male');
check('no heir: residual rule names kindred, all four schools, later fatwā, scholar', r.unhandled && /distant kindred/.test(r.unhandledReason) && /all four schools/.test(r.unhandledReason) && /later fatwā/.test(r.unhandledReason) && !/determines? the distribution/i.test(r.unhandledReason), r.unhandledReason);
r = run(H({ wives: 1 }), 'male');
check('spouse only: charity row mentions distant kindred in all four schools', r.charityFallback && /all four schools admit them/.test(r.shares.find(s => s.category === 'charity').reason));

console.log('2. Defects in the previous Meeras engine');
r = run(H({ mother: true, fullSisters: 1 }), 'male');
check('mother + 1 full sister: 2/5 and 3/5 (1/3 and 1/2, then radd)', cat(r, 'mother') === '2/5' && cat(r, 'full-sister') === '3/5' && r.raddApplied, names(r));
r = run(H({ fullSisters: 2 }), 'male');
check('2 full sisters alone: 2/3 fixed, radd to 1', cat(r, 'full-sister') === '1' && r.raddApplied, names(r));
r = run(H({ daughters: 1, fullSisters: 1 }), 'male');
check('1 daughter + 1 full sister: 1/2 and 1/2 (ʿaṣabah maʿa al-ghayr)', cat(r, 'daughter') === '1/2' && cat(r, 'full-sister-residue') === '1/2', names(r));
r = run(H({ daughters: 2, fullSisters: 1 }), 'male');
check('2 daughters + 1 full sister: 2/3 and 1/3', cat(r, 'daughter') === '2/3' && cat(r, 'full-sister-residue') === '1/3', names(r));
r = run(H({ daughters: 1, fullBrothers: 1, fullSisters: 1 }), 'male');
check('1 daughter + brother + sister: 1/2, 1/3, 1/6', cat(r, 'daughter') === '1/2' && cat(r, 'full-brother') === '1/3' && cat(r, 'full-sister') === '1/6', names(r));
r = run(H({ wives: 1, father: true, mother: true }), 'male');
check('ʿUmariyyatān: wife 1/4, mother 1/4, father 1/2', cat(r, 'spouse') === '1/4' && cat(r, 'mother') === '1/4' && cat(r, 'father-residue') === '1/2', names(r));
r = run(H({ husband: true, father: true, mother: true }), 'female');
check('ʿUmariyyatān: husband 1/2, mother 1/6, father 1/3', cat(r, 'spouse') === '1/2' && cat(r, 'mother') === '1/6' && cat(r, 'father-residue') === '1/3', names(r));
r = run(H({ husband: true, pgf: true, mother: true }), 'female');
check('not ʿUmariyyatān with a grandfather: husband 1/2, mother 1/3, gf 1/6', cat(r, 'spouse') === '1/2' && cat(r, 'mother') === '1/3' && cat(r, 'pgf-residue') === '1/6', names(r));
r = run(H({ wives: 1, father: true, mother: true, fullBrothers: 2 }), 'male');
check('ʿUmariyyatān not applied with two siblings: mother 1/6 of the estate', cat(r, 'mother') === '1/6' && cat(r, 'full-brother') === null, names(r));

console.log('Existing behaviour kept');
r = run(H({ wives: 1 }), 'male');
check('spouse only: wife 1/4, charity 3/4', cat(r, 'spouse') === '1/4' && cat(r, 'charity') === '3/4' && r.charityFallback && !r.raddApplied, names(r));
r = run(H({ wives: 1, daughters: 2, mother: true }), 'male');
check('wife + 2 daughters + mother: 1/8, 7/10, 7/40', cat(r, 'spouse') === '1/8' && cat(r, 'daughter') === '7/10' && cat(r, 'mother') === '7/40' && sumsToOne(r), names(r));
r = run(H({ wives: 1, sons: 1, daughters: 1, father: true, mother: true }), 'male');
check('Case 1: wife 1/8, parents 1/6 each, son 13/36, daughter 13/72', cat(r, 'spouse') === '1/8' && cat(r, 'father-fixed') === '1/6' && cat(r, 'mother') === '1/6' && cat(r, 'son') === '13/36' && cat(r, 'daughter') === '13/72', names(r));
M.setState({ heirs: H({ wives: 1 }), testatorSex: 'male', bequests: [{ recipient: 'x', percent: 20 }] });
r = calculateFaraid({});
check('bequests: percentages of the estate reconcile with the 20% wasiyyah', Math.abs(r.shares.reduce((a, s) => a + parseFloat(s.percentOfEstate), 0) + r.bequestPct - 100) < 0.02);

/* ---- Random sweep and cross-check with Al-Mawārīth ------------------------- */
console.log('Random sweep (5000 families x 2 settings)');
let seed = 20261017;
const rnd = n => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (((t ^ (t >>> 14)) >>> 0) / 4294967296 * n) | 0;
};
const mawPath = process.env.MAWARITH || path.join(ROOT, '..', 'mawarith', 'Mawarith-Calculator.html');
const maw = fs.existsSync(mawPath) ? loadMawarith(mawPath) : null;
if (!maw) console.warn('  (Al-Mawārīth calculator not found at ' + mawPath + '; cross-check skipped)');
const MAW_HANAFI = { madhhab: 'hanafi', pgmWithFather: false, jaddMuqasama: false, raddToHeirs: true, distantKindred: true };
// Canonical view of a result: category -> reduced fraction, so per-person rows
// (Meeras) and collective rows (Al-Mawārīth) compare equal.
const canonMeeras = res => {
  const m = {};
  res.shares.forEach(s => { m[s.category] = addF(m[s.category] || { num: 0, den: 1 }, s.fraction); });
  return JSON.stringify(Object.keys(m).sort().map(k => [k, fracToString(m[k])]));
};
const canonMaw = res => {
  const m = {};
  res.shares.forEach(s => { const fr = { num: s.fraction.n, den: s.fraction.d }; m[s.category] = addF(m[s.category] || { num: 0, den: 1 }, fr); });
  return JSON.stringify(Object.keys(m).sort().map(k => [k, fracToString(m[k])]));
};
let families = 0, sweepFail = 0, diffs = 0, disputed = 0;
for (let i = 0; i < 5000; i++) {
  const sex = rnd(2) ? 'male' : 'female';
  const o = {
    husband: sex === 'female' && rnd(2) === 1, wives: sex === 'male' ? rnd(5) : 0,
    sons: rnd(4), daughters: rnd(4),
    father: rnd(2) === 1, mother: rnd(2) === 1,
    pgf: rnd(2) === 1, pgm: rnd(2) === 1, mgm: rnd(2) === 1,
    fullBrothers: rnd(3), fullSisters: rnd(3),
  };
  families++;
  for (const [label, rules, mawRules] of [['default', {}, {}], ['Ḥanafī', HANAFI, MAW_HANAFI]]) {
    const res = run(H(o), sex, rules);
    if (res.shares.length && Math.abs(total(res) - 1) > 1e-9) { sweepFail++; if (sweepFail <= 5) console.error('  FAIL  ' + label + ' does not sum to 1', sex, o, names(res)); }
    if (res.shares.some(s => fval(s.fraction) < 0)) { sweepFail++; console.error('  FAIL  negative share', label, sex, o, names(res)); }
    if (!res.shares.length && !res.unhandled) { sweepFail++; console.error('  FAIL  no shares but not flagged', label, sex, o); }
    if (res.schoolDifferences.length) disputed++;
    if (maw) {
      const mh = Object.assign(maw.defaultHeirs(), {
        husband: !!o.husband, wives: o.wives, sons: o.sons, daughters: o.daughters,
        father: o.father, mother: o.mother, paternalGrandfather: o.pgf, paternalGrandmother: o.pgm, maternalGrandmother: o.mgm,
        fullBrothers: o.fullBrothers, fullSisters: o.fullSisters,
      });
      const mres = maw.calcSunni(mh, sex, mawRules);
      const a = canonMeeras(res), b = canonMaw(mres);
      if (a !== b) {
        diffs++;
        if (diffs <= 10) console.error('  DIFF  ' + label + ' ' + sex + ' ' + JSON.stringify(o) + '\n        Meeras      ' + a + '\n        Al-Mawārīth ' + b);
      }
    }
  }
}
check('sweep: every distribution sums to 1 with no negative share', sweepFail === 0, sweepFail);
if (maw) check('cross-check: identical to Al-Mawārīth for every family under both settings', diffs === 0, diffs);
console.log('  families: ' + families + ', results compared: ' + (maw ? families * 2 : 0) + ', with a disputed configuration: ' + disputed + (maw ? ', reference: ' + mawPath : ''));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
