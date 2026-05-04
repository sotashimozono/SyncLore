/**
 * src/lib/ledger.js
 *
 * log/publish-history.jsonl に 1 行 1 record の JSON Lines で公開ログを蓄積する。
 *
 * 用途:
 *   - 何月何日に何が公開 / 更新 / 削除されたかの履歴を残す
 *   - 後から振り返って SNS シェア用の URL を即取得する
 *   - connect 記事の選定材料にする
 *
 * record 形式 (1 行 = 1 entry):
 *   {
 *     "ts":         "2026-05-04T20:30:00+09:00",   // この append が起きた時刻 (ISO-8601 + JST 固定 offset)
 *     "slug":       "synclore-intro",
 *     "action":     "publish" | "update" | "tombstone" | "hide",
 *     "title":      "...",
 *     "platform":   ["zenn", "qiita"],              // この時点で出力されたプラットフォーム
 *     "qiita_id":   "abc123def" | null,
 *     "qiita_url":  "https://qiita.com/<user>/items/<id>" | null,
 *     "zenn_url":   "https://zenn.dev/<user>/articles/<slug>" | null,
 *     "publish_at": "2026-05-04T20:00:00+09:00" | null
 *   }
 *
 * idempotent:
 *   convert.js が同じ slug を再処理しても、状態が変わっていなければ append しない。
 *   判定は呼び出し側 (convert.js) で lastEntryFor() と isSameState() を使って行う。
 *   本モジュールは「append する / しない」の意思決定を持たず、primitives
 *   (append / read / lookup / 比較) のみを提供する。
 *
 * append が頻繁に起こるため JSON Array ではなく JSON Lines を採用 (whole-file
 * rewrite を避けるため)。
 */

"use strict";

const fs = require("fs");
const path = require("path");

const SOURCE_ROOT = path.resolve(__dirname, "..", "..");
const LOG_DIR = path.join(SOURCE_ROOT, "log");
const LEDGER_PATH = path.join(LOG_DIR, "publish-history.jsonl");

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Append one entry to log/publish-history.jsonl.
 * `entry.ts` を省略すれば現在時刻 (JST ISO-8601) で自動補完。
 */
function appendLedger(entry) {
  if (!entry || typeof entry !== "object") {
    throw new TypeError("appendLedger: entry must be an object");
  }
  if (!entry.slug || !entry.action) {
    throw new TypeError("appendLedger: entry.slug and entry.action are required");
  }
  ensureLogDir();
  // ts, slug, action を先頭に並べた key 順で出す (人間の grep / less を読みやすく)
  const ts = entry.ts || nowIsoJst();
  const ordered = {
    ts,
    slug: entry.slug,
    action: entry.action,
    ...Object.fromEntries(
      Object.entries(entry).filter(
        ([k]) => k !== "ts" && k !== "slug" && k !== "action",
      ),
    ),
  };
  fs.appendFileSync(LEDGER_PATH, JSON.stringify(ordered) + "\n", "utf8");
}

/**
 * Read all entries (oldest first). 不正な行は warn してスキップ。
 */
function readLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  const raw = fs.readFileSync(LEDGER_PATH, "utf8");
  const out = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch (err) {
      console.warn(
        `  [WARN] ledger: skipping malformed line ${i + 1} (${err.message})`,
      );
    }
  }
  return out;
}

/**
 * Most recent entry for a slug, or null if never recorded.
 */
function lastEntryFor(slug) {
  const all = readLedger();
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].slug === slug) return all[i];
  }
  return null;
}

/**
 * 直前の record と「同じ状態か」を判定。idempotent 制御に使う。
 * `ts` は append のたびに変わるので比較対象から外す。
 * action は publish / update を "live" として canonicalize し、
 *   - 初回 publish の後、毎回 update で append され続けるのを防ぐ
 *   - tombstone / hide からの復帰は publish として記録される (action 別なので変化扱い)
 * title / platform / qiita_id / qiita_url / zenn_url / publish_at が
 * 全部一致していれば「変化なし」とみなす。
 */
function isSameState(prev, next) {
  if (!prev) return false;
  if (canonicalAction(prev.action) !== canonicalAction(next.action)) return false;
  const keys = ["title", "qiita_id", "qiita_url", "zenn_url", "publish_at"];
  for (const k of keys) {
    if (norm(prev[k]) !== norm(next[k])) return false;
  }
  const a = Array.isArray(prev.platform) ? [...prev.platform].sort() : [];
  const b = Array.isArray(next.platform) ? [...next.platform].sort() : [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function canonicalAction(action) {
  if (action === "publish" || action === "update") return "live";
  return action || null;
}

function norm(v) {
  if (v === undefined || v === null) return null;
  return v;
}

// JST (+09:00) ISO-8601 文字列。CI も local も同じ表記になるよう固定 offset で出す。
function nowIsoJst(now = new Date()) {
  const tzOffsetMin = 9 * 60;
  const local = new Date(now.getTime() + tzOffsetMin * 60 * 1000);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const y = local.getUTCFullYear();
  const mo = pad(local.getUTCMonth() + 1);
  const d = pad(local.getUTCDate());
  const h = pad(local.getUTCHours());
  const mi = pad(local.getUTCMinutes());
  const s = pad(local.getUTCSeconds());
  return `${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`;
}

module.exports = {
  appendLedger,
  readLedger,
  lastEntryFor,
  isSameState,
  LEDGER_PATH,
};
