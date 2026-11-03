/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

// Deterministic tests for the pricing-page capability filter. These pin the
// capability semantics contract: image capability comes from the site-level
// image_model_settings, speech capabilities come from the backend
// supports_tts / supports_asr fields with an image_model_settings fallback,
// and "chat" is the catch-all for models with no dedicated capability.
// Run with: node --test test/pricingCapability.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelMatchesCapability } from '../src/components/table/model-pricing/filter/pricingCapability.js';

const imageModelSettingsMap = {
  'gpt-image-2': { modes: ['generations', 'edits'] },
  'speech-2.8-turbo': { tts_modes: ['speech'] },
  'asr-1.0': { asr_modes: ['transcription'] },
};

const models = [
  { model_name: 'gpt-image-2' },
  { model_name: 'speech-2.8-turbo' },
  { model_name: 'asr-1.0' },
  { model_name: 'MiniMax-M3' },
  { model_name: 'remote-tts', supports_tts: true },
  { model_name: 'remote-asr', supports_asr: true },
];

const countOf = (capability) =>
  models.filter((model) =>
    modelMatchesCapability(model, capability, imageModelSettingsMap),
  ).length;

test('all capability matches every model', () => {
  assert.equal(countOf('all'), 6);
});

test('image capability comes from image_model_settings modes', () => {
  assert.equal(countOf('image'), 1);
  assert.equal(
    modelMatchesCapability(
      { model_name: 'gpt-image-2' },
      'image',
      imageModelSettingsMap,
    ),
    true,
  );
  assert.equal(
    modelMatchesCapability({ model_name: 'MiniMax-M3' }, 'image', {}),
    false,
  );
});

test('tts capability reads backend field and settings fallback', () => {
  // speech-2.8-turbo (settings) + remote-tts (backend field)
  assert.equal(countOf('tts'), 2);
  assert.equal(
    modelMatchesCapability({ model_name: 'remote-tts', supports_tts: true }, 'tts', {}),
    true,
  );
  assert.equal(
    modelMatchesCapability({ model_name: 'MiniMax-M3' }, 'tts', {}),
    false,
  );
});

test('asr capability reads backend field and settings fallback', () => {
  // asr-1.0 (settings) + remote-asr (backend field)
  assert.equal(countOf('asr'), 2);
  assert.equal(
    modelMatchesCapability({ model_name: 'remote-asr', supports_asr: true }, 'asr', {}),
    true,
  );
  assert.equal(
    modelMatchesCapability({ model_name: 'MiniMax-M3' }, 'asr', {}),
    false,
  );
});

test('chat capability excludes every dedicated capability', () => {
  // Only MiniMax-M3 has no image/tts/asr capability.
  assert.equal(countOf('chat'), 1);
  assert.equal(
    modelMatchesCapability({ model_name: 'MiniMax-M3' }, 'chat', imageModelSettingsMap),
    true,
  );
  assert.equal(
    modelMatchesCapability(
      { model_name: 'speech-2.8-turbo' },
      'chat',
      imageModelSettingsMap,
    ),
    false,
  );
  assert.equal(
    modelMatchesCapability({ model_name: 'remote-tts', supports_tts: true }, 'chat', {}),
    false,
  );
});

test('unknown capability falls back to matching everything', () => {
  assert.equal(
    modelMatchesCapability({ model_name: 'anything' }, 'unrecognized', {}),
    true,
  );
});
