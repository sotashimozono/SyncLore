/**
 * lint.js
 *
 * drafts/*.md (SSoT) を全件 read + gray-matter parse し、push 前に
 * publish 失敗 / 暴発を引き起こしうる frontmatter / 内部リンク / 画像 path
 * を検査する read-only linter。自動 fix は行わない。
 *
 * 検査項目:
 *   1. 必須 frontmatter
 *      - title: string, 非空
 *      - topics: array, 1〜5 個 (Qiita 制限)
 *   2. type の値: "tech" | "idea" のみ (省略可、Zenn 専用)
 *   3. publish: bool (true / false)
 *   4. publish_at がある場合: ISO-8601 + TZ 必須
 *      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/
 *   5. publish: true かつ publish_at が未来日 → 警告 (矛盾)
 *   6. delete: true が他フィールドと両立しない場合 → 警告
 *   7. slug 衝突: <slug>.md が unique か (case-insensitive)
 *   8. 画像 path 存在: 本文中の
 *      ![](images/<slug>/...)
 *      ![](drafts/images/<slug>/...)
 *      ![](/images/<slug>/...)
 *      が実在するか
 *   9. tag 名: Qiita ルール (英数字 + - . + #)、空文字禁止
 *
 * Exit code:
 *   - error 1 つ以上: 1
 *   - warning だけ:    0
 *   - --strict 指定時は warning も exit 1
 */

"use strict";

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

const SOURCE_ROOT = path.resolve(__dirname, "..");
const DRAFTS_DIR = path.join(SOURCE_ROOT, "drafts");

