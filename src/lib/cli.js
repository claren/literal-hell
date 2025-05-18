const chalk = require('chalk');
const { VERSION, setVerbose, setStrictMode } = require('./config');
const { clearRejectionHistory } = require('./fixes');

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

// Parse command line arguments
function parseArgs() {
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
  const verbose = args.includes('--verbose');
  const strict = args.includes('--strict');
  
  // Set global state
  setVerbose(verbose);
  setStrictMode(strict);
  
  // Debug logging
  console.log(chalk.blue(`Running with options: ${JSON.stringify({
    verbose,
    strict,
    clearHistory
  })}`));
  
  if (strict) {
    console.log(chalk.yellow('Running in strict mode - will prompt for ALL potential fixes'));
  } else {
    console.log(chalk.blue('Running in normal mode - will auto-skip common patterns'));
  }
  
  if (clearHistory) {
    clearRejectionHistory();
  }
  
  return {
    clearHistory,
    verbose,
    strict
  };
}

module.exports = {
  showHelp,
  parseArgs
}; 