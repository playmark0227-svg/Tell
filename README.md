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
