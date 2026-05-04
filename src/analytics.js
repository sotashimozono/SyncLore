#!/usr/bin/env node
/**
 * src/analytics.js
 *
 * `npm run analytics`
 *
 * QIITA_TOKEN env var (read_qiita scope) を使って、自分の Qiita 全公開記事の
 *   - page_views_count
 *   - likes_count
 *   - stocks_count
 *   - comments_count
 * を Qiita API から pull し、`log/analytics-YYYY-MM-DD.json` に snapshot を保存する。
 *
 * 直前 snapshot (log/analytics-*.json のうち今日より前で最新のもの) からの差分を
 * stdout に表示する。
 *
 * 想定運用:
 *   GitHub Actions cron (毎日 1 回) で走らせて、log/ に時系列 snapshot を蓄積。
 *   後段のダッシュボード生成 (markdown summary) や Slack 通知は別 PR で対応。
 *
 * Out of scope:
 *   - Zenn analytics は Zenn API が CLI 経由 / 非公開のため別 PR
 *   - markdown ダッシュボード化は別 PR
 *   - Slack 通知も別 PR
 */

"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

const { readLedger } = require("./lib/ledger");

const SOURCE_ROOT = path.resolve(__dirname, "..");
const LOG_DIR = path.join(SOURCE_ROOT, "log");

const QIITA_API_HOST = "qiita.com";
const QIITA_API_BASE = "/api/v2";
const PAGE_SIZE = 100; // Qiita API の最大値

function main() {
  const token = process.env.QIITA_TOKEN;
  if (!token) {
    console.error("QIITA_TOKEN environment variable required");
    console.error(
      "  Get a token from https://qiita.com/settings/applications (read_qiita scope)",
    );
    process.exit(1);
  }

  fetchAllAuthenticatedItems(token)
    .then((items) => {
      console.log(`fetched ${items.length} articles from Qiita`);

      const snapshot = {
        ts: nowIsoJst(),
        items: items.map((it) => ({
          qiita_id: it.id,
          title: it.title,
          url: it.url,
          page_views_count: it.page_views_count ?? null,
          likes_count: it.likes_count ?? 0,
          stocks_count: it.stocks_count ?? 0,
          comments_count: it.comments_count ?? 0,
        })),
      };

      const prev = loadPreviousSnapshot();
      printDiff(snapshot, prev);

      const outPath = writeSnapshot(snapshot);
      console.log(
        `written: ${path
          .relative(SOURCE_ROOT, outPath)
          .replace(/\\/g, "/")}`,
      );
    })
    .catch((err) => {
      console.error(`error: ${err.message}`);
      process.exit(1);
    });
}

/**
 * GET /api/v2/authenticated_user/items を pagination 付きで全件取得。
 *
 * Qiita の pagination は Link ヘッダにも出るが、page を回しつつ取得件数が
 * PAGE_SIZE 未満になった時点で打ち切る素朴な方式で十分。個人の記事数が
 * 1 万を超えるケースは現実的に想定しない (安全弁として 100 page で abort)。
 */
async function fetchAllAuthenticatedItems(token) {
  const out = [];
  let page = 1;
  while (true) {
    const items = await qiitaGet(
      token,
      `/authenticated_user/items?page=${page}&per_page=${PAGE_SIZE}`,
    );
    if (!Array.isArray(items)) {
      throw new Error(`unexpected response shape on page ${page}`);
    }
    out.push(...items);
    if (items.length < PAGE_SIZE) break;
    page += 1;
    if (page > 100) {
      throw new Error("pagination exceeded 100 pages, aborting");
    }
  }
  return out;
}

function qiitaGet(token, pathSuffix) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: QIITA_API_HOST,
        path: QIITA_API_BASE + pathSuffix,
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "SyncLore-analytics/1.0",
          Accept: "application/json",
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(
              new Error(
                `Qiita API ${res.statusCode}: ${body.slice(0, 200)}`,
              ),
            );
          }
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(
              new Error(`failed to parse Qiita response: ${err.message}`),
            );
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * 直前 snapshot を返す (log/analytics-YYYY-MM-DD.json のうち今日より前で最新)。
 * 無ければ null。
 */
function loadPreviousSnapshot() {
  if (!fs.existsSync(LOG_DIR)) return null;
  const today = todayStamp();
  const candidates = fs
    .readdirSync(LOG_DIR)
    .filter((f) => /^analytics-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .filter((f) => extractStamp(f) < today)
    .sort();
  if (candidates.length === 0) return null;
  const latest = candidates[candidates.length - 1];
  try {
    return JSON.parse(fs.readFileSync(path.join(LOG_DIR, latest), "utf8"));
  } catch (err) {
    console.warn(
      `  [WARN] could not read previous snapshot ${latest}: ${err.message}`,
    );
    return null;
  }
}

function extractStamp(filename) {
  const m = filename.match(/^analytics-(\d{4}-\d{2}-\d{2})\.json$/);
  return m ? m[1] : "";
}

function printDiff(snapshot, prev) {
  const prevById = new Map();
  if (prev && Array.isArray(prev.items)) {
    for (const it of prev.items) {
      if (it.qiita_id) prevById.set(it.qiita_id, it);
    }
  }
  for (const cur of snapshot.items) {
    const before = prevById.get(cur.qiita_id);
    const dPv = diffNum(before?.page_views_count, cur.page_views_count);
    const dLg = diffNum(before?.likes_count, cur.likes_count);
    const dSt = diffNum(before?.stocks_count, cur.stocks_count);
    const idShort = cur.qiita_id ? cur.qiita_id.slice(0, 6) : "------";
    console.log(
      `  ${idShort}  ${fmtSigned(dPv).padEnd(5)} PV  ${fmtSigned(dLg).padEnd(4)} LGTM  ${fmtSigned(dSt).padEnd(4)} stocks   "${cur.title}"`,
    );
  }
}

function diffNum(before, after) {
  if (after == null) return null;
  if (before == null) return after; // 新規 (= 全部 +N)
  return after - before;
}

function fmtSigned(n) {
  if (n == null) return "?";
  if (n > 0) return `+${n}`;
  if (n < 0) return String(n);
  return "+0";
}

function writeSnapshot(snapshot) {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const outPath = path.join(LOG_DIR, `analytics-${todayStamp()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  return outPath;
}

function todayStamp(now = new Date()) {
  // JST 基準の YYYY-MM-DD (cron が UTC で走っても日本時間でファイル名が決まるよう固定 offset)
  const tzOffsetMin = 9 * 60;
  const local = new Date(now.getTime() + tzOffsetMin * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

function nowIsoJst(now = new Date()) {
  const tzOffsetMin = 9 * 60;
  const local = new Date(now.getTime() + tzOffsetMin * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const y = local.getUTCFullYear();
  const mo = pad(local.getUTCMonth() + 1);
  const d = pad(local.getUTCDate());
  const h = pad(local.getUTCHours());
  const mi = pad(local.getUTCMinutes());
  const s = pad(local.getUTCSeconds());
  return `${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`;
}

// readLedger() は将来 (PR 後段) で「ledger に PV を併合する」拡張のために import 済み。
// 現バージョンでは差分表示は前回 snapshot との比較で十分なので未使用。
// linter 警告抑止のため明示的に no-op で touch しておく。
void readLedger;

if (require.main === module) {
  main();
}

module.exports = {
  fetchAllAuthenticatedItems,
  loadPreviousSnapshot,
  todayStamp,
  nowIsoJst,
};
