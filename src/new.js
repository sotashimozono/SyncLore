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
const { loadConfig } = require("./lib/config");

const ROOT = path.resolve(__dirname, "..");
const DRAFTS_DIR = path.join(ROOT, "drafts");
const TEMPLATE_PATH = path.join(DRAFTS_DIR, "template.md");

// synclore.config.toml が無いとき / セクションが無いときの fallback。
// template.md の hardcoded 既定値と整合させる。
const FALLBACK_DEFAULTS = {
  emoji: "📝",
  type: "tech",
  topics: [],
};
const FALLBACK_NEW = {
  slug_separator: "-",
  slug_max_length: 60,
};

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
 * - [a-z0-9] 以外は全部 separator に置換 (日本語 / スペース / 記号も)
 * - 連続 separator 圧縮
 * - 先頭末尾 separator 除去
 * - max_length に切り詰め (語境界の separator で末尾を再 trim)
 *
 * 結果が空文字になった場合 (例: title が日本語のみ) は "untitled" を返す。
 *
 * @param {string} title
 * @param {object} [opts]
 * @param {string} [opts.separator="-"]  - 区切り文字 (1 文字想定)
 * @param {number} [opts.maxLength=60]   - 最大長 (バイトでなく文字数)
 */
function slugify(title, opts = {}) {
  const sep = opts.separator || "-";
  const maxLen = opts.maxLength || 60;

  // separator を正規表現中で安全に使うためにエスケープ
  const sepEsc = sep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  let s = title.normalize("NFKD");
  // U+0300..U+036F: combining diacritical marks
  s = s.replace(/[̀-ͯ]/g, "");
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, sep);
  s = s.replace(new RegExp(`${sepEsc}+`, "g"), sep);
  s = s.replace(new RegExp(`^${sepEsc}+|${sepEsc}+$`, "g"), "");

  if (s.length > maxLen) {
    s = s.slice(0, maxLen);
    // 末尾が separator で終わっていたら剥がす (中途半端な区切り回避)
    s = s.replace(new RegExp(`${sepEsc}+$`), "");
  }

  return s || "untitled";
}

/**
 * template.md を読み、title と config 由来の default を差し替えた新規 draft 用
 * テキストを返す。frontmatter のコメント (publish_at / aliases / delete のヘル
 * プ) は雛形通り保持し、構造を破壊しない。
 *
 * gray-matter でパースして検証だけ行い、本体は line-based に書き換える。
 *
 * @param {string} templateText - drafts/template.md の中身
 * @param {string} title - 新 draft の title
 * @param {object} [opts] - 上書きする frontmatter 値 (synclore.config.toml 由来)
 * @param {string} [opts.emoji] - Zenn 用 emoji。未指定なら template の値を維持
 * @param {string} [opts.type] - "tech" | "idea"。未指定なら template の値を維持
 * @param {string[]} [opts.topics] - タグ配列。未指定なら [] (現行挙動)
 */
function buildDraftContent(templateText, title, opts = {}) {
  // フォーマット検証 (frontmatter が壊れていれば throw)
  matter(templateText);

  const { emoji, type, topics } = opts;

  const lines = templateText.split(/\r?\n/);

  let inFm = false;
  let fmStartSeen = false;
  let titleReplaced = false;
  let emojiReplaced = false;
  let typeReplaced = false;
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
    } else if (key === "emoji" && !emojiReplaced && emoji !== undefined) {
      // emoji の値部分のみ置換 (インラインコメント "# Zenn 専用..." は維持)
      lines[i] = line.replace(
        /^(\s*emoji\s*:\s*)("(?:\\.|[^"\\])*"|'[^']*'|\S+)/,
        `$1${yamlQuote(emoji)}`,
      );
      emojiReplaced = true;
    } else if (key === "type" && !typeReplaced && type !== undefined) {
      lines[i] = line.replace(
        /^(\s*type\s*:\s*)("(?:\\.|[^"\\])*"|'[^']*'|\S+)/,
        `$1${yamlQuote(type)}`,
      );
      typeReplaced = true;
    } else if (key === "topics" && !topicsReplaced) {
      // topics は config 指定があれば config 配列、無ければ [] (現行挙動)
      lines[i] = `topics: ${yamlInlineArray(topics || [])}`;
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
  return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * 文字列配列を YAML inline array (flow style) として 1 行で書き出す。
 *   yamlInlineArray(["a", "b"]) === '["a", "b"]'
 *   yamlInlineArray([])         === '[]'
 */
function yamlInlineArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return "[]";
  return `[${arr.map((v) => yamlQuote(v)).join(", ")}]`;
}

function main() {
  const { title, force } = parseArgs(process.argv);

  if (!fs.existsSync(TEMPLATE_PATH)) {
    console.error(`error: template not found: ${rel(TEMPLATE_PATH)}`);
    process.exit(1);
  }

  // synclore.config.toml から個人設定を読む。無ければ全 section が空 dict。
  const cfg = loadConfig(ROOT);
  const newOpts = { ...FALLBACK_NEW, ...cfg.new };
  const draftOpts = {
    emoji: cfg.defaults.emoji,
    type: cfg.defaults.type,
    topics: cfg.defaults.topics,
  };

  const slug = slugify(title, {
    separator: newOpts.slug_separator,
    maxLength: newOpts.slug_max_length,
  });
  const outPath = path.join(DRAFTS_DIR, `${slug}.md`);

  if (fs.existsSync(outPath) && !force) {
    console.error(
      `error: ${rel(outPath)} already exists (use --force to overwrite)`,
    );
    process.exit(1);
  }

  const templateText = fs.readFileSync(TEMPLATE_PATH, "utf8");
  const content = buildDraftContent(templateText, title, draftOpts);

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

module.exports = {
  slugify,
  buildDraftContent,
  yamlInlineArray,
  FALLBACK_DEFAULTS,
  FALLBACK_NEW,
};
