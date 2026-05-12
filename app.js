'use strict';

const state = {
  companies: [],
  classification: null,
  icp: null,
  scored: [],
};

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

  const countEl = document.getElementById('category-count');
  if (countEl) countEl.textContent = PRODUCT_CATEGORIES.length;

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
