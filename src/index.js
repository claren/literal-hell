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
  
  if (type === 'uncertainty') {
    console.log(chalk.magenta(message));
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
  // More comprehensive check for HTML entities
  const entityRegex = /&(quot|apos|amp|lt|gt);/g;
  
  // Also check for potential double-escaped entities
  const doubleEscapedRegex = /&amp;(quot|apos|lt|gt);/g;
  
  // Add check for numeric HTML entities (&#39; for single quote, etc.)
  const numericEntityRegex = /&#(\d+);/g;
  
  return entityRegex.test(str) || doubleEscapedRegex.test(str) || numericEntityRegex.test(str);
}

// More advanced check for JSX content to prevent corruption
function isSafeToEscapeInJsx(original, line) {
  // Skip if the content has JSX tags
  if (original.includes('<') && original.includes('>')) {
    return false;
  }
  
  // Skip if apostrophes appear inside HTML-like tags
  const tagPattern = /<[^>]*'[^>]*>/;
  if (tagPattern.test(original) || tagPattern.test(line)) {
    return false;
  }
  
  return true;
}

// Better check for already fixed content in the file
function isAlreadyFixed(fileContent, line, column, original, escaped) {
  try {
    // Get the lines from the file
    const fileLines = fileContent.split('\n');
    
    // For multiline content, check each line
    if (original.includes('\n')) {
      // Split the original content into lines
      const originalLines = original.split('\n');
      
      // Check if any line already contains HTML entities
      for (let i = 0; i < originalLines.length; i++) {
        const currentLine = fileLines[line - 1 + i];
        
        // If any line contains an HTML entity, consider it already fixed
        if (currentLine && containsHtmlEntities(currentLine.trim())) {
          return true;
        }
      }
      
      // If we're looking for a specific escaped string across multiple lines
      // Check the raw file content for it
      const combinedContent = fileLines.slice(line - 1, line - 1 + originalLines.length).join('\n');
      if (containsHtmlEntities(combinedContent)) {
        return true;
      }
      
      return false;
    }
    
    // Single-line case (original implementation)
    const fileLine = fileLines[line - 1]; // lines are 1-indexed in AST
    
    // Check if the line already contains the escaped version
    if (fileLine && fileLine.includes(escaped)) {
      return true;
    }
    
    // For nested escaping (like &apos;&apos;), do a more robust check
    // Match against position in the line
    if (fileLine) {
      const lineContext = fileLine.substr(Math.max(0, column - 20), 100);
      
      // Check if this part of the line contains HTML entities
      if (containsHtmlEntities(lineContext)) {
        return true;
      }
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
  
  // For JSX content, we should be more selective
  // If the string contains angle brackets, it might be JSX
  if (str.includes('<') || str.includes('>')) {
    // Only escape quotes and apostrophes in JSX, leave tags alone
    const charactersToEscape = [];
    const escaped = str.replace(/[\"']/g, c => {
      charactersToEscape.push(c);
      return ESCAPES[c];
    });
    
    return {
      result: escaped,
      escapedChars: [...new Set(charactersToEscape)]
    };
  }

  // For regular strings, escape everything as before
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
  // Increase max listeners to prevent warning
  if (process.stdin.getMaxListeners() <= 10) {
    process.stdin.setMaxListeners(20);
  }
  
  return new Promise((resolve, reject) => {
    try {
      // Display the prompt
      process.stdout.write(prompt);
      
      // Put stdin in raw mode to get keypresses
      readline.emitKeypressEvents(process.stdin);
      let wasRaw = false;
      if (process.stdin.isTTY) {
        wasRaw = process.stdin.isRaw;
        process.stdin.setRawMode(true);
      }
      
      // Helper function to clean up listeners and restore terminal state
      function cleanupAndExit(result) {
        if (process.stdin.isTTY) {
          // Only reset if we changed it
          if (!wasRaw) {
            process.stdin.setRawMode(false);
          }
        }
        
        // Clean up all listeners
        process.stdin.removeListener('keypress', onKeypress);
        process.stdin.removeListener('error', onError);
        
        // Just write the character once and add a newline
        if (result) {
          process.stdout.write(`${result}\n`);
          resolve(result);
        }
      }
      
      // Error handler
      const onError = (err) => {
        cleanupAndExit();
        reject(err);
      };
      
      // Listen for keypress
      const onKeypress = (str, key) => {
        if (key && key.name === 'return') {
          // Default to 'y' on Enter
          cleanupAndExit('y');
          return;
        }
        
        if (key && key.ctrl && key.name === 'c') {
          // Handle Ctrl+C for clean exit
          process.stdout.write('\n');
          cleanupAndExit();
          saveRejectedFixes();
          process.exit(0);
          return;
        }
        
        // Check for expected keys
        if (str === 'y' || str === 'n' || str === 'q' || str === 'c') {
          if (str === 'c') {
            // Don't exit raw mode for 'c' - just return it to show context
            process.stdout.write(`${str}\n`);
            resolve(str);
            return;
          }
          
          cleanupAndExit(str);
          return;
        }
      };
      
      // Set up error handler
      process.stdin.once('error', onError);
      
      // Set up keypress handler
      process.stdin.on('keypress', onKeypress);
    } catch (error) {
      // In case of any error, make sure we restore the terminal
      if (process.stdin.isTTY && process.stdin.isRaw) {
        process.stdin.setRawMode(false);
      }
      reject(error);
    }
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

// Function to check if a position is inside a JSX tag
function isInsideJsxTag(line, position) {
  // Find the last < before this position
  const lastOpenBracket = line.lastIndexOf('<', position);
  // Find the last > before this position
  const lastCloseBracket = line.lastIndexOf('>', position);
  
  // If we found an open bracket and it's after the last close bracket,
  // or if we found no close bracket, we're inside a tag
  return lastOpenBracket !== -1 && (lastCloseBracket === -1 || lastOpenBracket > lastCloseBracket);
}

// Add a direct file check function that doesn't rely on AST
function checkRawFileContent(filePath, line, column, original) {
  try {
    // Read the file directly
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const lines = fileContent.split('\n');
    
    // Get the line (if it exists)
    if (line <= 0 || line > lines.length) {
      return false;
    }
    
    const lineContent = lines[line - 1]; // Lines are 1-indexed
    
    // Check if the line already contains HTML entities
    if (lineContent.includes('&apos;') || lineContent.includes('&quot;') || 
        lineContent.includes('&lt;') || lineContent.includes('&gt;')) {
      
      // If we have the original string, generate what its escaped version would look like
      // and check if that exact escaped version exists in the file
      if (original) {
        const escapedVersion = original.replace(/'/g, '&apos;')
                                      .replace(/"/g, '&quot;')
                                      .replace(/</g, '&lt;')
                                      .replace(/>/g, '&gt;');
        
        // Look for this escaped version in the raw line content
        if (lineContent.includes(escapedVersion)) {
          return true;
        }
        
        // Also check surrounding lines in case the content spans multiple lines
        const surroundingLines = lines.slice(
          Math.max(0, line - 2),
          Math.min(lines.length, line + 2)
        ).join('\n');
        
        if (surroundingLines.includes(escapedVersion)) {
          return true;
        }
      } else {
        // If no original string provided, default to previous behavior
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error(`Error checking raw file: ${error.message}`);
    return false;
  }
}

// Check if a string is already escaped within a window of lines in the raw file
function isAlreadyEscapedInLineWindow(filePath, lineNumber, originalString) {
  try {
    // Skip if originalString doesn't have anything that needs escaping
    if (!originalString.includes("'") && !originalString.includes('"')) {
      return false;
    }
    
    // Read the raw file
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const lines = fileContent.split('\n');
    
    // Get what the escaped version would look like
    const escapedString = originalString.replace(/'/g, '&apos;')
                                      .replace(/"/g, '&quot;');
    
    // For multiline text, make a larger window
    let windowStart = Math.max(0, lineNumber - 10 - 1); // Convert to 0-based
    let windowEnd = Math.min(lines.length - 1, lineNumber + 10 - 1);
    
    // Check each line in the window
    for (let i = windowStart; i <= windowEnd; i++) {
      const line = lines[i];
      if (line.includes(escapedString)) {
        return { matched: true, confidence: 'high', reason: 'exact_match' };
      }
    }
    
    // For multiline text, check if all the apostrophes in the original appear as &apos; in the file
    if (originalString.includes("'") && originalString.includes("\n")) {
      // Count apostrophes in the original
      const apostropheCount = (originalString.match(/'/g) || []).length;
      
      // Now check the window of lines for &apos; occurrences
      const windowText = lines.slice(windowStart, windowEnd + 1).join('\n');
      const aposCount = (windowText.match(/&apos;/g) || []).length;
      
      // If we have as many or more &apos; as apostrophes in the original, 
      // plus the content is similar, it's likely already escaped
      if (aposCount >= apostropheCount) {
        // Check for similarity - strip all apostrophes from original and &apos; from window
        const strippedOriginal = originalString.replace(/'/g, '').toLowerCase();
        const strippedWindow = windowText.replace(/&apos;/g, '').toLowerCase();
        
        // If the stripped versions have significant overlap, consider it already escaped
        if (strippedWindow.includes(strippedOriginal.substring(0, 20)) && 
            strippedWindow.includes(strippedOriginal.substring(strippedOriginal.length - 20))) {
          return { matched: true, confidence: 'medium', reason: 'content_similarity' };
        }
      }
    }
    
    // Also check for exact character replacements with more context
    if (originalString.includes("'")) {
      // For each apostrophe in the original, check if the surrounding 10 chars appear with &apos; in the file
      let apostropheIndices = [];
      for (let i = 0; i < originalString.length; i++) {
        if (originalString[i] === "'") {
          apostropheIndices.push(i);
        }
      }
      
      // If all apostrophes are already escaped in context, return true
      let allEscaped = true;
      for (const idx of apostropheIndices) {
        // Get 10 chars before and after the apostrophe for context
        const before = originalString.substring(Math.max(0, idx - 10), idx);
        const after = originalString.substring(idx + 1, Math.min(originalString.length, idx + 11));
        
        // Create what this would look like with &apos;
        const contextPattern = before + '&apos;' + after;
        
        // Check if this pattern appears in the window
        const windowText = lines.slice(windowStart, windowEnd + 1).join('\n');
        if (!windowText.includes(contextPattern)) {
          allEscaped = false;
          break;
        }
      }
      
      if (allEscaped && apostropheIndices.length > 0) {
        return { matched: true, confidence: 'medium', reason: 'context_pattern' };
      }
    }
    
    return { matched: false };
  } catch (error) {
    console.error('Error checking for escaped content in window:', error);
    return { matched: false, error: error.message };
  }
}

// Add this function to prompt and wait for any key
async function waitForAnyKey(message) {
  return new Promise((resolve) => {
    if (message) {
      console.log(chalk.magenta(message));
    }
    console.log(chalk.cyan('Press any key to continue...'));
    
    // Set up to read a single keypress
    readline.emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isTTY ? process.stdin.isRaw : false;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    
    const onKeypress = (str, key) => {
      // Any key except ctrl-c will continue
      if (key && key.ctrl && key.name === 'c') {
        console.log('\nProcess interrupted.');
        process.exit(0);
      }
      
      // Clean up
      process.stdin.removeListener('keypress', onKeypress);
      if (process.stdin.isTTY && !wasRaw) {
        process.stdin.setRawMode(false);
      }
      
      console.log(''); // New line after key press
      resolve();
    };
    
    // Wait for a key
    process.stdin.once('keypress', onKeypress);
  });
}

// Add this function to check if a string is in a React prop
function isReactPropValue(path) {
  // Check if parent is a JSXAttribute
  if (path.parent && path.parent.type === 'JSXAttribute') {
    return true;
  }
  
  // Also check for JSX spread attributes with object properties
  if (path.parent && 
      path.parent.type === 'ObjectProperty' && 
      path.parentPath && 
      path.parentPath.parentPath && 
      path.parentPath.parentPath.parent && 
      path.parentPath.parentPath.parent.type === 'JSXSpreadAttribute') {
    return true;
  }
  
  return false;
}

async function processFile(filePath) {
  log(`Processing file: ${filePath}`);
  
  try {
    // Record initial file modification time
    fileModTimes[filePath] = fs.statSync(filePath).mtimeMs;
    
    // Get file size and check if it's too large
    const stats = fs.statSync(filePath);
    const MAX_FILE_SIZE = 1024 * 1024; // 1MB limit
    
    if (stats.size > MAX_FILE_SIZE) {
      log(`Skipping file ${filePath} - too large (${Math.round(stats.size / 1024)}KB)`, 'warning');
      return;
    }
    
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
      
      // Skip if nothing to escape
      if (!original.includes("'") && !original.includes('"') && 
          !original.includes('<') && !original.includes('>') && 
          !original.includes('&')) {
        return;
      }
      
      // NEW: Skip React prop values
      if (isReactPropValue(path)) {
        log(`Skipping React prop value at ${filePath}:${path.node.loc.start.line}`, 'skip');
        return;
      }
      
      // Check if already escaped in a window around the reported line
      const escapeCheckResult = isAlreadyEscapedInLineWindow(filePath, path.node.loc.start.line, original);
      if (escapeCheckResult.matched) {
        if (escapeCheckResult.confidence === 'high') {
          log(`Skipping already escaped content at ${filePath}:${path.node.loc.start.line}`, 'skip');
        } else {
          // In strict mode, inform the user but don't automatically skip
          if (strictMode) {
            // We'll use await here, and the traversal is wrapped in an async function
            stringFixes.push({
              type: 'information',
              message: `Potentially already escaped content at ${filePath}:${path.node.loc.start.line} (${escapeCheckResult.reason})`,
              original,
              loc: path.node.loc
            });
          } else {
            log(`Skipping likely escaped content at ${filePath}:${path.node.loc.start.line} (${escapeCheckResult.reason})`, 'uncertainty');
          }
        }
        return;
      }
      
      // First check raw file content for HTML entities
      if (checkRawFileContent(filePath, path.node.loc.start.line, path.node.loc.start.column, path.node.value)) {
        log(`Skipping already fixed raw content at ${filePath}:${path.node.loc.start.line}`, 'skip');
        return;
      }
      
      // Debug in strict mode
      if (strictMode && (original.startsWith('&') || original.includes('&'))) {
        console.log(chalk.green(`[STRICT] Checking string: "${original}" at ${filePath}:${path.node.loc.start.line}:${path.node.loc.start.column}`));
      }
      
      // SAFETY: Ensure this string content is safe to process
      // Get the raw line from the file for context
      const lines = fileContent.split('\n');
      const rawLine = lines[path.node.loc.start.line - 1] || '';
      
      if (!isSafeToEscapeInJsx(original, rawLine)) {
        log(`Skipping unsafe string content at ${filePath}:${path.node.loc.start.line}:${path.node.loc.start.column}`, 'skip');
        return;
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
          loc: path.node.loc,
          isJsx: false,
          type: 'fix'
        });
        
        if (strictMode && (original.startsWith('&') || original.includes('&'))) {
          console.log(chalk.green(`[STRICT] Added to fix list for prompting: "${original}"`));
        }
      }
    },
    
    // Add JSXText visitor to catch text content in JSX elements
    JSXText(path) {
      const rawValue = path.node.value;
      const original = rawValue.trim();
      
      // Skip empty text nodes
      if (!original) {
        return;
      }
      
      // Skip if nothing to escape
      if (!original.includes("'") && !original.includes('"') && 
          !original.includes('<') && !original.includes('>') && 
          !original.includes('&')) {
        return;
      }
      
      // Check if already escaped in a window around the reported line
      const escapeCheckResult = isAlreadyEscapedInLineWindow(filePath, path.node.loc.start.line, original);
      if (escapeCheckResult.matched) {
        if (escapeCheckResult.confidence === 'high') {
          log(`Skipping already escaped content at ${filePath}:${path.node.loc.start.line}`, 'skip');
        } else {
          // In strict mode, inform the user but don't automatically skip
          if (strictMode) {
            // We'll use await here, and the traversal is wrapped in an async function
            stringFixes.push({
              type: 'information',
              message: `Potentially already escaped content at ${filePath}:${path.node.loc.start.line} (${escapeCheckResult.reason})`,
              original,
              loc: path.node.loc
            });
          } else {
            log(`Skipping likely escaped content at ${filePath}:${path.node.loc.start.line} (${escapeCheckResult.reason})`, 'uncertainty');
          }
        }
        return;
      }
      
      // First check raw file content for HTML entities
      if (checkRawFileContent(filePath, path.node.loc.start.line, path.node.loc.start.column, path.node.value)) {
        log(`Skipping already fixed raw content at ${filePath}:${path.node.loc.start.line}`, 'skip');
        return;
      }
      
      // Debug in strict mode
      if (strictMode && (original.includes('&') || original.includes("'") || 
                         original.includes('"') || original.includes('<') || 
                         original.includes('>'))) {
        console.log(chalk.green(`[STRICT] Checking JSX text: "${original}" at ${filePath}:${path.node.loc.start.line}:${path.node.loc.start.column}`));
      }
      
      // Pre-check if the JSX text already contains HTML entities before doing escape conversion
      if (containsHtmlEntities(rawValue)) {
        if (verbose) {
          log(`JSX text already contains HTML entities at ${filePath}:${path.node.loc.start.line}:${path.node.loc.start.column}`, 'skip');
        }
        return;
      }
      
      // SAFETY: Ensure this JSX content is safe to process
      // Get the raw line from the file for context
      const lines = fileContent.split('\n');
      const rawLine = lines[path.node.loc.start.line - 1] || '';
      
      if (!isSafeToEscapeInJsx(original, rawLine)) {
        log(`Skipping unsafe JSX content at ${filePath}:${path.node.loc.start.line}:${path.node.loc.start.column}`, 'skip');
        return;
      }
      
      const escapeResult = escapeString(original);
      
      // Skip if no changes were made or escapeString returned the original
      if (escapeResult === original || 
          (typeof escapeResult === 'object' && escapeResult.result === original)) {
        return;
      }
      
      if (typeof escapeResult === 'object') {
        // Check if this content is already fixed in the file - be more thorough with multiline content
        if (isAlreadyFixed(fileContent, path.node.loc.start.line, path.node.loc.start.column, original, escapeResult.result)) {
          log(`Skipping already fixed JSX text at ${filePath}:${path.node.loc.start.line}:${path.node.loc.start.column}`, 'skip');
          return;
        }
        
        // Auto-skip check for JSX text
        const autoSkipResult = isAutoSkipPattern(original, filePath, path.node.loc.start.line, path.node.loc.start.column);
        if (autoSkipResult && !strictMode) {
          log(`Auto-skipping JSX text at ${filePath}:${path.node.loc.start.line}:${path.node.loc.start.column} - ${autoSkipResult.reason}`, 'skip');
          
          // Add to rejected fixes
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
        
        // Add to the list of fixes
        stringFixes.push({
          path,
          original,
          escaped: escapeResult.result,
          escapedChars: escapeResult.escapedChars,
          loc: path.node.loc,
          isJsx: true,
          rawValue,
          type: 'fix'
        });
      }
    }
  });

    const fixCount = stringFixes.length;
    if (fixCount > 0) {
      console.log(chalk.blue(`Found ${fixCount} potential fixes in ${filePath}`));
    } else {
      log(`No potential fixes in ${filePath}`, 'info');
      return;
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
    let fileLines = fileContent.split('\n');
    
    // Prompt user for each fix (in reverse order)
  for (const fix of stringFixes) {
      // Handle information-only fixes (for strict mode)
      if (fix.type === 'information') {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        console.log(chalk.magenta(fix.message));
        console.log(chalk.yellow('\nContext:'));
        console.log(getContextLines(fileContent, fix.loc.start.line, 5));
        await waitForAnyKey('');
        continue;
      }

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
        try {
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
                fileContent = fileLines.join('\n');
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
            
            // Different handling based on whether it's a JSX text node or a string literal
            if (fix.isJsx) {
              // JSX text nodes are handled differently - we need to find the text directly
              if (original.includes('\n') || fix.rawValue.includes('\n')) {
                // For multiline JSX text, we need a more careful approach
                log(`Handling multiline JSX text replacement`, 'info');
                
                // Get the raw JSX text with correct whitespace
                const rawValue = fix.rawValue;
                const lines = rawValue.split('\n');
                
                // Calculate the number of lines this JSX text spans
                const startLine = line;
                const endLine = startLine + lines.length - 1;
                
                // Process each line individually to preserve whitespace
                let succeeded = true;
                for (let i = 0; i < lines.length; i++) {
                  const currentLine = lines[i].trim();
                  if (!currentLine) continue; // Skip empty lines
                  
                  // Find this line content in the file
                  const fileLine = fileLines[startLine - 1 + i];
                  if (!fileLine) {
                    log(`Could not find line ${startLine + i} for multiline JSX text`, 'warning');
                    succeeded = false;
                    break;
                  }
                  
                  // Replace apostrophes in this line
                  if (currentLine.includes("'")) {
                    // Find all occurrences of apostrophes in this line and replace them
                    let newLine = fileLine;
                    let pos = 0;
                    while ((pos = newLine.indexOf("'", pos)) !== -1) {
                      // Safety check: Skip if this apostrophe is inside a JSX tag
                      if (isInsideJsxTag(newLine, pos)) {
                        pos++; // Skip this one, it's inside a tag
                        continue;
                      }
                      
                      // Make sure we're not already in an HTML entity
                      const context = newLine.substring(Math.max(0, pos - 5), pos);
                      if (!context.includes('&apos')) {
                        newLine = newLine.substring(0, pos) + '&apos;' + newLine.substring(pos + 1);
                        pos += 6; // Length of &apos;
                      } else {
                        pos++; // Skip this one, it's already escaped
                      }
                    }
                    
                    // Update the line
                    if (newLine !== fileLine) {
                      fileLines[startLine - 1 + i] = newLine;
      changed = true;
                    }
                  }
                }
                
                if (succeeded) {
                  log(`Replaced multiline JSX text apostrophes`, 'info');
                }
              } else {
                // Single line JSX text
                const targetLine = fileLines[line - 1]; // locations are 1-indexed
                
                // CRITICAL: Skip any line that contains JSX tags to avoid damaging them
                if (targetLine.includes('<') && targetLine.includes('>')) {
                  log(`Skipping single-line JSX with tags: ${targetLine.trim().substring(0, 50)}...`, 'skip');
                  return;
                }
                
                // Find the text in the line
                const textIndex = targetLine.indexOf(original);
                if (textIndex >= 0) {
                  // When replacing directly, only handle apostrophes and quotes to be safe
                  // Create a safe version that only replaces quotes and apostrophes
                  const safeEscaped = original.replace(/['\"]/g, c => {
                    if (c === "'") return '&apos;';
                    if (c === '"') return '&quot;';
                    return c;
                  });
                  
                  // Replace the text directly
                  const newLine = 
                    targetLine.substring(0, textIndex) + 
                    safeEscaped + 
                    targetLine.substring(textIndex + original.length);
                  
                  // Update the line in the lines array
                  fileLines[line - 1] = newLine;
                  
                  log(`Replaced JSX text with safe apostrophe/quote escaping only`, 'info');
                  changed = true;
                } else {
                  log(`Could not find JSX text "${original}" in line ${line}`, 'warning');
                }
              }
            } else {
              // Handle string literals as before
              // Get the line containing the string literal
              const targetLine = fileLines[line - 1]; // locations are 1-indexed
                  
              // Find where the actual string content starts and ends (ignoring quotes)
              // Determine which quote character is used (single or double)
              const quoteChar = targetLine[column];
              const stringStart = column + 1; // skip the opening quote
                  
              // Find where the string content ends (character before the closing quote)
              const closingQuotePos = targetLine.indexOf(quoteChar, stringStart);
                  
              if (closingQuotePos > stringStart) {
                // Extract the string content to verify it matches
                const stringContent = targetLine.substring(stringStart, closingQuotePos);
                  
                // If the extracted content matches our expected original, make the replacement
                if (stringContent === original) {
                  // Replace the string content with the escaped version
                  const newLine = 
                    targetLine.substring(0, stringStart) + 
                    escaped + 
                    targetLine.substring(closingQuotePos);
                    
                  // Update the line in the lines array
                  fileLines[line - 1] = newLine;
                  
                  log(`Replaced with precise line location`, 'info');
                  changed = true;
                } else {
                  log(`String content mismatch at ${filePath}:${line}:${column}: expected "${original}" but found "${stringContent}"`, 'warning');
                }
              }
            }
            
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
        } catch (error) {
          log(`Error handling user input: ${error.message}`, 'error');
          break;
        }
    }
  }

  if (changed) {
      try {
        // Rebuild the file content from modified lines
        fileContent = fileLines.join('\n');
        log(`Writing changes to ${filePath}...`, 'info');
        
        // Verify we don't have corrupted escapes before writing
        if (fileContent.includes('&amp;lt;') || fileContent.includes('&amp;gt;')) {
          log(`WARNING: Detected potentially corrupted escapes in ${filePath}. Skipping file.`, 'warning');
          return;
        }
        
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
  } catch (error) {
    log(`Error processing file ${filePath}: ${error.message}`, 'error');
  }
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

  // Find all matching files
  log('Finding JS/TS files in project...', 'info');
  const files = await globby(['**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx'], { gitignore: true });
  log(`Found ${files.length} files to process`, 'info');

  // Set up proper cleanup for stdin
  const cleanupStdin = () => {
    if (process.stdin.isTTY && process.stdin.isRaw) {
      process.stdin.setRawMode(false);
    }
    process.stdin.removeAllListeners();
  };

  // Handle normal exit
  process.on('exit', () => {
    cleanupStdin();
  });

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.log('\nInterrupted. Cleaning up...');
    saveRejectedFixes();
    cleanupStdin();
    process.exit(0);
  });

  // Process each file in sequence
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    log(`Processing file ${i+1}/${files.length}: ${file}`, 'info');
    
    // Process the file and handle any errors
    try {
    await processFile(file);
    } catch (error) {
      log(`Error processing ${file}: ${error.message}`, 'error');
      // Continue with next file
    }
    
    // Save rejection history after each file
    try {
      saveRejectedFixes();
    } catch (error) {
      log(`Error saving rejection history: ${error.message}`, 'error');
    }
  }
  
  log('Processing completed!', 'success');
  
  // Ensure proper cleanup
  cleanupStdin();
})().catch(error => {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
