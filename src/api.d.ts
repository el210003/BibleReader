export type VoiceOption = { id: string; locale: string; label: string };

export type Catalog = {
  translations: Record<
    string,
    { name: string; lang: string; voices: VoiceOption[]; defaultVoice: string }
  >;
  books: { id: number; name: string }[];
  systemLocale: string;
  preferredLanguages: string[];
  effectiveLocales: string[];
  defaults: { translation: string; voice: string; region: string };
  preferredVoice: Record<string, string>;
};

export type Verse = {
  verse: number;
  text: string;
  hasSuppliedWords: boolean;
  rawLen: number;
  removedSpaces: number;
};

export type Span = { charStart: number; charEnd: number; tMs: number; durMs: number };

export type SpeakResult = {
  audioBase64: string;
  durationMs: number;
  spans: Span[];
  unmapped: number;
  boundaryCount: number;
  trailingSilenceMs: number;
  cached: boolean;
};

declare global {
  interface Window {
    api: {
      getCatalog(): Promise<Catalog>;
      getChapter(args: { translation: string; book: number; chapter: number }): Promise<Verse[]>;
      speak(args: { text: string; voice: string; locale: string; rate?: string }): Promise<SpeakResult>;
    };
  }
}

export {};
