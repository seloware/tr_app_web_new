// TransLingua — TypeScript Type Definitions

export type UserRole = 'user' | 'subscriber' | 'admin';

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  plan: Plan;
  credits_remaining: number;
  credits_monthly_limit: number;
  credits_reset_at: string | null;
  preferred_language: string;
  created_at: string;
  updated_at: string;
}

export type Plan = 'free' | 'starter' | 'pro' | 'enterprise';

export interface Document {
  id: string;
  user_id: string;
  original_name: string;
  original_storage_path: string;
  original_language: string | null;
  page_count: number;
  file_size_bytes: number;
  status: DocumentStatus;
  created_at: string;
  updated_at: string;
}

export type DocumentStatus = 'uploaded' | 'processing' | 'completed' | 'error';

export interface Translation {
  id: string;
  document_id: string;
  user_id: string;
  target_language: string;
  translated_storage_path: string | null;
  translated_text: TranslatedText | null;
  progress: number;
  status: TranslationStatus;
  error_message: string | null;
  credits_used: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export type TranslationStatus = 'pending' | 'extracting' | 'translating' | 'generating' | 'completed' | 'error';

export interface TranslatedText {
  pages: string[];           // Markdown çıktı (geriye uyumluluk + indirme için)
  overlay?: OverlayData;     // PDF üzerine yazma için yapısal veri (yeni)
}

/** PDF sayfa üzerinde tek bir çevrilmiş metin bloğu */
export interface OverlayBlock {
  x: number;                 // 0-1, sayfa genişliği oranı (sol-üst origin)
  y: number;                 // 0-1, sayfa yüksekliği oranı
  w: number;                 // 0-1
  h: number;                 // 0-1
  fontSize: number;          // PDF pts cinsinden (scale=1)
  original: string;
  translated: string;
  visual?: boolean;          // true ise: görsel/grafik içinden tespit edilmiş
}

export interface OverlayPage {
  pageNum: number;
  pageWidthPts: number;
  pageHeightPts: number;
  blocks: OverlayBlock[];
}

export interface OverlayData {
  version: 1;
  sourceLang: string;
  targetLang: string;
  pages: OverlayPage[];
}

export interface ChatMessage {
  id: string;
  user_id: string;
  document_id: string;
  role: 'user' | 'assistant';
  content: string;
  credits_used: number;
  created_at: string;
}

export interface CreditTransaction {
  id: string;
  user_id: string;
  amount: number;
  action: CreditAction;
  reference_id: string | null;
  created_at: string;
}

export type CreditAction = 'translation' | 'chat' | 'monthly_reset' | 'purchase' | 'admin_grant' | 'study_notes';

export interface PricingPlan {
  id: Plan;
  name: string;
  price: number;
  priceLabel: string;
  credits: number;
  features: string[];
  popular?: boolean;
}

export interface SupportedLanguage {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
}

// Study notes module types
export type StudySessionStatus = 'draft' | 'processing' | 'completed' | 'error';

export interface StudySession {
  id: string;
  user_id: string;
  title: string;
  subject: string | null;
  source_count: number;
  generated_notes: string | null;
  status: StudySessionStatus;
  credits_used: number;
  created_at: string;
  updated_at: string;
}

export interface StudySource {
  id: string;
  session_id: string;
  user_id: string;
  file_name: string;
  storage_path: string;
  file_type: string;
  file_size_bytes: number;
  sort_order: number;
  created_at: string;
}

// Translation wizard step type
export type TranslationStep = 'upload' | 'config' | 'progress' | 'result';

// Toast notification type
export type ToastType = 'success' | 'error' | 'info' | 'warning';
