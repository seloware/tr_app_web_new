/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
/**
 * TransLingua — ChatPage (AI Asistan)
 *
 * Kullanıcının dokümanları hakkında AI asistanıyla konuştuğu sohbet sayfası.
 * Mesajlar Supabase'e kaydedilir. AI motoru bağlandığında gerçek yanıtlar döner;
 * henüz bağlı değilken demo modu mesajı gösterilir.
 */
import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Send, Brain, FileText, ChevronDown, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { askAboutDocument } from '../lib/ai';
import type { Document } from '../types';
import styles from '../styles/components/chat.module.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Sohbet mesajı yapısı */
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export default function ChatPage() {
  const { profile } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string>('');
  const [showDocPicker, setShowDocPicker] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Kullanıcının belgelerini çek — doküman seçici için
  useEffect(() => {
    if (!profile) return;
    supabase
      .from('documents')
      .select('*')
      .eq('user_id', profile.id)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setDocuments(data as Document[]); });
  }, [profile]);

  // Yeni mesaj gelince en alta kaydır
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, loading]);

  /** Mesaj gönder — AI'dan yanıt al ve Supabase'e kaydet */
  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading || !profile) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    // Kullanıcı mesajını veritabanına kaydet
    await supabase.from('chat_messages').insert({
      user_id: profile.id,
      document_id: selectedDocId || null,
      role: 'user',
      content: text,
      credits_used: 0.5,
    });

    try {
      // Seçili belgenin çeviri metnini bağlam olarak gönder
      let docContext = 'Kullanıcı henüz bir doküman seçmedi. Genel yardım sun.';
      if (selectedDocId) {
        const { data: tr } = await supabase
          .from('translations')
          .select('translated_text')
          .eq('document_id', selectedDocId)
          .eq('status', 'completed')
          .single();
        if (tr?.translated_text?.pages) {
          docContext = tr.translated_text.pages.join('\n\n');
        }
      }

      const response = await askAboutDocument(docContext, text);

      const aiMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: response, timestamp: new Date() };
      setMessages(prev => [...prev, aiMsg]);

      // AI yanıtını veritabanına kaydet
      await supabase.from('chat_messages').insert({
        user_id: profile.id,
        document_id: selectedDocId || null,
        role: 'assistant',
        content: response,
        credits_used: 0,
      });
    } catch {
      const errMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: 'Üzgünüm, bir hata oluştu. Lütfen tekrar deneyin.', timestamp: new Date() };
      setMessages(prev => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const initials = profile?.full_name?.split(' ').map(n => n[0]).join('').slice(0, 2) || '?';
  const selectedDoc = documents.find(d => d.id === selectedDocId);

  if (!profile) {
    return (
      <div className={styles.chatPage} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 36, height: 36, border: '3px solid var(--color-border)', borderTopColor: 'var(--color-accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 1rem' }} />
          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>Yükleniyor...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.chatPage}>

      {/* ── Başlık ve Doküman Seçici ─────────────────────────── */}
      <div className={styles.chatHeader}>
        <div>
          <h1 className={styles.chatTitle}>AI Doküman Asistanı</h1>
          <p className={styles.chatDesc}>Belgeleriniz hakkında sorular sorun, detaylı yanıtlar alın.</p>
        </div>

        {/* Doküman seçici dropdown */}
        <div className={styles.docPickerWrapper}>
          <button className={styles.docPickerBtn} onClick={() => setShowDocPicker(!showDocPicker)}>
            <FileText size={15} />
            <span>{selectedDoc ? selectedDoc.original_name : 'Doküman Seç'}</span>
            <ChevronDown size={14} className={showDocPicker ? styles.chevronOpen : ''} />
          </button>
          {showDocPicker && (
            <div className={styles.docPickerDropdown}>
              <button className={`${styles.docPickerItem} ${!selectedDocId ? styles.docPickerItemActive : ''}`}
                onClick={() => { setSelectedDocId(''); setShowDocPicker(false); }}>
                <Brain size={14} /> Genel Asistan
              </button>
              {documents.length === 0 ? (
                <div className={styles.docPickerEmpty}>
                  Tamamlanmış belge yok.{' '}
                  <Link to="/translate" onClick={() => setShowDocPicker(false)}>Çeviri başlat →</Link>
                </div>
              ) : documents.map(d => (
                <button key={d.id}
                  className={`${styles.docPickerItem} ${selectedDocId === d.id ? styles.docPickerItemActive : ''}`}
                  onClick={() => { setSelectedDocId(d.id); setShowDocPicker(false); }}>
                  <FileText size={14} />
                  <span className={styles.docPickerItemName}>{d.original_name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Demo modu bildirimi */}
      <div className={styles.demoBar}>
        <Sparkles size={13} />
        <span>AI motoru entegrasyon aşamasında — yanıtlar demo moddadır.</span>
      </div>

      {/* ── Sohbet Alanı ─────────────────────────────────────── */}
      <div className={styles.chatBody} ref={bodyRef}>
        {messages.length === 0 ? (
          <div className={styles.emptyChat}>
            <Brain size={48} className={styles.emptyChatIcon} />
            <div className={styles.emptyChatText}>Dokümanınız hakkında bir soru sorun</div>
            <div className={styles.emptyChatHint}>
              Örn: "Bu belgenin ana konusu nedir?" veya "3. bölümü özetler misin?"
            </div>
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className={`${styles.msgRow} ${msg.role === 'user' ? styles.msgUser : ''}`}>
              <div className={`${styles.msgAvatar} ${msg.role === 'user' ? styles.msgAvatarUser : styles.msgAvatarAi}`}>
                {msg.role === 'user' ? initials : 'AI'}
              </div>
              <div>
                <div className={`${styles.msgBubble} ${msg.role === 'user' ? styles.msgBubbleUser : styles.msgBubbleAi}`}>
                  {msg.role === 'assistant' ? (
                    <div className="markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm as any]} components={{
                      // To prevent large margins in chat bubbles
                      p: ({node, ...props}) => <p style={{margin: 0, paddingBottom: '0.5em'}} {...props} />,
                      ul: ({node, ...props}) => <ul style={{margin: 0, paddingLeft: '1.5em', paddingBottom: '0.5em'}} {...props} />,
                      h1: ({node, ...props}) => <h3 style={{margin: '0.5em 0'}} {...props} />,
                      h2: ({node, ...props}) => <h4 style={{margin: '0.5em 0'}} {...props} />,
                      h3: ({node, ...props}) => <h5 style={{margin: '0.5em 0'}} {...props} />,
                    }}>
                      {msg.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    msg.content
                  )}
                </div>
                <div className={styles.msgTime}>
                  {msg.timestamp.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))
        )}

        {/* Yazıyor göstergesi */}
        {loading && (
          <div className={styles.msgRow}>
            <div className={`${styles.msgAvatar} ${styles.msgAvatarAi}`}>AI</div>
            <div className={`${styles.msgBubble} ${styles.msgBubbleAi}`}>
              <div className={styles.typing}>
                <div className={styles.typingDot} />
                <div className={styles.typingDot} />
                <div className={styles.typingDot} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Mesaj Giriş Alanı ──────────────────────────────── */}
      <div className={styles.chatInput}>
        <textarea
          className={styles.inputField}
          placeholder="Belgeniz hakkında bir soru sorun..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button className={styles.sendBtn} onClick={sendMessage} disabled={!input.trim() || loading}>
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
