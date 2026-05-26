'use strict';

window.addEventListener('error', e => {
  console.error('Global error:', e.error || e.message);
  if (e.error?.stack) console.error(e.error.stack);
});
window.addEventListener('unhandledrejection', e => {
  console.error('Unhandled promise rejection:', e.reason);
  if (e.reason?.stack) console.error(e.reason.stack);
});

const state = {
  companies: [],
  classification: null,
  icp: null,
  strategy: null,
  intentSignals: [],
  scored: [],
  discoveryRound: 0,
  view: 'all', // all | with_phone | without_phone | saved
  continuousSearch: false,
};

function getCompanyUrls(c) {
  const website = c.website || `https://example.com/c/${c.id}`;
  return {
    website,
    contact: c.contact_url || `${website.replace(/\/$/, '')}/contact`,
  };
}

function hasPhone(c) {
  return c.phone && !/^\(?未登録/.test(c.phone) && c.phone.trim() !== '';
}

function normalizePhone(p) {
  if (!p) return '';
  return String(p).replace(/[^\d+]/g, '');
}

function dedupKey(c) {
  const phone = normalizePhone(c.phone);
  if (phone && phone.length >= 9) return `p:${phone}`;
  return `n:${(c.name||'').trim()}|${(c.prefecture||'').trim()}|${(c.city||'').trim()}`;
}

function dedupCompanies(rows, existingKeys = new Set()) {
  const seen = new Set(existingKeys);
  const out = [];
  let dupes = 0;
  for (const r of rows) {
    const k = dedupKey(r);
    if (seen.has(k)) { dupes++; continue; }
    seen.add(k);
    out.push(r);
  }
  return { kept: out, dupes };
}

/* ============ CSV ============ */
function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

const HEADER_ALIASES = {
  name: ['name', '会社名', '法人名', '企業名', '商号', 'company'],
  phone: ['phone', '電話', '電話番号', 'tel', '代表電話'],
  industry: ['industry', '業種', '業界'],
  prefecture: ['prefecture', '都道府県', '県'],
  city: ['city', '市区町村', '市'],
  size: ['size', '規模'],
  employees: ['employees', '従業員数', '従業員', '社員数', '人数'],
  website: ['website', 'hp', 'url', 'ホームページ', 'ウェブサイト'],
  contact_url: ['contact_url', 'お問い合わせURL', '問い合わせ'],
  description: ['description', '事業内容', '説明', 'メモ'],
};

function detectColumns(headers) {
  const map = {};
  const lower = headers.map(h => (h || '').toLowerCase());
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = lower.findIndex(h => aliases.some(a => h === a.toLowerCase()));
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length === 0) return [];
  const headers = parseCSVLine(lines[0]);
  const colMap = detectColumns(headers);
  if (!('name' in colMap)) {
    throw new Error('CSVに「会社名」「name」等の列が見つかりません');
  }
  const sizeFromEmp = e => e >= 301 ? 'large' : e >= 51 ? 'mid' : 'small';
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    const get = key => key in colMap ? (fields[colMap[key]] || '').trim() : '';
    const name = get('name');
    if (!name) continue;
    const employees = parseInt(get('employees'), 10) || 30;
    rows.push({
      id: 200000 + i,
      name,
      phone: get('phone'),
      industry: get('industry') || 'サービス業',
      prefecture: get('prefecture'),
      city: get('city'),
      size: get('size') || sizeFromEmp(employees),
      employees,
      website: get('website'),
      contact_url: get('contact_url'),
      description: get('description'),
      keywords: get('description').split(/[\s、,。]+/).filter(w => w.length >= 2),
    });
  }
  return rows;
}

const CSV_TEMPLATE = `name,phone,industry,prefecture,city,size,employees,website,description
株式会社サンプル,03-1234-5678,製造業,東京都,大田区,mid,120,https://example.com/,金属加工部品の製造。タイムカード運用、シフト管理が課題。
ダミー商事株式会社,06-1111-2222,卸売・小売業,大阪府,大阪市,small,40,https://example.com/,食品卸。配送ドライバー直行直帰。
`;

function getAllCompanies() {
  return [...state.companies, ...store.importedCompanies, ...store.customCompanies];
}

function updateOnboarding() {
  const total = getAllCompanies().length;
  const onb = document.getElementById('onboarding-panel');
  if (onb) onb.hidden = total > 0;
  const statTotal = document.getElementById('stat-total');
  if (statTotal) statTotal.textContent = total;
}

const PRODUCT_CATEGORIES = [
  {
    id: 'attendance', name: '勤怠管理SaaS',
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
    id: 'accounting', name: '経理・会計SaaS',
    patterns: [/経理/, /会計/, /請求書/, /インボイス/, /freee/, /マネーフォワード/, /記帳/, /電子帳簿/],
    icp: {
      industries: ['卸売・小売業', 'サービス業', '建設業', '不動産業', '情報通信業', '飲食業'],
      sizes: ['small', 'mid'],
      pains: ['請求書発行の手間', 'インボイス対応', '電子帳簿保存法対応'],
      keywords: ['請求', '経理', '会計', 'インボイス', '帳簿', 'Excel'],
      anti_patterns: [/SAP/, /基幹システム/, /会計事務所/],
    }
  },
  {
    id: 'expense', name: '経費精算SaaS',
    patterns: [/経費精算/, /立替/, /領収書/, /交通費/, /出張費/],
    icp: {
      industries: ['情報通信業', 'サービス業', '製造業', '卸売・小売業', '金融・保険業'],
      sizes: ['mid', 'large'],
      pains: ['紙の領収書管理', '立替精算の遅延', '不正精算リスク'],
      keywords: ['営業', '出張', '本社', '経理'],
      anti_patterns: [/楽楽精算.*導入/, /Concur/],
    }
  },
  {
    id: 'crm_sfa', name: 'CRM/SFA（顧客・営業管理）',
    patterns: [/CRM/, /SFA/, /顧客管理/, /営業管理/, /商談管理/, /Salesforce/, /HubSpot/, /見込み客/, /リード管理/],
    icp: {
      industries: ['情報通信業', '不動産業', '金融・保険業', '製造業', '卸売・小売業', 'サービス業'],
      sizes: ['small', 'mid'],
      pains: ['営業情報のExcel管理', '案件の属人化', '商談状況の不可視'],
      keywords: ['営業', '商談', '顧客', '受託', '代理店'],
      anti_patterns: [/Salesforce.*導入/, /CRM.*導入済/],
    }
  },
  {
    id: 'project_mgmt', name: '工数・プロジェクト管理',
    patterns: [/工数/, /プロジェクト管理/, /タスク管理/, /稼働管理/, /Backlog/, /Jira/],
    icp: {
      industries: ['情報通信業', 'サービス業'],
      sizes: ['small', 'mid'],
      pains: ['プロジェクト別工数の不可視', 'クライアント別収益管理', '稼働率の把握'],
      keywords: ['工数', 'プロジェクト', '受託', '広告', 'コンサル', 'SIer'],
      anti_patterns: [],
    }
  },
  {
    id: 'recruiting', name: '採用・人事SaaS',
    patterns: [/採用/, /求人/, /人事/, /タレントマネジメント/, /HRTech/, /応募者管理/, /ATS/, /中途採用/, /新卒/],
    icp: {
      industries: ['情報通信業', '製造業', 'サービス業', '医療・福祉', '建設業', '宿泊・サービス業'],
      sizes: ['mid', 'large'],
      pains: ['採用難', '応募者管理の煩雑', '離職率'],
      keywords: ['採用', '人材', '求人', '人事'],
      anti_patterns: [],
    }
  },
  {
    id: 'e_learning', name: 'eラーニング・研修',
    patterns: [/eラーニング/, /研修/, /教育プログラム/, /スキルアップ/, /LMS/, /オンライン学習/],
    icp: {
      industries: ['情報通信業', '製造業', '金融・保険業', '医療・福祉', 'サービス業'],
      sizes: ['mid', 'large'],
      pains: ['新人教育の標準化', 'コンプライアンス研修', 'リスキリング'],
      keywords: ['研修', '教育', '人材育成', 'スキル'],
      anti_patterns: [],
    }
  },
  {
    id: 'health_check', name: '健康診断・産業医・EAP',
    patterns: [/健康診断/, /産業医/, /メンタルヘルス/, /EAP/, /ストレスチェック/, /健康経営/],
    icp: {
      industries: ['製造業', '情報通信業', 'サービス業', '建設業', '運輸業', '金融・保険業'],
      sizes: ['mid', 'large'],
      pains: ['法定健診の実施', 'メンタル不調', '休職者対応'],
      keywords: ['従業員', '健康', '安全', '労働'],
      anti_patterns: [],
    }
  },
  {
    id: 'welfare', name: '福利厚生サービス',
    patterns: [/福利厚生/, /ベネフィット/, /カフェテリアプラン/, /社員割引/, /退職金制度/],
    icp: {
      industries: ['情報通信業', '製造業', 'サービス業', '金融・保険業', '建設業'],
      sizes: ['mid', 'large'],
      pains: ['採用競争力', '離職防止', '従業員満足度'],
      keywords: ['従業員', '社員', '人材定着'],
      anti_patterns: [],
    }
  },
  {
    id: 'marketing', name: 'マーケティング・MAツール',
    patterns: [/マーケティング/, /MA/, /メルマガ/, /Marketo/, /Pardot/, /HubSpot.*marketing/],
    icp: {
      industries: ['情報通信業', '卸売・小売業', '不動産業', 'サービス業', '教育・学習支援'],
      sizes: ['small', 'mid'],
      pains: ['見込み顧客の管理', 'リードナーチャリング', '広告ROIの不可視'],
      keywords: ['Web', 'マーケティング', 'リード', '見込み客'],
      anti_patterns: [],
    }
  },
  {
    id: 'seo_meo', name: 'SEO・MEO・Web集客',
    patterns: [/SEO/, /MEO/, /Web集客/, /検索順位/, /Googleマイビジネス/, /口コミ対策/],
    icp: {
      industries: ['卸売・小売業', '飲食業', '不動産業', '医療・福祉', 'サービス業', '宿泊・サービス業', '教育・学習支援'],
      sizes: ['small', 'mid'],
      pains: ['Webからの集客不足', '検索順位の低さ', '口コミ管理'],
      keywords: ['店舗', '集客', 'Web', '地域'],
      anti_patterns: [],
    }
  },
  {
    id: 'sns_video', name: 'SNS運用代行・動画制作',
    patterns: [/SNS運用/, /Instagram運用/, /TikTok/, /YouTube運用/, /動画制作/, /動画広告/, /ショート動画/],
    icp: {
      industries: ['卸売・小売業', '飲食業', '宿泊・サービス業', 'サービス業', '教育・学習支援'],
      sizes: ['small', 'mid'],
      pains: ['SNS運用の人手不足', 'ブランド認知の低さ', '若年層への訴求'],
      keywords: ['ブランド', '店舗', 'PR', '若年層'],
      anti_patterns: [],
    }
  },
  {
    id: 'ad_agency', name: 'Web広告運用代行',
    patterns: [/広告運用/, /リスティング/, /Google広告/, /Yahoo!広告/, /Facebook広告/, /広告代行/],
    icp: {
      industries: ['卸売・小売業', '不動産業', 'サービス業', '教育・学習支援', '医療・福祉'],
      sizes: ['small', 'mid'],
      pains: ['広告ROIの不透明', '運用ノウハウ不足'],
      keywords: ['広告', 'Web', '集客', 'EC'],
      anti_patterns: [/広告代理店/, /広告会社/],
    }
  },
  {
    id: 'ec_construction', name: 'ECサイト構築・運用',
    patterns: [/EC/, /Shopify/, /BASE/, /ECサイト/, /ネットショップ/, /楽天市場/, /Amazon出店/],
    icp: {
      industries: ['卸売・小売業', '製造業', '農林水産業', '飲食業'],
      sizes: ['small', 'mid'],
      pains: ['販路拡大', 'オンライン化', '在庫連携'],
      keywords: ['通販', '小売', 'EC', '販売'],
      anti_patterns: [/ECモール.*運営/],
    }
  },
  {
    id: 'web_production', name: 'Webサイト制作・改善',
    patterns: [/ホームページ制作/, /Web制作/, /サイトリニューアル/, /LP制作/, /コーポレートサイト/],
    icp: {
      industries: ['卸売・小売業', '製造業', '飲食業', 'サービス業', '建設業', '不動産業', '医療・福祉'],
      sizes: ['small', 'mid'],
      pains: ['古いHP', 'スマホ未対応', '問い合わせが来ない'],
      keywords: ['店舗', '中小企業', '個人事業'],
      anti_patterns: [/上場/, /大手/],
    }
  },
  {
    id: 'chatbot_ai', name: 'チャットボット・AI接客',
    patterns: [/チャットボット/, /AIチャット/, /AI接客/, /問い合わせ自動化/, /生成AI/, /ChatGPT/],
    icp: {
      industries: ['情報通信業', '金融・保険業', '卸売・小売業', 'サービス業', '不動産業', '教育・学習支援'],
      sizes: ['mid', 'large'],
      pains: ['カスタマーサポートの負荷', '問い合わせ対応の属人化', '24時間対応'],
      keywords: ['顧客対応', '問い合わせ', 'サポート'],
      anti_patterns: [],
    }
  },
  {
    id: 'security', name: 'セキュリティ・IT資産管理',
    patterns: [/セキュリティ/, /EDR/, /ウイルス対策/, /情報漏洩/, /資産管理/, /MDM/, /ゼロトラスト/, /SOC/],
    icp: {
      industries: ['金融・保険業', '情報通信業', '製造業', '医療・福祉', '建設業', '不動産業'],
      sizes: ['mid', 'large'],
      pains: ['情報漏洩リスク', '端末管理', 'コンプライアンス'],
      keywords: ['セキュリティ', 'コンプライアンス', '個人情報', '機密'],
      anti_patterns: [],
    }
  },
  {
    id: 'e_contract', name: '電子契約・電子署名',
    patterns: [/電子契約/, /電子署名/, /クラウドサイン/, /DocuSign/, /契約書管理/],
    icp: {
      industries: ['不動産業', '建設業', '情報通信業', '金融・保険業', 'サービス業', '製造業'],
      sizes: ['mid', 'large'],
      pains: ['契約書のやり取り', '印紙代', 'リモート対応'],
      keywords: ['契約', '取引', '法務'],
      anti_patterns: [],
    }
  },
  {
    id: 'rpa', name: 'RPA・業務自動化',
    patterns: [/RPA/, /業務自動化/, /UiPath/, /WinActor/, /BizRobo/],
    icp: {
      industries: ['金融・保険業', '製造業', '情報通信業', '卸売・小売業', 'サービス業'],
      sizes: ['mid', 'large'],
      pains: ['定型業務の手作業', 'バックオフィスの効率化'],
      keywords: ['経理', '人事', '事務', 'バックオフィス'],
      anti_patterns: [],
    }
  },
  {
    id: 'telecom', name: '通信回線・クラウドPBX',
    patterns: [/通信/, /回線/, /インターネット/, /光回線/, /モバイル/, /IP電話/, /クラウドPBX/, /固定電話/, /050/],
    icp: {
      industries: ['卸売・小売業', '飲食業', '建設業', 'サービス業', '不動産業', '製造業', '医療・福祉'],
      sizes: ['small', 'mid'],
      pains: ['通信費の高さ', '回線速度', '電話設備の老朽化', '多拠点の電話統合'],
      keywords: ['店舗', '事業所', '拠点', '本社'],
      anti_patterns: [/データセンター/, /大規模ネットワーク/],
    }
  },
  {
    id: 'oa_equipment', name: 'OA機器・複合機',
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
    id: 'security_camera', name: '防犯カメラ・入退室管理',
    patterns: [/防犯カメラ/, /監視カメラ/, /入退室管理/, /セキュリティゲート/, /顔認証/],
    icp: {
      industries: ['卸売・小売業', '飲食業', '宿泊・サービス業', '製造業', '医療・福祉', '建設業', '教育・学習支援'],
      sizes: ['small', 'mid'],
      pains: ['防犯対策', '入退室記録', '万引き・盗難'],
      keywords: ['店舗', '工場', '事業所', '安全'],
      anti_patterns: [],
    }
  },
  {
    id: 'electricity', name: '電力・ガス（新電力）',
    patterns: [/電力/, /新電力/, /電気料金/, /ガス料金/, /電気代/, /高圧/, /低圧/],
    icp: {
      industries: ['製造業', '卸売・小売業', '飲食業', '宿泊・サービス業', '医療・福祉'],
      sizes: ['small', 'mid', 'large'],
      pains: ['電気代の高騰', '省エネ対応'],
      keywords: ['工場', '店舗', '24時間'],
      anti_patterns: [],
    }
  },
  {
    id: 'solar', name: '太陽光・蓄電池・省エネ',
    patterns: [/太陽光/, /蓄電池/, /省エネ/, /PPA/, /カーボンニュートラル/, /脱炭素/, /CO2削減/],
    icp: {
      industries: ['製造業', '卸売・小売業', '建設業', '農林水産業', '運輸業', '宿泊・サービス業'],
      sizes: ['mid', 'large'],
      pains: ['電気代削減', 'ESG対応', 'BCP対策'],
      keywords: ['工場', '倉庫', '本社', '電気代'],
      anti_patterns: [],
    }
  },
  {
    id: 'led', name: 'LED照明・空調更新',
    patterns: [/LED/, /照明/, /業務用エアコン/, /空調/, /エアコン更新/],
    icp: {
      industries: ['製造業', '卸売・小売業', '飲食業', '宿泊・サービス業', '医療・福祉', '教育・学習支援'],
      sizes: ['small', 'mid', 'large'],
      pains: ['電気代', '老朽化', '快適性'],
      keywords: ['工場', '店舗', '事務所', '館内'],
      anti_patterns: [],
    }
  },
  {
    id: 'water_server', name: 'ウォーターサーバー・コーヒー',
    patterns: [/ウォーターサーバー/, /コーヒーサーバー/, /オフィスドリンク/, /給茶機/],
    icp: {
      industries: ['情報通信業', 'サービス業', '建設業', '不動産業', '金融・保険業', '医療・福祉'],
      sizes: ['small', 'mid'],
      pains: ['福利厚生', 'オフィス環境'],
      keywords: ['オフィス', '事務所', '従業員'],
      anti_patterns: [],
    }
  },
  {
    id: 'office_furniture', name: 'オフィス家具・内装',
    patterns: [/オフィス家具/, /什器/, /内装工事/, /オフィス移転/, /レイアウト変更/, /ワークスペース/],
    icp: {
      industries: ['情報通信業', 'サービス業', '金融・保険業', '不動産業'],
      sizes: ['small', 'mid', 'large'],
      pains: ['オフィス移転', 'リモート対応', '従業員数増'],
      keywords: ['オフィス', '本社', '事務所'],
      anti_patterns: [],
    }
  },
  {
    id: 'pos_payment', name: 'POSレジ・キャッシュレス決済',
    patterns: [/POSレジ/, /POS/, /キャッシュレス/, /QR決済/, /クレジット決済/, /決済端末/, /スマレジ/, /Square/, /Airレジ/],
    icp: {
      industries: ['卸売・小売業', '飲食業', '宿泊・サービス業', '医療・福祉', 'サービス業'],
      sizes: ['small', 'mid'],
      pains: ['会計の手間', 'キャッシュレス比率', 'インバウンド対応'],
      keywords: ['店舗', 'レジ', '会計', '小売', '飲食'],
      anti_patterns: [],
    }
  },
  {
    id: 'insurance', name: '法人保険・金融商品',
    patterns: [/法人保険/, /生命保険/, /損害保険/, /共済/, /賠償責任保険/],
    icp: {
      industries: ['製造業', '建設業', '運輸業', '卸売・小売業', '医療・福祉', '不動産業'],
      sizes: ['small', 'mid', 'large'],
      pains: ['事業承継', '退職金準備', '労災対応', '賠償リスク'],
      keywords: ['事業承継', '退職金', '福利厚生'],
      anti_patterns: [],
    }
  },
  {
    id: 'factoring_loan', name: 'ファクタリング・ビジネスローン',
    patterns: [/ファクタリング/, /ビジネスローン/, /資金調達/, /売掛金/, /融資/, /借入/],
    icp: {
      industries: ['建設業', '運輸業', '製造業', '卸売・小売業', '不動産業', 'サービス業'],
      sizes: ['small', 'mid'],
      pains: ['資金繰り', '売掛金回収サイト長期化', '銀行借入難'],
      keywords: ['資金', '売掛', '取引先'],
      anti_patterns: [/上場/, /大手/],
    }
  },
  {
    id: 'ma', name: 'M&A仲介・事業承継',
    patterns: [/M&A/, /事業承継/, /会社売却/, /会社買収/],
    icp: {
      industries: ['製造業', '卸売・小売業', '建設業', 'サービス業', '医療・福祉'],
      sizes: ['small', 'mid'],
      pains: ['後継者不在', '事業承継', '出口戦略'],
      keywords: ['創業', '老舗', '中小企業'],
      anti_patterns: [/上場/, /グループ会社/],
    }
  },
  {
    id: 'real_estate_invest', name: '不動産投資・賃貸経営',
    patterns: [/不動産投資/, /投資用マンション/, /賃貸経営/, /アパート経営/, /REIT/],
    icp: {
      industries: ['情報通信業', '金融・保険業', '医療・福祉', '製造業'],
      sizes: ['mid', 'large'],
      pains: ['資産形成', '節税', '将来の不安'],
      keywords: ['経営者', '役員', '医師'],
      anti_patterns: [/不動産/, /賃貸/],
    }
  },
  {
    id: 'consulting', name: 'コンサルティング・補助金',
    patterns: [/コンサル/, /業務改善/, /DX支援/, /補助金/, /助成金/, /IT導入補助金/, /ものづくり補助金/],
    icp: {
      industries: ['製造業', '建設業', '卸売・小売業', 'サービス業', '医療・福祉'],
      sizes: ['small', 'mid'],
      pains: ['DX遅れ', '業務効率化', '補助金活用'],
      keywords: ['DX', '業務改善', '補助金'],
      anti_patterns: [/コンサル.*会社/, /経営コンサル/],
    }
  },
  {
    id: 'legal_tax', name: '弁護士・税理士・社労士紹介',
    patterns: [/弁護士/, /税理士/, /社労士/, /顧問契約/, /法律相談/],
    icp: {
      industries: ['卸売・小売業', '製造業', '建設業', 'サービス業', '不動産業', '情報通信業'],
      sizes: ['small', 'mid'],
      pains: ['契約書チェック', '労務トラブル', '税務相談'],
      keywords: ['中小企業', '法務', '労務'],
      anti_patterns: [/法律事務所/, /会計事務所/],
    }
  },
  {
    id: 'sales_outsourcing', name: '営業代行・インサイドセールス代行',
    patterns: [/営業代行/, /インサイドセールス/, /テレアポ代行/, /架電代行/, /商談獲得/, /アポ獲得/],
    icp: {
      industries: ['情報通信業', 'サービス業', '製造業', '不動産業'],
      sizes: ['small', 'mid'],
      pains: ['新規開拓不足', '営業人員不足', '商談数の低さ'],
      keywords: ['営業', 'リード', '商談', '受託'],
      anti_patterns: [/営業代行/, /テレアポ/],
    }
  },
  {
    id: 'name_card', name: '名刺管理・スキャン',
    patterns: [/名刺管理/, /Sansan/, /Eight/, /名刺スキャン/],
    icp: {
      industries: ['情報通信業', '金融・保険業', '不動産業', '製造業', 'サービス業'],
      sizes: ['mid', 'large'],
      pains: ['名刺情報の個人所有', '人脈の可視化'],
      keywords: ['営業', '商談', '顧客'],
      anti_patterns: [],
    }
  },
  {
    id: 'logistics', name: '物流・倉庫・配送',
    patterns: [/物流/, /倉庫/, /配送/, /3PL/, /発送代行/, /フルフィルメント/],
    icp: {
      industries: ['卸売・小売業', '製造業', '農林水産業'],
      sizes: ['small', 'mid'],
      pains: ['倉庫スペース不足', '配送コスト', 'EC対応'],
      keywords: ['EC', '通販', '在庫', '発送'],
      anti_patterns: [/運送/, /物流.*会社/],
    }
  },
  {
    id: 'cleaning_security', name: '清掃・警備サービス',
    patterns: [/清掃/, /ビルメンテナンス/, /警備/, /常駐警備/, /機械警備/],
    icp: {
      industries: ['卸売・小売業', '不動産業', '宿泊・サービス業', '医療・福祉', '製造業', '教育・学習支援'],
      sizes: ['small', 'mid'],
      pains: ['清掃品質', '人手不足', '夜間警備'],
      keywords: ['店舗', '事業所', '施設', 'ビル'],
      anti_patterns: [/清掃/, /警備会社/],
    }
  },
  {
    id: 'industrial_waste', name: '産業廃棄物処理',
    patterns: [/産業廃棄物/, /産廃/, /廃棄物処理/, /リサイクル/, /マニフェスト/],
    icp: {
      industries: ['製造業', '建設業', '医療・福祉', '飲食業'],
      sizes: ['small', 'mid'],
      pains: ['廃棄物コスト', 'コンプライアンス', 'マニフェスト管理'],
      keywords: ['工場', '建設', '排出'],
      anti_patterns: [],
    }
  },
  {
    id: 'car_lease', name: 'カーリース・社用車',
    patterns: [/カーリース/, /社用車/, /営業車/, /リース車/, /車両管理/],
    icp: {
      industries: ['建設業', 'サービス業', '不動産業', '運輸業', '卸売・小売業'],
      sizes: ['small', 'mid'],
      pains: ['車両コスト', 'メンテナンス', '減価償却'],
      keywords: ['営業', '配送', '外回り'],
      anti_patterns: [/カーリース/, /中古車/],
    }
  },
  {
    id: 'print_promo', name: '印刷物・販促ノベルティ',
    patterns: [/チラシ/, /パンフレット/, /カタログ印刷/, /ノベルティ/, /販促品/, /名入れ/],
    icp: {
      industries: ['卸売・小売業', '飲食業', '不動産業', 'サービス業', '製造業'],
      sizes: ['small', 'mid'],
      pains: ['販促効果', 'ブランド認知'],
      keywords: ['店舗', '販促', '集客'],
      anti_patterns: [/印刷/],
    }
  },
  {
    id: 'food_supply', name: '業務用食材・備品',
    patterns: [/業務用食材/, /食材卸/, /厨房/, /おしぼり/, /ユニフォーム/, /制服/],
    icp: {
      industries: ['飲食業', '宿泊・サービス業', '医療・福祉'],
      sizes: ['small', 'mid'],
      pains: ['仕入コスト', '配送頻度', '人手不足'],
      keywords: ['店舗', 'レストラン', '居酒屋', 'ホテル'],
      anti_patterns: [],
    }
  },
];

/* ============ Signal Extraction ============ */
const SIGNAL_RULES = [
  { sig: 'has_office', re: /オフィス|事務所|本社|支店|本部/ },
  { sig: 'has_factory', re: /工場|製造|現場.*作業/ },
  { sig: 'has_store', re: /店舗|チェーン/ },
  { sig: 'has_field_work', re: /直行直帰|外回り|訪問/ },
  { sig: 'has_remote', re: /リモート|テレワーク|在宅/ },
  { sig: 'has_24h', re: /24時間|深夜/ },
  { sig: 'has_legacy', re: /SAP|基幹システム|刷新済|導入済/ },
  { sig: 'pain_recruitment', re: /採用|人手不足|離職|人材育成/ },
  { sig: 'pain_efficiency', re: /煩雑|属人|手作業|Excel|紙/ },
  { sig: 'pain_cost', re: /コスト|削減|電気代|高騰|仕入/ },
  { sig: 'pain_compliance', re: /コンプライアンス|機密|個人情報|労務/ },
  { sig: 'pain_sales', re: /営業|商談|新規開拓|集客/ },
  { sig: 'pain_succession', re: /後継者|事業承継/ },
  { sig: 'pain_funding', re: /資金繰り|売掛/ },
  { sig: 'pain_old_hp', re: /古いHP|ホームページ刷新|スマホ未対応/ },
  { sig: 'pain_welfare', re: /福利厚生|従業員満足|定着/ },
  { sig: 'industry_b2c_retail', re: /小売|店舗|EC|通販/ },
  { sig: 'industry_b2b_service', re: /受託|コンサル|SIer/ },
];

const SIZE_SIGNALS = {
  small: 'size_small',
  mid: 'size_mid',
  large: 'size_large',
};

function extractCompanySignals(company) {
  const text = company.description + ' ' + (company.keywords || []).join(' ');
  const signals = SIGNAL_RULES.filter(r => r.re.test(text)).map(r => r.sig);
  if (company.size) signals.push(SIZE_SIGNALS[company.size]);
  return new Set(signals);
}

/* ============ AI Strategy (per product) ============ */
const CATEGORY_STRATEGY = {
  water_server: {
    target_signals: ['has_office', 'pain_welfare', 'pain_recruitment'],
    avoid_signals: ['has_factory', 'has_field_work'],
    persona: 'オフィスワーク中心の中小〜中規模企業、来客対応や福利厚生強化に関心がある',
    decision_maker: '総務部長・経営者・人事',
    motivation: '従業員満足度向上、来客対応、ペットボトル廃棄削減、福利厚生のアピール',
    avoid: '工場・現場直行直帰中心で本社事務所が小規模、既設済',
    budget_range: '月額3,000〜10,000円/台、5年契約が標準。サーバー無償+水代のみのプランあり',
    meeting_time: '初回15分（用途・人数ヒアリング）、設置打合せ30分',
    objections: '①既存ベンダーがある ②置き場所がない ③衛生面・水質懸念 ④誰が管理するか不明',
    differentiators: '①水質（RO/天然水）②サーバー無償／有償の選択肢 ③配送頻度の柔軟性 ④常温水・温水・冷水対応',
    approach: '冒頭で「来客対応・採用競争力」の話題から入り、福利厚生改善とコスト比較で締める',
    market_context: 'コロナ後の出社回帰で需要再拡大、福利厚生強化トレンド、ペットボトル削減のESG文脈',
    key_questions: '①従業員数・出社率 ②現在の飲料調達方法 ③設置スペース ④福利厚生方針 ⑤決裁者',
    timing: '期初（4月）・組織変更時・オフィス移転時・夏前（5-6月）',
  },
  attendance: {
    target_signals: ['pain_efficiency', 'has_field_work', 'has_24h'],
    avoid_signals: ['has_legacy'],
    persona: '紙やExcelでの勤怠運用が残る中小企業、シフト・直行直帰が多い業種',
    decision_maker: '総務人事・経営者',
    motivation: '法令対応、集計工数削減、不正打刻防止',
    avoid: '基幹システムやSAPで人事まで統合済の大企業',
  },
  electricity: {
    target_signals: ['pain_cost', 'has_factory', 'has_24h'],
    avoid_signals: [],
    persona: '電気代が経営インパクトに直結する製造・小売・宿泊',
    decision_maker: '経営者・経理',
    motivation: '電気代削減、ESG/脱炭素',
    avoid: '既に新電力切替済み・大規模PPA契約済',
  },
  solar: {
    target_signals: ['pain_cost', 'has_factory'],
    avoid_signals: [],
    persona: '工場・倉庫の屋根を活用できる製造・物流・農業',
    decision_maker: '経営者・工場長',
    motivation: '電気代削減、脱炭素、BCP対策',
    avoid: '賃借物件・狭小敷地',
  },
  pos_payment: {
    target_signals: ['has_store', 'industry_b2c_retail'],
    avoid_signals: ['has_legacy'],
    persona: '店舗オペレーションを持つ小売・飲食・サービス',
    decision_maker: '経営者・店長',
    motivation: 'インバウンド対応、会計効率、キャッシュレス比率',
    avoid: 'POS既に最新版に刷新済',
  },
  factoring_loan: {
    target_signals: ['pain_funding'],
    avoid_signals: [],
    persona: '売掛サイクル長期化が課題、銀行借入が難しい中小',
    decision_maker: '経営者・経理',
    motivation: '資金繰り改善、新規取引拡大',
    avoid: '上場企業・大手',
  },
  ma: {
    target_signals: ['pain_succession'],
    avoid_signals: [],
    persona: '60代以上のオーナー経営、後継者不在の中小',
    decision_maker: '経営者本人',
    motivation: '事業承継・出口戦略',
    avoid: 'グループ会社や上場',
  },
  seo_meo: {
    target_signals: ['has_store', 'pain_old_hp', 'pain_sales'],
    avoid_signals: [],
    persona: '店舗・拠点で地域集客が必要な業種、ローカル検索からの来店が売上に直結',
    decision_maker: '経営者・店長・マーケ',
    motivation: '来店客数増、口コミ管理',
    avoid: '内部にマーケ部隊あり、SEO代理店契約済',
  },
  security_camera: {
    target_signals: ['has_store', 'has_factory'],
    avoid_signals: [],
    persona: '店舗・工場・施設で防犯・労務管理が必要',
    decision_maker: '経営者・施設管理',
    motivation: '万引き対策、入退室管理、労務エビデンス',
    avoid: '最新IPカメラ導入済',
  },
  recruiting: {
    target_signals: ['pain_recruitment'],
    avoid_signals: [],
    persona: '採用に苦戦している中堅企業、応募数や母集団形成が課題',
    decision_maker: '人事・経営者',
    motivation: '応募数増、ミスマッチ削減',
    avoid: 'タレントマネジメント完全運用中',
  },
};

function inferStrategy(category, icp) {
  const base = CATEGORY_STRATEGY[category.id] || {
    target_signals: [],
    avoid_signals: [],
    persona: `${icp.industries.slice(0,3).join('・')}の${icp.sizes.map(s=>({small:'小規模',mid:'中規模',large:'大規模'}[s])).join('・')}企業`,
    decision_maker: '経営者・部門長',
    motivation: icp.pains.join('・'),
    avoid: icp.anti_patterns.length ? '既存システム導入済み・カテゴリ競合あり' : '特になし',
  };
  // 12項目のデフォルト埋め
  return {
    budget_range: `小規模なら月数万円〜、中規模なら数十万円規模が標準的`,
    meeting_time: '初回 15-30分（課題ヒアリング）、本商談 60分（提案・見積）',
    objections: '①予算が無い・タイミングが悪い ②既存ベンダーとの契約継続 ③決裁が降りない ④効果が見えにくい',
    differentiators: '①導入実績 ②価格・サポート品質 ③業種特化のノウハウ ④オンボーディングの早さ',
    approach: '冒頭で「同業他社の課題解決例」を簡潔に提示 → 「御社では何が一番のネック?」と課題ヒアリング → 解決策を提案',
    market_context: `${icp.industries[0]||'関連市場'}は人手不足・DX需要・コスト圧力の3軸で動いており、中小企業ほど課題が顕在化`,
    key_questions: '①現状の運用方法 ②不便・課題に感じている点 ③予算・決裁ライン ④検討開始時期 ⑤判断基準',
    timing: '期初（4月・10月）の予算消化期、組織変更・新拠点開設時、年度末の駆け込み',
    ...base, // CATEGORY_STRATEGYに値があればこちらが優先
  };
}

/* ============ Generic intent analysis (any product) ============ */
const INTENT_RULES = [
  { sig: 'target_office', re: /オフィス|事務所|デスク|本社/, boost: 'has_office' },
  { sig: 'target_factory', re: /工場|製造|現場/, boost: 'has_factory' },
  { sig: 'target_store', re: /店舗|チェーン|小売/, boost: 'has_store' },
  { sig: 'target_remote', re: /リモート|テレワーク/, boost: 'has_remote' },
  { sig: 'target_b2b', re: /法人向け|B2B/, boost: 'industry_b2b_service' },
  { sig: 'pain_cost_focus', re: /削減|コスト/, boost: 'pain_cost' },
  { sig: 'pain_efficiency_focus', re: /効率|自動化|DX/, boost: 'pain_efficiency' },
  { sig: 'pain_recruit_focus', re: /採用|定着|福利厚生/, boost: 'pain_recruitment' },
];

function analyzeProductIntent(text) {
  return INTENT_RULES.filter(r => r.re.test(text)).map(r => r.boost);
}

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

