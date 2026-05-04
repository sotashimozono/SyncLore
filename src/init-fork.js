/**
 * init-fork.js
 *
 * fork (or "Use this template") した直後の repo を「My 化」するための one-shot
 * bootstrap スクリプト。下記を全部自動でやる:
 *
 *   A. SyncLore dogfood draft (drafts/synclore-*.md) を
 *      drafts/archive/upstream-synclore/ に退避
 *   B. package.json の name / repository.url / homepage / bugs.url を
 *      新 repo の URL に書き換え
 *   C. README.md を fork 用にスリム化 (上部に upstream 参照ヘッダ追加)、
 *      元 README は docs/UPSTREAM_README.md に保存
 *   D. drafts/ の整理 (template.md は残す、synclore-*.md は A の archive へ、
 *      archive/ の他ファイルはそのまま)
 *
 * 動作モード:
 *   node src/init-fork.js
 *     → dry-run。何が変わるかを表示するだけ。
 *   node src/init-fork.js --apply
 *     → 実際に変更。`--repo owner/name` 省略時は
 *       `gh repo view --json nameWithOwner --jq .nameWithOwner` で
 *       カレント origin から推測。
 *   node src/init-fork.js --apply --repo owner/name
 *     → repo を明示。
 *
 * git commit / push は行わない。ユーザが diff を確認して自分で commit する。
 *
 * Qiita API DELETE は呼ばない: synclore-* の id は元 repo オーナの投稿 id で
 * あり、fork ユーザの token で DELETE しようとすると 403 になる。ローカル
 * 退避のみで十分 (元投稿は元オーナの所有のまま残る)。
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DRAFTS = path.join(ROOT, "drafts");
const ARCHIVE_DIR = path.join(DRAFTS, "archive", "upstream-synclore");
const PKG = path.join(ROOT, "package.json");
const README = path.join(ROOT, "README.md");
const DOCS_DIR = path.join(ROOT, "docs");
const UPSTREAM_README = path.join(DOCS_DIR, "UPSTREAM_README.md");

const UPSTREAM_REPO = "sotashimozono/SyncLore";
const UPSTREAM_URL = `https://github.com/${UPSTREAM_REPO}`;

// ---------------- args ----------------

function parseArgs(argv) {
  const args = { apply: false, repo: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--repo") args.repo = argv[++i];
    else if (a === "-h" || a === "--help") args.help = true;
    else if (a.startsWith("--repo=")) args.repo = a.slice("--repo=".length);
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node src/init-fork.js [--apply] [--repo owner/name]

  (no flags)         dry-run: print what would change
  --apply            actually apply changes
  --repo owner/name  target repo (default: gh repo view of current origin)
`);
}

// ---------------- repo detection ----------------

function detectRepoFromGh() {
  try {
    const out = execSync("gh repo view --json nameWithOwner --jq .nameWithOwner", {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    if (/^[^/]+\/[^/]+$/.test(out)) return out;
  } catch {
    // gh missing / not authenticated / not a repo → fall through
  }
  return null;
}

function detectRepoFromGitRemote() {
  try {
    const out = execSync("git remote get-url origin", {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    // git@github.com:owner/name.git or https://github.com/owner/name(.git)
    const m = out.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
    if (m) return `${m[1]}/${m[2]}`;
  } catch {
    // ignore
  }
  return null;
}

function resolveRepo(explicit) {
  if (explicit) return explicit;
  if (process.env.SYNCLORE_FORK_REPO) return process.env.SYNCLORE_FORK_REPO;
  return detectRepoFromGh() || detectRepoFromGitRemote();
}

// ---------------- planning ----------------

function planArchiveSynclore() {
  if (!fs.existsSync(DRAFTS)) return [];
  return fs
    .readdirSync(DRAFTS)
    .filter((f) => /^synclore-.*\.md$/.test(f))
    .map((f) => ({
      from: path.join(DRAFTS, f),
      to: path.join(ARCHIVE_DIR, f),
    }));
}

function planPackageJson(repo) {
  if (!repo) return null;
  const [, name] = repo.split("/");
  const pkg = JSON.parse(fs.readFileSync(PKG, "utf8"));
  const next = {
    ...pkg,
    name: name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-"),
    repository: {
      ...(pkg.repository || {}),
      type: "git",
      url: `git+https://github.com/${repo}.git`,
    },
    homepage: `https://github.com/${repo}#readme`,
    bugs: {
      ...(pkg.bugs || {}),
      url: `https://github.com/${repo}/issues`,
    },
  };
  return { current: pkg, next };
}

function buildForkReadme(repo) {
  const [, name] = repo.split("/");
  return `# ${name}

> This is a personal fork of [SyncLore](${UPSTREAM_URL}).
> Upstream documentation is preserved in [docs/UPSTREAM_README.md](docs/UPSTREAM_README.md).

Markdown 記事を Zenn と Qiita の両方に同時公開するための個人 repo。
\`drafts/<slug>.md\` を書いて main に push すると、両プラットフォームに反映されます。

## セットアップ済み事項

このリポジトリは SyncLore template から fork 後 \`npm run init:fork -- --apply\` で
My 化済みです。upstream のデモ記事 (synclore-*.md) は
\`drafts/archive/upstream-synclore/\` に退避されています。

## 使い方の概要

1. \`drafts/template.md\` をコピーして新しい slug の draft を作成
2. \`publish: true\` (または \`publish_at: <ISO-8601>\`) を設定して push
3. GitHub Actions の \`sync.yml\` が Zenn / Qiita 両方に同時公開

詳細な仕様 (予約公開・取り下げ・rename・wiki-link など) は
[docs/UPSTREAM_README.md](docs/UPSTREAM_README.md) を参照してください。

## License

| 対象 | ライセンス |
| --- | --- |
| コード・スクリプト | [MIT License](./LICENSE) (upstream SyncLore 由来) |
| 記事本文 | 各記事の著者に帰属 |
`;
}

function planReadme(repo) {
  if (!repo) return null;
  if (!fs.existsSync(README)) return null;
  const current = fs.readFileSync(README, "utf8");
  const next = buildForkReadme(repo);
  // skip if README already starts with the fork header (idempotent)
  const alreadyFork = current.includes("This is a personal fork of [SyncLore]");
  return { current, next, alreadyFork };
}

// ---------------- apply helpers ----------------

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function moveFile(from, to) {
  ensureDir(path.dirname(to));
  fs.renameSync(from, to);
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, "/");
}

// ---------------- main ----------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const repo = resolveRepo(args.repo);
  const mode = args.apply ? "APPLY" : "DRY-RUN";

  console.log(`init-fork: ${mode}`);
  console.log(`  target repo: ${repo || "(unresolved)"}\n`);

  // ----- A + D: archive synclore-*.md -----
  const moves = planArchiveSynclore();
  if (moves.length === 0) {
    console.log("[A] no drafts/synclore-*.md found (already archived?)");
  } else {
    console.log(`[A] archive ${moves.length} dogfood draft(s) to ${rel(ARCHIVE_DIR)}/:`);
    for (const m of moves) {
      console.log(`    ${rel(m.from)}  ->  ${rel(m.to)}`);
    }
  }

  // ----- B: package.json -----
  let pkgPlan = null;
  if (!repo) {
    console.log("\n[B] package.json: SKIP (no repo resolved)");
  } else {
    pkgPlan = planPackageJson(repo);
    const c = pkgPlan.current;
    const n = pkgPlan.next;
    const diffs = [];
    if (c.name !== n.name) diffs.push(`  name: ${c.name}  ->  ${n.name}`);
    if ((c.repository && c.repository.url) !== n.repository.url)
      diffs.push(`  repository.url: ${c.repository && c.repository.url}  ->  ${n.repository.url}`);
    if (c.homepage !== n.homepage)
      diffs.push(`  homepage: ${c.homepage}  ->  ${n.homepage}`);
    if ((c.bugs && c.bugs.url) !== n.bugs.url)
      diffs.push(`  bugs.url: ${c.bugs && c.bugs.url}  ->  ${n.bugs.url}`);
    if (diffs.length === 0) {
      console.log("\n[B] package.json: already up to date");
    } else {
      console.log("\n[B] package.json updates:");
      for (const d of diffs) console.log(d);
    }
  }

  // ----- C: README -----
  let readmePlan = null;
  if (!repo) {
    console.log("\n[C] README: SKIP (no repo resolved)");
  } else {
    readmePlan = planReadme(repo);
    if (!readmePlan) {
      console.log("\n[C] README: missing, skip");
    } else if (readmePlan.alreadyFork) {
      console.log("\n[C] README: already in fork form, skip");
    } else {
      console.log("\n[C] README will be replaced with fork-shaped README");
      console.log(`    original README -> ${rel(UPSTREAM_README)}`);
    }
  }

  if (!args.apply) {
    console.log("\n(dry-run) re-run with --apply to perform changes");
    return;
  }

  // -------- APPLY --------

  // A
  if (moves.length > 0) {
    ensureDir(ARCHIVE_DIR);
    for (const m of moves) {
      moveFile(m.from, m.to);
      console.log(`moved ${rel(m.from)} -> ${rel(m.to)}`);
    }
  }

  // B
  if (pkgPlan) {
    const text = JSON.stringify(pkgPlan.next, null, 2) + "\n";
    fs.writeFileSync(PKG, text);
    console.log(`wrote ${rel(PKG)}`);
  }

  // C
  if (readmePlan && !readmePlan.alreadyFork) {
    ensureDir(DOCS_DIR);
    if (!fs.existsSync(UPSTREAM_README)) {
      fs.writeFileSync(UPSTREAM_README, readmePlan.current);
      console.log(`saved upstream README -> ${rel(UPSTREAM_README)}`);
    } else {
      console.log(`(${rel(UPSTREAM_README)} already exists, leaving as-is)`);
    }
    fs.writeFileSync(README, readmePlan.next);
    console.log(`wrote ${rel(README)}`);
  }

  console.log("\nDone. Review with `git status` / `git diff`, then commit:");
  console.log("  git add -A && git commit -m 'init: my-fy SyncLore fork'");
}

main();
