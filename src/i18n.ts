// UI strings for the four launch locales. The default UI language is Traditional Chinese
// (as specified), independent of the scripture language the reader is browsing.

export type UiLang = 'zh-Hant' | 'en' | 'es' | 'fr';

export const UI_LANGS: { id: UiLang; label: string }[] = [
  { id: 'zh-Hant', label: '繁體中文' },
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
  { id: 'fr', label: 'Français' },
];

type Strings = {
  translation: string;
  book: string;
  chapter: string;
  voice: string;
  load: string;
  loading: string;
  uiLang: string;
  speakSelection: string;
  wholeVerse: string;
  close: string;
  play: string;
  pause: string;
  stop: string;
  readChapter: string;
  speed: string;
  clearCache: string;
  sleep: string;
  sleepOff: string;
  cachePill: string;
  offlineNote: string;
  synthesizing: string;
  edgeDown: string;
  noSystemVoice: string;
  cacheCleared: string;
  empty: string;
  verseTip: string;
  sleepStopped: string;
  shortcuts: string;
  navigator: string;
  readingSettings: string;
  searchBook: string;
  appearance: string;
  themeLight: string;
  themeDark: string;
  oldTestament: string;
  newTestament: string;
  deuterocanonical: string;
};

const STRINGS: Record<UiLang, Strings> = {
  'zh-Hant': {
    translation: '譯本',
    book: '書卷',
    chapter: '章',
    voice: '聲音',
    load: '載入',
    loading: '載入中…',
    uiLang: '介面語言',
    speakSelection: '▶ 朗讀選取',
    wholeVerse: '整節',
    close: '關閉',
    play: '播放',
    pause: '暫停',
    stop: '停止',
    readChapter: '連續朗讀',
    speed: '速度',
    clearCache: '清快取',
    sleep: '睡眠定時',
    sleepOff: '關閉',
    cachePill: '快取',
    offlineNote: '離線快取',
    synthesizing: '合成中…',
    edgeDown: 'Edge 不可用，改用系統語音',
    noSystemVoice: 'Edge 連線失敗，且系統沒有此語言的語音',
    cacheCleared: '已清除快取',
    empty: '沒有內容',
    verseTip: '點擊朗讀整節',
    sleepStopped: '睡眠定時已停止朗讀',
    shortcuts: '快捷鍵：Ctrl+Shift+S 朗讀 · 空白鍵 播放/暫停 · Esc 停止',
    navigator: '導航',
    readingSettings: '閱讀設定',
    searchBook: '搜尋書卷',
    appearance: '外觀',
    themeLight: '淺色',
    themeDark: '深色',
    oldTestament: '舊約',
    newTestament: '新約',
    deuterocanonical: '次經 / 附篇',
  },
  en: {
    translation: 'Translation',
    book: 'Book',
    chapter: 'Chapter',
    voice: 'Voice',
    load: 'Load',
    loading: 'Loading…',
    uiLang: 'Language',
    speakSelection: '▶ Speak selection',
    wholeVerse: 'Whole verse',
    close: 'Close',
    play: 'Play',
    pause: 'Pause',
    stop: 'Stop',
    readChapter: 'Read chapter',
    speed: 'Speed',
    clearCache: 'Clear cache',
    sleep: 'Sleep timer',
    sleepOff: 'Off',
    cachePill: 'cache',
    offlineNote: 'Offline cache',
    synthesizing: 'Synthesizing…',
    edgeDown: 'Edge unavailable — using the system voice',
    noSystemVoice: 'Edge failed and no system voice exists for this language',
    cacheCleared: 'Cache cleared',
    empty: 'Nothing to show',
    verseTip: 'Click to read this verse',
    sleepStopped: 'Sleep timer stopped playback',
    shortcuts: 'Shortcuts: Ctrl+Shift+S speak · Space play/pause · Esc stop',
    navigator: 'Navigate',
    readingSettings: 'Reading settings',
    searchBook: 'Search books',
    appearance: 'Appearance',
    themeLight: 'Light',
    themeDark: 'Dark',
    oldTestament: 'Old Testament',
    newTestament: 'New Testament',
    deuterocanonical: 'Deuterocanonical',
  },
  es: {
    translation: 'Traducción',
    book: 'Libro',
    chapter: 'Capítulo',
    voice: 'Voz',
    load: 'Cargar',
    loading: 'Cargando…',
    uiLang: 'Idioma',
    speakSelection: '▶ Leer selección',
    wholeVerse: 'Versículo completo',
    close: 'Cerrar',
    play: 'Reproducir',
    pause: 'Pausa',
    stop: 'Detener',
    readChapter: 'Leer capítulo',
    speed: 'Velocidad',
    clearCache: 'Borrar caché',
    sleep: 'Temporizador',
    sleepOff: 'Desactivado',
    cachePill: 'caché',
    offlineNote: 'Caché sin conexión',
    synthesizing: 'Sintetizando…',
    edgeDown: 'Edge no disponible: se usa la voz del sistema',
    noSystemVoice: 'Edge falló y no hay voz del sistema para este idioma',
    cacheCleared: 'Caché borrada',
    empty: 'Sin contenido',
    verseTip: 'Clic para leer este versículo',
    sleepStopped: 'El temporizador detuvo la reproducción',
    shortcuts: 'Atajos: Ctrl+Shift+S leer · Espacio reproducir/pausa · Esc detener',
    navigator: 'Navegar',
    readingSettings: 'Ajustes de lectura',
    searchBook: 'Buscar libros',
    appearance: 'Apariencia',
    themeLight: 'Claro',
    themeDark: 'Oscuro',
    oldTestament: 'Antiguo Testamento',
    newTestament: 'Nuevo Testamento',
    deuterocanonical: 'Deuterocanónicos',
  },
  fr: {
    translation: 'Traduction',
    book: 'Livre',
    chapter: 'Chapitre',
    voice: 'Voix',
    load: 'Charger',
    loading: 'Chargement…',
    uiLang: 'Langue',
    speakSelection: '▶ Lire la sélection',
    wholeVerse: 'Verset entier',
    close: 'Fermer',
    play: 'Lecture',
    pause: 'Pause',
    stop: 'Arrêter',
    readChapter: 'Lire le chapitre',
    speed: 'Vitesse',
    clearCache: 'Vider le cache',
    sleep: 'Minuteur',
    sleepOff: 'Désactivé',
    cachePill: 'cache',
    offlineNote: 'Cache hors ligne',
    synthesizing: 'Synthèse…',
    edgeDown: 'Edge indisponible — voix du système utilisée',
    noSystemVoice: "Edge a échoué et aucune voix système n'existe pour cette langue",
    cacheCleared: 'Cache vidé',
    empty: 'Aucun contenu',
    verseTip: 'Cliquez pour lire ce verset',
    sleepStopped: 'Le minuteur a arrêté la lecture',
    shortcuts: 'Raccourcis : Ctrl+Shift+S lire · Espace lecture/pause · Échap arrêter',
    navigator: 'Naviguer',
    readingSettings: 'Paramètres de lecture',
    searchBook: 'Rechercher un livre',
    appearance: 'Apparence',
    themeLight: 'Clair',
    themeDark: 'Sombre',
    oldTestament: 'Ancien Testament',
    newTestament: 'Nouveau Testament',
    deuterocanonical: 'Deutérocano­niques',
  },
};

export function strings(lang: UiLang): Strings {
  return STRINGS[lang] ?? STRINGS['zh-Hant'];
}