const ISO_TZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
// Qiita タグ: 英数字 + - . + # (Qiita-CLI の検証ルールに準拠)
const QIITA_TAG_RE = /^[A-Za-z0-9\-.+#]+$/;

const argv = process.argv.slice(2);
const STRICT = argv.includes("--strict");

/**
 * @typedef {Object} Diag
 * @property {"error"|"warning"} level
 * @property {string} msg
 */

/**
 * @typedef {Object} FileResult
 * @property {string} relPath
 * @property {Diag[]} diags
 */

/** @returns {string[]} */
function listDrafts() {
  if (!fs.existsSync(DRAFTS_DIR)) return [];
  return fs
    .readdirSync(DRAFTS_DIR)
    .filter((name) => name.endsWith(".md") && name !== "template.md")
    .map((name) => path.join(DRAFTS_DIR, name))
    .filter((p) => fs.statSync(p).isFile());
}

/**
 * 本文から fenced code block (```...```) と inline code (`...`) を除去する。
 * これらの中に書かれた `![](...)` はサンプル / 説明であり、実画像参照ではない。
 * @param {string} content
 * @returns {string}
 */
function stripCode(content) {
  // fenced code block (```lang ... ``` または ~~~ ... ~~~)
  let out = content.replace(/```[\s\S]*?```/g, "");
  out = out.replace(/~~~[\s\S]*?~~~/g, "");
  // inline code (`...`)
  out = out.replace(/`[^`\n]*`/g, "");
  return out;
}

/**
 * 本文中の image 参照を抜き出す (code block / inline code 内は除外)。
 *   ![alt](images/<slug>/...)
 *   ![alt](drafts/images/<slug>/...)
 *   ![alt](/images/<slug>/...)
 * 外部 URL (http(s)://) は対象外。
 * @param {string} content
 * @returns {string[]}
 */
function extractImageRefs(content) {
  const refs = [];
  const stripped = stripCode(content);
  const re = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const ref = m[1];
    if (/^https?:\/\//i.test(ref)) continue;
    if (/^data:/i.test(ref)) continue;
    refs.push(ref);
  }
  return refs;
}

/**
 * 画像 path を SOURCE_ROOT からの絶対 path に解決する。
 *   "/images/foo/x.png"          → SOURCE_ROOT/images/foo/x.png
 *   "images/foo/x.png"           → SOURCE_ROOT/images/foo/x.png
 *   "drafts/images/foo/x.png"    → SOURCE_ROOT/drafts/images/foo/x.png
 * @param {string} ref
 * @returns {string}
 */
function resolveImagePath(ref) {
  // strip query / fragment
  const clean = ref.split("#")[0].split("?")[0];
  if (clean.startsWith("/")) {
    return path.join(SOURCE_ROOT, clean.slice(1));
  }
  return path.join(SOURCE_ROOT, clean);
}

/**
 * frontmatter 値の quote を剥がす。
 * @param {string} s
 * @returns {string}
 */
function stripQuotes(s) {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * 1 file を lint する。
 * @param {string} filePath
 * @returns {FileResult}
 */
function lintFile(filePath) {
  const relPath = path
    .relative(SOURCE_ROOT, filePath)
    .split(path.sep)
    .join("/");
  /** @type {Diag[]} */
  const diags = [];

  const raw = fs.readFileSync(filePath, "utf8");
  let parsed;
  try {
    parsed = matter(raw);
  } catch (e) {
    diags.push({
      level: "error",
      msg: `frontmatter parse 失敗: ${e instanceof Error ? e.message : String(e)}`,
    });
    return { relPath, diags };
  }
  const data = parsed.data || {};
  const content = parsed.content || "";

  // 1. title (必須・非空)
  if (typeof data.title !== "string" || data.title.trim() === "") {
    diags.push({
      level: "error",
      msg: `title が無い / 空 (string で 1 文字以上必須)`,
    });
  }

  // 1. topics (必須・array・1〜5 個)
  if (!Array.isArray(data.topics)) {
    diags.push({
      level: "error",
      msg: `topics が無い / array でない (Qiita のタグ制限により 1〜5 個必須)`,
    });
  } else {
    if (data.topics.length === 0) {
      diags.push({
        level: "error",
        msg: `topics が空配列 (1 個以上必須)`,
      });
    } else if (data.topics.length > 5) {
      diags.push({
        level: "error",
        msg: `topics が ${data.topics.length} 個 (Qiita 制限により最大 5 個)`,
      });
    }
    // 9. tag 名検査
    for (const t of data.topics) {
      if (typeof t !== "string" || t === "") {
        diags.push({
          level: "error",
          msg: `topics に空文字 / 非 string が含まれている: ${JSON.stringify(t)}`,
        });
        continue;
      }
      if (!QIITA_TAG_RE.test(t)) {
        diags.push({
          level: "error",
          msg: `tag 名が Qiita ルール違反 (英数字 + - . + # のみ): ${JSON.stringify(t)}`,
        });
      }
    }
  }

  // 2. type の値
  if (data.type !== undefined && data.type !== "tech" && data.type !== "idea") {
    diags.push({
      level: "error",
      msg: `type は "tech" | "idea" のみ: ${JSON.stringify(data.type)}`,
    });
  }

  // 3. publish: bool
  if (data.publish !== undefined && typeof data.publish !== "boolean") {
    diags.push({
      level: "error",
      msg: `publish は bool: ${JSON.stringify(data.publish)}`,
    });
  }

  // 4. publish_at: ISO-8601 + TZ
  // gray-matter は ISO-8601 を Date に自動変換する場合があるため、
  // 元の YAML 文字列を frontmatter ブロックから再抽出して厳密検査する。
  let publishAtDate = null;
  if (data.publish_at !== undefined && data.publish_at !== null) {
    const fmBlock = parsed.matter || "";
    const m = /^[ \t]*publish_at[ \t]*:[ \t]*(.+?)[ \t]*$/m.exec(fmBlock);
    const rawString = m
      ? stripQuotes(m[1])
      : data.publish_at instanceof Date
      ? data.publish_at.toISOString()
      : String(data.publish_at);
    if (!ISO_TZ_RE.test(rawString)) {
      diags.push({
        level: "error",
        msg: `publish_at が ISO-8601 形式ではない: ${JSON.stringify(rawString)}`,
      });
    } else {
      const d = new Date(rawString);
      if (Number.isNaN(d.getTime())) {
        diags.push({
          level: "error",
          msg: `publish_at が日時として parse できない: ${JSON.stringify(rawString)}`,
        });
      } else {
        publishAtDate = d;
      }
    }
  }

  // 5. publish: true なのに publish_at が未来 → 警告
  if (data.publish === true && publishAtDate !== null) {
    const now = new Date();
    if (publishAtDate.getTime() > now.getTime()) {
      diags.push({
        level: "warning",
        msg: `publish: true なのに publish_at が未来 (${publishAtDate.toISOString()}) — どちらかが意図と違う可能性`,
      });
    }
  }

  // 6. delete: true が他フィールドと両立しない場合 → 警告
  if (data.delete === true) {
    if (data.publish === true) {
      diags.push({
        level: "warning",
        msg: `delete: true なのに publish: true (公開しつつ削除はできない、publish: false 推奨)`,
      });
    }
    if (publishAtDate !== null) {
      diags.push({
        level: "warning",
        msg: `delete: true なのに publish_at が指定されている (予約公開 + 削除は矛盾)`,
      });
    }
  }

  // 8. 画像 path 存在
  const refs = extractImageRefs(content);
  for (const ref of refs) {
    const looksLikeLocalImage =
      /^\/?images\//.test(ref) ||
      /^\/?drafts\/images\//.test(ref) ||
      ref.startsWith("./") ||
      ref.startsWith("../") ||
      /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?|#|$)/i.test(ref);
    if (!looksLikeLocalImage) continue;
    const abs = resolveImagePath(ref);
    if (!fs.existsSync(abs)) {
      diags.push({
        level: "error",
        msg: `画像 path 不在: ${ref}`,
      });
    }
  }

  return { relPath, diags };
}

