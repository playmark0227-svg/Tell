# tell partner

B2B営業向けの「商材入力 → AIで適合企業を発見 → 適合度スコアリング」ツール。GitHub Pages + Cloudflare Worker で動作。

## デモ

**https://playmark0227-svg.github.io/Tell/**

## 機能

- 🤖 AIによる商材分析と理想顧客プロファイル(ICP)の生成
- 🌐 Brave Search APIで実在企業のHPをウェブ検索・自動発見
- 📊 HP内容を実際にAIで読み込んで購入適合度を0-100でスコアリング
- 💬 LINEメッセージ等の自然文から絞り込み条件をAI抽出
- ⭐ 保存/DNC/架電履歴/フォロー予定/商材プロファイルなどCRM機能
- 📤 CSV/JSON エクスポート

## アーキテクチャ

```
[GitHub Pages 静的サイト]
  ├ index.html / app.js / style.css
  ├ data/companies.json (初期空)
  └ data/sample.json (動作確認用60社)
       │
       ↓ ブラウザから直接呼び出し
[Cloudflare Worker プロキシ]   ← worker/brave-proxy.js
  ├ /search → Brave Search API
  ├ /fetch  → 任意HP取得(CORS回避)
  └ /llm/chat → Anthropic優先・Workers AIフォールバック
```

ブラウザは API キーを直接持たず、Worker 経由で全API呼び出し。Brave/Anthropic キーはWorkerのSecretsに保存。

## セットアップ手順

### 1. Brave Search API（必須・無料）
1. https://api.search.brave.com/ で「Search」プランに登録($5/月クレジット無料分付き)
2. APIキー発行

### 2. Cloudflare Worker（必須・無料枠で十分）
1. https://dash.cloudflare.com/ で無料アカウント作成
2. Workers & Pages → Create → Hello World
3. `worker/brave-proxy.js` の中身を貼り付けて Deploy
4. Settings → Variables and Secrets:
   - `BRAVE_API_KEY` (Secret): Braveで発行したキー
   - `ANTHROPIC_API_KEY` (Secret, 推奨): https://console.anthropic.com/ で取得
   - `ALLOWED_ORIGIN` (Text): `https://playmark0227-svg.github.io`
5. Settings → Bindings → Add → Workers AI / Variable name: `AI` (Anthropic未設定時のフォールバック用)
6. Worker URL をコピー(例: `https://tell-brave-proxy.xxx.workers.dev`)

### 3. tell partnerに接続
1. サイドバー「🌐 ウェブ検索(Brave)」を開く
2. Worker URL を貼り付け
3. 「接続テスト」で確認

## 使い方

1. 商材を入力(または「🤖 AIと対話して商材を設定」で深掘り)
2. ターゲット絞り込みを設定(LINEメッセージ貼付で自動抽出も可)
3. 「🌐 ウェブから企業を発見して分析」をクリック
4. AIが200件まで候補をウェブ検索 → HPを実際に訪問 → 法人か検証 → 適合度スコアリング
5. 「もっと探す」でラウンド追加検索
6. 行のボタンで 保存/DNC/架電/HP/問い合わせ/メモ/スクリプト生成

## データ取り込み

サイドバー「📥 データ取込」:
- CSV/JSON 一括取込(列名 `name,phone,industry,prefecture,city,size,employees,website,description`)
- サンプル60社の読込
- 全削除

## ローカル開発

```bash
python3 -m http.server 8000
# http://localhost:8000
```

## ファイル構成

```
.
├── index.html              UI
├── style.css               スタイル
├── app.js                  アプリ本体
├── data/
│   ├── companies.json      起動時に読み込む企業データ(初期は空)
│   └── sample.json         動作確認用サンプル60社
├── worker/
│   └── brave-proxy.js      Cloudflare Worker(コピペ用)
└── .github/workflows/
    └── pages.yml           GitHub Pages 自動デプロイ
```

## 法令遵守

- 収集対象は法人の公開連絡先のみ(個人宅・個人携帯は対象外)
- 特定商取引法: 事業者名・勧誘目的の明示、再勧誘禁止
- 個人情報保護法: 担当者個人名と紐づく情報は個人情報として扱う
- 架電拒否(DNC)リストを必ず除外してから架電
