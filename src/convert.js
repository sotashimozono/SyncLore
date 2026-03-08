/**
 * convert.js
 *
 * drafts/*.md を読み込み、publish: true のファイルを
 * Zenn 形式 (articles/zenn/) と Qiita 形式 (articles/qiita/) に変換する。
 *
 * 処理内容:
 *   1. gray-matter でフロントマターをパース
 *   2. publish: true のファイルのみ対象
 *   3. Zenn 用・Qiita 用フロントマターに変換
 *   4. Qiita の既存 id を引き継ぐ
 *   5. 画像を drafts/images/<slug>/ → images/<slug>/ にコピー
 *   6. 文末に免責事項を挿入
 *
 * フロントマター仕様 (drafts/*.md):
 *   title:     記事タイトル (必須)
 *   emoji:     絵文字 (Zenn 専用、省略時は 📝)
 *   type:      tech | idea (Zenn 専用、省略時は tech)
 *   topics:    タグ配列 (共通)
 *   publish: true | false (false のままでは変換されない)
 *   qiita_id:  Qiita 記事 ID (初回空欄、Qiita デプロイ後に自動付与)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

// ─── パス定義 ────────────────────────────────────────────────────────────────
const DRAFTS_DIR = path.resolve(__dirname, "../drafts");
const ZENN_DIR = path.resolve(__dirname, "../articles");
const QIITA_DIR = path.resolve(__dirname, "../public");
const DRAFT_IMG = path.resolve(__dirname, "../drafts/images");
const ZENN_IMG = path.resolve(__dirname, "../images");

// ─── 免責事項 ─────────────────────────────────────────────────────────────────
const DISCLAIMER = `

---

> **免責事項**
> この記事のコードは [MIT License](https://github.com/sotashimozono/SyncLore/blob/main/LICENSE) に基づき自由に利用できます。
> ただし記事本文の著作権はすべて筆者に帰属し、無断転載・再利用を禁じます。
> 記事の内容は執筆時点のものであり、正確性・完全性を保証しません。
> 本記事の利用によって生じたいかなる損害についても筆者は責任を負いません。
`;

// ─── ディレクトリ作成 ──────────────────────────────────────────────────────────
[ZENN_DIR, QIITA_DIR, ZENN_IMG].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── ユーティリティ ────────────────────────────────────────────────────────────

/**
 * drafts/images/<slug>/ を images/<slug>/ にコピーする（再帰的）
 */
function copyImages(slug) {
  const srcDir = path.join(DRAFT_IMG, slug);
  const dstDir = path.join(ZENN_IMG, slug);
  if (!fs.existsSync(srcDir)) return;

  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyImagesRecursive(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function copyImagesRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyImagesRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

/**
 * Qiita の既存ファイルから id を読み出す
 */
function getExistingQiitaId(slug) {
  const qiitaPath = path.join(QIITA_DIR, `${slug}.md`);
  if (!fs.existsSync(qiitaPath)) return null;
  try {
    const parsed = matter(fs.readFileSync(qiitaPath, "utf8"));
    return parsed.data.id || null;
  } catch {
    return null;
  }
}

// ─── 変換ロジック ──────────────────────────────────────────────────────────────

function toZennFrontmatter(data) {
  return {
    title: data.title || "(タイトル未設定)",
    emoji: data.emoji || "📝",
    type: data.type || "tech",
    topics: data.topics || [],
    publish: data.publish === true,
  };
}

function toQiitaFrontmatter(data, existingId) {
  const tags = (data.topics || []).map((t) => ({ name: t }));
  return {
    title: data.title || "(タイトル未設定)",
    tags,
    private: data.publish !== true,
    id: existingId || null,
  };
}

/**
 * Zenn 用コンテンツを手動 YAML で組み立てる（gray-matter stringify は絵文字を Unicode エスケープするため）
 */
function buildZennContent(fm, body) {
  const topicsYaml = fm.topics.map((t) => `  - ${t}`).join("\n");
  const header = [
    "---",
    `title: "${fm.title}"`,
    `emoji: "${fm.emoji}"`,
    `type: ${fm.type}`,
    "topics:",
    topicsYaml,
    `publish: ${fm.publish}`,
    "---",
  ].join("\n");
  return `${header}\n${body}`;
}

/**
 * Qiita 用コンテンツを手動 YAML で組み立てる
 */
function buildQiitaContent(fm, body) {
  const tagsYaml = fm.tags.map((t) => `  - name: "${t.name}"`).join("\n");
  const idLine = fm.id ? `id: ${fm.id}` : "id: null";
  const header = [
    "---",
    `title: "${fm.title}"`,
    "tags:",
    tagsYaml,
    `private: ${fm.private}`,
    idLine,
    "---",
  ].join("\n");
  return `${header}\n${body}`;
}

// ─── メイン処理 ───────────────────────────────────────────────────────────────

let converted = 0;
let skipped = 0;

const files = fs
  .readdirSync(DRAFTS_DIR)
  .filter((f) => path.extname(f) === ".md");

for (const file of files) {
  const srcPath = path.join(DRAFTS_DIR, file);
  const raw = fs.readFileSync(srcPath, "utf8");
  const parsed = matter(raw);
  const data = parsed.data;

  // publish: true のみ対象
  if (!data.publish) {
    console.log(`  [SKIP] ${file} (publish: false)`);
    skipped++;
    continue;
  }

  const slug = path.basename(file, ".md");
  const body = parsed.content.trimEnd();
  const bodyWithDisclaimer = body + DISCLAIMER;

  // ── Zenn ──────────────────────────────────────────────────────────────────
  const zennFm = toZennFrontmatter(data);
  const zennContent = buildZennContent(zennFm, bodyWithDisclaimer);
  fs.writeFileSync(path.join(ZENN_DIR, file), zennContent, "utf8");

  // ── Qiita ─────────────────────────────────────────────────────────────────
  const existingId = getExistingQiitaId(slug);
  const qiitaFm = toQiitaFrontmatter(data, existingId);
  const qiitaContent = buildQiitaContent(qiitaFm, bodyWithDisclaimer);
  fs.writeFileSync(path.join(QIITA_DIR, file), qiitaContent, "utf8");

  // ── 画像コピー ─────────────────────────────────────────────────────────────
  copyImages(slug);

  // Remove source file from drafts/ (articles/ becomes the permanent record)
  fs.unlinkSync(srcPath);

  console.log(
    `  [OK]   ${file} => zenn & qiita${existingId ? ` (qiita_id: ${existingId})` : ""} (draft removed)`,
  );
  converted++;
}

console.log(`\nDone. ${converted} converted, ${skipped} skipped.`);
