// Localized book names for the 66-book Protestant canon.
// The provider's own names are unreliable for display: CUV returns Simplified names
// ("创世记") even though its text is Traditional, and WEB includes 83 books (apocrypha).
// So: ids and chapter counts come from the provider, display names come from here.

const ZH_HANT = [
  '創世記', '出埃及記', '利未記', '民數記', '申命記', '約書亞記', '士師記', '路得記',
  '撒母耳記上', '撒母耳記下', '列王紀上', '列王紀下', '歷代志上', '歷代志下', '以斯拉記',
  '尼希米記', '以斯帖記', '約伯記', '詩篇', '箴言', '傳道書', '雅歌', '以賽亞書',
  '耶利米書', '耶利米哀歌', '以西結書', '但以理書', '何西阿書', '約珥書', '阿摩司書',
  '俄巴底亞書', '約拿書', '彌迦書', '那鴻書', '哈巴谷書', '西番雅書', '哈該書',
  '撒迦利亞書', '瑪拉基書',
  '馬太福音', '馬可福音', '路加福音', '約翰福音', '使徒行傳', '羅馬書', '哥林多前書',
  '哥林多後書', '加拉太書', '以弗所書', '腓立比書', '歌羅西書', '帖撒羅尼迦前書',
  '帖撒羅尼迦後書', '提摩太前書', '提摩太後書', '提多書', '腓利門書', '希伯來書',
  '雅各書', '彼得前書', '彼得後書', '約翰一書', '約翰二書', '約翰三書', '猶大書', '啟示錄',
];

const EN = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
  'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon',
  'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah',
  'Malachi',
  'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians', '2 Corinthians',
  'Galatians', 'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians',
  '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James',
  '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation',
];

const ES = [
  'Génesis', 'Éxodo', 'Levítico', 'Números', 'Deuteronomio', 'Josué', 'Jueces', 'Rut',
  '1 Samuel', '2 Samuel', '1 Reyes', '2 Reyes', '1 Crónicas', '2 Crónicas', 'Esdras',
  'Nehemías', 'Ester', 'Job', 'Salmos', 'Proverbios', 'Eclesiastés', 'Cantares',
  'Isaías', 'Jeremías', 'Lamentaciones', 'Ezequiel', 'Daniel', 'Oseas', 'Joel', 'Amós',
  'Obadías', 'Jonás', 'Miqueas', 'Nahúm', 'Habacuc', 'Sofonías', 'Hageo', 'Zacarías',
  'Malaquías',
  'Mateo', 'Marcos', 'Lucas', 'Juan', 'Hechos', 'Romanos', '1 Corintios', '2 Corintios',
  'Gálatas', 'Efesios', 'Filipenses', 'Colosenses', '1 Tesalonicenses',
  '2 Tesalonicenses', '1 Timoteo', '2 Timoteo', 'Tito', 'Filemón', 'Hebreos', 'Santiago',
  '1 Pedro', '2 Pedro', '1 Juan', '2 Juan', '3 Juan', 'Judas', 'Apocalipsis',
];

const FR = [
  'Genèse', 'Exode', 'Lévitique', 'Nombres', 'Deutéronome', 'Josué', 'Juges', 'Ruth',
  '1 Samuel', '2 Samuel', '1 Rois', '2 Rois', '1 Chroniques', '2 Chroniques', 'Esdras',
  'Néhémie', 'Esther', 'Job', 'Psaumes', 'Proverbes', 'Ecclésiaste', 'Cantique des cantiques',
  'Ésaïe', 'Jérémie', 'Lamentations', 'Ézéchiel', 'Daniel', 'Osée', 'Joël', 'Amos',
  'Obadia', 'Jonas', 'Michée', 'Nahum', 'Habacuc', 'Sophonie', 'Aggée', 'Zacharie',
  'Malachie',
  'Matthieu', 'Marc', 'Luc', 'Jean', 'Actes', 'Romains', '1 Corinthiens', '2 Corinthiens',
  'Galates', 'Éphésiens', 'Philippiens', 'Colossiens', '1 Thessaloniciens',
  '2 Thessaloniciens', '1 Timothée', '2 Timothée', 'Tite', 'Philémon', 'Hébreux', 'Jacques',
  '1 Pierre', '2 Pierre', '1 Jean', '2 Jean', '3 Jean', 'Jude', 'Apocalypse',
];

const TABLES = { 'zh-Hant': ZH_HANT, en: EN, es: ES, fr: FR };

// Section boundaries for the book picker.
function sectionOf(bookid) {
  if (bookid <= 39) return 'old';
  if (bookid <= 66) return 'new';
  return 'deutero';
}

function localizedBookName(bookid, lang, fallback) {
  const table = TABLES[lang];
  if (table && bookid >= 1 && bookid <= table.length) return table[bookid - 1];
  return fallback;
}

const SECTION_LABELS = {
  'zh-Hant': { old: '舊約', new: '新約', deutero: '次經 / 附篇' },
  en: { old: 'Old Testament', new: 'New Testament', deutero: 'Deuterocanonical' },
  es: { old: 'Antiguo Testamento', new: 'Nuevo Testamento', deutero: 'Deuterocanónicos' },
  fr: { old: 'Ancien Testament', new: 'Nouveau Testament', deutero: 'Deutérocano­niques' },
};

function sectionLabels(lang) {
  return SECTION_LABELS[lang] ?? SECTION_LABELS['zh-Hant'];
}

module.exports = { localizedBookName, sectionOf, sectionLabels, TABLES };
