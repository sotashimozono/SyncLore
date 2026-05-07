---
title: 'BiblioFetch.jl の strict モード: APS / Elsevier / Springer から VoR を確実に取る'
tags:
  - Research
  - Julia
  - BibTeX
  - paper-management
  - openaccess
private: false
updated_at: '2026-05-07T08:44:11+09:00'
id: 3d073a33b0cabc2d19d9
organization_url_name: null
slide: false
ignorePublish: false
---

## はじめに

論文を書いていて引用するとき、**preprint と version of record (VoR) は別物**です。preprint は revision で内容が変わっていることがあり、ページ番号も無く、査読を経ていません。査読論文の reference list に preprint URL を載せて返事に「これ最終版で書き直してください」と言われた人は少なくないはず。

[BiblioFetch.jl](https://github.com/sotashimozono/BiblioFetch.jl) は **preprint と publisher のホストする version of record を厳密に区別する** モードを持っています。`source_policy = :strict` を指定すると、出版社が hosting している PDF だけを採用し、arXiv / 諸 preprint server の copy は明示的に弾きます。

## ソースカスケードのおさらい

BiblioFetch のソースは内部的に 2 つに分類されています：

```julia
const PUBLISHER_SOURCES = (:unpaywall, :aps, :elsevier, :springer, :doaj, :openalex, :direct)
const PREPRINT_SOURCES  = (:arxiv, :s2)
```

- **`PUBLISHER_SOURCES`** — version of record をホストしている可能性のあるルート
- **`PREPRINT_SOURCES`** — preprint / aggregated copies を返すルート

`:unpaywall` だけ特殊で、Unpaywall 自体が `host_type = "publisher"` か `"repository"` かを返してくるので、strict モードでは publisher-host のときだけ採用します。

## strict vs lenient

`fetch.source_policy = :strict` の挙動：

```toml
[fetch]
source_policy = "strict"
sources = ["unpaywall", "aps", "elsevier", "springer", "direct"]
```

- 候補生成時に `:arxiv` / `:s2` を**そもそも呼ばない**（候補に登らない）
- `:unpaywall` のレスポンスで `host_type != "publisher"` の URL は捨てる
- 「VoR が取れなかった」場合 fallback しない — `status = "failed"` になる

対して `lenient` (default) は preprint も publisher PDF も同列に試して、**最初に取れたものを採用**します。これは通常の研究 workflow には便利ですが、引用文献を厳密に揃えたいときには preprint が紛れ込みます。

## TDM 認証 — APS / Elsevier / Springer

publisher の PDF を確実に取るには、出版社のテキスト・データ・マイニング (TDM) API キーが必要です。BiblioFetch は 3 大物理系出版社をサポート：

```bash
# 取得（すべて無料）：
export APS_API_KEY=…             # apsombudsman@aps.org にメール 1 通
export ELSEVIER_API_KEY=…        # https://dev.elsevier.com/
export SPRINGER_API_KEY=…        # https://dev.springernature.com/
```

job.toml で opt-in：

```toml
[fetch]
source_policy = "strict"
sources = ["unpaywall", "aps", "elsevier", "springer", "direct"]

[doi]
list = [
    "10.1103/PhysRevB.99.214433",          # APS — Physical Review B
    "10.1016/j.aop.2010.09.012",           # Elsevier — Annals of Physics
    "10.1007/s11538-013-9822-9",           # Springer — Bulletin of Math. Biol.
]
```

各 source は対応する DOI prefix のときだけ呼ばれるので（`is_aps_doi(doi)` 等で gate）、Springer DOI に APS API key を burn するような誤動作はありません。

## 認証無しでも動く — graceful fallback

API key を設定していない出版社の source は **静かにスキップ**されます。例えば `APS_API_KEY` だけ設定していて Elsevier / Springer はキー無しの場合：

```
$ bibliofetch run job.toml
✓ 10.1103/physrevb.99.214433  [aps]        ← APS TDM 経由
✗ 10.1016/j.aop.2010.09.012   no candidate  ← Elsevier source skipped
✗ 10.1007/s11538-013-9822-9   no candidate  ← Springer source skipped
```

strict モード下では fallback しないので、`status = "failed"` で記録されます。`bibliofetch sync` で後から再 fetch 可能。

## on_fail = :error と組み合わせる

論文投稿の最終 reference 整理など、「1 本でも取れなかったら止まってほしい」場面：

```toml
[fetch]
source_policy = "strict"
on_fail = "error"
sources = ["unpaywall", "aps", "elsevier", "springer", "direct"]
```

これで失敗があると non-zero exit code で abort します。CI に組み込んで「reference 全部取れる」ことを assertion 化できます。

## also_arxiv との組み合わせ — VoR と preprint を両方持つ

`source_policy = :strict` で確実に publisher PDF を取りつつ、`also_arxiv = true` で arXiv preprint を**コンパニオン**として併取できます：

```toml
[fetch]
source_policy = "strict"
also_arxiv = true
sources = ["unpaywall", "aps", "elsevier", "springer", "direct"]
```

ストアにはこうなります：

```
papers/
├── 10.1103_physrevb.99.214433.pdf            ← VoR (APS から)
├── 10.1103_physrevb.99.214433__preprint.pdf  ← arXiv preprint
└── .metadata/
    └── 10.1103_physrevb.99.214433.toml       ← preprint_pdf, preprint_sha256 も記録
```

論文 revision の差分を追ったり、preprint しかアクセスできない出先での参照に使えます。

## まとめ

`strict` モードは「出典の provenance を厳格に保ちたい」researcher のためのモード。

- preprint と version of record を区別
- APS / Elsevier / Springer の institutional 認証を Julia から
- `also_arxiv` で preprint を companion として保存
- `on_fail = :error` で reference 完全性を CI で守る

論文を書く最終工程、reference list を生成する瞬間の signal が一段上がります。

---

関連記事：
- [BiblioFetch.jl の総合紹介](#)（Quick start）
- [BiblioFetch.jl で citation graph を辿る](#)（関連 PDF も全部回収）
- [BiblioFetch.jl の vault と job.toml](#)（文献コレクションの git 管理）

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
