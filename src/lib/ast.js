const babelParser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { containsHtmlEntities, isSafeToEscapeInJsx, isReactPropValue } = require('./file');

// Parse file content into AST
function parseFile(fileContent) {
  try {
    return babelParser.parse(fileContent, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      errorRecovery: true,
      locations: true,
    });
  } catch (error) {
    throw new Error(`Error parsing file: ${error.message}`);
  }
}

// Find string literals and JSX text nodes that need escaping
function findStringFixes(ast, filePath, fileContent, strictMode = false) {
  const stringFixes = [];
  const lines = fileContent.split('\n');

  traverse(ast, {
    StringLiteral(path) {
      const original = path.node.value;
      
      // Skip if nothing to escape
      if (!original.includes("'") && !original.includes('"') && 
          !original.includes('<') && !original.includes('>') && 
          !original.includes('&')) {
        return;
      }
      
      // Skip React prop values
      if (isReactPropValue(path)) {
        return;
      }
      
      // Get the raw line for context
      const rawLine = lines[path.node.loc.start.line - 1] || '';
      
      // Skip if already contains HTML entities
      if (containsHtmlEntities(rawLine)) {
        return;
      }
      
      // Skip if unsafe to escape
      if (!isSafeToEscapeInJsx(original, rawLine)) {
        return;
      }
      
      // Create escaped version
      const escaped = original.replace(/['"]/g, c => c === "'" ? '&apos;' : '&quot;');
      
      // Skip if no changes needed
      if (escaped === original) {
        return;
      }
      
      // Add to fixes
      stringFixes.push({
        type: 'fix',
        path,
        original,
        escaped,
        escapedChars: [...new Set(original.match(/['"]/g) || [])],
        loc: path.node.loc,
        isJsx: false
      });
    },
    
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
      
      // Skip if already contains HTML entities
      if (containsHtmlEntities(rawValue)) {
        return;
      }
      
      // Get the raw line for context
      const rawLine = lines[path.node.loc.start.line - 1] || '';
      
      // Skip if unsafe to escape
      if (!isSafeToEscapeInJsx(original, rawLine)) {
        return;
      }
      
      // Create escaped version
      const escaped = original.replace(/['"]/g, c => c === "'" ? '&apos;' : '&quot;');
      
      // Skip if no changes needed
      if (escaped === original) {
        return;
      }
      
      // Add to fixes
      stringFixes.push({
        type: 'fix',
        path,
        original,
        escaped,
        escapedChars: [...new Set(original.match(/['"]/g) || [])],
        loc: path.node.loc,
        isJsx: true,
        rawValue
      });
    }
  });

  return stringFixes;
}

module.exports = {
  parseFile,
  findStringFixes
}; 