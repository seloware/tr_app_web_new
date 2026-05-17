/**
 * Tarayıcı bildirim yardımcıları.
 * Kullanım: çeviri başlarken permissionRequest çağrılır; bittiğinde notify() ile uyarılır.
 * İzin yoksa sessizce geçer — toast UI'da paralel olarak gösterilir.
 */

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function permissionState(): NotificationPermission {
  if (!notificationsSupported()) return 'denied';
  return Notification.permission;
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

export interface NotifyOptions {
  title: string;
  body?: string;
  /** Sayfa görünür değilken bildirim gönder (varsayılan: true) */
  onlyWhenHidden?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** İkon URL'i (default: /favicon.svg) */
  icon?: string;
  /** Aynı tag'li bildirimi yeniler */
  tag?: string;
}

export function notify(opts: NotifyOptions): Notification | null {
  if (!notificationsSupported()) return null;
  if (Notification.permission !== 'granted') return null;
  if (opts.onlyWhenHidden !== false && document.visibilityState === 'visible') return null;

  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      icon: opts.icon ?? '/favicon.svg',
      tag: opts.tag,
    });
    if (opts.onClick) {
      n.onclick = () => {
        window.focus();
        opts.onClick?.();
        n.close();
      };
    }
    return n;
  } catch {
    return null;
  }
}
