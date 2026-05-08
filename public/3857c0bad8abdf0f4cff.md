---
title: BiblioFetch.jl の vault と job.toml — 文献コレクションを git 管理可能な平文で持つ
tags:
  - Julia
  - TOML
  - BibTeX
  - PKM
  - paper-management
private: false
updated_at: '2026-05-08T08:53:58+09:00'
id: 3857c0bad8abdf0f4cff
organization_url_name: null
slide: false
ignorePublish: false
---

## はじめに

文献管理ツールの大半（Zotero / Mendeley / EndNote）は **SQLite やプロプライエタリなバイナリ DB** をストアに使います。便利な反面、

- `git diff` で何が変わったか分からない
- `rsync` で複数マシンに配るのが面倒
- バックアップから 1 行だけ復元する、が出来ない
- 機械的に grep / sed / awk で処理できない

[BiblioFetch.jl](https://github.com/sotashimozono/BiblioFetch.jl) は 真逆の設計で、**全データが TOML 平文**です。文献コレクションは 2 層構造：

1. **`job.toml`** — プロジェクト単位の参照リスト（論文 1 本書くごとに 1 ファイル）
2. **vault** — トピックごとに整理した正典コレクション（複数プロジェクトから参照される）

git にそのまま入れる前提で設計しています。

## job.toml — プロジェクト単位の参照

論文 1 本、レビュー 1 本、研究室の輪読会、それぞれに 1 つ `job.toml` を持つ運用：

```toml
# papers-2026-quantum-walk/job.toml
[folder]
target = "."                            # この toml と同じ場所に PDF を置く
bibtex = "references.bib"               # bib 出力先

[fetch]
sources    = ["unpaywall", "arxiv", "s2", "direct"]
parallel   = 4
also_arxiv = true                       # publisher PDF + arXiv preprint を組で

[doi]
list = [
    "10.1103/PhysRevA.48.1687",         # Aharonov, Davidovich, Zagury 1993
    "arxiv:quant-ph/0010117",           # Watrous 2001
    "10.1103/PhysRevLett.91.130602",    # Knight et al. 2003
]

[doi.review]                             # ネスト可能、グループ化される
list = [
    "10.1080/00107151031000110776",     # Kempe 2003 review
]
```

走らせるだけ：

```bash
$ cd papers-2026-quantum-walk/
$ bibliofetch run job.toml
$ git add . && git commit -m "initial reference set"
```

ストアもメタデータも BibTeX も全部 commit 対象。誰がいつ何を追加したか git log で追える。

## job.toml の主な項目

| セクション | 項目 | 用途 |
|---|---|---|
| `[folder]` | `target` | PDF 置き場 |
| `[folder]` | `bibtex` | BibTeX 出力先 |
| `[fetch]` | `sources` | 使うソース |
| `[fetch]` | `parallel` | 並列度 (1-8 推奨) |
| `[fetch]` | `source_policy` | `lenient` / `strict` |
| `[fetch]` | `on_fail` | `pending` / `skip` / `error` |
| `[fetch]` | `also_arxiv` | preprint companion |
| `[graph]` | `follow_references` | citation graph 展開 |
| `[graph]` | `max_depth` | 何 hop 追うか |
| `[doi]` | `list` | DOI / arXiv id 配列 |
| `[doi.<group>]` | `list` | グループ化 |

## vault — 横断的なトピック管理

job.toml が「プロジェクト 1 件のコレクション」なら、vault は「分野 / トピックごとの正典コレクション」。位置はデフォルトで `~/.config/bibliofetch/vault/`：

```
~/.config/bibliofetch/vault/
├── vault.toml                          # 共有設定
├── tensor-networks.toml                # トピック 1
├── quantum-info.toml                   # トピック 2
└── nonequilibrium.toml                 # トピック 3
```

各トピック TOML：

```toml
# ~/.config/bibliofetch/vault/tensor-networks.toml
[topic]
name  = "Tensor Networks"
tags  = ["mps", "dmrg", "peps"]
notes = "MPS/DMRG/PEPS の正典 references"

[doi]
list = [
    "arxiv:cond-mat/0407066",            # Vidal 2004
    "10.1103/RevModPhys.93.045003",     # Cirac et al. 2021
]
```

CLI で扱う：

```bash
$ bibliofetch vault ls                  # 全トピック一覧
$ bibliofetch vault add arxiv:1706.03762 --topic tensor-networks
$ bibliofetch vault fetch tensor-networks
$ bibliofetch vault search "renormalization"
$ bibliofetch vault bib tensor-networks --out tn.bib
```

## job.toml から vault を継承

特定プロジェクトの `job.toml` で「このトピックの全文献を持って来て」と書ける：

```toml
# job.toml
[vault]
inherit = ["tensor-networks", "quantum-info"]

[doi]
list = [
    "arxiv:2024.12345",                  # この project 固有の追加
]
```

これで vault のトピック refs と project 固有 refs を合算した状態で fetch されます。トピックを更新すれば project 側の重複編集なしに反映。

## 出力フォーマット

### BibTeX (FirstAuthorYear citekey + 自動 disambiguation)

```bash
$ bibliofetch bib papers/
wrote 23 entries → papers/papers.bib
```

```bibtex
@article{Schollwock2011,
  author  = {Ulrich Schollwöck},
  title   = {The density-matrix renormalization group...},
  journal = {Annals of Physics},
  year    = {2011},
  doi     = {10.1016/j.aop.2010.09.012},
  url     = {https://doi.org/10.1016/j.aop.2010.09.012},
}
```

### CSL JSON (v1.1.0+) — Pandoc / Quarto / Hugo 直結

```bash
$ bibliofetch csl papers/ --out papers.json
```

Pandoc / Quarto / Hugo の `bibliography:` フィールドが直接受け付ける形式です。LaTeX 経由しない執筆 workflow に最適。

## 運用ツール — doctor, dedup, search, stats

平文ストアならではの内省ツールが揃っています：

```bash
# ストアの整合性チェック
$ bibliofetch doctor papers/
  pdf_missing  10.1234/x.y.z   metadata に登録あるが PDF 不在
  orphan_pdf   foo.pdf         PDF あるが metadata 無し
  sha_mismatch 10.4567/a.b.c   PDF の SHA256 が metadata と不一致

$ bibliofetch doctor papers/ --fix          # 自動修復可能なものを修正

# 重複検出 (DOI alias で同じ論文が二重登録された場合など)
$ bibliofetch dedup papers/

# 全文検索 (title / authors / abstract / journal を grep)
$ bibliofetch search papers/ "entanglement entropy"

# 統計
$ bibliofetch stats papers/
  total entries: 234
  status:        ok=220 / pending=10 / failed=4
  sources:       unpaywall=120 / arxiv=80 / aps=15 / direct=5
  total size:    1.4 GB
```

これらは平文 TOML を `walk` するだけなので、ストア構造を意識せずとも信頼できる internal state が保てます。

## git 管理の運用例

```
papers-2026-quantum-walk/
├── job.toml                            ← reference 定義
├── README.md
├── references.bib                      ← bibliofetch run の出力
├── .gitignore                          ← *.pdf を除外（重い）
├── .metadata/                          ← TOML 全部、commit 対象
│   ├── 10.1103_physreva.48.1687.toml
│   └── ...
└── (PDF は .gitignore)
```

メタデータと job.toml だけ commit、PDF は重いので `.gitignore`。新しい環境でも `bibliofetch sync` 一発で PDF が再生成される（unpaywall / arxiv は idempotent）。

## まとめ

- **job.toml** は project 単位、**vault** は分野横断のトピック単位
- すべて平文 TOML → git 管理 / rsync / grep / sed 全部効く
- BibTeX と CSL JSON 両方出せる、Pandoc / Quarto / Hugo / LaTeX どれでも繋がる
- `doctor` / `dedup` / `search` / `stats` で integrity と内省可能
- `inherit` で vault → job.toml の参照継承

文献を「データベース」ではなく「ファイル」として扱う気持ち良さがあります。

---

関連記事：
- [BiblioFetch.jl の総合紹介](#)（Quick start）
- [BiblioFetch.jl で citation graph を辿る](#)（関連 PDF も全部回収）
- [BiblioFetch.jl の strict mode + TDM](#)（preprint と publisher PDF の区別）

GitHub: [sotashimozono/BiblioFetch.jl](https://github.com/sotashimozono/BiblioFetch.jl)

---

<!-- SYNCLORE_DISCLAIMER_START -->
> **免責事項**
> この記事のコードは [MIT License](https://github.com/sotashimozono/SyncLore/blob/main/LICENSE) に基づき自由に利用できます。
> ただし記事本文の著作権はすべて筆者に帰属し、無断転載・再利用を禁じます。
> 記事の内容は執筆時点のものであり、正確性・完全性を保証しません。
> 本記事の利用によって生じたいかなる損害についても筆者は責任を負いません。

<sub>この記事は [SyncLore](https://github.com/sotashimozono/SyncLore) を使って管理しています。</sub>
<!-- SYNCLORE_DISCLAIMER_END -->
