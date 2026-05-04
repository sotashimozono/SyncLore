# Upstream SyncLore の更新を取り込む

自分の fork (例: `MySyncLore`) に upstream SyncLore の機能更新だけを取り込みたいときの手順。`drafts/` (自分の記事) は触らず、`src/` や `.github/workflows/` のみ追従するのが基本。

## upstream を remote に追加

初回のみ:

```bash
git remote add upstream git@github.com:sotashimozono/SyncLore.git
git fetch upstream
```

## 推奨: cherry-pick で機能 commit だけ取り込む

upstream `main` の commit のうち、自分の `main` にまだ無いものを確認し、欲しい commit だけ取り込む。

```bash
git fetch upstream
git log upstream/main --oneline --not main   # 何が新しい?
git cherry-pick <sha>                         # 機能 commit を 1 つずつ
```

drafts/ を触る commit は無いはず (upstream は src/ と workflow しか update しない方針) なので、conflict は基本 src/ 側でしか起きない。

## 一括: upstream 全体を merge して drafts/ だけ戻す

機能更新が大量にあって cherry-pick が面倒なときは、merge → drafts/ だけ自分側に戻す。

```bash
git fetch upstream
git merge upstream/main --no-commit --no-ff
git checkout HEAD -- drafts/                  # drafts/ は fork の状態に戻す
git commit -m "merge: sync from upstream (drafts/ kept local)"
```

## conflict の心得

| ファイル群 | conflict 時の方針 |
| --- | --- |
| `src/`・`.github/workflows/` | upstream 優先 (自分の改造より新機能を取りたいなら) |
| `drafts/`・`drafts/images/` | fork 優先 (自分の記事は upstream に存在しない) |
| `README.md` | 手動 merge (upstream 側の機能説明追加 + 自分の追記を両方残す) |
| `package.json` | 手動 merge (依存追加は upstream を取り込み、name は自分側維持) |
