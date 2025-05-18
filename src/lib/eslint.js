const { ESLint } = require('eslint');
const chalk = require('chalk');
const path = require('path');
const { log } = require('./logger');

// Initialize ESLint once
let eslintInstance = null;

// Initialize ESLint if not already done
async function initESLint() {
  if (!eslintInstance) {
    log('Initializing ESLint with Vercel Next.js rules...', 'info');
    try {
      // Get the path to literal-hell's node_modules
      const literalHellRoot = path.resolve(__dirname, '..', '..');
      
      eslintInstance = new ESLint({
        useEslintrc: false,  // Ignore project's .eslintrc completely
        cache: true,        // Enable caching
        cacheLocation: '.eslintcache',  // Cache file location
        resolvePluginsRelativeTo: literalHellRoot,  // Look for plugins in literal-hell's node_modules
        overrideConfig: {
          extends: ['next/core-web-vitals'],  // Use Vercel's Next.js ESLint config
          parser: '@typescript-eslint/parser',
          plugins: ['@typescript-eslint'],
          parserOptions: {
            ecmaVersion: 2020,
            sourceType: 'module',
            ecmaFeatures: {
              jsx: true
            }
          }
        }
      });
      log('ESLint initialized with Vercel Next.js rules', 'success');
    } catch (error) {
      log(`Failed to initialize ESLint: ${error.message}`, 'error');
      throw error;
    }
  }
  return eslintInstance;
}

// Run ESLint on multiple files and get escape errors
async function runESLintForEscapeErrors(filePaths, verbose = false) {
  try {
    const eslint = await initESLint();
    
    log(`Running ESLint on ${filePaths.length} files...`, 'info');
    
    // Run ESLint on all files at once
    const results = await eslint.lintFiles(filePaths);
    
    // Filter for only escape-related errors
    const escapeErrors = [];
    for (const fileResult of results) {
      if (verbose) {
        log(`Processing ${fileResult.filePath}...`, 'info');
      }
      for (const message of fileResult.messages) {
        if (message.ruleId === 'react/no-unescaped-entities') {
          // The message format is like: "`'` can be escaped with `&apos;`, `&lsquo;`, `&#39;`, `&rsquo;`."
          const entity = message.message.split('`')[1]; // Get the character between first backticks
          if (entity) {
            escapeErrors.push({
              filePath: fileResult.filePath,
              line: message.line,
              column: message.column,
              entity,
              message: message.message,
              source: message.source
            });
            if (verbose) {
              log(`Found unescaped entity "${entity}" in ${fileResult.filePath}:${message.line}:${message.column}`, 'info');
            }
          }
        }
      }
    }
    
    log(`ESLint found ${escapeErrors.length} unescaped entities across ${results.length} files`, 'info');
    return escapeErrors;
  } catch (error) {
    // If ESLint fails (e.g., not installed), return empty array
    log(`ESLint check failed: ${error.message}`, 'error');
    if (verbose) {
      console.error(error);
    }
    return [];
  }
}

// Convert ESLint errors to our internal fix format
function convertEslintErrorsToFixes(escapeErrors, fileContent) {
  const fixes = [];
  const lines = fileContent.split('\n');
  
  for (const error of escapeErrors) {
    const { line, column, entity } = error;
    const lineContent = lines[line - 1] || '';
    
    // Get the actual content that needs escaping
    const original = lineContent.substring(column - 1, column + entity.length - 1);
    
    // Skip if already escaped
    if (containsHtmlEntities(original)) {
      continue;
    }
    
    // Create escaped version
    const escaped = original.replace(/['"]/g, c => c === "'" ? '&apos;' : '&quot;');
    
    fixes.push({
      type: 'fix',
      original,
      escaped,
      escapedChars: [...new Set(original.match(/['"]/g) || [])],
      loc: {
        start: { line, column },
        end: { line, column: column + entity.length }
      },
      isJsx: true,
      rawValue: original
    });
  }
  
  return fixes;
}

// Helper function to check if a string contains HTML entities
function containsHtmlEntities(str) {
  const entityRegex = /&(quot|apos|amp|lt|gt);/g;
  const doubleEscapedRegex = /&amp;(quot|apos|lt|gt);/g;
  const numericEntityRegex = /&#(\d+);/g;
  
  return entityRegex.test(str) || doubleEscapedRegex.test(str) || numericEntityRegex.test(str);
}

module.exports = {
  runESLintForEscapeErrors,
  convertEslintErrorsToFixes,
  initESLint
}; 