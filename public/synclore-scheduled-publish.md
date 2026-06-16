---
title: 投稿自動化ツール SyncLore を使った記事の予約投稿
tags:
  - Qiita
  - automation
  - CI
  - GitHubActions
  - Zenn
private: false
updated_at: '2026-06-17T03:01:34+09:00'
id: 5d9bfec213ccf30dcd99
organization_url_name: null
slide: false
ignorePublish: false
---

[SyncLore](https://github.com/sotashimozono/SyncLore) は `drafts/` 配下の Markdown file を Zenn と Qiita に同時公開するためのツール。**予約投稿** の機能も組み込まれており、この記事自体も予約公開で出ている。

簡単な紹介として [記事の投稿を自動化するツール SyncLore](https://qiita.com/sotashimozono/items/578f207e0ffb4eb7ecf5) もご覧ください。

`drafts/<slug>.md` のフロントマターに `publish_at` を足す。

```yaml
---
title: "未来の記事"
publish: false
publish_at: "2026-05-01T10:00:00+09:00"
---
```

`publish: false` のまま push して放置すれば良い。`publish_at` は ISO-8601 + TZ 必須で、TZ を省略すると UTC 解釈になる点に注意。

## Background: zenn-cli / qiita-cli は予約投稿非対応

両ツールとも公式の予約機能を持たない。

| ツール | フロントマター | コマンド | Web UI |
|---|---|---|---|
| zenn-cli | ❌ | ❌ | ❌ Zenn 自体に予約なし |
| qiita-cli | ❌ | ❌ (publish は即時のみ) | ❌ 個人垢には予約なし |

「来週の朝 8 時に出す」は公式機能では実現できない領域なので、SyncLore でこのギャップを補っている。

## 仕組み

`.github/workflows/sync.yml` には push trigger に加えて cron が設定されており、毎時 00 分に起動する。`convert.js` の判定ロジックはシンプル。

```js
const isPublic = data.publish === true
  || (publish_at !== null && publish_at <= now);
```

`publish_at` が未来なら `SCHEDULED` で停止して articles/ public/ を出力しない。過去に達した時点で effective LIVE として扱われ、articles/ public/ が生成され Zenn と Qiita に流れる。

## drafts/ を書き換えない設計

cron が `drafts/<slug>.md` の `publish: false` を `publish: true` に書き換える方式も検討したが、main が branch protection で守られている前提だと bot push が拒否されるため PR + auto-merge が必要になる。これでは毎時 PR 通知が飛んで運用が煩雑。

そこで「drafts/ は不変」「`convert.js` が時刻ベースで毎回 effective publish を計算」の設計が採用されている。drafts/ は SSoT のまま固定、main も触らない、PR ノイズも発生しない。

| 方式 | drafts 改変 | branch protection | PR ノイズ |
|---|---|---|---|
| cron が drafts を書き換え | あり | NG (要 PR + merge) | 毎時 |
| convert.js が時刻判定 (採用) | なし | 関係なし | なし |

## 使用上の注意

- TZ なしの `publish_at: "2026-05-01T10:00:00"` は UTC 解釈になる。`+09:00` を必ず付けること
- 粒度は 1 時間。GitHub Actions 自体の遅延 (~15 分) も乗るため、10:00 指定でも 10:15〜11:15 あたりに公開される可能性がある
- 過去日時を書くと即時公開される。タイポに注意

## INDEX.md で予約一覧

deploy branch の `INDEX.md` には予約状態の記事も並ぶ。

| Slug | Title | Status | Last update |
|---|---|---|---|
| `scheduled-example` | 未来の記事 | SCHEDULED | → 2026-05-01 10:00 |

「次に何が公開されるか」がリポジトリ上で一覧できる。

---

リポジトリ: [sotashimozono/SyncLore](https://github.com/sotashimozono/SyncLore)
Template Repository に設定されているため、"Use this template" から自分用にも複製できる。

---

<!-- SYNCLORE_DISCLAIMER_START -->
> **免責事項**
> この記事のコードは [MIT License](https://github.com/sotashimozono/SyncLore/blob/main/LICENSE) に基づき自由に利用できます。
> ただし記事本文の著作権はすべて筆者に帰属し、無断転載・再利用を禁じます。
> 記事の内容は執筆時点のものであり、正確性・完全性を保証しません。
> 本記事の利用によって生じたいかなる損害についても筆者は責任を負いません。
<!-- SYNCLORE_DISCLAIMER_END -->
