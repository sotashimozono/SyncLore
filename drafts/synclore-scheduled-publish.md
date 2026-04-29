---
title: "投稿自動化ツール SyncLore を使った記事の予約投稿"
emoji: "🔮"
type: "tech"
topics: ["githubactions", "automation", "qiita", "zenn", "ci"]
publish: false
publish_at: "2026-04-30T08:30:00+09:00"
---

[SyncLore](https://github.com/sotashimozono/SyncLore) は `drafts/` に書いた Markdown を Zenn と Qiita に同時公開するためのツールで、ついでに **予約投稿** も持たせている。この記事自体も予約で出ているはず。

## zenn-cli / qiita-cli は予約に対応していない

両方とも公式の予約機能はない。

| ツール | フロントマター | コマンド | Web UI |
|---|---|---|---|
| zenn-cli | ❌ | ❌ | ❌ Zenn 自体に予約なし |
| qiita-cli | ❌ | ❌ (publish は即時のみ) | ❌ 個人垢には予約なし |

「来週の朝 8 時に出す」が公式機能では出来ないので、SyncLore 側で仕組みを足している。

## 書き方

`drafts/<slug>.md` のフロントマターに `publish_at` を足すだけ。

```yaml
---
title: "未来の記事"
publish: false
publish_at: "2026-05-01T10:00:00+09:00"
---
```

`publish: false` のまま push して放置。ISO-8601 + TZ で書くのが必須で、TZ なしだと UTC 扱いになる。

## 仕組み

`.github/workflows/sync.yml` に push trigger とは別で cron が刺さっていて、毎時 00 分に起動する。`convert.js` の判定はシンプル

```js
const isPublic = data.publish === true
  || (publish_at !== null && publish_at <= now);
```

これだけ。`publish_at` が未来なら何もしない (SCHEDULED で停止)、過去なら effective LIVE 扱いで articles/ public/ を生成 → Zenn と Qiita に流れる。

## drafts/ を書き換えない設計

最初は cron で `drafts/<slug>.md` の `publish: false` を `publish: true` に書き換える設計を考えていた。けど main が branch protection で守られていると bot push が拒否される。PR + auto-merge にするしかなく、毎時 PR 通知が飛んでくるのは嫌だった。

代わりに「drafts/ は不変」「`convert.js` が時刻ベースで毎回判定」にした。drafts/ は SSoT で動かない、main も触らない、PR ノイズもない。

| 方式 | drafts 改変 | branch protection | PR ノイズ |
|---|---|---|---|
| cron が drafts を書き換え | あり | NG (要 PR + merge) | 毎時 |
| convert.js が時刻判定 (採用) | なし | 関係なし | なし |

## ハマりどころ

- TZ なしの `publish_at: "2026-05-01T10:00:00"` は UTC 解釈になる。`+09:00` を必ず付ける
- 粒度は 1 時間。GitHub Actions 自体の遅延 (~15 分) もあるので、10:00 指定でも 10:15 〜 11:15 あたりに公開される可能性
- 過去日時を書くと即時公開。タイポで即出るので注意

## INDEX.md で予約一覧

deploy branch の `INDEX.md` には予約状態の記事も並ぶ。

| Slug | Title | Status | Last update |
|---|---|---|---|
| `scheduled-example` | 未来の記事 | SCHEDULED | → 2026-05-01 10:00 |

「次に何が出るか」が一目で見える。

---

[sotashimozono/SyncLore](https://github.com/sotashimozono/SyncLore) (Template Repository なので "Use this template" で自分用にも使える)
