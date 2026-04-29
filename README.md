# SyncLore

Markdown 記事を **Zenn と Qiita の両方に自動公開**する一元管理リポジトリ。
`drafts/<slug>.md` を書いて main に push するだけで、両プラットフォームに同じ内容が反映されます。

---

## できること

| 操作        | やり方                                         | 反映先                                       |
| ----------- | ---------------------------------------------- | -------------------------------------------- |
| 公開        | `drafts/<slug>.md` に `publish: true` で push  | Zenn `published:true` / Qiita `private:false` |
| 修正        | `drafts/<slug>.md` を編集して push             | Zenn / Qiita 両方を update (Qiita id 維持)     |
| 取り下げ    | `drafts/<slug>.md` を `publish: false` に戻す  | Zenn `published:false` / Qiita `private:true`  |
| 完全削除    | `drafts/<slug>.md` に `delete: true` を付与    | Qiita API DELETE / Zenn UI から非表示         |
| 画像        | `drafts/images/<slug>/figure1.png` 等に置く    | Zenn 用 `images/<slug>/` へ自動コピー         |

主な特徴:

- **drafts/ が SSoT** — 同じ記事を Qiita と Zenn でコピペ管理する必要なし
- **Atomic** — Qiita publish が失敗したら deploy へも push しないので、Zenn と Qiita で公開状態がズレない
- **冪等** — 同じ drafts を何度処理しても結果は同じ。Qiita 記事 id は `public/<slug>.md` に保管され、再変換しても引き継がれる
- **生成物は別 branch (`deploy`)** — 人間の作業領域に articles/ public/ が混ざらない

---

## クイックスタート (fork したあと)

1. **GitHub Secrets に `QIITA_TOKEN` を登録**
   Settings → Secrets and variables → Actions → New repository secret
   Qiita の [アプリケーション設定](https://qiita.com/settings/applications) で write スコープのトークンを発行

2. **Zenn と連携 (deploy branch を watch)**
   [Zenn のデプロイ設定](https://zenn.dev/dashboard/deploys) でこのリポジトリを連携し、対象 branch を **`deploy`** に設定
   (`main` ではなく `deploy` です。articles は deploy branch にしか置かれません)

3. **リポジトリを Public に設定** (GitHub Actions 無料枠のため)

4. **記事を書いて push**

   ```bash
   cp drafts/template.md drafts/my-first-post.md
   # 編集して publish: true にしてから
   git add drafts/my-first-post.md
   git commit -m "Add: my-first-post"
   git push
   ```

   GitHub Actions の `sync.yml` が両プラットフォームに同時公開します。

---

## 使い方

### 記事を書く

`drafts/template.md` をコピーしてスラグ名を決めます。

```yaml
---
title: "記事タイトル"
emoji: "✨"              # Zenn 専用 (省略時は 📝)
type: "tech"             # tech | idea (Zenn 専用)
topics: ["julia", "oss"] # タグ。Zenn は最大 5 個
publish: false           # 下書き中は false
---
```

`publish: true` にして main へ push すると公開されます。

### 修正する

`drafts/<slug>.md` を編集して push するだけ。記事 ID は維持されたまま両方が update されます。免責事項は HTML コメントマーカで囲まれているので再生成しても重複しません。

### 取り下げる (unpublish)

`publish: false` に戻して push:

- `articles/<slug>.md` → `published: false` (Zenn で draft 扱い)
- `public/<slug>.md` → `private: true` (Qiita で限定共有 = 非公開)

再公開は `publish: true` に戻すだけ。

### 完全に削除する (delete)

`drafts/<slug>.md` のフロントマターに `delete: true` を追加して push:

```yaml
---
title: "..."
publish: false
delete: true   # ★ 不可逆: Qiita 側は API DELETE
---
```

- **Qiita**: API DELETE で完全削除
- **Zenn**: `articles/<slug>.md` を repo から削除 → UI から非表示 (Zenn サーバ側データは残るため、完全消去したい場合は Zenn 管理画面で手動削除)
- **Repo**: `articles/<slug>.md`・`public/<slug>.md`・`images/<slug>/` を CI が削除
- `drafts/<slug>.md` は tombstone として残る (履歴からも消したい場合は `git rm` してください)

> ⚠️ Qiita API DELETE は不可逆です。誤って `delete: true` を書かないよう注意。

### 画像を使う

`drafts/images/<slug>/figure1.png` に置けば、CI が `images/<slug>/` にコピーします。記事内では Zenn 形式で参照:

```markdown
![説明](/images/my-article/figure1.png)
```

### ローカルプレビュー

```bash
npm install
git worktree add .deploy deploy                       # 初回のみ
SYNCLORE_DEPLOY_ROOT=$(pwd)/.deploy npm run convert   # 変換
cd .deploy && npm run preview:zenn                    # Zenn プレビュー
```

`SYNCLORE_DEPLOY_ROOT` を未指定にすると main の working tree に生成されますが `.gitignore` で commit できないので、ローカル確認用です。

---

## アーキテクチャ

```mermaid
flowchart LR
    subgraph main["main branch (人間)"]
        D[drafts/]
        S[src/convert.js<br/>src/synclore-delete.js]
        WF[.github/workflows/sync.yml]
    end
    subgraph deploy["deploy branch (CI 専用、orphan)"]
        A[articles/]
        P[public/<br/>id 保管]
        I[images/]
    end
    main -->|sync.yml が両方 checkout| CI[CI runner]
    CI -->|qiita publish --all| Qiita[Qiita]
    CI -->|生成物を直 push<br/>(gh-pages 同等)| deploy
    deploy -->|webhook 検知| Zenn[Zenn]
```

deploy branch は **gh-pages 風の dump branch** として扱います。CI が直 push するのみで、PR 通知は出ません。Zenn の連携は deploy branch を見ます。Qiita は API push なので branch 構成と無関係。

`articles/`・`public/`・`images/` は main の `.gitignore` でハードブロックされているので、ローカルで誤って commit する事故は起きません。

---

## License

| 対象                                | ライセンス                                                          |
| ----------------------------------- | ------------------------------------------------------------------- |
| リポジトリ内のコード・スクリプト    | [MIT License](./LICENSE)                                            |
| 記事本文 (執筆物)                   | 各記事の著者に帰属 (このリポジトリの記事は All Rights Reserved)     |

> **免責事項**
> 記事の内容は執筆時点のものであり、正確性・完全性を保証しません。
> 本リポジトリの利用によって生じたいかなる損害についても筆者は責任を負いません。
