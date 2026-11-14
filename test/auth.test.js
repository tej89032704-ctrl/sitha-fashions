const test = require('node:test');
const assert = require('node:assert');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const { generateToken, verifyToken } = require('../middleware/auth');

test('generateToken creates valid token', () => {
  const token = generateToken({ id: 1, email: 'a@b.com', role: 'admin', name: 'Test' });
  assert.ok(typeof token === 'string' && token.length > 20);
});

test('verifyToken decodes payload', () => {
  const token = generateToken({ id: 42, email: 'x@y.com', role: 'customer', name: 'X' });
  const decoded = verifyToken(token);
  assert.strictEqual(decoded.id, 42);
  assert.strictEqual(decoded.role, 'customer');
});

test('verifyToken returns null for invalid token', () => {
  assert.strictEqual(verifyToken('not-a-token'), null);
});

test('cookie options are not secure in development', () => {
  process.env.NODE_ENV = 'development';
  delete require.cache[require.resolve('../middleware/auth')];
  const { COOKIE_OPTIONS } = require('../middleware/auth');
  assert.strictEqual(COOKIE_OPTIONS.secure, false);
});
