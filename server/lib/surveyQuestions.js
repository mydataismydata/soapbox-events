// A survey's questions, and the answers people give them. Pure functions
// over plain data, so the smoke test checks them directly.
//
// The questions are a JSON list on the survey. Each has an id ("q3") that
// answers are keyed by, and the choices of a choice question have ids too
// ("o2"), so fixing a typo in a label never changes what an answer means.
//
//   kind      what is asked                  an answer is stored as
//   yes_no    Yes or No                      'yes' | 'no'
//   single    pick one                       { pick: 'o2' } | { pick: 'other', other: 'text' }
//   multi     pick any, up to `max`          { picks: ['o1', 'other'], other: 'text' }
//   ranking   put the choices in order       ['o3', 'o1', 'o2'], best first
//   scale     a point on a scale             3, counting from 1 to `points`
//   text      write an answer                'text'
//
// Once a survey has answers, its questions are locked: the wording can still
// be fixed, but nothing that changes what an answer means (kinds, choices,
// the scale's length) can.
import { ApiError } from './validate.js';

export const KINDS = ['yes_no', 'single', 'multi', 'ranking', 'scale', 'text'];
export const CHOICE_KINDS = new Set(['single', 'multi', 'ranking']);

export const KIND_LABELS = {
  yes_no: 'Yes / No',
  single: 'Single choice',
  multi: 'Multiple choice',
  ranking: 'Ranking',
  scale: 'Preference scale',
  text: 'Written answer',
};

export const LIMITS = {
  questions: 60,
  prompt: 500,
  help: 1000,
  options: 30,
  rankingOptions: 15,
  label: 200,
  scaleLabel: 60,
  minPoints: 3,
  maxPoints: 10,
  other: 200,
  shortText: 300,
  longText: 3000,
};

const QID_RE = /^q\d{1,4}$/;
const OID_RE = /^o\d{1,3}$/;

const YES_NO = [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }];

