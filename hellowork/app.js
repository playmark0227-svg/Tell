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
      aiComment: `AI評価(HP内容ベース): ${company.ai_reasoning || ''}`,
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
      <td data-label="適合度"><span class="score ${scoreClass(c.score)}">${c.score}</span></td>
      <td data-label="操作">
        <div class="row-actions">
          <button class="act-save ${isSaved ? 'active' : ''}" title="保存">★</button>
          <button class="act-dnc ${isDnc ? 'dnc-on' : ''}" title="DNC">🚫</button>
          <button class="act-call" title="架電" ${hasPhone(c)?'':'disabled style="opacity:.4"'}>📞</button>
          <button class="act-hp" data-url="${urls.website}" title="HPを開く">🌐</button>
          <button class="act-contact" data-url="${urls.contact}" title="お問い合わせ">✉️</button>
          <button class="act-note ${hasNote ? 'active' : ''}" title="メモ">📝</button>
          <button class="act-script" title="スクリプト">📜</button>
        </div>
      </td>
      <td data-label="会社名">${cleanCompanyName(c.name) || c.name}</td>
      <td data-label="業種">${c.industry}</td>
      <td data-label="所在地">${c.prefecture}${c.city ? ' ' + c.city : ''}</td>
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
    tr.querySelector('.status-select').addEventListener('change', e => setStatus(id, e.target.value));
  });
}

/* ============ Storage ============ */
const STORAGE_KEY = 'tell.v1';

const store = {
  saved: new Set(),
  dnc: new Set(),
  status: {},
  notes: {},
  history: [],
  customCompanies: [],
  importedCompanies: [],
  callRecords: {},   // companyId -> { duration, memo, next_t, last_t, outcome }
  followUps: [],     // [{id, t}] next-callback queue
  profiles: [],      // [{id, name, productText, icp, strategy, classification, savedAt}]
  activeProfile: null,
  opts: { excludeDnc: true, savedOnly: false, dark: false, aiEnabled: false, aiKey: '', aiModel: 'claude-haiku-4-5-20251001', braveKey: '', braveProxy: '', regionPrefs: [], regionCities: [] },
};

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    store.saved = new Set(d.saved || []);
    store.dnc = new Set(d.dnc || []);
    store.status = d.status || {};
    store.notes = d.notes || {};
    store.history = d.history || [];
    store.customCompanies = d.customCompanies || [];
    store.importedCompanies = d.importedCompanies || [];
    store.callRecords = d.callRecords || {};
    store.followUps = d.followUps || [];
    store.profiles = d.profiles || [];
    store.activeProfile = d.activeProfile || null;
    store.opts = { ...store.opts, ...(d.opts || {}) };
  } catch (e) { console.warn('loadStore failed', e); }
}

