/* translation.js — i18n engine (EN / HI only) */
const SUPPORTED_LANGS = ['en', 'hi'];
let _translations = {};
// Always start in English on every page load (user can still switch per-session)
let _currentLang = 'en';
localStorage.setItem('dbms_lang', 'en');


async function _loadAndApply(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) lang = 'en';
  try {
    const res = await fetch(`/assets/translations/${lang}.json`);
    if (!res.ok) throw new Error('fetch failed');
    _translations = await res.json();
  } catch {
    if (lang !== 'en') { await _loadAndApply('en'); return; }
    _translations = {};
  }
  _currentLang = lang;
  localStorage.setItem('dbms_lang', lang);
  document.documentElement.lang = lang;
  // Apply Devanagari font hint for Hindi
  document.documentElement.style.fontFamily =
    lang === 'hi' ? '"Noto Sans Devanagari", "Hind", sans-serif' : '';
  _applyToDOM();
  document.querySelectorAll('.lang-pill').forEach(p =>
    p.classList.toggle('active', p.dataset.lang === lang)
  );
}

function _applyToDOM() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = key.split('.').reduce((o, k) => o?.[k], _translations);
    if (val) el.textContent = val;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    const val = key.split('.').reduce((o, k) => o?.[k], _translations);
    if (val) el.placeholder = val;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    const val = key.split('.').reduce((o, k) => o?.[k], _translations);
    if (val) el.title = val;
  });
}

window.i18n = {
  init:    () => _loadAndApply(_currentLang),
  switch:  (lang) => _loadAndApply(lang),
  current: () => _currentLang,
  t:       (key) => key.split('.').reduce((o,k) => o?.[k], _translations) || key,
  apply:   () => _applyToDOM(),
};
