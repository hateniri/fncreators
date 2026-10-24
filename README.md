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

環境変数や API キーは不要です。

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
| `source` | いいえ | `name` と `url`。記事末尾の出典欄になります |

カバー画像ファイルは `public/covers/` など `public/` の下に置きます。本文中の画像も、同じようにサイトルートからのパスか完全な URL にします。

いま入っている5本は、見た目と自動化の形を確認するためのサンプルです。本番の投稿に差し替えて構いません。ファイルを消せば、その記事は次のビルドで消えます。

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
public/            画像、_headers、_redirects、robots.txt
src/pages/         ルート
src/content.config.ts
astro.config.mjs
wrangler.toml      Pages の出力先
```
