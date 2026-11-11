import type { RouteError } from '../core/types';

const OVERLAY_TAG = 'vite-error-overlay';
const SERVER_ERROR_STATUS = 500;

type OverlayConstructor = new (error: { message: string; stack: string }) => HTMLElement;

/** dev: 서버 로더·렌더 에러(5xx)를 Vite 에러 오버레이로 띄운다. @vite/client 가 없으면 무시 */
export const showDevOverlay = (error: RouteError | undefined) => {
  if (!error || error.status < SERVER_ERROR_STATUS || typeof customElements === 'undefined') return;
  const Overlay = customElements.get(OVERLAY_TAG) as OverlayConstructor | undefined;
  if (!Overlay) return;
  document.querySelectorAll(OVERLAY_TAG).forEach((node) => node.remove());
  document.body.appendChild(
    new Overlay({ message: `[ssr-kit] ${error.message}`, stack: error.stack ?? '' }),
  );
};