function scoreCompany(company, icp, strategy, intentSignals) {
  // AI評価がある場合はそれを優先(HP内容を実際に読んだ結果)
  if (typeof company.ai_score === 'number') {
    return {
      ...company,
      score: company.ai_score,
      reasoning: company.ai_reasoning || '',
      aiComment: buildAIComment(company, icp, strategy, new Set(), company.ai_score),
    };
  }
  let score = 0;
  const reasons = [];
  const signals = extractCompanySignals(company);

  if (icp.industries.includes(company.industry)) {
    score += WEIGHTS.industry;
    reasons.push(`業種「${company.industry}」がターゲット`);
  }

  if (icp.sizes.includes(company.size)) {
    score += WEIGHTS.size;
    reasons.push(`規模適合（${company.employees}名）`);
  }

  const desc = company.description + ' ' + company.keywords.join(' ');
  const matchedKeywords = icp.keywords.filter(kw => desc.includes(kw));
  if (matchedKeywords.length > 0) {
    score += Math.min(matchedKeywords.length * WEIGHTS.keyword_each, WEIGHTS.keyword_cap);
    reasons.push(`キーワード一致: ${matchedKeywords.join('・')}`);
  }

  const matchedPains = icp.pains.filter(pain => {
    const tokens = pain.split(/[のがでに、]/).filter(t => t.length >= 2);
    return tokens.some(t => desc.includes(t));
  });
  if (matchedPains.length > 0) {
    score += WEIGHTS.pain;
    reasons.push('想定課題に合致');
  }

  // 意味シグナルマッチ（戦略 + 商材文脈）
  const wanted = new Set([...(strategy?.target_signals || []), ...(intentSignals || [])]);
  const avoided = new Set(strategy?.avoid_signals || []);
  const matchedSignals = [...wanted].filter(s => signals.has(s));
  if (matchedSignals.length > 0) {
    score += matchedSignals.length * 8;
    reasons.push(`購買シグナル: ${matchedSignals.map(sigLabel).join('・')}`);
  }
  const hitAvoid = [...avoided].filter(s => signals.has(s));
  if (hitAvoid.length > 0) {
    score -= hitAvoid.length * 15;
    reasons.push(`アンチシグナル: ${hitAvoid.map(sigLabel).join('・')}（減点）`);
  }

  const antiHit = (icp.anti_patterns || []).some(p => p.test(company.description));
  if (antiHit) {
    score += WEIGHTS.anti;
    reasons.push('競合・既存導入の兆候（減点）');
  }

  const final = Math.max(0, Math.min(100, score));
  return {
    ...company,
    score: final,
    signals: [...signals],
    reasoning: reasons.join(' / ') || '明確な根拠なし',
    aiComment: buildAIComment(company, icp, strategy, signals, final),
  };
}

const SIG_LABELS = {
  has_office: 'オフィスあり',
  has_factory: '工場あり',
  has_store: '店舗運営',
  has_field_work: '直行直帰',
  has_remote: 'リモート対応',
  has_24h: '24時間稼働',
  has_legacy: '既存システム',
  pain_recruitment: '採用課題',
  pain_efficiency: '効率化課題',
  pain_cost: 'コスト課題',
  pain_compliance: 'コンプラ課題',
  pain_sales: '営業課題',
  pain_succession: '事業承継',
  pain_funding: '資金繰り',
  pain_old_hp: 'HP刷新需要',
  pain_welfare: '福利厚生需要',
  size_small: '小規模',
  size_mid: '中規模',
  size_large: '大規模',
  industry_b2c_retail: 'B2C小売',
  industry_b2b_service: 'B2B受託',
};
function sigLabel(s) { return SIG_LABELS[s] || s; }

function buildAIComment(company, icp, strategy, signals, score) {
  // Deep AI 評価結果があれば、それを最優先で表示 (引用付き)
  if (company._used_deep_eval && company.ai_reasoning) {
    const parts = [];
    if (company._reranked && company.ai_rerank_reason) {
      parts.push(`🏆 ${company.ai_rerank_reason}`);
    }
    parts.push(company.ai_reasoning);
    if (company.ai_fit_evidence) parts.push(`根拠: ${company.ai_fit_evidence}`);
    if (Array.isArray(company.ai_buying_signals) && company.ai_buying_signals.length > 0) {
      parts.push(`購買シグナル: ${company.ai_buying_signals.slice(0,3).join('、')}`);
    }
    if (Array.isArray(company.ai_fit_citations) && company.ai_fit_citations.length > 0) {
      const cites = company.ai_fit_citations.slice(0, 2).map(c => `「${(c.quote||'').slice(0,40)}」`).join(' / ');
      parts.push(`HPより: ${cites}`);
    }
    if (Array.isArray(company.ai_risks) && company.ai_risks.length > 0) {
      parts.push(`⚠リスク: ${company.ai_risks.slice(0,2).join('、')}`);
    }
    if (company.activeness === 'inactive') {
      parts.push(`⚠ 活動停止シグナル検出`);
    } else if (company.activeness === 'active') {
      parts.push(`✓ アクティブ(最近の更新あり)`);
    }
    if (company.is_competitor) {
      parts.push(`⛔ 競合企業: ${company.competitor_evidence || '同種商材を販売'}`);
    }
    if (Array.isArray(company.ai_talking_points) && company.ai_talking_points.length > 0) {
      parts.push(`📞 架電トピック: ${company.ai_talking_points.slice(0,2).join('、')}`);
    }
    if (company.ai_dimensions) {
      const d = company.ai_dimensions;
      const dims = [
        `地域${d.region_match||0}`, `業種${d.industry_match||0}`,
        `規模${d.size_match||0}`, `タイミング${d.timing_signal||0}`,
        `根拠${d.evidence_strength||0}`, `課題${d.pain_alignment||0}`,
      ];
      parts.push(`[内訳] ${dims.join('/')}`);
    }
    if (company.ai_confidence) {
      const confJp = { low: '低', medium: '中', high: '高' }[company.ai_confidence] || company.ai_confidence;
      parts.push(`確信度: ${confJp}`);
    }
    return parts.join(' / ');
  }
  // 従来のルールベース
  if (score >= 70) {
    const why = [];
    if (signals.has('has_office') && strategy?.target_signals?.includes('has_office')) why.push('オフィスワーク中心で導入の物理的余地がある');
    if (signals.has('pain_recruitment')) why.push('採用・定着に課題があり、間接的な福利厚生・効率化提案が刺さりやすい');
    if (signals.has('pain_efficiency')) why.push('属人化・紙運用の解消余地が大きい');
    if (signals.has('pain_cost')) why.push('コスト感度が高く、削減提案が刺さる');
    if (signals.has('pain_succession')) why.push('事業承継期で経営者本人が判断できる');
    if (icp.industries.includes(company.industry)) why.push(`${company.industry}は主力ターゲット業界`);
    return why.length ? `この企業は${why.slice(0,3).join('、')}ため、商談化の確度が高い。${strategy?.decision_maker||'経営者'}への直接アプローチを推奨。` : `業種・規模・課題が想定ICPに合致。`;
  }
  if (score >= 40) {
    return `部分的にICPに合致するが、決め手に欠ける。${strategy?.motivation||'価値訴求'}を冒頭で簡潔に伝え、反応を見て深掘りすることを推奨。`;
  }
  return `想定ICPから外れる可能性が高い。優先度は低く、無理な架電は控えるべき。`;
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
  if (industrySel && industrySel.options.length <= 1) {
    const all = getAllCompanies();
    const industries = [...new Set(all.map(c => c.industry).filter(Boolean))].sort();
    industrySel.insertAdjacentHTML('beforeend',
      industries.map(i => `<option value="${i}">${i}</option>`).join(''));
  }
  const sec = document.getElementById('filter-section');
  if (sec) sec.hidden = false;
  renderRegionChips();
}

function renderResults() {
  const filtered = applyFilters();
  const tbody = document.querySelector('#results-table tbody');
  if (!tbody) return;
  const total = state.scored.length;
  renderQualitySummary(filtered);

  if (filtered.length === 0 && total > 0) {
    // フィルタで弾かれている → 案内+リセットボタン表示
    const colCount = document.querySelectorAll('#results-table thead th').length || 9;
    tbody.innerHTML = `
      <tr><td colspan="${colCount}" style="text-align:center;padding:30px 12px;color:var(--muted);">
        登録 ${total} 社中、現在のフィルタ条件に合致する企業が 0 件です。<br>
        <button id="reset-filters-btn" class="ghost small" style="margin-top:10px;">🔄 フィルタをリセット</button>
      </td></tr>`;
    const rb = document.getElementById('reset-filters-btn');
    if (rb) rb.addEventListener('click', () => {
      ['filter-industry','filter-size'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      store.opts.regionPrefs = [];
      store.opts.regionCities = [];
      saveStore();
      renderRegionChips();
      const fs = document.getElementById('filter-score');
      if (fs) { fs.value = '0'; document.getElementById('filter-score-value').textContent = '0'; }
      const sb = document.getElementById('search-box');
      if (sb) sb.value = '';
      state.view = 'all';
      document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
      const allTab = document.querySelector('.view-tab[data-view="all"]');
      if (allTab) allTab.classList.add('active');
      renderResults();
    });
  } else {
    tbody.innerHTML = filtered.map(c => renderRow(c)).join('');
    bindRowActions();
  }
  const countEl = document.getElementById('result-count');
  if (countEl) {
    countEl.textContent = total > 0 && filtered.length !== total
      ? `（${filtered.length}件 / 登録${total}社中）`
      : `（${filtered.length}件）`;
  }
  const section = document.getElementById('results-section');
  if (section) section.hidden = false;
}

function renderRow(c) {
  const isSaved = store.saved.has(c.id);
  const isDnc = store.dnc.has(c.id);
  const status = store.status[c.id] || '';
  const hasNote = !!store.notes[c.id];
  const trClass = [isSaved ? 'saved-row' : '', isDnc ? 'dnc-row' : '', c.pending ? 'pending-row' : ''].filter(Boolean).join(' ');
  const urls = getCompanyUrls(c);
  const phoneCell = hasPhone(c)
    ? `<a href="tel:${c.phone.replace(/[^0-9+]/g, '')}">${c.phone}</a>`
    : `<span class="phone-empty">未取得（HPから問い合わせ）</span>`;
  return `
    <tr class="${trClass}" data-id="${c.id}">
      <td data-label="適合度"><span class="score ${scoreClass(c.score)} score-clickable" data-detail-id="${c.id}" title="クリックで評価詳細" style="cursor:pointer">${c.score}</span></td>
      <td data-label="操作">
        <div class="row-actions">
          <button class="act-save ${isSaved ? 'active' : ''}" title="保存">★</button>
          <button class="act-dnc ${isDnc ? 'dnc-on' : ''}" title="DNC">🚫</button>
          <button class="act-call" title="架電" ${hasPhone(c)?'':'disabled style="opacity:.4"'}>📞</button>
          <button class="act-hp" data-url="${urls.website}" title="HPを開く">🌐</button>
          <button class="act-contact" data-url="${urls.contact}" title="お問い合わせ">✉️</button>
          <button class="act-note ${hasNote ? 'active' : ''}" title="メモ">📝</button>
          <button class="act-script" title="スクリプト">📜</button>
          <button class="act-fb-good ${(store.feedback?.[c.id]?.rating === 'good') ? 'active' : ''}" title="この評価は正しい (AI改善に使う)" data-fb="good">👍</button>
          <button class="act-fb-bad ${(store.feedback?.[c.id]?.rating === 'bad') ? 'active' : ''}" title="この評価は間違っている (AI改善に使う)" data-fb="bad">👎</button>
        </div>
      </td>
      <td data-label="会社名">
        ${cleanCompanyName(c.name) || c.name}
        ${c.houjin_bangou ? `<div class="meta-tag" title="国税庁登記情報で確認済み">🆔 ${c.houjin_bangou}</div>` : ''}
        ${c.houjin_not_registered ? `<div class="meta-tag warn" title="国税庁に登記なし(任意団体・個人事業の可能性)">⚠ 未登記</div>` : ''}
        ${c._used_deep_eval ? `<div class="meta-tag good" title="Opus + 拡張思考で深く評価">🧠 Deep</div>` : ''}
        ${c._reranked ? `<div class="meta-tag good" title="最終リランキング適用">🏆 Reranked</div>` : ''}
        ${c.activeness === 'inactive' ? `<div class="meta-tag warn" title="廃業・事業終了シグナル検出">💤 活動停止?</div>` : ''}
        ${c.activeness === 'active' ? `<div class="meta-tag good" title="最近の更新あり">⚡ アクティブ</div>` : ''}
        ${c.is_competitor ? `<div class="meta-tag warn" title="競合企業(同種商材を販売)・架電厳禁: ${c.competitor_evidence||''}" style="background:rgba(220,0,0,.1);color:var(--danger);border-color:var(--danger)">⛔ 競合</div>` : ''}
        ${c._ensemble ? `<div class="meta-tag good" title="Opus(${c._ensemble.opus_score})+Sonnet(${c._ensemble.sonnet_score})の合議 ${c._ensemble.disagree?'⚠ 評価が割れた':'一致'}">🎯 合議</div>` : ''}
        ${c._verification === 'strong' ? `<div class="meta-tag good" title="外部${c.cross_source_count||0}サイトから言及・業界認知度高い">🌐 検証済</div>` : ''}
        ${c._verification === 'weak' ? `<div class="meta-tag warn" title="外部参照ほぼなし(新規/小規模/未公開法人の可能性)">⚠ 参照希薄</div>` : ''}
        ${c._sitemap_assisted ? `<div class="meta-tag" title="sitemap.xml を解析して情報密度高い独自ページを追加クロール">🗺 Sitemap</div>` : ''}
        ${Array.isArray(c.recent_news) && c.recent_news.length > 0 ? `<div class="meta-tag good" title="最近のニュース ${c.recent_news.length}件取得済 (詳細クリック)">📰 News</div>` : ''}
      </td>
      <td data-label="業種">${c.industry}</td>
      <td data-label="所在地">
        ${c.prefecture||''}${c.city ? ' ' + c.city : ''}
        ${c.official_address && c.official_address !== c.address ? `<div class="meta-tag" title="国税庁公式所在地">📋 ${c.official_address.slice(0,40)}</div>` : ''}
      </td>
      <td data-label="規模">${c.employees}名</td>
      <td data-label="電話" class="phone">${phoneCell}</td>
      <td data-label="状況">
        <select class="status-select" data-id="${c.id}">
          <option value="">未架電</option>
          <option value="connected" ${status==='connected'?'selected':''}>繋がった</option>
          <option value="absent" ${status==='absent'?'selected':''}>不在</option>
          <option value="rejected" ${status==='rejected'?'selected':''}>拒否</option>
          <option value="meeting" ${status==='meeting'?'selected':''}>商談化</option>
        </select>
      </td>
      <td class="reasoning no-label">
        <div class="ai-comment">${c.aiComment || ''}</div>
        <div class="ai-reason">${c.reasoning}</div>
      </td>
    </tr>
  `;
}

function bindRowActions() {
  document.querySelectorAll('#results-table tbody tr').forEach(tr => {
    const id = parseInt(tr.dataset.id, 10);
    const company = state.scored.find(c => c.id === id);
    tr.querySelector('.act-save').addEventListener('click', () => toggleSave(id));
    tr.querySelector('.act-dnc').addEventListener('click', () => toggleDnc(id));
    tr.querySelector('.act-call').addEventListener('click', () => recordCall(id));
    tr.querySelector('.act-hp').addEventListener('click', e => {
      window.open(e.currentTarget.dataset.url, '_blank', 'noopener');
    });
    tr.querySelector('.act-contact').addEventListener('click', e => {
      window.open(e.currentTarget.dataset.url, '_blank', 'noopener');
    });
    tr.querySelector('.act-note').addEventListener('click', () => openNote(id));
    tr.querySelector('.act-script').addEventListener('click', () => openScript(company));
    const fbGood = tr.querySelector('.act-fb-good');
    const fbBad = tr.querySelector('.act-fb-bad');
    if (fbGood) fbGood.addEventListener('click', () => {
      const cur = store.feedback?.[id]?.rating;
      recordFeedback(id, cur === 'good' ? null : 'good');
    });
    if (fbBad) fbBad.addEventListener('click', () => {
      const cur = store.feedback?.[id]?.rating;
      if (cur === 'bad') { recordFeedback(id, null); return; }
      const correction = prompt('正しい適合度スコア(0-100)を入力してください (キャンセルで補正なし):', '');
      const correctionNum = correction === null ? null : parseInt(correction, 10);
      const comment = prompt('修正のコメント(なぜ評価が間違ってると思うか):', '') || '';
      recordFeedback(id, 'bad', isNaN(correctionNum) ? null : correctionNum, comment);
    });
    tr.querySelector('.status-select').addEventListener('change', e => setStatus(id, e.target.value));
  });
}

/* ============ Storage ============ */
const STORAGE_KEY = 'tell.v1';

const store = {
  saved: new Set(),
  dnc: new Set(),
  dncPhones: new Set(),  // 番号ベースのDNC: 一度DNC指定された電話番号は再収集も拒否
  status: {},
  notes: {},
  history: [],
  customCompanies: [],
  importedCompanies: [],
  callRecords: {},   // companyId -> { duration, memo, next_t, last_t, outcome }
  followUps: [],     // [{id, t}] next-callback queue
  profiles: [],      // [{id, name, productText, icp, strategy, classification, savedAt}]
  activeProfile: null,
  usageLog: [],      // { t, action, ref, meta } 監査用ログ(最新1000件)
  tosAccepted: false,
  tosAcceptedAt: 0,
  // 課金: 当月の集計値. { ym: '2026-05', searches, aiEvals, hpFetches }
  billing: {
    currentMonth: '',
    searches: 0,
    aiEvals: 0,
    hpFetches: 0,
  },
  // 過去月の請求額アーカイブ (請求書発行用)
  // [{ym, base, search, ai, fetch, total, searches, aiEvals, hpFetches, archivedAt}]
  billingHistory: [],
  // 課金設定(管理者がFirestore経由で全ユーザー共通設定として変更可)
  billingConfig: null, // null の場合は window.DEFAULT_BILLING_CONFIG を使う
  opts: { excludeDnc: true, savedOnly: false, dark: false, aiEnabled: false, aiKey: '', aiModel: 'claude-haiku-4-5-20251001', braveKey: '', braveProxy: '', regionPrefs: [], regionCities: [], bravePages: 2, qualityMode: true, knownCompetitors: [] },
  feedback: {}, // companyId -> { rating: 'good'|'bad'|null, score_correction, comment, t }
};

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    store.saved = new Set(d.saved || []);
    store.dnc = new Set(d.dnc || []);
    store.dncPhones = new Set(d.dncPhones || []);
    store.status = d.status || {};
    store.notes = d.notes || {};
    store.history = d.history || [];
    store.customCompanies = d.customCompanies || [];
    store.importedCompanies = d.importedCompanies || [];
    store.callRecords = d.callRecords || {};
    store.followUps = d.followUps || [];
    store.profiles = d.profiles || [];
    store.activeProfile = d.activeProfile || null;
    store.usageLog = Array.isArray(d.usageLog) ? d.usageLog : [];
    store.tosAccepted = d.tosAccepted === true;
    store.tosAcceptedAt = d.tosAcceptedAt || 0;
    if (d.billing) store.billing = { ...store.billing, ...d.billing };
    if (Array.isArray(d.billingHistory)) store.billingHistory = d.billingHistory;
    if (d.billingConfig) store.billingConfig = d.billingConfig;
    if (d.feedback) store.feedback = d.feedback;
    store.opts = { ...store.opts, ...(d.opts || {}) };
  } catch (e) { console.warn('loadStore failed', e); }
}

// 連続検索中など、saveStore() が高頻度で呼ばれるとlocalStorage書込が重いので
// 500ms にまとめる
let _saveStoreTimer = null;
let _saveStoreDirty = false;
function saveStore() {
  // 即時保存(明示的)。検索ホットループでは saveStoreSoon() を使うとよい
  _saveStoreDirty = false;
  if (_saveStoreTimer) { clearTimeout(_saveStoreTimer); _saveStoreTimer = null; }
  _saveStoreImpl();
}
function saveStoreSoon() {
  _saveStoreDirty = true;
  if (_saveStoreTimer) return;
  _saveStoreTimer = setTimeout(() => {
    _saveStoreTimer = null;
    if (_saveStoreDirty) { _saveStoreDirty = false; _saveStoreImpl(); }
  }, 500);
}
function _saveStoreImpl() {
  const d = {
    saved: [...store.saved],
    dnc: [...store.dnc],
    dncPhones: [...(store.dncPhones || new Set())],
    status: store.status,
    notes: store.notes,
    history: store.history,
    customCompanies: store.customCompanies,
    importedCompanies: store.importedCompanies,
    callRecords: store.callRecords,
    followUps: store.followUps,
    profiles: store.profiles,
    activeProfile: store.activeProfile,
    usageLog: store.usageLog || [],
    tosAccepted: store.tosAccepted,
    tosAcceptedAt: store.tosAcceptedAt,
    billing: store.billing,
    billingHistory: store.billingHistory || [],
    billingConfig: store.billingConfig,
    feedback: store.feedback || {},
    opts: store.opts,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  // Firestoreにもsync (ログイン済なら)
  if (window._fbSyncToFirestore) window._fbSyncToFirestore(d);
}

/* ============ 使用ログ(監査用) ============ */
function logAction(action, ref = '', meta = null) {
  if (!store.usageLog) store.usageLog = [];
  store.usageLog.unshift({ t: Date.now(), action, ref: String(ref).slice(0, 200), meta: meta ? String(JSON.stringify(meta)).slice(0, 300) : null });
  // 直近1000件のみ保持(localStorage肥大化防止)
  if (store.usageLog.length > 1000) store.usageLog.length = 1000;
}

/* ============ 課金 (使用量カウント + 月次集計 + 上限) ============ */
function currentYM() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function ensureBillingMonth() {
  if (!store.billing) {
    store.billing = { currentMonth: '', searches: 0, aiEvals: 0, hpFetches: 0 };
  }
  const ym = currentYM();
  if (store.billing.currentMonth && store.billing.currentMonth !== ym) {
    // 月が変わった → 前月分を billingHistory にアーカイブ(請求漏れ防止)
    archivePreviousMonth();
  }
  if (store.billing.currentMonth !== ym) {
    store.billing = { currentMonth: ym, searches: 0, aiEvals: 0, hpFetches: 0 };
  }
}

function archivePreviousMonth() {
  if (!store.billing || !store.billing.currentMonth) return;
  const b = store.billing;
  // billingConfig は当時のものを記録(後から単価変更されても遡及しない)
  const cfg = getBillingConfig();
  const baseCost = cfg.baseMonthly || 0;
  const searchCost = (b.searches || 0) * (cfg.perSearch || 0);
  const aiCost = (b.aiEvals || 0) * (cfg.perAiEvaluation || 0);
  const fetchCost = (b.hpFetches || 0) * (cfg.perHpFetch || 0);
  const total = Math.round(baseCost + searchCost + aiCost + fetchCost);
  if (!store.billingHistory) store.billingHistory = [];
  // 既に同じymのアーカイブがあれば上書き
  store.billingHistory = store.billingHistory.filter(h => h.ym !== b.currentMonth);
  store.billingHistory.unshift({
    ym: b.currentMonth,
    searches: b.searches || 0,
    aiEvals: b.aiEvals || 0,
    hpFetches: b.hpFetches || 0,
    base: Math.round(baseCost),
    search: Math.round(searchCost),
    ai: Math.round(aiCost),
    fetch: Math.round(fetchCost),
    total,
    archivedAt: Date.now(),
    // 当時の単価も記録
    rates: { ...cfg },
  });
  // 直近24ヶ月のみ保持
  if (store.billingHistory.length > 24) store.billingHistory.length = 24;
}

function getBillingConfig() {
  return store.billingConfig || window.DEFAULT_BILLING_CONFIG || {
    baseMonthly: 50000, perSearch: 0.5, perAiEvaluation: 2.0, perHpFetch: 0.1,
    monthlyCap: 0, hardCap: true,
  };
}

function calcCurrentBill() {
  ensureBillingMonth();
  const cfg = getBillingConfig();
  const b = store.billing;
  const baseCost = cfg.baseMonthly || 0;
  const searchCost = (b.searches || 0) * (cfg.perSearch || 0);
  const aiCost = (b.aiEvals || 0) * (cfg.perAiEvaluation || 0);
  const fetchCost = (b.hpFetches || 0) * (cfg.perHpFetch || 0);
  return {
    base: Math.round(baseCost),
    search: Math.round(searchCost),
    ai: Math.round(aiCost),
    fetch: Math.round(fetchCost),
    total: Math.round(baseCost + searchCost + aiCost + fetchCost),
    overCap: false,
    cap: cfg.monthlyCap || 0,
  };
}

function isBillingCapped() {
  const cfg = getBillingConfig();
  if (!cfg.monthlyCap || !cfg.hardCap) return false;
  const bill = calcCurrentBill();
  return bill.total >= cfg.monthlyCap;
}

function incrementUsage(kind, count = 1) {
  ensureBillingMonth();
  if (kind === 'search') store.billing.searches = (store.billing.searches || 0) + count;
  else if (kind === 'ai') store.billing.aiEvals = (store.billing.aiEvals || 0) + count;
  else if (kind === 'fetch') store.billing.hpFetches = (store.billing.hpFetches || 0) + count;
  renderBillingPanel();
}

function renderBillingPanel() {
  ensureBillingMonth();
  const bill = calcCurrentBill();
  const cfg = getBillingConfig();
  const yen = n => '¥' + Number(n).toLocaleString('ja-JP');
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText('billing-period', `${store.billing.currentMonth} (${new Date().getDate()}日時点)`);
  setText('bill-base', yen(bill.base));
  setText('bill-search', yen(bill.search));
  setText('bill-ai', yen(bill.ai));
  setText('bill-fetch', yen(bill.fetch));
  setText('bill-total', yen(bill.total));
  setText('bill-search-count', `${(store.billing.searches||0).toLocaleString()}回`);
  setText('bill-ai-count', `${(store.billing.aiEvals||0).toLocaleString()}件`);
  setText('bill-fetch-count', `${(store.billing.hpFetches||0).toLocaleString()}回`);
  const warn = document.getElementById('bill-limit-warn');
  if (warn) {
    if (cfg.monthlyCap && bill.total >= cfg.monthlyCap) {
      warn.style.display = 'block';
      warn.textContent = cfg.hardCap
        ? `⚠ 月額利用上限(${yen(cfg.monthlyCap)})に到達。検索停止中。`
        : `⚠ 月額利用上限(${yen(cfg.monthlyCap)})を超過しています。`;
    } else if (cfg.monthlyCap && bill.total >= cfg.monthlyCap * 0.8) {
      warn.style.display = 'block';
      warn.style.color = 'var(--mid)';
      warn.textContent = `⚠ 上限の80%に到達 (${yen(bill.total)} / ${yen(cfg.monthlyCap)})`;
    } else {
      warn.style.display = 'none';
    }
  }
}

/* ============ Firebase 同期 (firebase-sync.js が読み込まれてから動く) ============ */
let _currentFbUser = null;
let _fbSaveTimer = null;
let _fbSavePending = null;

function isAdminUser() {
  if (!_currentFbUser || !_currentFbUser.email) return false;
  const admins = window.ADMIN_EMAILS || [];
  return admins.includes(_currentFbUser.email);
}

window._fbSyncToFirestore = function(data) {
  if (!_currentFbUser || !window.firebaseApi) return;
  _fbSavePending = data;
  // 3秒デバウンスでFirestore書込(料金もかかるし頻繁に呼ぶ意味ない)
  if (_fbSaveTimer) return;
  _fbSaveTimer = setTimeout(async () => {
    _fbSaveTimer = null;
    const toSave = _fbSavePending;
    _fbSavePending = null;
    try {
      await window.firebaseApi.saveUserState(_currentFbUser.uid, toSave);
    } catch (e) {
      console.warn('[firebase] save failed', e);
    }
  }, 3000);
};

async function applyFirebaseUserState(remoteData) {
  if (!remoteData) return;
  // ローカルと remote 両方ある場合 → remote 優先(他端末で更新された可能性)
  // ただし usageLog だけはマージ(各端末で発生したログを保持)
  const mergedLog = [...(remoteData.usageLog || []), ...(store.usageLog || [])]
    .sort((a, b) => b.t - a.t)
    .filter((e, i, arr) => i === 0 || e.t !== arr[i-1].t)
    .slice(0, 1000);
  // 課金カウント: 月が同じなら remote 優先、違うなら local 優先(同期遅延考慮)
  let mergedBilling = remoteData.billing || store.billing;
  if (remoteData.billing && store.billing && remoteData.billing.currentMonth === store.billing.currentMonth) {
    // 多端末で同月カウントの場合、大きい方を採用(失われない方向で)
    mergedBilling = {
      currentMonth: remoteData.billing.currentMonth,
      searches: Math.max(remoteData.billing.searches || 0, store.billing.searches || 0),
      aiEvals: Math.max(remoteData.billing.aiEvals || 0, store.billing.aiEvals || 0),
      hpFetches: Math.max(remoteData.billing.hpFetches || 0, store.billing.hpFetches || 0),
    };
  }
  store.saved = new Set(remoteData.saved || []);
  store.dnc = new Set(remoteData.dnc || []);
  store.dncPhones = new Set(remoteData.dncPhones || []);
  store.status = remoteData.status || {};
  store.notes = remoteData.notes || {};
  store.history = remoteData.history || [];
  store.customCompanies = remoteData.customCompanies || [];
  store.importedCompanies = remoteData.importedCompanies || [];
  store.callRecords = remoteData.callRecords || {};
  store.followUps = remoteData.followUps || [];
  store.profiles = remoteData.profiles || [];
  store.activeProfile = remoteData.activeProfile || null;
  store.usageLog = mergedLog;
  store.tosAccepted = remoteData.tosAccepted === true;
  store.tosAcceptedAt = remoteData.tosAcceptedAt || 0;
  store.billing = mergedBilling;
  store.billingConfig = remoteData.billingConfig || store.billingConfig;
  store.opts = { ...store.opts, ...(remoteData.opts || {}) };
}

async function onFirebaseSignedIn(user) {
  _currentFbUser = user;
  updateAccountUI();
  try {
    const remote = await window.firebaseApi.loadUserState(user.uid);
    if (remote) {
      // 無効化チェック
      if (remote._disabled === true) {
        alert(`このアカウントは無効化されています。\n${remote._disabledReason ? '理由: ' + remote._disabledReason : ''}\n\n管理者にお問い合わせください。`);
        try { await window.firebaseApi.signOut(); } catch {}
        return;
      }
      await applyFirebaseUserState(remote);
    } else {
      // 初回ログイン: 既存のローカル state を初期データとしてpush
      await window.firebaseApi.saveUserState(user.uid, JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
    }
  } catch (e) {
    console.warn('[firebase] initial load failed', e);
  }
  // システム設定(Worker URL/APIキー)を読込・適用
  await loadAndApplySystemConfig();
  // UI再描画
  renderAll();
}

function onFirebaseSignedOut() {
  _currentFbUser = null;
  updateAccountUI();
  // ローカルキャッシュは残す(再ログイン時にも見える)
}

function updateAccountUI() {
  const emailEl = document.getElementById('account-email');
  const statusEl = document.getElementById('account-status');
  const openBtn = document.getElementById('open-login-btn');
  const outBtn = document.getElementById('signout-btn');
  const adminSec = document.getElementById('admin-section');
  if (_currentFbUser) {
    if (emailEl) emailEl.textContent = _currentFbUser.email;
    if (statusEl) statusEl.textContent = `クラウド同期中 (${isAdminUser() ? '管理者' : '一般ユーザー'})`;
    if (openBtn) openBtn.style.display = 'none';
    if (outBtn) outBtn.style.display = '';
    if (adminSec) adminSec.style.display = isAdminUser() ? '' : 'none';
  } else {
    if (emailEl) emailEl.textContent = window.FIREBASE_READY ? '未ログイン (ローカルモード)' : 'ローカルモード';
    if (statusEl) statusEl.textContent = window.FIREBASE_READY ? 'ログインしてクラウド同期' : 'Firebase未設定';
    if (openBtn) openBtn.style.display = window.FIREBASE_READY ? '' : 'none';
    if (outBtn) outBtn.style.display = 'none';
    if (adminSec) adminSec.style.display = 'none';
  }
}

function renderAll() {
  try {
    if (state.icp) {
      const allCompanies = getAllCompanies();
      state.scored = allCompanies
        .map(co => scoreCompany(co, state.icp, state.strategy, state.intentSignals))
        .sort((a, b) => b.score - a.score);
    }
    renderResults();
    renderSidebar();
    renderRegionChips();
    renderBillingPanel();
  } catch (e) { console.warn('renderAll failed', e); }
}

/* ============ ログインモーダル ============ */
function setupLoginModal() {
  const modal = document.getElementById('login-modal');
  const emailIn = document.getElementById('login-email');
  const passIn = document.getElementById('login-password');
  const errEl = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit');
  const switchBtn = document.getElementById('login-switch');
  const resetBtn = document.getElementById('login-reset');
  const openBtn = document.getElementById('open-login-btn');
  const outBtn = document.getElementById('signout-btn');
  const titleEl = document.getElementById('login-title');
  const hintEl = document.getElementById('login-mode-hint');
  let mode = 'login'; // 'login' | 'signup'

  const setMode = (m) => {
    mode = m;
    titleEl.textContent = m === 'signup' ? 'tell partner 新規登録' : 'tell partner ログイン';
    hintEl.textContent = m === 'signup' ? 'メール+パスワード(6文字以上)で新規登録' : 'アカウントにログインしてください';
    submitBtn.textContent = m === 'signup' ? '新規登録' : 'ログイン';
    switchBtn.textContent = m === 'signup' ? 'ログインに切替' : '新規登録に切替';
    errEl.textContent = '';
  };

  if (switchBtn) switchBtn.addEventListener('click', () => setMode(mode === 'signup' ? 'login' : 'signup'));

  if (submitBtn) submitBtn.addEventListener('click', async () => {
    if (!window.firebaseApi) { errEl.textContent = 'Firebase未設定'; return; }
    const email = emailIn.value.trim();
    const pass = passIn.value;
    if (!email || !pass) { errEl.textContent = 'メールとパスワードを入力'; return; }
    submitBtn.disabled = true;
    errEl.textContent = '';
    try {
      if (mode === 'signup') {
        await window.firebaseApi.signUp(email, pass);
      } else {
        await window.firebaseApi.signIn(email, pass);
      }
      modal.hidden = true;
      passIn.value = '';
    } catch (e) {
      errEl.textContent = `失敗: ${e.code || e.message || ''}`.slice(0, 120);
    } finally {
      submitBtn.disabled = false;
    }
  });

  if (resetBtn) resetBtn.addEventListener('click', async () => {
    const email = emailIn.value.trim();
    if (!email) { errEl.textContent = 'メールを入力してください'; return; }
    try {
      await window.firebaseApi.resetPassword(email);
      errEl.style.color = 'var(--good)';
      errEl.textContent = `パスワード再設定メールを ${email} に送信しました`;
    } catch (e) {
      errEl.style.color = 'var(--danger)';
      errEl.textContent = `失敗: ${e.code || e.message}`;
    }
  });

  if (openBtn) openBtn.addEventListener('click', () => { setMode('login'); modal.hidden = false; });
  if (outBtn) outBtn.addEventListener('click', async () => {
    if (!confirm('ログアウトしますか？(ローカルキャッシュは残ります)')) return;
    try { await window.firebaseApi.signOut(); } catch (e) { console.warn(e); }
  });
}

/* ============ 管理者: 全ユーザー請求額レポート ============ */
let _billingReportCache = null; // [{uid, email, billing, billingHistory}]

function calcUserBillForMonth(userState, ym, fallbackCfg) {
  // 当月: userState.billing (まだarchive前)
  if (userState.billing && userState.billing.currentMonth === ym) {
    const cfg = userState.billingConfig || fallbackCfg;
    const baseCost = cfg.baseMonthly || 0;
    const searchCost = (userState.billing.searches || 0) * (cfg.perSearch || 0);
    const aiCost = (userState.billing.aiEvals || 0) * (cfg.perAiEvaluation || 0);
    const fetchCost = (userState.billing.hpFetches || 0) * (cfg.perHpFetch || 0);
    return {
      searches: userState.billing.searches || 0,
      aiEvals: userState.billing.aiEvals || 0,
      hpFetches: userState.billing.hpFetches || 0,
      base: Math.round(baseCost),
      usage: Math.round(searchCost + aiCost + fetchCost),
      total: Math.round(baseCost + searchCost + aiCost + fetchCost),
    };
  }
  // 過去月: billingHistory から検索
  const hist = (userState.billingHistory || []).find(h => h.ym === ym);
  if (hist) {
    return {
      searches: hist.searches || 0,
      aiEvals: hist.aiEvals || 0,
      hpFetches: hist.hpFetches || 0,
      base: hist.base || 0,
      usage: (hist.search || 0) + (hist.ai || 0) + (hist.fetch || 0),
      total: hist.total || 0,
    };
  }
  return null;
}

async function openBillingReport() {
  if (!isAdminUser()) { alert('管理者のみ閲覧可能です'); return; }
  if (!window.firebaseApi) { alert('Firebase未設定'); return; }
  const modal = document.getElementById('billing-report-modal');
  modal.hidden = false;
  await refreshBillingReport();
}

async function refreshBillingReport() {
  const status = document.getElementById('report-status');
  status.textContent = '読込中…';
  try {
    _billingReportCache = await window.firebaseApi.listAllUserStates();
    status.textContent = `${_billingReportCache.length}ユーザー取得`;
  } catch (e) {
    status.textContent = `取得失敗: ${e.message.slice(0,80)}`;
    console.error(e);
    return;
  }
  // 月セレクタを生成 (現在月 + 過去24ヶ月)
  const monthSelect = document.getElementById('report-month-filter');
  const months = new Set([currentYM()]);
  for (const u of _billingReportCache) {
    (u.billingHistory || []).forEach(h => months.add(h.ym));
    if (u.billing?.currentMonth) months.add(u.billing.currentMonth);
  }
  const sortedMonths = [...months].sort().reverse();
  monthSelect.innerHTML = sortedMonths.map(m => `<option value="${m}">${m}</option>`).join('');
  renderBillingReportTable(sortedMonths[0]);
}

function renderBillingReportTable(ym) {
  const tbody = document.getElementById('report-tbody');
  const cfg = getBillingConfig();
  const yen = n => '¥' + Number(n).toLocaleString('ja-JP');
  const rows = [];
  let grandTotal = 0;
  for (const u of (_billingReportCache || [])) {
    const bill = calcUserBillForMonth(u, ym, cfg);
    if (!bill) continue;
    grandTotal += bill.total;
    const email = u._email || '(不明)';
    const updated = u._updatedAt?.toDate ? u._updatedAt.toDate().toLocaleString('ja-JP') : '-';
    rows.push(`
      <tr style="border-bottom:1px solid var(--border)">
        <td style="padding:6px">${email}</td>
        <td style="text-align:right;padding:6px">${bill.searches.toLocaleString()}</td>
        <td style="text-align:right;padding:6px">${bill.aiEvals.toLocaleString()}</td>
        <td style="text-align:right;padding:6px">${bill.hpFetches.toLocaleString()}</td>
        <td style="text-align:right;padding:6px">${yen(bill.base)}</td>
        <td style="text-align:right;padding:6px">${yen(bill.usage)}</td>
        <td style="text-align:right;padding:6px;color:var(--accent);font-weight:600">${yen(bill.total)}</td>
        <td style="text-align:right;padding:6px;font-size:11px;color:var(--muted)">${updated}</td>
      </tr>
    `);
  }
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--muted)">${ym} の利用ユーザーなし</td></tr>`;
  } else {
    tbody.innerHTML = rows.join('');
  }
  document.getElementById('report-grand-total').textContent = yen(grandTotal);
}

