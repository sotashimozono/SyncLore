# SyncLore

GitHub を Single Source of Truth として、`drafts/` に書いた Markdown 記事を  
**Zenn・Qiita の両方へ自動デプロイ**する一元管理リポジトリ。

`published: true` にして `main` へプッシュするだけで、両サービスに記事が反映されます。

---

## ディレクトリ構成

```
SyncLore/
├── drafts/            ← 原稿を書く場所（マスターソース）
│   ├── my-article.md
│   └── images/        ← 記事ごとの画像 (drafts/images/<slug>/)
├── articles/
│   ├── zenn/          ← 変換済み公開記事（Zenn 用）
│   └── qiita/         ← 変換済み公開記事（Qiita 用）
├── images/            ← Zenn が参照する画像ディレクトリ
└── src/
    └── convert.js     ← 変換スクリプト
```

> `articles/` を見れば過去の公開済み記事を一覧できます。

---

## How to Use

### 1. 新しい記事を書く

`drafts/template.md` をコピーしてファイル名（= スラグ）を決めます。

```
drafts/my-new-article.md
```

フロントマターを記入します：

```yaml
---
title: "記事タイトル"
emoji: "✨"          # Zenn 専用（省略時は 📝）
type: "tech"         # tech | idea
topics: ["julia"]    # タグ（Zenn は最大 5 個）
published: false     # 下書き中は false のまま
qiita_id: ""         # 初回は空欄。Qiita 初回デプロイ後に自動で付与される
---
```

### 2. 公開する

`published: true` に変更して `main` ブランチへプッシュ。

```
git add drafts/my-new-article.md
git commit -m "Add: my-new-article"
git push
```

GitHub Actions が自動で以下を実施します：

| ステップ | 内容 |
|----------|------|
| convert  | `drafts/*.md` を Zenn・Qiita 形式に変換 |
| git push | `articles/zenn/` と `articles/qiita/` にコミット |
| Zenn     | GitHub 連携により自動反映 |
| Qiita    | `qiita publish --all` で公開 |

### 3. 画像を使う

画像は `drafts/images/<スラグ>/` に置きます。

```
drafts/images/my-new-article/figure1.png
```

スクリプトが自動で `images/my-new-article/` にコピーします。  
記事内では Zenn 形式で参照します：

```markdown
![説明](/images/my-new-article/figure1.png)
```

### 4. ローカルプレビュー

```bash
npm run preview:zenn    # Zenn のプレビューサーバーを起動
npm run convert         # 手動で変換のみ実行
```

---

## 初期セットアップ（初回のみ）

1. **依存パッケージをインストール**

   ```bash
   npm install
   ```

2. **GitHub Secrets に `QIITA_TOKEN` を登録**  
   Settings → Secrets and variables → Actions → New repository secret

3. **Zenn と GitHub リポジトリを連携**  
   [Zenn の設定ページ](https://zenn.dev/dashboard/deploys) でこのリポジトリを連携する

4. **リポジトリを Public に設定**（GitHub Actions 無料枠のため）

---

## License & Disclaimer

| 対象 | ライセンス |
|------|-----------|
| リポジトリ内のコード・スクリプト | [MIT License](./LICENSE) |
| 記事本文（執筆物） | All Rights Reserved — 無断転載・再利用を禁じます |

> **免責事項**  
> 記事の内容は執筆時点のものであり、正確性・完全性を保証しません。  
> 本リポジトリの利用によって生じたいかなる損害についても筆者は責任を負いません。
