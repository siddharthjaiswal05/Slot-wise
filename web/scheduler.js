// Pure scheduling logic: no DOM, so it can be unit-tested under Node.

export const DAYS = ["M", "T", "W", "Th", "F"];
export const DAY_NAMES = { M: "Monday", T: "Tuesday", W: "Wednesday", Th: "Thursday", F: "Friday" };

export const fmtTime = (mins) => {
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

// First-half and second-half courses never meet in the same weeks.
export const halvesOverlap = (a, b) =>
  !((a === "FIRST-HALF" && b === "SECOND-HALF") || (a === "SECOND-HALF" && b === "FIRST-HALF"));

export const sessionsClash = (s1, s2) =>
  s1.day === s2.day && s1.start < s2.end && s2.start < s1.end;

/** Every overlapping session pair between two courses. */
export function courseClashes(a, b) {
  if (a.id === b.id || !halvesOverlap(a.half, b.half)) return [];
  const out = [];
  for (const s1 of a.sessions) for (const s2 of b.sessions) if (sessionsClash(s1, s2)) out.push([s1, s2]);
  return out;
}

/** Map of course id -> Set of ids it clashes with, over the chosen courses. */
export function clashMap(courses) {
  const map = new Map(courses.map((c) => [c.id, new Set()]));
  for (let i = 0; i < courses.length; i++)
    for (let j = i + 1; j < courses.length; j++)
      if (courseClashes(courses[i], courses[j]).length) {
        map.get(courses[i].id).add(courses[j].id);
        map.get(courses[j].id).add(courses[i].id);
      }
  return map;
}

/** Courses in `chosen` that `candidate` would clash with. */
export const clashesWith = (candidate, chosen) =>
  chosen.filter((c) => courseClashes(candidate, c).length);

/** 'Lec MW 15:30–17:00' style lines, merging days that share a time. */
export function summarizeSessions(sessions) {
  const groups = new Map();
  for (const s of sessions) {
    const key = `${s.kind}|${s.start}|${s.end}`;
    if (!groups.has(key)) groups.set(key, { ...s, days: [] });
    groups.get(key).days.push(s.day);
  }
  const kindOrder = { Lec: 0, Tut: 1, Prc: 2 };
  const firstDay = (g) => Math.min(...g.days.map((d) => DAYS.indexOf(d)));
  return [...groups.values()]
    .sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || firstDay(a) - firstDay(b) || a.start - b.start)
    .map((g) => {
      const days = DAYS.filter((d) => g.days.includes(d)).join("");
      return `${g.kind} ${days} ${fmtTime(g.start)}–${fmtTime(g.end)}`;
    });
}

export const totalCredits = (courses) => courses.reduce((n, c) => n + (c.credits || 0), 0);

/**
 * Lay out one day's blocks side by side where they overlap, like a calendar.
 * Input: [{start, end, ...}]. Output: same objects plus `lane` and `lanes`.
 */
export function layoutDay(blocks) {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const laneEnds = [];
    for (const b of cluster) {
      let lane = laneEnds.findIndex((end) => end <= b.start);
      if (lane < 0) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = b.end;
      b.lane = lane;
    }
    for (const b of cluster) { b.lanes = laneEnds.length; out.push(b); }
    cluster = [];
  };
  for (const b of sorted) {
    if (cluster.length && b.start >= clusterEnd) flush();
    clusterEnd = cluster.length ? Math.max(clusterEnd, b.end) : b.end;
    cluster.push({ ...b });
  }
  if (cluster.length) flush();
  return out;
}

// Topic words -> extra terms that tend to appear in course titles.
export const TOPICS = {
  "machine learning": ["learning", "neural", "intelligence", "data", "pattern", "statistical", "inference"],
  "ai": ["intelligence", "learning", "neural", "reinforcement", "vision", "language"],
  "data science": ["data", "statistic", "analytics", "visual", "learning", "mining", "probability"],
  "finance": ["finance", "financial", "investment", "portfolio", "economics", "market", "accounting", "valuation"],
  "economics": ["economic", "economics", "market", "finance", "game", "policy", "development"],
  "management": ["management", "marketing", "operations", "strategy", "organization", "supply", "business"],
  "environment": ["environment", "environmental", "pollution", "water", "waste", "climate", "ecology", "sustainab"],
  "programming": ["programming", "computing", "software", "algorithm", "compiler", "data structure"],
  "systems": ["system", "network", "operating", "architecture", "distributed", "embedded"],
  "math": ["mathemat", "algebra", "calculus", "analysis", "probability", "statistic", "optimization", "linear"],
  "design": ["design", "visual", "interaction", "product", "graphic", "user"],
  "energy": ["energy", "power", "solar", "renewable", "battery", "fuel"],
  "robotics": ["robot", "control", "autonomous", "mechatronic", "kinematic"],
  "society": ["society", "social", "culture", "history", "philosoph", "psycholog", "ethic"],
  "language": ["language", "linguistic", "literature", "english", "writing"],
};

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Score courses against a free-text topic query. Exact query words weigh more
 * than the related terms pulled in from TOPICS.
 */
export function recommend(courses, query) {
  const q = norm(query);
  if (!q) return [];
  const direct = new Set(q.split(" ").filter((w) => w.length > 1));
  const related = new Set();
  for (const [topic, terms] of Object.entries(TOPICS)) {
    const t = norm(topic);
    if (q.includes(t) || t.split(" ").every((w) => direct.has(w))) terms.forEach((x) => related.add(x));
  }
  const results = [];
  for (const c of courses) {
    const hay = norm(`${c.title} ${c.code}`);
    let score = 0;
    const hits = new Set();
    if (q.length > 3 && hay.includes(q)) { score += 6; hits.add(q); }
    for (const w of direct) if (w.length > 2 && hay.includes(w)) { score += 3; hits.add(w); }
    for (const w of related) if (hay.includes(w)) { score += 1; hits.add(w); }
    if (score) results.push({ course: c, score, hits: [...hits] });
  }
  return results.sort((a, b) => b.score - a.score || a.course.code.localeCompare(b.course.code));
}
