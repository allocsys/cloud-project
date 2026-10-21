// Tests for error handling utilities (lib/server/errors.js)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const errors = await import('@/lib/server/errors');

const {
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
  isAppError,
  formatError
} = errors;

describe('AppError class', () => {
  test('AppError has correct default properties', () => {
    const error = new AppError('Test error');
    assert.equal(error.message, 'Test error');
    assert.equal(error.status, 500);
    assert.equal(error.field, null);
    assert.equal(error.details, null);
    assert.equal(error.isAppError, true);
    assert.equal(error.name, 'AppError');
    assert.ok(error.timestamp, 'Should have timestamp');
  });

  test('AppError with all properties', () => {
    const details = { key: 'value' };
    const error = new AppError('Test error', 400, 'testField', details);
    assert.equal(error.message, 'Test error');
    assert.equal(error.status, 400);
    assert.equal(error.field, 'testField');
    assert.deepEqual(error.details, details);
    assert.equal(error.isAppError, true);
  });

  test('AppError.toJSON returns correct format', () => {
    const error = new AppError('Test error', 400, 'testField', { detail: 'test' });
    const json = error.toJSON();
    
    assert.equal(json.ok, false);
    assert.equal(json.error, 'Test error');
    assert.equal(json.field, 'testField');
    assert.deepEqual(json.details, { detail: 'test' });
    assert.ok(json.timestamp, 'Should have timestamp');
  });

  test('AppError.toResponse returns NextResponse', async () => {
    const error = new AppError('Test error', 400, 'testField');
    const response = await error.toResponse();
    
    assert.ok(response, 'Should return a response');
    assert.equal(response.status, 400);
  });

  test('AppError with no message', () => {
    const error = new AppError();
    assert.equal(error.message, '');
    assert.equal(error.status, 500);
  });
});

describe('ValidationError class', () => {
  test('ValidationError extends AppError', () => {
    const error = new ValidationError('Invalid input', 'email');
    assert.ok(error instanceof AppError);
    assert.equal(error.status, 422);
    assert.equal(error.name, 'ValidationError');
    assert.equal(error.field, 'email');
  });

  test('ValidationError with no field', () => {
    const error = new ValidationError('Invalid input');
    assert.equal(error.field, null);
  });
});

describe('AuthenticationError class', () => {
  test('AuthenticationError has 401 status', () => {
    const error = new AuthenticationError();
    assert.equal(error.status, 401);
    assert.equal(error.name, 'AuthenticationError');
  });

  test('AuthenticationError with custom message', () => {
    const error = new AuthenticationError('Custom auth error');
    assert.equal(error.message, 'Custom auth error');
    assert.equal(error.status, 401);
  });
});

describe('AuthorizationError class', () => {
  test('AuthorizationError has 403 status', () => {
    const error = new AuthorizationError();
    assert.equal(error.status, 403);
    assert.equal(error.name, 'AuthorizationError');
  });
});

describe('NotFoundError class', () => {
  test('NotFoundError has 404 status with resource info', () => {
    const error = new NotFoundError('User not found', 'user', '123');
    assert.equal(error.status, 404);
    assert.equal(error.name, 'NotFoundError');
    assert.equal(error.message, 'User not found');
    assert.deepEqual(error.details, { resourceType: 'user', resourceId: '123' });
  });

  test('NotFoundError with no resource info', () => {
    const error = new NotFoundError('Not found');
    assert.equal(error.status, 404);
    // details is null when no resourceType or resourceId is provided
    assert.equal(error.details, null);
  });
});

describe('ConflictError class', () => {
  test('ConflictError has 409 status', () => {
    const error = new ConflictError('Already exists', 'email');
    assert.equal(error.status, 409);
    assert.equal(error.name, 'ConflictError');
    assert.equal(error.field, 'email');
  });
});

describe('RateLimitError class', () => {
  test('RateLimitError has 429 status with retryAfter', () => {
    const error = new RateLimitError('Too many requests', 60);
    assert.equal(error.status, 429);
    assert.equal(error.name, 'RateLimitError');
    assert.equal(error.retryAfter, 60);
    assert.equal(error.details.retryAfter, 60);
  });

  test('RateLimitError with no retryAfter', () => {
    const error = new RateLimitError('Too many requests');
    assert.equal(error.retryAfter, null);
  });
});