function exportBillingReportCsv(allMonths = false) {
  if (!_billingReportCache) { alert('先に「更新」を押してデータ取得してください'); return; }
  const cfg = getBillingConfig();
  const yen = n => Number(n).toFixed(0);
  const rows = [['対象月','メールアドレス','検索数','AI評価数','HP取得数','基本料金','検索料金','AI料金','HP取得料金','合計請求額','最終更新']];
  let targetMonths;
  if (allMonths) {
    const set = new Set();
    for (const u of _billingReportCache) {
      (u.billingHistory || []).forEach(h => set.add(h.ym));
      if (u.billing?.currentMonth) set.add(u.billing.currentMonth);
    }
    targetMonths = [...set].sort();
  } else {
    targetMonths = [document.getElementById('report-month-filter').value];
  }
  for (const ym of targetMonths) {
    for (const u of _billingReportCache) {
      const bill = calcUserBillForMonth(u, ym, cfg);
      if (!bill) continue;
      const email = u._email || '(不明)';
      const updated = u._updatedAt?.toDate ? u._updatedAt.toDate().toISOString() : '';
      const userCfg = u.billingConfig || cfg;
      rows.push([
        ym, email, bill.searches, bill.aiEvals, bill.hpFetches,
        yen(bill.base),
        yen((bill.searches||0) * (userCfg.perSearch||0)),
        yen((bill.aiEvals||0) * (userCfg.perAiEvaluation||0)),
        yen((bill.hpFetches||0) * (userCfg.perHpFetch||0)),
        yen(bill.total), updated,
      ]);
    }
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const fname = allMonths ? `tell-billing-all-${Date.now()}.csv` : `tell-billing-${targetMonths[0]}.csv`;
  downloadFile(fname, csv);
}

function setupBillingReportModal() {
  // 請求額レポートはマスター管理モーダル内のタブに統合。
  // ボタンハンドラ等は setupMasterAdminModal() で配線。
  const refreshBtn = document.getElementById('report-refresh');
  const csvBtn = document.getElementById('report-export-csv');
  const csvAllBtn = document.getElementById('report-export-csv-all');
  const monthSel = document.getElementById('report-month-filter');
  if (refreshBtn) refreshBtn.addEventListener('click', refreshBillingReport);
  if (csvBtn) csvBtn.addEventListener('click', () => exportBillingReportCsv(false));
  if (csvAllBtn) csvAllBtn.addEventListener('click', () => exportBillingReportCsv(true));
  if (monthSel) monthSel.addEventListener('change', () => renderBillingReportTable(monthSel.value));
}

/* ============ マスター管理モーダル ============ */
let _systemPublicConfig = null;
let _systemAdminConfig = null;

async function loadAndApplySystemConfig() {
  if (!window.firebaseApi) return;
  try {
    const pub = await window.firebaseApi.loadPublicConfig();
    if (pub) {
      _systemPublicConfig = pub;
      // 全ユーザーに自動適用
      if (pub.workerUrl) store.opts.braveProxy = pub.workerUrl;
      if (pub.aiModel) store.opts.aiModel = pub.aiModel;
      if (typeof pub.defaultBravePages === 'number') store.opts.bravePages = pub.defaultBravePages;
      if (typeof pub.qualityMode === 'boolean') store.opts.qualityMode = pub.qualityMode;
      if (typeof pub.ensembleMode === 'boolean') store.opts.ensembleMode = pub.ensembleMode;
      if (Array.isArray(pub.knownCompetitors)) store.opts.knownCompetitors = pub.knownCompetitors;
      if (pub.billingConfig) store.billingConfig = pub.billingConfig;
      // UIの値を反映
      const braveInput = document.getElementById('opt-brave-input');
      if (braveInput) braveInput.value = pub.workerUrl || '';
      const aiModel = document.getElementById('opt-ai-model');
      if (aiModel) aiModel.value = pub.aiModel || 'claude-haiku-4-5-20251001';
      // ユーザー側のBrave/AIセクションを「管理者が設定済み」表示に
      applySystemManagedUI();
    }
  } catch (e) {
    console.warn('[system_config] load failed (Firestore Rules で許可されていない可能性)', e);
  }
  // 管理者なら admin_config も読む(APIキー入力欄表示用)
  if (isAdminUser()) {
    try {
      _systemAdminConfig = await window.firebaseApi.loadAdminConfig();
      if (_systemAdminConfig && _systemAdminConfig.anthropicKey) {
        store.opts.aiKey = _systemAdminConfig.anthropicKey;
      }
    } catch (e) {
      console.warn('[admin_config] load failed', e);
    }
  }
}

function applySystemManagedUI() {
  // SaaSモードでは API キーや Worker URL は管理者が設定済みなので、
  // ユーザー側のセクションを情報表示のみに切り替える
  if (!_systemPublicConfig || !_systemPublicConfig.workerUrl) return;
  if (isAdminUser()) return; // 管理者は両方見える
  const braveSec = document.getElementById('user-brave-section');
  const aiSec = document.getElementById('user-ai-section');
  const note = '<div class="system-managed-note">✓ システム管理者が設定済み<br>追加の設定は不要です</div>';
  if (braveSec) {
    const body = braveSec.querySelector('.side-body');
    if (body && !body.dataset.systemManaged) {
      body.dataset.systemManaged = '1';
      body.innerHTML = note;
    }
  }
  if (aiSec) {
    const body = aiSec.querySelector('.side-body');
    if (body && !body.dataset.systemManaged) {
      body.dataset.systemManaged = '1';
      body.innerHTML = note;
    }
  }
}

function setupMasterAdminModal() {
  const modal = document.getElementById('master-admin-modal');
  const openBtn = document.getElementById('open-master-admin');
  const closeBtn = document.getElementById('master-close');
  if (openBtn) openBtn.addEventListener('click', () => openMasterAdmin());
  if (closeBtn) closeBtn.addEventListener('click', () => { modal.hidden = true; });
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; });
  // タブ切替
  document.querySelectorAll('.master-tab').forEach(btn => {
    btn.addEventListener('click', () => switchMasterTab(btn.dataset.tab));
  });
  // 接続設定 保存
  const connSave = document.getElementById('ma-conn-save');
  if (connSave) connSave.addEventListener('click', saveConnectionConfig);
  // APIキー 保存
  const keysSave = document.getElementById('ma-keys-save');
  if (keysSave) keysSave.addEventListener('click', saveApiKeysConfig);
  // ユーザー一覧更新
  const usersRefresh = document.getElementById('users-refresh');
  if (usersRefresh) usersRefresh.addEventListener('click', refreshUsersList);
}

function switchMasterTab(tab) {
  document.querySelectorAll('.master-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.master-pane').forEach(p => {
    p.hidden = (p.dataset.pane !== tab);
  });
  // タブごとの初期化
  if (tab === 'billing-report' && !_billingReportCache) {
    refreshBillingReport();
  } else if (tab === 'users') {
    refreshUsersList();
  } else if (tab === 'system') {
    renderSystemInfo();
  }
}

async function openMasterAdmin() {
  if (!isAdminUser()) { alert('管理者のみ閲覧可能です'); return; }
  // 既存値で各タブを初期化
  const cfg = getBillingConfig();
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  // 接続設定
  setVal('ma-worker-url', (_systemPublicConfig && _systemPublicConfig.workerUrl) || store.opts.braveProxy || '');
  setVal('ma-ai-model', (_systemPublicConfig && _systemPublicConfig.aiModel) || store.opts.aiModel || 'claude-haiku-4-5-20251001');
  setVal('ma-default-pages', (_systemPublicConfig && _systemPublicConfig.defaultBravePages) || 2);
  const qmEl = document.getElementById('ma-quality-mode');
  if (qmEl) qmEl.checked = (_systemPublicConfig?.qualityMode !== false) && (store.opts.qualityMode !== false);
  const kcEl = document.getElementById('ma-known-competitors');
  if (kcEl) {
    const list = _systemPublicConfig?.knownCompetitors || store.opts.knownCompetitors || [];
    kcEl.value = Array.isArray(list) ? list.join('\n') : '';
  }
  const emEl = document.getElementById('ma-ensemble-mode');
  if (emEl) emEl.checked = (_systemPublicConfig?.ensembleMode === true) || (store.opts.ensembleMode === true);
  // APIキー
  setVal('ma-anthropic-key', (_systemAdminConfig && _systemAdminConfig.anthropicKey) || '');
  setVal('ma-brave-key', (_systemAdminConfig && _systemAdminConfig.braveKey) || '');
  // 課金単価
  setVal('price-base', cfg.baseMonthly);
  setVal('price-search', cfg.perSearch);
  setVal('price-ai', cfg.perAiEvaluation);
  setVal('price-fetch', cfg.perHpFetch);
  setVal('price-cap', cfg.monthlyCap || 0);
  const hardCb = document.getElementById('price-hard-cap');
  if (hardCb) hardCb.checked = cfg.hardCap !== false;

  document.getElementById('master-admin-modal').hidden = false;
  switchMasterTab('connection');
}

async function saveConnectionConfig() {
  const status = document.getElementById('ma-conn-status');
  if (!window.firebaseApi) { status.textContent = 'Firebase未設定'; return; }
  const competitorsText = document.getElementById('ma-known-competitors')?.value || '';
  const competitors = competitorsText.split('\n').map(s => s.trim()).filter(Boolean);
  const cfg = {
    workerUrl: document.getElementById('ma-worker-url').value.trim(),
    aiModel: document.getElementById('ma-ai-model').value,
    defaultBravePages: parseInt(document.getElementById('ma-default-pages').value, 10) || 2,
    qualityMode: document.getElementById('ma-quality-mode').checked,
    ensembleMode: document.getElementById('ma-ensemble-mode')?.checked === true,
    knownCompetitors: competitors,
    billingConfig: getBillingConfig(),
  };
  try {
    await window.firebaseApi.savePublicConfig(cfg);
    _systemPublicConfig = { ..._systemPublicConfig, ...cfg };
    // 自分にも反映
    if (cfg.workerUrl) store.opts.braveProxy = cfg.workerUrl;
    if (cfg.aiModel) store.opts.aiModel = cfg.aiModel;
    if (cfg.defaultBravePages) store.opts.bravePages = cfg.defaultBravePages;
    store.opts.qualityMode = cfg.qualityMode;
    store.opts.ensembleMode = cfg.ensembleMode;
    store.opts.knownCompetitors = cfg.knownCompetitors;
    saveStore();
    logAction('system_public_config_saved', JSON.stringify(cfg));
    status.style.color = 'var(--good)';
    status.textContent = `✓ 全ユーザーに配信完了 (${new Date().toLocaleString('ja-JP')})`;
    setTimeout(() => { status.textContent = ''; }, 5000);
  } catch (e) {
    status.style.color = 'var(--danger)';
    status.textContent = `失敗: ${e.message.slice(0, 100)}`;
  }
}

async function saveApiKeysConfig() {
  const status = document.getElementById('ma-keys-status');
  if (!window.firebaseApi) { status.textContent = 'Firebase未設定'; return; }
  const cfg = {
    anthropicKey: document.getElementById('ma-anthropic-key').value.trim(),
    braveKey: document.getElementById('ma-brave-key').value.trim(),
  };
  try {
    await window.firebaseApi.saveAdminConfig(cfg);
    _systemAdminConfig = { ..._systemAdminConfig, ...cfg };
    // 自分にも反映
    if (cfg.anthropicKey) store.opts.aiKey = cfg.anthropicKey;
    if (cfg.braveKey) store.opts.braveKey = cfg.braveKey;
    saveStore();
    logAction('system_admin_config_saved', 'APIキー更新');
    status.style.color = 'var(--good)';
    status.textContent = `✓ 保存完了 (${new Date().toLocaleString('ja-JP')})`;
    setTimeout(() => { status.textContent = ''; }, 5000);
  } catch (e) {
    status.style.color = 'var(--danger)';
    status.textContent = `失敗: ${e.message.slice(0, 100)}`;
  }
}

async function refreshUsersList() {
  const status = document.getElementById('users-status');
  const tbody = document.getElementById('users-tbody');
  if (!window.firebaseApi) { status.textContent = 'Firebase未設定'; return; }
  status.textContent = '読込中…';
  try {
    if (!_billingReportCache) {
      _billingReportCache = await window.firebaseApi.listAllUserStates();
    }
    const cfg = getBillingConfig();
    const ym = currentYM();
    const yen = n => '¥' + Number(n).toLocaleString('ja-JP');
    const rows = (_billingReportCache || []).map(u => {
      const bill = calcUserBillForMonth(u, ym, cfg);
      const companies = (u.importedCompanies?.length || 0) + (u.customCompanies?.length || 0);
      const updated = u._updatedAt?.toDate ? u._updatedAt.toDate().toLocaleString('ja-JP') : '-';
      const disabled = u._disabled === true;
      return `
        <tr style="border-bottom:1px solid var(--border)${disabled ? ';opacity:0.5' : ''}">
          <td style="padding:6px">${u._email || '(不明)'}</td>
          <td style="text-align:right;padding:6px">${bill ? yen(bill.total) : '-'}</td>
          <td style="text-align:right;padding:6px">${companies.toLocaleString()}</td>
          <td style="text-align:right;padding:6px;font-size:11px;color:var(--muted)">${updated}</td>
          <td style="text-align:center;padding:6px">${disabled ? '<span style="color:var(--danger)">無効</span>' : '<span style="color:var(--good)">有効</span>'}</td>
          <td style="text-align:center;padding:6px">
            <button class="user-toggle-btn" data-uid="${u.uid}" data-disabled="${disabled ? '1' : '0'}" style="font-size:11px;padding:4px 8px">${disabled ? '有効化' : '無効化'}</button>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = rows.length === 0
      ? `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--muted)">ユーザーなし</td></tr>`
      : rows.join('');
    // 無効化/有効化ボタン
    tbody.querySelectorAll('.user-toggle-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.uid;
        const disabled = btn.dataset.disabled === '1';
        const newState = !disabled;
        if (!confirm(newState ? 'このユーザーを無効化しますか？\n(アプリ起動時に弾かれます)' : 'このユーザーを有効化しますか？')) return;
        const reason = newState ? (prompt('無効化の理由(任意):', '') || '') : '';
        try {
          await window.firebaseApi.setUserDisabled(uid, newState, reason);
          logAction(newState ? 'user_disabled' : 'user_enabled', uid);
          _billingReportCache = null;
          refreshUsersList();
        } catch (e) {
          alert(`失敗: ${e.message}`);
        }
      });
    });
    status.textContent = `${_billingReportCache.length}ユーザー`;
  } catch (e) {
    status.textContent = `取得失敗: ${e.message.slice(0, 80)}`;
  }
}

function renderSystemInfo() {
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText('sys-firebase', window.FIREBASE_READY ? '✓ 接続中' : '✗ 未設定');
  setText('sys-project', (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.projectId) || '-');
  setText('sys-user', _currentFbUser ? _currentFbUser.email : '未ログイン');
  setText('sys-role', isAdminUser() ? '管理者' : (_currentFbUser ? '一般ユーザー' : '-'));
  setText('sys-tos', store.tosAcceptedAt ? new Date(store.tosAcceptedAt).toLocaleString('ja-JP') : '未同意');
}

/* ============ 管理者: 課金設定パネル ============ */
function setupAdminPanel() {
  const cfg = getBillingConfig();
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setVal('price-base', cfg.baseMonthly);
  setVal('price-search', cfg.perSearch);
  setVal('price-ai', cfg.perAiEvaluation);
  setVal('price-fetch', cfg.perHpFetch);
  setVal('price-cap', cfg.monthlyCap || 0);
  const hardCb = document.getElementById('price-hard-cap');
  if (hardCb) hardCb.checked = cfg.hardCap !== false;
  const saveBtn = document.getElementById('price-save');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const newCfg = {
      baseMonthly: Math.max(0, parseFloat(document.getElementById('price-base').value) || 0),
      perSearch: Math.max(0, parseFloat(document.getElementById('price-search').value) || 0),
      perAiEvaluation: Math.max(0, parseFloat(document.getElementById('price-ai').value) || 0),
      perHpFetch: Math.max(0, parseFloat(document.getElementById('price-fetch').value) || 0),
      monthlyCap: Math.max(0, parseFloat(document.getElementById('price-cap').value) || 0),
      hardCap: document.getElementById('price-hard-cap').checked,
    };
    store.billingConfig = newCfg;
    logAction('billing_config_changed', JSON.stringify(newCfg));
    saveStore();
    renderBillingPanel();
    const status = document.getElementById('price-status');
    // 全ユーザー共通設定として Firestore にも push
    if (window.firebaseApi && isAdminUser()) {
      try {
        await window.firebaseApi.savePublicConfig({
          ...(_systemPublicConfig || {}),
          billingConfig: newCfg,
        });
        _systemPublicConfig = { ...(_systemPublicConfig || {}), billingConfig: newCfg };
      } catch (e) {
        if (status) {
          status.style.color = 'var(--danger)';
          status.textContent = `Firestore保存失敗: ${e.message.slice(0, 80)}`;
        }
        return;
      }
    }
    if (status) {
      status.style.color = 'var(--good)';
      status.textContent = `✓ 全ユーザーに保存しました (${new Date().toLocaleString('ja-JP')})`;
      setTimeout(() => { status.textContent = ''; }, 4000);
    }
  });
}

/* ============ Actions ============ */
function findCompanyById(id) {
  return getAllCompanies().find(c => c.id === id) || (state.companies || []).find(c => c.id === id);
}

function toggleSave(id) {
  const willSave = !store.saved.has(id);
  if (willSave) store.saved.add(id); else store.saved.delete(id);
  const company = findCompanyById(id);
  logAction(willSave ? 'save' : 'unsave', company ? `${company.name}/${company.phone||''}` : id);
  saveStore();
  renderResults();
  renderSidebar();
}

function toggleDnc(id) {
  const willDnc = !store.dnc.has(id);
  if (willDnc) store.dnc.add(id); else store.dnc.delete(id);
  // 番号DNC: 一度DNCした番号は今後の収集時も拒否
  if (!store.dncPhones) store.dncPhones = new Set();
  const company = findCompanyById(id);
  if (willDnc && company && company.phone) {
    const key = normalizePhoneKey(company.phone);
    if (key) store.dncPhones.add(key);
  }
  logAction(willDnc ? 'dnc' : 'undnc', company ? `${company.name}/${company.phone||''}` : id);
  saveStore();
  renderResults();
  renderSidebar();
}

function setStatus(id, status) {
  // 結果が選ばれたら通話記録モーダルを開く
  if (status === 'connected' || status === 'meeting' || status === 'absent' || status === 'rejected') {
    openCallRecord(id, status);
    return;
  }
  if (status) store.status[id] = status;
  else delete store.status[id];
  store.history.unshift({ id, status: status || 'unset', t: Date.now() });
  store.history = store.history.slice(0, 100);
  saveStore();
  renderSidebar();
  renderResults();
}

function openCallRecord(id, status) {
  const company = state.companies.concat(store.importedCompanies, store.customCompanies).find(c => c.id === id);
  if (!company) return;
  const modal = document.getElementById('call-modal');
  modal.dataset.id = id;
  document.getElementById('call-title').textContent = `架電記録: ${company.name}`;
  document.getElementById('call-status').value = status;
  const rec = store.callRecords[id] || {};
  document.getElementById('call-duration').value = rec.duration || '';
  document.getElementById('call-memo').value = rec.memo || '';
  document.getElementById('call-next').value = rec.next_t ? formatLocalDT(new Date(rec.next_t)) : '';
  modal.hidden = false;
}

function formatLocalDT(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseLocalDT(s) {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2}))?$/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2]-1, +m[3], +(m[4]||9), +(m[5]||0));
  return isNaN(d) ? null : d.getTime();
}

function saveCallRecord() {
  const modal = document.getElementById('call-modal');
  const id = parseInt(modal.dataset.id, 10);
  const status = document.getElementById('call-status').value;
  const duration = document.getElementById('call-duration').value.trim();
  const memo = document.getElementById('call-memo').value.trim();
  const nextStr = document.getElementById('call-next').value.trim();
  const next_t = parseLocalDT(nextStr);

  if (status) store.status[id] = status;
  else delete store.status[id];

  store.callRecords[id] = {
    outcome: status,
    duration,
    memo,
    next_t,
    last_t: Date.now(),
  };

  // フォローアップ更新
  store.followUps = store.followUps.filter(f => f.id !== id);
  if (next_t) store.followUps.push({ id, t: next_t });
  store.followUps.sort((a,b) => a.t - b.t);

  store.history.unshift({ id, status, t: Date.now(), memo: memo.slice(0,40) });
  store.history = store.history.slice(0, 100);

  saveStore();
  modal.hidden = true;
  renderResults();
  renderSidebar();
}

function recordCall(id) {
  const company = state.companies.find(c => c.id === id);
  if (!company) return;
  store.history.unshift({ id, status: 'called', t: Date.now() });
  store.history = store.history.slice(0, 50);
  logAction('call', `${company.name}/${company.phone||''}`);
  saveStore();
  renderSidebar();
  const tel = company.phone.replace(/[^0-9+]/g, '');
  window.location.href = `tel:${tel}`;
}

function openNote(id) {
  const company = state.companies.find(c => c.id === id);
  const modal = document.getElementById('note-modal');
  document.getElementById('note-title').textContent = `メモ: ${company.name}`;
  document.getElementById('note-text').value = store.notes[id] || '';
  modal.dataset.id = id;
  modal.hidden = false;
}

async function openScript(company) {
  const modal = document.getElementById('script-modal');
  document.getElementById('script-meta').textContent =
    `${company.name} / ${company.industry} / ${company.prefecture}${company.city?' '+company.city:''} / 適合度 ${company.score}`;
  const textEl = document.getElementById('script-text');
  modal.hidden = false;
  if (store.opts.aiKey || store.opts.braveProxy) {
    textEl.textContent = '🤖 AI が生成中…';
    try {
      const productText = document.getElementById('product-input').value.trim();
      const script = await aiScript(company, productText, state.icp, state.strategy);
      textEl.textContent = script;
    } catch (e) {
      textEl.textContent = `(AI失敗: ${e.message})\n\n` + generateScript(company);
    }
  } else {
    textEl.textContent = generateScript(company);
  }
}

function generateScript(company) {
  const product = state.classification?.category?.name || '弊社サービス';
  const productText = document.getElementById('product-input').value.trim() || product;
  const pains = state.icp?.pains?.slice(0, 2).join('・') || '業務効率化';
  return [
    `【架電スクリプト・参考例】`,
    ``,
    `■ オープニング`,
    `お忙しいところ恐れ入ります、${company.name}のご担当者様でいらっしゃいますでしょうか。`,
    `わたくし、◯◯（事業者名）の△△と申します。`,
    `本日は${product}のご案内でお電話させていただきました。1〜2分だけお時間よろしいでしょうか。`,
    ``,
    `■ 仮説提示（事前リサーチに基づく）`,
    `${company.industry}・${company.prefecture}の${company.employees}名規模の御社では、`,
    `${pains}といった点でお悩みのケースが多いと伺っており、`,
    `${productText}でお役に立てる可能性があると考えております。`,
    ``,
    `■ 現状ヒアリング`,
    `差し支えなければ、現在${pains}についてどのように対応されていらっしゃいますか？`,
    ``,
    `■ クロージング`,
    `詳しい資料をメールでお送りしてもよろしいでしょうか。`,
    `15分ほどのオンライン説明のお時間もいただけると幸いです。`,
    ``,
    `※ 特商法の遵守事項`,
    `・冒頭で事業者名・勧誘目的を明示しています。`,
    `・断られた場合は再勧誘禁止。DNCリストへ即時追加してください。`,
  ].join('\n');
}

/* ============ Sidebar render ============ */
function renderSidebar() {
  const savedCompanies = [...store.saved].map(id => state.companies.find(c => c.id === id)).filter(Boolean);
  const dncCompanies = [...store.dnc].map(id => state.companies.find(c => c.id === id)).filter(Boolean);

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  setText('badge-saved', savedCompanies.length);
  setText('badge-dnc', dncCompanies.length);
  setText('badge-history', store.history.length);
  const badgeCustom = document.getElementById('badge-custom');
  if (badgeCustom) badgeCustom.textContent = store.customCompanies.length;

  document.getElementById('saved-list').innerHTML = savedCompanies.length === 0
    ? '<div class="empty">まだ保存なし</div>'
    : savedCompanies.map(c => `
      <div class="side-item">
        <div class="name" title="${c.name}">${c.name}<div class="phone">${c.phone}</div></div>
        <button class="x" data-action="unsave" data-id="${c.id}" aria-label="削除">×</button>
      </div>
    `).join('');

  document.getElementById('dnc-list').innerHTML = dncCompanies.length === 0
    ? '<div class="empty">DNC登録なし</div>'
    : dncCompanies.map(c => `
      <div class="side-item">
        <div class="name" title="${c.name}">${c.name}<div class="phone">${c.phone}</div></div>
        <button class="x" data-action="undnc" data-id="${c.id}" aria-label="削除">×</button>
      </div>
    `).join('');

  const statusLabel = { connected:'繋', absent:'不在', rejected:'拒否', meeting:'商談', called:'発信', unset:'-' };
  document.getElementById('history-list').innerHTML = store.history.length === 0
    ? '<div class="empty">履歴なし</div>'
    : store.history.slice(0, 10).map(h => {
        const c = state.companies.find(co => co.id === h.id);
        if (!c) return '';
        return `<div class="side-item">
          <div class="name">${c.name}<div class="phone">${statusLabel[h.status]||h.status} / ${new Date(h.t).toLocaleString('ja-JP',{hour:'2-digit',minute:'2-digit',month:'2-digit',day:'2-digit'})}</div></div>
        </div>`;
      }).join('');

  document.querySelectorAll('#saved-list .x, #dnc-list .x').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id, 10);
      if (btn.dataset.action === 'unsave') toggleSave(id);
      else toggleDnc(id);
    });
  });

  const today = new Date(); today.setHours(0,0,0,0);
  const todayCalls = store.history.filter(h => h.t >= today.getTime()).length;
  const meetings = Object.values(store.status).filter(s => s === 'meeting').length;
  const connected = Object.values(store.status).filter(s => s === 'connected' || s === 'meeting').length;
  const total = Object.keys(store.status).length;
  setText('stat-today', todayCalls);
  setText('stat-saved', savedCompanies.length);
  setText('stat-dnc', dncCompanies.length);
  setText('stat-meeting', meetings);
  setText('ana-total', total);
  setText('ana-connected', connected);
  setText('ana-rate', total > 0 ? `${Math.round(meetings/total*100)}%` : '0%');

  const calledIds = Object.keys(store.status).map(Number);
  const calledScored = calledIds.map(id => state.scored.find(c => c.id === id)).filter(Boolean);
  const avg = calledScored.length > 0
    ? Math.round(calledScored.reduce((s,c) => s+c.score, 0) / calledScored.length)
    : null;
  setText('ana-avg-score', avg !== null ? avg : '-');

  // フォローアップ表示
  const all = getAllCompanies();
  const fuEl = document.getElementById('followup-list');
  const upcoming = store.followUps.filter(f => all.find(c => c.id === f.id)).slice(0, 10);
  setText('badge-followup', upcoming.length);
  if (fuEl) {
    fuEl.innerHTML = upcoming.length === 0
      ? '<div class="empty">予定なし</div>'
      : upcoming.map(f => {
          const c = all.find(co => co.id === f.id);
          const dt = new Date(f.t);
          const overdue = f.t < Date.now();
          return `<div class="followup-item">
            <div class="name">${c.name}
              <div class="followup-when ${overdue?'overdue':''}">${overdue?'⚠ ':''}${formatLocalDT(dt)}</div>
            </div>
            <button class="x" data-fu-id="${f.id}" aria-label="削除">×</button>
          </div>`;
        }).join('');
    fuEl.querySelectorAll('[data-fu-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.fuId, 10);
        store.followUps = store.followUps.filter(f => f.id !== id);
        saveStore(); renderSidebar();
      });
    });
  }

  // プロファイル表示
  const profEl = document.getElementById('prof-list');
  setText('badge-profile', store.profiles.length);
  if (profEl) {
    profEl.innerHTML = store.profiles.length === 0
      ? '<div class="empty">未保存</div>'
      : store.profiles.map(p => `
        <div class="profile-item ${p.id===store.activeProfile?'active':''}">
          <div class="name" title="${p.name}">${p.name}
            <div class="followup-when">${new Date(p.savedAt).toLocaleDateString('ja-JP')}</div>
          </div>
          <div class="profile-actions">
            <button data-prof-load="${p.id}" aria-label="切替">↻</button>
            <button data-prof-del="${p.id}" aria-label="削除">×</button>
          </div>
        </div>
      `).join('');
    profEl.querySelectorAll('[data-prof-load]').forEach(b => {
      b.addEventListener('click', () => loadProfile(parseInt(b.dataset.profLoad, 10)));
    });
    profEl.querySelectorAll('[data-prof-del]').forEach(b => {
      b.addEventListener('click', () => {
        const id = parseInt(b.dataset.profDel, 10);
        if (!confirm('このプロファイルを削除しますか？')) return;
        store.profiles = store.profiles.filter(p => p.id !== id);
        if (store.activeProfile === id) store.activeProfile = null;
        saveStore(); renderSidebar();
      });
    });
  }
}

function saveProfile() {
  const nameInput = document.getElementById('prof-name');
  const name = nameInput.value.trim();
  if (!name) { alert('プロファイル名を入力してください'); return; }
  if (!state.icp) { alert('先に商材を分析してください'); return; }
  const id = Date.now();
  store.profiles.push({
    id,
    name,
    productText: document.getElementById('product-input').value,
    classification: state.classification,
    icp: state.icp,
    strategy: state.strategy,
    intentSignals: state.intentSignals,
    savedAt: Date.now(),
  });
  store.activeProfile = id;
  saveStore();
  nameInput.value = '';
  renderSidebar();
}

function loadProfile(id) {
  const p = store.profiles.find(pr => pr.id === id);
  if (!p) return;
  document.getElementById('product-input').value = p.productText || '';
  state.classification = p.classification;
  state.icp = p.icp;
  state.strategy = p.strategy;
  state.intentSignals = p.intentSignals || [];
  store.activeProfile = id;
  saveStore();
  const all = getAllCompanies();
  state.scored = all
    .map(c => scoreCompany(c, state.icp, state.strategy, state.intentSignals))
    .sort((a, b) => b.score - a.score);
  renderClassification(state.classification);
  renderStrategy(state.strategy, state.scored);
  renderICP(state.icp);
  renderFilters();
  renderResults();
  renderSidebar();
}

/* ============ Filter integration ============ */
function applyFilters() {
  const industry = document.getElementById('filter-industry').value;
  const size = document.getElementById('filter-size').value;
  const minScore = parseInt(document.getElementById('filter-score').value, 10);
  const search = document.getElementById('search-box').value.trim().toLowerCase();
  const prefs = selectedPrefs();
  const cities = selectedCities();
  const hasRegionFilter = prefs.size > 0 || cities.size > 0;

  return state.scored
    .filter(c => !industry || c.industry === industry)
    .filter(c => {
      if (!hasRegionFilter) return true;
      // 県/市情報が空の企業は除外しない(HPから取得できなかった場合の救済)
      if (!c.prefecture) return true;
      if (prefs.has(c.prefecture)) return true;
      if (cities.has(`${c.prefecture}/${c.city}`)) return true;
      for (const ck of cities) {
        const [p, ct] = ck.split('/');
        if (c.prefecture === p && (c.city || '').includes(ct)) return true;
      }
      // 説明文に選択地域名が含まれていれば許容
      const desc = (c.description || '') + ' ' + (c.name || '');
      for (const p of prefs) if (desc.includes(p)) return true;
      for (const ck of cities) {
        const ct = ck.split('/')[1];
        if (ct && desc.includes(ct)) return true;
      }
      return false;
    })
    .filter(c => !size || c.size === size)
    .filter(c => c.score >= minScore)
    .filter(c => !store.opts.excludeDnc || !store.dnc.has(c.id))
    .filter(c => !store.opts.savedOnly || store.saved.has(c.id))
    .filter(c => !search || c.name.toLowerCase().includes(search) || (c.phone || '').includes(search))
    .filter(c => {
      // Phase10 拡張フィルタ
      const minSc = parseInt(document.getElementById('filter-min-score')?.value || '0', 10);
      if (c.score < minSc) return false;
      if (document.getElementById('filter-no-competitor')?.checked && c.is_competitor) return false;
      if (document.getElementById('filter-active-only')?.checked && c.activeness === 'inactive') return false;
      if (document.getElementById('filter-deep-only')?.checked && !c._used_deep_eval) return false;
      if (document.getElementById('filter-houjin-only')?.checked && !c.houjin_bangou) return false;
      return true;
    })
    .filter(c => {
      if (state.view === 'with_phone') return hasPhone(c);
      if (state.view === 'without_phone') return !hasPhone(c);
      if (state.view === 'saved') return store.saved.has(c.id);
      return true;
    });
}

