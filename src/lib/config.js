const fs = require('fs');
const path = require('path');

// Package version
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
const VERSION = packageJson.version;

// Constants
const REJECTED_FIXES_FILE = '.literal-hell-wards';
const MAX_FILE_SIZE = 1024 * 1024; // 1MB

// HTML entity mappings
const ESCAPES = {
  '"': '&quot;',
  "'": '&apos;',
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

// Global state
let verbose = false;
let strictMode = false;

module.exports = {
  VERSION,
  REJECTED_FIXES_FILE,
  MAX_FILE_SIZE,
  ESCAPES,
  verbose,
  strictMode,
  setVerbose: (value) => { verbose = value; },
  setStrictMode: (value) => { strictMode = value; }
}; 