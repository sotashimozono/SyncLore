# Backup 戦略

GitHub アカウント停止・誤削除・Qiita 側だけ残った記事の salvage、といったレアケースに備えて何を backup しておくか。

## 何を backup するか

| 対象 | 含まれるもの | 重要度 |
| --- | --- | --- |
| `main` branch | `drafts/` (執筆原稿) + `src/` + `.github/` + 設定 | ★★★ (執筆物本体) |
| `deploy` branch | `articles/`・`public/` (Qiita id 保管) + `INDEX.md` | ★★ (再生成可能だが Qiita id を含むため復旧時に欲しい) |
| GitHub Releases / Actions ログ | リリースノート、CI 履歴 | ★ |
| Qiita 側の公開記事 | Qiita 上の最終状態 (本文を fork で失った場合の最後の砦) | ★★ |

GitHub repo そのものは GitHub の責任だが、アカウント BAN・誤削除に対する保険として手元 (or 別 host) に mirror を持っておくのが安全。

## やり方

### 手動 mirror (週次 / 月次)

すべての branch・tag を含む完全 clone を別ディスクに置く。

```bash
git clone --mirror git@github.com:<user>/MySyncLore.git ~/backups/mysynclore.git
# 更新するときは
cd ~/backups/mysynclore.git && git remote update --prune
```

`--mirror` は bare repo として全 ref を持ってくるので、deploy branch・tag・PR ref まで丸ごと保存される。

### 自動 (GitHub Actions で別 storage に push)

別の private repo / S3 / R2 に毎週 mirror する workflow を追加。例:

```yaml
# .github/workflows/backup.yml
on:
  schedule: [{ cron: "0 3 * * 0" }]   # 毎週日曜 03:00 UTC
jobs:
  mirror:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - run: |
          git remote add backup git@github.com:<user>/MySyncLore-backup.git
          git push --mirror backup
        env:
          GIT_SSH_COMMAND: "ssh -i ${{ secrets.BACKUP_DEPLOY_KEY }}"
```

### 簡易 (depth 制限)

履歴がそこまで重要でなければ最新 100 commit だけ。

```bash
gh repo clone <user>/MySyncLore -- --depth 100
```

## Restore シナリオ

- **アカウント停止 / repo 削除**: mirror から `git push --mirror` で別 repo として復活させる。
- **特定 branch を吹き飛ばした**: mirror から該当 branch を `git fetch backup <branch>` で取り戻す。
- **Qiita 側にしか残っていない記事を salvage**: Qiita-CLI で pull して drafts/ に戻す。

```bash
npx qiita pull <article-id>     # Qiita 上の本文を取得
# 取得した md を drafts/<slug>.md に整形しなおして commit
```

## 関連

- [PRIVATE_MIGRATION.md](./PRIVATE_MIGRATION.md) — visibility 変更前に mirror を取っておくと安全
- [UPSTREAM_TRACKING.md](./UPSTREAM_TRACKING.md) — backup repo を upstream として tracking すれば fork 風の冗長化も可能
