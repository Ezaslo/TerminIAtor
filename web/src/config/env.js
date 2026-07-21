const path = require('path');

function parseInteger(value, fallback) {
  const parsedValue = Number.parseInt(value, 10);

  return Number.isNaN(parsedValue)
    ? fallback
    : parsedValue;
}

const config = {
  environment: process.env.NODE_ENV || 'development',

  port: parseInteger(process.env.PORT, 3000),

  terraform: {
    command: process.env.TERRAFORM_COMMAND || 'terraform',
    rootDirectory: path.resolve(__dirname, '../../..'),
  },

  sessions: {
    defaultDurationHours: parseInteger(
      process.env.DEFAULT_SESSION_DURATION_HOURS,
      2
    ),

    maxDurationHours: parseInteger(
      process.env.MAX_SESSION_DURATION_HOURS,
      4
    ),

    maxConcurrentSessions: parseInteger(
      process.env.MAX_CONCURRENT_SESSIONS,
      2
    ),
  },
};

module.exports = config;