# SyncLore

Markdown 記事を **Zenn と Qiita の両方に自動公開**する一元管理リポジトリ。
`drafts/<slug>.md` を書いて main に push するだけで、両プラットフォームに同じ内容が反映されます。

> 📦 このリポジトリは **GitHub Template Repository** です。「**Use this template**」ボタンから自分用の repo を作って使えます。下の[「自分用に fork して使う」](#自分用に-fork-して使う)を参照。

---

## できること

| 操作        | やり方                                         | 反映先                                       |
| ----------- | ---------------------------------------------- | -------------------------------------------- |
| 公開        | `drafts/<slug>.md` に `publish: true` で push  | Zenn `published:true` / Qiita `private:false` |
| **予約公開** | `publish: false` + `publish_at: "2026-05-01T10:00:00+09:00"` で push | 時刻到来後の毎時 cron で LIVE 化 (Zenn / Qiita ともに) |
| 修正        | `drafts/<slug>.md` を編集して push             | Zenn / Qiita 両方を update (Qiita id 維持)     |
| 取り下げ    | `drafts/<slug>.md` を `publish: false` に戻す  | Zenn `published:false` / Qiita `private:true`  |
| 完全削除    | `drafts/<slug>.md` に `delete: true` を付与    | Qiita API DELETE / Zenn UI から非表示         |
| 画像        | `drafts/images/<slug>/figure1.png` 等に置く    | Zenn 用 `images/<slug>/` へ自動コピー         |

主な特徴:

- **drafts/ が SSoT** — 同じ記事を Qiita と Zenn でコピペ管理する必要なし
- **予約公開** — `publish_at` を ISO-8601 で書いておけば毎時 cron が時刻到来時に自動公開。Zenn-CLI / Qiita-CLI どちらにも無い機能を SyncLore レベルで提供
- **Atomic** — Qiita publish が失敗したら deploy へも push しないので、Zenn と Qiita で公開状態がズレない
- **冪等** — 同じ drafts を何度処理しても結果は同じ。Qiita 記事 id は `public/<slug>.md` に保管され、再変換しても引き継がれる
- **生成物は別 branch (`deploy`)** — 人間の作業領域に articles/ public/ が混ざらない
- **執筆履歴を残す** — `deploy` branch の [`INDEX.md`](../../blob/deploy/INDEX.md) に公開記事一覧が auto-update され、GitHub Releases (release-drafter) には PR ベースで「新規 / 修正 / 取り下げ / 削除」のログが蓄積される

---

## 自分用に fork して使う

このリポジトリは GitHub の **Template Repository** に設定済みです。GitHub 上で「**Use this template**」ボタンから自分用の repo を作るのが推奨ルート (fork でも動きます)。

### 1. 複製

- **推奨**: ページ上部の **"Use this template" → "Create a new repository"**
  → 新しい repo が作られ、`Include all branches` にチェックを入れると `deploy` branch も一緒にコピーされます (★ 入れ忘れ注意)
- もしくは: 通常の "Fork" でも OK (deploy branch も自動でコピーされる)

### 2. ローカルに clone して "My 化"

このリポジトリには動作デモ用に [synclore-intro](https://qiita.com/sotashimozono/items/578f207e0ffb4eb7ecf5) などの記事が入っています。**そのままだと自分の Qiita / Zenn に他人 (元 repo オーナ) の記事が出る**ため、`init:fork` で一括退避します。

```bash
git clone <your-new-repo-url>
cd <your-new-repo>
npm install

# まず dry-run (何が変わるか確認するだけ)
npm run init:fork

# 問題なければ apply (デモ記事を archive、package.json と README を書き換え)
npm run init:fork -- --apply

# repo を明示したい場合 (gh が無い / 推測したくない)
npm run init:fork -- --apply --repo your-name/your-fork
```

`init:fork --apply` がやること:

- `drafts/synclore-*.md` を `drafts/archive/upstream-synclore/` に退避
- `package.json` の `name` / `repository.url` / `homepage` / `bugs.url` を新 repo の URL に書き換え
- README を fork 用にスリム化 (元 README は `docs/UPSTREAM_README.md` に保存)

確認して commit:

```bash
git status && git diff
git add -A && git commit -m "init: my-fy SyncLore fork" && git push
```

> 補足: `deploy` branch の生成物 (`.deploy/`) も整理したい場合は worktree を作って手動で削除してください (`init:fork` は main の整理のみを行います)。

### 3. Secrets / Variables / Public 化

- **Settings → Secrets and variables → Actions → Secrets**
  - `QIITA_TOKEN` を登録 ([Qiita アプリ設定](https://qiita.com/settings/applications) で `read_qiita` + `write_qiita` のトークンを発行)
- **Settings → Secrets and variables → Actions → Variables** (任意)
  - `QIITA_USERNAME`、`ZENN_USERNAME` を設定すると INDEX.md の URL がそのユーザ名で組まれる (未設定なら GitHub の owner 名)
- **Settings → General → Visibility**: Public に変更 (GitHub Actions 無料枠のため)

### 4. Zenn と連携 (deploy branch を watch)

[Zenn のデプロイ設定](https://zenn.dev/dashboard/deploys) で自分の repo を連携し、対象 branch を **`deploy`** に設定。
(`main` ではなく `deploy` です。articles は deploy branch にしか置かれません)

### 5. 最初の記事を書いて push

```bash
cp drafts/template.md drafts/my-first-post.md
# 編集して publish: true にしてから
git add drafts/my-first-post.md
git commit -m "add: my-first-post"
git push
```

GitHub Actions の `sync.yml` が両プラットフォームに同時公開します。

---

## 使い方

### 記事を書く

`npm run new -- "<title>"` で `drafts/<slug>.md` を template から 1 コマンドで生成できます。

```bash
npm run new -- "BiblioFetch.jl の citation graph"
# → created drafts/bibliofetch-jl-citation-graph.md (publish: false / topics: [])
```

slug は title から自動生成 (NFKD 正規化 + 非英数字を `-` に置換 + 連続ハイフン圧縮)。同名 draft が既にある場合は exit 1、`--force` で上書きします。手で作りたい場合は従来通り `cp drafts/template.md drafts/<slug>.md` でも OK。

frontmatter の主要フィールド:

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

### push 前に lint する

`npm run lint` で `drafts/*.md` を一括検査できます。frontmatter の必須項目 (title / topics 1-5 / type / publish bool)、`publish_at` の ISO-8601 + TZ 形式、slug 衝突 (case-insensitive)、本文中の画像 path 存在、tag 名 (Qiita ルール)、`publish` と `publish_at` の矛盾などを確認します。read-only で自動 fix はしません。error が 1 つでもあれば exit 1、warning だけなら exit 0 (`--strict` で warning も exit 1)。

### push 前に確認する (dry-run)

`npm run dry-run` を実行すると、`drafts/*.md` 各ファイルが `convert.js` の次の実行でどう分類されるか (LIVE / SCHEDULED / HIDDEN / TOMBSTONE / SKIP) を**書き込みなし**で表示します。
push して 1 時間後の cron が何をするか不安なときの最終確認に使ってください (Qiita DELETE 予定の `delete: true` も事前に見えます)。

### 予約公開する (scheduled)

未来の日時を指定して push しておけば、その時刻を過ぎた後の cron 実行で自動公開されます。

```yaml
---
title: "..."
publish: false
publish_at: "2026-05-01T10:00:00+09:00"   # ISO-8601 + TZ 必須
---
```

仕組み:

- `sync.yml` は `cron: "0 * * * *"` (毎時 00 分) でも起動
- `convert.js` が `publish_at <= now` の draft を **effective LIVE** として処理 (Zenn `published:true` / Qiita `private:false` で出力)
- 公開後、`drafts/<slug>.md` は `publish: false` のままだが、`publish_at` が過去なので毎回 LIVE 扱い
- 取り下げたい場合は `publish_at` を消す or 未来時刻に戻す

> 粒度: 毎時 00 分の cron + GitHub Actions の遅延 (~15 分) で、最大 1 時間程度のラグ。技術記事には十分。
> Zenn-CLI / Qiita-CLI どちらも公式には予約公開機能を持たないため、SyncLore で実装しています。

#### 予約日時が現在時刻より古い場合の挙動

`publish_at` は「未来」も「過去」も `publish_at <= now → LIVE` という 1 つのルールで扱います。具体的には:

| draft の状態 | 解釈 | Zenn 出力 | Qiita 出力 |
| --- | --- | --- | --- |
| `publish: true` | LIVE 即時 (`publish_at` は無視) | `published: true` | `private: false` |
| `publish: false` + `publish_at <= now` | **LIVE** (予約発火 / 過去日時即時) | `published: true` | `private: false` |
| `publish: false` + `publish_at > now` + 既存出力なし | SCHEDULED (待機) | (出力されない) | (出力されない) |
| `publish: false` + `publish_at > now` + 既存出力あり | HIDE (再公開予約待ち) | `published: false` | `private: true` |
| `publish: false` + `publish_at` なし + 既存出力あり | HIDE (取り下げ) | `published: false` | `private: true` |
| `publish: false` + `publish_at` なし + 既存出力なし | SKIP (執筆中) | (出力されない) | (出力されない) |

含意:

- 予約発火後 (`publish_at` が過去になった後) も `drafts/<slug>.md` を `publish: false` のまま放置 OK。毎時 cron が常に LIVE として再生成するため**公開状態が維持される**。
- 「最初から過去日時を書いて push」しても予約発火と同じ経路で即時公開される。
- 予約を取り下げたい場合は `publish_at` を削除するか未来時刻に書き換える。`publish_at` を残したまま `publish: false` だけ書いても効果がない (過去日時はずっと LIVE 扱い)。
- `publish_at` のパースに失敗した値 (TZ 抜きや不正形式) は「`publish_at` なし」と同じ扱い。**TZ 必須**。

```mermaid
flowchart TD
    Start["drafts/&lt;slug&gt;.md"] --> P{"publish:true?"}
    P -->|yes| LIVE_now["LIVE 即時"]
    P -->|no| PA{"publish_at?"}
    PA -->|なし| HasOut1{"既存出力?"}
    HasOut1 -->|あり| HIDE
    HasOut1 -->|なし| SKIP
    PA -->|あり| Past{"publish_at &le; now?"}
    Past -->|yes| LIVE_eff["LIVE 予約発火 / 過去日時即時"]
    Past -->|no| HasOut2{"既存出力?"}
    HasOut2 -->|なし| SCHEDULED
    HasOut2 -->|あり| HIDE2["HIDE"]
```

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

### 公開済み記事を archive する

公開した記事を「もう触らない、けど Qiita / Zenn では公開状態のまま残しておく」状態にしたいときは、`drafts/<slug>.md` を `drafts/archive/<slug>.md` に move します。

```bash
git mv drafts/foo.md drafts/archive/foo.md
git commit -m "archive: foo"
git push
```

CI は `drafts/` 直下のみ走査するため、`drafts/archive/` 配下のファイルは

- 変換されない (`articles/<slug>.md`・`public/<slug>.md` は最後の状態で凍結)
- INDEX.md にも出ない
- 編集しても push 時に何も起きない (Qiita / Zenn が誤って update されない)

archive から戻すには `git mv drafts/archive/foo.md drafts/foo.md`。Qiita id は `public/foo.md` に保管されたままなので、戻して push すれば PATCH で update されます。

### 記事間リンク (`[[slug]]`)

`drafts/<slug>.md` の本文中で他の記事を参照する際は、Obsidian 風の wiki-link が使えます。

```markdown
詳しくは [[synclore-intro]] を参照。
[[synclore-intro|記事の投稿を自動化するツール SyncLore]] の続編です。
```

公開時に各プラットフォーム向けの URL に自動変換されます:

- Zenn 出力: `[表示テキスト](https://zenn.dev/<user>/articles/<slug>)`
- Qiita 出力: `[表示テキスト](https://qiita.com/<user>/items/<id>)` (id は `public/<slug>.md` から取得)

ターゲット記事がまだ Qiita 公開されていない (id 未割当) 場合、Qiita 出力では GitHub repo の `drafts/<slug>.md` にフォールバックリンクされます。コードブロック内の `[[...]]` は変換されません。表示テキストを省略すると target draft の `title` が使われます。

archive 配下 (`drafts/archive/<slug>.md`) の記事も link target として有効です。記事は `articles/`・`public/` に残ったまま凍結されているため、`[[archived-slug]]` は通常通り公開 URL に解決されます。

### 連載記事を書く (`series:`)

複数記事をまたぐ連載を書くときは frontmatter に `series: "シリーズ名"` を書きます。同じ値を持つ全 draft の cross-link footer (「同じシリーズの記事」一覧) が convert 時に各記事末尾 (免責事項の上) に自動挿入されます。順序は `publish_at` 昇順 (無ければファイル名順)、自分自身は太字でリンクなし、未公開 sibling は plain text で表示されます。Zenn 出力は `https://zenn.dev/<user>/articles/<slug>`、Qiita 出力は `https://qiita.com/<user>/items/<id>` のリンク形式になります。

### 記事を rename する (aliases:)

`drafts/foo.md` を `drafts/foo-v2.md` に rename したいとき、Qiita id が引き継げないと**新規投稿として重複**してしまいます。これを避けるには新ファイルのフロントマターで旧 slug を宣言します。

```yaml
---
title: "..."
publish: true
aliases: ["foo"]   # ← 旧 slug
---
```

`convert.js` の動作:

- 他記事の `[[foo]]` は `foo-v2` の URL に解決される (alias 逆引き)
- `public/foo.md` に id があれば `public/foo-v2.md` に id を migrate
- 旧 `articles/foo.md` と `public/foo.md` は CI が削除 (orphan 防止)

これで Qiita 側は同じ id のまま update され (URL は id ベースなので変わらない)、wiki-link も切れません。

> ⚠️ Zenn の URL は slug ベースのため、rename すると `https://zenn.dev/.../articles/foo` は 404 になり、`/articles/foo-v2` が新 URL になります。これは Zenn 側の制約で SyncLore では救えません。
> ⚠️ `drafts/images/<slug>/` は自動 migrate されません。必要なら `git mv` で手動移動を。

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
cd .deploy && npm run preview:qiita                   # Qiita プレビュー
```

`SYNCLORE_DEPLOY_ROOT` を未指定にすると main の working tree に生成されますが `.gitignore` で commit できないので、ローカル確認用です。

### 公開履歴 (`log/publish-history.jsonl`)

`convert.js` は記事の状態変化 (publish / update / tombstone / hide) を JSON Lines で `log/publish-history.jsonl` に追記します。1 行 1 record で `ts` (JST ISO-8601) / `slug` / `action` / `title` / `platform` / `qiita_id` / `qiita_url` / `zenn_url` / `publish_at` を保存。
何月何日に何が公開されたかを後から振り返れるほか、SNS シェア用の URL を即取得したり、connect 記事の選定に使えます。
状態に変化がない再実行では何も追記されません (idempotent)。ファイルは main に commit され履歴として永続化されます (`grep slug log/publish-history.jsonl` で個別記事の遍歴を辿れる)。

### Analytics (Qiita PV / LGTM の取得)

`npm run analytics` で自分の Qiita 全公開記事の `page_views_count` / `likes_count` / `stocks_count` / `comments_count` を pull し、`log/analytics-YYYY-MM-DD.json` に snapshot を保存します。前回 snapshot との差分 (`+145 PV +23 LGTM` 等) を stdout 表示。

`QIITA_TOKEN` 環境変数 ([Qiita アプリ設定](https://qiita.com/settings/applications) の `read_qiita` scope) が必要です。GitHub Actions の cron (`0 0 * * *` 等) に `QIITA_TOKEN` secret を渡して毎日走らせれば、`log/` に時系列 snapshot が蓄積され、後から PV 推移を分析できます。

Zenn analytics は Zenn API が現状提供されていないため未対応です。

### Branch 命名規約 (release-drafter autolabeler 用)

PR を作るときの branch 名を以下に揃えると、release-drafter が自動でラベルを付け、リリースノートのカテゴリに振り分けてくれます。

| Branch prefix | ラベル | Releases のカテゴリ |
| --- | --- | --- |
| `add/<slug>` | `article-new` | 📝 New articles |
| `edit/<slug>` | `article-update` | ✏️ Updated articles |
| `unpub/<slug>` | `article-unpublish` | 🚪 Unpublished |
| `delete/<slug>` | `article-delete` | 🗑 Deleted articles |
| `chore/...` / `fix/...` / `feat/...` / `refactor/...` / `hotfix/...` | (それぞれ) | 🔧 Maintenance |

PR タイトルの prefix (`add: ...`, `edit: ...` 等) でも同じ判定が走ります。

main へ直 push する場合はラベルが付かないので、Releases に履歴として残したいときは PR 経由を推奨。

---

## 運用ガイド

長期運用で参照するドキュメント:

- [docs/UPSTREAM_TRACKING.md](docs/UPSTREAM_TRACKING.md) — upstream SyncLore の機能更新を fork に取り込む
- [docs/PRIVATE_MIGRATION.md](docs/PRIVATE_MIGRATION.md) — public repo を private に変更する手順
- [docs/BACKUP.md](docs/BACKUP.md) — repo / 生成物の backup 戦略

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
