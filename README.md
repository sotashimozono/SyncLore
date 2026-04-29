# SyncLore

GitHub を Single Source of Truth として、`drafts/` に書いた Markdown を
**Zenn・Qiita の両方に自動公開**する一元管理リポジトリ。

`drafts/<slug>.md` の `publish: true` で `main` に push するだけで反映。
`publish: false` に戻して push すれば両方とも非公開状態に書き戻されます。

---

## ディレクトリ構成

```
SyncLore/
├── drafts/                ← ★ 原稿を書く場所 (SSoT、人間が編集)
│   ├── template.md
│   ├── my-article.md
│   └── images/
│       └── my-article/    ← 記事ごとの画像
│           └── figure1.png
├── articles/              ← 生成物 (Zenn-CLI 規約)
│   └── my-article.md
├── public/                ← 生成物 (Qiita-CLI 規約・Qiita id を保管)
│   └── my-article.md
├── images/                ← 生成物 (Zenn が参照する画像コピー)
│   └── my-article/
│       └── figure1.png
└── src/
    └── convert.js         ← drafts/ → articles/, public/, images/ を冪等変換
```

> `articles/`・`public/`・`images/` は CI が自動生成するので **手で編集しない**。
> Qiita の記事 id は `public/<slug>.md` の `id` フィールドに保管され、qiita-cli が
> 公開時に自動で書き戻します。

---

## How to Use

### 1. 新しい記事を書く

`drafts/template.md` をコピーしてスラグ名を決めます。

```
drafts/my-new-article.md
```

フロントマター:

```yaml
---
title: "記事タイトル"
emoji: "✨"              # Zenn 専用 (省略時は 📝)
type: "tech"             # tech | idea (Zenn 専用)
topics: ["julia", "oss"] # タグ。Zenn は最大 5 個
publish: false           # 下書き中は false
---
```

### 2. 公開する

`publish: true` に変更して `main` ブランチへ push。

```
git add drafts/my-new-article.md
git commit -m "Add: my-new-article"
git push
```

GitHub Actions (`sync.yml`) が以下を **1 本の workflow で atomic に** 実行します:

| ステップ      | 内容                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------- |
| convert       | `drafts/*.md` を `articles/`・`public/`・`images/` に冪等再生成                                     |
| qiita publish | `npx qiita publish --all` で Qiita 投稿 / 更新 (新規時は `public/<slug>.md` に id を書き戻し)        |
| commit & push | `articles/`・`public/`・`images/` の変更を main に push                                              |
| Zenn          | GitHub 連携 webhook が main の commit を検知して反映                                                |

Qiita publish が失敗したときは commit 自体が走らないため、Zenn 側だけ進む / Qiita id がズレるといった半端な状態になりません。失敗時は workflow を re-run。

### 3. 非公開に戻す (unpublish)

`publish: false` に戻して push すると:

- `articles/<slug>.md` → `published: false` (Zenn 側で draft 扱い)
- `public/<slug>.md` → `private: true` (Qiita 側で限定共有 = 非公開)

`drafts/<slug>.md` は削除されません。再公開したい場合は `publish: true` に戻すだけ。

### 4. 記事を修正する

`drafts/<slug>.md` を編集して push するだけ。`articles/`・`public/` は毎回再生成されるので、Qiita の id は維持されたまま本文だけ更新されます。免責事項は HTML コメントマーカで囲まれているため、再生成しても重複しません。

### 5. 完全に削除する (delete)

`drafts/<slug>.md` のフロントマターに `delete: true` を追加して push:

```yaml
---
title: "..."
publish: false
delete: true   # ★ 不可逆: Qiita 側は API DELETE
---
```

- **Qiita**: API DELETE で投稿そのものを完全削除
- **Zenn**: `articles/<slug>.md` を repo から削除 → Zenn UI から非表示。ただし Zenn サーバ側のデータは残るため、完全消去したい場合は Zenn 管理画面でも削除してください
- **Repo**: `articles/<slug>.md`・`public/<slug>.md`・`images/<slug>/` を CI が削除
- `drafts/<slug>.md` は **tombstone として残ります** (`delete: true` のまま)。再公開はできない (Qiita 側が消えているので新規投稿になる) ので、完全に履歴から消したい時は手で `git rm drafts/<slug>.md` してください。

⚠️ Qiita API DELETE は不可逆です。誤って `delete: true` を書かないよう注意。

### 6. 画像を使う

画像は `drafts/images/<slug>/` に置きます。

```
drafts/images/my-new-article/figure1.png
```

CI が `images/<slug>/` にコピーします。記事内では Zenn 形式で参照:

```markdown
![説明](/images/my-new-article/figure1.png)
```

### 7. ローカルプレビュー

```bash
npm install
npm run convert         # drafts/ → articles/, public/ を手動変換
npm run preview:zenn    # Zenn のプレビューサーバー
```

---

## 初期セットアップ (初回のみ)

1. **依存パッケージをインストール**
   ```bash
   npm install
   ```

2. **GitHub Secrets に `QIITA_TOKEN` を登録**
   Settings → Secrets and variables → Actions → New repository secret

3. **Zenn と GitHub リポジトリを連携**
   [Zenn のデプロイ設定](https://zenn.dev/dashboard/deploys) でこのリポジトリを連携

4. **リポジトリを Public に設定** (GitHub Actions 無料枠のため)

---

## License & Disclaimer

| 対象 | ライセンス |
|------|-----------|
| リポジトリ内のコード・スクリプト | [MIT License](./LICENSE) |
| 記事本文 (執筆物) | All Rights Reserved — 無断転載・再利用を禁じます |

> **免責事項**
> 記事の内容は執筆時点のものであり、正確性・完全性を保証しません。
> 本リポジトリの利用によって生じたいかなる損害についても筆者は責任を負いません。
