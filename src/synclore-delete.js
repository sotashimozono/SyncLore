/**
 * synclore-delete.js
 *
 * drafts/<slug>.md のフロントマターに `delete: true` がある記事を、
 * Qiita API DELETE + リポジトリのクリーンアップで完全削除する。
 *
 * 順序が重要:
 *   この script は qiita publish --all の **前** に走らせる必要がある。
 *   qiita publish --all の冒頭で syncArticlesFromQiita が走り、Qiita 上に
 *   残っている記事を public/<slug>.md として復活させてしまうため、先に
 *   Qiita 側を消しておかないと削除が確定しない。
 *
 * 削除対象:
 *   - articles/<slug>.md (Zenn 公開ファイル)
 *   - public/<slug>.md   (Qiita 公開ファイル)
 *   - images/<slug>/     (Zenn 用画像コピー)
 *   - drafts/<slug>.md は残す (delete:true のまま tombstone)
 *
 * Qiita 側の挙動:
 *   - DELETE /api/v2/items/<id> -> 204 (success) / 404 (already deleted, OK)
 *   - 401 / 403 / 5xx は workflow を失敗させる (atomic)
 *
 * Zenn 側の挙動:
 *   - articles/<slug>.md の repo 削除を webhook が検知 -> Zenn UI から非表示
 *   - Zenn サーバ側のデータは残る (Zenn の仕様)。完全消去したい場合は
 *     Zenn 管理画面で手動削除する。
 */

"use strict";

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

// SOURCE_ROOT: drafts/ がある場所 (main branch の checkout)。
// DEPLOY_ROOT: articles/ public/ images/ がある場所。
//   SYNCLORE_DEPLOY_ROOT 未指定なら SOURCE_ROOT と同じ (ローカル fallback)。
const SOURCE_ROOT = path.resolve(__dirname, "..");
const DEPLOY_ROOT = process.env.SYNCLORE_DEPLOY_ROOT
  ? path.resolve(process.env.SYNCLORE_DEPLOY_ROOT)
  : SOURCE_ROOT;
const DRAFTS_DIR = path.join(SOURCE_ROOT, "drafts");
const ZENN_DIR = path.join(DEPLOY_ROOT, "articles");
const QIITA_DIR = path.join(DEPLOY_ROOT, "public");
const ZENN_IMG_DIR = path.join(DEPLOY_ROOT, "images");

const QIITA_API_ROOT = "https://qiita.com/api/v2/items";

function readQiitaId(qiitaPath) {
  if (!fs.existsSync(qiitaPath)) return null;
  try {
    const fm = matter(fs.readFileSync(qiitaPath, "utf8")).data || {};
    return fm.id || null;
  } catch {
    return null;
  }
}

function rmIfExists(p) {
  if (!fs.existsSync(p)) return false;
  fs.rmSync(p, { recursive: true, force: true });
  return true;
}

async function deleteQiitaItem(id, token) {
  const res = await fetch(`${QIITA_API_ROOT}/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 204) return "deleted";
  if (res.status === 404) return "already_deleted";
  const body = await res.text().catch(() => "");
  throw new Error(`Qiita DELETE ${id} failed: HTTP ${res.status} ${body.slice(0, 200)}`);
}

(async () => {
  if (!fs.existsSync(DRAFTS_DIR)) {
    console.log("No drafts/ directory.");
    return;
  }

  const draftFiles = fs
    .readdirSync(DRAFTS_DIR)
    .filter((f) => path.extname(f) === ".md");

  let deleted = 0;
  let alreadyDeleted = 0;
  const failures = [];

  for (const file of draftFiles) {
    if (file === "template.md") continue;

    const slug = path.basename(file, ".md");
    const draftPath = path.join(DRAFTS_DIR, file);
    const data = matter(fs.readFileSync(draftPath, "utf8")).data || {};

    if (data.delete !== true) continue;

    const zennPath = path.join(ZENN_DIR, file);
    const qiitaPath = path.join(QIITA_DIR, file);
    const imageDir = path.join(ZENN_IMG_DIR, slug);

    const id = readQiitaId(qiitaPath);
    const hasOutputs =
      fs.existsSync(zennPath) ||
      fs.existsSync(qiitaPath) ||
      fs.existsSync(imageDir);

    if (!id && !hasOutputs) {
      console.log(`  [TOMBSTONE] ${file} (already deleted, nothing to do)`);
      alreadyDeleted++;
      continue;
    }

    if (id) {
      const token = process.env.QIITA_TOKEN;
      if (!token) {
        console.error(
          `  [ERROR] ${file} cannot DELETE Qiita item ${id}: QIITA_TOKEN is not set.`,
        );
        failures.push(file);
        continue;
      }
      try {
        const status = await deleteQiitaItem(id, token);
        console.log(`  [DELETE] ${file} qiita_id=${id} -> ${status}`);
      } catch (err) {
        console.error(`  [ERROR] ${file} ${err.message}`);
        failures.push(file);
        continue;
      }
    } else {
      console.log(`  [DELETE] ${file} (no qiita id; repo cleanup only)`);
    }

    const removed = [];
    if (rmIfExists(zennPath)) removed.push(`articles/${file}`);
    if (rmIfExists(qiitaPath)) removed.push(`public/${file}`);
    if (rmIfExists(imageDir)) removed.push(`images/${slug}/`);
    if (removed.length > 0) {
      console.log(`           removed: ${removed.join(", ")}`);
    }

    deleted++;
  }

  if (failures.length > 0) {
    console.error(`\nFailed: ${failures.length} (${failures.join(", ")})`);
    process.exit(1);
  }
  console.log(`\nDone. ${deleted} deleted, ${alreadyDeleted} tombstone(s).`);
})();
