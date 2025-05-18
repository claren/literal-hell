const { ESCAPES, strictMode } = require('./config');
const { containsHtmlEntities, isSafeToEscapeInJsx } = require('./file');

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

// Escape a string and return both the escaped version and the characters that were escaped
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

// Check if a string is already escaped within a window of lines
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
    
    return { matched: false };
  } catch (error) {
    console.error('Error checking for escaped content in window:', error);
    return { matched: false, error: error.message };
  }
}

// Check for auto-skip patterns
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
  
  return false;
}

module.exports = {
  shouldExcludeFromEscaping,
  escapeString,
  isAlreadyEscapedInLineWindow,
  isAutoSkipPattern
}; 