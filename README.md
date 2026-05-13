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

## スクレイピング基盤（GitHub Actions）

実在企業のデータを収集する Python スクリプトと GitHub Actions ワークフローが入っています。

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
