/**
 * tell partner - Brave Search + HPフェッチ + LLM チャット + 国税庁法人番号API プロキシ v4
 *
 * エンドポイント:
 *   GET  /search?q=...         → Brave Search API へプロキシ
 *   GET  /fetch?url=...        → 任意のHPを取得（CORS回避用）
 *   POST /llm/chat             → LLMチャット(Anthropic優先、Workers AIフォールバック)
 *                                 extended thinking 対応(thinking: {type:"enabled", budget_tokens:N})
 *   GET  /houjin-bangou?name=... → 国税庁法人番号 Web-API プロキシ
 *                                 公式の法人実在性確認 + 公式所在地取得
 *
 * 環境変数(Secret):
 *   BRAVE_API_KEY            Brave Search APIキー
 *   ANTHROPIC_API_KEY        Anthropic APIキー(extended thinking可)
 *   HOUJIN_BANGOU_APP_ID     国税庁 Web-API のアプリケーションID(無料で取得可)
 *                            https://www.houjin-bangou.nta.go.jp/webapi/
 *   ALLOWED_ORIGIN           CORS許可オリジン
 *
 * AI Binding(無料・任意):
 *   AI binding を Worker Settings → AI Bindings で追加すると、Workers AI を
 *   Anthropicフォールバックとして利用可能。
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowedOrigin = env.ALLOWED_ORIGIN || '*';
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Brave Search
    if (url.pathname === '/search') {
      if (!env.BRAVE_API_KEY) {
        return new Response(JSON.stringify({ error: 'BRAVE_API_KEY not configured' }), {
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
    }

    // HP fetch
    if (url.pathname === '/fetch') {
      const target = url.searchParams.get('url');
      if (!target) {
        return new Response('Missing url param', { status: 400, headers: corsHeaders });
      }
      try {
        new URL(target);
      } catch {
        return new Response('Invalid URL', { status: 400, headers: corsHeaders });
      }
      try {
        const res = await fetch(target, {
          headers: {
            'User-Agent': 'tell-partner-bot/1.0',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'ja,en;q=0.8',
          },
          cf: { cacheTtl: 600, cacheEverything: true },
          redirect: 'follow',
        });
        const html = await res.text();
        return new Response(html.slice(0, 500000), {
          status: res.status,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            ...corsHeaders,
          },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // 国税庁 法人番号 Web-API (公式)
    // 法人名 → 登記情報(法人番号/正式名称/本店所在地)を引く
    // https://www.houjin-bangou.nta.go.jp/webapi/
    if (url.pathname === '/houjin-bangou') {
      if (!env.HOUJIN_BANGOU_APP_ID) {
        return new Response(JSON.stringify({ error: 'HOUJIN_BANGOU_APP_ID not configured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      const name = url.searchParams.get('name');
      const number = url.searchParams.get('number');
      try {
        let target;
        if (number) {
          target = `https://api.houjin-bangou.nta.go.jp/4/num?id=${env.HOUJIN_BANGOU_APP_ID}&number=${encodeURIComponent(number)}&type=12`;
        } else if (name) {
          // 部分一致検索, JSON形式
          target = `https://api.houjin-bangou.nta.go.jp/4/name?id=${env.HOUJIN_BANGOU_APP_ID}&name=${encodeURIComponent(name)}&type=12&mode=2`;
        } else {
          return new Response(JSON.stringify({ error: 'name or number param required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        const res = await fetch(target, {
          headers: { 'Accept': 'application/json' },
          cf: { cacheTtl: 3600, cacheEverything: true },
        });
        const body = await res.text();
        return new Response(body, {
          status: res.status,
          headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // LLM chat
    if (url.pathname === '/llm/chat' && request.method === 'POST') {
      let body;
      try { body = await request.json(); }
      catch { return new Response('Invalid JSON', { status: 400, headers: corsHeaders }); }

      // 優先: Anthropic
      if (env.ANTHROPIC_API_KEY) {
        try {
          // extended thinking 対応: body に thinking: {type:"enabled", budget_tokens:N} があれば
          // anthropic-beta ヘッダを付与
          const headers = {
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          };
          const requestBody = {
            model: body.model || 'claude-haiku-4-5-20251001',
            max_tokens: body.max_tokens || 1024,
            system: body.system,
            messages: body.messages,
          };
          if (body.thinking) {
            requestBody.thinking = body.thinking;
          }
          if (body.temperature !== undefined) requestBody.temperature = body.temperature;
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
          });
          return new Response(await res.text(), {
            status: res.status,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        } catch (e) {
          // フォールバックへ
        }
      }

      // フォールバック: Cloudflare Workers AI(無料)
      if (env.AI) {
        try {
          const messages = [];
          if (body.system) messages.push({ role: 'system', content: body.system });
          messages.push(...(body.messages || []));
          const result = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
            messages,
            max_tokens: body.max_tokens || 1024,
          });
          const text = result.response || result.result || '';
          return new Response(JSON.stringify({
            content: [{ type: 'text', text }],
            model: 'llama-3.3-70b-cloudflare',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        } catch (e) {
          return new Response(JSON.stringify({
            error: `Workers AI error: ${e.message}`
          }), { status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
      }

      return new Response(JSON.stringify({
        error: 'LLMが設定されていません。WorkerにANTHROPIC_API_KEYのSecretを追加するか、AI Bindingを有効化してください'
      }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    return new Response('Not found. Use /search /fetch /llm/chat /houjin-bangou', {
      status: 404,
      headers: corsHeaders,
    });
  },
};