describe('ServiceUnavailableError class', () => {
  test('ServiceUnavailableError has 503 status', () => {
    const error = new ServiceUnavailableError('Service down', 30);
    assert.equal(error.status, 503);
    assert.equal(error.name, 'ServiceUnavailableError');
    assert.equal(error.retryAfter, 30);
  });
});

describe('BadRequestError class', () => {
  test('BadRequestError has 400 status', () => {
    const error = new BadRequestError('Bad request', 'query');
    assert.equal(error.status, 400);
    assert.equal(error.name, 'BadRequestError');
    assert.equal(error.field, 'query');
  });
});

describe('Helper functions', () => {
  test('validationError creates ValidationError', () => {
    const error = validationError('email', 'Invalid email');
    assert.ok(error instanceof ValidationError);
    assert.equal(error.field, 'email');
    assert.equal(error.message, 'Invalid email');
  });

  test('notFoundError creates NotFoundError', () => {
    const error = notFoundError('user', '123');
    assert.ok(error instanceof NotFoundError);
    assert.equal(error.details.resourceType, 'user');
    assert.equal(error.details.resourceId, '123');
  });

  test('conflictError creates ConflictError', () => {
    const error = conflictError('Already exists', 'email');
    assert.ok(error instanceof ConflictError);
    assert.equal(error.message, 'Already exists');
    assert.equal(error.field, 'email');
  });

  test('unauthorizedError creates AuthenticationError', () => {
    const error = unauthorizedError('Sign in required');
    assert.ok(error instanceof AuthenticationError);
    assert.equal(error.message, 'Sign in required');
  });

  test('forbiddenError creates AuthorizationError', () => {
    const error = forbiddenError('Access denied');
    assert.ok(error instanceof AuthorizationError);
    assert.equal(error.message, 'Access denied');
  });
});

describe('Utility functions', () => {
  test('isAppError identifies AppError instances', () => {
    assert.equal(isAppError(new AppError('test')), true);
    assert.equal(isAppError(new ValidationError('test')), true);
    assert.equal(isAppError(new AuthenticationError()), true);
    assert.equal(isAppError(new Error('test')), false);
    assert.equal(isAppError(null), false);
    assert.equal(isAppError(undefined), false);
    assert.equal(isAppError({}), false);
    assert.equal(isAppError('string'), false);
    assert.equal(isAppError([]), false);
  });

  test('formatError formats AppError correctly', () => {
    const error = new AppError('Test error', 400, 'field', { detail: 'value' });
    const formatted = formatError(error);
    
    assert.equal(formatted.name, 'AppError');
    assert.equal(formatted.message, 'Test error');
    assert.equal(formatted.status, 400);
    assert.equal(formatted.field, 'field');
    assert.deepEqual(formatted.details, { detail: 'value' });
    assert.ok(formatted.timestamp);
  });

  test('formatError formats non-AppError correctly', () => {
    const error = new Error('Regular error');
    const formatted = formatError(error);
    
    assert.equal(formatted.name, 'Error');
    assert.equal(formatted.message, 'Regular error');
    assert.ok(formatted.timestamp);
  });

  test('formatError handles null', () => {
    const formatted = formatError(null);
    assert.deepEqual(formatted, {});
  });
  
  test('formatError handles undefined', () => {
    const formatted = formatError(undefined);
    assert.deepEqual(formatted, {});
  });
});

describe('Error serialization', () => {
  test('All error types can be serialized to JSON', () => {
    const errorTypes = [
      new AppError('test'),
      new ValidationError('test', 'field'),
      new AuthenticationError(),
      new AuthorizationError(),
      new NotFoundError('test', 'type', 'id'),
      new ConflictError('test', 'field'),
      new RateLimitError('test', 60),
      new ServiceUnavailableError('test', 30),
      new BadRequestError('test', 'field')
    ];
    
    for (const error of errorTypes) {
      const json = error.toJSON();
      assert.ok(json.ok === false, `${error.name} should have ok: false`);
      assert.ok(json.error, `${error.name} should have error message`);
      assert.ok(json.timestamp, `${error.name} should have timestamp`);
    }
  });
});
