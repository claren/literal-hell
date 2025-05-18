const fs = require('fs');
const chalk = require('chalk');
const { verbose, strictMode } = require('./config');
const { log } = require('./logger');
const { getSingleKeypress, getContextLines, waitForAnyKey } = require('./ui');
const { 
  isFixRejected, 
  addRejectedFix, 
  fileModTimes,
  saveRejectedFixes 
} = require('./fixes');
const { 
  checkFileModification, 
  readFileWithSizeCheck, 
  writeFileWithVerification 
} = require('./file');
const { runESLintForEscapeErrors, convertEslintErrorsToFixes } = require('./eslint');
const { parseFile, findStringFixes } = require('./ast');
const { 
  escapeString, 
  isAlreadyEscapedInLineWindow, 
  isAutoSkipPattern 
} = require('./escape');

// Process a single file with its fixes
async function processFileFixes(filePath, fileContent, fixes) {
  log(`Processing ${fixes.length} fixes in ${filePath}`);
  
  let changed = false;
  let fileLines = fileContent.split('\n');
  
  // Sort fixes from last to first in the file to avoid position shifts
  fixes.sort((a, b) => {
    if (b.loc.start.line !== a.loc.start.line) {
      return b.loc.start.line - a.loc.start.line;
    }
    return b.loc.start.column - a.loc.start.column;
  });
  
  // Process each fix
  for (const fix of fixes) {
    // Handle information-only fixes (for strict mode)
    if (fix.type === 'information') {
      console.log(chalk.magenta(fix.message));
      console.log(chalk.yellow('\nContext:'));
      console.log(getContextLines(fileContent, fix.loc.start.line, 5));
      await waitForAnyKey('');
      continue;
    }

    const { original, escaped, escapedChars, loc } = fix;
    const { line, column } = loc.start;

    // Skip if we've already rejected this exact fix before
    if (isFixRejected(filePath, line, column, original)) {
      log(`Skipping previously rejected fix in ${filePath}:${line}:${column}`, 'skip');
      continue;
    }

    console.log(chalk.yellow(`\nIn ${filePath}:${line}:${column}`));
    console.log(chalk.yellow('\nContext:'));
    console.log(getContextLines(fileContent, line, 3));
    console.log('\nOriginal:', original);
    console.log('Escaped: ', escaped);
    console.log(chalk.cyan(`Characters to escape: ${escapedChars.map(c => `[  ${c}  ]`).join(', ')}`));

    // Loop to handle context viewing and decision
    while (true) {
      try {
        // Use single-keypress input
        const response = await getSingleKeypress('Apply fix? (y/n/q/c for more context) [y]: ');
        
        if (response === 'c') {
          // Show more context and continue the loop
          console.log(chalk.yellow('\nMore context:'));
          console.log(getContextLines(fileContent, line, 7));
          console.log(''); // Empty line for readability
          continue;
        }
        
        // Check if file has been modified externally
        if (checkFileModification(filePath, fileModTimes)) {
          log(`File ${filePath} was modified externally. Aborting processing of this file.`, 'warning');
          break;
        }
        
        if (response === 'q') {
          // Save any changes that have been applied so far
          if (changed) {
            try {
              fileContent = fileLines.join('\n');
              writeFileWithVerification(filePath, fileContent);
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
              log(`Handling multiline JSX text replacement for: "${original}"`, 'info');
              
              // Get the raw JSX text with correct whitespace
              const rawValue = fix.rawValue; // e.g., "\n    text with "quotes"\n  "
              const originalTrimmed = fix.original; // e.g., "text with \"quotes\""
              const escapedTrimmed = fix.escaped; // e.g., "text with &quot;quotes&quot;"

              const astStartLine = fix.loc.start.line; // 1-indexed
              const astEndLine = fix.loc.end.line;     // 1-indexed
              const astStartCol = fix.loc.start.column; // 0-indexed, start of rawValue
              const astEndCol = fix.loc.end.column;   // 0-indexed, end of rawValue

              // Find the starting line and column of the *originalTrimmed* text within the rawValue
              let currentLineOffset = 0;
              let startLineOfOriginalInRaw = -1;
              let startColOfOriginalInRaw = -1;

              const rawValueLines = rawValue.split('\n');
              for (let i = 0; i < rawValueLines.length; i++) {
                const lineOfRaw = rawValueLines[i];
                const indexOfOriginalInLine = lineOfRaw.indexOf(originalTrimmed);
                if (indexOfOriginalInLine !== -1) {
                  startLineOfOriginalInRaw = i;
                  startColOfOriginalInRaw = indexOfOriginalInLine;
                  break;
                }
              }

              if (startLineOfOriginalInRaw === -1) {
                log(`Could not find trimmed original ("${originalTrimmed}") within rawValue ("${rawValue}"). Skipping.`, 'warning');
                break; // from while(true) - skip this fix
              }
              
              // The actual line in the file where originalTrimmed starts
              const targetFileLineIndex = astStartLine -1 + startLineOfOriginalInRaw;
              // The actual column in that file line where originalTrimmed starts
              const targetFileColumnIndex = (startLineOfOriginalInRaw === 0) ? astStartCol + startColOfOriginalInRaw : startColOfOriginalInRaw;

              // Ensure the target line actually contains the start of the originalTrimmed text
              const lineToModify = fileLines[targetFileLineIndex];
              if (!lineToModify || !lineToModify.includes(originalTrimmed.split('\n')[0])) {
                  log(`Multiline sanity check failed: target line does not seem to contain the start of "${originalTrimmed.split('\n')[0]}". Skipping.`, 'warning');
                  break; // from while(true) - skip this fix
              }

              // At this point, we assume originalTrimmed is single-line for this replacement strategy,
              // even if rawValue is multi-line. This simplification is based on current problem.
              // If originalTrimmed itself could be multi-line, this logic would need to be more complex.
              const beforeText = lineToModify.substring(0, targetFileColumnIndex);
              const afterText = lineToModify.substring(targetFileColumnIndex + originalTrimmed.length);
              
              fileLines[targetFileLineIndex] = beforeText + escapedTrimmed + afterText;
              changed = true;
              log(`Replaced multiline-rawValue JSX: "${originalTrimmed}" with "${escapedTrimmed}"`, 'info');

            } else {
              // Single line JSX text
              const targetLine = fileLines[line - 1]; // line is fix.loc.start.line
              
              // CRITICAL: Skip any line that contains JSX tags to avoid damaging them
              if (targetLine.includes('<') && targetLine.includes('>')) {
                log(`Skipping single-line JSX with tags: ${targetLine.trim().substring(0, 50)}...`, 'skip');
                return { changed: false }; // User has this as return, this will exit processFile for this file
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
          addRejectedFix(filePath, line, column, original);
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
        return { changed: false };
      }
      
      writeFileWithVerification(filePath, fileContent);
      log(`✓ Successfully saved: ${filePath}`, 'success');
      return { changed: true };
    } catch (error) {
      log(`Error saving file: ${error.message}`, 'error');
      return { changed: false };
    }
  } else if (fixes.length > 0) {
    log(`No changes made to ${filePath}`, 'info');
    return { changed: false };
  }
  return { changed: false };
}

// Process all files
async function processFiles(filePaths) {
  let allFixes = [];
  let totalFixesApplied = 0;
  
  // Use ESLint to find errors
  try {
    const escapeErrors = await runESLintForEscapeErrors(filePaths, verbose);
    if (escapeErrors.length > 0) {
      // Group errors by file
      const errorsByFile = escapeErrors.reduce((acc, error) => {
        if (!acc[error.filePath]) {
          acc[error.filePath] = [];
        }
        acc[error.filePath].push(error);
        return acc;
      }, {});
      
      // Process each file's errors
      for (const [filePath, errors] of Object.entries(errorsByFile)) {
        try {
          const fileContent = readFileWithSizeCheck(filePath);
          const fixes = convertEslintErrorsToFixes(errors, fileContent);
          if (fixes.length > 0) {
            allFixes.push({ filePath, fileContent, fixes });
          }
        } catch (error) {
          log(`Error reading file ${filePath}: ${error.message}`, 'error');
        }
      }
      log(`Found ${escapeErrors.length} unescaped entities via ESLint`, 'info');
    } else {
      log('No unescaped entities found by ESLint', 'info');
    }
  } catch (error) {
    log(`ESLint check failed: ${error.message}`, 'error');
    if (verbose) {
      console.error(error);
    }
    return; // Exit if ESLint fails - we don't want to proceed without it
  }
  
  // Process each file's fixes
  for (const { filePath, fileContent, fixes } of allFixes) {
    try {
      const result = await processFileFixes(filePath, fileContent, fixes);
      if (result && result.changed) {
        totalFixesApplied++;
      }
    } catch (error) {
      log(`Error processing fixes in ${filePath}: ${error.message}`, 'error');
    }
  }

  // Show completion message
  if (totalFixesApplied > 0) {
    log(`\n✓ Successfully applied ${totalFixesApplied} fixes`, 'success');
  } else if (allFixes.length > 0) {
    log('\nNo fixes were applied', 'info');
  }
  
  // Save any pending rejected fixes before exiting
  saveRejectedFixes();
  process.exit(0);
}

module.exports = {
  processFiles
}; 