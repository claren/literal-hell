const fs = require('fs');
const path = require('path');
const babelParser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const chalk = require('chalk');
const inquirer = require('inquirer');
const globby = require('globby');
const readline = require('readline');

// Package version
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const VERSION = packageJson.version;

const ESCAPES = {
  '"': '&quot;',
  "'": '&apos;',
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

// Store rejected fixes in memory and persist to file
const REJECTED_FIXES_FILE = '.literal-hell-wards';
let rejectedFixes = {};
// Track file modification times
let fileModTimes = {};
// Mode flags
let verbose = false;
let strictMode = false;

// Conditional logging function
function log(message, type = 'info') {
  // Always log errors, warnings, and skips
  if (type === 'error') {
    console.error(chalk.red(message));
    return;
  }
  
  if (type === 'warning') {
    console.log(chalk.yellow(message));
    return;
  }
  
  if (type === 'skip') {
    console.log(chalk.gray(message));
    return;
  }
  
  // For info messages, only log if verbose mode is on
  if (verbose || type === 'success') {
    const color = type === 'success' ? chalk.green : chalk.blue;
    console.log(color(message));
  }
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

// Check if a file has been modified since we last read it
function checkFileModification(filePath) {
  try {
    const currentModTime = fs.statSync(filePath).mtimeMs;
    
    if (fileModTimes[filePath] && fileModTimes[filePath] !== currentModTime) {
      log(`Warning: File ${filePath} has been modified since processing began.`, 'warning');
      return true;
    }
    
    // Update stored modification time
    fileModTimes[filePath] = currentModTime;
    return false;
  } catch (error) {
    log(`Error checking file modification: ${error.message}`, 'error');
    return false;
  }
}

// Check if a string should be excluded from escaping
function shouldExcludeFromEscaping(str) {
  // In strict mode, don't auto-exclude anything
  if (strictMode) {
    return false;
  }

  // Skip URL-like strings with query parameters
  if (str.includes('?') && str.includes('&') && !str.includes(' ')) {
    return true;
  }
  
  // Skip URL query parameter fragments (starting with &param=value)
  if (str.startsWith('&') && str.includes('=') && !str.includes(' ')) {
    return true;
  }
  
  // Skip CSS selectors
  if (str.startsWith('&') && str.includes(':')) {
    return true;
  }
  
  // Skip plain ampersands or double symbols that are likely CSS or operators
  if (str === '&' || str === '>>' || str === '&&') {
    return true;
  }
  
  return false;
}

// Check if a string appears to contain HTML entities already
function containsHtmlEntities(str) {
  const entityRegex = /&(quot|apos|amp|lt|gt);/g;
  return entityRegex.test(str);
}

// Better check for already fixed content in the file
function isAlreadyFixed(fileContent, line, column, original, escaped) {
  try {
    // Get the line from the file
    const fileLines = fileContent.split('\n');
    const fileLine = fileLines[line - 1]; // lines are 1-indexed in AST
    
    // Check if the line already contains the escaped version
    if (fileLine.includes(escaped)) {
      return true;
    }
    
    // For nested escaping (like &apos;&apos;), do a more robust check
    // Match against position in the line
    const lineContext = fileLine.substr(Math.max(0, column - 20), 100);
    
    // Check if this part of the line contains HTML entities
    if (containsHtmlEntities(lineContext)) {
      return true;
    }
    
    return false;
  } catch (error) {
    log(`Error checking if already fixed: ${error.message}`, 'error');
    return false;
  }
}

function escapeString(str) {
  // Don't escape strings that should be excluded
  if (shouldExcludeFromEscaping(str)) {
    return str;
  }

  // Prevent double-escaping if the string already contains HTML entities
  if (containsHtmlEntities(str)) {
    return str;
  }

  // Find which characters need escaping and return the result
  const charactersToEscape = [];
  const escaped = str.replace(/[\"'&<>]/g, c => {
    charactersToEscape.push(c);
    return ESCAPES[c];
  });
  
  return {
    result: escaped,
    escapedChars: [...new Set(charactersToEscape)] // Remove duplicates
  };
}

// Create a unique key for a fix
function createFixKey(filePath, line, column, original) {
  return `${filePath}:${line}:${column}:${original}`;
}

// Function to capture a single keypress
function getSingleKeypress(prompt) {
  return new Promise(resolve => {
    // Display the prompt
    process.stdout.write(prompt);
    
    // Put stdin in raw mode to get keypresses
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    
    // Listen for keypress
    const onKeypress = (str, key) => {
      if (key && key.name === 'return') {
        // Default to 'y' on Enter
        process.stdin.setRawMode(false);
        process.stdin.removeListener('keypress', onKeypress);
        process.stdout.write('y\n');
        resolve('y');
        return;
      }
      
      if (key && key.ctrl && key.name === 'c') {
        // Handle Ctrl+C for clean exit
        process.stdout.write('\n');
        process.exit(0);
      }
      
      // Check for expected keys
      if (str === 'y' || str === 'n' || str === 'q' || str === 'c') {
        if (str === 'c') {
          // Don't exit raw mode for 'c' - just return it to show context
          process.stdout.write(`${str}\n`);
          resolve(str);
          return;
        }
        
        process.stdin.setRawMode(false);
        process.stdin.removeListener('keypress', onKeypress);
        // Just write the character once and add a newline
        process.stdout.write(`${str}\n`);
        resolve(str);
      }
    };
    
    process.stdin.on('keypress', onKeypress);
  });
}

// Function to get context lines around a specific line
function getContextLines(fileContent, lineNumber, contextSize = 5) {
  const lines = fileContent.split('\n');
  const startLine = Math.max(0, lineNumber - contextSize - 1);
  const endLine = Math.min(lines.length - 1, lineNumber + contextSize - 1);
  
  const contextLines = [];
  for (let i = startLine; i <= endLine; i++) {
    const prefix = i === lineNumber - 1 ? chalk.green('→ ') : '  ';
    contextLines.push(`${chalk.gray(i + 1)}:${prefix}${lines[i]}`);
  }
  
  return contextLines.join('\n');
}

// More advanced pattern detection for contexts where we shouldn't escape
function isAutoSkipPattern(str, filePath, line, column) {
  // If in strict mode, don't auto-skip anything
  if (strictMode) {
    return false;
  }
  
  // CSS selector pattern checks - more comprehensive
  // Check for attribute selectors like &[data-hovered]
  if (str.startsWith('&') && (str.includes(' ') || str.includes('[') || str.includes(':'))) {
    return { reason: 'CSS selector pattern' };
  }
  
  // CSS rule check
  if (filePath.endsWith('.css') || filePath.endsWith('.scss') || 
      filePath.endsWith('.less') || filePath.endsWith('.styl')) {
    return { reason: 'CSS file content' };
  }
  
  // Style object in JS/TS files
  if ((str.startsWith('&') || str.includes(' &')) && 
      (filePath.includes('style') || filePath.includes('Style') || 
       filePath.includes('.css') || filePath.includes('.scss'))) {
    return { reason: 'Likely CSS-in-JS pattern' };
  }
  
  // Font family declarations
  if ((str.includes('system') || str.includes('serif') || str.includes('sans-serif') || 
       str.includes('monospace') || str.includes('Roboto') || str.includes('Arial') ||
       str.includes('Helvetica') || str.includes('font') || str.includes('Font')) && 
      (str.includes(',') || str.match(/^[A-Za-z-]+$/))) {
    return { reason: 'Font family declaration' };
  }
  
  // GraphQL/query parameter
  if (str.includes('&') && 
      (str.includes('query') || str.includes('filter') || str.includes('param'))) {
    return { reason: 'Query parameter pattern' };
  }
  
  // Enhanced CSS selector detection - broader rules
  if (str.match(/^&[.#[]/) || str.match(/^&:/) || str.match(/^&>/) || str.includes(' & ')) {
    return { reason: 'CSS selector pattern (enhanced detection)' };
  }
  
  // Additional check for any string in a style context
  const lineContext = filePath.split('\n')[line - 1] || '';
  if ((lineContext.includes('style') || lineContext.includes('Style') || 
       lineContext.includes('className') || lineContext.includes('css')) &&
      (lineContext.includes(':') || lineContext.includes('=')) &&
      (str.includes('-') || str.includes(' ') || str.includes(','))) {
    return { reason: 'CSS property value' };
  }
  
  return false;
}

async function processFile(filePath) {
  log(`Processing file: ${filePath}`);
  
  // Record initial file modification time
  fileModTimes[filePath] = fs.statSync(filePath).mtimeMs;
  
  let fileContent = fs.readFileSync(filePath, 'utf8');
  
  // Try parsing the file to find the string literals
  let ast;
  try {
    ast = babelParser.parse(fileContent, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      errorRecovery: true,
      locations: true,
    });
  } catch (error) {
    log(`Error parsing ${filePath}: ${error.message}`, 'error');
    return;
  }

  const stringFixes = [];

  // Collect string literal fixes with locations
  traverse(ast, {
    StringLiteral(path) {
      const original = path.node.value;
      
      // Debug in strict mode
      if (strictMode && (original.startsWith('&') || original.includes('&'))) {
        console.log(chalk.green(`[STRICT] Checking string: "${original}" at ${filePath}:${path.node.loc.start.line}:${path.node.loc.start.column}`));
      }
      
      const escapeResult = escapeString(original);
      
      // Skip if escapeString returned the original string (no escaping needed)
      if (escapeResult === original) {
        if (strictMode && (original.startsWith('&') || original.includes('&'))) {
          console.log(chalk.red(`[STRICT] Skipped because escapeString returned original`));
        }
        return;
      }
      
      // Skip if no changes were made
      if (typeof escapeResult === 'object' && escapeResult.result === original) {
        if (strictMode && (original.startsWith('&') || original.includes('&'))) {
          console.log(chalk.red(`[STRICT] Skipped because no changes were made`));
        }
        return;
      }
      
      if (typeof escapeResult === 'object') {
        // Check if the escaped version already exists in the file
        // This handles the case where Babel normalizes entities in the AST
        
        // Check more thoroughly if this string is already fixed in the file
        if (isAlreadyFixed(fileContent, path.node.loc.start.line, path.node.loc.start.column, original, escapeResult.result)) {
          log(`Skipping already fixed string at ${filePath}:${path.node.loc.start.line}:${path.node.loc.start.column}`, 'skip');
          if (strictMode && (original.startsWith('&') || original.includes('&'))) {
            console.log(chalk.red(`[STRICT] Skipped because already fixed in file`));
          }
          return;
        }
        
        // Check for patterns we should auto-skip
        const autoSkipResult = isAutoSkipPattern(original, filePath, path.node.loc.start.line, path.node.loc.start.column);
        if (autoSkipResult) {
          if (strictMode) {
            console.log(chalk.green(`[STRICT] Auto-skip pattern detected, but in strict mode so NOT skipping: ${autoSkipResult.reason}`));
          } else {
            log(`Auto-skipping at ${filePath}:${path.node.loc.start.line}:${path.node.loc.start.column} - ${autoSkipResult.reason}`, 'skip');
            
            // Add to rejected fixes so we don't see it again
            const fixKey = createFixKey(filePath, path.node.loc.start.line, path.node.loc.start.column, original);
            rejectedFixes[fixKey] = {
              filePath,
              line: path.node.loc.start.line,
              column: path.node.loc.start.column,
              original,
              autoSkipped: true,
              reason: autoSkipResult.reason,
              timestamp: new Date().toISOString()
            };
            
            return;
          }
        }
        
        // Keep track of the exact location in the file for direct replacement
        stringFixes.push({ 
          path, 
          original, 
          escaped: escapeResult.result,
          escapedChars: escapeResult.escapedChars,
          loc: path.node.loc
        });
        
        if (strictMode && (original.startsWith('&') || original.includes('&'))) {
          console.log(chalk.green(`[STRICT] Added to fix list for prompting: "${original}"`));
        }
      }
    }
  });

  const fixCount = stringFixes.length;
  if (fixCount > 0) {
    console.log(chalk.blue(`Found ${fixCount} potential fixes in ${filePath}`));
  } else {
    log(`No potential fixes in ${filePath}`, 'info');
  }

  // Sort fixes from last to first in the file to avoid position shifts
  stringFixes.sort((a, b) => {
    // Sort by line number (descending)
    if (b.loc.start.line !== a.loc.start.line) {
      return b.loc.start.line - a.loc.start.line;
    }
    // If same line, sort by column (descending)
    return b.loc.start.column - a.loc.start.column;
  });

  let changed = false;
  
  // Prompt user for each fix (in reverse order)
  for (const fix of stringFixes) {
    const { original, escaped, escapedChars, loc } = fix;
    const { line, column } = loc.start;
    const fixKey = createFixKey(filePath, line, column, original);

    // Skip if we've already rejected this exact fix before
    if (rejectedFixes[fixKey]) {
      log(`Skipping previously rejected fix in ${filePath}:${line}:${column}`, 'skip');
      continue;
    }

    console.log(chalk.yellow(`\nIn ${filePath}:${line}:${column}`));
    console.log('Original:', original);
    console.log('Escaped: ', escaped);
    console.log(chalk.cyan(`Characters to escape: ${escapedChars.map(c => `[  ${c}  ]`).join(', ')}`));

    // Loop to handle context viewing and decision
    while (true) {
      // Use single-keypress input
      const response = await getSingleKeypress('Apply fix? (y/n/q/c for context) [y]: ');
      
      if (response === 'c') {
        // Show context and continue the loop
        console.log(chalk.yellow('\nContext:'));
        console.log(getContextLines(fileContent, line, 7));
        console.log(''); // Empty line for readability
        continue;
      }
      
      // Check if file has been modified externally
      if (checkFileModification(filePath)) {
        log(`File ${filePath} was modified externally. Aborting processing of this file.`, 'warning');
        break;
      }
      
      if (response === 'q') {
        // Save any changes that have been applied so far
        if (changed) {
          try {
            fs.writeFileSync(filePath, fileContent, 'utf8');
            log(`✓ Saved: ${filePath}`, 'success');
            
            // Update modification time after saving
            fileModTimes[filePath] = fs.statSync(filePath).mtimeMs;
          } catch (error) {
            log(`Error saving file: ${error.message}`, 'error');
          }
        }
        
        log('Saving rejection history and exiting...', 'info');
        saveRejectedFixes();
        process.exit(0);
      } else if (response === 'y') {
        log(`Applying fix: ${original} -> ${escaped}`, 'info');
        
        // Direct string replacement in the file content (handle both single and double quoted literals)
        const singleQuotePattern = new RegExp(`'${escapeRegExp(original)}'`, 'g');
        const doubleQuotePattern = new RegExp(`"${escapeRegExp(original)}"`, 'g');
        
        if (fileContent.match(singleQuotePattern)) {
          fileContent = fileContent.replace(singleQuotePattern, `'${escaped}'`);
          log(`Replaced in single quotes`, 'info');
        } else if (fileContent.match(doubleQuotePattern)) {
          fileContent = fileContent.replace(doubleQuotePattern, `"${escaped}"`);
          log(`Replaced in double quotes`, 'info');
        } else {
          // Fallback to more precise replacement using location
          try {
            // Get the lines of the file
            const lines = fileContent.split('\n');
            
            // Find the line containing the string literal
            const targetLine = lines[loc.start.line - 1]; // locations are 1-indexed
            
            // Find where the actual string content starts and ends (ignoring quotes)
            // Assume the first quote is at the column position
            const quoteChar = targetLine[loc.start.column];
            const stringStart = loc.start.column + 1; // skip the opening quote
            
            // Find where the string content ends (character before the closing quote)
            const closingQuotePos = targetLine.indexOf(quoteChar, stringStart);
            
            if (closingQuotePos > stringStart) {
              // Extract the string content
              const stringContent = targetLine.substring(stringStart, closingQuotePos);
              
              // Verify it matches our expected original
              if (stringContent === original) {
                // Replace the string content with the escaped version
                const newLine = 
                  targetLine.substring(0, stringStart) + 
                  escaped + 
                  targetLine.substring(closingQuotePos);
                
                // Update the line in the lines array
                lines[loc.start.line - 1] = newLine;
                
                // Reconstruct the file content
                fileContent = lines.join('\n');
                log(`Replaced with precise location`, 'info');
              } else {
                log(`String content mismatch: expected "${original}" but found "${stringContent}"`, 'warning');
              }
            }
          } catch (error) {
            log(`Error during precise replacement: ${error.message}`, 'error');
          }
        }
        
        changed = true;
        break;
      } else {
        // Must be 'n' - record this as a rejected fix
        rejectedFixes[fixKey] = {
          filePath,
          line,
          column,
          original,
          timestamp: new Date().toISOString()
        };
        break;
      }
    }
  }

  if (changed) {
    try {
      log(`Writing changes to ${filePath}...`, 'info');
      fs.writeFileSync(filePath, fileContent, 'utf8');
      
      // Verify file was written correctly
      const newContents = fs.readFileSync(filePath, 'utf8');
      log(`Verified file size: ${newContents.length} bytes`, 'info');
      
      // Update modification time after saving
      fileModTimes[filePath] = fs.statSync(filePath).mtimeMs;
      log(`✓ Successfully saved: ${filePath}`, 'success');
    } catch (error) {
      log(`Error saving file: ${error.message}`, 'error');
    }
  } else if (stringFixes.length > 0) {
    log(`No changes made to ${filePath}`, 'info');
  }
  
  // Save rejected fixes after processing each file
  saveRejectedFixes();
}

// Helper function to escape special characters in regular expressions
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Display help text
function showHelp() {
  console.log(chalk.bold('\nliteral-hell: HTML entity escaping for string literals\n'));
  console.log('Usage:');
  console.log('  literal-hell [options]\n');
  
  console.log('Options:');
  console.log('  --help, -h       Show this help message');
  console.log('  --version, -v    Show version information');
  console.log('  --verbose        Show detailed logs during processing');
  console.log('  --strict         Force prompt for all fixes (no auto-skipping)');
  console.log('  --clear-history  Clear rejection history (re-check previously skipped items)\n');
  
  console.log('Interactive Commands:');
  console.log('  y (or Enter)  Apply the fix');
  console.log('  n             Skip this fix and remember for future runs');
  console.log('  q             Save changes and exit');
  console.log('  c             Show surrounding code context before deciding\n');
  
  console.log('Examples:');
  console.log('  literal-hell              Basic usage');
  console.log('  literal-hell --strict     Review all potential fixes');
  console.log('  literal-hell --verbose    Show detailed logs\n');
  
  console.log('For more information, see: https://github.com/claren/literal-hell\n');
}

(async () => {
  // Parse command line arguments
  const args = process.argv.slice(2);
  
  // Check for help flag first
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }
  
  // Check for version flag
  if (args.includes('--version') || args.includes('-v')) {
    console.log(`literal-hell version ${VERSION}`);
    process.exit(0);
  }
  
  const clearHistory = args.includes('--clear-history');
  verbose = args.includes('--verbose');
  strictMode = args.includes('--strict');
  
  // Debug logging
  console.log(chalk.blue(`Running with options: ${JSON.stringify({
    verbose,
    strictMode,
    clearHistory
  })}`));
  
  if (strictMode) {
    console.log(chalk.yellow('Running in strict mode - will prompt for ALL potential fixes, including CSS selectors'));
  } else {
    log('Running in normal mode - will auto-skip common patterns like CSS selectors', 'info');
  }
  
  if (clearHistory) {
    log('Clearing fix rejection history...', 'info');
    if (fs.existsSync(REJECTED_FIXES_FILE)) {
      fs.unlinkSync(REJECTED_FIXES_FILE);
    }
    rejectedFixes = {};
  } else {
    loadRejectedFixes();
  }

  const files = await globby(['**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx'], { gitignore: true });
  for (const file of files) {
    await processFile(file);
  }
})();
