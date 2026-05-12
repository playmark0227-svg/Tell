'use strict';

const state = {
  companies: [],
  classification: null,
  icp: null,
  scored: [],
};

const PRODUCT_CATEGORIES = [
  {
    id: 'attendance',
    name: '勤怠管理SaaS',
    patterns: [/勤怠/, /タイムカード/, /打刻/, /シフト管理/, /労働時間/, /出退勤/],
    icp: {
      industries: ['製造業', '飲食業', '卸売・小売業', '医療・福祉', '運輸業', '宿泊・サービス業', 'サービス業', '建設業', '農林水産業', '教育・学習支援'],
      sizes: ['small', 'mid'],
      pains: ['紙のタイムカード運用', 'シフト作成の煩雑さ', '直行直帰の打刻漏れ', '集計の手間'],
      keywords: ['勤怠', 'タイムカード', 'シフト', '打刻', '集計', 'パート', 'アルバイト', '直行直帰', '労働時間'],
      anti_patterns: [/基幹システム/, /SAP/, /人事システム.*刷新/, /導入済/],
    }
  },
  {
    id: 'accounting',
    name: '経理・会計SaaS',
    patterns: [/経理/, /会計/, /請求書/, /インボイス/, /freee/, /マネーフォワード/, /記帳/, /電子帳簿/],
    icp: {
      industries: ['卸売・小売業', 'サービス業', '建設業', '不動産業', '情報通信業', '飲食業'],
      sizes: ['small', 'mid'],
      pains: ['請求書発行の手間', 'インボイス対応', '電子帳簿保存法対応', '経理担当の負荷'],
      keywords: ['請求', '経理', '会計', 'インボイス', '帳簿', 'Excel'],
      anti_patterns: [/SAP/, /基幹システム/, /会計事務所/],
    }
  },
  {
    id: 'crm_sfa',
    name: 'CRM/SFA（顧客・営業管理）',
    patterns: [/CRM/, /SFA/, /顧客管理/, /営業管理/, /商談管理/, /Salesforce/, /HubSpot/],
    icp: {
      industries: ['情報通信業', '不動産業', '金融・保険業', '製造業', '卸売・小売業', 'サービス業'],
      sizes: ['small', 'mid'],
      pains: ['営業情報のExcel管理', '案件の属人化', '商談状況の不可視'],
      keywords: ['営業', '商談', '顧客', '受託', '代理店'],
      anti_patterns: [/Salesforce.*導入/, /CRM.*導入済/],
    }
  },
  {
    id: 'project_mgmt',
    name: '工数・プロジェクト管理',
    patterns: [/工数/, /プロジェクト管理/, /タスク管理/, /稼働管理/],
    icp: {
      industries: ['情報通信業', 'サービス業'],
      sizes: ['small', 'mid'],
      pains: ['プロジェクト別工数の不可視', 'クライアント別収益管理', '稼働率の把握'],
      keywords: ['工数', 'プロジェクト', '受託', '広告', 'コンサル', 'SIer'],
      anti_patterns: [],
    }
  },
  {
    id: 'recruiting',
    name: '採用・人事SaaS',
    patterns: [/採用/, /求人/, /人事/, /タレントマネジメント/, /HRTech/, /応募者管理/],
    icp: {
      industries: ['情報通信業', '製造業', 'サービス業', '医療・福祉', '建設業', '宿泊・サービス業'],
      sizes: ['mid', 'large'],
      pains: ['採用難', '応募者管理の煩雑', '離職率'],
      keywords: ['採用', '人材', '求人', '人事'],
      anti_patterns: [],
    }
  },
  {
    id: 'marketing',
    name: 'マーケティング・広告ツール',
    patterns: [/マーケティング/, /MA/, /広告運用/, /SEO/, /Web集客/, /メルマガ/],
    icp: {
      industries: ['情報通信業', '卸売・小売業', '不動産業', 'サービス業', '教育・学習支援'],
      sizes: ['small', 'mid'],
      pains: ['Web集客の不足', '見込み顧客の管理', '広告ROIの不可視'],
      keywords: ['Web', '広告', 'マーケティング', 'EC', '通販'],
      anti_patterns: [],
    }
  },
  {
    id: 'security',
    name: 'セキュリティ・IT資産管理',
    patterns: [/セキュリティ/, /EDR/, /ウイルス対策/, /情報漏洩/, /資産管理/, /MDM/],
    icp: {
      industries: ['金融・保険業', '情報通信業', '製造業', '医療・福祉', '建設業', '不動産業'],
      sizes: ['mid', 'large'],
      pains: ['情報漏洩リスク', '端末管理', 'コンプライアンス'],
      keywords: ['セキュリティ', 'コンプライアンス', '個人情報', '機密'],
      anti_patterns: [],
    }
  },
  {
    id: 'telecom',
    name: '通信回線・インターネット',
    patterns: [/通信/, /回線/, /インターネット/, /光回線/, /モバイル/, /IP電話/, /クラウドPBX/],
    icp: {
      industries: ['卸売・小売業', '飲食業', '建設業', 'サービス業', '不動産業', '製造業', '医療・福祉'],
      sizes: ['small', 'mid'],
      pains: ['通信費の高さ', '回線速度', '電話設備の老朽化'],
      keywords: ['店舗', '事業所', '拠点', '本社'],
      anti_patterns: [/データセンター/, /大規模ネットワーク/],
    }
  },
  {
    id: 'oa_equipment',
    name: 'OA機器・複合機',
    patterns: [/複合機/, /コピー機/, /OA機器/, /プリンター/, /スキャナ/],
    icp: {
      industries: ['卸売・小売業', '建設業', '不動産業', 'サービス業', '医療・福祉', '教育・学習支援'],
      sizes: ['small', 'mid'],
      pains: ['印刷コスト', '機器の老朽化', '保守契約'],
      keywords: ['事務所', '本社', '支店'],
      anti_patterns: [],
    }
  },
  {
    id: 'web_production',
    name: 'Webサイト制作・改善',
    patterns: [/ホームページ制作/, /Web制作/, /サイト改善/, /LP制作/, /コーポレートサイト/],
    icp: {
      industries: ['卸売・小売業', '製造業', '飲食業', 'サービス業', '建設業', '不動産業', '医療・福祉'],
      sizes: ['small', 'mid'],
      pains: ['古いHP', 'スマホ未対応', '問い合わせが来ない'],
      keywords: ['店舗', '中小企業', '個人事業'],
      anti_patterns: [/上場/, /大手/],
    }
  },
  {
    id: 'insurance',
    name: '法人保険・金融商品',
    patterns: [/法人保険/, /生命保険/, /損害保険/, /退職金/, /共済/],
    icp: {
      industries: ['製造業', '建設業', '運輸業', '卸売・小売業', '医療・福祉', '不動産業'],
      sizes: ['small', 'mid', 'large'],
      pains: ['事業承継', '退職金準備', '労災対応'],
      keywords: ['事業承継', '退職金', '福利厚生'],
      anti_patterns: [],
    }
  },
  {
    id: 'electricity',
    name: '電力・ガス（新電力）',
    patterns: [/電力/, /新電力/, /電気料金/, /ガス料金/, /省エネ/, /電気代/],
    icp: {
      industries: ['製造業', '卸売・小売業', '飲食業', '宿泊・サービス業', '医療・福祉'],
      sizes: ['small', 'mid', 'large'],
      pains: ['電気代の高騰', '省エネ対応'],
      keywords: ['工場', '店舗', '24時間'],
      anti_patterns: [],
    }
  },
  {
    id: 'consulting',
    name: 'コンサルティング・業務改善',
    patterns: [/コンサル/, /業務改善/, /DX支援/, /補助金/, /助成金/],
    icp: {
      industries: ['製造業', '建設業', '卸売・小売業', 'サービス業', '医療・福祉'],
      sizes: ['small', 'mid'],
      pains: ['DX遅れ', '業務効率化', '補助金活用'],
      keywords: ['DX', '業務改善', '補助金'],
      anti_patterns: [/コンサル.*会社/, /経営コンサル/],
    }
  },
  {
    id: 'food_supply',
    name: '業務用食材・備品',
    patterns: [/業務用食材/, /食材卸/, /厨房/, /おしぼり/, /ユニフォーム/],
    icp: {
      industries: ['飲食業', '宿泊・サービス業', '医療・福祉'],
      sizes: ['small', 'mid'],
      pains: ['仕入コスト', '配送頻度'],
      keywords: ['店舗', 'レストラン', '居酒屋', 'ホテル'],
      anti_patterns: [],
    }
  },
];

