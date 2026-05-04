/**
 * series.js
 *
 * 連載記事 (series) の cross-link footer 生成ヘルパ。
 *
 * draft frontmatter に `series: "シリーズ名"` を書くと、convert 時に
 * 同じシリーズに属する他記事へのリンク一覧を本文末尾に自動挿入する。
 *
 * 順序: publish_at (無ければファイル名 = slug) 昇順。
 *
 * Link 形式:
 *   - Zenn 出力: https://zenn.dev/<user>/articles/<slug>
 *   - Qiita 出力: https://qiita.com/<user>/items/<id>
 *   - 未公開 (qiita id 無し / Zenn user 未解決) の sibling は plain text
 *   - 自分自身は太字 (link なし)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

/**
 * 同じ series 値を持つ draft を集める。
 * drafts/ 直下のみ走査 (archive は対象外。連載 footer は「現役連載」のみ)。
 *
 * @param {string} draftsDir   drafts/ への絶対パス
 * @param {string} qiitaDir    public/ への絶対パス (Qiita id 引き当て用)
 * @param {string} seriesName  対象シリーズ名
 * @returns {Array<{slug:string,title:string,publish_at:Date|null,qiita_id:string|null,zenn_published:boolean}>}
 */
function collectSeriesMembers(draftsDir, qiitaDir, seriesName) {
  if (!seriesName || typeof seriesName !== "string") return [];
  if (!fs.existsSync(draftsDir)) return [];

  const members = [];
  for (const f of fs.readdirSync(draftsDir)) {
    if (path.extname(f) !== ".md") continue;
    if (f === "template.md") continue;

    const slug = path.basename(f, ".md");
    let fm = {};
    try {
      fm = matter(fs.readFileSync(path.join(draftsDir, f), "utf8")).data || {};
    } catch {
      continue;
    }

    if (typeof fm.series !== "string" || fm.series !== seriesName) continue;

    let publishAt = null;
    if (fm.publish_at) {
      const d = new Date(fm.publish_at);
      if (!Number.isNaN(d.getTime())) publishAt = d;
    }

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

    // Zenn 公開状態: draft の publish:true、または publish_at <= now で effective LIVE。
    const now = new Date();
    const scheduleDue = publishAt !== null && publishAt <= now;
    const zennPublished = fm.publish === true || scheduleDue;

    members.push({
      slug,
      title: typeof fm.title === "string" ? fm.title : slug,
      publish_at: publishAt,
      qiita_id: qiitaId,
      zenn_published: zennPublished,
    });
  }

  // 順序: publish_at 昇順。publish_at が無いものはファイル名 (slug) 昇順。
  // publish_at あり / 無しが混在する場合は「publish_at あり」を先に置く
  // (連載は普通すべて publish_at で並ぶか、すべて無しのどちらか)。
  members.sort((a, b) => {
    if (a.publish_at && b.publish_at) {
      return a.publish_at.getTime() - b.publish_at.getTime();
    }
    if (a.publish_at) return -1;
    if (b.publish_at) return 1;
    return a.slug.localeCompare(b.slug);
  });

  return members;
}

/**
 * series cross-link footer を Markdown で生成する。
 *
 * @param {string} currentSlug  自分自身の slug (太字 + link なし)
 * @param {Array}  members      collectSeriesMembers の戻り値
 * @param {"zenn"|"qiita"} platform
 * @param {{zennUser:string|null, qiitaUser:string|null}} opts
 * @returns {string}  footer Markdown (空配列時は空文字)
 */
function renderSeriesFooter(currentSlug, members, platform, opts) {
  if (!Array.isArray(members) || members.length === 0) return "";
  // 自分以外に sibling がいなければ footer を出さない (1 本だけのシリーズに意味がない)
  const hasOther = members.some((m) => m.slug !== currentSlug);
  if (!hasOther) return "";

  const zennUser = opts && opts.zennUser ? opts.zennUser : null;
  const qiitaUser = opts && opts.qiitaUser ? opts.qiitaUser : null;

  const lines = ["---", "", "## 同じシリーズの記事", ""];

  for (const m of members) {
    const titleText = (m.title || m.slug).replace(/[\[\]]/g, "");
    if (m.slug === currentSlug) {
      lines.push(`- **${titleText}**`);
      continue;
    }
    if (platform === "zenn") {
      if (m.zenn_published && zennUser) {
        lines.push(`- [${titleText}](https://zenn.dev/${zennUser}/articles/${m.slug})`);
      } else {
        // 未公開 sibling は plain text
        lines.push(`- ${titleText}`);
      }
    } else if (platform === "qiita") {
      if (m.qiita_id && qiitaUser) {
        lines.push(`- [${titleText}](https://qiita.com/${qiitaUser}/items/${m.qiita_id})`);
      } else {
        lines.push(`- ${titleText}`);
      }
    } else {
      lines.push(`- ${titleText}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

module.exports = {
  collectSeriesMembers,
  renderSeriesFooter,
};
