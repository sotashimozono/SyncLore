/**
 * build-index.js
 *
 * drafts/*.md と (DEPLOY_ROOT の) articles/ public/ を読んで、
 * INDEX.md (公開記事の一覧) を deploy branch ルートに生成する。
 *
 * 出力フィールド (slug ごと):
 *   Slug   - drafts のファイル名
 *   Title  - drafts の frontmatter title
 *   Status - LIVE | HIDE | DRAFT | DELETED
 *   Qiita  - https://qiita.com/<user>/items/<id> (LIVE のみ)
 *   Zenn   - https://zenn.dev/<user>/articles/<slug> (LIVE のみ)
 *   Last update - public/<slug>.md の updated_at (date 部分のみ)
 *
 * username は GITHUB_REPOSITORY の owner 部分を default に、
 * QIITA_USERNAME / ZENN_USERNAME env で上書き可能。derive できない場合は
 * URL 列は "—" になる。
 *
 * INDEX.md にはランタイム timestamp を入れない (再実行で no-diff にするため)。
 */

"use strict";

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

const SOURCE_ROOT = path.resolve(__dirname, "..");
const DEPLOY_ROOT = process.env.SYNCLORE_DEPLOY_ROOT
  ? path.resolve(process.env.SYNCLORE_DEPLOY_ROOT)
  : SOURCE_ROOT;
const DRAFTS_DIR = path.join(SOURCE_ROOT, "drafts");
const ZENN_DIR = path.join(DEPLOY_ROOT, "articles");
const QIITA_DIR = path.join(DEPLOY_ROOT, "public");
const INDEX_PATH = path.join(DEPLOY_ROOT, "INDEX.md");

function ghOwner() {
  const v = process.env.GITHUB_REPOSITORY;
  if (!v) return null;
  return v.split("/")[0] || null;
}

function qiitaUser() {
  return process.env.QIITA_USERNAME || ghOwner();
}

function zennUser() {
  return process.env.ZENN_USERNAME || ghOwner();
}

function readFm(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return matter(fs.readFileSync(p, "utf8")).data || {};
  } catch {
    return null;
  }
}

function parsePublishAt(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function determineStatus(draft, hasZenn, hasQiita, now) {
  if (draft.delete === true) return "DELETED";
  if (draft.publish === true) return "LIVE";
  const publishAt = parsePublishAt(draft.publish_at);
  if (publishAt !== null && publishAt <= now) return "LIVE"; // 予約時刻が過ぎていれば実質公開
  if (!hasZenn && !hasQiita) {
    if (publishAt !== null) return "SCHEDULED"; // publish_at が未来 + outputs なし
    return "DRAFT";
  }
  return "HIDE";
}

function qiitaLinkCell(id, status) {
  const u = qiitaUser();
  if (status === "DELETED") return "—";
  if (!u || !id) return "—";
  return `[link](https://qiita.com/${u}/items/${id})`;
}

function zennLinkCell(slug, status) {
  const u = zennUser();
  if (status !== "LIVE") return "—";
  if (!u) return "—";
  return `[link](https://zenn.dev/${u}/articles/${slug})`;
}

function escapeCell(s) {
  return String(s == null ? "" : s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

if (!fs.existsSync(DRAFTS_DIR)) {
  console.log("No drafts/ directory; nothing to index.");
  process.exit(0);
}

const draftFiles = fs
  .readdirSync(DRAFTS_DIR)
  .filter((f) => path.extname(f) === ".md" && f !== "template.md");

const NOW = new Date();
const rows = [];
for (const file of draftFiles) {
  const slug = path.basename(file, ".md");
  const draftFm = readFm(path.join(DRAFTS_DIR, file)) || {};
  const qiitaFm = readFm(path.join(QIITA_DIR, file)) || {};
  const hasZenn = fs.existsSync(path.join(ZENN_DIR, file));
  const hasQiita = fs.existsSync(path.join(QIITA_DIR, file));

  const status = determineStatus(draftFm, hasZenn, hasQiita, NOW);
  const title = draftFm.title || "(タイトル未設定)";
  const updated_at = qiitaFm.updated_at || "";
  const publish_at = draftFm.publish_at || "";

  rows.push({
    slug,
    title,
    status,
    updated_at,
    publish_at,
    qiita_id: qiitaFm.id || null,
  });
}

// Sort: latest updated_at first; rows without updated_at fall to bottom alphabetically.
rows.sort((a, b) => {
  if (a.updated_at && b.updated_at) return b.updated_at.localeCompare(a.updated_at);
  if (a.updated_at) return -1;
  if (b.updated_at) return 1;
  return a.slug.localeCompare(b.slug);
});

const lines = [];
lines.push("# Published Articles");
lines.push("");
lines.push(
  "`drafts/<slug>.md` ([main branch](../../tree/main/drafts)) で記事を管理しています。詳細は [main の README](../../blob/main/README.md) を参照。",
);
lines.push("");
lines.push("| Slug | Title | Status | Qiita | Zenn | Last update |");
lines.push("| --- | --- | --- | --- | --- | --- |");
for (const r of rows) {
  // SCHEDULED は "Last update" 列に予約時刻を表示 (まだ未公開なので updated_at は空)。
  let updatedCell = "—";
  if (r.status === "SCHEDULED" && r.publish_at) {
    updatedCell = `→ ${r.publish_at.slice(0, 16).replace("T", " ")}`;
  } else if (r.updated_at) {
    updatedCell = r.updated_at.slice(0, 10);
  }
  lines.push(
    `| \`${r.slug}\` | ${escapeCell(r.title)} | ${r.status} | ${qiitaLinkCell(r.qiita_id, r.status)} | ${zennLinkCell(r.slug, r.status)} | ${updatedCell} |`,
  );
}
if (rows.length === 0) {
  lines.push("| (記事なし) | — | — | — | — | — |");
}
lines.push("");

fs.writeFileSync(INDEX_PATH, lines.join("\n"), "utf8");
console.log(`Wrote ${INDEX_PATH} with ${rows.length} article(s).`);