function classifyProduct(text) {
  const scores = PRODUCT_CATEGORIES.map(cat => {
    const matchCount = cat.patterns.filter(p => p.test(text)).length;
    return { category: cat, score: matchCount };
  }).filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scores.length === 0) {
    return {
      category: {
        id: 'unknown',
        name: '不明（汎用ICP）',
        icp: {
          industries: ['情報通信業', '製造業', 'サービス業', '卸売・小売業'],
          sizes: ['small', 'mid'],
          pains: ['業務効率化', 'コスト削減'],
          keywords: text.split(/[\s、,。]+/).filter(w => w.length >= 2).slice(0, 5),
          anti_patterns: [],
        }
      },
      confidence: 'low',
      alternatives: [],
    };
  }

  return {
    category: scores[0].category,
    confidence: scores[0].score >= 2 ? 'high' : 'medium',
    alternatives: scores.slice(1, 3).map(s => s.category.name),
  };
}

const WEIGHTS = {
  industry: 25,
  size: 15,
  keyword_each: 8,
  keyword_cap: 30,
  pain: 20,
  anti: -30,
};

function scoreCompany(company, icp) {
  let score = 0;
  const reasons = [];

  if (icp.industries.includes(company.industry)) {
    score += WEIGHTS.industry;
    reasons.push(`業種「${company.industry}」が想定ターゲット`);
  }

  if (icp.sizes.includes(company.size)) {
    score += WEIGHTS.size;
    reasons.push(`規模が想定範囲（${company.employees}名）`);
  }

  const desc = company.description + ' ' + company.keywords.join(' ');
  const matchedKeywords = icp.keywords.filter(kw => desc.includes(kw));
  if (matchedKeywords.length > 0) {
    score += Math.min(matchedKeywords.length * WEIGHTS.keyword_each, WEIGHTS.keyword_cap);
    reasons.push(`関連キーワード: ${matchedKeywords.join('・')}`);
  }

  const matchedPains = icp.pains.filter(pain => {
    const tokens = pain.split(/[のがでに、]/).filter(t => t.length >= 2);
    return tokens.some(t => desc.includes(t));
  });
  if (matchedPains.length > 0) {
    score += WEIGHTS.pain;
    reasons.push('想定課題に合致');
  }

  const antiHit = (icp.anti_patterns || []).some(p => p.test(company.description));
  if (antiHit) {
    score += WEIGHTS.anti;
    reasons.push('競合・既存導入の兆候あり（減点）');
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

function renderClassification(classification) {
  const section = document.getElementById('classification-section');
  const display = document.getElementById('classification-display');
  const confLabel = { high: '高', medium: '中', low: '低' }[classification.confidence];
  const confClass = classification.confidence;
  display.innerHTML = `
    <div class="classification-main">
      <div class="label">判別された商材カテゴリ</div>
      <div class="category-name">${classification.category.name}</div>
      <span class="confidence ${confClass}">確度: ${confLabel}</span>
    </div>
    ${classification.alternatives.length > 0 ? `
      <div class="classification-alt">
        <span class="label">他の候補:</span> ${classification.alternatives.join('、')}
      </div>
    ` : ''}
  `;
  section.hidden = false;
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
  const industrySel = document.getElementById('filter-industry');
  const prefSel = document.getElementById('filter-prefecture');
  if (industrySel.options.length > 1) return;
  const industries = [...new Set(state.companies.map(c => c.industry))].sort();
  const prefectures = [...new Set(state.companies.map(c => c.prefecture))].sort();
  industrySel.insertAdjacentHTML('beforeend',
    industries.map(i => `<option value="${i}">${i}</option>`).join(''));
  prefSel.insertAdjacentHTML('beforeend',
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

function runPipeline(input) {
  state.classification = classifyProduct(input);
  state.icp = state.classification.category.icp;
  state.scored = state.companies
    .map(c => scoreCompany(c, state.icp))
    .sort((a, b) => b.score - a.score);
  renderClassification(state.classification);
  renderICP(state.icp);
  renderFilters();
  renderResults();
}

async function init() {
  try {
    const res = await fetch('data/companies.json');
    state.companies = await res.json();
  } catch (e) {
    console.error('データ読み込み失敗:', e);
    return;
  }

  document.getElementById('analyze-btn').addEventListener('click', () => {
    const input = document.getElementById('product-input').value.trim();
    if (!input) {
      alert('商材を入力してください');
      return;
    }
    runPipeline(input);
  });

  document.querySelectorAll('.sample-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = btn.dataset.sample;
      document.getElementById('product-input').value = text;
      runPipeline(text);
    });
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