function text(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function num(id) {
  return Number(String(id).slice(1)) || 0;
}

// --- the questions ---------------------------------------------------------

// The questions a survey has stored, tidied. A stored list is always valid,
// but this keeps a damaged one from breaking the page.
export function parseQuestions(survey) {
  let list = [];
  try { list = JSON.parse(survey?.questions || '[]'); } catch { /* damaged -> none */ }
  return Array.isArray(list) ? list.filter((q) => q && QID_RE.test(q.id) && KINDS.includes(q.kind)) : [];
}

// The choices a question offers, Yes and No included.
export function choicesOf(q) {
  return q.kind === 'yes_no' ? YES_NO : (q.options || []);
}

// What a question's answers depend on. Two questions with the same shape
// read each other's answers the same way.
function shape(q) {
  return JSON.stringify([q.id, q.kind, (q.options || []).map((o) => o.id),
    Boolean(q.other), q.max || 0, q.points || 0, Boolean(q.long)]);
}

// Checks the questions the editor sent and returns them as they are to be
// stored. New questions and choices get the next free id. `previous` is the
// stored list; with `locked`, only the wording may differ from it.
export function normalizeQuestions(input, { previous = [], locked = false } = {}) {
  if (!Array.isArray(input)) throw new ApiError(400, 'Questions must be a list.');
  if (input.length > LIMITS.questions) throw new ApiError(400, `A survey can have at most ${LIMITS.questions} questions.`);

  const prevIds = new Set(previous.map((q) => q.id));
  let nextQ = Math.max(0, ...previous.map((q) => num(q.id)),
    ...input.map((q) => (QID_RE.test(q?.id) ? num(q.id) : 0)));
  const seenQ = new Set();

  const out = input.map((raw, i) => {
    const n = i + 1;
    const kind = KINDS.includes(raw?.kind) ? raw.kind : null;
    if (!kind) throw new ApiError(400, `Question ${n} needs a type.`);
    const prompt = text(raw.prompt, LIMITS.prompt);
    if (!prompt) throw new ApiError(400, `Question ${n} needs some wording.`);

    let id = QID_RE.test(raw.id) && !seenQ.has(raw.id) ? raw.id : '';
    // A locked survey keeps its question ids, so an id it never had is new.
    if (locked && id && !prevIds.has(id)) id = '';
    if (!id) id = `q${++nextQ}`;
    seenQ.add(id);

    const q = { id, kind, prompt, help: text(raw.help, LIMITS.help), required: raw.required !== false };

    if (CHOICE_KINDS.has(kind)) {
      const before = previous.find((p) => p.id === id)?.options || [];
      let nextO = Math.max(0, ...before.map((o) => num(o.id)),
        ...(Array.isArray(raw.options) ? raw.options : []).map((o) => (OID_RE.test(o?.id) ? num(o.id) : 0)));
      const seenO = new Set();
      const options = (Array.isArray(raw.options) ? raw.options : [])
        .map((o) => ({ id: o?.id, label: text(o?.label, LIMITS.label) }))
        .filter((o) => o.label)
        .map((o) => {
          let oid = OID_RE.test(o.id) && !seenO.has(o.id) ? o.id : '';
          if (!oid) oid = `o${++nextO}`;
          seenO.add(oid);
          return { id: oid, label: o.label };
        });
      const most = kind === 'ranking' ? LIMITS.rankingOptions : LIMITS.options;
      if (options.length < 2) throw new ApiError(400, `Question ${n} needs at least two choices.`);
      if (options.length > most) throw new ApiError(400, `Question ${n} can have at most ${most} choices.`);
      const labels = new Set(options.map((o) => o.label.toLowerCase()));
      if (labels.size < options.length) throw new ApiError(400, `Question ${n} has the same choice twice.`);
      q.options = options;
      if (kind !== 'ranking') q.other = Boolean(raw.other);
      if (kind === 'multi') {
        // 0 is no limit. A limit of every choice is no limit either.
        const max = Math.max(0, Math.floor(Number(raw.max) || 0));
        const offered = options.length + (q.other ? 1 : 0);
        q.max = max > 0 && max < offered ? max : 0;
      }
    }
    if (kind === 'scale') {
      const points = Math.floor(Number(raw.points) || 5);
      q.points = Math.min(LIMITS.maxPoints, Math.max(LIMITS.minPoints, points));
      q.low = text(raw.low, LIMITS.scaleLabel);
      q.high = text(raw.high, LIMITS.scaleLabel);
    }
    if (kind === 'text') q.long = Boolean(raw.long);
    return q;
  });

  if (locked) {
    const same = out.length === previous.length && out.every((q, i) => shape(q) === shape(previous[i]));
    if (!same) {
      throw new ApiError(409, 'This survey already has answers, so its questions can’t be added, removed, '
        + 'reordered or changed in type, and their choices are fixed. You can still change the wording.');
    }
  }
  return out;
}

// --- answers ---------------------------------------------------------------

function list(value) {
  if (value === undefined || value === null || value === '') return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

function one(value) {
  return Array.isArray(value) ? String(value[value.length - 1] ?? '') : String(value ?? '');
}

// Reads a submitted form into answers. Each question's fields are named by
// its id: `q3` holds the choice (or choices), `q3_other` the text typed for
// Other, and `q3_o2` the number given to choice o2 of a ranking.
//
// Returns { answers, errors }. `answers` holds every question that was
// answered properly, plus enough of the rest to draw the form again as it
// was sent. `errors` maps a question id to what is wrong with it, and is
// empty when the answers can be kept.
export function parseAnswers(questions, body = {}) {
  const answers = {};
  const errors = {};
  for (const q of questions) {
    const raw = body[q.id];
    const ids = new Set(choicesOf(q).map((o) => o.id));
    const otherText = text(one(body[`${q.id}_other`]), LIMITS.other);
    let missing = false;

    if (q.kind === 'yes_no' || q.kind === 'single') {
      const pick = one(raw);
      if (q.kind === 'single' && q.other && pick === 'other') {
        answers[q.id] = { pick: 'other', other: otherText };
        if (!otherText) errors[q.id] = 'Type your answer next to Other.';
      } else if (ids.has(pick)) {
        answers[q.id] = q.kind === 'yes_no' ? pick : { pick };
      } else {
        missing = true;
      }
    } else if (q.kind === 'multi') {
      const picks = [...new Set(list(raw).filter((p) => ids.has(p) || (q.other && p === 'other')))];
      if (picks.length) {
        answers[q.id] = picks.includes('other') ? { picks, other: otherText } : { picks };
        if (picks.includes('other') && !otherText) errors[q.id] = 'Type your answer next to Other.';
        else if (q.max && picks.length > q.max) errors[q.id] = `Choose at most ${q.max}.`;
      } else {
        missing = true;
      }
    } else if (q.kind === 'ranking') {
      const ranked = q.options
        .map((o) => ({ id: o.id, rank: Number(one(body[`${q.id}_${o.id}`])) }))
        .filter((r) => Number.isInteger(r.rank) && r.rank >= 1 && r.rank <= q.options.length);
      if (ranked.length) {
        ranked.sort((a, b) => a.rank - b.rank);
        answers[q.id] = ranked.map((r) => r.id);
        if (new Set(ranked.map((r) => r.rank)).size < ranked.length) {
          errors[q.id] = 'Give each choice a different number.';
        } else if (q.required && ranked.length < q.options.length) {
          errors[q.id] = 'Put every choice in order.';
        }
      } else {
        missing = true;
      }
    } else if (q.kind === 'scale') {
      const point = Number(one(raw));
      if (Number.isInteger(point) && point >= 1 && point <= q.points) answers[q.id] = point;
      else missing = true;
    } else if (q.kind === 'text') {
      // Line breaks are kept in a long answer, and only there.
      const max = q.long ? LIMITS.longText : LIMITS.shortText;
      const value = q.long
        ? one(raw).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
        : text(one(raw), max);
      if (value) answers[q.id] = value;
      else missing = true;
    }

    if (missing && q.required) errors[q.id] = REQUIRED[q.kind];
  }
  return { answers, errors };
}

const REQUIRED = {
  yes_no: 'Choose Yes or No.',
  single: 'Choose an answer.',
  multi: 'Choose at least one.',
  ranking: 'Put the choices in order.',
  scale: 'Choose a point on the scale.',
  text: 'Write an answer.',
};

// Whether an answer still fits its question. Used when reading answers back,
// in case a question was reworded into something it no longer fits.
function fits(q, a) {
  const ids = new Set(choicesOf(q).map((o) => o.id));
  if (a === undefined || a === null) return false;
  switch (q.kind) {
    case 'yes_no': return ids.has(a);
    case 'single': return Boolean(a && (ids.has(a.pick) || (a.pick === 'other' && q.other)));
    case 'multi': return Boolean(a && Array.isArray(a.picks) && a.picks.length);
    case 'ranking': return Array.isArray(a) && a.length > 0;
    case 'scale': return Number.isInteger(a) && a >= 1 && a <= q.points;
    case 'text': return typeof a === 'string' && a.length > 0;
    default: return false;
  }
}

// One answer in words, for the responses table and the spreadsheet.
export function answerText(q, a) {
  if (!fits(q, a)) return '';
  const label = (id) => (id === 'other' ? 'Other' : (choicesOf(q).find((o) => o.id === id)?.label || ''));
  switch (q.kind) {
    case 'yes_no': return label(a);
    case 'single': return a.pick === 'other' ? `Other: ${a.other || ''}` : label(a.pick);
    case 'multi': return a.picks.map((p) => (p === 'other' ? `Other: ${a.other || ''}` : label(p))).filter(Boolean).join('; ');
    case 'ranking': return a.map((id, i) => `${i + 1}. ${label(id)}`).join('; ');
    case 'scale': {
      const end = a === 1 ? q.low : a === q.points ? q.high : '';
      return `${a} of ${q.points}${end ? ` (${end})` : ''}`;
    }
    case 'text': return a;
    default: return '';
  }
}

// --- results ---------------------------------------------------------------

function pct(count, of) {
  return of ? Math.round((count * 1000) / of) / 10 : 0;
}

// The results of every question, from the stored responses. Each response
// is { answers, name }, where name is '' when the survey is anonymous.
//
// A ranking is scored the usual way for a survey: with n choices, first
// place earns n points, second n-1, and so on, and a choice someone left out
// earns nothing. Choices are listed by points, and each shows its average
// place among the people who placed it, and how often it came first.
export function tally(questions, responses) {
  return questions.map((q) => {
    const given = responses
      .map((r) => ({ a: r.answers?.[q.id], name: r.name || '' }))
      .filter((r) => fits(q, r.a));
    const answered = given.length;
    const base = { id: q.id, kind: q.kind, prompt: q.prompt, required: q.required, answered };

    if (q.kind === 'yes_no' || q.kind === 'single' || q.kind === 'multi') {
      const counts = new Map(choicesOf(q).map((o) => [o.id, 0]));
      const others = [];
      for (const { a, name } of given) {
        const picks = q.kind === 'yes_no' ? [a] : q.kind === 'single' ? [a.pick] : a.picks;
        for (const p of picks) {
          if (p === 'other') others.push({ text: a.other || '', name });
          else if (counts.has(p)) counts.set(p, counts.get(p) + 1);
        }
      }
      const options = choicesOf(q).map((o) => ({
        id: o.id, label: o.label, count: counts.get(o.id), pct: pct(counts.get(o.id), answered),
      }));
      const out = { ...base, options };
      if (q.other) out.other = { count: others.length, pct: pct(others.length, answered), answers: others };
      return out;
    }

    if (q.kind === 'ranking') {
      const n = q.options.length;
      const stats = new Map(q.options.map((o) => [o.id, { points: 0, places: 0, placed: 0, firsts: 0 }]));
      for (const { a } of given) {
        a.forEach((id, i) => {
          const s = stats.get(id);
          if (!s) return;
          s.points += n - i;
          s.places += i + 1;
          s.placed += 1;
          if (i === 0) s.firsts += 1;
        });
      }
      const options = q.options.map((o, i) => {
        const s = stats.get(o.id);
        return {
          id: o.id, label: o.label, order: i, points: s.points, placed: s.placed, firsts: s.firsts,
          average: s.placed ? Math.round((s.places / s.placed) * 10) / 10 : null,
          pct: pct(s.points, answered * n),
        };
      }).sort((x, y) => (y.points - x.points) || ((x.average ?? 99) - (y.average ?? 99)) || (x.order - y.order));
      return { ...base, options };
    }

    if (q.kind === 'scale') {
      const counts = Array.from({ length: q.points }, () => 0);
      let sum = 0;
      for (const { a } of given) { counts[a - 1] += 1; sum += a; }
      const sorted = given.map((r) => r.a).sort((x, y) => x - y);
      const mid = Math.floor(sorted.length / 2);
      const median = !sorted.length ? null
        : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      return {
        ...base, points: q.points, low: q.low || '', high: q.high || '',
        counts: counts.map((count, i) => ({ point: i + 1, count, pct: pct(count, answered) })),
        average: answered ? Math.round((sum / answered) * 10) / 10 : null,
        median,
      };
    }

    // Written answers.
    return { ...base, answers: given.map(({ a, name }) => ({ text: a, name })) };
  });
}
