/**
 * src/lib/wikilink.js
 *
 * drafts 本文中の Obsidian / Roam ライクな wiki-link を、Zenn / Qiita 各
 * プラットフォーム向けの URL に解決する。
 *
 *   [[other-slug]]            -> [other-slug](URL)              (label = slug)
 *   [[other-slug|表示テキスト]]  -> [表示テキスト](URL)
 *
 * URL の決め方:
 *   Zenn:  https://zenn.dev/<user>/articles/<slug>
 *          (user = SYNCLORE_ZENN_USER || ZENN_USERNAME || GITHUB_REPOSITORY owner)
 *   Qiita: https://qiita.com/<user>/items/<id>
 *          (id は public/<slug>.md のフロントマターから引き継ぐ)
 *          id 未割当なら GitHub の drafts/<slug>.md にフォールバック
 *
 * コードフェンス / inline code 内の `[[...]]` は変換しない。
 *
 * 公開 API:
 *   buildSlugMap({ draftsDir, archiveDir, qiitaDir }) -> { primary, aliasMap }
 *   migrateQiitaIdsForAliases(slugMap, { qiitaDir, articlesDir })
 *   resolveWikilinks(body, opts) -> { body, warnings, infos }
 *
 * resolveWikilinks の opts:
 *   platform:    "zenn" | "qiita"
 *   slugMap:     buildSlugMap の戻り値 (primary + aliasMap)
 *   currentSlug: 自記事 slug (self-reference の検出用)
 *   zennUser:    Zenn ユーザ名
 *   qiitaUser:   Qiita ユーザ名
 *   repoFull:    "owner/repo" 形式 (Qiita fallback で使用)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

// 既存実装と同じ寛容な regex (slug に大文字や日本語などが入っていても拾う)。
// 仕様メモの `/\[\[([a-z0-9_-]+)(?:\|([^\]]+))?\]\]/g` よりも寛容だが、
// 既存 draft の `[[synclore-intro|...]]` を含めて backward-compat を保つ。
const WIKI_LINK_RE = /\[\[([^\]\|\n]+)(?:\|([^\]\n]+))?\]\]/g;
const CODE_SPLIT_RE = /(```[\s\S]*?```|`[^`\n]*`)/;

// ─── slug map 構築 ──────────────────────────────────────────────────────────
// primary:  Map<slug, {title, qiitaId, source}>
//           drafts/*.md と drafts/archive/*.md を両方含める。archive 配下も
//           articles/<slug>.md / public/<slug>.md が deploy に残っていれば
//           link target として有効。
// aliasMap: Map<aliasSlug, primarySlug>
//           フロントマターの aliases:[old-slug,...] を逆引き登録。rename 時に
//           [[old-slug]] が新 slug の URL に解決されるようにする。
function buildSlugMap({ draftsDir, archiveDir, qiitaDir }) {
  const primary = new Map();
  const aliasMap = new Map();

  function ingest(dir, source) {
    if (!dir || !fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (path.extname(f) !== ".md" || f === "template.md") continue;
      const slug = path.basename(f, ".md");
      let draftFm = {};
      try {
        draftFm = matter(fs.readFileSync(path.join(dir, f), "utf8")).data || {};
      } catch {}
      let qiitaId = null;
      if (qiitaDir) {
        const qPath = path.join(qiitaDir, f);
        if (fs.existsSync(qPath)) {
          try {
            const qFm = matter(fs.readFileSync(qPath, "utf8")).data || {};
            qiitaId = qFm.id || null;
          } catch {}
        }
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

  ingest(draftsDir, "top");
  ingest(archiveDir, "archive");
  return { primary, aliasMap };
}

function resolveSlug(target, slugMap) {
  if (slugMap.primary.has(target)) return target;
  if (slugMap.aliasMap.has(target)) return slugMap.aliasMap.get(target);
  return null;
}

// rename 検出時の Qiita id 移動 + orphan cleanup。
// drafts/<primary>.md に aliases:[<old>] があり deploy/public/<old>.md に id が
// あれば、id を primary entry に migrate して旧 outputs を削除する。
function migrateQiitaIdsForAliases(slugMap, { qiitaDir, articlesDir }) {
  if (!qiitaDir) return;
  for (const [aliasSlug, primarySlug] of slugMap.aliasMap) {
    if (aliasSlug === primarySlug) continue;
    const aliasQPath = path.join(qiitaDir, `${aliasSlug}.md`);
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

    const aliasZennPath = articlesDir ? path.join(articlesDir, `${aliasSlug}.md`) : null;
    if (fs.existsSync(aliasQPath)) {
      fs.unlinkSync(aliasQPath);
      console.log(`            removed public/${aliasSlug}.md`);
    }
    if (aliasZennPath && fs.existsSync(aliasZennPath)) {
      fs.unlinkSync(aliasZennPath);
      console.log(`            removed articles/${aliasSlug}.md`);
    }
  }
}

// ─── 本体: 1 記事分の wiki-link 解決 ─────────────────────────────────────────
// platform 別に URL を決める。コードフェンス / inline code 内は無変換。
// 警告は呼び出し側で重複しないよう、ここでは warnings 配列に詰めて返す。
function resolveWikilinks(body, opts) {
  const {
    platform,
    slugMap,
    currentSlug,
    zennUser,
    qiitaUser,
    repoFull,
  } = opts;
  const warnings = [];
  const infos = [];

  const out = body
    .split(CODE_SPLIT_RE)
    .map((part, i) => {
      // i 奇数 = code block / inline code (split が match を含めるため)
      if (i % 2 === 1) return part;
      return part.replace(WIKI_LINK_RE, (match, target, display) => {
        const rawSlug = target.replace(/\.md$/, "").trim();
        if (rawSlug === currentSlug) {
          warnings.push(
            `self-reference wiki link: [[${target}]] in ${currentSlug}.md (left as-is)`,
          );
          return match;
        }
        const resolved = resolveSlug(rawSlug, slugMap);
        if (!resolved) {
          warnings.push(
            `unknown wiki link target: [[${target}]] in ${currentSlug}.md (left as-is)`,
          );
          return match;
        }
        if (resolved !== rawSlug) {
          infos.push(
            `wiki link via alias: [[${rawSlug}]] -> ${resolved} in ${currentSlug}.md`,
          );
        }
        const entry = slugMap.primary.get(resolved);
        const text = (display || entry.title || resolved).trim().replace(/[\[\]]/g, "");

        if (platform === "zenn") {
          if (!zennUser) {
            warnings.push(
              `SYNCLORE_ZENN_USER / ZENN_USERNAME / GITHUB_REPOSITORY not set; [[${target}]] left as-is`,
            );
            return match;
          }
          return `[${text}](https://zenn.dev/${zennUser}/articles/${resolved})`;
        }

        if (platform === "qiita") {
          if (entry.qiitaId && qiitaUser) {
            return `[${text}](https://qiita.com/${qiitaUser}/items/${entry.qiitaId})`;
          }
          // Fallback: GitHub の drafts/<resolved>.md
          if (repoFull) {
            warnings.push(
              `[[${target}]] has no Qiita id yet; falling back to GitHub link in Qiita output`,
            );
            return `[${text}](https://github.com/${repoFull}/blob/main/drafts/${resolved}.md)`;
          }
          warnings.push(
            `[[${target}]] has no Qiita id and no GITHUB_REPOSITORY env; left as-is`,
          );
          return match;
        }
        return match;
      });
    })
    .join("");

  return { body: out, warnings, infos };
}

module.exports = {
  buildSlugMap,
  migrateQiitaIdsForAliases,
  resolveWikilinks,
  // exported for tests / advanced callers
  WIKI_LINK_RE,
  CODE_SPLIT_RE,
};
