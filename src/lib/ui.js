const chalk = require('chalk');
const readline = require('readline');

// Get context lines around a specific line
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

// Wait for any key press
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

// Clean up stdin
function cleanupStdin() {
  if (process.stdin.isTTY && process.stdin.isRaw) {
    process.stdin.setRawMode(false);
  }
  process.stdin.removeAllListeners();
}

module.exports = {
  getContextLines,
  getSingleKeypress,
  waitForAnyKey,
  cleanupStdin
}; 