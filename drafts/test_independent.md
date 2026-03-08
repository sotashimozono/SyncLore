---
title: "SyncLore Independent Test"
emoji: "🧩"
type: idea
topics: ["sync", "markdown", "test"]
publish: true
---

## 目的
`test_publish.md` と並行して、独立した記事が正しく処理されるかを確認するためのテスト記事です。

## 期待される結果
1. 2つの記事が同時に `npm run convert` で処理される。
2. それぞれの記事が `articles/` と `public/` に正しいフロントマターと共に生成される。
