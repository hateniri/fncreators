# FN Creators JP

日本のプレイヤー向け、Fortnite / UEFN の**非公式ファンサイト**です。スマホで流し読みできる短いニュースを、静的 HTML で配信します。

このサイトは Epic Games、Fortnite、FortniteJP とは関係ありません。公式の発表は、各公式サイトで確認してください。

- サイト: https://fncreators.com
- X: [@FNCreatorsJP](https://x.com/FNCreatorsJP)

ドメインの購入と Cloudflare アカウントの操作はこのリポジトリでは行いません。DNS と Pages の接続は別作業です。

## ローカルで動かす

Node.js 22.12 以上が必要です。このリポジトリは `.node-version` と `.nvmrc` で **22.23.4** を指定しています。

```bash
npm install
npm run dev
```

開発サーバーは http://localhost:4321 です。

## ビルド

```bash
npm install
npm run build
```

| 項目 | 値 |
| --- | --- |
| ビルドコマンド | `npm run build` |
| 出力ディレクトリ | `dist` |
| フレームワーク | Astro（静的出力。サーバー用アダプターは使いません） |

生成物の確認:

```bash
npm run preview
```

クライアント向けの JavaScript フレームワークは載せていません。記事はビルド時に HTML になります。

## Cloudflare Pages

Pages のプロジェクト作成時に、次を指定します。

| 設定 | 値 |
| --- | --- |
| フレームワークプリセット | `Astro` |
| ビルドコマンド | `npm run build` |
| ビルド出力ディレクトリ | `dist` |
| 本番ブランチ | `main` |
| ルートディレクトリ | `/`（リポジトリ直下） |
| Node.js | `22.23.4` |

Node.js のバージョンは、リポジトリ直下の `.node-version` を Pages が読みます。ダッシュボードで上書きする場合は、環境変数 `NODE_VERSION` を `22.23.4` にしてください。古いビルドイメージの初期値（Node.js 18 系）のままでは、Astro 6 の要件（22.12 以上）を満たしません。

サイトのビルドに環境変数や API キーは不要です。ニュースの自動取り込みだけ、任意で `FORTNITE_API_KEY` を使えます。無くても動きます。

ビルド後の応答ヘッダーは `public/_headers`、`www.fncreators.com` から `fncreators.com` への転送は `public/_redirects` にあります。どちらも `dist` にコピーされます。

### カスタムドメイン

本番ドメインは **fncreators.com** です。Pages プロジェクトにカスタムドメインとして追加し、DNS を Pages に向けてください。この作業はダッシュボード側で行います。

`www` も同じプロジェクトに載せる場合、`public/_redirects` が apex へ 301 します。

### 手元から Pages へ出す場合

通常は Git 連携の自動ビルドで足ります。手動で出すときは、ログインした環境で次を実行します。出力先は `wrangler.toml` の `pages_build_output_dir` と同じ `dist` です。

```bash
npm run build
npx wrangler pages deploy
```

## 記事の追加

記事は `content/posts/*.md` です。ファイルを足してビルドすると、トップページに新しい順で載ります。あとから API や自動化でこのフォルダへ Markdown を書き出せます。`src/` は触らなくて構いません。

ファイル名が URL になります。ASCII のケバブケースにしてください。

`content/posts/island-code-first-line.md` → `https://fncreators.com/posts/island-code-first-line/`

```md
---
title: "見出しは短く"
date: "2026-10-24T09:30:00+09:00"
tags:
  - UEFN
summary: "一覧と OGP に出す要約。140字以内。"
cover: "/covers/example.png"
source:
  name: "参照先の名前"
  url: "https://example.com/source"
---

本文。Markdown で書きます。
```

| フィールド | 必須 | 内容 |
| --- | --- | --- |
| `title` | はい | 見出し。記事ページの `h1` と OGP に使います |
| `date` | はい | ISO 8601。日本時間なら `+09:00` を付けます。一覧は新しい順です |
| `tags` | はい | 1つ以上。タグページ `/tags/名前/` ができます |
| `summary` | はい | カード、meta description、OGP の説明。140字以内 |
| `cover` | いいえ | カバー画像。`public/` からのパス（例: `/covers/example.png`）か、`https://` の画像 URL。png / jpg / webp は X の OGP 画像にも使います |
| `notice` | いいえ | `confirmed`（公式ベース）または `rumor`（未確認）。付いた記事だけ、カードと記事の先頭に区分が出ます。無い記事は編集メモです |
| `source` | いいえ | `name` と `url`。記事末尾の出典欄になります |

カバー画像ファイルは `public/covers/` など `public/` の下に置きます。本文中の画像も、同じようにサイトルートからのパスか完全な URL にします。

初期に入っていた5本は、見た目を確認するための編集メモです。区分ラベルは付いていません。ファイルを消せば、その記事は次のビルドで消えます。

`notice: confirmed` は「公式の公開情報をもとにした非公式のまとめ」、`rumor` は「まだ裏が取れていない」です。自動取り込みは、公式の公開フィードから作った記事に `confirmed` を付けます。リーク用の源は入れていません。人が未確認のメモを書くときは `rumor` にします。

## ニュースの自動取り込み

ログイン不要の公開フィードから、`content/posts/*.md` に新しい記事だけを足します。同じ項目は、本文末尾の `<!-- ingest:... -->` と `scripts/ingest/state.json` で一度だけにします。ファイルを消しても state に ID が残っていれば再作成しません。載せ直すときは、その ID を state から消します。

ソースは次の順です。

| 順 | ソース | 何を取るか |
| --- | --- | --- |
| 1 | `https://www.fortnite.com/news.data?lang=ja` と各記事の `.data` | 公式ニュースページの JSON。全文は転載せず、見出しと書き出し、公式の画像 URL |
| 2 | `https://fortnite-api.com/v2/news?language=ja` | ロビー告知。公式の PRM はトークンが要るので使わない。画像 URL は Epic の CDN |
| 3 | `https://fortnite-api.com/v2/shop?language=ja` | その回のショップで「新規」の項目と、コラボ寄りの棚の名前 |
| 4 | `https://status.epicgames.com/api/v2/summary.json` | Fortnite / UEFN 関連が通常以外、または 72 時間以内のメンテナンスのときだけ |

`fortnite.com` は Cloudflare がデータセンター IP を止めることがあります。GitHub Actions でも止まります。その回は公式記事をスキップし、ロビー・ショップ・ステータスは続けます。全部失敗したときだけ、ワークフローは失敗します。

トークンは必須ではありません。`FORTNITE_API_KEY` があれば fortnite-api.com の `Authorization` に載せ、レート制限を緩めるために使います。無い、または 401 のときは、そのキーなしの公開 URL を試します。ショップ画像の多くは fortnite-api.com 上の公式コスメ画像ミラーです。Epic の CDN URL がレスポンスにあれば、そちらを優先します。

直近 30 日（`INGEST_LOOKBACK_DAYS`）より古い公式記事と、古いロビーフィードは捨てます。1 回で足す記事は最大 12 件（`INGEST_MAX_NEW`）です。残りは次の回に回します。

### 手元で実行する

```bash
npm run ingest:check
npm run ingest -- --dry-run
npm run ingest
npm run build
```

`ingest:check` はネットワークを使いません。`ingest` はネットワークを使います。

### GitHub Actions と Cloudflare Pages

ワークフローは `.github/workflows/news-ingest.yml` です。UTC の毎時 15 分と 45 分（約 30 分おき）と、手動の `workflow_dispatch` で動きます。GitHub の schedule は遅れることがあります。

新しい記事があるときだけビルドし、`news/ingest-*` ブランチに commit して **PR を開きます**。`main` へは直接 commit しません。このリポジトリに自動マージの仕組みは無いので、見出しと「公式ベース / 未確認」の区分を人が見てからマージします。

`main` へのマージで、Cloudflare Pages の本番ブランチが再ビルドされます。プレビューを有効にしていれば、マージ前の PR でも確認できます。ビルドコマンドと出力先は上の表のままです（`npm run build` / `dist`）。

Actions の Workflow permissions が「Read and write」でないと、PR 用ブランチを push できません。`FORTNITE_API_KEY` はリポジトリ secret として任意です。

## ページ

- `/` 最新フィード
- `/posts/<slug>/` 記事。OGP と X 共有用の URL 付き
- `/tags/` と `/tags/<タグ>/` タグ
- `/about/` 非公式であることの説明
- `/rss.xml` フィード

フッターと概要ページに「非公式ファンサイト」と明記しています。

## ディレクトリ

```
content/posts/     記事 Markdown
scripts/ingest/    ニュース取り込み
public/            画像、_headers、_redirects、robots.txt
src/pages/         ルート
src/content.config.ts
astro.config.mjs
wrangler.toml      Pages の出力先
.github/workflows/news-ingest.yml
```
