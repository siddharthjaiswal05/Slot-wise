// node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  courseClashes, clashMap, clashesWith, layoutDay, summarizeSessions, recommend, totalCredits,
} from "../web/scheduler.js";

const data = JSON.parse(readFileSync(new URL("../web/data/courses.json", import.meta.url)));
const byId = new Map(data.courses.map((c) => [c.id, c]));
const get = (id) => byId.get(id);

const mk = (id, half, ...sessions) => ({
  id, half, credits: 9,
  sessions: sessions.map(([day, start, end]) => ({ kind: "Lec", day, start, end })),
});

test("parsed data has every course with unique ids", () => {
  assert.equal(data.courses.length, 757);
  assert.equal(byId.size, data.courses.length);
});

test("CE432 parsed from the sheet", () => {
  const c = get("CE432");
  assert.equal(c.credits, 11);
  assert.deepEqual(summarizeSessions(c.sessions), ["Lec M 12:00–13:15", "Lec T 09:00–10:15", "Prc Th 14:00–16:00"]);
});

test("known clashes from the reference timetable", () => {
  assert.ok(courseClashes(get("CE432"), get("CE657")).length);
  assert.ok(courseClashes(get("CE412"), get("EE675")).length);
  assert.equal(courseClashes(get("SOC473"), get("CS661")).length, 0);
});

test("touching end/start times do not clash", () => {
  assert.equal(courseClashes(mk("a", "REGULAR", ["M", 600, 660]), mk("b", "REGULAR", ["M", 660, 720])).length, 0);
});

test("first-half and second-half courses never clash", () => {
  const a = mk("a", "FIRST-HALF", ["M", 600, 660]);
  assert.equal(courseClashes(a, mk("b", "SECOND-HALF", ["M", 600, 660])).length, 0);
  assert.ok(courseClashes(a, mk("c", "REGULAR", ["M", 630, 700])).length);
  assert.ok(courseClashes(a, mk("d", "FIRST-HALF", ["M", 600, 660])).length);
});

test("clashMap is symmetric and clashesWith lists offenders", () => {
  const plan = ["CE412", "CE432", "CE657", "CS661", "EE675", "SOC473"].map(get);
  const m = clashMap(plan);
  assert.deepEqual([...m.get("CE432")], ["CE657"]);
  assert.deepEqual([...m.get("CE657")], ["CE432"]);
  assert.equal(m.get("SOC473").size, 0);
  assert.deepEqual(clashesWith(get("CS425"), plan).map((c) => c.id).sort(), ["CE412", "EE675"]);
  assert.equal(totalCredits(plan), 11 + 11 + 9 + 9 + 9 + 9);
});

test("layoutDay splits overlapping blocks into lanes", () => {
  const out = layoutDay([
    { id: 1, start: 540, end: 615 }, { id: 2, start: 540, end: 615 },
    { id: 3, start: 600, end: 660 }, { id: 4, start: 700, end: 760 },
  ]);
  const by = Object.fromEntries(out.map((b) => [b.id, b]));
  assert.equal(by[1].lanes, 3);
  assert.equal(new Set([by[1].lane, by[2].lane, by[3].lane]).size, 3);
  assert.equal(by[4].lanes, 1);
  assert.equal(by[4].lane, 0);
});

test("topic recommendation finds relevant courses", () => {
  const ids = recommend(data.courses, "reinforcement learning").slice(0, 5).map((r) => r.course.id);
  assert.ok(ids.includes("EE675"), ids.join(","));
  const fin = recommend(data.courses, "finance").map((r) => r.course.id);
  assert.ok(fin.includes("CE657"));
  assert.equal(recommend(data.courses, "  ").length, 0);
});
