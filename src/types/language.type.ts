export type SupportedLanguage = 'en' | 'es';

export interface ITranslationKeys {
  MATCH_WON_TITLE: string;
  MATCH_WON_MSG: string;
  MATCH_LOST_TITLE: string;
  MATCH_LOST_MSG: string;
  ADMIN_MSG_TITLE: string;
  REPORT_REPORTER_TITLE: string;
  REPORT_REPORTER_MSG: string;
  REPORTED_USER_TITLE: string;
  REPORTED_USER_MSG: string;
  FRIEND_REQ_TITLE: string;
  FRIEND_REQ_MSG: string;
  FRIEND_ACC_TITLE: string;
  FRIEND_ACC_MSG: string;
  FRIEND_REJ_TITLE: string;
  FRIEND_REJ_MSG: string;
  STORE_ITEM_PURCHASED_TITLE: string;
  STORE_ITEM_PURCHASED_MSG: string;
  STORE_ITEM_GIFTED_TITLE: string;
  STORE_ITEM_GIFTED_MSG: string;
  POINTS_GIFTED_TITLE: string;
  POINTS_GIFTED_MSG: string;
}

export type ITranslations = Record<SupportedLanguage, ITranslationKeys>;
