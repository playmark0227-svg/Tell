# Tell - B2B営業リスト適合度スコアリング（デモ）

商材を入力するとAIが理想顧客プロファイル（ICP）を生成し、公開法人データから適合度順に並べ替えるツールのフロントエンドデモです。

## デモを見る

公開URL：**https://playmark0227-svg.github.io/Tell/**

### 初回セットアップ（リポジトリオーナーが1回だけ実施）

1. GitHubで `playmark0227-svg/Tell` を開く
2. **Settings → Pages** に移動
3. **Source** を `GitHub Actions` に変更（`Deploy from a branch` ではなく）
4. 保存後、`claude/docomo-phone-list-0fW8S` または `main` への push で自動デプロイ
5. **Actions** タブでデプロイ進行を確認できます（約1-2分）

`.github/workflows/pages.yml` がpushを検知して自動公開します。

## 重要な注意（法令遵守）

このツールが対象とするのは**法人の公開連絡先のみ**です。以下を厳守してください：

- **個人宅・個人携帯は対象外**
- **特定商取引法**：事業者名・勧誘目的の明示、再勧誘禁止
- **個人情報保護法**：担当者個人名と紐づく情報は個人情報として扱う
- **不正競争防止法・各サイト利用規約**：robots.txt遵守、スクレイピング禁止サイトを避ける
- **業務妨害防止**：1ドメインあたり1リクエスト/秒以下のレート制限
- **DNCリスト**：架電拒否番号を必ず除外してから架電

## デモの仕組み

クライアント側だけで動作する簡易版：

1. `data/companies.json` のサンプル企業データ（すべて架空）を読み込み
2. 商材テキストから簡易ルールでICPを生成
3. 業種・規模・キーワード・想定課題の一致度でスコアリング
4. 適合度順に表示、フィルタで絞り込み

## AIモード（Claude API、BYOK）

サイドバーの「🤖 AI設定」から：

