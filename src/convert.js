/**
 * convert.js
 *
 * drafts/*.md (SSoT) を読み、Zenn 用 articles/<slug>.md と
 * Qiita 用 public/<slug>.md を冪等に再生成する。
 *
 * フロントマター仕様 (drafts/<slug>.md):
 *   title:      string   (必須)
 *   emoji:      string   (Zenn 専用、省略時 📝)
 *   type:       "tech" | "idea" (Zenn 専用、省略時 tech)
 *   topics:     string[] (タグ、Zenn は最大 5)
 *   publish:    boolean  — true で即時公開、false で非公開
 *   publish_at: ISO-8601 string (任意) — 予約公開時刻 (TZ 必須)
 *
 * 状態判定 (slug ごと、publish_at の解釈は現在時刻に依存):
 *   publish:true                                          → LIVE  (即時公開、publish_at は無視)
 *   publish:false かつ publish_at <= now                  → LIVE  (予約発火 / 過去日時即時公開)
 *   publish:false かつ publish_at > now かつ既存出力なし  → SCHEDULED (待機)
 *   publish:false かつ articles/public のいずれか既存     → HIDE  (unpublish)
 *   publish:false かつ既存出力なし                        → SKIP  (執筆中)
 *
 * 過去日時 (publish_at <= now) の含意:
 *   - 予約公開の発火と「最初から過去日時を書く」は同じパス。
 *   - 一度公開した後 publish:false のまま放置しても、publish_at が過去なら
 *     毎時 cron 実行のたびに LIVE 扱いで再生成される (= 公開維持)。
 *   - 予約取り下げは publish_at を消すか未来時刻に戻す。
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
const { collectSeriesMembers, renderSeriesFooter } = require("./lib/series");

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

// ─── Wiki-link username 解決 ──────────────────────────────────────────────────
function ghOwner() {
  const v = process.env.GITHUB_REPOSITORY;
  return v ? v.split("/")[0] || null : null;
}
const QIITA_USER = process.env.QIITA_USERNAME || ghOwner();
const ZENN_USER = process.env.ZENN_USERNAME || ghOwner();
const REPO_FULL = process.env.GITHUB_REPOSITORY || null;

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

// ─── Wiki-link 解決 ───────────────────────────────────────────────────────────
// drafts/<slug>.md の本文に書ける [[other-slug]] / [[other-slug|表示]] を、
// プラットフォーム別の URL に変換する。
//   Zenn:  https://zenn.dev/<user>/articles/<slug>
//   Qiita: https://qiita.com/<user>/items/<id>  (id は public/<slug>.md から)
//   Qiita で id 未割当 → GitHub の drafts/<slug>.md にフォールバック
// コードブロック / inline code 内は無変換。
const WIKI_LINK_RE = /\[\[([^\]\|\n]+)(?:\|([^\]\n]+))?\]\]/g;
const CODE_SPLIT_RE = /(```[\s\S]*?```|`[^`\n]*`)/;

// slugMap = { primary: Map<slug, {title, qiitaId, source}>, aliasMap: Map<aliasSlug, primarySlug> }
//   primary: drafts/*.md と drafts/archive/*.md 両方を含む。記事は archive 移動後も
//            articles/<slug>.md / public/<slug>.md が deploy に残っているので link target
//            として有効。
//   aliasMap: フロントマターの aliases:[old-slug,...] を逆引き登録。rename 時に
//             [[old-slug]] が新 slug の URL に解決されるようにする。
function buildSlugMap() {
  const primary = new Map();
  const aliasMap = new Map();

  function ingest(dir, source) {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (path.extname(f) !== ".md" || f === "template.md") continue;
      const slug = path.basename(f, ".md");
      let draftFm = {};
      try {
        draftFm = matter(fs.readFileSync(path.join(dir, f), "utf8")).data || {};
      } catch {}
      const qPath = path.join(QIITA_DIR, f);
      let qiitaId = null;
      if (fs.existsSync(qPath)) {
        try {
          const qFm = matter(fs.readFileSync(qPath, "utf8")).data || {};
          qiitaId = qFm.id || null;
        } catch {}
      }
      primary.set(slug, { title: draftFm.title || null, qiitaId, source });
      const aliases = Array.isArray(draftFm.aliases) ? draftFm.aliases : [];
      for (const a of aliases) {
        if (typeof a !== "string" || !a.trim()) continue;
        const aliasSlug = a.trim().replace(/\.md$/, "");
        if (aliasMap.has(aliasSlug)) {
          console.warn(
            `  [WARN] alias collision: '${aliasSlug}' claimed by both '${aliasMap.get(aliasSlug)}' and '${slug}' (keeping first)`,
          );
          continue;
        }
        aliasMap.set(aliasSlug, slug);
      }
    }
  }

  ingest(DRAFTS_DIR, "top");
  ingest(path.join(DRAFTS_DIR, "archive"), "archive");
  return { primary, aliasMap };
}

function resolveSlug(target, slugMap) {
  if (slugMap.primary.has(target)) return target;
  if (slugMap.aliasMap.has(target)) return slugMap.aliasMap.get(target);
  return null;
}

// rename 検出時の Qiita id 移動 + orphan cleanup。
// drafts/<primary>.md に aliases:[<old>] があり、deploy/public/<old>.md に id がある場合:
//   1. その id を primary entry に migrate (LIVE 出力時に引き継がせる)
//   2. deploy/public/<old>.md と articles/<old>.md を削除 (qiita publish の重複対策)
function migrateQiitaIdsForAliases(slugMap) {
  for (const [aliasSlug, primarySlug] of slugMap.aliasMap) {
    if (aliasSlug === primarySlug) continue;
    const aliasQPath = path.join(QIITA_DIR, `${aliasSlug}.md`);
    if (!fs.existsSync(aliasQPath)) continue;
    let aliasFm = {};
    try {
      aliasFm = matter(fs.readFileSync(aliasQPath, "utf8")).data || {};
    } catch {}
    if (!aliasFm.id) continue;

    const primaryEntry = slugMap.primary.get(primarySlug);
    if (!primaryEntry) continue;

    if (primaryEntry.qiitaId && primaryEntry.qiitaId !== aliasFm.id) {
      console.warn(
        `  [WARN] alias migration skipped: '${primarySlug}' already has qiita_id ${primaryEntry.qiitaId}, refusing to overwrite with '${aliasSlug}' id ${aliasFm.id}`,
      );
      continue;
    }

    if (!primaryEntry.qiitaId) {
      console.log(`  [MIGRATE] qiita id ${aliasFm.id}: ${aliasSlug} -> ${primarySlug}`);
      primaryEntry.qiitaId = aliasFm.id;
    }

    // 旧 outputs を削除 (orphan 化を防ぎ、qiita publish が同じ id を二重 push しないため)
    const aliasZennPath = path.join(ZENN_DIR, `${aliasSlug}.md`);
    if (fs.existsSync(aliasQPath)) {
      fs.unlinkSync(aliasQPath);
      console.log(`            removed public/${aliasSlug}.md`);
    }
    if (fs.existsSync(aliasZennPath)) {
      fs.unlinkSync(aliasZennPath);
      console.log(`            removed articles/${aliasSlug}.md`);
    }
  }
}

function transformWikiLinks(body, platform, slugMap, currentSlug) {
  return body
    .split(CODE_SPLIT_RE)
    .map((part, i) => {
      // i 奇数 = code (split が match を含めるため)。code はそのまま
      if (i % 2 === 1) return part;
      return part.replace(WIKI_LINK_RE, (match, target, display) => {
        const rawSlug = target.replace(/\.md$/, "").trim();
        if (rawSlug === currentSlug) {
          console.warn(`  [WARN] self-reference wiki link: [[${target}]] in ${currentSlug}.md (left as-is)`);
          return match;
        }
        const resolved = resolveSlug(rawSlug, slugMap);
        if (!resolved) {
          console.warn(`  [WARN] unknown wiki link target: [[${target}]] in ${currentSlug}.md (left as-is)`);
          return match;
        }
        if (resolved !== rawSlug) {
          console.log(`  [INFO] wiki link via alias: [[${rawSlug}]] -> ${resolved} in ${currentSlug}.md`);
        }
        const entry = slugMap.primary.get(resolved);
        const text = (display || entry.title || resolved).trim().replace(/[\[\]]/g, "");
        if (platform === "zenn") {
          if (!ZENN_USER) {
            console.warn(`  [WARN] ZENN_USERNAME / GITHUB_REPOSITORY not set; [[${target}]] left as-is`);
            return match;
          }
          return `[${text}](https://zenn.dev/${ZENN_USER}/articles/${resolved})`;
        }
        if (platform === "qiita") {
          if (entry.qiitaId && QIITA_USER) {
            return `[${text}](https://qiita.com/${QIITA_USER}/items/${entry.qiitaId})`;
          }
          // Fallback (b): GitHub の drafts/<resolved>.md
          if (REPO_FULL) {
            console.warn(`  [WARN] [[${target}]] has no Qiita id yet; falling back to GitHub link in Qiita output`);
            return `[${text}](https://github.com/${REPO_FULL}/blob/main/drafts/${resolved}.md)`;
          }
          console.warn(`  [WARN] [[${target}]] has no Qiita id and no GITHUB_REPOSITORY env; left as-is`);
          return match;
        }
        return match;
      });
    })
    .join("");
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

// isPublic は呼び出し側で計算済みの「実効公開状態」。
//   data.publish === true → 即時公開
//   data.publish === false かつ publish_at <= now → 予約発火 (or 過去日時で即時公開)
// data.publish を直接見ると予約公開が反映されないので isPublic を引き回している。
function buildZennContent(data, body, isPublic) {
  const title = data.title || "(タイトル未設定)";
  const emoji = data.emoji || "📝";
  const type = data.type === "idea" ? "idea" : "tech";
  const topics = Array.isArray(data.topics) ? data.topics : [];
  const published = isPublic === true;

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

function buildQiitaContent(data, existingFm, body, isPublic) {
  const title = data.title || "(タイトル未設定)";
  // qiita-cli expects tags as string[] (file-system-repo.js fromItem maps API
  // {name, versions} -> name string). [{name}] objects break the API payload.
  const tags = Array.isArray(data.topics) ? data.topics : [];
  // isPublic は buildZennContent と同じく実効公開状態 (publish_at 反映済)。
  const isPrivate = isPublic !== true;

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

// Wiki-link 解決用 slug マップを最初に構築 (drafts/*.md, drafts/archive/*.md, public/*.md から)
const slugMap = buildSlugMap();

// rename 検出: aliases:[old-slug] が宣言されていたら old の qiita id を primary に移す
migrateQiitaIdsForAliases(slugMap);

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

  // 連載 footer: data.series が文字列なら同 series の他 draft を集めて
  // 本文末尾 (DISCLAIMER の前) にリンク一覧を挿入する。
  // sibling が自分以外に居なければ renderSeriesFooter は空文字を返す (no-op)。
  let seriesFooterZenn = "";
  let seriesFooterQiita = "";
  if (typeof data.series === "string" && data.series.trim()) {
    const seriesMembers = collectSeriesMembers(DRAFTS_DIR, QIITA_DIR, data.series);
    seriesFooterZenn = renderSeriesFooter(slug, seriesMembers, "zenn", {
      zennUser: ZENN_USER,
      qiitaUser: QIITA_USER,
    });
    seriesFooterQiita = renderSeriesFooter(slug, seriesMembers, "qiita", {
      zennUser: ZENN_USER,
      qiitaUser: QIITA_USER,
    });
  }

  // Wiki-link はプラットフォームごとに違う URL に展開されるので、body を 2 つ作る。
  // 順序: 本文 → series footer → disclaimer (一番最後)。
  const zennBodyRaw = transformWikiLinks(parsed.content, "zenn", slugMap, slug);
  const qiitaBodyRaw = transformWikiLinks(parsed.content, "qiita", slugMap, slug);
  const zennBody = appendDisclaimer(
    seriesFooterZenn ? `${zennBodyRaw.trimEnd()}\n\n${seriesFooterZenn}` : zennBodyRaw,
  );
  const qiitaBody = appendDisclaimer(
    seriesFooterQiita ? `${qiitaBodyRaw.trimEnd()}\n\n${seriesFooterQiita}` : qiitaBodyRaw,
  );

  fs.writeFileSync(zennPath, buildZennContent(data, zennBody, isPublic), "utf8");

  // 既存の public/<slug>.md が無くても、aliases から migrate された qiita id があれば
  // それを id として引き継ぐ。slugMap.primary[slug].qiitaId は migrateQiitaIdsForAliases で
  // 更新されている可能性がある。
  const rawExistingQiitaFm = readExistingFrontmatter(qiitaPath);
  const slugMapEntry = slugMap.primary.get(slug);
  const existingQiitaFm =
    rawExistingQiitaFm ||
    (slugMapEntry && slugMapEntry.qiitaId
      ? { id: slugMapEntry.qiitaId }
      : null);
  fs.writeFileSync(
    qiitaPath,
    buildQiitaContent(data, existingQiitaFm, qiitaBody, isPublic),
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
