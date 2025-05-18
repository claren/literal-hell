#!/usr/bin/env node

const globby = require('globby');
const { parseArgs } = require('./lib/cli');
const { loadRejectedFixes, saveRejectedFixes } = require('./lib/fixes');
const { processFiles } = require('./lib/processor');
const { cleanupStdin } = require('./lib/ui');
const { initESLint } = require('./lib/eslint');
const { log } = require('./lib/logger');

async function main() {
  // Parse command line arguments and set up global state
  parseArgs();
  
  // Load previously rejected fixes
  loadRejectedFixes();
  
  // Initialize ESLint instance
  await initESLint();
  
  // Find all JavaScript and TypeScript files
  log('Searching for JavaScript and TypeScript files...', 'info');
  const filePaths = await globby(['**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx'], {
    ignore: ['node_modules/**', 'dist/**', 'build/**'],
    gitignore: true
  });
  
  if (filePaths.length === 0) {
    log('No JavaScript or TypeScript files found to process', 'warning');
    return;
  }
  
  log(`Found ${filePaths.length} files to process`, 'info');
  
  // Set up cleanup for stdin on process exit
  cleanupStdin();
  
  // Handle SIGINT to save rejection history before exiting
  process.on('SIGINT', () => {
    log('Saving rejection history and exiting...', 'info');
    saveRejectedFixes();
    process.exit(0);
  });
  
  // Process all files
  await processFiles(filePaths);
  
  // Save rejection history before exiting
  saveRejectedFixes();
}

// Run the main function
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
}); 