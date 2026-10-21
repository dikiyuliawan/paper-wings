/**
 * Input handling.
 *
 * Space, a mouse click and a tap all do the same thing, so the game can be
 * played with a keyboard, a mouse or a thumb. Pointer events cover mouse,
 * touch and pen in one code path.
 */

const FLAP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW']);

export function createInput(target, handlers) {
  const { onFlap, onPause, onFocus } = handlers;

  function isTypingTarget(element) {
    if (!element) return false;
    const tag = element.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
  }

  function handleKeyDown(event) {
    if (isTypingTarget(event.target)) return;

    if (event.code === 'Escape' || event.code === 'KeyP') {
      onPause?.();
      return;
    }

    if (!FLAP_KEYS.has(event.code)) return;

    // Space must never scroll the page.
    event.preventDefault();
    if (event.repeat) return;
    onFlap?.();
  }

  function handlePointerDown(event) {
    // Only the primary button / first touch counts.
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest?.('button, a, [role="button"]')) return;
    event.preventDefault();
    onFlap?.();
  }

  function handleVisibility() {
    if (document.hidden) {
      onFocus?.(false);
    } else {
      onFocus?.(true);
    }
  }

  window.addEventListener('keydown', handleKeyDown, { passive: false });
  target.addEventListener('pointerdown', handlePointerDown, { passive: false });
  // Fallback for browsers without pointer events.
  if (!('PointerEvent' in window)) {
    target.addEventListener('touchstart', handlePointerDown, { passive: false });
  }
  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('blur', () => onFocus?.(false));

  return {
    destroy() {
      window.removeEventListener('keydown', handleKeyDown);
      target.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('visibilitychange', handleVisibility);
    },
  };
}
