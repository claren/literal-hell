const fs = require('fs');
const { REJECTED_FIXES_FILE } = require('./config');
const { log } = require('./logger');

// Store rejected fixes in memory
let rejectedFixes = {};
// Track file modification times
let fileModTimes = {};

// Create a unique key for a fix
function createFixKey(filePath, line, column, original) {
  return `${filePath}:${line}:${column}:${original}`;
}

// Load previously rejected fixes if they exist
function loadRejectedFixes() {
  try {
    if (fs.existsSync(REJECTED_FIXES_FILE)) {
      rejectedFixes = JSON.parse(fs.readFileSync(REJECTED_FIXES_FILE, 'utf8'));
      log(`Loaded ${Object.keys(rejectedFixes).length} previously rejected fixes`, 'info');
    }
  } catch (error) {
    log(`Error loading rejected fixes: ${error.message}`, 'error');
    rejectedFixes = {};
  }
}

// Save rejected fixes to file
function saveRejectedFixes() {
  try {
    fs.writeFileSync(REJECTED_FIXES_FILE, JSON.stringify(rejectedFixes, null, 2));
  } catch (error) {
    log(`Error saving rejected fixes: ${error.message}`, 'error');
  }
}

// Clear rejection history
function clearRejectionHistory() {
  if (fs.existsSync(REJECTED_FIXES_FILE)) {
    fs.unlinkSync(REJECTED_FIXES_FILE);
  }
  rejectedFixes = {};
  log('Cleared fix rejection history', 'info');
}

// Add a fix to rejected fixes
function addRejectedFix(filePath, line, column, original, reason = null) {
  const fixKey = createFixKey(filePath, line, column, original);
  rejectedFixes[fixKey] = {
    filePath,
    line,
    column,
    original,
    timestamp: new Date().toISOString(),
    ...(reason && { reason })
  };
}

// Check if a fix has been rejected
function isFixRejected(filePath, line, column, original) {
  const fixKey = createFixKey(filePath, line, column, original);
  return !!rejectedFixes[fixKey];
}

module.exports = {
  rejectedFixes,
  fileModTimes,
  createFixKey,
  loadRejectedFixes,
  saveRejectedFixes,
  clearRejectionHistory,
  addRejectedFix,
  isFixRejected
}; 