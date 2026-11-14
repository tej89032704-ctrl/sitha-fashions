const test = require('node:test');
const assert = require('node:assert');
const db = require('../config/database');

test('database has all core tables', () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(t => t.name);
  for (const t of ['users', 'dresses', 'cart', 'orders', 'order_items', 'coupons', 'reviews', 'wishlist', 'settings', 'addresses', 'returns', 'activity_logs', 'order_tracking', 'password_resets', 'dress_images']) {
    assert.ok(tables.includes(t), `missing table: ${t}`);
  }
});

test('dresses has category index', () => {
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_dresses_category'").get();
  assert.ok(idx, 'category index missing');
});

test('users table has must_change_password column', () => {
  const col = db.prepare("PRAGMA table_info(users)").all().find(c => c.name === 'must_change_password');
  assert.ok(col, 'must_change_password column missing');
});

test('default admin exists', () => {
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
  assert.ok(admin, 'no admin user found');
});
