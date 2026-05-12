'use strict';

const state = {
  companies: [],
  icp: null,
  scored: [],
};

const KEYWORD_WEIGHTS = {
  industry: 25,
  size: 15,
  keyword: 10,
  pain: 20,
};

const PRESET_ICP_RULES = [
  {
    match: /(勤怠|タイムカード|打刻|シフト)/,
    industries: ['製造業', '飲食業', '卸売・小売業', '医療・福祉', '運輸業', '宿泊・サービス業', 'サービス業'],
    sizes: ['small', 'mid'],
    pains: ['紙のタイムカード運用', 'シフト作成の煩雑さ', '直行直帰の打刻漏れ', '集計の手間'],
    keywords: ['勤怠', 'タイムカード', 'シフト', '打刻', '集計', 'パート', 'アルバイト'],
  },
  {
    match: /(工数|プロジェクト管理|タスク)/,
    industries: ['情報通信業', 'サービス業'],
    sizes: ['small', 'mid'],
    pains: ['プロジェクト別工数の不可視化', 'クライアント別収益管理'],
    keywords: ['工数', 'プロジェクト', '受託', '広告'],
  },
  {
    match: /(請求|経理|会計|インボイス)/,
    industries: ['卸売・小売業', 'サービス業', '建設業', '不動産業'],
    sizes: ['small', 'mid'],
    pains: ['請求書発行の手間', 'インボイス対応'],
    keywords: ['請求', '経理', '会計', 'インボイス'],
  },
];

function generateICP(productText) {
  const matched = PRESET_ICP_RULES.find(r => r.match.test(productText));
  if (matched) {
    return {
      product: productText,
      industries: matched.industries,
      sizes: matched.sizes,
      pains: matched.pains,
      keywords: matched.keywords,
    };
  }
  return {
    product: productText,
    industries: ['情報通信業', '製造業', 'サービス業'],
    sizes: ['small', 'mid'],
    pains: ['業務効率化', 'コスト削減'],
    keywords: productText.split(/[\s、,。]+/).filter(w => w.length >= 2).slice(0, 5),
  };
}

function scoreCompany(company, icp) {
  let score = 0;
  const reasons = [];

  if (icp.industries.includes(company.industry)) {
    score += KEYWORD_WEIGHTS.industry;
    reasons.push(`業種「${company.industry}」がターゲット`);
  }

  if (icp.sizes.includes(company.size)) {
    score += KEYWORD_WEIGHTS.size;
    reasons.push(`規模が想定範囲（${company.employees}名）`);
  }

  const desc = company.description + ' ' + company.keywords.join(' ');
  const matchedKeywords = icp.keywords.filter(kw => desc.includes(kw));
  if (matchedKeywords.length > 0) {
    score += Math.min(matchedKeywords.length * KEYWORD_WEIGHTS.keyword, 30);
    reasons.push(`関連キーワード一致: ${matchedKeywords.join('・')}`);
  }

  const matchedPains = icp.pains.filter(pain => {
    const tokens = pain.split(/[のがでに、]/).filter(t => t.length >= 2);
    return tokens.some(t => desc.includes(t));
  });
  if (matchedPains.length > 0) {
    score += KEYWORD_WEIGHTS.pain;
    reasons.push(`想定課題に合致`);
  }

  if (/導入済|刷新済|SAP|基幹システム/.test(company.description)) {
    score -= 30;
    reasons.push('競合・既存システムあり（減点）');
  }

  return {
    ...company,
    score: Math.max(0, Math.min(100, score)),
    reasoning: reasons.join(' / ') || '明確な根拠なし',
  };
}

function scoreClass(score) {
  if (score >= 70) return 'good';
  if (score >= 40) return 'mid';
  return 'low';
}

function renderICP(icp) {
  const section = document.getElementById('icp-section');
  const display = document.getElementById('icp-display');
  display.innerHTML = `
    <div class="icp-card">
      <div class="label">想定業種</div>
      <div>${icp.industries.join('・')}</div>
    </div>
    <div class="icp-card">
      <div class="label">想定規模</div>
      <div>${icp.sizes.map(s => ({small: '〜50名', mid: '51〜300名', large: '301名〜'}[s])).join('・')}</div>
    </div>
    <div class="icp-card">
      <div class="label">想定課題</div>
      <div>${icp.pains.join('、')}</div>
    </div>
    <div class="icp-card">
      <div class="label">マッチング・キーワード</div>
      <div>${icp.keywords.join('、')}</div>
    </div>
  `;
  section.hidden = false;
}

function renderFilters() {
  const industries = [...new Set(state.companies.map(c => c.industry))].sort();
  const prefectures = [...new Set(state.companies.map(c => c.prefecture))].sort();
  document.getElementById('filter-industry').insertAdjacentHTML('beforeend',
    industries.map(i => `<option value="${i}">${i}</option>`).join(''));
  document.getElementById('filter-prefecture').insertAdjacentHTML('beforeend',
    prefectures.map(p => `<option value="${p}">${p}</option>`).join(''));
  document.getElementById('filter-section').hidden = false;
}

function applyFilters() {
  const industry = document.getElementById('filter-industry').value;
  const prefecture = document.getElementById('filter-prefecture').value;
  const size = document.getElementById('filter-size').value;
  const minScore = parseInt(document.getElementById('filter-score').value, 10);

  return state.scored
    .filter(c => !industry || c.industry === industry)
    .filter(c => !prefecture || c.prefecture === prefecture)
    .filter(c => !size || c.size === size)
    .filter(c => c.score >= minScore);
}

function renderResults() {
  const filtered = applyFilters();
  const tbody = document.querySelector('#results-table tbody');
  tbody.innerHTML = filtered.map(c => `
    <tr>
      <td><span class="score ${scoreClass(c.score)}">${c.score}</span></td>
      <td>${c.name}</td>
      <td>${c.industry}</td>
      <td>${c.prefecture}</td>
      <td>${c.employees}名</td>
      <td class="phone">${c.phone}</td>
      <td class="reasoning">${c.reasoning}</td>
    </tr>
  `).join('');
  document.getElementById('result-count').textContent = `（${filtered.length}件）`;
  document.getElementById('results-section').hidden = false;
}

async function init() {
  try {
    const res = await fetch('data/companies.json');
    state.companies = await res.json();
  } catch (e) {
    console.error('データ読み込み失敗:', e);
    return;
  }

  document.getElementById('generate-icp').addEventListener('click', () => {
    const input = document.getElementById('product-input').value.trim();
    if (!input) {
      alert('商材を入力してください');
      return;
    }
    state.icp = generateICP(input);
    state.scored = state.companies
      .map(c => scoreCompany(c, state.icp))
      .sort((a, b) => b.score - a.score);
    renderICP(state.icp);
    renderFilters();
    renderResults();
  });

  ['filter-industry', 'filter-prefecture', 'filter-size'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderResults);
  });
  const scoreSlider = document.getElementById('filter-score');
  scoreSlider.addEventListener('input', e => {
    document.getElementById('filter-score-value').textContent = e.target.value;
    renderResults();
  });
}

init();