/* ============ CSV/JSON Export ============ */
function downloadFile(filename, content, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows) {
  // 基本+詳細フィールドを全て出力 (リッチCSV - 営業担当が架電前に1ファイルで見渡せる)
  const headers = [
    '会社名','電話番号','HP','お問い合わせURL','業種','都道府県','市区町村','住所','従業員数','適合度','確信度','ステータス','メモ','根拠',
    '法人番号','正式名(国税庁)','公式所在地(国税庁)','活動性','HP信頼性',
    '競合','適合根拠','購買シグナル','HP引用','架電トピック','決裁者候補','リスク',
    'スコア内訳(地域)','内訳(業種)','内訳(規模)','内訳(タイミング)','内訳(根拠)','内訳(課題)',
    'リランキング前スコア','リランキング理由','Deep評価','データソース',
  ];
  const lines = [headers.join(',')];
  const esc = v => `"${String(v || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;
  const arrJoin = a => Array.isArray(a) ? a.join(' / ') : '';
  rows.forEach(c => {
    const status = store.status[c.id] || '';
    const note = store.notes[c.id] || '';
    const urls = getCompanyUrls(c);
    const d = c.ai_dimensions || {};
    lines.push([
      esc(c.name), esc(c.phone), esc(urls.website), esc(urls.contact),
      esc(c.industry), esc(c.prefecture), esc(c.city), esc(c.address || ''),
      c.employees || '', c.score ?? '', esc(c.ai_confidence || ''),
      esc(status), esc(note), esc(c.reasoning),
      esc(c.houjin_bangou || ''), esc(c.official_name || ''), esc(c.official_address || ''),
      esc(c.activeness || ''), c.credibility_score ?? '',
      c.is_competitor ? 'YES' : '', esc(c.ai_fit_evidence || ''),
      esc(arrJoin(c.ai_buying_signals)),
      esc(Array.isArray(c.ai_fit_citations) ? c.ai_fit_citations.map(x => `「${x.quote||''}」`).join(' / ') : ''),
      esc(arrJoin(c.ai_talking_points)),
      esc(Array.isArray(c.ai_decision_makers) ? c.ai_decision_makers.map(x => `${x.title||''}${x.name?': '+x.name:''}`).join(' / ') : ''),
      esc(arrJoin(c.ai_risks)),
      d.region_match ?? '', d.industry_match ?? '', d.size_match ?? '',
      d.timing_signal ?? '', d.evidence_strength ?? '', d.pain_alignment ?? '',
      c.ai_score_pre_rerank ?? '', esc(c.ai_rerank_reason || ''),
      c._used_deep_eval ? 'YES' : '', esc(c._source || (c.houjin_bangou ? 'houjin' : 'brave')),
    ].join(','));
  });
  return lines.join('\n');
}

function exportResults() {
  const rows = applyFilters();
  if (rows.length === 0) return alert('結果がありません');
  logAction('csv_export_results', `${rows.length}件`);
  saveStore();
  downloadFile(`tell-results-${Date.now()}.csv`, toCsv(rows));
}

function exportSaved() {
  const rows = [...store.saved].map(id => state.scored.find(c => c.id === id) || state.companies.find(c => c.id === id)).filter(Boolean);
  if (rows.length === 0) return alert('保存リストが空です');
  logAction('csv_export_saved', `${rows.length}件`);
  saveStore();
  downloadFile(`tell-saved-${Date.now()}.csv`, toCsv(rows));
}

/* ============ 反復発見: Top結果から類似企業を追加発見 ============ */
async function discoverSimilarToTop() {
  if (!state.icp || state.scored.length === 0) {
    alert('先に商材を分析してください');
    return;
  }
  const top = state.scored.filter(c => c.score >= 70).slice(0, 5);
  if (top.length === 0) {
    alert('適合度70+の企業がありません。もう一度検索してください');
    return;
  }
  const productText = document.getElementById('product-input').value.trim();
  if (!productText) return;
  if (isBillingCapped()) { alert('月額利用上限到達'); return; }
  const btn = document.getElementById('discover-similar-btn');
  const origLabel = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = '🔁 類似発見中…'; }
  const progEl = document.getElementById('discovery-progress');
  if (progEl) {
    progEl.hidden = false;
    progEl.classList.remove('done', 'error');
    progEl.textContent = `🔁 Top${top.length}社に類似する企業を探索中…`;
  }
  try {
    // AIに「これらの会社に似た会社を探すクエリ」を生成させる
    const sys = `あなたはB2Bリードジェネレーションの専門家です。
ユーザーが高評価した既存企業群の共通パターンを分析し、似た企業を新たに発見するための検索クエリを生成します。`;
    const profileList = top.map((c, i) =>
      `${i+1}. ${c.name} / ${c.industry||'?'} / ${c.prefecture||'?'}${c.city||''} / ${c.employees||'?'}名 / ${c.ai_fit_evidence||c.description?.slice(0,80)||'?'}`
    ).join('\n');
    const prompt = `# 商材
${productText}

# 高評価された既存企業 (これらの「類型」を探す)
${profileList}

# タスク
上記企業の共通項を分析し、同じような特徴を持つ「まだ未発見の」企業を Brave Search で見つけるためのクエリを10個生成。
- 上記企業の業種・地域・規模パターンに合うクエリ
- 共通する課題/シグナルを反映したクエリ
- すでに発見された会社名は除外する旨を含める

JSONのみで返答:
["クエリ1", "クエリ2", ...]`;

    const text = await callClaude({
      system: sys, prompt,
      model: 'claude-opus-4-7',
      max_tokens: 2000,
      thinking: { type: 'enabled', budget_tokens: 4000 },
      temperature: 1.0,
    });
    incrementUsage('ai', 3);
    const m = text.match(/\[[\s\S]*?\]/);
    if (!m) throw new Error('クエリ生成失敗');
    const queries = JSON.parse(m[0]);
    if (!Array.isArray(queries) || queries.length === 0) throw new Error('クエリ生成失敗');

    // 通常のディスカバリーパイプラインに投入
    const found = await discoverFromBrave(productText, state.icp, msg => {
      if (progEl) progEl.textContent = `🔁 ${msg}`;
    }, { queries: queries.slice(0, 10), maxQueries: 10 });

    if (progEl) {
      progEl.classList.add('done');
      progEl.textContent = `✓ 類似発見完了: ${found.length}社追加`;
    }
  } catch (e) {
    console.error(e);
    if (progEl) {
      progEl.classList.add('error');
      progEl.textContent = `類似発見失敗: ${e.message}`;
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origLabel; }
  }
}

/* ============ 品質サマリーパネル ============ */
function renderQualitySummary(filteredList) {
  const panel = document.getElementById('quality-summary');
  if (!panel) return;
  const list = filteredList || [];
  if (list.length === 0) { panel.style.display = 'none'; return; }
  panel.style.display = '';
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText('qs-total', list.length);
  setText('qs-high', list.filter(c => c.score >= 80).length);
  setText('qs-mid', list.filter(c => c.score >= 50 && c.score < 80).length);
  setText('qs-comp', list.filter(c => c.is_competitor).length);
  setText('qs-houjin', list.filter(c => c.houjin_bangou).length);
  setText('qs-active', list.filter(c => c.activeness === 'active').length);
  setText('qs-deep', list.filter(c => c._used_deep_eval).length);
  const avg = list.length > 0 ? Math.round(list.reduce((s, c) => s + (c.score||0), 0) / list.length) : 0;
  setText('qs-avg', avg);
}

/* ============ 商材プロファイル自動進化 ============ */
// 検索を重ねるたびに「この商材のターゲット像」を実例から学習・refine する。
// 商談化・保存・👍 された企業の特徴 vs DNC・👎 された企業の特徴 を AI に渡し、
// 次回検索クエリ・ICP・評価基準を継続的に改善する。

async function evolveProductProfile(productText) {
  if (!productText || (!store.opts.aiKey && !store.opts.braveProxy)) return null;
  // 正例: 商談化 + 保存 + 👍
  const positives = [];
  // 負例: DNC + 👎
  const negatives = [];
  const allCompanies = getAllCompanies();
  for (const c of allCompanies) {
    if (c.ai_scored_for && c.ai_scored_for.slice(0,60) !== productText.slice(0,60)) continue;
    const id = c.id;
    const fb = store.feedback?.[id]?.rating;
    const isMeeting = store.status?.[id] === 'meeting';
    const isSaved = store.saved.has(id);
    const isDnc = store.dnc.has(id);
    const isRejected = store.status?.[id] === 'rejected';
    if (isMeeting || fb === 'good' || (isSaved && !isDnc)) {
      positives.push(c);
    } else if (isDnc || fb === 'bad' || isRejected) {
      negatives.push(c);
    }
  }
  if (positives.length === 0 && negatives.length === 0) return null;

  const profile = (label, list) => list.slice(0, 8).map((c, i) =>
    `${i+1}. ${c.name} (${c.industry||'?'} / ${c.prefecture||''}${c.city||''} / ${c.employees||'?'}名) - ${c.ai_fit_evidence || c.description?.slice(0,60) || ''}`
  ).join('\n');

  const sys = `あなたはB2B営業の戦略アナリストです。
ユーザーの過去の営業活動結果(正例: 商談化/保存、負例: DNC/拒否)から、
理想顧客像(ICP)と検索戦略を改善します。`;
  const prompt = `# 商材
${productText}

# 正例 (商談化・保存・高評価) ${positives.length}社
${profile('positives', positives) || '(なし)'}

# 負例 (DNC・拒否・低評価) ${negatives.length}社
${profile('negatives', negatives) || '(なし)'}

# タスク
これら実例から、この商材の「真の理想顧客像」を抽出してください。
- 正例の共通項(業種・規模・特徴)
- 負例の共通項(避けるべきパターン)
- 次回検索で意識すべき差別化ポイント

JSONのみで返答:
{
  "refined_industries": ["真に有望な業種3-6個"],
  "refined_sizes": ["small|mid|large"],
  "refined_pains": ["実例から推定される課題3-5個"],
  "refined_keywords": ["有効な検索キーワード5-8個"],
  "avoid_patterns": ["避けるべき業種・パターン3-5個"],
  "insights": "30字以内の戦略インサイト",
  "search_strategy_tweaks": ["次回検索クエリ改善案2-4個"]
}`;

  try {
    const text = await callClaude({
      system: sys, prompt,
      model: 'claude-opus-4-7',
      max_tokens: 2500,
      thinking: { type: 'enabled', budget_tokens: 6000 },
      temperature: 1.0,
    });
    incrementUsage('ai', 3);
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const obj = JSON.parse(m[0]);
    return obj;
  } catch (e) {
    console.warn('evolveProductProfile failed', e);
    return null;
  }
}

// ICP を進化版で更新する (ユーザー確認後)
function applyEvolvedProfile(evolved) {
  if (!evolved || !state.icp) return;
  if (Array.isArray(evolved.refined_industries) && evolved.refined_industries.length > 0) {
    state.icp.industries = evolved.refined_industries.slice(0, 8);
  }
  if (Array.isArray(evolved.refined_sizes) && evolved.refined_sizes.length > 0) {
    state.icp.sizes = evolved.refined_sizes;
  }
  if (Array.isArray(evolved.refined_pains) && evolved.refined_pains.length > 0) {
    state.icp.pains = evolved.refined_pains;
  }
  if (Array.isArray(evolved.refined_keywords) && evolved.refined_keywords.length > 0) {
    state.icp.keywords = evolved.refined_keywords;
  }
  if (Array.isArray(evolved.avoid_patterns)) {
    state.icp.anti_patterns = evolved.avoid_patterns;
  }
  logAction('icp_evolved', evolved.insights || '');
  saveStore();
  renderICP(state.icp);
}

/* ============ ユーザーフィードバック (AI 自己改善ループ) ============ */
function recordFeedback(companyId, rating, scoreCorrection = null, comment = '') {
  if (!store.feedback) store.feedback = {};
  store.feedback[companyId] = { rating, score_correction: scoreCorrection, comment, t: Date.now() };
  logAction(`feedback_${rating}`, companyId);
  saveStore();
  renderResults(); // バッジ更新
}

// 高品質フィードバック(👍/👎)を Few-shot Examples として AI prompt に注入
// これにより次回以降の評価精度がユーザー特有の文脈に最適化される
function buildFewShotFromFeedback(productText, limit = 3) {
  if (!store.feedback) return '';
  const fbEntries = Object.entries(store.feedback)
    .filter(([id, fb]) => fb.rating && (fb.comment || fb.score_correction))
    .map(([id, fb]) => ({ id: parseInt(id, 10), ...fb }))
    .sort((a, b) => b.t - a.t)
    .slice(0, limit);

  if (fbEntries.length === 0) return '';

  const lines = [];
  lines.push('\n## ユーザーフィードバックからのキャリブレーション例');
  lines.push('(過去にユーザーが正/誤と評価したケース。これらの判定基準を踏襲してください)');
  for (const fb of fbEntries) {
    const c = findCompanyById(fb.id);
    if (!c) continue;
    const judgment = fb.rating === 'good' ? '✓ 正しい評価' : '✗ 誤った評価';
    const correction = fb.score_correction !== null ? `(正しいスコア: ${fb.score_correction})` : '';
    const comment = fb.comment ? ` / ユーザーコメント: 「${fb.comment}」` : '';
    lines.push(`- ${c.name} (${c.industry||'?'}) → AI評価${c.ai_score||'?'}点 ${judgment} ${correction}${comment}`);
  }
  return lines.join('\n') + '\n';
}

/* ============ スコア詳細モーダル ============ */
function openScoreDetailModal(companyId) {
  const c = findCompanyById(companyId) || state.scored.find(x => x.id === companyId);
  if (!c) return;
  const modal = document.getElementById('score-detail-modal');
  document.getElementById('sd-company-name').textContent = c.name || '(名称不明)';
  const metaParts = [];
  if (c.houjin_bangou) metaParts.push(`法人番号: ${c.houjin_bangou}`);
  if (c.address) metaParts.push(`📍 ${c.address}`);
  else if (c.prefecture) metaParts.push(`📍 ${c.prefecture}${c.city||''}`);
  if (c.phone) metaParts.push(`☎ ${c.phone}`);
  if (c.industry) metaParts.push(`業種: ${c.industry}`);
  if (c.employees) metaParts.push(`従業員: ${c.employees}名`);
  document.getElementById('sd-meta').innerHTML = metaParts.join(' / ') +
    (c.website ? ` <a href="${c.website}" target="_blank">🔗 HP</a>` : '');

  document.getElementById('sd-score-num').textContent = c.score || '--';
  document.getElementById('sd-score-num').className = scoreClass(c.score);
  const conf = c.ai_confidence ? `確信度: ${({low:'低',medium:'中',high:'高'}[c.ai_confidence]||c.ai_confidence)}` : '';
  const usedDeep = c._used_deep_eval ? ' / 🧠 Opus深評価' : '';
  const reranked = c._reranked ? ' / 🏆 リランキング適用' : '';
  document.getElementById('sd-score-conf').textContent = `${conf}${usedDeep}${reranked}`;

  // Dimensions barchart
  let dimHtml = '';
  if (c.ai_dimensions) {
    const d = c.ai_dimensions;
    const items = [
      ['region_match', '地域マッチ'],
      ['industry_match', '業種マッチ'],
      ['size_match', '規模マッチ'],
      ['timing_signal', 'タイミング'],
      ['evidence_strength', '根拠強度'],
      ['pain_alignment', '課題合致'],
    ];
    dimHtml = '<h4>📊 スコア内訳</h4><div style="display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;font-size:12px">';
    for (const [k, label] of items) {
      const v = d[k] || 0;
      const color = v >= 70 ? 'var(--good)' : v >= 40 ? 'var(--mid)' : 'var(--danger)';
      dimHtml += `
        <span>${label}</span>
        <div style="background:var(--bg);border-radius:4px;height:12px;overflow:hidden">
          <div style="width:${v}%;height:100%;background:${color}"></div>
        </div>
        <span style="font-weight:600;color:${color};min-width:35px">${v}</span>`;
    }
    dimHtml += '</div>';
  }
  document.getElementById('sd-dimensions').innerHTML = dimHtml;

  // Detail sections
  const sections = [];
  if (c.is_competitor) {
    sections.push(`<div style="background:rgba(220,0,0,.08);padding:12px;border-radius:6px;border-left:3px solid var(--danger);margin-bottom:12px"><strong style="color:var(--danger)">⛔ 競合企業</strong><br><small>${c.competitor_evidence || '同種商材を販売中'}</small></div>`);
  }
  if (c.ai_fit_evidence) {
    sections.push(`<h4>💡 適合根拠</h4><p>${c.ai_fit_evidence}</p>`);
  }
  if (Array.isArray(c.ai_fit_citations) && c.ai_fit_citations.length > 0) {
    sections.push('<h4>📚 HPからの引用 (根拠)</h4><ul style="font-size:13px">' +
      c.ai_fit_citations.map(ct => `<li><strong>「${ct.quote||''}」</strong><br><small style="color:var(--muted)">→ ${ct.why||''}</small></li>`).join('') + '</ul>');
  }
  if (Array.isArray(c.ai_buying_signals) && c.ai_buying_signals.length > 0) {
    sections.push('<h4>🎯 購買シグナル</h4><div style="display:flex;flex-wrap:wrap;gap:6px">' +
      c.ai_buying_signals.map(s => `<span class="meta-tag good">${s}</span>`).join('') + '</div>');
  }
  if (Array.isArray(c.ai_talking_points) && c.ai_talking_points.length > 0) {
    sections.push('<h4>📞 架電トピック</h4><ol style="font-size:13px">' +
      c.ai_talking_points.map(t => `<li>${t}</li>`).join('') + '</ol>');
  }
  if (Array.isArray(c.ai_decision_makers) && c.ai_decision_makers.length > 0) {
    sections.push('<h4>👤 決裁者候補</h4><ul style="font-size:13px">' +
      c.ai_decision_makers.map(d => `<li>${d.title || ''}${d.name ? ': ' + d.name : ''}</li>`).join('') + '</ul>');
  }
  if (Array.isArray(c.ai_risks) && c.ai_risks.length > 0) {
    sections.push('<h4>⚠ リスク</h4><ul style="font-size:13px;color:var(--mid)">' +
      c.ai_risks.map(r => `<li>${r}</li>`).join('') + '</ul>');
  }
  if (c.activeness) {
    const actLabel = { active: '✓ アクティブ', maybe_active: '◯ おそらく活動中', inactive: '⚠ 活動停止シグナル検出', unknown: '? 不明' }[c.activeness];
    sections.push(`<h4>⚡ 活動性</h4><p>${actLabel} / シグナル: ${(c.activeness_signals||[]).join('、') || 'なし'}</p>`);
  }
  if (typeof c.credibility_score === 'number') {
    sections.push(`<h4>🛡 HP信頼性</h4><p>スコア: ${c.credibility_score}/100<br><small style="color:var(--muted)">${(c.credibility_signals||[]).join('、')}</small></p>`);
  }
  if (c.official_address) {
    sections.push(`<h4>🆔 国税庁登記情報</h4><p>正式名: ${c.official_name || c.name}<br>本店所在地: ${c.official_address}<br>法人番号: ${c.houjin_bangou}</p>`);
  }
  if (typeof c.cross_source_count === 'number') {
    const verifyLabel = { strong: '✓ 強く実在 (5+ 外部参照)', normal: '◯ 標準 (2-4 外部参照)', weak: '⚠ 参照希薄 (1未満)' }[c._verification] || '';
    sections.push(`<h4>🌐 クロスソース検証</h4><p>${verifyLabel}<br>外部参照ドメイン数: ${c.cross_source_count} サイト</p>`);
  }
  if (Array.isArray(c.recent_news) && c.recent_news.length > 0) {
    sections.push('<h4>📰 最新ニュース・トピック</h4><ul style="font-size:12px">' +
      c.recent_news.map(n => `<li><a href="${n.url}" target="_blank">${n.title}</a><br><small style="color:var(--muted)">${n.snippet}</small></li>`).join('') + '</ul>');
  }
  if (Array.isArray(c.ai_news_talking_points) && c.ai_news_talking_points.length > 0) {
    sections.push('<h4>💬 ニュースベースの架電トピック</h4><ul style="font-size:13px">' +
      c.ai_news_talking_points.map(t => `<li>${t}</li>`).join('') + '</ul>');
  }
  if (c.ai_score_pre_rerank && c.ai_score_pre_rerank !== c.ai_score) {
    sections.push(`<h4>🏆 リランキング</h4><p>個別評価: ${c.ai_score_pre_rerank}点 → リランキング後: ${c.ai_score}点<br><small>${c.ai_rerank_reason || ''}</small></p>`);
  }
  // 高スコア(>=70)企業には メール / スクリプト生成ボタンを追加
  if ((c.score || 0) >= 60 && (store.opts.aiKey || store.opts.braveProxy)) {
    sections.push(`
      <h4>✉ アクション</h4>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="sd-gen-email" class="ghost small">📧 メール文案を生成</button>
        <button id="sd-gen-script" class="ghost small">📜 架電スクリプトを生成</button>
      </div>
      <div id="sd-generated" style="margin-top:12px"></div>
    `);
  }
  document.getElementById('sd-content').innerHTML = sections.join('');
  modal.hidden = false;
  // ボタン配線
  const genEmailBtn = document.getElementById('sd-gen-email');
  if (genEmailBtn) genEmailBtn.addEventListener('click', async () => {
    genEmailBtn.disabled = true; genEmailBtn.textContent = '生成中…';
    try {
      const text = await aiOutreachEmail(c, document.getElementById('product-input').value.trim(), state.strategy || {});
      document.getElementById('sd-generated').innerHTML = `<h4>📧 生成されたメール</h4><pre style="background:var(--bg);padding:12px;border-radius:6px;white-space:pre-wrap;font-size:13px">${text.replace(/</g,'&lt;')}</pre><button id="sd-copy-email" class="ghost small">📋 コピー</button>`;
      document.getElementById('sd-copy-email').addEventListener('click', () => {
        navigator.clipboard.writeText(text);
        document.getElementById('sd-copy-email').textContent = '✓ コピー済';
      });
    } catch (e) {
      document.getElementById('sd-generated').innerHTML = `<div style="color:var(--danger)">失敗: ${e.message}</div>`;
    } finally {
      genEmailBtn.disabled = false; genEmailBtn.textContent = '📧 メール文案を生成';
    }
  });
  const genScriptBtn = document.getElementById('sd-gen-script');
  if (genScriptBtn) genScriptBtn.addEventListener('click', async () => {
    genScriptBtn.disabled = true; genScriptBtn.textContent = '生成中…';
    try {
      const text = await aiScript(c, document.getElementById('product-input').value.trim(), state.icp || {}, state.strategy || {});
      document.getElementById('sd-generated').innerHTML = `<h4>📜 生成された架電スクリプト</h4><pre style="background:var(--bg);padding:12px;border-radius:6px;white-space:pre-wrap;font-size:13px">${text.replace(/</g,'&lt;')}</pre><button id="sd-copy-script" class="ghost small">📋 コピー</button>`;
      document.getElementById('sd-copy-script').addEventListener('click', () => {
        navigator.clipboard.writeText(text);
        document.getElementById('sd-copy-script').textContent = '✓ コピー済';
      });
    } catch (e) {
      document.getElementById('sd-generated').innerHTML = `<div style="color:var(--danger)">失敗: ${e.message}</div>`;
    } finally {
      genScriptBtn.disabled = false; genScriptBtn.textContent = '📜 架電スクリプトを生成';
    }
  });
}

function setupScoreDetailModal() {
  const modal = document.getElementById('score-detail-modal');
  if (!modal) return;
  document.getElementById('sd-close').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; });
  // 結果テーブルのスコアクリックで開く (イベント委譲)
  document.body.addEventListener('click', e => {
    const t = e.target.closest('.score-clickable');
    if (t) {
      const id = parseInt(t.dataset.detailId, 10);
      if (id) openScoreDetailModal(id);
    }
  });
}

/* ============ 利用規約モーダル ============ */
function showTosModal(force = false) {
  const modal = document.getElementById('tos-modal');
  if (!modal) return;
  // 強制再表示時は同意状態をリセット表示しない
  const cb = document.getElementById('tos-checkbox');
  const agree = document.getElementById('tos-agree');
  if (cb) cb.checked = false;
  if (agree) agree.disabled = true;
  modal.hidden = false;
  // 「再表示」モードでは「同意しない」ボタンを「閉じる」に変える
  const decline = document.getElementById('tos-decline');
  if (decline) decline.textContent = force ? '閉じる' : '同意しない（利用中止）';
}

function setupTosModal() {
  const cb = document.getElementById('tos-checkbox');
  const agree = document.getElementById('tos-agree');
  const decline = document.getElementById('tos-decline');
  if (!cb || !agree || !decline) return;
  cb.addEventListener('change', () => { agree.disabled = !cb.checked; });
  agree.addEventListener('click', () => {
    if (!cb.checked) return;
    store.tosAccepted = true;
    store.tosAcceptedAt = Date.now();
    logAction('tos_accepted', '同意');
    saveStore();
    document.getElementById('tos-modal').hidden = true;
  });
  decline.addEventListener('click', () => {
    // 同意済みなら閉じるだけ、未同意なら警告して機能ロック
    if (store.tosAccepted) {
      document.getElementById('tos-modal').hidden = true;
    } else {
      alert('利用規約への同意が必要です。同意いただけない場合、検索機能は使用できません。');
      document.getElementById('tos-modal').hidden = true;
    }
  });
  // 初回起動時に同意なしなら表示
  if (!store.tosAccepted) {
    setTimeout(() => showTosModal(false), 300);
  }
}

function requireTosAccepted() {
  if (store.tosAccepted) return true;
  showTosModal(false);
  return false;
}

function exportUsageLog() {
  const log = store.usageLog || [];
  if (log.length === 0) return alert('使用ログがありません');
  const header = 'timestamp,action,reference,meta\n';
  const body = log.map(e => {
    const ts = new Date(e.t).toISOString();
    return [ts, e.action, e.ref || '', e.meta || ''].map(v => `"${String(v).replace(/"/g,'""')}"`).join(',');
  }).join('\n');
  downloadFile(`tell-usage-log-${Date.now()}.csv`, header + body);
}

function exportAll() {
  const data = {
    saved: [...store.saved], dnc: [...store.dnc],
    status: store.status, notes: store.notes,
    history: store.history, opts: store.opts,
    exportedAt: new Date().toISOString(),
  };
  downloadFile(`tell-backup-${Date.now()}.json`, JSON.stringify(data, null, 2), 'application/json');
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const d = JSON.parse(e.target.result);
      if (Array.isArray(d.saved)) store.saved = new Set(d.saved);
      if (Array.isArray(d.dnc)) store.dnc = new Set(d.dnc);
      if (d.status) store.status = d.status;
      if (d.notes) store.notes = d.notes;
      if (Array.isArray(d.history)) store.history = d.history;
      if (d.opts) store.opts = { ...store.opts, ...d.opts };
      saveStore();
      renderResults();
      renderSidebar();
      alert('取込完了');
    } catch (err) { alert('JSON取込に失敗: ' + err.message); }
  };
  reader.readAsText(file);
}

/* ============ Claude API (BYOK) ============ */
async function callClaude({ system, prompt, messages, max_tokens = 1024, model, thinking, temperature }) {
  const msgs = messages || [{ role: 'user', content: prompt }];
  const body = {
    model: model || store.opts.aiModel || 'claude-haiku-4-5-20251001',
    max_tokens,
    system,
    messages: msgs,
  };
  if (thinking) body.thinking = thinking;
  if (temperature !== undefined) body.temperature = temperature;

  // Worker proxy 経由(推奨) - WorkerにANTHROPIC_API_KEYまたはAI bindingがあれば動作
  if (store.opts.braveProxy) {
    const url = `${store.opts.braveProxy.replace(/\/+$/, '')}/llm/chat`;
    try {
      const wres = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (wres.ok) {
        const data = await wres.json();
        // extended thinking 使用時は content[] に複数ブロック(thinking + text)が来る
        // text ブロックの結合を返す
        const textBlocks = (data.content || []).filter(b => b.type === 'text');
        if (textBlocks.length > 0) return textBlocks.map(b => b.text || '').join('');
        return data.content?.[0]?.text || '';
      }
      // Workerが失敗 → ブラウザ直接キーがあればフォールバック
      const errText = await wres.text();
      if (!store.opts.aiKey) {
        // クォータ超過の場合は分かりやすいメッセージ
        if (/4006|neurons|daily free allocation/i.test(errText)) {
          throw new Error('Workers AIの1日無料枠(10,000ニューロン)を使い切りました。日本時間9:00にリセットされます。継続利用するにはサイドバー🤖 AI設定でAnthropic APIキーを設定するか、CloudflareでWorkers Paidプラン($5/月)に加入してください');
        }
        throw new Error(`Worker LLM ${wres.status}: ${errText.slice(0,150)}`);
      }
    } catch (e) {
      if (!store.opts.aiKey) throw e;
    }
  }

  // ブラウザ直接(BYOK)
  if (!store.opts.aiKey) {
    throw new Error('LLM未設定。WorkerにANTHROPIC_API_KEYを追加するか、サイドバー「🤖 AI設定」でAPIキーを入力してください');
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': store.opts.aiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Claude API ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const textBlocks = (data.content || []).filter(b => b.type === 'text');
  if (textBlocks.length > 0) return textBlocks.map(b => b.text || '').join('');
  return data.content?.[0]?.text || '';
}

/* ============ Brave Search (browser direct) ============ */
const BRAVE_EXCLUDED_DOMAINS = new Set([
  'asahi.com','nikkei.com','mainichi.jp','yomiuri.co.jp','sankei.com',
  // 求人ポータル
  'rikunabi.com','mynavi.jp','indeed.com','doda.jp','type.jp',
  'baitoru.com','townwork.net','wantedly.com','green-japan.com',
  'an.shopowner-pro.jp','workport.co.jp','pasona.co.jp',
  'job-medley.com','careercross.com','en-japan.com','enbiz.en-japan.com',
  'rikuami.com','tenshoku.mynavi.jp','agent.mynavi.jp',
  'kosaten.jp','jp-talent.com','baitos.jp','baitoex-mag.com',
  'pasonacareer.jp','careercarver.jp','findjob.jp','jobsearch.mhlw.go.jp',
  'engage.cloud','careerpark.jp','kojincojin.jp','tenshoku-antenna.com',
  '8mato.jp','x-recruit.jp','hellowork.mhlw.go.jp','salaryman.work',
  'kosaten.com','jobquicker.com','recruit-agent.com','levtech-rookie.jp',
  // ECモール・口コミ
  'rakuten.co.jp','amazon.co.jp','yahoo.co.jp','google.com','google.co.jp',
  'tabelog.com','hotpepper.jp','gnavi.co.jp','retty.me','kakaku.com',
  // 情報サイト
  'wikipedia.org','wikiwand.com','note.com','qiita.com','zenn.dev',
  // SNS
  'facebook.com','twitter.com','x.com','instagram.com','linkedin.com',
  'youtube.com','tiktok.com','jp.linkedin.com',
  // プレスリリース
  'prtimes.jp','atpress.ne.jp','dreamnews.jp','valuepress.com',
  // 業者DB
  'houjin-bangou.nta.go.jp','search.brave.com',
  'baseconnect.in','musubu.in','bizmaps.jp','onecareer.jp',
  // SEO上位を独占する比較・ランキング・大手メディア(中小法人HPを見つけにくくする)
  'all-senmonka.jp','startup-db.com','salesnow.com','salesnow.jp',
  'mitsuri.co','techport.co.jp','manufacturing-base.com',
  'oricon.co.jp','itreview.jp','boxil.jp','bizhint.jp','bplats.com',
  'mynavi-agent.jp','beyondteam.jp','recruit-direct-scout.jp',
  'tenshoku.co.jp','levtech-rookie.jp','levtech-career.jp',
  'gmedia.jp','navi-pro.jp','smartcompany.jp',
]);

function rootDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}
function generateFilteredQueries(productText, icp, filters, round = 0) {
  const queries = [];
  const { industry } = filters || {};
  const prefectures = Array.isArray(filters?.prefectures) ? filters.prefectures
    : (filters?.prefecture ? [filters.prefecture] : []);
  const cities = Array.isArray(filters?.cities) ? filters.cities
    : (filters?.city ? [filters.city] : []);

  // Brave検索演算子を活用した高精度クエリパターン
  // intitle:会社概要 → 公式HPの会社概要ページに集中
  // -intitle:ランキング 比較 → 比較記事を除外
  const QUERY_PATTERNS = [
    // 公式HP集中型 (intitle で会社概要ページに絞る)
    (ind, loc) => `intitle:会社概要 "${ind}" "${loc}" -intitle:ランキング -intitle:比較`,
    // 代表電話付きで本社ページ狙い
    (ind, loc) => `"${ind}" "${loc}" "代表電話" -intitle:とは -intitle:選び方`,
    // 採用ページ経由 (中堅以上が出やすい)
    (ind, loc) => `"${ind}" "${loc}" intitle:採用情報 -intitle:ランキング`,
    // 事業所一覧 (拠点持つ会社)
    (ind, loc) => `"${ind}" "${loc}" "事業所" OR "営業所" 株式会社`,
    // 沿革+設立 (老舗企業)
    (ind, loc) => `"${ind}" "${loc}" "沿革" "設立" 株式会社`,
    // 工場(製造業向け)
    (ind, loc) => `"${ind}" "${loc}" 工場 "代表電話"`,
    // 取引先掲載(B2B)
    (ind, loc) => `"${ind}" "${loc}" "取引先" OR "実績" -intitle:ランキング`,
  ];

  const targetIndustries = industry ? [industry] : (icp?.industries || []).slice(0, 4);
  const targetCityKeys = cities.length > 0 ? cities : prefectures;

  if (targetCityKeys.length === 0) {
    // 地域指定なし
    for (const ind of targetIndustries) {
      for (let pi = 0; pi < 3; pi++) {
        const pat = QUERY_PATTERNS[(round + pi) % QUERY_PATTERNS.length];
        queries.push(pat(ind, '日本'));
      }
    }
  } else {
    for (const ind of targetIndustries) {
      for (const key of targetCityKeys) {
        const [pref, city] = key.includes('/') ? key.split('/') : [key, ''];
        const locStr = city || pref;
        // 1地域あたり2-3パターンで網羅性UP
        for (let pi = 0; pi < 3; pi++) {
          const pat = QUERY_PATTERNS[(round + pi) % QUERY_PATTERNS.length];
          queries.push(pat(ind, locStr));
        }
      }
    }
  }
  return [...new Set(queries.filter(q => q.trim()))];
}

const ARTICLE_KEYWORDS = [
  'とは', '選び方', '比較', 'ランキング', 'おすすめ', 'まとめ',
  '解説', '違い', 'メリット', 'デメリット', '徹底', '入門',
  'ガイド', '初心者', '完全', '〜つ', '社ご紹介', '一覧',
  '5選', '10選', '20選', '30選', '50選',
  '人気', '評判', 'レビュー', '口コミ', 'クチコミ',
];

const NOISE_URL_PATTERNS = [
  /\/blog(s)?\//, /\/article(s)?\//, /\/column(s)?\//, /\/news\//, /\/media\//,
  /\/guide\//, /\/post(s)?\//, /\/ranking\//, /\/howto\//, /\/topics\//,
  /\/magazine\//, /\/research\//, /\/whitepaper\//,
];

const STRONG_ARTICLE_PATTERNS = [
  /とは[？\?]/, // とは? がどこかにある
  /徹底.{0,5}(比較|解説|ガイド)/,
  /完全.{0,5}(ガイド|網羅|版)/,
  /おすすめ.{0,8}\d+選/, /厳選.{0,8}\d+選/,
  /ランキング/, /の選び方/, /の方法$/,
  /解説[!！]/, /わかりやすく解説/, /問題点.{0,10}解説/,
  /違いを.{0,8}(解説|まとめ|紹介)/,
  /メリット.{0,3}デメリット/,
  /\d+選[!！]?$/,
  /の問題点/, /の対応ポイント/, /の課題と/,
  /って何/, /ってなに/,
];

function migrateCleanCompanies() {
  let cleanedCount = 0;
  let removedCount = 0;
  ['importedCompanies', 'customCompanies'].forEach(key => {
    const list = store[key] || [];
    const kept = [];
    for (const c of list) {
      const newName = cleanCompanyName(c.name);
      if (newName !== c.name) {
        c.name = newName;
        cleanedCount++;
      }
      // 名前が記事タイトルや空、または法人格を含まないものは削除
      if (!c.name || isGenericName(c.name) || looksLikeArticle(c.name, c.source_url || c.website, c.description || '')) {
        removedCount++;
        continue;
      }
      kept.push(c);
    }
    store[key] = kept;
  });
  if (cleanedCount > 0 || removedCount > 0) {
    console.log(`migration: ${cleanedCount}社の名前を整形、${removedCount}社の記事/汎用エントリを削除`);
    saveStore();
  }
}

function cleanCompanyName(name) {
  if (!name) return '';
  let cleaned = String(name).replace(/&amp;/g, '&').trim();
  // ポータル経由のタイトルから会社名抜き出し
  cleaned = cleaned.replace(/(の求人.*|の採用情報.*|の採用.*|の仕事.*|の転職.*|の中途.*|\s*[\|｜]\s*(求人|採用|転職|マイナビ|リクナビ|Indeed|エン転職|doda|type|エン・ジャパン).*)$/i, '').trim();
  return cleaned;
}

function looksLikeArticle(title, url, desc) {
  const text = `${title || ''} ${desc || ''}`;
  if (url && NOISE_URL_PATTERNS.some(re => re.test(url))) return true;
  if (STRONG_ARTICLE_PATTERNS.some(re => re.test(title || ''))) return true;
  let count = 0;
  for (const kw of ARTICLE_KEYWORDS) {
    if (text.includes(kw)) count++;
    if (count >= 2) return true;
  }
  return false;
}

const GENERIC_NAMES = new Set([
  '製造業', '建設業', '卸売・小売業', '飲食業', '運輸業',
  '情報通信業', '金融・保険業', '不動産業', '医療・福祉',
  '教育・学習支援', '宿泊・サービス業', 'サービス業', '農林水産業',
  '会社案内', '事業内容', '採用情報', '会社概要',
  'お問い合わせ', '企業情報', '法人案内', 'ホーム', 'TOP',
]);

function isGenericName(name) {
  if (!name) return true;
  const n = name.trim();
  if (n.length < 3) return true;
  if (GENERIC_NAMES.has(n)) return true;
  // 末尾が「求人/仕事/採用/転職/募集」のみ → ポータル経由のページ
  if (/(求人|仕事|採用|転職|募集)$/.test(n) && !/(株式会社|合同会社|有限会社)/.test(n)) return true;
  // 「○○ナビ」「○○サイト」「○○ガイド」など
  if (/(ナビ|サイト|ガイド|ポータル|サーチ|まとめ|一覧)$/.test(n) && n.length < 15) return true;
  return false;
}

function isLikelyRealCompany(c) {
  // 名前自体が記事タイトルっぽければ除外
  if (looksLikeArticle(c.name, c.source_url || c.website, c.description)) return false;
  if (isGenericName(c.name)) return false;
  // クリーンした名前で法人格判定
  const cleanedName = cleanCompanyName(c.name);
  const corpRe = /(株式会社|合同会社|有限会社|医療法人|社会福祉法人|NPO法人|一般社団法人|学校法人|宗教法人|協同組合|Inc\.?|Corp\.?|LLC|Co\.,?\s?Ltd|Group|Company)/i;
  return corpRe.test(cleanedName);
}
function isExcludedDomain(url) {
  const d = rootDomain(url);
  for (const ex of BRAVE_EXCLUDED_DOMAINS) {
    if (d === ex || d.endsWith('.' + ex)) return true;
  }
  return false;
}

