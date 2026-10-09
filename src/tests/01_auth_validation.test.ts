import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidEmailFormat, isValidUsernameFormat } from '../utils/regex.util.js';
import { isReservedUsername } from '../utils/reserved-username.util.js';
import englishReservedUsernames from '../langs/en/reserved-usernames.json' with { type: 'json' };
import spanishReservedUsernames from '../langs/es/reserved-usernames.json' with { type: 'json' };

describe('Authentication input validation', () => {
  it('requires usernames to start with a letter and contain at least 3 letters', () => {
    assert.equal(isValidUsernameFormat('abc'), true);
    assert.equal(isValidUsernameFormat('Player123'), true);
    assert.equal(isValidUsernameFormat('Ab1c2'), true);
    assert.equal(isValidUsernameFormat('ab'), false);
    assert.equal(isValidUsernameFormat('Ab1'), false);
    assert.equal(isValidUsernameFormat('123abc'), false);
    assert.equal(isValidUsernameFormat('a12b'), false);
    assert.equal(isValidUsernameFormat('user name'), false);
    assert.equal(isValidUsernameFormat('user_name'), false);
    assert.equal(isValidUsernameFormat(' user'), false);
  });

  it('accepts only valid emails without whitespace', () => {
    assert.equal(isValidEmailFormat('player@example.com'), true);
    assert.equal(isValidEmailFormat(' player@example.com'), false);
    assert.equal(isValidEmailFormat('player @example.com'), false);
    assert.equal(isValidEmailFormat('player@example'), false);
  });

  it('blocks reserved, abusive, and common leetspeak usernames in both languages', () => {
    assert.equal(isReservedUsername('admin'), true);
    assert.equal(isReservedUsername('realadmin'), true);
    assert.equal(isReservedUsername('botadministrador'), true);
    assert.equal(isReservedUsername('maricon'), true);
    assert.equal(isReservedUsername('mamaguevo'), true);
    assert.equal(isReservedUsername('bitch'), true);
    assert.equal(isReservedUsername('k1ller'), true);
    assert.equal(isReservedUsername('gamer123'), false);
  });

  it('loads 500 explicit reserved terms and username variants for each language', () => {
    assert.equal(englishReservedUsernames.terms.length + englishReservedUsernames.variants.length, 500);
    assert.equal(spanishReservedUsernames.terms.length + spanishReservedUsernames.variants.length, 500);
    assert.equal(
      englishReservedUsernames.terms.length + englishReservedUsernames.variants.length +
      spanishReservedUsernames.terms.length + spanishReservedUsernames.variants.length,
      1000
    );
  });
});
