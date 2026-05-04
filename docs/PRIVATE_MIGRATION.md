# Public → Private 化の手順

草稿状態の記事を世に晒したくない、社内向けに使いたい、等の理由で repo を private にする手順と注意点。

## 手順 (GitHub Web UI)

`Settings → General → Danger Zone → Change repository visibility → Make private`

確認 dialog で repo 名を打ち込めば即時切り替わる。

## 切り替え前 checklist

- [ ] **GitHub Pages 不要を確認**: Free plan では private repo の Pages は deploy が止まる (Pro / Team / Enterprise が必要)。SyncLore は Pages を使わないので通常は無問題。
- [ ] **Actions 月間使用量を確認**: private では使用分単位で Free plan の枠 (2,000 min/月) を消費する。public は無制限。SyncLore の `sync.yml` は 1 回 ~1 分なので 2,000 push/月までは余裕。
- [ ] **fork 関係の整理**: private 化すると既存の fork は upstream 接続が切れて独立 repo になる。fork ユーザに事前告知。
- [ ] **external link 影響範囲確認**: Qiita / Zenn の公開記事中に GitHub repo へのリンク (`github.com/<user>/MySyncLore/...`) を貼っていた場合、private 化で 404 になる。

## 影響を受けないもの

- `secrets.QIITA_TOKEN` 等の Actions Secrets — repo visibility に関係なく保持される
- deploy branch の articles/ public/ — そのまま残る (Zenn 連携は private repo でも動く。Zenn dashboard で再認可が必要な場合あり)
- Qiita 側の公開済み記事 — Qiita API は token ベースなので影響なし

## 戻す (private → public)

同じ Danger Zone から `Make public` で戻せる。fork 関係は復活しない (一度切れたものは再接続不可)。

## 関連

- private 化の前に [BACKUP.md](./BACKUP.md) で git mirror を取っておくと、誤操作 (削除・誤 visibility 変更) からの復旧が早い
