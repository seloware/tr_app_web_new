import type { PricingPlan, SupportedLanguage } from '../types';

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'en', name: 'English',    nativeName: 'English',    flag: '🇬🇧' },
  { code: 'ar', name: 'Arabic',     nativeName: 'العربية',    flag: '🇸🇦' },
  { code: 'de', name: 'German',     nativeName: 'Deutsch',    flag: '🇩🇪' },
  { code: 'fr', name: 'French',     nativeName: 'Français',   flag: '🇫🇷' },
  { code: 'es', name: 'Spanish',    nativeName: 'Español',    flag: '🇪🇸' },
  { code: 'ru', name: 'Russian',    nativeName: 'Русский',    flag: '🇷🇺' },
  { code: 'zh', name: 'Chinese',    nativeName: '中文',        flag: '🇨🇳' },
  { code: 'ja', name: 'Japanese',   nativeName: '日本語',      flag: '🇯🇵' },
  { code: 'ko', name: 'Korean',     nativeName: '한국어',      flag: '🇰🇷' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português',  flag: '🇧🇷' },
  { code: 'it', name: 'Italian',    nativeName: 'Italiano',   flag: '🇮🇹' },
  { code: 'nl', name: 'Dutch',      nativeName: 'Nederlands', flag: '🇳🇱' },
];

export const TARGET_LANGUAGE: SupportedLanguage = {
  code: 'tr', name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷'
};

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: 'free', name: 'Free', price: 0, priceLabel: 'Ücretsiz', credits: 5,
    features: ['5 sayfa/ay çeviri hakkı', 'Otomatik dil tespiti', '10 MB dosya limiti', 'Temel PDF çıktısı'],
  },
  {
    id: 'starter', name: 'Starter', price: 49, priceLabel: '₺49/ay', credits: 50,
    features: ['50 sayfa/ay çeviri hakkı', 'Otomatik dil tespiti', '50 MB dosya limiti', 'Yüksek kalite PDF', 'AI Soru-Cevap (25 soru)', 'E-posta destek'],
  },
  {
    id: 'pro', name: 'Pro', price: 149, priceLabel: '₺149/ay', credits: 500, popular: true,
    features: ['500 sayfa/ay çeviri hakkı', 'Otomatik dil tespiti', '100 MB dosya limiti', 'Premium PDF', 'Sınırsız AI Soru-Cevap', 'Öncelikli çeviri', 'Doküman arşivi', 'Öncelikli destek'],
  },
  {
    id: 'enterprise', name: 'Enterprise', price: -1, priceLabel: 'İletişime Geçin', credits: -1,
    features: ['Sınırsız çeviri', 'Tüm diller + özel dil', 'Sınırsız dosya boyutu', 'API erişimi', 'Özel AI model', 'Beyaz etiket', 'SLA garantisi', 'Özel hesap yöneticisi'],
  },
];

export const MAX_FILE_SIZE: Record<string, number> = {
  free: 10 * 1024 * 1024, starter: 50 * 1024 * 1024,
  pro: 100 * 1024 * 1024, enterprise: 500 * 1024 * 1024,
};

export const STATUS_LABELS: Record<string, string> = {
  pending: 'Beklemede', extracting: 'Metin çıkarılıyor', translating: 'Çevriliyor',
  generating: 'PDF oluşturuluyor', completed: 'Tamamlandı', error: 'Hata',
  uploaded: 'Yüklendi', processing: 'İşleniyor',
};

export const CREDIT_COSTS = { TRANSLATION_PER_PAGE: 1, CHAT_PER_QUESTION: 0.5 };
export const APP_NAME = 'TransLingua';
export const APP_TAGLINE = 'Gelişmiş AI ile Belge Çevirisi';
export const APP_DESCRIPTION = 'Belgelerinizi yapay zeka ile saniyeler içinde Türkçe\'ye çevirin.';

