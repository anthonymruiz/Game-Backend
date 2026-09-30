export type SupportedLanguage = 'en' | 'es';

export interface ITranslationKeys {
  MATCH_WON_TITLE: string;
  MATCH_WON_MSG: string;
  MATCH_LOST_TITLE: string;
  MATCH_LOST_MSG: string;
  ADMIN_MSG_TITLE: string;
}

export type ITranslations = Record<SupportedLanguage, ITranslationKeys>;
