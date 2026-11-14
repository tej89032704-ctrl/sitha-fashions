const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const db = new Database(path.join(__dirname, '..', 'sitha.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('admin','customer','staff')),
    phone TEXT DEFAULT '',
    address TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    must_change_password INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS dresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    price REAL NOT NULL,
    category TEXT DEFAULT '',
    size TEXT DEFAULT '',
    color TEXT DEFAULT '',
    stock INTEGER DEFAULT 0,
    low_stock_threshold INTEGER DEFAULT 5,
    image TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS cart (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    dress_id INTEGER NOT NULL,
    quantity INTEGER DEFAULT 1,
    size TEXT DEFAULT '',
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (dress_id) REFERENCES dresses(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    total_amount REAL NOT NULL,
    discount_amount REAL DEFAULT 0,
    coupon_code TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','shipped','delivered','cancelled')),
    payment_status TEXT DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid','paid','refunded')),
    address TEXT NOT NULL,
    phone TEXT NOT NULL,
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    dress_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    size TEXT DEFAULT '',
    price REAL NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (dress_id) REFERENCES dresses(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    discount_type TEXT NOT NULL CHECK(discount_type IN ('percentage','fixed')),
    discount_value REAL NOT NULL,
    min_order_amount REAL DEFAULT 0,
    max_uses INTEGER DEFAULT 0,
    used_count INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER,
    admin_name TEXT DEFAULT '',
    action TEXT NOT NULL,
    entity_type TEXT DEFAULT '',
    entity_id INTEGER,
    details TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    dress_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    comment TEXT DEFAULT '',
    is_approved INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (dress_id) REFERENCES dresses(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS wishlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    dress_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (dress_id) REFERENCES dresses(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    label TEXT DEFAULT 'Home',
    address TEXT NOT NULL,
    city TEXT DEFAULT '',
    state TEXT DEFAULT '',
    pincode TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    is_default INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS dress_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dress_id INTEGER NOT NULL,
    image TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY (dress_id) REFERENCES dresses(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS order_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    note TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    dress_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','refunded')),
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (dress_id) REFERENCES dresses(id) ON DELETE CASCADE
  );
`);

// Migrate existing tables to add new columns
const migrations = [
  "ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1",
  "ALTER TABLE dresses ADD COLUMN low_stock_threshold INTEGER DEFAULT 5",
  "ALTER TABLE dresses ADD COLUMN is_active INTEGER DEFAULT 1",
  "ALTER TABLE orders ADD COLUMN discount_amount REAL DEFAULT 0",
  "ALTER TABLE orders ADD COLUMN coupon_code TEXT DEFAULT ''",
  "ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid','paid','refunded'))",
  "ALTER TABLE orders ADD COLUMN notes TEXT DEFAULT ''",
  "ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0",
];
for (const sql of migrations) {
  try { db.exec(sql); } catch (e) { /* column already exists */ }
}

// Add index on dresses.category for faster admin lookups
db.exec('CREATE INDEX IF NOT EXISTS idx_dresses_category ON dresses(category)');

const adminExists = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
if (!adminExists) {
  const hashed = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (name, email, password, role, must_change_password) VALUES (?, ?, ?, ?, 1)').run(
    'Super Admin', 'admin@sitha.com', hashed, 'admin'
  );
  console.log('WARNING: Default admin created: admin@sitha.com / admin123 - password change REQUIRED on first login');
}

// Flag existing admins still using the default password
const admins = db.prepare("SELECT id, password FROM users WHERE role IN ('admin','staff')").all();
for (const a of admins) {
  if (bcrypt.compareSync('admin123', a.password)) {
    db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(a.id);
    console.log('WARNING: Default password in use - password change required for user id ' + a.id);
  }
}

// Seed default settings if not exist
if (!db.prepare('SELECT key FROM settings WHERE key = ?').get('store_name')) {
  const defaults = [
    ['store_name', 'Sitha Fashions'],
    ['store_currency', 'INR'],
    ['tax_rate', '0'],
    ['shipping_fee', '0'],
    ['free_shipping_min', '0'],
  ];
  const stmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of defaults) stmt.run(k, v);
}

module.exports = db;
