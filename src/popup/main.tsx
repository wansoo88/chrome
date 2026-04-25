import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PopupApp } from './PopupApp';
import { setLocale } from '@/shared/i18n';
import { getState, onStateChanged } from '@/shared/storage';
import './popup.css';

// i18n locale 초기 동기화 + storage 변경 시 갱신.
void getState().then((s) => setLocale(s.settings.languagePref));
onStateChanged((next) => {
  if (next) setLocale(next.settings.languagePref);
});

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <PopupApp />
    </StrictMode>,
  );
}
