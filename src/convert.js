/**
 * convert.js
 *
 * drafts/*.md (SSoT) を読み、Zenn 用 articles/<slug>.md と
 * Qiita 用 public/<slug>.md を冪等に再生成する。
 *
 * フロントマター仕様 (drafts/<slug>.md):
 *   title:    string  (必須)
 *   emoji:    string  (Zenn 専用、省略時 📝)
 *   type:     "tech" | "idea" (Zenn 専用、省略時 tech)
 *   topics:   string[] (タグ、Zenn は最大 5)
 *   publish:  boolean — true で公開、false で非公開へ書き戻し
 *
 * 状態判定 (slug ごと):
 *   publish:true                                       → LIVE  (公開)
 *   publish:false かつ articles/public のいずれか既存 → HIDE  (unpublish)
 *   publish:false かつ既存出力なし                     → SKIP  (執筆中)
 *
 * - drafts/<slug>.md は削除しない (SSoT)
 * - 免責事項は HTML コメントマーカで囲み、再変換時に重複しない
 * - Qiita の id は public/<slug>.md から引き継ぐ
 * - drafts/<slug>.md を消した場合の articles/public 残骸は触らない (手動運用)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

// ─── パス定義 ────────────────────────────────────────────────────────────────
// SOURCE_ROOT: drafts/ と src/ がある場所 (= main branch の checkout)。
// DEPLOY_ROOT: articles/ public/ images/ がある場所。
//   SYNCLORE_DEPLOY_ROOT 未指定なら SOURCE_ROOT と同じ (ローカル開発用 fallback)。
//   CI では deploy branch の worktree (例: $GITHUB_WORKSPACE/.deploy) を指す。
const SOURCE_ROOT = path.resolve(__dirname, "..");
const DEPLOY_ROOT = process.env.SYNCLORE_DEPLOY_ROOT
  ? path.resolve(process.env.SYNCLORE_DEPLOY_ROOT)
  : SOURCE_ROOT;
const DRAFTS_DIR = path.join(SOURCE_ROOT, "drafts");
const DRAFT_IMG_DIR = path.join(DRAFTS_DIR, "images");
const ZENN_DIR = path.join(DEPLOY_ROOT, "articles");
const QIITA_DIR = path.join(DEPLOY_ROOT, "public");
const ZENN_IMG_DIR = path.join(DEPLOY_ROOT, "images");

// ─── 免責事項 (マーカで囲んで冪等付与) ────────────────────────────────────────
const DISCLAIMER_START = "<!-- SYNCLORE_DISCLAIMER_START -->";
const DISCLAIMER_END = "<!-- SYNCLORE_DISCLAIMER_END -->";
const DISCLAIMER_BODY = [
  "> **免責事項**",
  "> この記事のコードは [MIT License](https://github.com/sotashimozono/SyncLore/blob/main/LICENSE) に基づき自由に利用できます。",
  "> ただし記事本文の著作権はすべて筆者に帰属し、無断転載・再利用を禁じます。",
  "> 記事の内容は執筆時点のものであり、正確性・完全性を保証しません。",
  "> 本記事の利用によって生じたいかなる損害についても筆者は責任を負いません。",
].join("\n");

// ─── 出力ディレクトリ準備 ─────────────────────────────────────────────────────
for (const dir of [ZENN_DIR, QIITA_DIR, ZENN_IMG_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── ユーティリティ ────────────────────────────────────────────────────────────

function copyDirRecursive(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

function dq(value) {
  const s = String(value == null ? "" : value);
  return `"${s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")}"`;
}

function readExistingFrontmatter(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return matter(fs.readFileSync(filePath, "utf8")).data || null;
  } catch {
    return null;
  }
}

function stripDisclaimer(body) {
  const start = body.indexOf(DISCLAIMER_START);
  if (start === -1) return body.trimEnd();
  return body
    .slice(0, start)
    .replace(/\n---\s*\n?\s*$/m, "")
    .trimEnd();
}

function appendDisclaimer(body) {
  const stripped = stripDisclaimer(body);
  return `${stripped}\n\n---\n\n${DISCLAIMER_START}\n${DISCLAIMER_BODY}\n${DISCLAIMER_END}\n`;
}

// ─── Zenn 用フロントマター生成 ────────────────────────────────────────────────

function buildZennContent(data, body) {
  const title = data.title || "(タイトル未設定)";
  const emoji = data.emoji || "📝";
  const type = data.type === "idea" ? "idea" : "tech";
  const topics = Array.isArray(data.topics) ? data.topics : [];
  const published = data.publish === true;

  const lines = ["---"];
  lines.push(`title: ${dq(title)}`);
  lines.push(`emoji: ${dq(emoji)}`);
  lines.push(`type: ${type}`);
  if (topics.length === 0) {
    lines.push("topics: []");
  } else {
    lines.push("topics:");
    for (const t of topics) lines.push(`  - ${dq(t)}`);
  }
  lines.push(`published: ${published}`);
  lines.push("---");
  return `${lines.join("\n")}\n${body}`;
}

// ─── Qiita 用フロントマター生成 ───────────────────────────────────────────────

function buildQiitaContent(data, existingFm, body) {
  const title = data.title || "(タイトル未設定)";
  // qiita-cli expects tags as string[] (file-system-repo.js fromItem maps API
  // {name, versions} -> name string). [{name}] objects break the API payload.
  const tags = Array.isArray(data.topics) ? data.topics : [];
  const isPrivate = data.publish !== true;

  const updated_at = (existingFm && existingFm.updated_at) || "";
  const orgName =
    existingFm && existingFm.organization_url_name
      ? existingFm.organization_url_name
      : null;
  const slide = !!(existingFm && existingFm.slide);
  const id = (existingFm && existingFm.id) || null;

  const lines = ["---"];
  lines.push(`title: ${dq(title)}`);
  if (tags.length === 0) {
    lines.push("tags: []");
  } else {
    lines.push("tags:");
    for (const t of tags) lines.push(`  - ${dq(t)}`);
  }
  lines.push(`private: ${isPrivate}`);
  lines.push(`updated_at: ${dq(updated_at)}`);
  lines.push(
    orgName ? `organization_url_name: ${dq(orgName)}` : "organization_url_name: null",
  );
  lines.push(`slide: ${slide}`);
  lines.push(id ? `id: ${id}` : "id: null");
  lines.push("---");
  return `${lines.join("\n")}\n${body}`;
}

// ─── メイン処理 ───────────────────────────────────────────────────────────────

let live = 0;
let hidden = 0;
let skipped = 0;
let scheduled = 0;
let tombstone = 0;

const NOW = new Date();

function parsePublishAt(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const draftFiles = fs
  .readdirSync(DRAFTS_DIR)
  .filter((f) => path.extname(f) === ".md");

for (const file of draftFiles) {
  if (file === "template.md") continue;

  const slug = path.basename(file, ".md");
  const draftPath = path.join(DRAFTS_DIR, file);
  const zennPath = path.join(ZENN_DIR, file);
  const qiitaPath = path.join(QIITA_DIR, file);

  const parsed = matter(fs.readFileSync(draftPath, "utf8"));
  const data = parsed.data;

  // 予約公開: publish:false でも publish_at が past なら effective public 扱い。
  // publish:true は publish_at に関係なく即時公開 (明示的な意思を尊重)。
  const publishAt = parsePublishAt(data.publish_at);
  const scheduleDue = publishAt !== null && publishAt <= NOW;
  const isPublic = data.publish === true || scheduleDue;

  // delete:true は synclore-delete.js が先に処理して articles/ public/ を消している。
  // ここでは何もしない (regenerate すると消したものを復活させてしまう)。
  if (data.delete === true) {
    console.log(`  [TOMBSTONE] ${file} (delete:true; handled by synclore-delete.js)`);
    tombstone++;
    continue;
  }

  const hasZenn = fs.existsSync(zennPath);
  const hasQiita = fs.existsSync(qiitaPath);
  if (!isPublic && !hasZenn && !hasQiita) {
    if (publishAt !== null) {
      console.log(`  [SCHEDULED] ${file} -> ${publishAt.toISOString()}`);
      scheduled++;
    } else {
      console.log(`  [SKIP] ${file} (publish:false, no output yet)`);
      skipped++;
    }
    continue;
  }

  const body = appendDisclaimer(parsed.content);

  fs.writeFileSync(zennPath, buildZennContent(data, body), "utf8");

  const existingQiitaFm = readExistingFrontmatter(qiitaPath);
  fs.writeFileSync(
    qiitaPath,
    buildQiitaContent(data, existingQiitaFm, body),
    "utf8",
  );

  copyDirRecursive(
    path.join(DRAFT_IMG_DIR, slug),
    path.join(ZENN_IMG_DIR, slug),
  );

  if (isPublic) {
    const idSuffix =
      existingQiitaFm && existingQiitaFm.id
        ? ` (qiita_id: ${existingQiitaFm.id})`
        : "";
    console.log(`  [LIVE] ${file}${idSuffix}`);
    live++;
  } else {
    console.log(`  [HIDE] ${file} (unpublished -> private:true / published:false)`);
    hidden++;
  }
}

function warnOrphans(dir, label) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (path.extname(f) !== ".md") continue;
    if (!fs.existsSync(path.join(DRAFTS_DIR, f))) {
      console.log(
        `  [WARN] ${label}/${f} has no matching drafts/${f} (manually delete if intentional)`,
      );
    }
  }
}
warnOrphans(ZENN_DIR, "articles");
warnOrphans(QIITA_DIR, "public");

console.log(
  `\nDone. ${live} live, ${hidden} hidden, ${scheduled} scheduled, ${skipped} skipped, ${tombstone} tombstone.`,
);
