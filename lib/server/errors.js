// Centralized error handling utilities for the application.
// Provides consistent error types, HTTP error responses, and error logging.

/**
 * Application error with status code and field information
 * Used for validation errors and business logic errors
 */
export class AppError extends Error {
  /**
   * @param {string} message - Error message
   * @param {number} status - HTTP status code
   * @param {string|null} field - Field name for validation errors
   * @param {Object|null} details - Additional error details
   */
  constructor(message, status = 500, field = null, details = null) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.field = field;
    this.details = details;
    this.isAppError = true;
    this.timestamp = new Date().toISOString();
    
    // Capture stack trace
    Error.captureStackTrace(this, AppError);
  }
  
  /**
   * Convert to JSON for API responses
   * @returns {Object} Error response object
   */
  toJSON() {
    return {
      ok: false,
      error: this.message,
      ...(this.field && { field: this.field }),
      ...(this.details && { details: this.details }),
      timestamp: this.timestamp
    };
  }
  
  /**
   * Convert to NextResponse for Next.js route handlers
   * @param {Object} headers - Additional headers
   * @returns {NextResponse} Next.js response
   */
  async toResponse(headers = {}) {
    // Import dynamically to avoid circular dependencies and ES module issues
    const { NextResponse } = await import('next/server');
    return NextResponse.json(this.toJSON(), {
      status: this.status,
      headers: {
        'Cache-Control': 'no-store',
        ...headers
      }
    });
  }
}

/**
 * Validation error for input validation failures
 */
export class ValidationError extends AppError {
  constructor(message, field = null, details = null) {
    super(message, 422, field, details);
    this.name = 'ValidationError';
  }
}

/**
 * Authentication error for unauthorized access
 */
export class AuthenticationError extends AppError {
  constructor(message = 'Sign in required.', details = null) {
    super(message, 401, null, details);
    this.name = 'AuthenticationError';
  }
}

/**
 * Authorization error for forbidden access
 */
export class AuthorizationError extends AppError {
  constructor(message = 'Access denied.', details = null) {
    super(message, 403, null, details);
    this.name = 'AuthorizationError';
  }
}

/**
 * Not found error for missing resources
 */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found.', resourceType = null, resourceId = null) {
    // Only set details if at least one resource field is provided
    const details = (resourceType !== null || resourceId !== null) 
      ? { resourceType, resourceId }
      : null;
    super(message, 404, null, details);
    this.name = 'NotFoundError';
  }
}

/**
 * Conflict error for duplicate resources
 */
export class ConflictError extends AppError {
  constructor(message, field = null, details = null) {
    super(message, 409, field, details);
    this.name = 'ConflictError';
  }
}

/**
 * Rate limit error for too many requests
 */
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests.', retryAfter = null) {
    super(message, 429, null, { retryAfter });
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
  
  toResponse(headers = {}) {
    const responseHeaders = {
      ...headers,
      'Retry-After': this.retryAfter ? String(this.retryAfter) : undefined
    };
    return super.toResponse(responseHeaders);
  }
}

/**
 * Service unavailable error
 */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable.', retryAfter = null) {
    super(message, 503, null, { retryAfter });
    this.name = 'ServiceUnavailableError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Bad request error
 */
export class BadRequestError extends AppError {
  constructor(message, field = null, details = null) {
    super(message, 400, field, details);
    this.name = 'BadRequestError';
  }
}

/**
 * Helper to create validation error responses
 * @param {string} field - Field name
 * @param {string} message - Error message
 * @returns {AppError} Validation error
 */
export function validationError(field, message) {
  return new ValidationError(message, field);
}

/**
 * Helper to create not found error responses
 * @param {string} resourceType - Type of resource
 * @param {string} resourceId - Resource identifier
 * @returns {AppError} Not found error
 */
export function notFoundError(resourceType, resourceId) {
  return new NotFoundError(`${resourceType} not found.`, resourceType, resourceId);
}

/**
 * Helper to create conflict error responses
 * @param {string} message - Error message
 * @param {string} field - Field name
 * @returns {AppError} Conflict error
 */
export function conflictError(message, field = null) {
  return new ConflictError(message, field);
}

/**
 * Helper to create unauthorized error responses
 * @param {string} message - Error message
 * @returns {AppError} Authentication error
 */
export function unauthorizedError(message = 'Sign in required.') {
  return new AuthenticationError(message);
}

/**
 * Helper to create forbidden error responses
 * @param {string} message - Error message
 * @returns {AppError} Authorization error
 */
export function forbiddenError(message = 'Access denied.') {
  return new AuthorizationError(message);
}

/**
 * Error handler middleware for Next.js route handlers
 * @param {Function} handler - Route handler function
 * @returns {Function} Wrapped handler with error handling
 */
export function errorHandler(handler) {
  return async function wrappedHandler(...args) {
    try {
      return await handler(...args);
    } catch (error) {
      // Log the error
      console.error('[error]', {
        message: error.message,
        stack: error.stack,
        name: error.name,
        timestamp: new Date().toISOString()
      });
      
      // Handle known error types
      if (error.isAppError) {
        return error.toResponse();
      }
      
      // Handle database errors
      if (error.code && error.code.startsWith('23')) {
        // PostgreSQL integrity constraint violation
        return new ConflictError('Database constraint violation.').toResponse();
      }
      
      // Handle JWT errors
      if (error.name === 'JsonWebTokenError') {
        return new AuthenticationError('Invalid token.').toResponse();
      }
      
      // Handle generic errors
      const status = error.status || error.statusCode || 500;
      const message = process.env.NODE_ENV === 'development' 
        ? error.message 
        : 'An unexpected error occurred.';
      
      return new AppError(message, status).toResponse();
    }
  };
}

/**
 * Format error for logging
 * @param {Error} error - Error to format
 * @returns {Object} Formatted error object
 */
export function formatError(error) {
  if (!error) {
    return {};
  }
  
  if (error.isAppError) {
    return {
      name: error.name,
      message: error.message,
      status: error.status,
      field: error.field,
      details: error.details,
      timestamp: error.timestamp
    };
  }
  
  return {
    name: error.name,
    message: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    timestamp: new Date().toISOString()
  };
}

/**
 * Check if error is an AppError
 * @param {Error} error - Error to check
 * @returns {boolean} True if AppError
 */
export function isAppError(error) {
  return error && typeof error === 'object' && error.isAppError === true;
}

export default {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ServiceUnavailableError,
  BadRequestError,
  validationError,
  notFoundError,
  conflictError,
  unauthorizedError,
  forbiddenError,
  errorHandler,
  formatError,
  isAppError
};