1. **Anthropic APIキー**を入力（[console.anthropic.com](https://console.anthropic.com/) で取得）
2. **AIモードを使用**にチェック
3. **接続テスト**で疎通確認
4. 以降の「商材分析」と「架電スクリプト生成」でClaude APIを使用

APIキーは**あなたのブラウザのlocalStorageにのみ保存**され、`api.anthropic.com` 以外には送信されません。共有端末では使わないでください。

モデル選択：
- **Haiku 4.5**：速い・安価（推奨）
- **Sonnet 4.6**：バランス
- **Opus 4.7**：高精度・高価

## 🔍 Google CSE で商材から会社を自動発見（無料枠で運用可）

商材を入れて GitHub Actions を回すと、**Google検索 → 企業HP特定 → 電話・問い合わせURL抽出**まで自動でやります。

### Google CSE の料金（無料枠で十分）

- **無料: 1日100クエリ**まで
- 有料: $5 / 1000クエリ（超過分のみ）
- クレジットカード登録なしでも無料枠は使えます

商材5個 × 5クエリ = 25クエリ/回 なら、週1実行で 100クエリ/月。**完全無料**で運用可能。

### セットアップ（10〜15分、ブラウザだけで完結）

#### 1. Google Custom Search Engine を作成

1. https://programmablesearchengine.google.com/ にアクセス（Googleアカウントが必要）
2. 「新しい検索エンジンを追加」をクリック
3. 「**ウェブ全体を検索**」を選択
4. 名前を「tell-partner」など適当に入力 → 作成
5. 作成後、「**検索エンジンID**」（`cx=...` の値）をメモ

#### 2. Google Cloud で Custom Search API を有効化

1. https://console.cloud.google.com/ にアクセス
2. プロジェクトを作成（無料、クレカ不要）
3. 「APIとサービス」 → 「ライブラリ」 → **Custom Search API** を検索 → 有効にする
4. 「APIとサービス」 → 「認証情報」 → 「**+ 認証情報を作成**」 → **APIキー**
5. APIキーをコピー

#### 3. GitHub の Secrets に登録

1. リポジトリ → **Settings → Secrets and variables → Actions**
2. 「**New repository secret**」で2つ追加：
   - `GOOGLE_CSE_API_KEY` = Cloud Console で発行したAPIキー
   - `GOOGLE_CSE_ID` = Programmable Search Engine の検索エンジンID（cx）
3. 任意で `ANTHROPIC_API_KEY` も登録（クエリ生成の精度向上、無くても動く）

#### 4. intents.json を作成

リポジトリ上で `scripts/intents.json` を新規作成。`scripts/intents.example.json` をコピー編集が早い：

```json
{
  "products": [
    {
      "name": "ウォーターサーバー",
      "description": "オフィス向け、月額制、福利厚生・来客対応",
      "target": {
        "industries": ["情報通信業", "サービス業"],
        "prefectures": ["東京都"],
        "sizes": ["small", "mid"]
      },
      "max_queries": 5,
      "max_results_per_query": 10
    }
  ]
}
```

#### 5. ワークフロー実行

1. **Actions** タブ → 「**Discover Companies (Google CSE)**」を選択
2. 右上「**Run workflow**」をクリック → ブランチ指定して実行
3. 5〜10分待つ
4. 完了すると `data/companies.json` が自動更新され、Pagesも再デプロイ
5. サイトをリロードすると発見企業が反映されています

### 動作する流れ

```
intents.json (商材ターゲット)
    ↓
Google CSE API でクエリ実行（各商材5クエリ程度）
    ↓
ヒットしたHPのURLを取得（ノイズドメイン除外）
    ↓
各HPを巡回（robots.txt遵守、1ドメイン1.2秒待機）
    ↓
title・meta・電話番号・問い合わせURLを抽出
    ↓
data/companies.json に書き込み（既存と重複排除でマージ）
    ↓
GitHub Pagesが自動再デプロイ
```

### 自動実行

`.github/workflows/discover.yml` は **月曜04:00 JST** に自動実行されるよう設定済み。最初に1回手動実行すれば、以降は週次で動き続けます。

### ノイズ除外

新聞社、リクナビ・マイナビ、楽天市場、Amazon、食べログ、Wikipedia、Twitter/X、PR TIMES等は自動的に検索結果から除外します（個別企業のHPだけを集めるため）。

---

## 個別シードからのスクレイピング（手元の企業リストの補完）

既知の会社リストから電話・問い合わせURLだけを補強したい場合は `scripts/enrich.py` が使えます。

### 仕組み

1. `scripts/seeds.json` に対象企業のシード（会社名 + 既知の website URL）を記述
2. `scripts/enrich.py` が各企業のHPを巡回し、電話番号・問い合わせURLを抽出
3. `data/companies.json` を更新
4. `.github/workflows/enrich.yml` が**週次（月曜 03:00 JST）**に自動実行

### ローカル実行

```bash
cp scripts/seeds.example.json scripts/seeds.json
# scripts/seeds.json を編集して対象企業を追加
python scripts/enrich.py
```

### 遵守事項

- **robots.txt遵守**：`urllib.robotparser` で都度確認
- **1ドメインあたり1.2秒以上のディレイ**
- **公開HPの公開情報のみ**：個人宅・個人情報は対象外
- **User-Agent明示**：`tell-partner-bot/0.1`

## 本番化する場合の構成

```
[収集層] → [構造化層] → [マッチング層] → [クエリ層（GitHub Pages）]
```

### 収集層（GitHub Actions / Cloud Run）
- 国税庁法人番号API（無料・商用可）でシード取得
- Google Custom Search APIで公式HPを発見
- Playwrightで `/company` `/about` `/contact` を巡回
- robots.txt遵守、1ドメイン1req/sec以下

### 構造化層
- Claude APIでHTMLから電話番号・事業内容・規模を抽出
- 事業内容を埋め込みベクトル化（OpenAI / Voyage）
- PostgreSQL + pgvectorに格納

### マッチング層
- 商材入力 → Claude APIでICP生成（業種・規模・課題・キーワード）
- 埋め込み類似度＋ルールベース加点でスコアリング

### クエリ層
- バックエンドからJSONをエクスポート → GitHub Pagesで配信
- もしくはバックエンドAPI（FastAPI on Cloud Run）にクエリ
- 自然言語クエリはClaude経由のText-to-SQL

## ファイル構成

```
.
├── index.html              UI
├── style.css               スタイル
├── app.js                  スコアリング・フィルタロジック
├── data/companies.json     サンプル企業データ（架空）
├── .nojekyll               GitHub PagesでJekyll処理をスキップ
└── README.md
```

## ローカルで動かす

```bash
python3 -m http.server 8000
# → http://localhost:8000
```
