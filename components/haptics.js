'use client';

export function triggerHaptic(type = 'light') {
  if (typeof window === 'undefined') return;

  try {
    const tgHaptic = window.Telegram?.WebApp?.HapticFeedback;
    if (tgHaptic) {
      // Bottom nav: 'nav' for the tabs, 'navmain' for the raised Plans button.
      if (type === 'nav') {
        tgHaptic.selectionChanged();
        return;
      }
      if (type === 'navmain') {
        tgHaptic.impactOccurred('medium');
        return;
      }
      if (type === 'selection') {
        tgHaptic.selectionChanged();
        return;
      }
      if (['success', 'warning', 'error'].includes(type)) {
        tgHaptic.notificationOccurred(type);
        return;
      }
      tgHaptic.impactOccurred(type); // 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'
      return;
    }

    if ('vibrate' in navigator) {
      const duration = type === 'navmain' ? 30 : type === 'nav' ? 20 : type === 'heavy' ? 25 : type === 'medium' ? 15 : 8;
      navigator.vibrate(duration);
    }
  } catch {
    // Ignore haptic error if unsupported
  }
}
