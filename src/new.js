/**
 * new.js
 *
 * `npm run new -- "<title>"` で `drafts/<slug>.md` を template から
 * 1 コマンドで起こすスキャフォルダ。
 *
 *   $ npm run new -- "BiblioFetch.jl の citation graph"
 *   created drafts/bibliofetch-jl-no-citation-graph.md
 *     title: BiblioFetch.jl の citation graph
 *     slug:  bibliofetch-jl-no-citation-graph
 *
 * - title が必須 (第 1 引数)
 * - slug は title から自動生成 (NFKD 正規化 + 非英数字を - に置換 + 連続
 *   ハイフン圧縮 + 先頭末尾ハイフン除去)
 * - 既存ファイルがあれば exit 1。`--force` で上書き
 * - 雛形は drafts/template.md。frontmatter のうち title を上書きし、
 *   topics は空配列、publish は false に統一。コメント行 (publish_at /
 *   aliases / delete のヘルプ) は雛形通りに残す
 * - 副作用は drafts/<slug>.md への書き込みのみ
 */

"use strict";

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

const ROOT = path.resolve(__dirname, "..");
const DRAFTS_DIR = path.join(ROOT, "drafts");
const TEMPLATE_PATH = path.join(DRAFTS_DIR, "template.md");

function parseArgs(argv) {
  const args = argv.slice(2);
  let force = false;
  const positional = [];
  for (const a of args) {
    if (a === "--force" || a === "-f") {
      force = true;
    } else if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    } else if (a.startsWith("--")) {
      console.error(`error: unknown option: ${a}`);
      process.exit(2);
    } else {
      positional.push(a);
    }
  }
  if (positional.length === 0) {
    printUsage();
    process.exit(2);
  }
  // 引数が複数あれば space 結合 (quote 忘れの救済)
  const title = positional.join(" ").trim();
  if (!title) {
    console.error("error: title must not be empty");
    process.exit(2);
  }
  return { title, force };
}

function printUsage() {
  console.error('usage: npm run new -- "<title>" [--force]');
}

/**
 * title から slug を作る。
 * - NFKD 正規化 (全角英数 → 半角化、合字バラし)
 * - 結合用ダイアクリティカルマーク除去 (U+0300..U+036F)
 * - 小文字化
 * - [a-z0-9] 以外は全部 "-" に置換 (日本語 / スペース / 記号も)
 * - 連続ハイフン圧縮
 * - 先頭末尾ハイフン除去
 *
 * 結果が空文字になった場合 (例: title が日本語のみ) は "untitled" を返す。
 */
function slugify(title) {
  let s = title.normalize("NFKD");
  // U+0300..U+036F: combining diacritical marks
  s = s.replace(/[̀-ͯ]/g, "");
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, "-");
  s = s.replace(/-+/g, "-");
  s = s.replace(/^-+|-+$/g, "");
  return s || "untitled";
}

/**
 * template.md を読み、title だけ差し替えた新規 draft 用テキストを返す。
 * frontmatter のコメント (publish_at / aliases / delete のヘルプ) は
 * 雛形通り保持し、構造を破壊しない。
 *
 * gray-matter でパースして検証だけ行い、本体は line-based に書き換える。
 */
function buildDraftContent(templateText, title) {
  // フォーマット検証 (frontmatter が壊れていれば throw)
  matter(templateText);

  const lines = templateText.split(/\r?\n/);

  let inFm = false;
  let fmStartSeen = false;
  let titleReplaced = false;
  let topicsReplaced = false;
  let publishReplaced = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!fmStartSeen) {
      if (line.trim() === "---") {
        fmStartSeen = true;
        inFm = true;
      }
      continue;
    }
    if (inFm && line.trim() === "---") {
      inFm = false;
      break;
    }
    if (!inFm) continue;

    // YAML key を抽出 (コメント行 "# foo:" は除外)
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:/);
    if (!m) continue;
    const key = m[1];
    if (key === "title" && !titleReplaced) {
      lines[i] = `title: ${yamlQuote(title)}`;
      titleReplaced = true;
    } else if (key === "topics" && !topicsReplaced) {
      lines[i] = "topics: []";
      topicsReplaced = true;
    } else if (key === "publish" && !publishReplaced) {
      // publish: false に固定 (新 draft は下書き状態)
      // インラインコメント "# true で公開..." は雛形通りに残す
      lines[i] = line.replace(
        /^(\s*publish\s*:\s*)(true|false)/,
        "$1false",
      );
      publishReplaced = true;
    }
  }

  if (!titleReplaced) {
    throw new Error(
      "template.md の frontmatter に title フィールドが見つかりません",
    );
  }

  return lines.join("\n");
}

/**
 * YAML スカラとして安全に title を quote する。
 * ダブルクオートで囲み、\\ と " をエスケープする。
 */
function yamlQuote(s) {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function main() {
  const { title, force } = parseArgs(process.argv);

  if (!fs.existsSync(TEMPLATE_PATH)) {
    console.error(`error: template not found: ${rel(TEMPLATE_PATH)}`);
    process.exit(1);
  }

  const slug = slugify(title);
  const outPath = path.join(DRAFTS_DIR, `${slug}.md`);

  if (fs.existsSync(outPath) && !force) {
    console.error(
      `error: ${rel(outPath)} already exists (use --force to overwrite)`,
    );
    process.exit(1);
  }

  const templateText = fs.readFileSync(TEMPLATE_PATH, "utf8");
  const content = buildDraftContent(templateText, title);

  fs.writeFileSync(outPath, content, "utf8");

  console.log(`created ${rel(outPath)}`);
  console.log(`  title: ${title}`);
  console.log(`  slug:  ${slug}`);
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, "/");
}

// テスト容易性のために export しつつ、CLI 起動時のみ main を走らせる
if (require.main === module) {
  main();
}

module.exports = { slugify, buildDraftContent };
