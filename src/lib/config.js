/**
 * config.js
 *
 * synclore.config.toml を 1 ファイルに集約された個人設定として読む。
 *
 *   const { loadConfig } = require("./lib/config");
 *   const cfg = loadConfig();
 *   cfg.author.name      // "sota shimozono"
 *   cfg.defaults.emoji   // "📝"
 *   cfg.new.slug_max_length
 *
 * 仕様:
 * - rootDir に synclore.config.toml が無ければ全 section が空 dict を返す
 *   (上位の呼び出し側で fallback する)
 * - TOML パースエラーは throw (config 壊れの可視化)
 * - 全 section / 全 key は optional。書かれていなければ undefined
 *
 * 想定 schema (synclore.config.toml.example も参照):
 *   [author]    name, email
 *   [zenn]      username
 *   [qiita]     username, api_key_env
 *   [defaults]  emoji, type, topics
 *   [new]       slug_separator, slug_max_length
 */

"use strict";

const fs = require("fs");
const path = require("path");
const TOML = require("@iarna/toml");

const CONFIG_FILE = "synclore.config.toml";

/**
 * synclore.config.toml を読む。
 *
 * @param {string} rootDir - repo root を指すディレクトリ。default は cwd
 * @returns {{
 *   author: object,
 *   zenn: object,
 *   qiita: object,
 *   defaults: object,
 *   new: object,
 * }}
 *   ファイルが無い、もしくは section が無い場合は空 object を返す。
 */
function loadConfig(rootDir = ".") {
  const cfgPath = path.join(rootDir, CONFIG_FILE);
  let parsed = {};
  if (fs.existsSync(cfgPath)) {
    const text = fs.readFileSync(cfgPath, "utf8");
    try {
      parsed = TOML.parse(text);
    } catch (e) {
      throw new Error(`failed to parse ${CONFIG_FILE}: ${e.message}`);
    }
  }

  return {
    author: parsed.author || {},
    zenn: parsed.zenn || {},
    qiita: parsed.qiita || {},
    defaults: parsed.defaults || {},
    new: parsed.new || {},
  };
}

module.exports = { loadConfig, CONFIG_FILE };