const PHONE_RE_JS = /(?<![0-9])(?:0(?:120|800|570)|0\d{1,3})[-(ー－（]?\d{1,4}[-)ー－）]?\d{3,4}(?![0-9])/g;
const PHONE_HINT_RE = /(TEL|Tel|tel|電話|☎|代表電話|Phone|FAX|FAX番号)/;

function normalizePhoneStr(s) {
  return String(s).replace(/[ー－（）｜ーｰ]/g, c => ({'ー':'-','－':'-','（':'(','）':')'}[c]||c));
}

function isValidJapanesePhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 11) return false;
  if (!digits.startsWith('0')) return false;
  // 携帯 070/080/090: 11桁
  if (/^0[789]0/.test(digits) && digits.length !== 11) return false;
  // 固定電話: 10桁
  if (!/^0[789]0/.test(digits) && digits.length !== 10) return false;
  return true;
}

// 個人携帯(070/080/090)への営業電話は特商法/個人情報保護法上のリスクが高いため、
// 収集段階で常に弾く(コンプライアンス遵守のため OFF にできない設計)
function isMobilePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return /^0[789]0/.test(digits);
}

function isAcceptablePhone(raw) {
  if (!isValidJapanesePhone(raw)) return false;
  // 個人携帯は常に除外(コンプラ強制)
  if (isMobilePhone(raw)) return false;
  // DNCに登録された番号は再収集も拒否
  if (isPhoneDnc(raw)) return false;
  return true;
}

function normalizePhoneKey(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function isPhoneDnc(raw) {
  const key = normalizePhoneKey(raw);
  if (!key) return false;
  return (store.dncPhones || new Set()).has(key);
}

function extractPhoneFromText(text) {
  if (!text) return '';
  const str = String(text);
  const matches = [...str.matchAll(PHONE_RE_JS)];
  if (matches.length === 0) return '';

  // ヒント付き(TEL/電話/☎の直後)の候補を優先。FAX直後は除外
  const hinted = [];
  const plain = [];
  for (const m of matches) {
    const raw = m[0];
    if (!isAcceptablePhone(raw)) continue;
    const idx = m.index;
    const before = str.slice(Math.max(0, idx - 15), idx);
    // 郵便番号や住所番地っぽいなら除外
    if (/〒|郵便番号/.test(before)) continue;
    if (/(丁目|番地|号|番|区|町|大字)\s*$/.test(before)) continue;
    // FAXは除外
    if (/(FAX|ファクス|ファックス|Fax|fax)/.test(before)) continue;
    if (PHONE_HINT_RE.test(before)) hinted.push(raw);
    else plain.push(raw);
  }
  const pick = hinted[0] || plain[0];
  return pick ? normalizePhoneStr(pick) : '';
}

/* ============ 地域選択 ============ */
function selectedPrefs() { return new Set(store.opts.regionPrefs || []); }
function selectedCities() { return new Set(store.opts.regionCities || []); }

// HPから抽出した本社所在地が、ユーザー選択地域と一致するかチェック
// - 地域未選択 → 常にtrue
// - 都道府県選択あり → companyのprefectureが含まれるならOK
// - 市区町村選択あり → company の prefecture/city が cities[] に含まれるか、
//   または該当都道府県の任意の市にいればOK(緩めの判定)
// - 本社所在地が未抽出 → falseで除外(地域絞り込みしているなら所在不明は信頼しない)
function isRegionMismatch(company) {
  const prefs = selectedPrefs();
  const cities = selectedCities();
  // 地域指定なし → ミスマッチではない
  if (prefs.size === 0 && cities.size === 0) return false;
  // AI が「対象地域外」と明示的に判定したら除外
  if (company._ai_region_reject === true || company.ai_in_target_region === false) return true;
  // 本社所在地が抽出できていない → 地域絞り込み時は除外(精度優先)
  if (!company.prefecture) return true;
  // 都道府県選択: そこに含まれる
  if (prefs.size > 0 && prefs.has(company.prefecture)) return false;
  // 市区町村選択: 厳密一致
  if (cities.size > 0) {
    const key = `${company.prefecture}/${company.city || ''}`;
    if (cities.has(key)) return false;
    // city未抽出なら、都道府県だけでも一致すれば暫定OK
    if (!company.city) {
      for (const c of cities) {
        if (c.startsWith(company.prefecture + '/')) return false;
      }
    }
  }
  return true;
}

function renderRegionChips() {
  const el = document.getElementById('region-chips');
  if (!el) return;
  const prefs = [...selectedPrefs()];
  const cities = [...selectedCities()];
  const total = prefs.length + cities.length;
  if (total === 0) {
    el.innerHTML = '<span class="empty" style="font-size:11px;">未選択（全国対象）</span>';
    return;
  }
  el.innerHTML = [
    ...prefs.map(p => `<span class="region-chip pref">${p}全域<button class="x" data-rm-pref="${p}">×</button></span>`),
    ...cities.map(c => {
      const parts = c.split('/');
      const display = parts[1] || parts[0];
      return `<span class="region-chip">${display}<button class="x" data-rm-city="${c}">×</button></span>`;
    }),
  ].join('');
  el.querySelectorAll('[data-rm-pref]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const p = b.dataset.rmPref;
    store.opts.regionPrefs = (store.opts.regionPrefs || []).filter(x => x !== p);
    saveStore(); renderRegionChips(); renderResults();
  }));
  el.querySelectorAll('[data-rm-city]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const c = b.dataset.rmCity;
    store.opts.regionCities = (store.opts.regionCities || []).filter(x => x !== c);
    saveStore(); renderRegionChips(); renderResults();
  }));
}

function renderRegionTree() {
  const treeEl = document.getElementById('region-tree');
  if (!treeEl || !window.JAPAN_REGIONS) return;
  const search = (document.getElementById('region-search').value || '').trim();
  const prefsSet = selectedPrefs();
  const citiesSet = selectedCities();
  const html = Object.entries(window.JAPAN_REGIONS).map(([pref, cities]) => {
    const allSel = prefsSet.has(pref);
    const cityChips = cities.filter(c => !search || pref.includes(search) || c.includes(search)).map(c => {
      const key = `${pref}/${c}`;
      const sel = citiesSet.has(key);
      return `<span class="region-city ${sel?'selected':''}" data-city-key="${key}">${c}</span>`;
    }).join('');
    if (search && !pref.includes(search) && cityChips === '') return '';
    const openByDefault = search && (pref.includes(search) || cityChips !== '');
    return `<div class="region-pref" data-pref="${pref}" data-open="${openByDefault?'true':'false'}">
      <div class="region-pref-head">
        <span class="toggle"></span>
        <input type="checkbox" class="region-pref-checkbox" data-pref-check="${pref}" ${allSel?'checked':''}>
        <span>${pref}</span>
        <span class="count">${allSel?'全域選択中':`${cities.length}市区`}</span>
      </div>
      <div class="region-cities">${cityChips}</div>
    </div>`;
  }).filter(Boolean).join('');
  treeEl.innerHTML = html;

  treeEl.querySelectorAll('.region-pref-head').forEach(head => {
    head.addEventListener('click', e => {
      if (e.target.matches('input[type="checkbox"]')) return;
      const p = head.parentElement;
      p.dataset.open = p.dataset.open === 'true' ? 'false' : 'true';
    });
  });
  treeEl.querySelectorAll('[data-pref-check]').forEach(cb => {
    cb.addEventListener('click', e => e.stopPropagation());
    cb.addEventListener('change', e => {
      const p = cb.dataset.prefCheck;
      const prefs = new Set(store.opts.regionPrefs || []);
      if (cb.checked) prefs.add(p); else prefs.delete(p);
      store.opts.regionPrefs = [...prefs];
      // 県を選んだら個別市の選択は不要(全域扱い)
      saveStore();
      renderRegionTree();
    });
  });
  treeEl.querySelectorAll('[data-city-key]').forEach(ch => {
    ch.addEventListener('click', () => {
      const key = ch.dataset.cityKey;
      const cs = new Set(store.opts.regionCities || []);
      if (cs.has(key)) cs.delete(key); else cs.add(key);
      store.opts.regionCities = [...cs];
      saveStore();
      ch.classList.toggle('selected');
    });
  });
}

function openRegionModal() {
  const modal = document.getElementById('region-modal');
  if (!modal) return;
  modal.hidden = false;
  document.getElementById('region-search').value = '';
  renderRegionTree();
}

const _braveLastCall = { t: 0 };
async function braveSearchOnce(query, count = 20, offset = 0) {
  const hasProxy = !!store.opts.braveProxy;
  if (!hasProxy && !store.opts.braveKey) throw new Error('プロキシURLかAPIキーを設定してください');

  // 1req/sec を守る
  const delta = Date.now() - _braveLastCall.t;
  if (delta < 1100) await new Promise(r => setTimeout(r, 1100 - delta));
  _braveLastCall.t = Date.now();

  const params = new URLSearchParams({
    q: query, count: String(Math.min(count, 20)),
    country: 'JP', search_lang: 'jp', ui_lang: 'ja-JP',
    result_filter: 'web',
  });
  if (offset > 0) params.set('offset', String(offset));

  let url, headers;
  if (hasProxy) {
    const base = store.opts.braveProxy.replace(/\/+$/, '');
    url = `${base}/search?${params}`;
    headers = { 'Accept': 'application/json' };
  } else {
    url = `https://api.search.brave.com/res/v1/web/search?${params}`;
    headers = {
      'X-Subscription-Token': store.opts.braveKey,
      'Accept': 'application/json',
    };
  }

  let res;
  try {
    res = await fetch(url, { headers });
  } catch (e) {
    if (!hasProxy) {
      throw new Error('CORSエラー: Brave APIはブラウザ直接呼出不可。Cloudflare Workerプロキシを設定してください');
    }
    throw new Error(`プロキシ接続失敗: ${e.message}`);
  }
  if (!res.ok) throw new Error(`Brave API ${res.status}: ${(await res.text()).slice(0,150)}`);
  const data = await res.json();
  incrementUsage('search', 1);
  return (data.web?.results || []);
}

// 複数ページ取得して SEO 上位以外にもリーチする
async function braveSearch(query, count = 10) {
  const pages = Math.max(1, Math.min(4, store.opts.bravePages || 2));
  if (pages === 1) return await braveSearchOnce(query, count, 0);
  const all = [];
  const seenUrls = new Set();
  for (let p = 0; p < pages; p++) {
    let batch;
    try {
      batch = await braveSearchOnce(query, 20, p * 20);
    } catch (e) {
      if (p === 0) throw e;
      console.warn(`brave page ${p+1} failed:`, e.message);
      break;
    }
    if (!batch || batch.length === 0) break;
    for (const r of batch) {
      if (r.url && !seenUrls.has(r.url)) {
        seenUrls.add(r.url);
        all.push(r);
      }
    }
    if (batch.length < 20) break; // これ以上ページがない
  }
  return all;
}

function generateQueriesFromICP(productText, icp, round = 0) {
  const industries = icp?.industries || [];
  const queries = [];
  const seen = new Set();
  // ラウンドごとにキーワードを変えて重複を回避。中小〜中堅にもリーチする長尾クエリを混ぜる。
  const KEYWORD_SETS = [
    ['中小企業 会社概要 代表電話', '株式会社 製造 創業', '従業員 30名 工場'],
    ['公式サイト 沿革', '社長メッセージ 創業', '会社案内 PDF'],
    ['新卒採用 募集 中小', '中途採用 採用情報 工場', '従業員数 50名'],
    ['本社 アクセス 地図', '事業内容 法人 取引先', '会社情報 設立 資本金'],
    ['お問い合わせ 法人代表', '事業所一覧', '工場一覧 営業所'],
    ['協同組合', '商工会議所 会員', '組合員 名簿'],
  ];
  const kws = KEYWORD_SETS[round % KEYWORD_SETS.length];
  for (const ind of industries.slice(0, 4)) {
    for (const kw of kws) {
      const q = `${ind} ${kw}`;
      if (!seen.has(q)) { queries.push(q); seen.add(q); }
      if (queries.length >= 8) break;
    }
    if (queries.length >= 8) break;
  }
  if (queries.length === 0) {
    queries.push(`${productText.split(/[、。\s]/)[0]} 導入企業 会社`);
  }
  return queries.slice(0, 6);
}

async function aiGenerateQueries(productText, icp) {
  if (!store.opts.aiKey && !store.opts.braveProxy) return generateQueriesFromICP(productText, icp);
  const qualityMode = store.opts.qualityMode !== false;
  const prefs = [...selectedPrefs()];
  const cities = [...selectedCities()];
  const regionHint = cities.length > 0
    ? `ユーザー選択地域(必ず全てに対応するクエリを生成): ${cities.slice(0,12).join('・')}`
    : (prefs.length > 0 ? `ユーザー選択地域: ${prefs.slice(0,12).join('・')}` : '地域指定なし');
  try {
    // 高品質モード: Opus + extended thinking で深く考えてから生成
    const sys = `あなたはB2B営業のリードジェネレーション専門家です。商材内容と購買決定の論理を理解し、対象企業の業種・規模・課題像から「実際にHPに書いてありそうなフレーズ」を逆算してWeb検索クエリを生成します。SEO上位の比較記事やランキングサイトではなく、中小〜中堅企業の公式HPがヒットするクエリを作るのが目的です。`;

    const prompt = `# 商材
${productText}

# ターゲット像
業種候補: ${(icp.industries||[]).join('、')}
規模: ${(icp.sizes||[]).join('・')}
想定課題: ${(icp.pains||[]).slice(0,5).join('・')}

# ${regionHint}

# タスク
この商材を購入する可能性がある日本企業を Brave Search で発見するためのクエリを生成してください。

## 設計原則
1. **その地域に本当に所在する会社のHPがヒットするように地域名を必ず含める**
   (地域選択がある場合、選択地域ごとにクエリを作る)
2. **公式HPに書かれている自然な表現を組み合わせる**
   - 会社概要・沿革・代表電話・本社所在地・アクセス・事業所一覧 (会社情報系)
   - 採用情報・新卒採用・キャリア (採用系: 中堅以上が出やすい)
   - 取引先・実績・事例・導入企業 (B2B系)
   - 工場・営業所・支社・事業所 (拠点を持つ会社)
3. **比較記事/ランキング/まとめサイトを避けるための工夫**
   - "とは" "選び方" "おすすめ" "5選" 等の単語を含めない
   - "公式" "official" 等を含めると公式HPに寄る
4. **業種多様化**: 商材から見て「主力ターゲット業種」と「周辺業種」を混ぜる
5. **規模多様化**: 中小狙いと中堅狙いの両方
6. **検索演算子の活用**: site:除外 (-site:rikunabi.com など) や intitle: を使うと精度UP

## 出力
${qualityMode ? '15〜20個' : '6〜10個'}の互いに異なる切り口のクエリを生成。
クエリの後に1行コメントで意図を添える。最後にJSON配列のみで返してください。

(extended thinkingで設計してから、最後にJSONのみ)
["クエリ1", "クエリ2", ...]`;

    const callOpts = qualityMode
      ? { model: 'claude-opus-4-7', max_tokens: 4000, thinking: { type: 'enabled', budget_tokens: 5000 }, temperature: 1.0 }
      : { max_tokens: 800 };

    const text = await callClaude({ system: sys, prompt, ...callOpts });
    incrementUsage('ai', qualityMode ? 3 : 1);
    // 末尾のJSON配列を抽出
    const matches = [...text.matchAll(/\[\s*"[\s\S]*?\]/g)];
    let arr = null;
    for (const m of matches) {
      try {
        const parsed = JSON.parse(m[0]);
        if (Array.isArray(parsed) && parsed.length > 0) arr = parsed;
      } catch {}
    }
    if (!arr) return generateQueriesFromICP(productText, icp);
    const cleaned = arr.filter(q => typeof q === 'string' && q.length > 3);
    return qualityMode ? cleaned.slice(0, 20) : cleaned.slice(0, 10);
  } catch (e) {
    console.warn('aiGenerateQueries failed', e);
    return generateQueriesFromICP(productText, icp);
  }
}

function parseCompanyFromResult(r, idx) {
  const url = r.url || '';
  if (!url || isExcludedDomain(url)) return null;
  const title = (r.title || '').replace(/&amp;/g, '&').trim();
  const desc = (r.description || '').replace(/<[^>]+>/g, '').trim();
  // 解説・記事・ランキングページは弾く
  if (looksLikeArticle(title, url, desc)) return null;
  // 会社名抽出: 株式会社XX / XX株式会社 等のパターン優先
  const name = extractCompanyName(title, url);
  const phone = extractPhoneFromText(desc + ' ' + title);
  return {
    id: 500000 + Date.now() % 1000000 + idx,
    name: (name || rootDomain(url)).slice(0, 80),
    phone: phone || '',
    website: `https://${rootDomain(url)}`,
    source_url: url,
    contact_url: '',
    industry: '',
    prefecture: '',
    city: '',
    size: 'small',
    employees: 30,
    description: desc.slice(0, 240),
    keywords: desc.split(/[\s、,。]+/).filter(w => w.length >= 2).slice(0, 8),
    found_via_product: document.getElementById('product-input').value.trim().slice(0, 60),
    discovered_at: Date.now(),
    needs_enrichment: true,
  };
}

function extractCompanyName(title, url) {
  if (!title) return rootDomain(url).replace(/^www\./, '').split('.')[0];
  let cleaned = title.replace(/&amp;/g, '&').trim();
  // 求人/採用/転職ポータル経由のタイトルから会社名だけ抜き出す
  cleaned = cleaned.replace(/(の求人.*|の採用情報.*|の採用.*|の仕事.*|の転職.*|の中途.*|\s*[\|｜]\s*求人.*|\s*[\|｜]\s*採用.*|\s*[\|｜]\s*転職.*|\s*[\|｜]\s*マイナビ.*|\s*[\|｜]\s*リクナビ.*|\s*[\|｜]\s*Indeed.*|\s*[\|｜]\s*エン転職.*|\s*[\|｜]\s*doda.*|\s*[\|｜]\s*type.*)$/i, '').trim();
  // 法人格パターン優先
  const patterns = [
    /(株式会社[ 　]?[^\s|｜\-,／【】「」『』<>()【】]{1,30})/,
    /([^\s|｜\-,／【】「」『』<>()【】]{1,30}株式会社)/,
    /(合同会社[ 　]?[^\s|｜\-,／【】「」『』<>()【】]{1,30})/,
    /([^\s|｜\-,／【】「」『』<>()【】]{1,30}合同会社)/,
    /(有限会社[ 　]?[^\s|｜\-,／【】「」『』<>()【】]{1,30})/,
    /([^\s|｜\-,／【】「」『』<>()【】]{1,30}有限会社)/,
    /(医療法人[ 　]?[^\s|｜\-,／【】「」『』<>()【】]{1,30})/,
    /(社会福祉法人[ 　]?[^\s|｜\-,／【】「」『』<>()【】]{1,30})/,
    /(NPO法人[ 　]?[^\s|｜\-,／【】「」『』<>()【】]{1,30})/,
    /(一般社団法人[ 　]?[^\s|｜\-,／【】「」『』<>()【】]{1,30})/,
    /([A-Za-z][A-Za-z0-9 ]+(?:Inc|Co\.?,?\s?Ltd|Corp|LLC|Group)\.?)/,
  ];
  for (const re of patterns) {
    const m = cleaned.match(re);
    if (m) return m[1].trim();
  }
  // フォールバック: タイトル最初のセグメント
  const seg = cleaned.split(/[\|｜\-｜]/)[0].trim();
  if (seg.length > 0 && seg.length < 50) return seg;
  return rootDomain(url).replace(/^www\./, '').split('.')[0];
}

/* ============ HP enrichment via worker /fetch ============ */
/* ============ sitemap.xml 適応的クロール ============ */
// 多くのHPは /company, /about 等の標準URLを使うが、独自構造の会社も多い。
// sitemap.xml を読んで実際のURL構造を把握し、AIに「最も会社情報が濃いページ」を
// 選ばせることで、無駄なフェッチを減らしつつ重要な情報を取れる。

async function fetchSitemapUrls(baseUrl) {
  const candidates = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml'];
  for (const path of candidates) {
    try {
      const xml = await fetchPageViaProxy(`${baseUrl}${path}`);
      if (!xml) continue;
      const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]).filter(Boolean);
      if (urls.length > 0) {
        // sitemap_index の場合、ネストした sitemap も展開 (1段だけ)
        const subSitemaps = urls.filter(u => /sitemap.*\.xml/i.test(u));
        const pageUrls = urls.filter(u => !/sitemap.*\.xml/i.test(u));
        if (subSitemaps.length > 0) {
          const nested = await Promise.all(subSitemaps.slice(0, 3).map(s => fetchPageViaProxy(s).catch(() => null)));
          for (const xml2 of nested) {
            if (!xml2) continue;
            pageUrls.push(...[...xml2.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]));
          }
        }
        return pageUrls.slice(0, 500); // 上限500URL
      }
    } catch {}
  }
  return [];
}

// AI に sitemap URL リストから「最も会社情報が濃そうな10URL」を選ばせる
async function aiSelectInfoRichUrls(urls, companyName) {
  if (!urls || urls.length === 0) return [];
  if (urls.length <= 10) return urls;
  // 既に会社情報っぽいURLを優先(キーワードベース粗フィルタ)
  const KEY = /\/(company|about|profile|info|corporate|history|outline|recruit|career|service|news|press|ir|contact|access|message|gaiyou|enkaku)/i;
  const NEG = /\/(blog|news\/\d{4}\/\d{2}|posts?\/[a-f0-9-]{20,}|wp-content|tag\/|category\/|search|product\/\w+\/\d+|item\/\d+|\.pdf$|\.jpg$|\.png$)/i;
  const ranked = urls
    .filter(u => !NEG.test(u))
    .sort((a, b) => (KEY.test(b) ? 1 : 0) - (KEY.test(a) ? 1 : 0));
  // Top50を AI に渡す
  const top = ranked.slice(0, 50);
  if (top.length <= 10) return top;
  try {
    const prompt = `# 会社: ${companyName}
# Sitemap から抽出した URL リスト (${top.length}個)
${top.map((u, i) => `${i+1}. ${u}`).join('\n')}

# タスク
これらのURLから、「会社概要・代表者情報・所在地・電話番号・事業内容・採用情報」など
営業判断に役立つ情報が含まれる可能性が高い URL を **最大10個** 選んでください。
ブログ記事の個別ページ、商品個別ページ、低価値ページは除外。

JSON配列のみで返答 (URLそのまま):
["url1", "url2", ...]`;
    const text = await callClaude({ system: 'HP情報密度分析専門家', prompt, max_tokens: 1500 });
    incrementUsage('ai', 1);
    const m = text.match(/\[[\s\S]*?\]/);
    if (!m) return top.slice(0, 10);
    const picks = JSON.parse(m[0]);
    if (!Array.isArray(picks)) return top.slice(0, 10);
    return picks.filter(u => typeof u === 'string').slice(0, 10);
  } catch (e) {
    console.warn('aiSelectInfoRichUrls failed', e);
    return top.slice(0, 10);
  }
}

/* ============ HPフェッチキャッシュ (7日 TTL) ============ */
const HP_CACHE_KEY = 'tell.hp_cache.v1';
const HP_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7日
const HP_CACHE_MAX = 500;

function _loadHpCache() {
  try { return JSON.parse(localStorage.getItem(HP_CACHE_KEY) || '{}'); } catch { return {}; }
}
function _saveHpCache(cache) {
  // LRU: 古いエントリから削除
  const entries = Object.entries(cache).sort((a, b) => b[1].t - a[1].t);
  if (entries.length > HP_CACHE_MAX) {
    cache = Object.fromEntries(entries.slice(0, HP_CACHE_MAX));
  }
  try { localStorage.setItem(HP_CACHE_KEY, JSON.stringify(cache)); } catch (e) {
    // quota 超過時は半分にして再試行
    const half = Object.fromEntries(entries.slice(0, Math.floor(HP_CACHE_MAX / 2)));
    try { localStorage.setItem(HP_CACHE_KEY, JSON.stringify(half)); } catch {}
  }
}

async function fetchPageViaProxy(targetUrl) {
  if (!store.opts.braveProxy) return null;
  // キャッシュチェック
  const cache = _loadHpCache();
  const cached = cache[targetUrl];
  if (cached && (Date.now() - cached.t) < HP_CACHE_TTL) {
    return cached.html;
  }
  const proxy = store.opts.braveProxy.replace(/\/+$/, '');
  try {
    const res = await fetch(`${proxy}/fetch?url=${encodeURIComponent(targetUrl)}`, {
      headers: { 'Accept': 'text/html' },
    });
    if (!res.ok) return null;
    incrementUsage('fetch', 1);
    const html = await res.text();
    // キャッシュ保存
    cache[targetUrl] = { html: html.slice(0, 200000), t: Date.now() };
    _saveHpCache(cache);
    return html;
  } catch (e) {
    return null;
  }
}

/* ============ AI 評価キャッシュ (30日 TTL) ============ */
// 同じ会社 × 同じ商材 の組合せが既に評価されていれば再利用
const AI_CACHE_KEY = 'tell.ai_cache.v1';
const AI_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const AI_CACHE_MAX = 1000;

function _hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return (h >>> 0).toString(36);
}
function _aiCacheKey(company, productText) {
  const url = company.website || company.source_url || '';
  const ph = company.houjin_bangou || '';
  const pt = productText.slice(0, 200);
  return `${ph}|${url}|${_hash(pt)}`;
}
function _loadAiCache() {
  try { return JSON.parse(localStorage.getItem(AI_CACHE_KEY) || '{}'); } catch { return {}; }
}
function _saveAiCache(cache) {
  const entries = Object.entries(cache).sort((a, b) => b[1].t - a[1].t);
  if (entries.length > AI_CACHE_MAX) cache = Object.fromEntries(entries.slice(0, AI_CACHE_MAX));
  try { localStorage.setItem(AI_CACHE_KEY, JSON.stringify(cache)); } catch {
    const half = Object.fromEntries(entries.slice(0, Math.floor(AI_CACHE_MAX/2)));
    try { localStorage.setItem(AI_CACHE_KEY, JSON.stringify(half)); } catch {}
  }
}
function getCachedAiEval(company, productText) {
  const key = _aiCacheKey(company, productText);
  const cache = _loadAiCache();
  const cached = cache[key];
  if (cached && (Date.now() - cached.t) < AI_CACHE_TTL) {
    return cached.eval;
  }
  return null;
}
function setCachedAiEval(company, productText, evalResult) {
  const key = _aiCacheKey(company, productText);
  const cache = _loadAiCache();
  cache[key] = { eval: evalResult, t: Date.now() };
  _saveAiCache(cache);
}

function clearAllCaches() {
  localStorage.removeItem(HP_CACHE_KEY);
  localStorage.removeItem(AI_CACHE_KEY);
}

/* ============ 国税庁法人番号API: 地域 × 業種キーワードで法人検索 ============ */
// ユーザー選択地域に実在する登記済み法人を、業種関連キーワードで検索して
// 候補リストに追加する。Brave検索で漏れた中小企業を補完する役割。
async function lookupHoujinByKeyword(keyword, prefectureName) {
  if (!store.opts.braveProxy || !keyword) return [];
  try {
    const proxy = store.opts.braveProxy.replace(/\/+$/, '');
    const res = await fetch(`${proxy}/houjin-bangou?name=${encodeURIComponent(keyword)}`);
    if (!res.ok) return [];
    const data = await res.json();
    const corps = (data.corporations || data.corporation || []);
    if (prefectureName) {
      return corps.filter(c => (c.prefectureName || '') === prefectureName);
    }
    return corps;
  } catch (e) {
    console.warn('lookupHoujinByKeyword failed', keyword, e);
    return [];
  }
}

// 国税庁ベースの候補発見: 選択地域×業種キーワードから法人を引いて、
// 各社のHPを Brave 検索で探して候補リストに追加
async function discoverViaHoujinBangou(productText, icp, onProgress) {
  const prefs = [...selectedPrefs()];
  const cities = [...selectedCities()];
  if (prefs.length === 0 && cities.length === 0) return [];
  if (!icp || !icp.industries || icp.industries.length === 0) return [];

  const candidates = [];
  // 業種から検索キーワード生成 (より一般的なフレーズ)
  const searchKeywords = icp.industries.slice(0, 4).flatMap(ind => {
    // 業種名そのまま + よくある法人名フレーズ
    return [ind, ind.replace(/業$/, '')];
  }).filter((v, i, a) => v && a.indexOf(v) === i);

  const targetPrefs = prefs.length > 0 ? prefs : [...new Set(cities.map(c => c.split('/')[0]))];

  onProgress?.(`🏛 国税庁から${targetPrefs.length}地域 × ${searchKeywords.length}業種で法人検索中…`);

  for (const pref of targetPrefs) {
    for (const kw of searchKeywords) {
      const corps = await lookupHoujinByKeyword(kw, pref);
      onProgress?.(`🏛 「${kw}」(${pref}) → ${corps.length}法人`);
      for (const c of corps.slice(0, 30)) { // 1検索あたり30社まで
        candidates.push({
          name: c.name || '',
          official_name: c.name || '',
          houjin_bangou: c.corporateNumber || c.corpNumber || '',
          prefecture: c.prefectureName || pref,
          city: c.cityName || '',
          address: [c.prefectureName, c.cityName, c.streetNumber].filter(Boolean).join(''),
          source: 'houjin-bangou-api',
        });
      }
    }
  }
  return candidates;
}

// 国税庁候補からHPを探して既存パイプラインに合流
async function enrichHoujinCandidatesWithHP(candidates, productText, onProgress) {
  const enriched = [];
  for (let i = 0; i < candidates.length; i++) {
    if (state.searchAborted) break;
    const cand = candidates[i];
    onProgress?.(`🏛 ${i+1}/${candidates.length} ${cand.name} のHPを検索…`);
    try {
      // 法人名で Brave 検索して公式HPを見つける
      const searchResults = await braveSearch(`"${cand.name}" 公式 OR 会社概要`, 5);
      // 最も会社名が含まれて、公式っぽいURLを選ぶ
      const officialUrl = searchResults.find(r => {
        const dom = rootDomain(r.url);
        if (!dom || isExcludedDomain(r.url)) return false;
        // タイトルに会社名が含まれているか
        const cleanName = cand.name.replace(/(株式会社|合同会社|有限会社).*?/, '').trim();
        return r.title && r.title.includes(cleanName);
      }) || searchResults[0];
      if (!officialUrl) continue;
      const c = {
        id: 600000 + Date.now() % 1000000 + i,
        name: cand.name,
        official_name: cand.name,
        houjin_bangou: cand.houjin_bangou,
        phone: '',
        website: `https://${rootDomain(officialUrl.url)}`,
        source_url: officialUrl.url,
        contact_url: '',
        industry: '',
        prefecture: cand.prefecture,
        city: cand.city,
        address: cand.address,
        size: 'small',
        employees: 30,
        description: officialUrl.description || '',
        keywords: [],
        found_via_product: productText.slice(0, 60),
        discovered_at: Date.now(),
        needs_enrichment: true,
        _source: 'houjin-bangou-api',
      };
      enriched.push(c);
    } catch (e) {
      console.warn('houjin candidate HP search failed', cand.name, e);
    }
  }
  return enriched;
}

/* ============ 国税庁法人番号API クライアント ============ */
// 公式の法人実在性確認 + 公式所在地取得
// レスポンスは https://www.houjin-bangou.nta.go.jp/webapi/ の仕様参照
// CSV形式 → 1行=1法人。フィールド: シーケンス番号,法人番号,処理区分,訂正区分,更新年月日,
//   変更年月日,商号又は名称,商号又は名称(ふりがな),...,本店所在地都道府県コード,本店所在地市区町村コード,
//   本店所在地_丁目番地,都道府県名,市区町村名,...
// type=12 はJSON、mode=2は部分一致

const _houjinCache = new Map(); // name -> Promise<result>
async function lookupHoujinBangou(companyName) {
  if (!store.opts.braveProxy || !companyName) return null;
  // 法人格を除いた名前で検索精度UP
  const cleanName = companyName
    .replace(/(株式会社|合同会社|有限会社|医療法人|社会福祉法人|NPO法人|一般社団法人|学校法人|宗教法人|協同組合|Inc\.?|Corp\.?|LLC|Co\.,?\s?Ltd|Group|Company)/gi, '')
    .trim();
  if (cleanName.length < 2) return null;
  if (_houjinCache.has(cleanName)) return _houjinCache.get(cleanName);
  const promise = (async () => {
    const proxy = store.opts.braveProxy.replace(/\/+$/, '');
    try {
      const res = await fetch(`${proxy}/houjin-bangou?name=${encodeURIComponent(cleanName)}`);
      if (!res.ok) return null;
      const data = await res.json();
      // レスポンスは {count, divideNumber, lastUpdateDate, corporations: [...]}
      // corporations[].name, corporations[].prefectureName, corporations[].cityName, corporations[].streetNumber
      const corps = (data.corporations || data.corporation || []);
      if (corps.length === 0) return { found: false };
      // 最も会社名と類似度が高い候補をピック
      const exact = corps.find(c => (c.name || '').includes(cleanName) || cleanName.includes((c.name||'').replace(/(株式会社|合同会社|有限会社).*/, '').trim()));
      const pick = exact || corps[0];
      return {
        found: true,
        houjin_bangou: pick.corporateNumber || pick.corpNumber || '',
        official_name: pick.name || '',
        official_prefecture: pick.prefectureName || '',
        official_city: pick.cityName || '',
        official_street: pick.streetNumber || '',
        official_address: [pick.prefectureName, pick.cityName, pick.streetNumber].filter(Boolean).join(''),
        candidate_count: corps.length,
      };
    } catch (e) {
      console.warn('houjin lookup failed', cleanName, e);
      return null;
    }
  })();
  _houjinCache.set(cleanName, promise);
  return promise;
}

const JP_PREFS = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];

function extractFromHTML(html, baseUrl) {
  if (!html) return null;
  const out = {};

  // タイトル
  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleM) out.title = titleM[1].replace(/\s+/g, ' ').trim();

  // og:site_name は法人名の確度高い
  const ogName = html.match(/<meta[^>]+(?:property|name)=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  if (ogName) out.siteName = ogName[1].trim();

  // 会社名: タイトル or og:site_name から法人格を含むものを優先
  const candidates = [out.siteName, out.title].filter(Boolean);
  for (const c of candidates) {
    const name = extractCompanyName(c, baseUrl);
    if (name && /(株式会社|合同会社|有限会社|医療法人|社会福祉法人|NPO法人|一般社団法人|Inc|Corp|LLC|Group|Co\.,?\s?Ltd)/i.test(name)) {
      out.name = name;
      break;
    }
  }
  if (!out.name && candidates[0]) out.name = extractCompanyName(candidates[0], baseUrl);

  // 電話番号(HTMLから抽出 - HTMLタグを除去してテキストに変換してから処理)
  const flatText = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const extracted = extractPhoneFromText(flatText);
  if (extracted) out.phone = extracted;

  // 問い合わせURL
  const contactM = html.match(/<a[^>]*\shref=["']([^"']+)["'][^>]*>[^<]{0,80}(?:contact|inquiry|toiawase|問い合わせ|問合せ|お問い合わせ)[^<]{0,80}<\/a>/i);
  if (contactM) {
    try { out.contact_url = new URL(contactM[1], baseUrl).href; } catch {}
  }

  // 本社所在地: 〒+住所パターンを優先、本社/所在地キーワード近傍を重視
  // この方法だと「サービス対象エリア」「店舗一覧」等で言及される他県名と区別できる
  const flatTextForAddr = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
  const addr = extractHeadquartersAddress(flatTextForAddr);
  if (addr) {
    if (addr.prefecture) out.prefecture = addr.prefecture;
    if (addr.city) out.city = addr.city;
    if (addr.zip) out.zip = addr.zip;
    out.address = addr.address;
  } else {
    // フォールバック: 都道府県名がHPに出てくれば採用(精度低)
    for (const p of JP_PREFS) {
      if (html.includes(p)) { out.prefecture = p; break; }
    }
  }

  return out;
}

