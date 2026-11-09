import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGE_GROUPS, DEFAULT_LANGUAGE_CODES, readLanguageSettings, orderColumns, moveColumn } from '../dist/language-catalog.mjs';

test('preset lingua e paese nell’ordine richiesto', () => {
  assert.deepEqual(LANGUAGE_GROUPS.map(group => group.code), ['EN', 'DE', 'FR', 'ES', 'NL', 'IT', 'PL', 'PT', 'SV', 'DA', 'CS']);
  assert.deepEqual(DEFAULT_LANGUAGE_CODES, [
    'EN', 'EN_GB', 'EN_DK', 'EN_IE', 'EN_SE', 'EN_FI', 'EN_CZ',
    'DE', 'DE_DE', 'DE_AT', 'DE_BE', 'DE_LU', 'DE_CH',
    'FR', 'FR_FR', 'FR_BE', 'FR_LU', 'FR_CH',
    'ES', 'ES_ES', 'NL', 'NL_NL', 'NL_BE',
    'IT', 'IT_IT', 'IT_CH', 'PL', 'PL_PL', 'PT', 'PT_PT',
    'SV', 'SV_SE', 'DA', 'DA_DK', 'CS', 'CS_CZ'
  ]);
});

test('impostazioni salvate normalizzate e ripristino EN', () => {
  assert.deepEqual(readLanguageSettings(null), { selected: ['EN'], primary: 'EN', extra: [], columnOrder: [], nameTemplate: '{Nome}', numberStart: 1 });
  assert.deepEqual(readLanguageSettings({ selected: ['EN_gb', 'DE_BE', 'EN_GB', 'NM'], primary: 'IT', extra: ['ES_MX'] }), {
    selected: ['EN_GB', 'DE_BE'], primary: 'IT', extra: ['ES_MX'], columnOrder: [], nameTemplate: '{Nome}', numberStart: 1
  });
  assert.deepEqual(readLanguageSettings({ selected: ['SV_SE'], primary: 'SV_SE', extra: [] }), {
    selected: ['SV_SE'], primary: 'SV_SE', extra: [], columnOrder: [], nameTemplate: '{Nome}', numberStart: 1
  });
});

test('ordine colonne salvato, validato e applicato anche a lingue non visibili', () => {
  assert.deepEqual(readLanguageSettings({ selected: ['EN'], primary: 'EN', extra: [], columnOrder: ['nl', 'EN', 'NM', 'NL'] }).columnOrder, ['NL', 'EN']);
  assert.deepEqual(orderColumns(['EN', 'DE', 'FR', 'NL'], ['NL', 'FR']), ['NL', 'FR', 'EN', 'DE']);
  const order = moveColumn(['EN', 'DE', 'NL'], ['IT', 'EN'], 'NL', 'EN', false);
  assert.deepEqual(order, ['NL', 'EN', 'DE', 'IT']);
  assert.deepEqual(orderColumns(['EN', 'DE', 'IT', 'NL'], order), ['NL', 'EN', 'DE', 'IT']);
  assert.deepEqual(moveColumn(['EN', 'DE'], order, 'EN', 'EN', true), order);
});
