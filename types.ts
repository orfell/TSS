export enum Gender {
  Male = 'Hombre',
  Female = 'Mujer'
}

export enum Language {
  Spanish = 'Spanish',
  English = 'English'
}

export enum Accent {
  // Spanish
  Spain = 'Español (España)',
  Mexico = 'Español (México)',
  Argentina = 'Español (Argentina)',
  Colombia = 'Español (Colombia)',
  
  // English
  US = 'Inglés (Americano)',
  UK = 'Inglés (Británico)',
  Australia = 'Inglés (Australiano)'
}

export enum Style {
  Natural = 'Natural',
  Joyful = 'Alegre',
  Sad = 'Triste',
  Whisper = 'Susurrar',
  Storyteller = 'Storyteller'
}

export interface VoiceOption {
  id: string;
  name: string; // Display name
  apiName: string; // Real Gemini voice name
  gender: Gender;
}

export interface AudioSettings {
  language: Language;
  voiceId: string;
  accent: Accent;
  style: Style;
  speed: number;
  pitch: number;
}

export interface HistoryItem {
  id: string;
  text: string;
  audioBlob: Blob;
  duration: number; // in seconds
  createdAt: number;
  settings: AudioSettings;
}

export const TAGS = [
  { label: 'Pausa (2s)', value: '[pausa]' },
  { label: 'Risa', value: '[risa]' },
  { label: 'Grito', value: '[grito]' },
  { label: 'Llanto', value: '[llanto]' },
];
