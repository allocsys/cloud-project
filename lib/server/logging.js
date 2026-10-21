// Centralized logging utilities with request IDs and structured output.
// Provides consistent logging format across the application.

import { randomUUID } from 'node:crypto';

// Log levels
const LOG_LEVELS = {
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
  TRACE: 'trace'
};

// Context storage for request-scoped data (using async hooks)
const contextStorage = new Map();

/**
 * Generate a unique request ID
 * @returns {string} Request ID
 */
export function generateRequestId() {
  return randomUUID();
}

/**
 * Set request ID for current context
 * @param {string} requestId - Request ID to set
 */
export function setRequestId(requestId) {
  contextStorage.set('requestId', requestId);
}

/**
 * Get request ID for current context
 * @returns {string|null} Request ID or null
 */
export function getRequestId() {
  return contextStorage.get('requestId') || null;
}

/**
 * Set user ID for current context
 * @param {string} userId - User ID to set
 */
export function setUserId(userId) {
  contextStorage.set('userId', userId);
}

/**
 * Get user ID for current context
 * @returns {string|null} User ID or null
 */
export function getUserId() {
  return contextStorage.get('userId') || null;
}

/**
 * Set additional context value
 * @param {string} key - Context key
 * @param {*} value - Context value
 */
export function setContext(key, value) {
  contextStorage.set(key, value);
}

/**
 * Get context value
 * @param {string} key - Context key
 * @returns {*} Context value or null
 */
export function getContext(key) {
  return contextStorage.get(key) || null;
}

/**
 * Clear current context
 */
export function clearContext() {
  contextStorage.clear();
}

/**
 * Get current log level from environment
 * @returns {string} Current log level
 */
export function getLogLevel() {
  return process.env.LOG_LEVEL || LOG_LEVELS.INFO;
}

/**
 * Check if a log level should be logged
 * @param {string} level - Log level to check
 * @returns {boolean} True if should log
 */
export function shouldLog(level) {
  const levels = [LOG_LEVELS.ERROR, LOG_LEVELS.WARN, LOG_LEVELS.INFO, LOG_LEVELS.DEBUG, LOG_LEVELS.TRACE];
  const currentLevel = getLogLevel();
  const currentIndex = levels.indexOf(currentLevel);
  const levelIndex = levels.indexOf(level);
  return levelIndex <= currentIndex;
}

/**
 * Format log message with context
 * @param {string} level - Log level
 * @param {string} message - Log message
 * @param {Object} meta - Additional metadata
 * @returns {string} Formatted log message
 */
export function formatLog(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const requestId = getRequestId();
  const userId = getUserId();
  
  const logEntry = {
    timestamp,
    level,
    message,
    ...(requestId && { requestId }),
    ...(userId && { userId }),
    ...(meta && typeof meta === 'object' ? meta : {})
  };
  
  // Remove sensitive fields
  const sanitized = sanitizeLogEntry(logEntry);
  
  // Format as JSON for structured logging
  return JSON.stringify(sanitized);
}

/**
 * Sanitize log entry by removing sensitive fields
 * @param {Object} entry - Log entry to sanitize
 * @returns {Object} Sanitized log entry
 */
export function sanitizeLogEntry(entry) {
  // Handle non-object values
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return {};
  }
  
  const sensitiveFields = ['password', 'token', 'secret', 'authorization', 'cookie', 'api_key', 'apikey'];
  const sanitized = { ...entry };
  
  for (const field of sensitiveFields) {
    if (field in sanitized) {
      sanitized[field] = '[REDACTED]';
    }
  }
  
  // Also sanitize nested objects
  for (const key in sanitized) {
    if (sanitized[key] && typeof sanitized[key] === 'object' && !Array.isArray(sanitized[key])) {
      sanitized[key] = sanitizeLogEntry(sanitized[key]);
    }
  }
  
  return sanitized;
}

/**
 * Base logger function
 * @param {string} level - Log level
 * @param {string} message - Log message
 * @param {Object} meta - Additional metadata
 */
export function log(level, message, meta = {}) {
  if (!shouldLog(level)) return;
  
  const formatted = formatLog(level, message, meta);
  
  // Output to console based on level
  switch (level) {
    case LOG_LEVELS.ERROR:
      console.error(formatted);
      break;
    case LOG_LEVELS.WARN:
      console.warn(formatted);
      break;
    case LOG_LEVELS.INFO:
      console.info(formatted);
      break;
    case LOG_LEVELS.DEBUG:
    case LOG_LEVELS.TRACE:
      console.debug(formatted);
      break;
    default:
      console.log(formatted);
  }
}

/**
 * Error level log
 * @param {string} message - Error message
 * @param {Object} meta - Additional metadata
 */
