/**
 * tell partner - Brave Search & HPフェッチ プロキシ用 Cloudflare Worker v2
 *
 * エンドポイント:
 *   GET /search?q=...  → Brave Search API へプロキシ
 *   GET /fetch?url=... → 任意のHPを取得（CORS回避用）
 *
 * Cloudflare Worker環境変数:
 *   BRAVE_API_KEY  (Secret) Braveで発行したAPIキー
 *   ALLOWED_ORIGIN (Text)   許可するオリジン(例: https://playmark0227-svg.github.io)
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

    if (url.pathname === '/fetch') {
      const target = url.searchParams.get('url');
      if (!target) {
        return new Response('Missing url param', { status: 400, headers: corsHeaders });
      }
      let parsed;
      try {
        parsed = new URL(target);
        if (!/^https?:$/.test(parsed.protocol)) throw new Error('not http(s)');
      } catch (e) {
        return new Response('Invalid URL', { status: 400, headers: corsHeaders });
      }
      try {
        const res = await fetch(target, {
          headers: {
            'User-Agent': 'tell-partner-bot/1.0 (+https://github.com/playmark0227-svg/Tell)',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'ja,en;q=0.8',
          },
          cf: { cacheTtl: 600, cacheEverything: true },
          redirect: 'follow',
        });
        // size limit: 500KB
        const reader = res.body.getReader();
        const chunks = [];
        let total = 0;
        const MAX = 500000;
        while (total < MAX) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          total += value.length;
        }
        const combined = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          combined.set(c.slice(0, Math.min(c.length, MAX - offset)), offset);
          offset += c.length;
        }
        return new Response(combined, {
          status: res.status,
          headers: {
            'Content-Type': res.headers.get('Content-Type') || 'text/html; charset=utf-8',
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

    return new Response('Not found. Use /search?q=... or /fetch?url=...', {
      status: 404,
      headers: corsHeaders,
    });
  },
};
