"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { collectSeriesMembers, groupRowsBySeries, renderSeriesNavigation } = require("../src/lib/series");

function createDrafts(t, entries) {
  const drafts = fs.mkdtempSync(path.join(os.tmpdir(), "synclore-series-"));
  t.after(() => fs.rmSync(drafts, { recursive: true, force: true }));
  for (const [slug, frontmatter] of Object.entries(entries)) {
    const fields = Object.entries(frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
    fs.writeFileSync(path.join(drafts, `${slug}.md`), `---\n${fields.join("\n")}\n---\nbody\n`);
  }
  return drafts;
}

test("series_order controls the adjacent links when every member specifies it", (t) => {
  const drafts = createDrafts(t, {
    third: { series: "alpha", publish: true, series_order: 3, publish_at: "2026-01-01T00:00:00Z" },
    first: { series: "alpha", publish: true, series_order: 1, publish_at: "2026-03-01T00:00:00Z" },
    second: { series: "alpha", publish: true, series_order: 2, publish_at: "2026-02-01T00:00:00Z" },
  });
  const members = collectSeriesMembers(drafts, null, "alpha");
  assert.deepEqual(members.map((member) => member.slug), ["first", "second", "third"]);
  assert.equal(renderSeriesNavigation("first", members), "[[second]] →");
  assert.equal(renderSeriesNavigation("second", members), "← [[first]]　|　[[third]] →");
  assert.equal(renderSeriesNavigation("third", members), "← [[second]]");
});

test("mixed series_order keeps the existing publish_at ordering", (t) => {
  const drafts = createDrafts(t, {
    later: { series: "alpha", series_order: 1, publish_at: "2026-02-01T00:00:00Z" },
    earlier: { series: "alpha", publish_at: "2026-01-01T00:00:00Z" },
  });
  assert.deepEqual(collectSeriesMembers(drafts, null, "alpha").map((member) => member.slug), ["earlier", "later"]);
});

test("index rows are grouped by series with unclassified articles last", () => {
  const groups = groupRowsBySeries([
    { slug: "loose", series: null, updated_at: "2026-05-01" },
    { slug: "alpha-1", series: "alpha", updated_at: "2026-04-01" },
    { slug: "beta-1", series: "beta", updated_at: "2026-06-01" },
    { slug: "alpha-2", series: "alpha", updated_at: "2026-03-01" },
  ]);
  assert.deepEqual(groups.map((group) => [group.series, group.articles.map((row) => row.slug)]), [
    ["beta", ["beta-1"]],
    ["alpha", ["alpha-1", "alpha-2"]],
    [null, ["loose"]],
  ]);
});

test("duplicate series_order values fall back to slug order and stay stable", (t) => {
  const drafts = createDrafts(t, {
    "b-side": { series: "alpha", publish: true, series_order: 2 },
    opener: { series: "alpha", publish: true, series_order: 1 },
    "a-side": { series: "alpha", publish: true, series_order: 2 },
  });
  const first = collectSeriesMembers(drafts, null, "alpha");
  assert.deepEqual(first.map((member) => member.slug), ["opener", "a-side", "b-side"]);
  assert.deepEqual(collectSeriesMembers(drafts, null, "alpha"), first);
  assert.equal(renderSeriesNavigation("a-side", first), "← [[opener]]　|　[[b-side]] →");
});

test("navigation skips unpublished neighbours", (t) => {
  const drafts = createDrafts(t, {
    one: { series: "alpha", series_order: 1, publish: true },
    two: { series: "alpha", series_order: 2, publish: false, publish_at: "2999-01-01T00:00:00Z" },
    three: { series: "alpha", series_order: 3, publish: true },
    four: { series: "alpha", series_order: 4, publish: false },
  });
  const members = collectSeriesMembers(drafts, null, "alpha");
  assert.equal(renderSeriesNavigation("one", members), "[[three]] →");
  assert.equal(renderSeriesNavigation("three", members), "← [[one]]");
  assert.equal(renderSeriesNavigation("two", members), "← [[one]]　|　[[three]] →");
});
