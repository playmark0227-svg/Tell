/**
 * tell partner - Brave Search + HPフェッチ + LLM チャット プロキシ v3
 *
 * エンドポイント:
 *   GET  /search?q=...         → Brave Search API へプロキシ
 *   GET  /fetch?url=...        → 任意のHPを取得（CORS回避用）
 *   POST /llm/chat             → LLMチャット(Anthropic優先、Workers AIフォールバック)
 *
 * 環境変数(Secret):
 *   BRAVE_API_KEY       Braveで発行したAPIキー(検索用)
 *   ANTHROPIC_API_KEY   Anthropicで発行したAPIキー(LLM用・有料)
 *   ALLOWED_ORIGIN      許可するオリジン
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

    // LLM chat
    if (url.pathname === '/llm/chat' && request.method === 'POST') {
      let body;
      try { body = await request.json(); }
      catch { return new Response('Invalid JSON', { status: 400, headers: corsHeaders }); }

      // 優先: Anthropic
      if (env.ANTHROPIC_API_KEY) {
        try {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': env.ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: body.model || 'claude-haiku-4-5-20251001',
              max_tokens: body.max_tokens || 1024,
              system: body.system,
              messages: body.messages,
            }),
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

    return new Response('Not found. Use /search /fetch /llm/chat', {
      status: 404,
      headers: corsHeaders,
    });
  },
};