/**
 * 全 draft 横断検査 (slug 衝突)。
 * @param {string[]} files
 * @returns {Map<string, Diag[]>}
 */
function lintCrossFile(files) {
  /** @type {Map<string, Diag[]>} */
  const extra = new Map();
  /** @type {Map<string, string[]>} */
  const slugMap = new Map();
  for (const f of files) {
    const slug = path.basename(f, ".md").toLowerCase();
    if (!slugMap.has(slug)) slugMap.set(slug, []);
    slugMap.get(slug).push(f);
  }
  for (const [slug, group] of slugMap.entries()) {
    if (group.length > 1) {
      const names = group.map((p) => path.basename(p)).join(", ");
      for (const f of group) {
        const list = extra.get(f) || [];
        list.push({
          level: "error",
          msg: `slug 衝突 (case-insensitive): "${slug}" → ${names}`,
        });
        extra.set(f, list);
      }
    }
  }
  return extra;
}

function main() {
  const files = listDrafts();
  if (files.length === 0) {
    console.log("drafts/*.md が見つかりません");
    process.exit(0);
  }

  const crossDiags = lintCrossFile(files);
  /** @type {FileResult[]} */
  const results = [];
  for (const f of files) {
    const r = lintFile(f);
    const extra = crossDiags.get(f);
    if (extra) r.diags.push(...extra);
    results.push(r);
  }

  let okCount = 0;
  let errorCount = 0;
  let warningCount = 0;

  for (const r of results) {
    const errs = r.diags.filter((d) => d.level === "error");
    const warns = r.diags.filter((d) => d.level === "warning");
    if (errs.length === 0 && warns.length === 0) {
      console.log(`OK   ${r.relPath}`);
      okCount++;
      continue;
    }
    if (errs.length > 0) {
      console.log(`FAIL ${r.relPath}`);
      for (const d of errs) console.log(`     error:   ${d.msg}`);
      errorCount++;
    }
    if (warns.length > 0) {
      if (errs.length === 0) console.log(`WARN ${r.relPath}`);
      for (const d of warns) console.log(`     warning: ${d.msg}`);
      if (errs.length === 0) warningCount++;
    }
  }

  const summary =
    `${okCount} files OK / ${errorCount} error${errorCount === 1 ? "" : "s"} ` +
    `/ ${warningCount} warning${warningCount === 1 ? "" : "s"}`;
  console.log("");
  console.log(summary);

  if (errorCount > 0) process.exit(1);
  if (STRICT && warningCount > 0) process.exit(1);
  process.exit(0);
}

main();
