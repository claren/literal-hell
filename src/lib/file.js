const fs = require('fs');
const path = require('path');

// Check if a string contains HTML entities
function containsHtmlEntities(str) {
  const entityRegex = /&(quot|apos|amp|lt|gt);/g;
  const doubleEscapedRegex = /&amp;(quot|apos|lt|gt);/g;
  const numericEntityRegex = /&#(\d+);/g;
  
  return entityRegex.test(str) || doubleEscapedRegex.test(str) || numericEntityRegex.test(str);
}

// Check if a string is safe to escape in JSX context
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

// Check if a string is in a React prop
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

// Check if a file has been modified since last read
function checkFileModification(filePath, fileModTimes) {
  try {
    const currentModTime = fs.statSync(filePath).mtimeMs;
    
    if (fileModTimes[filePath] && fileModTimes[filePath] !== currentModTime) {
      return true;
    }
    
    // Update stored modification time
    fileModTimes[filePath] = currentModTime;
    return false;
  } catch (error) {
    throw new Error(`Error checking file modification: ${error.message}`);
  }
}

// Read file content with size check
function readFileWithSizeCheck(filePath, maxSize = 1024 * 1024) {
  const stats = fs.statSync(filePath);
  
  if (stats.size > maxSize) {
    throw new Error(`File too large (${Math.round(stats.size / 1024)}KB)`);
  }
  
  return fs.readFileSync(filePath, 'utf8');
}

// Write file content with verification
function writeFileWithVerification(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
  
  // Verify file was written correctly
  const newContent = fs.readFileSync(filePath, 'utf8');
  if (newContent !== content) {
    throw new Error('File verification failed after write');
  }
  
  return newContent.length;
}

module.exports = {
  containsHtmlEntities,
  isSafeToEscapeInJsx,
  isReactPropValue,
  checkFileModification,
  readFileWithSizeCheck,
  writeFileWithVerification
}; 