export function error(message, meta = {}) {
  log(LOG_LEVELS.ERROR, message, meta);
}

/**
 * Warn level log
 * @param {string} message - Warning message
 * @param {Object} meta - Additional metadata
 */
export function warn(message, meta = {}) {
  log(LOG_LEVELS.WARN, message, meta);
}

/**
 * Info level log
 * @param {string} message - Info message
 * @param {Object} meta - Additional metadata
 */
export function info(message, meta = {}) {
  log(LOG_LEVELS.INFO, message, meta);
}

/**
 * Debug level log
 * @param {string} message - Debug message
 * @param {Object} meta - Additional metadata
 */
export function debug(message, meta = {}) {
  log(LOG_LEVELS.DEBUG, message, meta);
}

/**
 * Trace level log
 * @param {string} message - Trace message
 * @param {Object} meta - Additional metadata
 */
export function trace(message, meta = {}) {
  log(LOG_LEVELS.TRACE, message, meta);
}

/**
 * Log database query with timing
 * @param {string} query - SQL query
 * @param {Array} params - Query parameters
 * @param {number} duration - Query duration in ms
 */
export function logQuery(query, params = [], duration) {
  if (!shouldLog(LOG_LEVELS.DEBUG)) return;
  
  debug('Database query', {
    query: sanitizeQuery(query),
    params: params.length > 0 ? '[REDACTED]' : undefined,
    durationMs: duration
  });
}

/**
 * Sanitize SQL query for logging
 * @param {string} query - SQL query to sanitize
 * @returns {string} Sanitized query
 */
export function sanitizeQuery(query) {
  // Remove newlines and extra spaces for cleaner logging
  return query.replace(/\s+/g, ' ').trim();
}

/**
 * Create a logger with predefined context
 * @param {Object} context - Default context for all logs
 * @returns {Object} Logger with context
 */
export function createLogger(context = {}) {
  return {
    error: (message, meta = {}) => error(message, { ...context, ...meta }),
    warn: (message, meta = {}) => warn(message, { ...context, ...meta }),
    info: (message, meta = {}) => info(message, { ...context, ...meta }),
    debug: (message, meta = {}) => debug(message, { ...context, ...meta }),
    trace: (message, meta = {}) => trace(message, { ...context, ...meta }),
    child: (additionalContext) => createLogger({ ...context, ...additionalContext })
  };
}

/**
 * Middleware to add request ID to each request
 * @returns {Function} Next.js middleware
 */
export function requestIdMiddleware() {
  return async function middleware(req) {
    const requestId = generateRequestId();
    setRequestId(requestId);
    
    // Add request ID to response headers
    const response = await fetch(req);
    response.headers.set('X-Request-ID', requestId);
    
    // Clear context after request
    clearContext();
    
    return response;
  };
}

/**
 * Next.js route handler wrapper with request ID and logging
 * @param {Function} handler - Route handler
 * @returns {Function} Wrapped handler
 */
export function withLogging(handler) {
  return async function wrappedHandler(req, ...args) {
    const requestId = generateRequestId();
    const startTime = Date.now();
    
    setRequestId(requestId);
    
    // Extract user ID from request if available
    try {
      const userId = req.user?.id || req.cookies?.get('opus_session')?.value || 'anonymous';
      setUserId(userId);
    } catch (e) {
      // Ignore errors in user extraction
    }
    
    try {
      const result = await handler(req, ...args);
      
      const duration = Date.now() - startTime;
      info('Request completed', {
        method: req.method,
        path: req.nextUrl?.pathname || req.url,
        status: result?.status || 200,
        durationMs: duration
      });
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      error('Request failed', {
        method: req.method,
        path: req.nextUrl?.pathname || req.url,
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        durationMs: duration
      });
      
      throw error;
    } finally {
      clearContext();
    }
  };
}

/**
 * Log an API response
 * @param {Response} response - Response object
 * @param {Object} context - Additional context
 */
export function logResponse(response, context = {}) {
  if (!shouldLog(LOG_LEVELS.DEBUG)) return;
  
  debug('API response', {
    status: response.status,
    statusText: response.statusText,
    ...context
  });
}

export default {
  LOG_LEVELS,
  generateRequestId,
  setRequestId,
  getRequestId,
  setUserId,
  getUserId,
  setContext,
  getContext,
  clearContext,
  getLogLevel,
  shouldLog,
  formatLog,
  sanitizeLogEntry,
  log,
  error,
  warn,
  info,
  debug,
  trace,
  logQuery,
  sanitizeQuery,
  createLogger,
  requestIdMiddleware,
  withLogging,
  logResponse
};
