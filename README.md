# SyncLore — `deploy` branch

このブランチは **CI 専用の生成物保管ブランチ**です。人間は触らないでください。

## 役割

- `articles/` — Zenn-CLI 規約のファイル (Zenn の GitHub 連携が watch する)
- `public/` — Qiita-CLI 規約のファイル (Qiita 投稿 id を保管)
- `images/` — Zenn 用画像コピー

## 編集の入口

ソースは `main` branch の `drafts/<slug>.md` です。記事を書く・直す・取り下げる・削除するのは全部そちらで行います。

詳しくは [main branch の README](https://github.com/sotashimozono/SyncLore/blob/main/README.md) を参照。

## 仕組み

`main` branch の `.github/workflows/sync.yml` が:

1. `main` を checkout
2. `deploy` (このブランチ) を `.deploy/` に worktree checkout
3. `drafts/<slug>.md` を読んで `.deploy/articles/`・`.deploy/public/`・`.deploy/images/` を冪等再生成
4. `npx qiita publish --all` を `.deploy/` から実行
5. このブランチに [CI] sync articles from drafts として PR を作って auto-merge

直接このブランチを編集すると、次の sync で上書きされます。