// 本社所在地を抽出
// 優先順位:
//  1. 「本社」「所在地」「Head Office」等のキーワード直後の住所
//  2. 〒XXX-XXXX 形式が含まれる住所
//  3. フッター/会社概要っぽい部分の住所
function extractHeadquartersAddress(text) {
  if (!text) return null;
  const PREFS_RE = JP_PREFS.join('|');
  // 〒XXX-XXXX 都道府県... 形式
  const zipPattern = new RegExp(`〒?\\s*(\\d{3})[-－]?(\\d{4})\\s*(${PREFS_RE})([^\\s,。]{2,40})`, 'g');
  // 「本社」「所在地」等の直後 (40文字以内)
  const HQ_KW = '(本社|本店|所在地|住所|Address|Head\\s*Office|Headquarters|HQ)';
  const hqNearPattern = new RegExp(`${HQ_KW}[\\s\\S]{0,40}?(${PREFS_RE})([^\\s,。]{2,30})`, 'g');

  const candidates = [];
  let m;
  // パターン1: HQキーワード + 住所 (最強)
  while ((m = hqNearPattern.exec(text)) !== null) {
    const pref = m[2];
    const rest = m[3];
    const city = extractCityFromAddress(pref, rest);
    candidates.push({ prefecture: pref, city, address: `${pref}${rest}`.slice(0, 60), score: 100 });
  }
  // パターン2: 〒+住所 (郵便番号が付いていれば公式住所の可能性高)
  while ((m = zipPattern.exec(text)) !== null) {
    const pref = m[3];
    const rest = m[4];
    const city = extractCityFromAddress(pref, rest);
    const zip = `${m[1]}-${m[2]}`;
    candidates.push({ prefecture: pref, city, address: `〒${zip} ${pref}${rest}`.slice(0, 60), zip, score: 80 });
  }
  if (candidates.length === 0) return null;
  // スコア順, 同点なら最初の出現を優先
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

function extractCityFromAddress(prefecture, addressTail) {
  if (!addressTail || !window.JAPAN_REGIONS) return '';
  const cities = window.JAPAN_REGIONS[prefecture] || [];
  for (const c of cities) {
    if (addressTail.startsWith(c)) return c;
  }
  // 東京23区フォールバック
  const wardM = addressTail.match(/^(.{2,5}区)/);
  if (wardM && prefecture === '東京都') return wardM[1];
  // 市町村のフォールバック
  const cityM = addressTail.match(/^(.{2,8}(?:市|町|村))/);
  if (cityM) return cityM[1];
  return '';
}


async function discoverFromBrave(productText, icp, onProgress, options = {}) {
  if (!store.opts.braveKey && !store.opts.braveProxy) throw new Error('Brave のプロキシURLまたはAPIキーを設定してください');
  const round = options.round || 0;
  // 品質モード時はクエリ多めに(20本)
  const isHighQuality = store.opts.qualityMode !== false;
  const maxQueries = options.maxQueries || (isHighQuality ? 20 : 10);
  let queries;
  if (options.queries && options.queries.length) {
    queries = options.queries;
  } else if (round === 0 && (store.opts.aiKey || store.opts.braveProxy)) {
    queries = await aiGenerateQueries(productText, icp);
  } else {
    queries = generateQueriesFromICP(productText, icp, round);
  }
  queries = queries.slice(0, maxQueries);
  if (queries.length === 0) {
    onProgress?.('クエリ生成失敗。ICPが空');
    return [];
  }
  onProgress?.(`${queries.length}件のクエリを実行: ${queries.map(q=>`"${q.slice(0,20)}"`).join(', ')}`);

  const all = getAllCompanies();
  const existingKeys = new Set(all.map(dedupKey));
  const seenDomains = new Set();
  const found = [];
  const stats = { totalResults: 0, excluded: 0, duped: 0 };

  const rescoreImpl = () => {
    try {
      const allCompanies = getAllCompanies();
      state.scored = allCompanies
        .map(co => scoreCompany(co, state.icp || { industries:[], sizes:[], pains:[], keywords:[], anti_patterns:[] }, state.strategy || {}, state.intentSignals || []))
        .sort((a, b) => b.score - a.score);
      renderResults();
      renderSidebar();
    } catch (err) {
      console.error('rescore error:', err);
    }
  };
  // 3並列ワーカーから同時に呼ばれるので、最大2回/秒に間引いてDOM再描画コストを抑制
  let _rescoreTimer = null;
  let _rescoreDirty = false;
  const rescore = () => {
    _rescoreDirty = true;
    if (_rescoreTimer) return;
    _rescoreTimer = setTimeout(() => {
      _rescoreTimer = null;
      if (_rescoreDirty) { _rescoreDirty = false; rescoreImpl(); }
    }, 500);
  };
  const rescoreFlush = () => {
    if (_rescoreTimer) { clearTimeout(_rescoreTimer); _rescoreTimer = null; }
    if (_rescoreDirty) { _rescoreDirty = false; rescoreImpl(); }
  };

  let totalValidated = 0;
  for (let qIdx = 0; qIdx < queries.length; qIdx++) {
    const q = queries[qIdx];
    let rawResults = [];
    try {
      // ハローワーク特化モード時は site:制約を付与
      const sitePrefix = window.HELLOWORK_MODE ? 'site:hellowork.mhlw.go.jp ' : '';
      rawResults = await braveSearch(`${sitePrefix}${q}`, 20);
      stats.totalResults += rawResults.length;
      onProgress?.(`${qIdx+1}/${queries.length}「${q.slice(0,18)}」→ ${rawResults.length}件取得、1件ずつ精査`);
    } catch (e) {
      console.warn('brave query failed:', q, e);
      onProgress?.(`${qIdx+1}/${queries.length}「${q.slice(0,18)}」→ 検索エラー: ${e.message.slice(0,50)}`);
      continue;
    }
    // 候補を全部リストに即追加(pending) → 並列ワーカー(3社同時)でHP訪問・AI評価
    const queryCandidates = [];
    for (let ri = 0; ri < rawResults.length; ri++) {
      const r = rawResults[ri];
      if (!r.url) { stats.excluded++; continue; }
      if (isExcludedDomain(r.url)) { stats.excluded++; continue; }
      const dom = rootDomain(r.url);
      if (seenDomains.has(dom)) { stats.duped++; continue; }
      seenDomains.add(dom);
      const c = parseCompanyFromResult(r, found.length + ri);
      if (!c) { stats.excluded++; continue; }
      const key = dedupKey(c);
      if (existingKeys.has(key)) { stats.duped++; continue; }
      existingKeys.add(key);
      c.pending = true;
      c.score = 50;
      c.reasoning = '🔍 HP訪問・AI評価中…';
      c.aiComment = '🔍 評価中…';
      queryCandidates.push(c);
    }
    if (queryCandidates.length === 0) continue;

    // Phase7: 事前フィルタ (品質モード時のみ)
    // Brave のスニペットだけで明らかな非マッチを除外して HP フェッチコストを削減
    let filteredCandidates = queryCandidates;
    if (store.opts.qualityMode !== false && queryCandidates.length >= 5) {
      try {
        const preFiltered = await preFilterByBraveSnippets(queryCandidates, productText);
        const removed = queryCandidates.length - preFiltered.length;
        if (removed > 0) {
          onProgress?.(`${qIdx+1}/${queries.length}: 事前フィルタで${removed}社を除外 → ${preFiltered.length}社を深掘り`);
          filteredCandidates = preFiltered;
        }
      } catch (e) {
        console.warn('preFilter failed, processing all', e);
      }
    }
    store.importedCompanies.push(...filteredCandidates);
    saveStore();
    updateOnboarding();
    rescore();
    onProgress?.(`${qIdx+1}/${queries.length}: ${filteredCandidates.length}社を「評価中」で追加(3社並列で精査開始)`);

    // 3社並列ワーカー
    const WORKERS = 3;
    let cursor = 0;
    let processed = 0;
    const total = filteredCandidates.length;
    const worker = async () => {
      while (cursor < total && !state.searchAborted) {
        const i = cursor++;
        const c = filteredCandidates[i];
        onProgress?.(`${qIdx+1}/${queries.length} | ${processed+1}-${Math.min(processed+WORKERS, total)}/${total} 評価中…`);
        try {
          const enriched = await enrichCompanyDeep(c, productText);
          Object.assign(c, enriched);
        } catch (e) {
          console.warn('enrich failed', c.website, e);
        }
        c.pending = false;
        const aiSaysNotCompany = c.ai_is_company === false;
        const aiSaysNameInvalid = c.ai_name_valid === false;
        const regionMismatch = isRegionMismatch(c);
        const passesRule = !aiSaysNotCompany && !aiSaysNameInvalid && !regionMismatch && isLikelyRealCompany(c);
        if (passesRule) {
          found.push(c);
          totalValidated++;
          saveStoreSoon();
          rescore();
          const phoneTag = c.phone ? ` ☎${c.phone}` : ' ☎未取得';
          const locTag = c.prefecture ? ` 📍${c.prefecture}${c.city||''}` : '';
          onProgress?.(`✓ ${c.name.slice(0,28)}${phoneTag}${locTag} (累計${totalValidated}社)`);
        } else {
          store.importedCompanies = store.importedCompanies.filter(x => x.id !== c.id);
          saveStoreSoon();
          rescore();
          const reason = aiSaysNotCompany ? 'AI判定で非法人'
            : aiSaysNameInvalid ? 'AI判定で会社名が無効'
            : regionMismatch ? `本社が選択地域外(${c.prefecture||'不明'}${c.city||''})`
            : '非法人';
          onProgress?.(`× ${c.name.slice(0,28)} ${reason}として除外`);
        }
        processed++;
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));
    rescoreFlush();
    saveStore();
  }
  rescoreFlush();
  saveStore();

  // Phase 8: 最終リランキング (品質モード時のみ)
  // 全候補を一覧して相対的に並び替え、calibration ズレを補正
  if (store.opts.qualityMode !== false && found.length >= 5) {
    try {
      onProgress?.(`🧠 最終リランキング中(Top${Math.min(30, found.length)}社を相対比較)…`);
      await rerankTopCandidates(productText, found.slice(0, 30));
      rescoreFlush();
      saveStore();
    } catch (e) {
      console.warn('rerank failed', e);
    }
  }

  // Phase 9: 上位企業のクロスソース検証 + 最新ニュース取得 (品質モード時のみ)
  if (store.opts.qualityMode !== false && found.length >= 3) {
    try {
      const sortedTop = [...found].sort((a, b) => (b.ai_score || 0) - (a.ai_score || 0)).slice(0, 10);
      onProgress?.(`🔍 上位${sortedTop.length}社をクロスソース検証中…`);
      await verifyTopByCrossSource(sortedTop, onProgress);
      onProgress?.(`📰 上位${Math.min(5, sortedTop.length)}社の最新ニュース取得中…`);
      // ニュース取得はコストかかるので Top5 のみ
      await enrichTopWithRecentNews(sortedTop.slice(0, 5), onProgress);
      rescoreFlush();
      saveStore();
    } catch (e) {
      console.warn('top verification failed', e);
    }
  }
  onProgress?.(`✓ 全完了。${totalValidated}社追加（検索${stats.totalResults}件、ノイズ除外${stats.excluded}、重複${stats.duped}、非法人${queryCandidates_count(stats, found.length, totalValidated)}）`);
  return found;
}

// 上位企業の最新ニュース・トピック検索
// 6ヶ月以内のニュース言及を取得 → 「最近何やってるか」を架電トピックに追加
async function enrichTopWithRecentNews(topCompanies, onProgress) {
  if (!topCompanies || topCompanies.length === 0) return;
  for (let i = 0; i < topCompanies.length; i++) {
    if (state.searchAborted) break;
    const c = topCompanies[i];
    if (!c.name) continue;
    onProgress?.(`📰 ${i+1}/${topCompanies.length} ${c.name} の最新ニュース検索…`);
    try {
      // Brave search with freshness=pm (past month)
      // ※ Brave APIは freshness パラメータをサポート: pd(day)/pw(week)/pm(month)/py(year)
      const results = await braveSearchOnceWithFreshness(`"${c.name}"`, 5, 'py');
      const ownDomain = rootDomain(c.website || c.source_url || '');
      // 自社HP以外のニュース・プレスリリース系を抽出
      const newsItems = results
        .filter(r => {
          const dom = rootDomain(r.url);
          if (!dom || dom === ownDomain) return false;
          return /prtimes|press|news|nikkei|toyokeizai|diamond|business|/.test(r.url + (r.title||''));
        })
        .slice(0, 5)
        .map(r => ({
          title: r.title || '',
          url: r.url,
          snippet: (r.description || '').slice(0, 200),
        }));
      if (newsItems.length > 0) {
        c.recent_news = newsItems;
        // AIに news を要約させて architecture-level の talking point に追加
        try {
          const summary = await summarizeNewsForTalkingPoints(c, newsItems);
          if (summary && summary.length > 0) {
            c.ai_news_talking_points = summary;
            // 既存の talking_points に統合
            c.ai_talking_points = [...(c.ai_talking_points || []), ...summary].slice(0, 7);
          }
        } catch (e) { /* skip */ }
      }
      // store にも反映
      const target = store.importedCompanies.find(x => x.id === c.id);
      if (target) {
        target.recent_news = c.recent_news;
        target.ai_news_talking_points = c.ai_news_talking_points;
        target.ai_talking_points = c.ai_talking_points;
      }
    } catch (e) {
      console.warn('recent news search failed', c.name, e);
    }
  }
}

// freshness パラメータ付き Brave search
async function braveSearchOnceWithFreshness(query, count, freshness) {
  const hasProxy = !!store.opts.braveProxy;
  if (!hasProxy && !store.opts.braveKey) return [];
  const delta = Date.now() - _braveLastCall.t;
  if (delta < 1100) await new Promise(r => setTimeout(r, 1100 - delta));
  _braveLastCall.t = Date.now();
  const params = new URLSearchParams({
    q: query, count: String(Math.min(count, 20)),
    country: 'JP', search_lang: 'jp', ui_lang: 'ja-JP',
    result_filter: 'web',
    freshness,
  });
  let url, headers;
  if (hasProxy) {
    url = `${store.opts.braveProxy.replace(/\/+$/, '')}/search?${params}`;
    headers = { 'Accept': 'application/json' };
  } else {
    url = `https://api.search.brave.com/res/v1/web/search?${params}`;
    headers = { 'X-Subscription-Token': store.opts.braveKey, 'Accept': 'application/json' };
  }
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    incrementUsage('search', 1);
    const data = await res.json();
    return (data.web?.results || []);
  } catch { return []; }
}

