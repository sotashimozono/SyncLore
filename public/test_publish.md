---
title: "SyncLore Publication Flow Test"
tags:
  - name: "github"
  - name: "automation"
  - name: "test"
private: false
updated_at: ""
organization_url_name: ""
slide: false
id: null
---

## 期待される動作
1. この記事が `npm run convert` で `articles/` と `public/` に配備される。
2. Qiita 用のフロントマター (`updated_at`, `organization_url_name`, `slide`) が自動付与される。
3. `npm run deploy:qiita` でエラーなく公開または検証される。

## テスト内容
無事にデプロイが通ることを確認します。

---

> **免責事項**
> この記事のコードは [MIT License](https://github.com/sotashimozono/SyncLore/blob/main/LICENSE) に基づき自由に利用できます。
> ただし記事本文の著作権はすべて筆者に帰属し、無断転載・再利用を禁じます。
> 記事の内容は執筆時点のものであり、正確性・完全性を保証しません。
> 本記事の利用によって生じたいかなる損害についても筆者は責任を負いません。
