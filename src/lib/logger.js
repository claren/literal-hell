const chalk = require('chalk');

// Log levels and their colors
const LOG_LEVELS = {
  info: chalk.blue,
  error: chalk.red,
  warning: chalk.yellow,
  success: chalk.green,
  skip: chalk.gray
};

// Log a message with optional level
function log(message, level = 'info') {
  const color = LOG_LEVELS[level] || chalk.white;
  console.log(color(message));
}

module.exports = {
  log
}; 