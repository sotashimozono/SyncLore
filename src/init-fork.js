/**
 * init-fork.js
 *
 * fork (or "Use this template") した直後の repo から、SyncLore 自身のデモ記事
 * (`synclore-intro`) を取り除くための one-shot ヘルパー。
 *
 * 削除対象:
 *   - drafts/synclore-intro.md
 *   - .deploy/articles/synclore-intro.md
 *   - .deploy/public/synclore-intro.md
 *   - .deploy/INDEX.md (sync.yml が次回再生成するので削除して OK)
 *
 * このスクリプトは git commit / push を行わない。
 * ユーザーが diff を確認した上で自分で commit & push してください。
 *
 * Qiita API DELETE は呼ばない: synclore-intro の id は元 repo オーナの
 * 投稿 id であり、fork ユーザの token で DELETE しようとすると 403 になる。
 * ローカル / repo からの除去のみで十分 (元投稿は元オーナの所有のまま残る)。
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEPLOY = path.join(ROOT, ".deploy");
const DEMO_SLUG = "synclore-intro";

const targets = [
  path.join(ROOT, "drafts", `${DEMO_SLUG}.md`),
  path.join(DEPLOY, "articles", `${DEMO_SLUG}.md`),
  path.join(DEPLOY, "public", `${DEMO_SLUG}.md`),
  path.join(DEPLOY, "INDEX.md"),
];

let removed = 0;
let missing = 0;

for (const t of targets) {
  if (fs.existsSync(t)) {
    fs.unlinkSync(t);
    console.log(`Removed ${path.relative(ROOT, t).replace(/\\/g, "/")}`);
    removed++;
  } else {
    missing++;
  }
}

if (removed === 0) {
  console.log("No demo article files found. Already initialized?");
  process.exit(0);
}

const hasDeploy = fs.existsSync(DEPLOY);

console.log(
  `\n${removed} file(s) removed${missing > 0 ? `, ${missing} not present` : ""}.\n`,
);
console.log("Next steps (review diff, then commit + push):\n");
console.log(
  "  git add -A && git commit -m 'init: remove SyncLore demo article' && git push",
);
if (hasDeploy) {
  console.log(
    "  cd .deploy && git add -A && git commit -m 'init: remove SyncLore demo artifacts' && git push origin deploy && cd ..",
  );
} else {
  console.log("\nNote: .deploy worktree not found. If the deploy branch has demo");
  console.log("artifacts, run `git worktree add .deploy deploy` and re-run this.");
}
