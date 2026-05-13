/**
 * tell partner - Brave Search API プロキシ用 Cloudflare Worker
 *
 * デプロイ手順:
 *  1. https://dash.cloudflare.com/ にログイン (無料アカウントでOK)
 *  2. 左メニュー「Workers & Pages」→「Create」→「Create Worker」
 *  3. 名前を「tell-brave-proxy」など適当に → Deploy
 *  4. デプロイ後、「Edit code」をクリック
 *  5. このファイルの内容を全部コピーして貼り付け、「Save and deploy」
 *  6. Worker詳細 → Settings → Variables and Secrets
 *      → Type: Secret, Name: BRAVE_API_KEY, Value: Braveで発行したキー → Save
 *      → Type: Secret, Name: ALLOWED_ORIGIN, Value: https://playmark0227-svg.github.io
 *  7. Worker URL（例: https://tell-brave-proxy.<your-name>.workers.dev）をコピー
 *  8. tell partner サイト → サイドバー「🌐 ウェブ検索」 → プロキシURL欄に貼り付け
 *
 * 料金: Cloudflare Workers 無料枠 = 100,000 req/day。圧倒的に十分。
 * セキュリティ: APIキーはWorkerの環境変数にあり、ブラウザに渡らない。
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowedOrigin = env.ALLOWED_ORIGIN || '*';
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (url.pathname !== '/search') {
      return new Response('Not found. Use /search?q=...', { status: 404, headers: corsHeaders });
    }

    if (!env.BRAVE_API_KEY) {
      return new Response(JSON.stringify({ error: 'BRAVE_API_KEY not configured in Worker' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const params = new URLSearchParams(url.searchParams);
    const target = `https://api.search.brave.com/res/v1/web/search?${params}`;

    try {
      const braveRes = await fetch(target, {
        headers: {
          'X-Subscription-Token': env.BRAVE_API_KEY,
          'Accept': 'application/json',
        },
        cf: { cacheTtl: 60, cacheEverything: true },
      });
      const body = await braveRes.text();
      return new Response(body, {
        status: braveRes.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },
};
