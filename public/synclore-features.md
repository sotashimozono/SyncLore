---
title: 投稿自動化ツール SyncLore の機能紹介
tags:
  - automation
  - CI
  - GitHubActions
  - Qiita
  - Zenn
private: false
updated_at: '2026-08-12T02:52:00+09:00'
id: c46eef16ef8b21e154ad
organization_url_name: null
slide: false
ignorePublish: false
---

[SyncLore](https://github.com/sotashimozono/SyncLore) で実装されている機能のまとめ。各機能の詳細はリポジトリの README + 個別記事を参照。

## 公開

`drafts/<slug>.md` を作成し、フロントマターに `publish: true` を指定して push すると Zenn と Qiita 両方に同時公開される。

```yaml
---
title: "..."
publish: true
---
```

publish が失敗した場合は両プラットフォーム間で公開状態が分裂しない設計 (atomic) になっている。

## 修正

`drafts/<slug>.md` を編集して push するだけ。Qiita 側の記事 id は `public/<slug>.md` に保管されているため、両プラットフォームとも同じ記事として update が適用される。免責事項マーカで囲まれた領域は再変換時に重複しない。

## 取り下げ (unpublish)

`publish: false` に戻して push すると:

- Zenn: `published: false` (draft 扱い、UI から非表示)
- Qiita: `private: true` (限定共有 = 非公開)

再公開は `publish: true` に戻すのみ。記事 id は維持される。

## 予約公開

`publish_at` を ISO-8601 + TZ 付きで指定すると、毎時 cron が時刻到来時に自動公開する。Zenn-CLI / Qiita-CLI どちらも公式には予約公開機能を持たないため、SyncLore レベルで実装されている。

```yaml
---
publish: false
publish_at: "2026-05-01T10:00:00+09:00"
---
```

詳細は [予約投稿の解説記事](https://qiita.com/sotashimozono/items/5d9bfec213ccf30dcd99) を参照。

## 完全削除

`drafts/<slug>.md` のフロントマターに `delete: true` を追加して push すると、Qiita API DELETE + 生成物の cleanup が実行される。

- **Qiita**: API DELETE で完全削除 (**不可逆**)
- **Zenn**: `articles/<slug>.md` を repo から削除 → UI から非表示 (Zenn サーバ側のデータは残る)
- **Repo**: `articles/<slug>.md` / `public/<slug>.md` / `images/<slug>/` を CI が削除

## 記事間リンク (wiki-link)

`drafts/<slug>.md` の本文中で他の記事を参照する際、Obsidian 風の wiki-link が使える。

```markdown
[[synclore-intro]]
```

↓ こう展開される → [記事の投稿を自動化するツール SyncLore](https://qiita.com/sotashimozono/items/578f207e0ffb4eb7ecf5)

プラットフォームごとに正しい URL に変換される (Zenn → `zenn.dev/...`、Qiita → `qiita.com/...`)。`[[slug|表示テキスト]]` で表示テキストも指定可能。コードブロック内は無変換。

archive 配下 (`drafts/archive/<slug>.md`) の記事も link target として有効。`articles/`・`public/` が deploy に残っているため、過去記事への参照は切れない。rename した記事に対しては `aliases` 経由で `[[old-slug]]` も解決される (後述)。

## archive

公開した記事を「もう触らないが Qiita / Zenn では公開状態のまま残しておく」状態にしたい場合は、`drafts/<slug>.md` を `drafts/archive/<slug>.md` に move する。

```bash
git mv drafts/foo.md drafts/archive/foo.md
git push
```

`drafts/archive/` 配下は CI から見えないため、

- 変換されない (`articles/`・`public/` は最後の状態で凍結)
- INDEX.md にも出ない
- 編集しても Qiita / Zenn が誤って update されない

archive から戻すには逆方向に move するだけ。Qiita id は `public/<slug>.md` に保持されているので、戻して push すれば PATCH で update される。

## rename (aliases)

`drafts/foo.md` を `drafts/foo-v2.md` に rename したい場合、Qiita id を引き継がないと **新規投稿として重複** してしまう。これを避けるには、新ファイルのフロントマターで旧 slug を `aliases` に宣言する。

```yaml
---
title: "..."
publish: true
aliases: ["foo"]   # ← 旧 slug
---
```

CI の動作:

- 他記事の `[[foo]]` は新 slug の URL に解決される (alias 逆引き)
- `public/foo.md` の id を `public/foo-v2.md` に migrate
- 旧 `articles/foo.md`・`public/foo.md` は orphan として削除される
- Qiita 側は同じ id が PATCH されるだけで、重複投稿にはならない

注意点:

- Zenn の URL は slug ベースなので、rename すると `https://zenn.dev/.../articles/foo` は 404 になり、`/articles/foo-v2` が新 URL になる。これは Zenn 側の制約で SyncLore では救えない
- `drafts/images/<slug>/` は自動 migrate されない。`git mv` で手動移動が必要

## 画像

`drafts/images/<slug>/figure.png` に画像を置くと、CI が `images/<slug>/` にコピーする。記事内では Zenn 形式で参照する。

```markdown
![説明](/images/my-article/figure1.png)
```

## INDEX.md (執筆履歴)

deploy branch の `INDEX.md` に公開記事一覧が auto-update される。各記事の状態 (LIVE / SCHEDULED / HIDE / DELETED / DRAFT) と Qiita / Zenn のリンクが表でまとまっており、「次に何が公開されるか」「過去に何を公開したか」がリポジトリ上で一覧できる。

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
