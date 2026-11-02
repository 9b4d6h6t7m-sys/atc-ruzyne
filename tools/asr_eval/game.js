// Load the game's data, core and phraseology code into a Node VM so the real parser can be tested offline.
const vm = require('vm'), fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '../../src');
function load() {
  const sandbox = { console, Math, Date, JSON, Set, Map, Array, Object, String, Number, parseFloat, parseInt, isNaN, RegExp, Promise, setTimeout, clearTimeout };
  sandbox.window = sandbox; sandbox.document = { createElement: () => ({ style: {}, append() {}, setAttribute() {} }), addEventListener() {} }; sandbox.navigator = {};
  sandbox.App = { emit() {}, on() {}, feature() {} };
  const ctx = vm.createContext(sandbox);
  for (const f of ['data.js', 'core.js', 'phrase.js', 'voiceparse.js']) vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  vm.runInContext('globalThis.__api = { Parser, VoiceParser, Phrase, Speak, AIRLINES, FIX, RWY, D, PHON, DIGW, cmdLabel };', ctx);
  return ctx.__api;
}
module.exports = { load };
