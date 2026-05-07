---
title: Obsidian の vault を SSH remoteで直接編集できるプラグインを作った
tags:
  - SSH
  - Plugin
  - TypeScript
  - Remote
  - Obsidian
private: false
updated_at: '2026-05-07T08:44:11+09:00'
id: 7344c85429bec74672d9
organization_url_name: null
slide: false
ignorePublish: false
---

## はじめに

科学技術計算をしていると、データやログの大半は計算機サーバ側にあるという状況が度々あります。一方ノートは Obsidian で管理したい — markdown の plain text、Dataview や Templater のおかげで構造化できる、local動作で速い、複数 device 間 sync は Obsidian Sync か Syncthing で何とかなる。

これを実現しようとすると、`remotely-save` や `obsidian-git` などのpluginを使う必要がありますが、これらの方法では **「ノートはlocal / データはremote」というギャップ** が悩みでした。実験ログを書くたびに `data/` 配下を `scp` か `rsync` するかとか考えるのも面倒だし、できることなら remote で直接 obsidian の作業環境で作業できれば良いところです。既存のどの選択肢も「remote に data を保存し、local は作業のみ」という workflow とは噛み合いません。

なので作りました。

**Obsidian Remote SSH** — Obsidian の vault を **SSH ホスト上にだけ置いた状態で**、local Obsidian から直接編集できるプラグインです。VS Code Remote-SSH と同じ発想を Obsidian に持ち込んだもの、を意識して作ったのでそう理解するとよいかもしれません。

GitHub: [sotashimozono/obsidian-remote-ssh](https://github.com/sotashimozono/obsidian-remote-ssh)

![Demo: SSH remoteの vault を Obsidian で開いて新規ノートを書く](https://raw.githubusercontent.com/sotashimozono/obsidian-remote-ssh/media/demo.gif)

gif では:

1. local vault に `local_demo*.md` が並んだ状態
2. コマンドパレット → `Remote SSH: Connect` → SSH 接続
3. **shadow window** が開き、file explorer が `remote_demo*.md` (= remoteサーバの実ファイル) に切り替わる
4. `Ctrl+N` → 新規ノート → タイピング → Obsidian の autosave がremoteに書き込み

最後の write が本物であることは E2E テストで SFTP 経由で別途検証してあります。

## なぜ作ったか — 既存 plugin との差分

remote 上の markdown を Obsidian で扱おうとするとき、既に candidates はいくつかあります。実際に試したうえで「自分の workflow には合わない」と感じた点を挙げます。

### `remotely-save`

local vault を保持しつつ、S3 / WebDAV / Dropbox / OneDrive 等と sync する plugin。素晴らしい plugin だが:

- **local replica を持つ前提** — 100 GB の実験データを vault に含めると laptop が死ぬ
- 同期トリガーは手動 or 定期ポーリングで、ジョブが吐いた新しい結果が Obsidian にすぐ現れない
- 結局 local と remote どちらが正しいか の判断を都度しなきゃいけない

### `obsidian-git`

vault を git repo として扱い push / pull で同期する plugin。これも素晴らしいが:

- ノートを書くたびに `commit` の人間判断が挟まる
- 競合解決を Obsidian 内でやりたくない (vault に巨大 data も入ってると merge 大変)
- やはり local replica が前提

### VS Code Remote-SSH

remote で直接編集できるという意味では一番近い体験。**実体験として、これは VS Code 上では完璧に動く**。だからこの plugin の発想ごと持ってきた。ただ、

- Obsidian の機能 (Dataview / Graph / Canvas / theme / community plugins) が使えない
- markdown の preview / wikilink の解決が WYSIWYG じゃない

ので Obsidian で同じ体験が欲しかった。

---

このプラグインの方針:

- **local replica を作らない** — vault は SSH ホスト側にだけ存在する
- 専用の **Go daemon** を remote に常駐させ、SFTP より細粒度な RPC で読み書きする
- local Obsidian は通常の Obsidian window として動作する。Dataview / Templater / Canvas / 他のコミュニティプラグインがそのまま動く
- ネットワーク断は内部キューで吸収する

## 主要機能

| | |
|---|---|
| **No local replica** | vault は SSH ホスト側のみ、localは vault adapter のキャッシュ |
| **Go-powered backend** | サーバ側に常駐する Go daemon が file ops を捌く。SFTP より高速 |
| **Standard Obsidian UI** | 接続するとlocal Obsidian と区別がつかない `shadow vault` window が立つ |
| **fs.watch propagation** | remote側の `vim` 編集等もリアルタイムで Obsidian の File Explorer に反映 |
| **3-way merge UI** | 複数マシンから同時編集して衝突したら、ancestor / mine / theirs パネルで解決 |
| **Network-resilient** | 切断中の writes を spool、再接続時に flush。冪等なファイル単位 |
| **Multi-machine** | `workspace.json` などの client-local 状態を per-host subtree に分離 |

## 使い方 (Beta)

現在 BRAT 経由でインストール可能です。

```text
1. BRAT (Beta Reviewers Auto-update Tool) を Obsidian に入れる
2. BRAT の Add Beta Plugin で「sotashimozono/obsidian-remote-ssh」を追加
3. Settings → Remote SSH → SSH Profile を作成 (host / user / port / private key)
4. Command palette → Remote SSH: Connect → プロファイル選択
```

最低限必要なremote側の前提:

- SSH 接続できる Linux または macOS
- `~/.ssh/authorized_keys` が普通に動くこと
- (推奨) クライアントで public key 認証

詳細は [README](https://github.com/sotashimozono/obsidian-remote-ssh#readme) に書いてあります。

## 状態 — pre-1.0 / Obsidian Community Store 申請中

- v1.0.0 は cut 済み、`minAppVersion: 1.5.0`
- E2E は per-PR で本物のremote vault に対して連結 → 切断 → 編集 → 反映 まで検証 (`continue-on-error` なし)
- Obsidian Community Plugins への登録は [obsidianmd/obsidian-releases#12390](https://github.com/obsidianmd/obsidian-releases/pull/12390) で申請中、現在 Obsidian チームのレビュー待ち

承認後は Obsidian の Community Plugins ブラウザから直接インストールできるようになります。それまでは BRAT が一番楽です。

## まとめ

「ノートはlocal、データはremote」を 1 本化したかった。`scp` / `rsync` を毎回打ちたくなかった。
Obsidian に VSCode Remote-SSH の体験が欲しかった。

そういうモチベでこのプラグインを書きました。研究者・remote server を日常的に使う人 (ML 研究、HPC 利用、remote NAS 運用、homelab) に刺さるといいな。

バグ報告・プラグイン互換性レポート・feature request、何でも歓迎します。

- GitHub: <https://github.com/sotashimozono/obsidian-remote-ssh>
- Issues: <https://github.com/sotashimozono/obsidian-remote-ssh/issues>

次回はこのプラグインの内部設計 — `shadow vault` という概念と、なぜ別 Electron プロセスにしたか — について書く予定です。

---

<!-- SYNCLORE_DISCLAIMER_START -->
> **免責事項**
> この記事のコードは [MIT License](https://github.com/sotashimozono/SyncLore/blob/main/LICENSE) に基づき自由に利用できます。
> ただし記事本文の著作権はすべて筆者に帰属し、無断転載・再利用を禁じます。
> 記事の内容は執筆時点のものであり、正確性・完全性を保証しません。
> 本記事の利用によって生じたいかなる損害についても筆者は責任を負いません。

<sub>この記事は [SyncLore](https://github.com/sotashimozono/SyncLore) を使って管理しています。</sub>
<!-- SYNCLORE_DISCLAIMER_END -->