function saveStore() {
  const d = {
    saved: [...store.saved],
    dnc: [...store.dnc],
    status: store.status,
    notes: store.notes,
    history: store.history,
    customCompanies: store.customCompanies,
    importedCompanies: store.importedCompanies,
    callRecords: store.callRecords,
    followUps: store.followUps,
    profiles: store.profiles,
    activeProfile: store.activeProfile,
    opts: store.opts,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
}

/* ============ Actions ============ */
function toggleSave(id) {
  if (store.saved.has(id)) store.saved.delete(id); else store.saved.add(id);
  saveStore();
  renderResults();
  renderSidebar();
}

function toggleDnc(id) {
  if (store.dnc.has(id)) store.dnc.delete(id); else store.dnc.add(id);
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
  const headers = ['会社名','電話番号','HP','お問い合わせURL','業種','都道府県','市区町村','従業員数','適合度','ステータス','メモ','根拠'];
  const lines = [headers.join(',')];
  rows.forEach(c => {
    const status = store.status[c.id] || '';
    const note = (store.notes[c.id] || '').replace(/"/g, '""').replace(/\n/g, ' ');
    const reasoning = (c.reasoning || '').replace(/"/g, '""');
    const urls = getCompanyUrls(c);
    lines.push([
      `"${c.name}"`,
      `"${c.phone || ''}"`,
      `"${urls.website}"`,
      `"${urls.contact}"`,
      `"${c.industry}"`,
      `"${c.prefecture}"`,
      `"${c.city || ''}"`,
      c.employees,
      c.score ?? '',
      `"${status}"`,
      `"${note}"`,
      `"${reasoning}"`,
    ].join(','));
  });
  return lines.join('\n');
}

function exportResults() {
  const rows = applyFilters();
  if (rows.length === 0) return alert('結果がありません');
  downloadFile(`tell-results-${Date.now()}.csv`, toCsv(rows));
}

function exportSaved() {
  const rows = [...store.saved].map(id => state.scored.find(c => c.id === id) || state.companies.find(c => c.id === id)).filter(Boolean);
  if (rows.length === 0) return alert('保存リストが空です');
  downloadFile(`tell-saved-${Date.now()}.csv`, toCsv(rows));
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
async function callClaude({ system, prompt, messages, max_tokens = 1024 }) {
  const msgs = messages || [{ role: 'user', content: prompt }];
  const body = {
    model: store.opts.aiModel || 'claude-haiku-4-5-20251001',
    max_tokens,
    system,
    messages: msgs,
  };

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
]);

function rootDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}
function generateFilteredQueries(productText, icp, filters, round = 0) {
  const queries = [];
  const { industry, prefecture, city } = filters || {};
  const CORP_KWS = [
    '株式会社 会社概要', '中小企業 会社概要', '採用情報 株式会社', '代表電話',
    '会社案内 法人', '事業内容 株式会社',
  ];
  const targetIndustries = industry ? [industry] : (icp?.industries || []).slice(0, 4);
  for (const ind of targetIndustries) {
    const parts = [ind];
    if (prefecture) parts.push(prefecture);
    if (city && city !== prefecture) parts.push(city);
    parts.push(CORP_KWS[round % CORP_KWS.length]);
    queries.push(parts.join(' '));
    if (prefecture || city) {
      queries.push(`${ind} ${prefecture||''}${city ? ' ' + city : ''} 株式会社`.trim());
    }
  }
  return [...new Set(queries.filter(q => q.trim()))].slice(0, 10);
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

function extractPhoneFromText(text) {
  if (!text) return '';
  const str = String(text);
  const matches = [...str.matchAll(PHONE_RE_JS)];
  if (matches.length === 0) return '';

  // ヒント付き(TEL/電話/☎の直後)の候補を優先
  const hinted = [];
  const plain = [];
  for (const m of matches) {
    const raw = m[0];
    if (!isValidJapanesePhone(raw)) continue;
    const idx = m.index;
    const before = str.slice(Math.max(0, idx - 15), idx);
    // 郵便番号や住所番地っぽいなら除外
    if (/〒|郵便番号/.test(before)) continue;
    if (/(丁目|番地|号|番|区|町|大字)\s*$/.test(before)) continue;
    if (PHONE_HINT_RE.test(before)) hinted.push(raw);
    else plain.push(raw);
  }
  const pick = hinted[0] || plain[0];
  return pick ? normalizePhoneStr(pick) : '';
}

/* ============ 地域選択 ============ */
function selectedPrefs() { return new Set(store.opts.regionPrefs || []); }
function selectedCities() { return new Set(store.opts.regionCities || []); }

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
async function braveSearch(query, count = 10) {
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
  return (data.web?.results || []);
}

function generateQueriesFromICP(productText, icp, round = 0) {
  const industries = icp?.industries || [];
  const queries = [];
  const seen = new Set();
  // ラウンドごとにキーワードを変えて重複を回避
  const KEYWORD_SETS = [
    ['中小企業 会社概要', '株式会社 採用 募集', '代表電話'],
    ['公式サイト', '社長メッセージ', '会社案内'],
    ['新卒採用 募集', '中途採用 採用情報', 'キャリア採用'],
    ['本社 アクセス', '事業内容 法人', '会社情報 設立'],
    ['お問い合わせ 法人', 'IR情報', 'プレスリリース'],
  ];
  const kws = KEYWORD_SETS[round % KEYWORD_SETS.length];
  for (const ind of industries.slice(0, 4)) {
    for (const kw of kws) {
      const q = `${ind} ${kw}`;
      if (!seen.has(q)) { queries.push(q); seen.add(q); }
      if (queries.length >= 6) break;
    }
    if (queries.length >= 6) break;
  }
  if (queries.length === 0) {
    queries.push(`${productText.split(/[、。\s]/)[0]} 導入企業 会社`);
  }
  return queries.slice(0, 5);
}

async function aiGenerateQueries(productText, icp) {
  if (!store.opts.aiKey && !store.opts.braveProxy) return generateQueriesFromICP(productText, icp);
  try {
    const prompt = `以下の商材を購入しそうな日本企業をWeb検索で見つけるためのクエリを5個、JSON配列のみで返してください。

商材: ${productText}
ターゲット業種: ${(icp.industries||[]).join('、')}

要件: 各クエリは「業種＋特性＋公式HPがヒットしやすいキーワード」(例「金属加工 中小企業 会社概要」)。説明文不要。

例: ["金属加工 東京 中小企業 会社概要","印刷会社 大阪 採用"]`;
    const text = await callClaude({ system: 'B2B営業クエリ生成専門家', prompt, max_tokens: 600 });
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return generateQueriesFromICP(productText, icp);
    const arr = JSON.parse(m[0]);
    return arr.filter(q => typeof q === 'string').slice(0, 5);
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
async function fetchPageViaProxy(targetUrl) {
  if (!store.opts.braveProxy) return null;
  const proxy = store.opts.braveProxy.replace(/\/+$/, '');
  try {
    const res = await fetch(`${proxy}/fetch?url=${encodeURIComponent(targetUrl)}`, {
      headers: { 'Accept': 'text/html' },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    return null;
  }
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

  // 都道府県
  for (const p of JP_PREFS) {
    if (html.includes(p)) { out.prefecture = p; break; }
  }

  return out;
}


async function discoverFromBrave(productText, icp, onProgress, options = {}) {
  if (!store.opts.braveKey && !store.opts.braveProxy) throw new Error('Brave のプロキシURLまたはAPIキーを設定してください');
  const round = options.round || 0;
  const maxQueries = options.maxQueries || 10;
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

  const rescore = () => {
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

  let totalValidated = 0;
  for (let qIdx = 0; qIdx < queries.length; qIdx++) {
    const q = queries[qIdx];
    let rawResults = [];
    try {
      // ハローワーク特化: site:制約を加える
      rawResults = await braveSearch(`site:hellowork.mhlw.go.jp ${q}`, 20);
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
    store.importedCompanies.push(...queryCandidates);
    saveStore();
    updateOnboarding();
    rescore();
    onProgress?.(`${qIdx+1}/${queries.length}: ${queryCandidates.length}社を「評価中」で追加(3社並列で精査開始)`);

    // 3社並列ワーカー
    const WORKERS = 3;
    let cursor = 0;
    let processed = 0;
    const total = queryCandidates.length;
    const worker = async () => {
      while (cursor < total && !state.searchAborted) {
        const i = cursor++;
        const c = queryCandidates[i];
        onProgress?.(`${qIdx+1}/${queries.length} | ${processed+1}-${Math.min(processed+WORKERS, total)}/${total} 評価中…`);
        try {
          const enriched = await enrichCompanyDeep(c, productText);
          Object.assign(c, enriched);
        } catch (e) {
          console.warn('enrich failed', c.website, e);
        }
        c.pending = false;
        const aiSaysNotCompany = c.ai_is_company === false;
        const passesRule = !aiSaysNotCompany && isLikelyRealCompany(c);
        if (passesRule) {
          found.push(c);
          totalValidated++;
          saveStore();
          rescore();
          onProgress?.(`✓ ${c.name.slice(0,30)} 評価完了 (累計${totalValidated}社)`);
        } else {
          store.importedCompanies = store.importedCompanies.filter(x => x.id !== c.id);
          saveStore();
          rescore();
          const reason = aiSaysNotCompany ? 'AI判定で非法人' : '非法人';
          onProgress?.(`× ${c.name.slice(0,30)} ${reason}として除外`);
        }
        processed++;
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));
  }
  onProgress?.(`✓ 全完了。${totalValidated}社追加（検索${stats.totalResults}件、ノイズ除外${stats.excluded}、重複${stats.duped}、非法人${queryCandidates_count(stats, found.length, totalValidated)}）`);
  return found;
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
    if (ext.prefecture && !best.prefecture) best.prefecture = ext.prefecture;
  };
  const enough = () => best.name && /(株式会社|合同会社|有限会社|医療法人|社会福祉法人|NPO法人|一般社団法人)/.test(best.name) && best.phone && best.prefecture;

  // Phase1: 優先4URLを並列フェッチ
  const phase1 = await Promise.all(priorityUrls.map(u => fetchPageViaProxy(u).catch(() => null)));
  phase1.forEach((html, i) => mergeFromHTML(html, priorityUrls[i]));

  // Phase2: 必要なら残りも並列フェッチ
  if (!enough()) {
    const phase2 = await Promise.all(secondaryUrls.map(u => fetchPageViaProxy(u).catch(() => null)));
    phase2.forEach((html, i) => mergeFromHTML(html, secondaryUrls[i]));
  }

  best.needs_enrichment = false;

  // AI評価(時間かかるが精度高い)
  if (productText && (store.opts.aiKey || store.opts.braveProxy) && collectedTexts.length > 0) {
    const hpText = collectedTexts.join('\n').slice(0, 3500);
    const ai = await aiScoreCompany(best, productText, hpText);
    if (ai) {
      best.ai_score = ai.score;
      best.ai_reasoning = ai.reasoning;
      best.ai_fit = ai.fit;
      best.ai_is_company = ai.is_company;
      if (ai.name && ai.name.length >= 3) {
        best.name = cleanCompanyName(ai.name);
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
1. 「is_company」: HPを持つ実在の法人・店舗・事務所なら true(寛容に判定)。明らかに false にすべきは: ①「○○とは」「徹底比較」「ランキング」「選び方」等の解説/比較記事 ②求人ポータルや業者一覧サイト ③Wikipedia等の参考情報。少しでも企業らしい(法人名・電話・所在地のいずれかが明示されている)場合は true。
2. 「name」: 正しい法人名(株式会社/合同会社/有限会社/医療法人等を含む)。タイトルからノイズを除去したクリーンな名前。法人名が判別できなければ null。
3. 「s」: 適合度0-100。is_companyがfalseなら0でOK。
   - 80-100: 主力ターゲットに完全合致
   - 60-79: 関連性高い
   - 40-59: 可能性あり
4. 「r」: 30字以内の根拠

JSON配列のみ返答:
[{"i":1,"is_company":true,"name":"株式会社XXX","s":75,"r":"..."},...]`;
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
        if (results[j].is_company === false) {
          toRemoveIds.push(c.id);
          return;
        }
        c.ai_score = results[j].score;
        c.ai_reasoning = results[j].reasoning;
        c.ai_scored_for = productText.slice(0, 60);
        if (results[j].name && results[j].name.length >= 3) {
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

async function aiScoreCompany(company, productText, hpText) {
  if (!store.opts.aiKey && !store.opts.braveProxy) return null;
  const sys = `あなたはB2B営業のシニアコンサルタントと企業データバリデーション専門家です。実在法人か検証してから適合度を評価してください。JSONのみで返答。`;
  const prompt = `商材: ${productText}

企業情報:
- 会社名: ${company.name}
- URL: ${company.source_url || company.website || ''}
- 業種: ${company.industry || '不明'}
- 所在地: ${company.prefecture || ''} ${company.city || ''}
- HP説明: ${(company.description || '').slice(0, 200)}
- HPテキスト抜粋: ${(hpText || '').slice(0, 1500)}

判定項目:
1. is_company: HPを持つ実在の法人/店舗/事務所なら true(寛容に判定)。明らかに false にすべきは ①「○○とは」「徹底比較」「ランキング」「選び方」等の解説/比較記事 ②求人ポータルや業者一覧サイト ③Wikipedia等の参考情報のみ
2. name: クリーンな法人名。タイトルからノイズ除去、HPから正式な法人名が判明すれば優先
3. score: 0-100の適合度(80+/60-79/40-59/20-39/0-19の目安)
4. reasoning: 30字以内の根拠

JSONのみ返答:
{"is_company": true|false, "name": "株式会社XXX or null", "score": 0-100, "reasoning": "..."}`;
  try {
    const text = await callClaude({ system: sys, prompt, max_tokens: 400 });
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const obj = JSON.parse(m[0]);
    return {
      is_company: obj.is_company !== false,
      name: obj.name || null,
      score: Math.max(0, Math.min(100, parseInt(obj.score, 10) || 0)),
      reasoning: obj.reasoning || '',
      fit: obj.fit || 'mid',
    };
  } catch (e) {
    console.warn('aiScoreCompany failed', company.name, e);
    return null;
  }
}

async function aiScript(company, productText, icp, strategy) {
  const system = `あなたは特定商取引法を熟知したB2B営業のシニアコンサルタントです。架電スクリプトを生成してください。冒頭の事業者名・勧誘目的の明示、再勧誘禁止への配慮を必ず含めてください。`;
  const prompt = `以下の情報から、自然で実用的な架電スクリプトを日本語で作成してください。

【商材】${productText}
【ターゲット企業】${company.name} / ${company.industry} / ${company.prefecture}${company.city||''} / 従業員${company.employees}名
【事業内容メモ】${company.description}
【想定課題】${icp.pains?.join('、')}
【決裁者】${strategy.decision_maker}
【購入動機】${strategy.motivation}

構成:
■ オープニング（事業者名・勧誘目的明示）
■ 仮説提示（業種・規模・課題を踏まえた切り口）
■ 現状ヒアリング（質問2〜3個）
■ クロージング（次のアクション提示）
■ コンプライアンス注意点

スクリプト全文を返してください。`;
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
    const firstPref = prefList[0] || (cityList[0] || '').split('/')[0] || '';
    const firstCity = (cityList[0] || '').split('/')[1] || '';
    const preFilters = {
      industry: document.getElementById('filter-industry').value,
      prefecture: firstPref,
      city: firstCity,
    };
    const hasPreFilter = preFilters.industry || prefList.length > 0 || cityList.length > 0;
    progEl.textContent = hasPreFilter
      ? `絞り込み条件(${[preFilters.industry, prefList.length>0?prefList.join('・')+'全域':'', cityList.length>0?cityList.length+'市区':''].filter(Boolean).join('・')})で検索中…`
      : '商材を分析してターゲット企業を検索中…';
    const customQueries = hasPreFilter ? generateFilteredQueries(input, state.icp, preFilters, 0) : null;
    try {
      const found = await discoverFromBrave(input, state.icp, msg => {
        progEl.textContent = msg;
      }, customQueries ? { queries: customQueries, maxQueries: 10 } : {});
      progEl.classList.add('done');
      progEl.textContent = `✓ ${found.length}社の新規企業を発見しました${found.length === 0 ? '（既存と重複した可能性あり）' : ''}`;
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
  const firstPref = prefList[0] || (cityList[0] || '').split('/')[0] || '';
  const firstCity = (cityList[0] || '').split('/')[1] || '';
  const filters = {
    industry: document.getElementById('filter-industry').value,
    prefecture: firstPref,
    city: firstCity,
    size: document.getElementById('filter-size').value,
  };
  if (!filters.industry && !filters.prefecture && !filters.city) {
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
  if (store.opts.dark) document.documentElement.setAttribute('data-theme', 'dark');

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
    if (state.continuousSearch) {
      // 既に検索中 → 停止
      state.continuousSearch = false;
      state.searchAborted = true;
      return;
    }
    state.continuousSearch = true;
    state.searchAborted = false;
    const btn = document.getElementById('analyze-btn');
    const origText = btn.textContent;
    const updateBtn = () => {
      const total = getAllCompanies().length;
      btn.innerHTML = `⏸ 検索を停止（累計 ${total} 社・継続中…）`;
    };
    btn.classList.add('searching');
    updateBtn();
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

  document.getElementById('export-results').addEventListener('click', exportResults);
  document.getElementById('export-saved').addEventListener('click', exportSaved);
  const eri = document.getElementById('export-results-inline');
  if (eri) eri.addEventListener('click', exportResults);
  const esi = document.getElementById('export-saved-inline');
  if (esi) esi.addEventListener('click', exportSaved);
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
    if (!confirm('保存・DNC・履歴・メモを全削除します。よろしいですか？')) return;
    store.saved.clear(); store.dnc.clear();
    store.status = {}; store.notes = {}; store.history = [];
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
