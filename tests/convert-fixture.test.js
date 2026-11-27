"use strict";

// Runs convert.js and build-index.js against throwaway drafts. Nothing is published:
// both scripts only write files under the temporary deploy directory.

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const REPO = path.join(__dirname, "..");
const ZENN = "https://zenn.dev/zenn-fixture/articles/";
const QIITA = "https://qiita.com/qiita-fixture/items/";

function createSite(t, drafts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "synclore-site-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(REPO, "src"), path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "drafts"));
  for (const [slug, frontmatter] of Object.entries(drafts)) {
    const fields = Object.entries(frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
    fs.writeFileSync(path.join(root, "drafts", `${slug}.md`), `---\n${fields.join("\n")}\n---\n${slug} body\n`);
  }
  return root;
}

function run(root, script) {
  const env = {
    PATH: process.env.PATH,
    NODE_PATH: path.join(REPO, "node_modules"),
    SYNCLORE_DEPLOY_ROOT: path.join(root, "deploy"),
    SYNCLORE_ZENN_USER: "zenn-fixture",
    SYNCLORE_QIITA_USER: "qiita-fixture",
    ZENN_USERNAME: "zenn-fixture",
    QIITA_USERNAME: "qiita-fixture",
    GITHUB_REPOSITORY: "fixture/synclore",
  };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  return execFileSync(process.execPath, [path.join(root, "src", script)], { env, encoding: "utf8" });
}

function readTree(dir) {
  const files = {};
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    files[path.relative(dir, file).replaceAll("\\", "/")] = fs.readFileSync(file, "utf8");
  }
  return files;
}

function setQiitaId(root, slug, id) {
  const file = path.join(root, "deploy", "public", `${slug}.md`);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("id: null", `id: ${id}`));
}

const SAGA = {
  ep1: { title: "Episode 1", series: "saga", series_order: 1, publish: true },
  ep2: { title: "Episode 2", series: "saga", series_order: 2, publish: false, publish_at: "2999-01-01T00:00:00Z" },
  ep3: { title: "Episode 3", series: "saga", series_order: 3, publish: true },
  solo: { title: "Solo", publish: true },
};

test("convert links published episodes on both platforms and never the unpublished one", (t) => {
  const root = createSite(t, SAGA);
  const firstLog = run(root, "convert.js");
  assert.match(firstLog, /\[SCHEDULED\] ep2\.md/);
  setQiitaId(root, "ep1", "q1");
  setQiitaId(root, "ep3", "q3");
  run(root, "convert.js");

  const out = readTree(path.join(root, "deploy"));
  assert.equal(out["articles/ep2.md"], undefined);
  assert.equal(out["public/ep2.md"], undefined);

  assert.ok(out["articles/ep1.md"].includes(`[Episode 3](${ZENN}ep3) →`));
  assert.ok(out["articles/ep3.md"].includes(`← [Episode 1](${ZENN}ep1)`));
  assert.ok(out["public/ep1.md"].includes(`[Episode 3](${QIITA}q3) →`));
  assert.ok(out["public/ep3.md"].includes(`← [Episode 1](${QIITA}q1)`));
  for (const file of ["articles/ep1.md", "articles/ep3.md", "public/ep1.md", "public/ep3.md"]) {
    assert.ok(!out[file].includes("ep2"), `${file} links the unpublished episode`);
    assert.ok(out[file].includes("- Episode 2\n"), `${file} lists the unpublished episode as plain text`);
    assert.ok(!out[file].includes("[["), `${file} keeps an unresolved wiki link`);
  }
  for (const file of ["articles/solo.md", "public/solo.md"]) {
    assert.ok(!out[file].includes("同じシリーズの記事") && !out[file].includes("←") && !out[file].includes("→"));
  }
});

test("rerunning convert and build-index leaves every output byte-identical", (t) => {
  const root = createSite(t, SAGA);
  run(root, "convert.js");
  setQiitaId(root, "ep1", "q1");
  setQiitaId(root, "ep3", "q3");
  run(root, "convert.js");
  run(root, "build-index.js");
  const before = { deploy: readTree(path.join(root, "deploy")), log: readTree(path.join(root, "log")) };

  const log = run(root, "convert.js");
  run(root, "build-index.js");
  assert.doesNotMatch(log, /\[(LIVE|REPUBLISH|HIDE)\]/);
  assert.match(log, /0 live, 0 republished, 0 hidden, 3 unchanged, 1 scheduled/);
  assert.deepEqual({ deploy: readTree(path.join(root, "deploy")), log: readTree(path.join(root, "log")) }, before);

  const index = before.deploy["INDEX.md"];
  assert.ok(index.indexOf("## saga") !== -1 && index.indexOf("## saga") < index.indexOf("## (未分類)"));
});
