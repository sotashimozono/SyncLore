/**
 * dry-run.js
 *
 * `npm run convert` を実行せず、各 drafts/<slug>.md が次にどう分類されるかを
 * 表示するだけの read-only スクリプト。push / cron 前の最終確認に使う。
 *
 * 分類ルールは convert.js と一致させてある:
 *   delete:true                                                          → TOMBSTONE
 *   publish:true                                                         → LIVE  (publish_at は無視)
 *   publish:false かつ publish_at <= now                                 → LIVE  (予約発火 / 過去日時即時)
 *   publish:false かつ publish_at > now かつ既存出力なし                 → SCHEDULED
 *   publish:false かつ既存出力 (articles/<slug>.md or public/<slug>.md)  → HIDDEN  (convert.js の HIDE)
 *   publish:false かつ既存出力なし かつ publish_at なし/不正            → SKIP
 *   template.md / フロントマター無し / parse 失敗                       → SKIP
 *
 * 書き込みは一切行わない。articles/ public/ images/ のディレクトリも作成しない。
 */

"use strict";

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

// convert.js と同じパス解決ルール (SYNCLORE_DEPLOY_ROOT があればそちらを見る)
const SOURCE_ROOT = path.resolve(__dirname, "..");
const DEPLOY_ROOT = process.env.SYNCLORE_DEPLOY_ROOT
  ? path.resolve(process.env.SYNCLORE_DEPLOY_ROOT)
  : SOURCE_ROOT;
const DRAFTS_DIR = path.join(SOURCE_ROOT, "drafts");
const ZENN_DIR = path.join(DEPLOY_ROOT, "articles");
const QIITA_DIR = path.join(DEPLOY_ROOT, "public");

const NOW = new Date();

function parsePublishAt(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function readQiitaId(qiitaPath) {
  if (!fs.existsSync(qiitaPath)) return null;
  try {
    const fm = matter(fs.readFileSync(qiitaPath, "utf8")).data || {};
    return fm.id || null;
  } catch {
    return null;
  }
}

function classify(file) {
  const draftPath = path.join(DRAFTS_DIR, file);
  const zennPath = path.join(ZENN_DIR, file);
  const qiitaPath = path.join(QIITA_DIR, file);

  if (file === "template.md") {
    return { status: "SKIP", file, reason: "template.md (no frontmatter / draft)" };
  }

  let parsed;
  try {
    parsed = matter(fs.readFileSync(draftPath, "utf8"));
  } catch (e) {
    return { status: "SKIP", file, reason: `parse error: ${e.message}` };
  }
  const data = parsed.data || {};

  if (!data || Object.keys(data).length === 0) {
    return { status: "SKIP", file, reason: "no frontmatter" };
  }

  if (data.delete === true) {
    const qiitaId = readQiitaId(qiitaPath);
    const detail = qiitaId
      ? `delete: true (qiita_id: ${qiitaId})`
      : "delete: true (no qiita_id)";
    return { status: "TOMBSTONE", file, reason: detail, qiitaId };
  }

  const publishAt = parsePublishAt(data.publish_at);
  const scheduleDue = publishAt !== null && publishAt <= NOW;
  const isPublic = data.publish === true || scheduleDue;

  if (isPublic) {
    if (data.publish === true) {
      return { status: "LIVE", file, reason: "publish: true" };
    }
    return {
      status: "LIVE",
      file,
      reason: `publish_at: ${data.publish_at} (past, fired)`,
    };
  }

  // !isPublic: publish:false (もしくは未指定) のケース
  const hasZenn = fs.existsSync(zennPath);
  const hasQiita = fs.existsSync(qiitaPath);

  if (!hasZenn && !hasQiita) {
    if (publishAt !== null) {
      return {
        status: "SCHEDULED",
        file,
        reason: `publish_at: ${data.publish_at}`,
      };
    }
    return { status: "SKIP", file, reason: "publish: false (no output yet)" };
  }

  // 既存出力がある + !isPublic → HIDE (convert.js での表記)
  return { status: "HIDDEN", file, reason: "publish: false (no publish_at)" };
}

function pad(s, n) {
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}

function main() {
  console.log("DRY RUN — no files written\n");

  if (!fs.existsSync(DRAFTS_DIR)) {
    console.log("(no drafts/ directory)");
    return;
  }

  const draftFiles = fs
    .readdirSync(DRAFTS_DIR)
    .filter((f) => path.extname(f) === ".md")
    .sort();

  const results = draftFiles.map(classify);

  // 表示幅: 一番長いファイル名に合わせる (最低 24 桁)
  const fileColWidth = Math.max(
    24,
    ...results.map((r) => r.file.length + 2),
  );

  for (const r of results) {
    const tag = pad(`[${r.status}]`, 12);
    const fname = pad(r.file, fileColWidth);
    console.log(`${tag}${fname}${r.reason}`);
  }

  // 集計
  const counts = {
    LIVE: 0,
    SCHEDULED: 0,
    HIDDEN: 0,
    TOMBSTONE: 0,
    SKIP: 0,
  };
  for (const r of results) counts[r.status]++;

  console.log("");
  const writeParts = [];
  if (counts.LIVE > 0) writeParts.push(`${counts.LIVE} LIVE`);
  if (counts.SCHEDULED > 0) writeParts.push(`${counts.SCHEDULED} SCHEDULED`);
  if (counts.HIDDEN > 0) writeParts.push(`${counts.HIDDEN} HIDDEN`);
  if (writeParts.length > 0) {
    console.log(
      `Would write ${writeParts.join(", ")} to articles/ + public/.`,
    );
  } else {
    console.log("Would write nothing to articles/ + public/.");
  }

  if (counts.TOMBSTONE > 0) {
    const ids = results
      .filter((r) => r.status === "TOMBSTONE" && r.qiitaId)
      .map((r) => r.qiitaId);
    const idSuffix = ids.length > 0 ? ` (Qiita DELETE ${ids.join(", ")})` : "";
    console.log(`Would tombstone ${counts.TOMBSTONE}${idSuffix}.`);
  }

  if (counts.SKIP > 0) {
    console.log(`Skipped ${counts.SKIP} (template / draft / no frontmatter).`);
  }
}

main();
