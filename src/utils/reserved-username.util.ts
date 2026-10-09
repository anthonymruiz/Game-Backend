import englishReservedUsernames from '../langs/en/reserved-usernames.json' with { type: 'json' };
import spanishReservedUsernames from '../langs/es/reserved-usernames.json' with { type: 'json' };

const normalize = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[0123456789@]/g, (character) => ({
    '0': 'o',
    '1': 'i',
    '2': 'z',
    '3': 'e',
    '4': 'a',
    '5': 's',
    '6': 'g',
    '7': 't',
    '8': 'b',
    '9': 'g',
    '@': 'a'
  })[character] || character)
  .replace(/[^a-z0-9]/g, '');

const terms = [...new Set([...englishReservedUsernames.terms, ...spanishReservedUsernames.terms].map(normalize).filter(Boolean))];
const substringTerms = terms.filter((term) => term.length >= 5);

export const RESERVED_USERNAME_CANDIDATES = new Set([
  ...terms,
  ...englishReservedUsernames.variants.map(normalize),
  ...spanishReservedUsernames.variants.map(normalize)
]);

export const isReservedUsername = (username: string): boolean => {
  const normalized = normalize(username);
  return substringTerms.some((term) => normalized.includes(term)) ||
    RESERVED_USERNAME_CANDIDATES.has(normalized);
};