// ニュース項目を商材文脈で要約して talking points 化
async function summarizeNewsForTalkingPoints(company, newsItems) {
  if (newsItems.length === 0) return [];
  const productText = document.getElementById('product-input')?.value || '';
  const list = newsItems.map((n, i) => `${i+1}. ${n.title}\n   ${n.snippet}`).join('\n');
  const prompt = `# 商材
${productText}

# ${company.name} の最近のニュース ${newsItems.length}件
${list}

# タスク
これらのニュースから、上記商材を提案する際に「架電冒頭で触れると効果的な」話題を3つまで抽出してください。
ニュースの内容を短く(20字以内)パッケージ化してください。

JSONのみで返答:
["話題1", "話題2", "話題3"]`;
  try {
    const text = await callClaude({ system: '営業提案の話題抽出専門家', prompt, max_tokens: 500 });
    incrementUsage('ai', 1);
    const m = text.match(/\[[\s\S]*?\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr.filter(s => typeof s === 'string').slice(0, 3) : [];
  } catch { return []; }
}

// 上位企業のクロスソース検証
// 会社名で単独検索して、自社HP以外の何件のドメインから言及されているかを数える
// 言及多い = 実在性 + 業界での認知度 + 活動の証拠
async function verifyTopByCrossSource(topCompanies, onProgress) {
  if (!topCompanies || topCompanies.length === 0) return;
  for (let i = 0; i < topCompanies.length; i++) {
    if (state.searchAborted) break;
    const c = topCompanies[i];
    if (!c.name) continue;
    onProgress?.(`🔍 ${i+1}/${topCompanies.length} ${c.name} を外部参照確認…`);
    try {
      const results = await braveSearchOnce(`"${c.name}"`, 10, 0);
      const ownDomain = rootDomain(c.website || c.source_url || '');
      const externalDomains = new Set();
      for (const r of results) {
        const dom = rootDomain(r.url);
        if (!dom || dom === ownDomain) continue;
        if (isExcludedDomain(r.url)) continue;
        externalDomains.add(dom);
      }
      const refCount = externalDomains.size;
      c.cross_source_count = refCount;
      // スコア調整
      if (refCount >= 5) {
        c.ai_score = Math.min(100, (c.ai_score || 0) + 5);
        c._verification = 'strong'; // 5+ 外部参照 = 強く実在
      } else if (refCount >= 2) {
        c._verification = 'normal';
      } else {
        c._verification = 'weak';
        // 1社の外部参照すらない場合 → スコアを少し下げる
        c.ai_score = Math.max(0, (c.ai_score || 0) - 5);
      }
      // store にも反映
      const target = store.importedCompanies.find(x => x.id === c.id);
      if (target) {
        target.cross_source_count = refCount;
        target._verification = c._verification;
        target.ai_score = c.ai_score;
      }
    } catch (e) {
      console.warn('cross-source check failed', c.name, e);
    }
  }
}

// Top候補を Opus で相対比較してスコアを微調整
// 「個別評価」だけでは calibration がブレるので、最後に全体俯瞰でランキングを正す
async function rerankTopCandidates(productText, topCompanies) {
  if (!topCompanies || topCompanies.length < 2) return;
  const sys = `あなたはB2B営業のシニアアカウントエグゼクティブです。
複数の候補企業を商材適合度の観点から相対的に比較し、ランキングと相対スコア(0-100)を返してください。
個別評価ではなく、「この中で誰に最初に架電すべきか」を判断します。JSONのみ返答。`;

  const list = topCompanies.map((c, i) => {
    const sig = (c.ai_buying_signals || []).slice(0,3).join('・') || 'なし';
    const evidence = c.ai_fit_evidence || 'なし';
    return `${i+1}. ${c.name} (${c.industry||'?'} / ${c.prefecture||'?'}${c.city||''}) 暫定${c.ai_score||0}点
   根拠:${evidence} シグナル:${sig}`;
  }).join('\n');

  const prompt = `# 商材
${productText}

# 候補${topCompanies.length}社 (個別評価済)
${list}

# タスク
これら全社を相対比較して、最も購買確度が高い順に並び替え、各社の最終スコアを0-100で付け直してください。
- 個別評価のばらつきや過剰評価/過小評価を是正
- 商材の購買決定論理から「この中で誰が一番買いそうか」を厳密に
- スコアは相対分布(トップから順次下がる、横並びは避ける)

JSONのみ返答:
{"ranking": [{"i": 1, "final_score": 92, "reason": "理由20字"}, ...]}`;

  try {
    const text = await callClaude({
      system: sys, prompt,
      model: 'claude-opus-4-7',
      max_tokens: 3000,
      thinking: { type: 'enabled', budget_tokens: 6000 },
      temperature: 1.0,
    });
    incrementUsage('ai', 5); // 大きいプロンプト + thinking
    // 末尾JSON抽出
    const matches = [...text.matchAll(/\{[\s\S]*?"ranking"[\s\S]*?\]\s*\}/g)];
    let obj = null;
    for (const m of matches) {
      try { obj = JSON.parse(m[0]); } catch {}
    }
    if (!obj || !Array.isArray(obj.ranking)) return;
    // スコア反映
    for (const r of obj.ranking) {
      const idx = parseInt(r.i, 10) - 1;
      if (idx >= 0 && idx < topCompanies.length) {
        const c = topCompanies[idx];
        const newScore = Math.max(0, Math.min(100, parseInt(r.final_score, 10) || 0));
        c.ai_score_pre_rerank = c.ai_score;
        c.ai_score = newScore;
        c.ai_rerank_reason = r.reason || '';
        c._reranked = true;
        // store に反映
        const target = store.importedCompanies.find(x => x.id === c.id);
        if (target) {
          target.ai_score_pre_rerank = c.ai_score_pre_rerank;
          target.ai_score = newScore;
          target.ai_rerank_reason = r.reason || '';
          target._reranked = true;
        }
      }
    }
  } catch (e) {
    console.warn('rerankTopCandidates failed', e);
  }
}

function queryCandidates_count(stats, _foundLen, validated) {
  // 概算: 候補総数 - validated = 除外された候補数
  return Math.max(0, stats.totalResults - stats.excluded - stats.duped - validated);
}

function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function enrichCompanyDeep(c, productText) {
  if (!c.website || !store.opts.braveProxy) return c;
  const baseUrl = c.website.replace(/\/+$/, '');
  // 優先度高: 検索ヒットURL + ルート + /company + /about (4並列)
  const priorityUrls = [
    c.source_url && c.source_url !== c.website ? c.source_url : null,
    c.website,
    `${baseUrl}/company`,
    `${baseUrl}/about`,
  ].filter(Boolean);
  // 優先度低: その他のcompany系パス (まとめて並列)
  const secondaryUrls = [
    `${baseUrl}/company/`,
    `${baseUrl}/about/`,
    `${baseUrl}/corporate`,
    `${baseUrl}/corporate/`,
    `${baseUrl}/profile`,
    `${baseUrl}/info`,
    `${baseUrl}/会社概要`,
    `${baseUrl}/company/profile`,
    `${baseUrl}/company/outline`,
  ];
  // 品質モード時の追加クロール: 購買シグナル取得用 (採用・ニュース・事業内容)
  const signalUrls = (store.opts.qualityMode !== false) ? [
    `${baseUrl}/news`, `${baseUrl}/news/`,
    `${baseUrl}/recruit`, `${baseUrl}/recruit/`,
    `${baseUrl}/career`, `${baseUrl}/careers/`,
    `${baseUrl}/service`, `${baseUrl}/services`,
    `${baseUrl}/business`, `${baseUrl}/products`,
    `${baseUrl}/ir`, `${baseUrl}/press`,
  ] : [];

  let best = { ...c };
  const collectedTexts = [];
  const mergeFromHTML = (html, url) => {
    if (!html) return;
    collectedTexts.push(htmlToText(html).slice(0, 2000));
    const ext = extractFromHTML(html, url);
    if (!ext) return;
    if (ext.name && /(株式会社|合同会社|有限会社|医療法人|社会福祉法人|NPO法人|一般社団法人|学校法人)/.test(ext.name)) {
      if (!best.name || !/(株式会社|合同会社|有限会社|医療法人|社会福祉法人|NPO法人|一般社団法人|学校法人)/.test(best.name)) {
        best.name = ext.name;
      }
    } else if (!best.name && ext.name) {
      best.name = ext.name;
    }
    if (ext.phone && !best.phone) best.phone = ext.phone;
    if (ext.contact_url && !best.contact_url) best.contact_url = ext.contact_url;
    // 住所: より精度の高いソース(zipありなど)を優先
    if (ext.address && !best.address) {
      best.address = ext.address;
      if (ext.prefecture) best.prefecture = ext.prefecture;
      if (ext.city) best.city = ext.city;
      if (ext.zip) best.zip = ext.zip;
    } else if (ext.prefecture && !best.prefecture) {
      best.prefecture = ext.prefecture;
      if (ext.city) best.city = ext.city;
    }
  };
  const enough = () => best.name && /(株式会社|合同会社|有限会社|医療法人|社会福祉法人|NPO法人|一般社団法人)/.test(best.name) && best.phone && best.address;

  // Phase1: 優先4URLを並列フェッチ
  const phase1 = await Promise.all(priorityUrls.map(u => fetchPageViaProxy(u).catch(() => null)));
  phase1.forEach((html, i) => mergeFromHTML(html, priorityUrls[i]));
  // 信頼性シグナル: 最初に取れたHTMLで判定
  const firstHtml = phase1.find(h => h);
  if (firstHtml) {
    const credText = htmlToText(firstHtml).slice(0, 3000);
    const cred = detectCredibilitySignals(firstHtml, credText);
    best.credibility_score = cred.score;
    best.credibility_signals = cred.signals;
  }

  // Phase2: 必要なら残りも並列フェッチ
  if (!enough()) {
    const phase2 = await Promise.all(secondaryUrls.map(u => fetchPageViaProxy(u).catch(() => null)));
    phase2.forEach((html, i) => mergeFromHTML(html, secondaryUrls[i]));
  }

  // Phase3: 品質モード時のみ、シグナル取得用ページもクロール
  if (signalUrls.length > 0) {
    const phase3 = await Promise.all(signalUrls.map(u => fetchPageViaProxy(u).catch(() => null)));
    phase3.forEach((html, i) => mergeFromHTML(html, signalUrls[i]));
  }

  // Phase4: 品質モード + 情報不足時のみ、sitemap.xml から AI 選定で追加クロール
  // 標準URL(/company等)が空振りした独自構造のHP対策
  if (store.opts.qualityMode !== false && collectedTexts.join('').length < 3000) {
    try {
      const sitemapUrls = await fetchSitemapUrls(baseUrl);
      if (sitemapUrls.length > 5) {
        const picked = await aiSelectInfoRichUrls(sitemapUrls, best.name || c.name);
        const newUrls = picked.filter(u => !priorityUrls.includes(u) && !secondaryUrls.includes(u) && !signalUrls.includes(u));
        if (newUrls.length > 0) {
          const phase4 = await Promise.all(newUrls.slice(0, 8).map(u => fetchPageViaProxy(u).catch(() => null)));
          phase4.forEach((html, i) => mergeFromHTML(html, newUrls[i]));
          best._sitemap_assisted = true;
        }
      }
    } catch (e) { console.warn('sitemap crawl failed', e); }
  }

  best.needs_enrichment = false;

  // AI評価(多段階パイプライン) - 会社名・電話・本社所在地のT/F判定 + 深い適合度評価
  if (productText && (store.opts.aiKey || store.opts.braveProxy) && collectedTexts.length > 0) {
    // 品質モード時はHPテキストをより多く渡す(6KBまで)
    const isHigh = store.opts.qualityMode !== false;
    const hpText = collectedTexts.join('\n').slice(0, isHigh ? 8000 : 3500);
    // 活動性シグナル(廃業/最近の更新/採用の有無)
    const activeness = detectActivenessSignals(hpText);
    best.activeness = activeness.active;
    best.activeness_signals = activeness.signals;
    const ai = await aiScoreCompany(best, productText, hpText, { qualityMode: isHigh });
    if (ai) {
      best.ai_score = ai.score;
      best.ai_reasoning = ai.reasoning;
      best.ai_fit = ai.fit;
      best.ai_fit_evidence = ai.fit_evidence;
      best.ai_fit_citations = ai.fit_citations || [];
      best.ai_buying_signals = ai.buying_signals || [];
      best.ai_risks = ai.risks || [];
      best.ai_confidence = ai.ai_confidence || null;
      best.ai_is_company = ai.is_company;
      best.ai_name_valid = ai.name_valid;
      best.ai_phone_valid = ai.phone_valid;
      best.ai_in_target_region = ai.in_target_region;
      best.is_competitor = ai.is_competitor === true;
      best.competitor_evidence = ai.competitor_evidence;
      best.ai_dimensions = ai.dimensions || null;
      best.ai_talking_points = ai.talking_points || [];
      best.ai_decision_makers = ai.decision_makers || [];
      if (typeof ai.employees_estimate === 'number' && ai.employees_estimate > 0) {
        best.employees = ai.employees_estimate;
        // size カテゴリも自動推定
        if (ai.employees_estimate <= 50) best.size = 'small';
        else if (ai.employees_estimate <= 300) best.size = 'mid';
        else best.size = 'large';
      }
      // 業種を HP から再分類した結果で上書き(あれば)
      if (ai.actual_industry && (!best.industry || best.industry === '不明')) {
        best.industry = ai.actual_industry;
      }
      best._used_deep_eval = ai._used_deep_eval === true;
      // 国税庁登記情報
      if (ai.houjin_bangou) {
        best.houjin_bangou = ai.houjin_bangou;
        best.official_name = ai.official_name;
        best.official_address = ai.official_address;
      }
      best.houjin_not_registered = ai.houjin_not_registered === true;
      // 会社名: AIが妥当な名前を返した場合のみ採用 (公式名があれば優先)
      if (ai.official_name) {
        best.name = cleanCompanyName(ai.official_name);
      } else if (ai.name && ai.name.length >= 3 && ai.name_valid) {
        best.name = cleanCompanyName(ai.name);
      }
      // 本社所在地: AIの判定で上書き(AI は本社/サービス対象を区別できる)
      if (ai.hq_prefecture) {
        best.prefecture = ai.hq_prefecture;
        if (ai.hq_city) best.city = ai.hq_city;
      }
      // 電話番号: AIが phone_valid=true で番号を返したらそれを採用
      // phone_valid=false なら regex で取った番号も信用できないので破棄
      if (ai.phone && ai.phone_valid) {
        best.phone = ai.phone;
      } else if (!ai.phone_valid && best.phone) {
        best.phone_rejected = best.phone;
        best.phone = '';
      }
      // AI が「対象地域外」と判定したらフラグ(isRegionMismatchが拾う)
      if (ai.in_target_region === false) {
        best._ai_region_reject = true;
      }
      // 廃業シグナル検知時は AIスコアを大きく減点 (架電しても出ない)
      if (best.activeness === 'inactive') {
        best.ai_score = Math.max(0, (best.ai_score || 0) - 60);
        best.ai_reasoning = `[活動停止シグナル検出] ${best.ai_reasoning || ''}`;
      } else if (best.activeness === 'unknown' && (best.ai_score || 0) > 60) {
        // 活動性不明で高スコアは少し下げる(リスク調整)
        best.ai_score = Math.max(0, (best.ai_score || 0) - 10);
      }
    }
  }
  return best;
}

function extractJson(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = m ? m[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('JSONが見つかりません');
  return JSON.parse(raw.slice(start, end + 1));
}

async function aiAnalyzeProduct(productText) {
  const system = `あなたはB2B営業戦略のシニアコンサルタントです。商材テキストから、誰が買うか・どんな課題を解決するかを分析し、構造化されたJSONで応答してください。日本市場のB2B営業を想定してください。`;
  const prompt = `以下の商材を分析し、JSONのみで返してください。

商材: ${productText}

形式:
{
  "category_name": "商材カテゴリ名",
  "confidence": "high|medium|low",
  "icp": {
    "industries": ["想定業種を3〜6個", "日本標準産業分類の名称で"],
    "sizes": ["small(〜50名)", "mid(51-300)", "large(301+)"の該当のみ],
    "pains": ["想定課題を3〜5個（具体的に）"],
    "keywords": ["企業説明文に含まれていそうなキーワードを5〜8個"]
  },
  "strategy": {
    "persona": "理想顧客像を1〜2文で",
    "decision_maker": "想定決裁者の肩書(具体名・部署)",
    "motivation": "購入動機・価値訴求ポイント(2〜3個)",
    "avoid": "避けるべき対象企業の特徴",
    "budget_range": "想定価格帯(月額・年額・初期費用など具体的に)",
    "meeting_time": "初回・本商談の所要時間",
    "objections": "主な反対理由を4〜5個",
    "differentiators": "競合との差別化ポイント3〜4個",
    "approach": "効果的なアプローチ手法(冒頭の切り出しから締めまで)",
    "market_context": "市場・業界の現状トレンド",
    "key_questions": "初回ヒアリングで聞くべき質問5個",
    "timing": "提案のベストタイミング(月・季節・組織イベント)",
    "target_signals": ["has_office","has_factory","has_store","has_field_work","has_remote","has_24h","pain_recruitment","pain_efficiency","pain_cost","pain_compliance","pain_sales","pain_succession","pain_funding","pain_old_hp","pain_welfare" から該当を選択"],
    "avoid_signals": ["上記から避けるシグナルを選択"]
  }
}

JSON以外は出力しないでください。`;
  const text = await callClaude({ system, prompt, max_tokens: 3000 });
  return extractJson(text);
}

async function applyFilterFromText() {
  const text = document.getElementById('filter-text-input').value.trim();
  const statusEl = document.getElementById('filter-text-status');
  if (!text) { statusEl.textContent = 'テキストを入力してください'; return; }
  if (!store.opts.aiKey && !store.opts.braveProxy) {
    statusEl.textContent = '⚠ AI(WorkerまたはAPIキー)未設定';
    statusEl.style.color = 'var(--danger)';
    return;
  }
  statusEl.textContent = 'AI解析中…';
  statusEl.style.color = 'var(--mid)';
  const sys = 'あなたは営業要件のパース専門家です。自然文から絞り込み条件を抽出してJSONで返答してください。配列は使わず、複数候補がある場合は最も主要なものを1つ選んでください。';
  const prompt = `以下の文章から、企業検索の絞り込み条件を抽出してください。

文章:
"""
${text}
"""

抽出項目(複数候補があっても1つだけ選んで返す):
- industry: 日本標準産業分類の大分類名(製造業/建設業/卸売・小売業/飲食業/運輸業/情報通信業/金融・保険業/不動産業/医療・福祉/教育・学習支援/宿泊・サービス業/サービス業/農林水産業)から1つ、または null
- prefecture: 都道府県名(○○県/○○府/北海道/東京都)を1つ、または null
- city: 市区町村名を1つ、または null
- size: "small"(〜50名) | "mid"(51-300) | "large"(301+) | null
- product_addendum: 商材に追加すべき情報(地域・複数指定があれば文字列でまとめる)

JSON object のみ返答(配列禁止、コメント禁止):
{"industry":null,"prefecture":"北海道","city":"苫小牧市","size":"mid","product_addendum":"札幌・岩見沢・徳島・新潟も対象"}`;
  try {
    const result = await callClaude({ system: sys, prompt, max_tokens: 600 });
    // 最初の { から最後の } までを抽出して JSON.parse
    const start = result.indexOf('{');
    const end = result.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('JSON形式が見つかりません');
    const jsonStr = result.slice(start, end + 1);
    const f = JSON.parse(jsonStr);
    let applied = [];
    if (f.industry) {
      const sel = document.getElementById('filter-industry');
      const opt = [...sel.options].find(o => o.value === f.industry || o.text === f.industry);
      if (opt) { sel.value = opt.value; applied.push(`業種=${f.industry}`); }
    }
    if (f.prefecture && window.JAPAN_REGIONS && window.JAPAN_REGIONS[f.prefecture]) {
      const prefs = new Set(store.opts.regionPrefs || []);
      prefs.add(f.prefecture);
      store.opts.regionPrefs = [...prefs];
      applied.push(`都道府県=${f.prefecture}全域`);
    }
    if (f.city && f.prefecture && window.JAPAN_REGIONS && window.JAPAN_REGIONS[f.prefecture]) {
      const match = window.JAPAN_REGIONS[f.prefecture].find(c => c === f.city || c.includes(f.city));
      if (match) {
        const cities = new Set(store.opts.regionCities || []);
        cities.add(`${f.prefecture}/${match}`);
        store.opts.regionCities = [...cities];
        applied.push(`市区町村=${match}`);
      }
    }
    if (f.size && ['small','mid','large'].includes(f.size)) {
      document.getElementById('filter-size').value = f.size;
      applied.push(`規模=${f.size}`);
    }
    if (f.product_addendum) {
      const productEl = document.getElementById('product-input');
      const existing = productEl.value.trim();
      if (existing && !existing.includes(f.product_addendum)) {
        productEl.value = existing + '。対象地域: ' + f.product_addendum;
        applied.push('商材に地域情報追記');
      } else if (!existing) {
        productEl.value = f.product_addendum;
        applied.push('商材を設定');
      }
    }
    statusEl.textContent = applied.length > 0 ? `✓ 適用: ${applied.join(' / ')}` : '抽出条件なし';
    statusEl.style.color = applied.length > 0 ? 'var(--good)' : 'var(--mid)';
    saveStore();
    renderRegionChips();
    if (state.scored.length > 0) renderResults();
  } catch (e) {
    console.error('applyFilterFromText error', e);
    statusEl.textContent = `失敗: ${e.message.slice(0,120)}`;
    statusEl.style.color = 'var(--danger)';
  }
}

async function aiScoreBatch(companies, productText) {
  if (companies.length === 0) return [];
  const sys = `あなたはB2B営業のシニアコンサルタントと企業データバリデーション専門家を兼任します。各エントリが日本の実在法人か検証し、商材への適合度を評価してください。`;
  const list = companies.map((c, i) =>
    `${i+1}. 名前:"${c.name}" / URL:${c.source_url || c.website || ''} / 業種:${c.industry||'?'} / 所在:${c.prefecture||''}${c.city||''} / 説明:${(c.description||'').slice(0,200)}`
  ).join('\n');
  const prompt = `商材: ${productText}

以下${companies.length}社それぞれを判定:
${list}

各社について:
1. 「is_company」(T/F): HPを持つ実在の法人・店舗・事務所なら true(寛容)。falseにすべきは ①解説/比較記事 ②求人ポータル/業者一覧 ③Wikipedia等の参考情報
2. 「name」: 正しい法人名(株式会社/合同会社/有限会社/医療法人等を含む)。タイトルからノイズを除去したクリーンな名前。判別不能ならnull
3. 「name_valid」(T/F): 上のnameが実在固有名詞として妥当か。「ホーム」「TOP」「公式サイト」のようなページタイトル断片はfalse
4. 「s」: 適合度0-100(80+/60-79/40-59/20-39)
5. 「r」: 30字以内の根拠

JSON配列のみ返答:
[{"i":1,"is_company":true,"name":"株式会社XXX","name_valid":true,"s":75,"r":"..."},...]`;
  try {
    const text = await callClaude({ system: sys, prompt, max_tokens: 2500 });
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return null;
    const arr = JSON.parse(m[0]);
    return companies.map((_, idx) => {
      const f = arr.find(x => x.i === idx + 1);
      if (!f) return null;
      return {
        is_company: f.is_company !== false,
        name: f.name || null,
        name_valid: f.name_valid !== false,
        score: Math.max(0, Math.min(100, parseInt(f.s, 10) || 0)),
        reasoning: String(f.r || '').slice(0, 80),
      };
    });
  } catch (e) {
    console.warn('aiScoreBatch failed', e);
    return null;
  }
}

async function batchScoreExisting(productText, onProgress) {
  if (!productText || (!store.opts.aiKey && !store.opts.braveProxy)) return;
  const all = getAllCompanies();
  const needScoring = all.filter(c => typeof c.ai_score !== 'number');
  if (needScoring.length === 0) return;
  const BATCH = 10;
  for (let i = 0; i < needScoring.length; i += BATCH) {
    const batch = needScoring.slice(i, i + BATCH);
    const end = Math.min(i + BATCH, needScoring.length);
    onProgress?.(`既存企業を商材に対して再評価 ${i+1}-${end}/${needScoring.length}…`);
    const results = await aiScoreBatch(batch, productText);
    if (results) {
      const toRemoveIds = [];
      batch.forEach((c, j) => {
        if (!results[j]) return;
        if (results[j].is_company === false || results[j].name_valid === false) {
          toRemoveIds.push(c.id);
          return;
        }
        c.ai_score = results[j].score;
        c.ai_reasoning = results[j].reasoning;
        c.ai_scored_for = productText.slice(0, 60);
        c.ai_name_valid = results[j].name_valid;
        if (results[j].name && results[j].name.length >= 3 && results[j].name_valid) {
          c.name = cleanCompanyName(results[j].name);
        }
      });
      if (toRemoveIds.length > 0) {
        const idsSet = new Set(toRemoveIds);
        store.importedCompanies = store.importedCompanies.filter(x => !idsSet.has(x.id));
        store.customCompanies = store.customCompanies.filter(x => !idsSet.has(x.id));
        onProgress?.(`× AI判定で${toRemoveIds.length}社を非法人として除外`);
      }
      saveStore();
      // 部分的に再描画
      const allC = getAllCompanies();
      state.scored = allC
        .map(co => scoreCompany(co, state.icp, state.strategy, state.intentSignals))
        .sort((a, b) => b.score - a.score);
      try { renderResults(); renderSidebar(); } catch (e) { console.warn('render error', e); }
    }
  }
  onProgress?.(`✓ 既存${needScoring.length}社の再評価完了`);
}

// 商材適合度評価のメイン関数。多段階パイプラインで品質を最大化。
//
// Stage 1: 安価モデル(Haiku)で予備スクリーニング → 明らかな非適合を早期除外
// Stage 2: 国税庁法人番号API で実在性 + 公式所在地を確認 (グラウンドトゥルース)
// Stage 3: Opus + extended thinking で深い適合度評価 + 引用必須
// Stage 4: 自己整合性チェック (オプション)
//
// 高品質モード(qualityMode=true): すべてのstageを実行
// 通常モード: Stage 1 のみ(従来動作)
async function aiScoreCompany(company, productText, hpText, options = {}) {
  if (!store.opts.aiKey && !store.opts.braveProxy) return null;
  const qualityMode = options.qualityMode !== false && store.opts.qualityMode !== false;

  // キャッシュチェック (同じ会社×商材 の再評価を回避)
  if (!options.bypassCache) {
    const cached = getCachedAiEval(company, productText);
    if (cached) {
      cached._from_cache = true;
      return cached;
    }
  }

  // Stage 1: 高速スクリーニング (Haiku)
  const stage1 = await aiScoreStage1Quick(company, productText, hpText);
  if (!stage1) return null;

  // 早期除外: 非法人 or 名前無効 → 後続不要
  if (stage1.is_company === false || stage1.name_valid === false) {
    setCachedAiEval(company, productText, stage1);
    return stage1;
  }

  // qualityMode が無効なら Stage1 のみで返す(高速モード)
  if (!qualityMode) {
    setCachedAiEval(company, productText, stage1);
    return stage1;
  }

  // Stage 2: 国税庁法人番号API で実在性確認
  let houjin = null;
  try {
    houjin = await lookupHoujinBangou(stage1.name || company.name);
  } catch (e) { console.warn('houjin lookup error', e); }

  // 公式所在地が取れたら、それを真の本社所在地として上書き候補に
  if (houjin && houjin.found) {
    stage1.houjin_bangou = houjin.houjin_bangou;
    stage1.official_name = houjin.official_name;
    stage1.official_address = houjin.official_address;
    // AIが返した hq_prefecture と異なる場合は公式を優先
    if (houjin.official_prefecture) {
      stage1.hq_prefecture = houjin.official_prefecture;
      stage1.hq_city = houjin.official_city || stage1.hq_city;
      // 地域マッチも公式所在地で再判定
      const prefs = selectedPrefs();
      const cities = selectedCities();
      if (prefs.size === 0 && cities.size === 0) {
        stage1.in_target_region = true;
      } else {
        const officialKey = `${houjin.official_prefecture}/${houjin.official_city||''}`;
        stage1.in_target_region = prefs.has(houjin.official_prefecture) || cities.has(officialKey);
      }
    }
  }
  // 法人番号で「該当法人なし」(found=false) → 任意団体や個人事業の可能性、スコアに反映
  if (houjin && houjin.found === false) {
    stage1.houjin_not_registered = true;
  }

  // 地域ミスマッチ確定 → Stage3 スキップ(コスト節約)
  if (stage1.in_target_region === false) {
    return stage1;
  }

  // Stage 3: Opus + extended thinking で深い適合度評価 + 引用必須
  // ensembleMode 時は Opus + Sonnet の合議で更に信頼性UP
  const useEnsemble = store.opts.ensembleMode === true;
  try {
    const stage3 = useEnsemble
      ? await aiScoreStage3Ensemble(company, productText, hpText, stage1, houjin)
      : await aiScoreStage3Deep(company, productText, hpText, stage1, houjin);
    if (!stage3) return stage1;

    // Stage 4: 自己整合性チェック - 境界域(45-75)のスコアはノイズが大きいので2回目を走らせて median を取る
    let finalScore = stage3.score;
    let secondConfidence = null;
    if (options.selfConsistency !== false && stage3.score >= 45 && stage3.score <= 75) {
      try {
        const stage3b = await aiScoreStage3Deep(company, productText, hpText, stage1, houjin);
        if (stage3b) {
          // median (2点なら平均)
          finalScore = Math.round((stage3.score + stage3b.score) / 2);
          // confidence は両方一致なら強化、不一致なら下げる
          if (Math.abs(stage3.score - stage3b.score) > 15) {
            secondConfidence = 'low'; // 判断ブレが大きい
          } else if (stage3.confidence === stage3b.confidence) {
            secondConfidence = stage3.confidence;
          }
        }
      } catch (e) { /* 2回目失敗は無視 */ }
    }

    // 競合企業は強制的に低スコア (架電厳禁)
    if (stage3.is_competitor) {
      finalScore = Math.min(finalScore, 10);
    }
    const result = {
      ...stage1,
      score: finalScore,
      reasoning: stage3.reasoning,
      fit_evidence: stage3.fit_evidence,
      fit_citations: stage3.fit_citations,
      buying_signals: stage3.buying_signals,
      risks: stage3.risks,
      ai_confidence: secondConfidence || stage3.confidence,
      is_competitor: stage3.is_competitor,
      competitor_evidence: stage3.competitor_evidence,
      actual_industry: stage3.actual_industry,
      decision_makers: stage3.decision_makers,
      employees_estimate: stage3.employees_estimate,
      dimensions: stage3.dimensions,
      talking_points: stage3.talking_points,
      _used_deep_eval: true,
      _self_consistency_checked: secondConfidence !== null,
      _ensemble: stage3._ensemble || null,
    };
    setCachedAiEval(company, productText, result);
    return result;
  } catch (e) {
    console.warn('stage3 failed, fallback to stage1', e);
  }
  setCachedAiEval(company, productText, stage1);
  return stage1;
}

// Stage 1: 高速・安価な構造化判定 (Haiku)
async function aiScoreStage1Quick(company, productText, hpText) {
  const selectedRegionsHint = (() => {
    const prefs = [...selectedPrefs()];
    const cities = [...selectedCities()];
    if (cities.length > 0) return `ユーザー選択地域: ${cities.slice(0,8).join('・')}`;
    if (prefs.length > 0) return `ユーザー選択地域: ${prefs.slice(0,8).join('・')}`;
    return '地域指定なし';
  })();
  const sys = `あなたはB2B営業のシニアコンサルタントと企業データバリデーション専門家です。実在法人か検証してから商材適合度を「厳しく」評価してください。なんとなく当てはまりそう、ではなく、HPテキストから購買可能性の根拠を読み取れる時のみ高スコアを付けてください。JSONのみで返答。`;
  const prompt = `商材: ${productText}

${selectedRegionsHint}

企業情報:
- 会社名(暫定): ${company.name}
- URL: ${company.source_url || company.website || ''}
- 業種: ${company.industry || '不明'}
- HPから抽出した所在地: ${company.address || (company.prefecture || '') + (company.city || '') || '不明'}
- 抽出済み電話(暫定): ${company.phone || '未取得'}
- HP説明: ${(company.description || '').slice(0, 200)}
- HPテキスト抜粋: ${(hpText || '').slice(0, 1800)}

判定項目:
1. is_company (T/F): HPを持つ実在の法人/店舗/事務所なら true(寛容)。falseにすべきは: 解説/比較記事/ランキング、求人ポータル、業者一覧、Wikipedia等

2. name: HPから判明する正式な事業者名(法人格含む)。判別不能ならnull

3. name_valid (T/F): nameが実在固有名詞として妥当か。「ホーム」「TOP」等の断片はfalse

4. hq_prefecture: 本社所在地の都道府県(HPテキストの「本社」「所在地」「〒」近傍から判定)。本社が判明しない場合はnull。サービス対象エリアの記載は本社ではない
5. hq_city: 本社所在地の市区町村。判別不能ならnull
6. in_target_region (T/F): 本社所在地が【ユーザー選択地域】に含まれるか。地域指定なしの場合は true。本社不明 or 別地域 ならfalse

7. phone: HPテキスト内の法人代表電話番号。「代表」「お問い合わせ」「TEL」直後を最優先。${store.opts.landlineOnly !== false ? '【必須】個人携帯(070/080/090)は除外し、固定電話/0120/0800のみ' : '固定/携帯/フリーダイヤル可'}。FAX除外。見つからなければnull
8. phone_valid (T/F): phoneが本物の代表連絡先か

9. fit_evidence: 商材を必要としそうな具体的根拠(30字以内、HPテキストから引用ベース推奨)。根拠がなければ null
10. score (0-100): 商材適合度。【厳しく】評価:
    - 90-100: HPに明示的なニーズ言及や類似商材を既に使ってる証拠あり
    - 70-89: 業種・規模から購買可能性が極めて高い + 何らかのシグナル
    - 50-69: 業種マッチで一般論として可能性あり
    - 30-49: 業種が周辺、買う可能性は限定的
    - 0-29: ほぼ買わない or 判断材料不足
    fit_evidence が null なら 50 を超えないこと

11. reasoning: 30字以内の総合評価

JSONのみ返答:
{"is_company": true|false, "name": "株式会社XXX or null", "name_valid": true|false, "hq_prefecture": "東京都 or null", "hq_city": "港区 or null", "in_target_region": true|false, "phone": "03-1234-5678 or null", "phone_valid": true|false, "fit_evidence": "...or null", "score": 0-100, "reasoning": "..."}`;
  try {
    const text = await callClaude({ system: sys, prompt, max_tokens: 500 });
    incrementUsage('ai', 1);
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const obj = JSON.parse(m[0]);
    // 電話番号は正規表現でも再検証(AIが嘘の番号を作るのを防ぐ)
    // 個人携帯は landlineOnly=true なら破棄
    let phone = obj.phone || null;
    let phoneValid = obj.phone_valid === true;
    if (phone && !isAcceptablePhone(phone)) {
      phone = null;
      phoneValid = false;
    }
    return {
      is_company: obj.is_company !== false,
      name: obj.name || null,
      name_valid: obj.name_valid !== false,
      hq_prefecture: obj.hq_prefecture || null,
      hq_city: obj.hq_city || null,
      in_target_region: obj.in_target_region !== false,
      phone,
      phone_valid: phoneValid,
      fit_evidence: obj.fit_evidence || null,
      score: Math.max(0, Math.min(100, parseInt(obj.score, 10) || 0)),
      reasoning: obj.reasoning || '',
      fit: obj.fit || 'mid',
    };
  } catch (e) {
    console.warn('aiScoreStage1Quick failed', company.name, e);
    return null;
  }
}

// Brave スニペット段階での事前フィルタ (品質モード時)
// HPフェッチ前に Haiku で一気に「明らかな非マッチ」を除外
// 1社あたり HPフェッチ + 深掘りAI評価 で 7単位かかるので、
// 事前フィルタで30%減らせれば 7単位 × 30 = 210単位節約
async function preFilterByBraveSnippets(candidates, productText) {
  if (!store.opts.braveProxy && !store.opts.aiKey) return candidates;
  if (candidates.length === 0) return candidates;

  const list = candidates.map((c, i) =>
    `${i+1}. 名前:"${c.name||'?'}" / URL:${c.source_url||c.website||''} / 説明:"${(c.description||'').slice(0,150)}"`
  ).join('\n');

  const prompt = `# 商材
${productText}

# 検索ヒット候補 ${candidates.length}件 (Brave検索のスニペットのみ)
${list}

# タスク
各候補について、HPを実際に訪問する価値があるかを判定。
「明らかに非マッチ」のものを除外し、価値があるものだけ残す。

## 除外すべきパターン
- 比較記事/まとめサイト/ランキング ("〇〇とは" "5選" "おすすめ")
- 求人ポータル経由のページ
- 海外企業
- 商材とは無関係な業種 (例: 商材がIT系で候補が八百屋)
- スパムサイト

## 残すべきパターン
- 法人HPっぽい (株式会社名 + 業種関連キーワード)
- 業種が商材と関連する
- 中小〜中堅の公式サイト

JSONのみで返答:
{"keep_indices": [1, 2, 5, 7, ...], "reasons": {"3": "比較記事", "4": "業種ミスマッチ"}}`;

  try {
    const text = await callClaude({ system: 'B2Bリードフィルタリング専門家。HPフェッチ前の事前選別を行う。', prompt, max_tokens: 800 });
    incrementUsage('ai', 1);
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return candidates;
    const obj = JSON.parse(m[0]);
    if (!Array.isArray(obj.keep_indices)) return candidates;
    const keepSet = new Set(obj.keep_indices.map(i => parseInt(i, 10)));
    return candidates.filter((c, i) => keepSet.has(i + 1));
  } catch (e) {
    console.warn('preFilterByBraveSnippets failed', e);
    return candidates;
  }
}

// HP の信頼性シグナル (法人 vs スパム/個人サイトの区別)
function detectCredibilitySignals(html, hpText) {
  if (!html) return { score: 0, signals: [] };
  const signals = [];
  let score = 0;
  // SSL証明書 (https) - 既に website が https なら +1
  // og:image / og:title (OGP対応) → 法人サイトの確率高
  if (/<meta[^>]+property=["']og:image["']/i.test(html)) { signals.push('ogp_image'); score += 5; }
  if (/<meta[^>]+property=["']og:title["']/i.test(html)) { signals.push('ogp_title'); score += 5; }
  // favicon
  if (/<link[^>]+rel=["'](?:icon|shortcut icon)["']/i.test(html)) { signals.push('favicon'); score += 3; }
  // 言語切替メニュー(英語版あるなら本格的)
  if (/(English|EN|en\/|\/en\/|\/lang\/en)/.test(html)) { signals.push('multilingual'); score += 5; }
  // プライバシーポリシー / 特商法 / 会社概要 リンク(法人HPの定番)
  if (/(プライバシーポリシー|個人情報保護方針|privacy.?policy)/i.test(hpText)) { signals.push('privacy_policy'); score += 10; }
  if (/(特定商取引法|特商法)/i.test(hpText)) { signals.push('tokushoho'); score += 10; }
  if (/(会社概要|企業情報|会社案内|company\s*info)/i.test(hpText)) { signals.push('company_info'); score += 8; }
  // 採用情報(継続経営の証)
  if (/(採用情報|新卒採用|中途採用|career|recruit)/i.test(hpText)) { signals.push('hiring_page'); score += 5; }
  // SNSリンク
  const snsCount = (hpText.match(/(twitter\.com|facebook\.com|linkedin\.com|youtube\.com|instagram\.com)/gi) || []).length;
  if (snsCount >= 2) { signals.push(`sns:${snsCount}`); score += 5; }
  // CMS識別子 (WordPress/Wix等 = 個人サイト寄り、自社開発 = 法人寄り)
  if (/wp-content|wordpress/i.test(html)) signals.push('cms_wordpress');
  if (/wix\.com|squarespace/i.test(html)) { signals.push('cms_consumer'); score -= 5; }

  return { score: Math.max(0, Math.min(100, score)), signals };
}

// HPテキストから「会社が活動中か」を推定するシグナル抽出
// - 最近の日付言及があるか
// - ブログ/ニュースの直近更新
// - 「廃業」「事業終了」等のネガティブシグナル
function detectActivenessSignals(hpText) {
  if (!hpText) return { active: 'unknown', signals: [] };
  const signals = [];
  // 直近2年以内の年月言及
  const now = new Date();
  const currentYear = now.getFullYear();
  const lastYear = currentYear - 1;
  const recentDatePattern = new RegExp(`(${currentYear}|${lastYear})年[\\s\\d]{0,5}月`, 'g');
  const recentMatches = hpText.match(recentDatePattern) || [];
  if (recentMatches.length > 0) signals.push(`recent_date:${recentMatches.length}`);
  // ニュース・お知らせのキーワード周辺
  const newsKeywords = ['お知らせ', 'ニュース', 'NEWS', 'プレスリリース', '更新情報'];
  for (const kw of newsKeywords) {
    if (hpText.includes(kw)) signals.push(`has_${kw}`);
  }
  // 採用関連 (継続活動の強いシグナル)
  if (/採用情報|新卒採用|中途採用|キャリア採用|求人募集/.test(hpText)) signals.push('hiring');
  // ネガティブシグナル
  const negativePatterns = [/廃業/, /事業.{0,3}終了/, /営業.{0,3}終了/, /閉店/, /閉鎖/];
  let negative = false;
  for (const p of negativePatterns) {
    if (p.test(hpText)) { signals.push('dormant_signal'); negative = true; break; }
  }
  let activeness;
  if (negative) activeness = 'inactive';
  else if (recentMatches.length >= 2 || signals.includes('hiring')) activeness = 'active';
  else if (recentMatches.length > 0) activeness = 'maybe_active';
  else activeness = 'unknown';
  return { active: activeness, signals };
}

// マルチモデルアンサンブル: Opus と Sonnet の両方で Stage3 を実行して合議
// 真の信頼性が必要な場合のみ呼ぶ (コストは概ね 2倍)
async function aiScoreStage3Ensemble(company, productText, hpText, stage1, houjin) {
  const [opus, sonnet] = await Promise.all([
    aiScoreStage3Deep(company, productText, hpText, stage1, houjin, 'claude-opus-4-7').catch(() => null),
    aiScoreStage3Deep(company, productText, hpText, stage1, houjin, 'claude-sonnet-4-6').catch(() => null),
  ]);
  if (!opus && !sonnet) return null;
  if (!opus) return sonnet;
  if (!sonnet) return opus;

  // 合議: 重み付き平均 (Opus 60%, Sonnet 40%)
  const avgScore = Math.round(opus.score * 0.6 + sonnet.score * 0.4);
  // 大きく食い違う(20点以上)→ 確信度を下げる
  const disagree = Math.abs(opus.score - sonnet.score) >= 20;
  // 競合フラグは両方一致したときのみ採用
  const competitorConsensus = opus.is_competitor && sonnet.is_competitor;
  // citations は両方からマージ
  const mergedCitations = [...(opus.fit_citations || []), ...(sonnet.fit_citations || [])].slice(0, 6);
  // buying_signals もマージ
  const mergedSignals = [...new Set([...(opus.buying_signals || []), ...(sonnet.buying_signals || [])])].slice(0, 8);

  return {
    ...opus,
    score: avgScore,
    confidence: disagree ? 'low' : opus.confidence,
    is_competitor: competitorConsensus,
    fit_citations: mergedCitations,
    buying_signals: mergedSignals,
    _ensemble: { opus_score: opus.score, sonnet_score: sonnet.score, disagree },
  };
}

// Stage 3: 深い適合度評価 (Opus + extended thinking + 引用必須)
// 高品質モードで実行。Stage1 で通過した候補のみ呼ばれる前提。
// 商材ニーズの根拠を HP テキストから「引用付き」で抽出し、購買シグナルを精査する。
async function aiScoreStage3Deep(company, productText, hpText, stage1, houjin, modelOverride) {
  const sys = `あなたは日本のB2B営業における超ベテランのアカウントエグゼクティブです。
HPテキストを精読し、商材を購入する可能性を「証拠ベース」で厳密に評価します。
推測や一般論ではなく、HPに書かれている具体的な記述を引用して根拠を示してください。
extended thinkingで考えた上で、最後に厳密なJSONのみを返答してください。`;

  const officialAddrLine = houjin && houjin.found
    ? `- 国税庁登記情報: 法人番号${houjin.houjin_bangou} / 正式名「${houjin.official_name}」 / 本店所在地「${houjin.official_address}」`
    : (houjin && houjin.found === false
        ? '- 国税庁登記情報: 該当法人なし (任意団体・個人事業の可能性)'
        : '- 国税庁登記情報: 未確認');

  const prompt = `# 商材
${productText}

# 評価対象企業
- 会社名: ${stage1.name || company.name}
- URL: ${company.source_url || company.website || ''}
- 業種(暫定): ${company.industry || '不明'}
${officialAddrLine}
- 抽出済み代表電話: ${stage1.phone || company.phone || '未取得'}
- HP説明: ${(company.description || '').slice(0, 300)}

# HPテキスト全文(精読してください)
${(hpText || '').slice(0, 6000)}

${buildFewShotFromFeedback(productText, 3)}
${(store.opts.knownCompetitors && store.opts.knownCompetitors.length > 0) ?
  `\n## 管理者指定の競合企業リスト(これらに該当すれば is_competitor=true 強制)\n${store.opts.knownCompetitors.join('、')}\n` : ''}

# 評価タスク
1. HPテキストを精読し、商材を購入する具体的根拠(購買シグナル)を抽出してください
2. 抽出した根拠は「HPテキストからの引用」を必ず含めてください(意訳・要約は不可)
3. 引用が見つからなければ「証拠なし」と明記し、スコアは抑えてください
4. 以下の観点で評価:
   - business_size: HPから推定される規模(従業員/拠点数/事業規模)
   - growth_signals: 採用拡大/新規事業/設備投資/M&A等の成長シグナル
   - product_fit: 商材が対象事業に直接適合するか
   - existing_solutions: 類似商材・競合製品の既存利用言及
   - timing_signals: DX/効率化/コスト削減/業務改革への言及
   - pain_signals: 商材で解決される課題が明示されているか
5. スコアリング(厳密):
   - 90-100: 明示的なニーズ表明あり、または類似商材を既に使ってる引用あり → 即決級
   - 70-89: 明示はないが、強い間接シグナル(成長/拡大/課題言及)複数あり
   - 50-69: 業種マッチ + 弱いシグナル1-2個
   - 30-49: 業種は周辺、シグナルなし
   - 0-29: 適合しない・買う可能性低い
   - 0-15: 競合(同種商材を販売している企業) → アプローチ厳禁

   ## スコア参考例 (キャリブレーション用)

   例A) 商材「クラウド勤怠管理」 → 製造業100名規模・HPに「業務効率化を推進」「DX人材募集」と明記
   → score:88 / fit_evidence:「DX推進中の中堅製造」/ citation:「業務効率化を推進」

   例B) 商材「Web制作」 → 老舗工務店・HPは古いがリニューアル予定の記載なし、ITとは無縁
   → score:25 / fit_evidence:null / reasoning:「業種ミスマッチで決め手なし」

   例C) 商材「英会話研修」 → 商社・HPに「海外展開強化」「英語ができる人材積極採用」
   → score:75 / fit_evidence:「海外展開強化中」/ citation:「英語ができる人材積極採用」

   例D) 商材「クラウド勤怠管理」 → 別のクラウド勤怠管理を販売する SaaS 企業
   → score:5 / is_competitor:true / reasoning:「同種商材を提供する競合」

8. is_competitor (T/F): 評価対象が、商材と類似のサービス/製品を販売している会社なら true
9. competitor_evidence: is_competitor=true の場合、その根拠引用 (なければ null)
10. decision_makers: HPから読み取れる決裁者名や役職 (社長/代表取締役/部長等)。配列形式
    例: [{"name": "山田太郎", "title": "代表取締役社長"}, {"title": "情報システム部 部長"}]
11. employees_estimate: HPテキストから推定される従業員規模 (数値, 不明ならnull)
12. dimensions: スコアの内訳 (透明性のため):
    - region_match: 0-100 (本社が選択地域内なら100、周辺県80、別地域0)
    - industry_match: 0-100 (商材ターゲット業種に直結なら100)
    - size_match: 0-100 (商材想定規模に合うなら100)
    - timing_signal: 0-100 (採用拡大/新規事業/DX等 タイミングシグナル強度)
    - evidence_strength: 0-100 (HPテキストに具体的根拠が多いほど高)
    - pain_alignment: 0-100 (商材で解決される課題が言及されている度合)
6. confidence: 評価の確信度(low/medium/high)。HPテキストが薄い場合は low
7. risks: 営業時のリスク(競合製品ロックイン、業績悪化、買収済み等)。なければ空配列

# 出力 (extended thinking でじっくり考えた上で、最後にJSONのみ)
{
  "score": 0-100,
  "confidence": "low|medium|high",
  "is_competitor": true|false,
  "competitor_evidence": "競合の場合の根拠引用 or null",
  "actual_industry": "HPから判明した実際の業種(暫定業種より優先)",
  "decision_makers": [{"name": "山田太郎 or null", "title": "代表取締役 or 部署名"}],
  "employees_estimate": 数値 or null,
  "fit_evidence": "30字以内の要約",
  "fit_citations": [
    {"quote": "HPテキストからの直接引用", "why": "なぜ商材適合のシグナルか"}
  ],
  "buying_signals": ["成長シグナル", "課題シグナル", ...],
  "risks": ["リスク1", "リスク2"],
  "dimensions": {
    "region_match": 0-100,
    "industry_match": 0-100,
    "size_match": 0-100,
    "timing_signal": 0-100,
    "evidence_strength": 0-100,
    "pain_alignment": 0-100
  },
  "talking_points": ["架電時に触れるべき具体的トピック (HPから引用ベース)"],
  "reasoning": "総合評価を50字以内で"
}`;

  try {
    // Opus 4.7 + extended thinking (深い推論)
    // アダプティブ思考予算: HP テキストが大きい場合や stage1 が borderline (40-70)
    // の時はより多くのthinking budget を使う
    let budget = 8000;
    if (hpText && hpText.length > 5000) budget = 12000;
    if (stage1 && stage1.score >= 40 && stage1.score <= 70) budget = 14000;
    const useModel = modelOverride || 'claude-opus-4-7';
    const text = await callClaude({
      system: sys,
      prompt,
      max_tokens: 5000,
      model: useModel,
      thinking: { type: 'enabled', budget_tokens: budget },
      temperature: 1.0, // extended thinking時は1.0が必須
    });
    // Opus は Sonnet より概ね 3-5x のコスト
    const costMultiplier = useModel.includes('opus') ? (budget >= 12000 ? 4 : 3) : 1;
    incrementUsage('ai', costMultiplier);
    // 最後の JSON ブロックを抽出
    const matches = [...text.matchAll(/\{[\s\S]*?\}/g)];
    if (matches.length === 0) return null;
    // 末尾の最大JSONを採用
    let lastJson = null;
    for (const m of matches) {
      try {
        const obj = JSON.parse(m[0]);
        if (typeof obj.score === 'number') lastJson = obj;
      } catch {}
    }
    if (!lastJson) {
      // フォールバック: ```json ブロック内のJSON
      const blockM = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (blockM) {
        try { lastJson = JSON.parse(blockM[1]); } catch {}
      }
    }
    if (!lastJson) return null;
    return {
      score: Math.max(0, Math.min(100, parseInt(lastJson.score, 10) || 0)),
      confidence: lastJson.confidence || 'medium',
      is_competitor: lastJson.is_competitor === true,
      competitor_evidence: lastJson.competitor_evidence || null,
      actual_industry: lastJson.actual_industry || null,
      decision_makers: Array.isArray(lastJson.decision_makers) ? lastJson.decision_makers.slice(0, 5) : [],
      employees_estimate: typeof lastJson.employees_estimate === 'number' ? lastJson.employees_estimate : null,
      fit_evidence: lastJson.fit_evidence || null,
      fit_citations: Array.isArray(lastJson.fit_citations) ? lastJson.fit_citations.slice(0, 5) : [],
      buying_signals: Array.isArray(lastJson.buying_signals) ? lastJson.buying_signals.slice(0, 6) : [],
      risks: Array.isArray(lastJson.risks) ? lastJson.risks.slice(0, 4) : [],
      dimensions: lastJson.dimensions || null,
      talking_points: Array.isArray(lastJson.talking_points) ? lastJson.talking_points.slice(0, 5) : [],
      reasoning: String(lastJson.reasoning || '').slice(0, 100),
    };
  } catch (e) {
    console.warn('aiScoreStage3Deep failed', company.name, e);
    return null;
  }
}

async function aiScript(company, productText, icp, strategy) {
  // 既存のAI評価データ(購買シグナル/HP引用/決裁者)を最大活用して、
  // 「この会社のためだけの」スクリプトを生成
  const evidence = company.ai_fit_evidence ? `\n【AI判定の適合根拠】${company.ai_fit_evidence}` : '';
  const citations = Array.isArray(company.ai_fit_citations) && company.ai_fit_citations.length > 0
    ? `\n【HPからの引用根拠】\n${company.ai_fit_citations.slice(0,3).map(c => `- 「${c.quote}」(${c.why||''})`).join('\n')}` : '';
  const signals = Array.isArray(company.ai_buying_signals) && company.ai_buying_signals.length > 0
    ? `\n【検出された購買シグナル】${company.ai_buying_signals.slice(0,4).join('、')}` : '';
  const talking = Array.isArray(company.ai_talking_points) && company.ai_talking_points.length > 0
    ? `\n【架電トピック候補(AI事前分析)】\n${company.ai_talking_points.slice(0,4).map((t,i)=>`${i+1}. ${t}`).join('\n')}` : '';
  const dms = Array.isArray(company.ai_decision_makers) && company.ai_decision_makers.length > 0
    ? `\n【決裁者候補(HP抽出)】${company.ai_decision_makers.map(d => `${d.title||''}${d.name?': '+d.name:''}`).join('、')}` : '';

  const system = `あなたは特定商取引法を熟知したB2B営業のシニアコンサルタントです。
事前にAIで分析された企業情報(購買シグナル/HP引用/決裁者)を最大限活用して、
「この会社のためだけ」の高度にパーソナライズされた架電スクリプトを生成します。
冒頭の事業者名・勧誘目的の明示、再勧誘禁止への配慮を必ず含めてください。`;
  const prompt = `以下の情報から、自然で実用的な架電スクリプトを日本語で作成してください。

【商材】${productText}
【ターゲット企業】${company.name} / ${company.industry||'?'} / ${company.prefecture||''}${company.city||''} / 従業員${company.employees||'?'}名
【事業内容メモ】${company.description||''}
【想定課題】${icp.pains?.join('、')||''}
【決裁者(想定)】${strategy.decision_maker||''}
【購入動機】${strategy.motivation||''}
${evidence}${citations}${signals}${talking}${dms}

構成:
■ オープニング（事業者名・勧誘目的明示・受付突破トーク）
■ 仮説提示（HP引用・購買シグナルを踏まえた具体的な切り口）
■ 現状ヒアリング（質問2〜3個・上記検出シグナルに基づく）
■ クロージング（次のアクション提示）
■ ◯◯部長への取次依頼トーク (決裁者候補がいれば)
■ コンプライアンス注意点

スクリプト全文を返してください。`;
  return await callClaude({ system, prompt, max_tokens: 2000 });
}

// パーソナライズされた最初のアプローチメール文案を生成
async function aiOutreachEmail(company, productText, strategy) {
  const evidence = company.ai_fit_evidence ? `\n【AI判定の適合根拠】${company.ai_fit_evidence}` : '';
  const citations = Array.isArray(company.ai_fit_citations) && company.ai_fit_citations.length > 0
    ? `\n【HPからの引用】${company.ai_fit_citations.slice(0,2).map(c => `「${c.quote}」`).join(' / ')}` : '';
  const signals = Array.isArray(company.ai_buying_signals) && company.ai_buying_signals.length > 0
    ? `\n【購買シグナル】${company.ai_buying_signals.slice(0,3).join('、')}` : '';

  const system = `あなたはB2B営業のメール文案作成専門家です。
スパムにならない、相手に「自社のことを理解してくれている」と感じさせる、簡潔でパーソナライズされた最初のアプローチメールを書きます。
セールスっぽさを抑え、相手の課題やニュースに触れることで関心を引きます。`;
  const prompt = `# 商材
${productText}

# 送信先企業
${company.name} / ${company.industry||'?'} / ${company.prefecture||''}${company.city||''}
HP: ${company.website||''}
${evidence}${citations}${signals}

# 要件
- 件名: 30字以内、相手の関心を引く具体的トピック
- 本文: 400-600字、以下構成
  - 簡潔な自己紹介(1-2行)
  - 相手企業の状況/取り組みに触れる(HPから引用ベース)
  - 商材を相手の文脈で説明(押し売りNG)
  - 軽い CTA(15分のオンライン MTGなど)
- 署名は「[会社名]担当 [名前]」のプレースホルダーで

メール全文(件名 + 本文)を返してください。`;
  return await callClaude({ system, prompt, max_tokens: 1500 });
}

/* ============ AI Chat Mode ============ */
const CHAT_SYSTEM = `あなたはB2B営業戦略のシニアコンサルタントです。ユーザーが売りたい商材について自然な会話で深掘りし、最終的に営業戦略立案に必要な情報を引き出してください。

会話の流れ(柔軟に):
1) 商品/サービスの概要・価値
2) ターゲット業種・規模
3) 主な価値訴求ポイント・差別化
4) 価格帯
5) 既存顧客の特徴・成功事例
6) 営業上の課題・困っていること

ルール:
- 1ターンで質問は1〜2問だけ。短く。
- ユーザーの回答に共感・確認してから次の質問へ。
- カジュアルで自然な日本語(敬語ベース)。
- 上記6観点が概ね揃ったら、最後に「ありがとうございます。これまでの情報をまとめます」と言い、商材を1段落のリッチな説明文に要約。要約の最後に必ず [FINALIZE] というマーカーを付ける。
- ユーザーが早く終わらせたい意図を示したら、その時点で要約に進む。`;

let chatHistory = [];

function appendChatMessage(role, text) {
  const logEl = document.getElementById('chat-log');
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.innerHTML = `
    <div class="avatar">${role === 'user' ? '👤' : '🤖'}</div>
    <div class="bubble">${escapeHtml(text)}</div>
  `;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  return div;
}

function appendLoadingMsg() {
  const logEl = document.getElementById('chat-log');
  const div = document.createElement('div');
  div.className = 'chat-msg assistant loading';
  div.innerHTML = `<div class="avatar">🤖</div><div class="bubble"></div>`;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  return div;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function startChatMode() {
  if (!store.opts.braveProxy && !store.opts.aiKey) {
    alert('対話モードにはLLMが必要です。\n\n方法A(推奨): WorkerのSecretsに ANTHROPIC_API_KEY を追加（Anthropicで$5から購入）\n方法B(無料): Worker Settings → AI Bindings で "AI" を追加（Cloudflare Workers AI使用）\n方法C: サイドバー🤖 AI設定で直接APIキー入力（共有端末ではNG）');
    return;
  }
  chatHistory = [];
  document.getElementById('chat-log').innerHTML = '';
  document.getElementById('chat-modal').hidden = false;
  document.getElementById('chat-input').focus();
  const opener = 'こんにちは!営業戦略を一緒に組み立てます。\n\nまず、どんな商材を売っていらっしゃいますか? 商品名・サービス名と概要をざっくり教えてください。';
  appendChatMessage('assistant', opener);
  chatHistory.push({ role: 'assistant', content: opener });
}

async function sendChatMessage() {
  const inputEl = document.getElementById('chat-input');
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';
  appendChatMessage('user', text);
  chatHistory.push({ role: 'user', content: text });

  const loadingEl = appendLoadingMsg();
  try {
    const reply = await callClaude({
      system: CHAT_SYSTEM,
      messages: chatHistory,
      max_tokens: 1024,
    });
    loadingEl.remove();
    appendChatMessage('assistant', reply.replace('[FINALIZE]', '').trim());
    chatHistory.push({ role: 'assistant', content: reply });
    if (reply.includes('[FINALIZE]')) {
      document.getElementById('chat-finalize').disabled = false;
      document.getElementById('chat-finalize').textContent = '✓ この内容で確定して分析へ';
    }
  } catch (e) {
    loadingEl.remove();
    appendChatMessage('assistant', `エラー: ${e.message}`);
  }
}

async function finalizeChat() {
  const btn = document.getElementById('chat-finalize');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '要約を生成中…';

  // [FINALIZE]マーカー付きの要約があるかチェック
  const finalMsg = [...chatHistory].reverse().find(m =>
    m.role === 'assistant' && m.content.includes('[FINALIZE]')
  );

  let summary;
  if (finalMsg) {
    summary = finalMsg.content.replace(/\[FINALIZE\]/g, '').trim();
    const m = summary.match(/(?:まとめます[。:：]?\s*)([\s\S]+)$/);
    if (m) summary = m[1].trim();
  } else {
    // AIに即時要約を依頼
    try {
      const summaryReply = await callClaude({
        system: 'あなたはB2B営業戦略の専門家です。これまでの会話から商材の特徴・ターゲット・価値訴求を1段落の説明文にまとめてください。',
        messages: [
          ...chatHistory,
          { role: 'user', content: 'これまでの会話から、私が売っている商材の説明文を1段落(150〜300文字)で作成してください。商品名・ターゲット業種・規模・価値訴求・差別化点を盛り込んで。説明文のみで他のテキスト不要。' },
        ],
        max_tokens: 800,
      });
      summary = summaryReply.replace(/\[FINALIZE\]/g, '').trim();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = origText;
      alert(`要約生成に失敗: ${e.message}`);
      return;
    }
  }

  document.getElementById('product-input').value = summary;
  document.getElementById('chat-modal').hidden = true;
  btn.disabled = false;
  btn.textContent = origText;
  setTimeout(() => {
    document.getElementById('analyze-btn').click();
  }, 200);
}

/* ============ Pipeline ============ */
async function runPipeline(input, options = {}) {
  const { discover = false } = options;
  if (!discover && getAllCompanies().length === 0) {
    alert('企業データが0件です。先に「🌐 ウェブから企業を発見して分析」で発見するか、サイドバーから取込してください。');
    return;
  }
  // 押した瞬間にフィードバックを出す(AI分析中の数秒間も無反応に見えないように)
  const progElEarly = document.getElementById('discovery-progress');
  if (discover && progElEarly) {
    progElEarly.hidden = false;
    progElEarly.classList.remove('done', 'error');
    progElEarly.textContent = '🤖 AIが商材を分析中…(数秒〜十数秒)';
    progElEarly.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  if (store.opts.aiKey || store.opts.braveProxy) {
    setAIStatus('AI分析中…', 'mid');
    try {
      const result = await aiAnalyzeProduct(input);
      // AI応答が不完全でも動くようルールベースを土台にしてマージ
      const ruleClassif = classifyProduct(input);
      const ruleIcp = ruleClassif.category.icp;
      const ruleStrategy = inferStrategy(ruleClassif.category, ruleIcp);
      const mergedIcp = {
        industries: (result.icp?.industries?.length ? result.icp.industries : ruleIcp.industries),
        sizes: (result.icp?.sizes?.length ? result.icp.sizes : ruleIcp.sizes),
        pains: (result.icp?.pains?.length ? result.icp.pains : ruleIcp.pains),
        keywords: (result.icp?.keywords?.length ? result.icp.keywords : ruleIcp.keywords),
        anti_patterns: [],
      };
      state.classification = {
        category: { id: 'ai', name: result.category_name || ruleClassif.category.name, icp: mergedIcp },
        confidence: result.confidence || 'high',
        alternatives: [],
      };
      state.icp = mergedIcp;
      state.strategy = { ...ruleStrategy, ...(result.strategy || {}) };
      state.intentSignals = (result.strategy && result.strategy.target_signals) || [];
      setAIStatus('AI分析完了 ✓', 'good');
    } catch (e) {
      console.error('AI分析失敗', e);
      setAIStatus(`AI失敗: ${e.message.slice(0,60)} → ルールベース動作`, 'low');
      state.classification = classifyProduct(input);
      state.icp = state.classification.category.icp;
      state.strategy = inferStrategy(state.classification.category, state.icp);
      state.intentSignals = analyzeProductIntent(input);
    }
  } else {
    state.classification = classifyProduct(input);
    state.icp = state.classification.category.icp;
    state.strategy = inferStrategy(state.classification.category, state.icp);
    state.intentSignals = analyzeProductIntent(input);
  }
  // Brave APIキーがあって discoverモードなら、ウェブから企業発見
  const progEl = document.getElementById('discovery-progress');
  if (discover && (store.opts.braveKey || store.opts.braveProxy)) {
    progEl.hidden = false;
    progEl.classList.remove('done', 'error');
    // 絞り込み条件を取得→クエリに反映(地域選択優先)
    const prefList = [...selectedPrefs()];
    const cityList = [...selectedCities()];
    const preFilters = {
      industry: document.getElementById('filter-industry').value,
      prefectures: prefList,
      cities: cityList,
    };
    const hasPreFilter = preFilters.industry || prefList.length > 0 || cityList.length > 0;
    const totalRegions = (cityList.length > 0 ? cityList.length : prefList.length);
    progEl.textContent = hasPreFilter
      ? `絞り込み条件(${[preFilters.industry, prefList.length>0?prefList.join('・')+'全域':'', cityList.length>0?cityList.length+'市区':''].filter(Boolean).join('・')})で検索中…`
      : '商材を分析してターゲット企業を検索中…';
    const customQueries = hasPreFilter ? generateFilteredQueries(input, state.icp, preFilters, 0) : null;
    // 地域数 × 業種数 ぶんのクエリを実行(最大30本までで安全弁)
    const maxQs = customQueries ? Math.min(30, Math.max(10, customQueries.length)) : 10;
    try {
      const found = await discoverFromBrave(input, state.icp, msg => {
        progEl.textContent = msg;
      }, customQueries ? { queries: customQueries, maxQueries: maxQs } : {});
      // 国税庁API補助発見 (品質モード + 地域指定時のみ)
      let houjinFound = [];
      if (store.opts.qualityMode !== false && (prefList.length > 0 || cityList.length > 0)) {
        try {
          progEl.textContent = `🏛 国税庁ベースで補助発見を開始…`;
          const houjinCandidates = await discoverViaHoujinBangou(input, state.icp, msg => {
            progEl.textContent = msg;
          });
          // 既存の発見企業と重複する法人番号を除外
          const existingBangous = new Set([...store.importedCompanies, ...store.customCompanies]
            .map(c => c.houjin_bangou).filter(Boolean));
          const dedupedCandidates = houjinCandidates.filter(c =>
            !c.houjin_bangou || !existingBangous.has(c.houjin_bangou));
          if (dedupedCandidates.length > 0) {
            // HP取得 + パイプライン投入 (最大40社まで)
            const limit = Math.min(40, dedupedCandidates.length);
            houjinFound = await enrichHoujinCandidatesWithHP(dedupedCandidates.slice(0, limit), input, msg => {
              progEl.textContent = msg;
            });
            if (houjinFound.length > 0) {
              store.importedCompanies.push(...houjinFound);
              saveStore();
              // 通常のAIスコアリングは後続の batchScoreExisting に任せる
            }
          }
        } catch (e) {
          console.warn('houjin discovery failed', e);
        }
      }
      progEl.classList.add('done');
      progEl.textContent = `✓ ${found.length}社(Brave) + ${houjinFound.length}社(国税庁) = 計${found.length + houjinFound.length}社の新規企業を発見`;
    } catch (e) {
      console.error('discover error:', e);
      progEl.classList.add('error');
      progEl.textContent = `発見失敗: ${e.message} ${e.stack ? '(詳細はブラウザコンソール参照)' : ''}`;
    }
  } else if (discover && !store.opts.braveKey && !store.opts.braveProxy) {
    progEl.hidden = false;
    progEl.classList.add('error');
    progEl.textContent = '⚠ ウェブ検索が未設定。サイドバー「🌐 ウェブ検索」でCloudflare WorkerプロキシURLを登録してください';
  }

  // 商材が変わっていれば既存企業のAI評価をクリア
  if (discover) {
    const key = input.slice(0, 60);
    const refreshable = [...store.importedCompanies, ...store.customCompanies];
    let cleared = 0;
    for (const c of refreshable) {
      if (c.ai_scored_for !== key && typeof c.ai_score === 'number') {
        delete c.ai_score;
        delete c.ai_reasoning;
        delete c.ai_fit;
        delete c.ai_scored_for;
        cleared++;
      }
    }
    if (cleared > 0) {
      console.log(`商材変更により ${cleared} 社のAI評価をクリアして再評価対象に`);
      saveStore();
    }
  }

  state.discoveryRound = 0;
  const allCompanies = getAllCompanies();
  state.scored = allCompanies
    .map(c => scoreCompany(c, state.icp, state.strategy, state.intentSignals))
    .sort((a, b) => b.score - a.score);
  renderClassification(state.classification);
  renderStrategy(state.strategy, state.scored);
  renderICP(state.icp);
  renderFilters();
  renderResults();
  renderSidebar();
  // 結果の下に「もっと探す」セクションを表示(Brave設定済みのときのみ)
  const moreEl = document.getElementById('discover-more-section');
  if (moreEl) {
    moreEl.hidden = !(store.opts.braveKey || store.opts.braveProxy);
  }
  // 検索後は「同条件で追加検索」ボタンを表示
  const refineBtn = document.getElementById('refine-search-btn');
  if (refineBtn) refineBtn.hidden = false;
  // バックグラウンドで既存企業のAI再評価(時間かかるので画面更新は段階的)
  if (discover) {
    batchScoreExisting(input, msg => {
      if (progEl) progEl.textContent = msg;
    }).catch(e => console.warn('batch score failed', e));
  }
}

async function refineSearch() {
  if (!state.icp) { alert('先に商材を分析してください'); return; }
  const prefList = [...selectedPrefs()];
  const cityList = [...selectedCities()];
  const filters = {
    industry: document.getElementById('filter-industry').value,
    prefectures: prefList,
    cities: cityList,
    size: document.getElementById('filter-size').value,
  };
  if (!filters.industry && prefList.length === 0 && cityList.length === 0) {
    alert('業種・地域のいずれかを指定してください');
    return;
  }
  state.discoveryRound = (state.discoveryRound || 0) + 1;
  const input = document.getElementById('product-input').value.trim();
  const queries = generateFilteredQueries(input, state.icp, filters, state.discoveryRound);
  const progEl = document.getElementById('refine-progress');
  progEl.hidden = false;
  progEl.classList.remove('done', 'error');
  progEl.textContent = `絞り込み条件で再検索: ${queries.length}クエリ実行中…`;
  try {
    const found = await discoverFromBrave(input, state.icp, msg => {
      progEl.textContent = msg;
    }, { queries, maxQueries: 10 });
    progEl.classList.add('done');
    const allCompanies = getAllCompanies();
    state.scored = allCompanies
      .map(c => scoreCompany(c, state.icp, state.strategy, state.intentSignals))
      .sort((a, b) => b.score - a.score);
    renderFilters();
    renderResults();
    renderSidebar();
  } catch (e) {
    progEl.classList.add('error');
    progEl.textContent = `失敗: ${e.message}`;
  }
}

async function discoverMore(count) {
  if (!state.icp) { alert('先に商材を分析してください'); return; }
  state.discoveryRound = (state.discoveryRound || 0) + 1;
  const input = document.getElementById('product-input').value.trim();
  const progEl = document.getElementById('discover-more-progress');
  progEl.hidden = false;
  progEl.classList.remove('done', 'error');
  progEl.textContent = `ラウンド${state.discoveryRound}: 検索中…`;
  try {
    const found = await discoverFromBrave(input, state.icp, msg => {
      progEl.textContent = msg;
    }, { round: state.discoveryRound, maxQueries: Math.ceil(count / 2) });
    progEl.classList.add('done');
    // 再スコアリング
    const allCompanies = getAllCompanies();
    state.scored = allCompanies
      .map(c => scoreCompany(c, state.icp, state.strategy, state.intentSignals))
      .sort((a, b) => b.score - a.score);
    renderFilters();
    renderResults();
    renderSidebar();
    if (found.length === 0) {
      progEl.classList.remove('done');
      progEl.classList.add('error');
      progEl.textContent += '（追加なし。「もっと探す」を再度押すと別のクエリで検索します）';
    }
  } catch (e) {
    progEl.classList.add('error');
    progEl.textContent = `失敗: ${e.message}`;
  }
}

function setAIStatus(msg, level) {
  const el = document.getElementById('ai-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = level === 'good' ? 'var(--good)' : level === 'low' ? 'var(--danger)' : 'var(--mid)';
}

function renderStrategy(strategy, scored) {
  const section = document.getElementById('strategy-section');
  const display = document.getElementById('strategy-display');
  const highCount = scored.filter(c => c.score >= 70).length;
  const midCount = scored.filter(c => c.score >= 40 && c.score < 70).length;
  const primary = [
    { icon: '🎯', label: '想定ペルソナ', value: strategy.persona },
    { icon: '👤', label: '想定決裁者', value: strategy.decision_maker },
    { icon: '💡', label: '購入動機', value: strategy.motivation },
    { icon: '🚫', label: '避けるべき対象', value: strategy.avoid, warn: true },
  ];
  const secondary = [
    { icon: '💰', label: '想定予算帯', value: strategy.budget_range },
    { icon: '⏰', label: '商談時間の目安', value: strategy.meeting_time },
    { icon: '🤔', label: '主な反対理由', value: strategy.objections },
    { icon: '✨', label: '差別化ポイント', value: strategy.differentiators },
    { icon: '📞', label: '効果的なアプローチ', value: strategy.approach },
    { icon: '📊', label: '市場・業界トレンド', value: strategy.market_context },
    { icon: '📋', label: 'ヒアリング質問', value: strategy.key_questions },
    { icon: '📅', label: 'ベストタイミング', value: strategy.timing },
  ];
  const renderCard = c => `
    <div class="strategy-card ${c.warn ? 'warn' : ''}">
      <div class="label">${c.icon} ${c.label}</div>
      <div>${c.value || '-'}</div>
    </div>`;
  display.innerHTML = `
    <div class="strategy-grid">${primary.map(renderCard).join('')}</div>
    <details class="strategy-details">
      <summary>📖 詳細を見る（予算帯・反対理由・アプローチ等の8項目）</summary>
      <div class="strategy-grid" style="margin-top:12px;">${secondary.map(renderCard).join('')}</div>
    </details>
    <div class="strategy-summary">
      <strong>分析結論：</strong>
      ${highCount > 0
        ? `登録企業内で<strong>${highCount}社</strong>が高適合（適合度70+）。中程度の見込みも含めると${highCount + midCount}社が対象候補です。`
        : midCount > 0
        ? `高適合の企業は見つかりませんでしたが、<strong>${midCount}社</strong>が中程度の見込みです。商材説明を具体化するか、データ件数を増やすと精度が上がります。`
        : `現在のデータでは適合企業が少なめです。サイドバーからCSV取込・企業追加で対象を広げてください。`}
    </div>
  `;
  section.hidden = false;
}

/* ============ Init ============ */
async function init() {
  try {
    const res = await fetch('data/companies.json?v=20260513q');
    state.companies = await res.json();
  } catch (e) {
    console.warn('companies.json読み込み失敗:', e);
    state.companies = [];
  }

  loadStore();
  // 既存ストアの一括クリーンアップ: 古い名前を整形 & 記事を除外
  migrateCleanCompanies();
  updateOnboarding();

  document.getElementById('opt-exclude-dnc').checked = store.opts.excludeDnc;
  document.getElementById('opt-saved-only').checked = store.opts.savedOnly;
  document.getElementById('opt-dark').checked = !!store.opts.dark;
  const bravePagesEl = document.getElementById('opt-brave-pages');
  if (bravePagesEl) bravePagesEl.value = String(store.opts.bravePages || 2);
  if (store.opts.dark) document.documentElement.setAttribute('data-theme', 'dark');
  // 初回起動時は利用規約モーダル
  setupTosModal();
  setupLoginModal();
  setupAdminPanel();
  setupBillingReportModal();
  setupMasterAdminModal();
  setupScoreDetailModal();
  renderBillingPanel();
  // Firebase 連携
  const wireFirebase = () => {
    if (!window.firebaseApi) return;
    window.firebaseApi.onAuthStateChanged((user) => {
      if (user) onFirebaseSignedIn(user);
      else onFirebaseSignedOut();
    });
  };
  if (window.FIREBASE_READY) {
    wireFirebase();
  } else {
    // firebase-sync.js が後から読み込まれる場合
    window.addEventListener('firebase-ready', wireFirebase, { once: true });
  }
  updateAccountUI();

  document.getElementById('opt-dark').addEventListener('change', e => {
    store.opts.dark = e.target.checked;
    if (e.target.checked) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    saveStore();
  });

  // 通話記録モーダル
  document.getElementById('call-save').addEventListener('click', saveCallRecord);
  document.getElementById('call-cancel').addEventListener('click', () => {
    document.getElementById('call-modal').hidden = true;
    renderResults();
  });
  document.getElementById('call-modal').addEventListener('click', e => {
    if (e.target.id === 'call-modal') { e.target.hidden = true; renderResults(); }
  });

  // プロファイル保存
  document.getElementById('prof-save').addEventListener('click', saveProfile);
  // 旧設定のマイグレーション: braveKeyがURLっぽければproxyに移す
  if (store.opts.braveKey && /^https?:\/\//.test(store.opts.braveKey)) {
    store.opts.braveProxy = store.opts.braveKey;
    store.opts.braveKey = '';
    saveStore();
  }
  // 1欄表示: 現在の値はproxyかkeyのどちらか
  const braveInput = document.getElementById('opt-brave-input');
  const braveDetected = document.getElementById('brave-detected');
  const updateBraveBadge = () => {
    const on = !!(store.opts.braveKey || store.opts.braveProxy);
    document.getElementById('badge-brave').textContent = on ? 'ON' : 'OFF';
  };
  const updateBraveDetected = () => {
    if (store.opts.braveProxy) {
      braveDetected.textContent = `✓ Workerプロキシ: ${store.opts.braveProxy}`;
      braveDetected.style.color = 'var(--good)';
    } else if (store.opts.braveKey) {
      braveDetected.textContent = '⚠ APIキーモード（CORSで動かない可能性あり。Worker URL推奨）';
      braveDetected.style.color = 'var(--mid)';
    } else {
      braveDetected.textContent = '未入力';
      braveDetected.style.color = 'var(--muted)';
    }
  };
  braveInput.value = store.opts.braveProxy || store.opts.braveKey || '';
  updateBraveBadge();
  updateBraveDetected();
  braveInput.addEventListener('input', e => {
    const v = e.target.value.trim();
    if (/^https?:\/\//.test(v)) {
      store.opts.braveProxy = v.replace(/\/+$/, '');
      store.opts.braveKey = '';
    } else {
      store.opts.braveKey = v;
      store.opts.braveProxy = '';
    }
    updateBraveBadge();
    updateBraveDetected();
    saveStore();
  });
  document.getElementById('brave-test').addEventListener('click', async () => {
    const statusEl = document.getElementById('brave-status');
    if (!store.opts.braveKey && !store.opts.braveProxy) { statusEl.textContent = 'URLかキーを入力してください'; statusEl.style.color = 'var(--danger)'; return; }
    statusEl.textContent = 'テスト中…'; statusEl.style.color = 'var(--mid)';
    try {
      const r = await braveSearch('テスト', 1);
      statusEl.textContent = `接続成功 ✓ (結果${r.length}件)`;
      statusEl.style.color = 'var(--good)';
    } catch (e) {
      statusEl.textContent = `失敗: ${e.message.slice(0,80)}`;
      statusEl.style.color = 'var(--danger)';
    }
  });

  document.getElementById('opt-ai-enabled').checked = !!store.opts.aiEnabled;
  document.getElementById('opt-ai-key').value = store.opts.aiKey || '';
  document.getElementById('opt-ai-model').value = store.opts.aiModel || 'claude-haiku-4-5-20251001';
  document.getElementById('badge-ai').textContent = store.opts.aiEnabled ? 'ON' : 'OFF';

  document.getElementById('opt-ai-enabled').addEventListener('change', e => {
    store.opts.aiEnabled = e.target.checked;
    document.getElementById('badge-ai').textContent = store.opts.aiEnabled ? 'ON' : 'OFF';
    saveStore();
    if (store.opts.aiEnabled) setAIStatus('AIモード ON。キー設定済みなら次の分析からClaudeを使用', 'good');
    else setAIStatus('AIモード OFF（ルールベース）', 'mid');
  });
  document.getElementById('opt-ai-key').addEventListener('input', e => {
    const newKey = e.target.value.trim();
    const wasEmpty = !store.opts.aiKey;
    store.opts.aiKey = newKey;
    // キーを新規に入力したら自動でAIモードON
    if (wasEmpty && newKey) {
      store.opts.aiEnabled = true;
      document.getElementById('opt-ai-enabled').checked = true;
      document.getElementById('badge-ai').textContent = 'ON';
    }
    saveStore();
  });
  document.getElementById('opt-ai-model').addEventListener('change', e => {
    store.opts.aiModel = e.target.value;
    saveStore();
  });
  document.getElementById('ai-test').addEventListener('click', async () => {
    if (!store.opts.aiKey) { setAIStatus('APIキーを入力してください', 'low'); return; }
    setAIStatus('テスト中…', 'mid');
    try {
      const r = await callClaude({ system: '簡潔に「OK」とだけ返してください', prompt: 'ping', max_tokens: 16 });
      setAIStatus(`接続成功 ✓ (${r.slice(0,20)})`, 'good');
    } catch (e) {
      setAIStatus(`接続失敗: ${e.message.slice(0,80)}`, 'low');
    }
  });

  document.getElementById('analyze-btn').addEventListener('click', async () => {
    const input = document.getElementById('product-input').value.trim();
    if (!input) { alert('商材を入力してください'); return; }
    if (!requireTosAccepted()) return;
    if (isBillingCapped()) {
      alert(`今月の利用上限(¥${(getBillingConfig().monthlyCap||0).toLocaleString()})に到達しています。\n管理者にお問い合わせください。`);
      return;
    }
    if (state.continuousSearch) {
      // 既に検索中 → 停止
      state.continuousSearch = false;
      state.searchAborted = true;
      logAction('search_stopped', input.slice(0, 80));
      saveStore();
      return;
    }
    state.continuousSearch = true;
    state.searchAborted = false;
    logAction('search_started', input.slice(0, 80), { regionPrefs: store.opts.regionPrefs, regionCities: store.opts.regionCities });
    saveStore();
    const btn = document.getElementById('analyze-btn');
    const origText = btn.textContent;
    const updateBtn = () => {
      const total = getAllCompanies().length;
      btn.innerHTML = `⏸ 検索を停止（累計 ${total} 社・継続中…）`;
    };
    btn.classList.add('searching');
    updateBtn();
    // 進捗パネルも即座に表示(AI分析中の数秒間で「押せたか不明」にならないように)
    const progElImmediate = document.getElementById('discovery-progress');
    if (progElImmediate) {
      progElImmediate.hidden = false;
      progElImmediate.classList.remove('done', 'error');
      progElImmediate.textContent = '🚀 検索を開始しています…';
    }
    // 次フレームまで描画を待ってから重い処理に入る
    await new Promise(r => requestAnimationFrame(() => r()));
    const tick = setInterval(updateBtn, 2000);
    try {
      // 初回検索
      await runPipeline(input, { discover: true });
      // 連続検索ループ: 停止されるまでラウンドを進めて発見
      while (state.continuousSearch) {
        await new Promise(r => setTimeout(r, 3000));
        if (!state.continuousSearch) break;
        await discoverMore(10);
      }
    } catch (e) {
      console.error('continuous search error:', e);
    } finally {
      clearInterval(tick);
      state.continuousSearch = false;
      btn.classList.remove('searching');
      btn.textContent = origText;
    }
  });
  document.getElementById('analyze-existing-btn').addEventListener('click', async () => {
    const input = document.getElementById('product-input').value.trim();
    if (!input) { alert('商材を入力してください'); return; }
    if (!requireTosAccepted()) return;
    await runPipeline(input, { discover: false });
  });

  document.getElementById('discover-more-btn').addEventListener('click', () => discoverMore(5));
  document.getElementById('discover-more-many-btn').addEventListener('click', () => discoverMore(10));
  document.getElementById('refine-search-btn').addEventListener('click', refineSearch);
  document.getElementById('filter-text-apply').addEventListener('click', applyFilterFromText);

  // 対話モード
  document.getElementById('chat-mode-btn').addEventListener('click', startChatMode);
  document.getElementById('chat-send').addEventListener('click', sendChatMessage);
  document.getElementById('chat-input').addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendChatMessage(); }
  });
  document.getElementById('chat-finalize').addEventListener('click', finalizeChat);
  document.getElementById('chat-cancel').addEventListener('click', () => {
    document.getElementById('chat-modal').hidden = true;
  });
  document.getElementById('chat-modal').addEventListener('click', e => {
    if (e.target.id === 'chat-modal') e.target.hidden = true;
  });

  document.querySelectorAll('.sample-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('product-input').value = btn.dataset.sample;
    });
  });

  ['filter-industry', 'filter-size'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', renderResults);
  });
  // Phase10 拡張フィルタ
  const minScoreEl = document.getElementById('filter-min-score');
  if (minScoreEl) {
    const updateLabel = () => {
      const v = document.getElementById('filter-min-score-val');
      if (v) v.textContent = minScoreEl.value;
      renderResults();
    };
    minScoreEl.addEventListener('input', updateLabel);
  }
  ['filter-no-competitor', 'filter-active-only', 'filter-deep-only', 'filter-houjin-only'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', renderResults);
  });
  const dsBtn = document.getElementById('discover-similar-btn');
  if (dsBtn) dsBtn.addEventListener('click', discoverSimilarToTop);
  const epBtn = document.getElementById('evolve-profile-btn');
  if (epBtn) epBtn.addEventListener('click', async () => {
    if (!state.icp) { alert('先に商材を分析してください'); return; }
    const productText = document.getElementById('product-input').value.trim();
    if (!productText) return;
    epBtn.disabled = true; epBtn.textContent = '🧬 進化中…';
    try {
      const evolved = await evolveProductProfile(productText);
      if (!evolved) {
        alert('進化に必要な実例(商談化/DNC等)が不足しています。\nまず数社を架電・評価してください。');
        return;
      }
      const summary = `提案された進化版プロファイル:

【業種】 ${(evolved.refined_industries||[]).join('、')}
【規模】 ${(evolved.refined_sizes||[]).join('・')}
【課題】 ${(evolved.refined_pains||[]).join('、')}
【避けるべき】 ${(evolved.avoid_patterns||[]).join('、')}

【インサイト】 ${evolved.insights || ''}

【次回検索改善案】
${(evolved.search_strategy_tweaks||[]).map((t,i)=>`${i+1}. ${t}`).join('\n')}

このプロファイルを適用しますか?`;
      if (confirm(summary)) {
        applyEvolvedProfile(evolved);
        alert('✓ ICP を進化版に更新しました。次回検索から反映されます。');
      }
    } catch (e) {
      alert(`失敗: ${e.message}`);
    } finally {
      epBtn.disabled = false; epBtn.textContent = '🧬 商材プロファイル進化';
    }
  });

  // 地域選択モーダル
  const rsBtn = document.getElementById('region-select-btn');
  if (rsBtn) rsBtn.addEventListener('click', openRegionModal);
  const regionSearch = document.getElementById('region-search');
  if (regionSearch) regionSearch.addEventListener('input', renderRegionTree);
  const regionClear = document.getElementById('region-clear-all');
  if (regionClear) regionClear.addEventListener('click', () => {
    store.opts.regionPrefs = [];
    store.opts.regionCities = [];
    saveStore();
    renderRegionTree();
  });
  const regionApply = document.getElementById('region-apply');
  if (regionApply) regionApply.addEventListener('click', () => {
    document.getElementById('region-modal').hidden = true;
    renderRegionChips();
    if (state.scored.length > 0) renderResults();
  });
  const regionCancel = document.getElementById('region-cancel');
  if (regionCancel) regionCancel.addEventListener('click', () => {
    document.getElementById('region-modal').hidden = true;
  });
  const regionModal = document.getElementById('region-modal');
  if (regionModal) regionModal.addEventListener('click', e => {
    if (e.target.id === 'region-modal') e.target.hidden = true;
  });
  renderRegionChips();

  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.view = tab.dataset.view;
      renderResults();
    });
  });
  const scoreSlider = document.getElementById('filter-score');
  scoreSlider.addEventListener('input', e => {
    document.getElementById('filter-score-value').textContent = e.target.value;
    renderResults();
  });

  document.getElementById('search-box').addEventListener('input', () => {
    if (state.scored.length > 0) renderResults();
  });

  document.getElementById('opt-exclude-dnc').addEventListener('change', e => {
    store.opts.excludeDnc = e.target.checked;
    saveStore(); renderResults();
  });
  document.getElementById('opt-saved-only').addEventListener('change', e => {
    store.opts.savedOnly = e.target.checked;
    saveStore(); renderResults();
  });
  const bravePagesSelect = document.getElementById('opt-brave-pages');
  if (bravePagesSelect) bravePagesSelect.addEventListener('change', e => {
    store.opts.bravePages = Math.max(1, Math.min(4, parseInt(e.target.value, 10) || 2));
    saveStore();
  });

  document.getElementById('export-results').addEventListener('click', exportResults);
  document.getElementById('export-saved').addEventListener('click', exportSaved);
  const eri = document.getElementById('export-results-inline');
  if (eri) eri.addEventListener('click', exportResults);
  const esi = document.getElementById('export-saved-inline');
  if (esi) esi.addEventListener('click', exportSaved);
  const eul = document.getElementById('export-usage-log');
  if (eul) eul.addEventListener('click', exportUsageLog);
  const viewTos = document.getElementById('view-tos');
  if (viewTos) viewTos.addEventListener('click', () => showTosModal(true));
  const ccBtn = document.getElementById('clear-cache-btn');
  if (ccBtn) ccBtn.addEventListener('click', () => {
    if (!confirm('HP取得 + AI評価のキャッシュを全削除します。\n次回検索時に全企業を再評価するためコストがかかります。続行しますか？')) return;
    clearAllCaches();
    logAction('cache_cleared', 'all');
    saveStore();
    alert('キャッシュをクリアしました');
  });
  document.getElementById('export-all').addEventListener('click', exportAll);
  document.getElementById('import-file').addEventListener('change', e => {
    if (e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = '';
  });

  document.getElementById('cc-add').addEventListener('click', () => {
    const name = document.getElementById('cc-name').value.trim();
    if (!name) { alert('会社名を入力してください'); return; }
    const phone = document.getElementById('cc-phone').value.trim();
    const prefecture = document.getElementById('cc-prefecture').value.trim();
    const city = document.getElementById('cc-city').value.trim();
    const website = document.getElementById('cc-website').value.trim();
    const industry = document.getElementById('cc-industry').value || 'サービス業';
    const size = document.getElementById('cc-size').value || 'small';
    const description = document.getElementById('cc-desc').value.trim() || '';
    const employees = { small: 30, mid: 150, large: 500 }[size];
    const company = {
      id: 100000 + store.customCompanies.length + 1,
      name, phone, industry, prefecture, city, size, employees, description,
      website,
      keywords: description.split(/[\s、,。]+/).filter(w => w.length >= 2),
      custom: true,
    };
    store.customCompanies.push(company);
    saveStore();
    updateOnboarding();
    ['cc-name','cc-phone','cc-prefecture','cc-city','cc-website','cc-desc'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('cc-industry').value = '';
    document.getElementById('cc-size').value = '';
    renderSidebar();
    if (state.scored.length > 0) {
      const input = document.getElementById('product-input').value.trim();
      if (input) runPipeline(input);
    }
  });
  // CSV/JSON取込
  document.getElementById('import-companies').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      let rows;
      if (file.name.toLowerCase().endsWith('.json')) {
        rows = JSON.parse(text);
        if (!Array.isArray(rows)) throw new Error('JSONは配列である必要があります');
      } else {
        rows = parseCSV(text);
      }
      const replace = confirm(`${rows.length}件を取り込みます。\nOK: 既存を全て置き換え\nキャンセル: 既存に追加（重複は自動で除外）`);
      let dupes = 0;
      if (replace) {
        const { kept, dupes: d } = dedupCompanies(rows);
        kept.forEach((r, i) => { r.id = 200000 + i + 1; });
        store.importedCompanies = kept;
        dupes = d;
      } else {
        const existingKeys = new Set(
          [...store.importedCompanies, ...store.customCompanies, ...state.companies].map(dedupKey)
        );
        const { kept, dupes: d } = dedupCompanies(rows, existingKeys);
        kept.forEach((r, i) => { r.id = 200000 + store.importedCompanies.length + i + 1; });
        store.importedCompanies.push(...kept);
        dupes = d;
      }
      saveStore();
      updateOnboarding();
      renderSidebar();
      alert(`取込完了: 合計 ${store.importedCompanies.length}件${dupes > 0 ? `（重複 ${dupes}件を除外）` : ''}`);
      const input = document.getElementById('product-input').value.trim();
      if (input && state.scored.length > 0) runPipeline(input);
    } catch (err) {
      alert(`取込失敗: ${err.message}`);
    }
    e.target.value = '';
  });

  document.getElementById('download-template').addEventListener('click', () => {
    downloadFile('tell-partner-template.csv', CSV_TEMPLATE);
  });

  document.getElementById('load-sample').addEventListener('click', async () => {
    if (!confirm('サンプル60社（架空データ）を読み込みます。よろしいですか？')) return;
    try {
      const res = await fetch('data/sample.json?v=20260513q');
      const data = await res.json();
      const existingKeys = new Set(
        [...store.importedCompanies, ...store.customCompanies, ...state.companies].map(dedupKey)
      );
      const { kept, dupes } = dedupCompanies(data, existingKeys);
      kept.forEach((r, i) => { r.id = 300000 + store.importedCompanies.length + i + 1; });
      store.importedCompanies.push(...kept);
      saveStore();
      updateOnboarding();
      renderSidebar();
      alert(`サンプル ${kept.length}社 を読み込みました${dupes>0?`（重複 ${dupes}件除外）`:''}`);
    } catch (e) { alert('読込失敗: ' + e.message); }
  });

  document.getElementById('clear-companies').addEventListener('click', () => {
    if (!confirm('取込・追加した企業を全削除します。よろしいですか？')) return;
    store.importedCompanies = [];
    store.customCompanies = [];
    saveStore();
    updateOnboarding();
    renderSidebar();
    state.scored = [];
    document.getElementById('results-section').hidden = true;
  });

  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'open-import') document.getElementById('import-companies').click();
      if (action === 'download-template') downloadFile('tell-partner-template.csv', CSV_TEMPLATE);
      if (action === 'load-sample') document.getElementById('load-sample').click();
      if (action === 'open-sidebar') document.getElementById('sidebar-toggle').click();
      if (action === 'focus-product') document.getElementById('product-input').focus();
    });
  });

  document.getElementById('clear-history').addEventListener('click', () => {
    if (!confirm('架電履歴をクリアしますか？')) return;
    store.history = []; saveStore(); renderSidebar();
  });
  document.getElementById('reset-all').addEventListener('click', () => {
    if (!confirm('保存・DNC・履歴・メモ・使用ログを全削除します。よろしいですか？\n(利用規約への同意状態は保持されます)')) return;
    store.saved.clear(); store.dnc.clear();
    if (store.dncPhones) store.dncPhones.clear();
    store.status = {}; store.notes = {}; store.history = [];
    store.usageLog = [];
    logAction('reset_all', '全データリセット');
    saveStore(); renderResults(); renderSidebar();
  });

  document.querySelectorAll('.collapsible .side-head').forEach(head => {
    head.addEventListener('click', () => {
      const sec = head.parentElement;
      sec.dataset.open = sec.dataset.open === 'true' ? 'false' : 'true';
    });
  });

  const sidebarEl = document.getElementById('sidebar');
  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    sidebarEl.classList.add('open');
    document.body.style.overflow = 'hidden';
  });
  document.getElementById('sidebar-close').addEventListener('click', () => {
    sidebarEl.classList.remove('open');
    document.body.style.overflow = '';
  });
  document.addEventListener('click', e => {
    if (sidebarEl.classList.contains('open') &&
        !sidebarEl.contains(e.target) &&
        !e.target.closest('#sidebar-toggle')) {
      sidebarEl.classList.remove('open');
      document.body.style.overflow = '';
    }
  });

  const noteModal = document.getElementById('note-modal');
  document.getElementById('note-save').addEventListener('click', () => {
    const id = parseInt(noteModal.dataset.id, 10);
    const text = document.getElementById('note-text').value.trim();
    if (text) store.notes[id] = text; else delete store.notes[id];
    saveStore(); noteModal.hidden = true; renderResults();
  });
  document.getElementById('note-cancel').addEventListener('click', () => { noteModal.hidden = true; });

  const scriptModal = document.getElementById('script-modal');
  document.getElementById('script-close').addEventListener('click', () => { scriptModal.hidden = true; });

  // 背景クリックで閉じる
  [noteModal, scriptModal].forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) m.hidden = true; });
  });
  // ESCキーで閉じる
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { noteModal.hidden = true; scriptModal.hidden = true; }
  });
  document.getElementById('script-copy').addEventListener('click', () => {
    const text = document.getElementById('script-text').textContent;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('script-copy');
      const orig = btn.textContent;
      btn.textContent = 'コピーしました';
      setTimeout(() => btn.textContent = orig, 1500);
    });
  });

  renderSidebar();
}

init();
