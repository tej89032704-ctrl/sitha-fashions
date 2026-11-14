const express = require('express');
const router = express.Router();
const db = require('../config/database');
const bcrypt = require('bcryptjs');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { generateToken, verifyToken, auth, guest, COOKIE_OPTIONS } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');

const razorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET ? new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
}) : null;

const transporter = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
}) : null;

function getCartCount(userId) {
  const r = db.prepare('SELECT SUM(quantity) as count FROM cart WHERE user_id = ?').get(userId);
  return r?.count || 0;
}

router.get('/login', guest, (req, res) => {
  res.render('customer/login', { error: null });
});

router.post('/login', rateLimit(10, 15 * 60 * 1000), guest, (req, res) => {
  let { email, password } = req.body;
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return res.render('customer/login', { error: 'Invalid email or password' });
  }
  email = email.trim();
  if (email.length > 255 || password.length > 255) return res.render('customer/login', { error: 'Invalid input' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('customer/login', { error: 'Invalid email or password' });
  }
  const token = generateToken(user);
  res.cookie('token', token, COOKIE_OPTIONS);
  if (user.role === 'admin') return res.redirect('/admin/dashboard');
  res.redirect('/');
});

router.get('/register', guest, (req, res) => {
  res.render('customer/register', { error: null });
});

router.post('/register', rateLimit(10, 15 * 60 * 1000), guest, (req, res) => {
  let { name, email, password, phone, address } = req.body;
  if (!name || !email || !password || typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
    return res.render('customer/register', { error: 'All fields are required' });
  }
  name = name.trim(); email = email.trim();
  if (name.length < 2 || name.length > 100 || email.length > 255 || password.length < 6 || password.length > 255) {
    return res.render('customer/register', { error: 'Invalid input length' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.render('customer/register', { error: 'Email already registered' });
  }
  const hashed = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (name, email, password, role, phone, address) VALUES (?, ?, ?, ?, ?, ?)').run(
    name, email, hashed, 'customer', phone || '', address || ''
  );
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const token = generateToken(user);
  res.cookie('token', token, COOKIE_OPTIONS);
  res.redirect('/');
});

router.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/login');
});

router.get('/', auth, (req, res) => {
  const dresses = db.prepare('SELECT * FROM dresses WHERE is_active = 1 ORDER BY created_at DESC').all();
  const categories = db.prepare('SELECT DISTINCT category FROM dresses WHERE category != ?').all('');
  const cartCount = getCartCount(req.user.id);
  const wishlistIds = db.prepare('SELECT dress_id FROM wishlist WHERE user_id = ?').all(req.user.id).map(w => w.dress_id);
  const recentlyViewed = JSON.parse(req.cookies.recently_viewed || '[]');
  let recentDresses = [];
  if (recentlyViewed.length > 0) {
    const placeholders = recentlyViewed.map(() => '?').join(',');
    recentDresses = db.prepare(`SELECT * FROM dresses WHERE id IN (${placeholders}) AND is_active = 1`).all(...recentlyViewed);
    recentDresses.sort((a, b) => recentlyViewed.indexOf(a.id) - recentlyViewed.indexOf(b.id));
  }
  const coupons = db.prepare("SELECT * FROM coupons WHERE is_active = 1 AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY created_at DESC").all();
  res.render('customer/home', {
    user: req.user, dresses, categories: categories.map(c => c.category),
    cartCount, wishlistIds, recentDresses, coupons
  });
});

router.get('/shop', auth, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(48, Math.max(1, parseInt(req.query.limit) || 12));
  const offset = (page - 1) * limit;
  let countQuery = 'SELECT COUNT(*) as total FROM dresses WHERE is_active = 1';
  let dataQuery = 'SELECT * FROM dresses WHERE is_active = 1';
  const countParams = [];
  const dataParams = [];
  if (req.query.category) {
    countQuery += ' AND category = ?';
    dataQuery += ' AND category = ?';
    countParams.push(req.query.category);
    dataParams.push(req.query.category);
  }
  if (req.query.search) {
    countQuery += ' AND (name LIKE ? OR description LIKE ?)';
    dataQuery += ' AND (name LIKE ? OR description LIKE ?)';
    countParams.push(`%${req.query.search}%`, `%${req.query.search}%`);
    dataParams.push(`%${req.query.search}%`, `%${req.query.search}%`);
  }
  const sort = req.query.sort || 'newest';
  const sortMap = { newest: 'created_at DESC', 'price-low': 'price ASC', 'price-high': 'price DESC', name: 'name ASC' };
  dataQuery += ' ORDER BY ' + (sortMap[sort] || 'created_at DESC');
  const total = db.prepare(countQuery).get(...countParams).total;
  const totalPages = Math.ceil(total / limit);
  dataQuery += ' LIMIT ? OFFSET ?';
  dataParams.push(limit, offset);
  const dresses = db.prepare(dataQuery).all(...dataParams);
  const categories = db.prepare('SELECT DISTINCT category FROM dresses WHERE category != ?').all('');
  const cartCount = db.prepare('SELECT SUM(quantity) as count FROM cart WHERE user_id = ?').get(req.user.id);
  const wishlistIds = db.prepare('SELECT dress_id FROM wishlist WHERE user_id = ?').all(req.user.id).map(w => w.dress_id);
  const qs = new URLSearchParams();
  if (req.query.category) qs.set('category', req.query.category);
  if (req.query.search) qs.set('search', req.query.search);
  if (req.query.sort) qs.set('sort', req.query.sort);
  qs.set('page', '');
  res.render('customer/shop', {
    user: req.user, dresses, categories: categories.map(c => c.category),
    cartCount: cartCount?.count || 0,
    selectedCategory: req.query.category || '', search: req.query.search || '',
    wishlistIds, page, totalPages, limit, querystring: qs.toString(), sort
  });
});

router.get('/dress/:id', auth, (req, res) => {
  const dress = db.prepare('SELECT * FROM dresses WHERE id = ? AND is_active = 1').get(req.params.id);
  if (!dress) return res.redirect('/shop');
  const cartCount = getCartCount(req.user.id);
  const wishlistIds = db.prepare('SELECT dress_id FROM wishlist WHERE user_id = ?').all(req.user.id).map(w => w.dress_id);
  const reviews = db.prepare(`
    SELECT reviews.*, users.name as user_name FROM reviews
    JOIN users ON reviews.user_id = users.id
    WHERE reviews.dress_id = ? AND reviews.is_approved = 1
    ORDER BY reviews.created_at DESC
  `).all(req.params.id);
  const avgRating = db.prepare('SELECT AVG(rating) as avg FROM reviews WHERE dress_id = ? AND is_approved = 1').get(req.params.id);
  const canReview = db.prepare(`
    SELECT 1 FROM orders
    JOIN order_items ON orders.id = order_items.order_id
    WHERE orders.user_id = ? AND order_items.dress_id = ? AND orders.status = 'delivered'
  `).get(req.user.id, req.params.id);
  const gallery = db.prepare('SELECT * FROM dress_images WHERE dress_id = ? ORDER BY sort_order ASC').all(req.params.id);
  const related = db.prepare('SELECT * FROM dresses WHERE category = ? AND id != ? AND is_active = 1 ORDER BY RANDOM() LIMIT 4').all(dress.category, dress.id);
  const recentlyViewed = JSON.parse(req.cookies.recently_viewed || '[]');
  const updated = [dress.id, ...recentlyViewed.filter(id => id !== dress.id)].slice(0, 10);
  res.cookie('recently_viewed', JSON.stringify(updated), { ...COOKIE_OPTIONS, maxAge: 30 * 24 * 60 * 60 * 1000 });
  res.render('customer/dress-detail', {
    user: req.user,
    dress,
    cartCount,
    wishlistIds,
    reviews,
    avgRating: avgRating?.avg || 0,
    canReview: !!canReview,
    gallery,
    related
  });
});

router.post('/cart/add', auth, (req, res) => {
  const { dress_id, size, quantity } = req.body;
  const existing = db.prepare('SELECT * FROM cart WHERE user_id = ? AND dress_id = ? AND size = ?').get(
    req.user.id, dress_id, size || ''
  );
  if (existing) {
    db.prepare('UPDATE cart SET quantity = quantity + ? WHERE id = ?').run(
      parseInt(quantity) || 1, existing.id
    );
  } else {
    db.prepare('INSERT INTO cart (user_id, dress_id, quantity, size) VALUES (?, ?, ?, ?)').run(
      req.user.id, dress_id, parseInt(quantity) || 1, size || ''
    );
  }
  res.redirect('/cart');
});

router.get('/cart', auth, (req, res) => {
  const items = db.prepare(`
    SELECT cart.id, cart.quantity, cart.size, dresses.name, dresses.price, dresses.image, dresses.stock
    FROM cart JOIN dresses ON cart.dress_id = dresses.id
    WHERE cart.user_id = ?
  `).all(req.user.id);
  const cartCount = db.prepare('SELECT SUM(quantity) as count FROM cart WHERE user_id = ?').get(req.user.id);
  const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  res.render('customer/cart', {
    user: req.user,
    items,
    total,
    cartCount: cartCount?.count || 0
  });
});

router.post('/cart/update', auth, (req, res) => {
  const { id, quantity } = req.body;
  if (quantity <= 0) {
    db.prepare('DELETE FROM cart WHERE id = ? AND user_id = ?').run(id, req.user.id);
  } else {
    db.prepare('UPDATE cart SET quantity = ? WHERE id = ? AND user_id = ?').run(quantity, id, req.user.id);
  }
  res.redirect('/cart');
});

router.post('/cart/remove', auth, (req, res) => {
  db.prepare('DELETE FROM cart WHERE id = ? AND user_id = ?').run(req.body.id, req.user.id);
  res.redirect('/cart');
});

router.get('/checkout', auth, (req, res) => {
  const items = db.prepare(`
    SELECT cart.id, cart.quantity, cart.size, dresses.name, dresses.price, dresses.image, dresses.id as dress_id
    FROM cart JOIN dresses ON cart.dress_id = dresses.id
    WHERE cart.user_id = ?
  `).all(req.user.id);
  if (items.length === 0) return res.redirect('/cart');
  const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const cartCount = getCartCount(req.user.id);
  const availableCoupons = db.prepare("SELECT * FROM coupons WHERE is_active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))").all();
  const addresses = db.prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC').all(req.user.id);
  res.render('customer/checkout', {
    user: req.user,
    userData: user,
    items,
    total,
    cartCount,
    error: null,
    availableCoupons,
    addresses
  });
});

router.post('/checkout', auth, (req, res) => {
  const { address_id, address, phone, coupon_code } = req.body;
  let fullAddr = address;
  if (address_id) {
    const saved = db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(address_id, req.user.id);
    if (saved) fullAddr = saved.address + (saved.city ? ', ' + saved.city : '') + (saved.state ? ', ' + saved.state : '') + (saved.pincode ? ' - ' + saved.pincode : '');
  }
  const phoneNum = phone || (address_id ? db.prepare('SELECT phone FROM addresses WHERE id = ? AND user_id = ?').get(address_id, req.user.id)?.phone : '');
  if (!fullAddr || !phoneNum) {
    const items = db.prepare(`
      SELECT cart.id, cart.quantity, cart.size, dresses.name, dresses.price, dresses.image, dresses.id as dress_id
      FROM cart JOIN dresses ON cart.dress_id = dresses.id
      WHERE cart.user_id = ?
    `).all(req.user.id);
    const total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const userData = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const cartCount = getCartCount(req.user.id);
    const availableCoupons = db.prepare("SELECT * FROM coupons WHERE is_active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))").all();
    const addresses = db.prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC').all(req.user.id);
    return res.render('customer/checkout', {
      user: req.user, userData, items, total, cartCount,
      error: 'Please select an address or fill in all fields',
      availableCoupons, addresses
    });
  }
  const items = db.prepare(`
    SELECT cart.quantity, cart.size, dresses.price, dresses.id as dress_id, dresses.name
    FROM cart JOIN dresses ON cart.dress_id = dresses.id
    WHERE cart.user_id = ?
  `).all(req.user.id);
  let total = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  let discountAmount = 0;
  let appliedCoupon = '';
  if (coupon_code) {
    const coupon = db.prepare('SELECT * FROM coupons WHERE code = ? AND is_active = 1 AND (expires_at IS NULL OR expires_at > datetime(\'now\'))').get(coupon_code.toUpperCase());
    if (coupon && total >= coupon.min_order_amount && (coupon.max_uses === 0 || coupon.used_count < coupon.max_uses)) {
      if (coupon.discount_type === 'percentage') {
        discountAmount = Math.round(total * coupon.discount_value / 100);
      } else {
        discountAmount = coupon.discount_value;
      }
      if (discountAmount > total) discountAmount = total;
      appliedCoupon = coupon.code;
      db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?').run(coupon.id);
    }
  }
  const order = db.prepare('INSERT INTO orders (user_id, total_amount, discount_amount, coupon_code, address, phone) VALUES (?, ?, ?, ?, ?, ?)').run(
    req.user.id, total, discountAmount, appliedCoupon, fullAddr, phoneNum
  );
  const insertItem = db.prepare('INSERT INTO order_items (order_id, dress_id, quantity, size, price) VALUES (?, ?, ?, ?, ?)');
  for (const item of items) {
    insertItem.run(order.lastInsertRowid, item.dress_id, item.quantity, item.size, item.price);
    db.prepare('UPDATE dresses SET stock = stock - ? WHERE id = ?').run(item.quantity, item.dress_id);
  }
  db.prepare('DELETE FROM cart WHERE user_id = ?').run(req.user.id);
  db.prepare("INSERT INTO order_tracking (order_id, status, note) VALUES (?, 'pending', 'Order placed')").run(order.lastInsertRowid);
  if (razorpay && process.env.RAZORPAY_KEY_ID) {
    res.redirect('/payment/' + order.lastInsertRowid);
  } else {
    db.prepare('UPDATE orders SET payment_status = ? WHERE id = ?').run('paid', order.lastInsertRowid);
    res.redirect('/orders');
  }
});

router.get('/orders', auth, (req, res) => {
  const sort = req.query.sort || 'newest';
  const orderBy = sort === 'oldest' ? 'created_at ASC' : 'created_at DESC';
  const orders = db.prepare(`SELECT * FROM orders WHERE user_id = ? ORDER BY ${orderBy}`).all(req.user.id);
  const orderItems = {};
  for (const order of orders) {
    orderItems[order.id] = db.prepare(`
      SELECT order_items.*, dresses.name, dresses.image
      FROM order_items JOIN dresses ON order_items.dress_id = dresses.id
      WHERE order_items.order_id = ?
    `).all(order.id);
  }
  const cartCount = getCartCount(req.user.id);
  res.render('customer/orders', {
    user: req.user, orders, orderItems, cartCount, sort
  });
});

router.get('/orders/:id', auth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.redirect('/orders');
  const items = db.prepare(`
    SELECT order_items.*, dresses.name, dresses.image
    FROM order_items JOIN dresses ON order_items.dress_id = dresses.id
    WHERE order_items.order_id = ?
  `).all(order.id);
  const tracking = db.prepare('SELECT * FROM order_tracking WHERE order_id = ? ORDER BY created_at ASC').all(order.id);
  const cartCount = getCartCount(req.user.id);
  res.render('customer/order-detail', { user: req.user, order, items, tracking, cartCount });
});

router.get('/profile', auth, (req, res) => {
  const userData = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const cartCount = db.prepare('SELECT SUM(quantity) as count FROM cart WHERE user_id = ?').get(req.user.id);
  res.render('customer/profile', {
    user: req.user,
    userData,
    cartCount: cartCount?.count || 0,
    success: null,
    error: null
  });
});

router.post('/profile', auth, (req, res) => {
  const { name, phone, address } = req.body;
  db.prepare('UPDATE users SET name = ?, phone = ?, address = ? WHERE id = ?').run(
    name, phone, address, req.user.id
  );
  const userData = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const cartCount = getCartCount(req.user.id);
  res.render('customer/profile', {
    user: req.user, userData, cartCount,
    success: 'Profile updated successfully', error: null
  });
});

/* ===== ADDRESSES ===== */
router.get('/addresses', auth, (req, res) => {
  const addresses = db.prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC').all(req.user.id);
  const cartCount = getCartCount(req.user.id);
  res.render('customer/addresses', { user: req.user, addresses, cartCount, error: null, success: null });
});

router.post('/addresses/add', auth, (req, res) => {
  const { label, address, city, state, pincode, phone, is_default } = req.body;
  if (!address || !phone) {
    const addresses = db.prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC').all(req.user.id);
    const cartCount = getCartCount(req.user.id);
    return res.render('customer/addresses', { user: req.user, addresses, cartCount, error: 'Address and phone are required', success: null });
  }
  if (is_default) db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
  db.prepare('INSERT INTO addresses (user_id, label, address, city, state, pincode, phone, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    req.user.id, label || 'Home', address, city || '', state || '', pincode || '', phone, is_default ? 1 : 0
  );
  res.redirect('/addresses');
});

router.post('/addresses/edit/:id', auth, (req, res) => {
  const { label, address, city, state, pincode, phone, is_default } = req.body;
  const addr = db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!addr) return res.redirect('/addresses');
  if (is_default) db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
  db.prepare('UPDATE addresses SET label=?, address=?, city=?, state=?, pincode=?, phone=?, is_default=? WHERE id=?').run(
    label || 'Home', address, city || '', state || '', pincode || '', phone, is_default ? 1 : 0, req.params.id
  );
  res.redirect('/addresses');
});

router.post('/addresses/delete/:id', auth, (req, res) => {
  db.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.redirect('/addresses');
});

/* ===== FORGOT PASSWORD ===== */
router.get('/forgot-password', guest, (req, res) => {
  res.render('customer/forgot-password', { error: null, success: null });
});

router.post('/forgot-password', guest, (req, res) => {
  const { email } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.render('customer/forgot-password', { error: 'No account with that email', success: null });
  if (!transporter) return res.render('customer/forgot-password', { error: 'Email service not configured. Contact support.', success: null });
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, datetime(\'now\', \'+1 hour\'))').run(user.id, token);
  const resetLink = `${req.protocol}://${req.get('host')}/reset-password/${token}`;
  transporter.sendMail({
    from: process.env.SMTP_FROM || 'noreply@sithafashions.com',
    to: email,
    subject: 'Reset your Sitha Fashions password',
    html: `<p>Click <a href="${resetLink}">here</a> to reset your password. This link expires in 1 hour.</p>`
  }).then(() => {
    res.render('customer/forgot-password', { error: null, success: 'Check your email for a reset link' });
  }).catch(() => {
    res.render('customer/forgot-password', { error: 'Failed to send email. Try again.', success: null });
  });
});

router.get('/reset-password/:token', guest, (req, res) => {
  const reset = db.prepare("SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > datetime('now')").get(req.params.token);
  if (!reset) return res.render('customer/reset-password', { error: 'Invalid or expired reset link', success: null, token: null });
  res.render('customer/reset-password', { error: null, success: null, token: req.params.token });
});

router.post('/reset-password/:token', guest, (req, res) => {
  const { password, confirm_password } = req.body;
  if (password !== confirm_password) return res.render('customer/reset-password', { error: 'Passwords do not match', success: null, token: req.params.token });
  if (password.length < 6) return res.render('customer/reset-password', { error: 'Password must be at least 6 characters', success: null, token: req.params.token });
  const reset = db.prepare("SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > datetime('now')").get(req.params.token);
  if (!reset) return res.render('customer/reset-password', { error: 'Invalid or expired reset link', success: null, token: null });
  const hashed = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, reset.user_id);
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(reset.id);
  res.redirect('/login');
});

/* ===== RETURNS ===== */
router.get('/returns', auth, (req, res) => {
  const returns = db.prepare(`
    SELECT returns.*, dresses.name as dress_name, orders.id as order_id
    FROM returns JOIN dresses ON returns.dress_id = dresses.id
    JOIN orders ON returns.order_id = orders.id
    WHERE returns.user_id = ? ORDER BY returns.created_at DESC
  `).all(req.user.id);
  const cartCount = getCartCount(req.user.id);
  res.render('customer/returns', { user: req.user, returns, cartCount, error: null, success: null });
});

router.post('/returns/add', auth, (req, res) => {
  const { order_id, dress_id, quantity, reason } = req.body;
  if (!reason) return res.redirect('/orders/' + order_id + '?error=Please provide a reason');
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ? AND status = 'delivered'").get(order_id, req.user.id);
  if (!order) return res.redirect('/orders');
  const orderItem = db.prepare('SELECT * FROM order_items WHERE order_id = ? AND dress_id = ?').get(order_id, dress_id);
  if (!orderItem) return res.redirect('/orders');
  db.prepare('INSERT INTO returns (order_id, user_id, dress_id, quantity, reason) VALUES (?, ?, ?, ?, ?)').run(
    order_id, req.user.id, dress_id, parseInt(quantity) || 1, reason
  );
  res.redirect('/returns');
});

/* ===== WISHLIST ===== */
router.get('/wishlist', auth, (req, res) => {
  const sort = req.query.sort || 'newest';
  const sortMap = { newest: 'wishlist.created_at DESC', 'price-low': 'dresses.price ASC', 'price-high': 'dresses.price DESC', name: 'dresses.name ASC' };
  const items = db.prepare(`
    SELECT wishlist.id as wid, wishlist.created_at, dresses.*
    FROM wishlist JOIN dresses ON wishlist.dress_id = dresses.id
    WHERE wishlist.user_id = ?
    ORDER BY ${sortMap[sort] || 'wishlist.created_at DESC'}
  `).all(req.user.id);
  const cartCount = db.prepare('SELECT SUM(quantity) as count FROM cart WHERE user_id = ?').get(req.user.id);
  res.render('customer/wishlist', { user: req.user, items, cartCount: cartCount?.count || 0, sort });
});

router.post('/wishlist/toggle', auth, (req, res) => {
  const { dress_id } = req.body;
  const existing = db.prepare('SELECT id FROM wishlist WHERE user_id = ? AND dress_id = ?').get(req.user.id, dress_id);
  if (existing) {
    db.prepare('DELETE FROM wishlist WHERE id = ?').run(existing.id);
    res.json({ wishlisted: false });
  } else {
    db.prepare('INSERT INTO wishlist (user_id, dress_id) VALUES (?, ?)').run(req.user.id, dress_id);
    res.json({ wishlisted: true });
  }
});

/* ===== REVIEWS ===== */
router.post('/review/add', auth, (req, res) => {
  const { dress_id, rating, comment } = req.body;
  const existing = db.prepare('SELECT id FROM reviews WHERE user_id = ? AND dress_id = ?').get(req.user.id, dress_id);
  if (existing) {
    db.prepare('UPDATE reviews SET rating = ?, comment = ? WHERE id = ?').run(parseInt(rating), comment || '', existing.id);
  } else {
    db.prepare('INSERT INTO reviews (user_id, dress_id, rating, comment) VALUES (?, ?, ?, ?)').run(
      req.user.id, dress_id, parseInt(rating), comment || ''
    );
  }
  res.redirect('/dress/' + dress_id);
});

/* ===== ORDER CANCELLATION ===== */
router.post('/orders/cancel/:id', auth, (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ? AND status = 'pending'").get(req.params.id, req.user.id);
  if (order) {
    db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(req.params.id);
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id);
    for (const item of items) {
      db.prepare('UPDATE dresses SET stock = stock + ? WHERE id = ?').run(item.quantity, item.dress_id);
    }
    if (order.coupon_code) {
      const coupon = db.prepare('SELECT id FROM coupons WHERE code = ?').get(order.coupon_code);
      if (coupon) db.prepare('UPDATE coupons SET used_count = MAX(0, used_count - 1) WHERE id = ?').run(coupon.id);
    }
  }
  res.redirect('/orders');
});

/* ===== ABOUT & CONTACT ===== */
router.get('/about', auth, (req, res) => {
  const cartCount = getCartCount(req.user.id);
  res.render('customer/about', { user: req.user, cartCount });
});

router.get('/contact', auth, (req, res) => {
  const cartCount = getCartCount(req.user.id);
  res.render('customer/contact', { user: req.user, cartCount, success: null, error: null });
});

router.post('/contact', auth, (req, res) => {
  const { subject, message } = req.body;
  if (!subject || !message) {
    const cartCount = getCartCount(req.user.id);
    return res.render('customer/contact', { user: req.user, cartCount, error: 'Please fill in all fields', success: null });
  }
  const cartCount = getCartCount(req.user.id);
  res.render('customer/contact', { user: req.user, cartCount, success: 'Your message has been sent. We will get back to you soon.', error: null });
});

/* ===== PAYMENT ===== */
router.get('/payment/:orderId', auth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.orderId, req.user.id);
  if (!order) return res.redirect('/orders');
  if (!razorpay) return res.redirect('/orders');
  const cartCount = db.prepare('SELECT SUM(quantity) as count FROM cart WHERE user_id = ?').get(req.user.id);
  const items = db.prepare(`
    SELECT order_items.*, dresses.name FROM order_items
    JOIN dresses ON order_items.dress_id = dresses.id
    WHERE order_items.order_id = ?
  `).all(order.id);
  res.render('customer/payment', {
    user: req.user, order, items, cartCount: cartCount?.count || 0,
    razorpayKeyId: process.env.RAZORPAY_KEY_ID
  });
});

router.post('/payment/create-order', auth, (req, res) => {
  if (!razorpay) return res.status(503).json({ error: 'Payment not configured' });
  const { order_id } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(order_id, req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const amount = Math.round((order.total_amount - order.discount_amount) * 100);
  razorpay.orders.create({
    amount,
    currency: 'INR',
    receipt: 'order_' + order.id,
    notes: { order_id: String(order.id) }
  }, (err, rzpOrder) => {
    if (err) return res.status(500).json({ error: 'Failed to create payment' });
    res.json(rzpOrder);
  });
});

router.post('/payment/verify', auth, (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const sign = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(razorpay_order_id + '|' + razorpay_payment_id)
    .digest('hex');
  if (sign === razorpay_signature) {
    const orderId = req.body.order_id;
    db.prepare("UPDATE orders SET payment_status = 'paid' WHERE id = ?").run(orderId);
    res.json({ success: true });
  } else {
    res.json({ success: false });
  }
});

router.get('/payment/success/:orderId', auth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.orderId, req.user.id);
  if (!order) return res.redirect('/orders');
  const cartCount = db.prepare('SELECT SUM(quantity) as count FROM cart WHERE user_id = ?').get(req.user.id);
  res.render('customer/payment-success', { user: req.user, order, cartCount: cartCount?.count || 0 });
});

router.use(function(req, res) {
  const cartCount = req.user ? (db.prepare('SELECT SUM(quantity) as count FROM cart WHERE user_id = ?').get(req.user.id)?.count || 0) : 0;
  res.status(404).render('customer/404', { user: req.user || null, cartCount });
});

router.use(function(err, req, res, next) {
  console.error(err.stack);
  const cartCount = req.user ? (db.prepare('SELECT SUM(quantity) as count FROM cart WHERE user_id = ?').get(req.user.id)?.count || 0) : 0;
  res.status(500).render('customer/404', { user: req.user || null, cartCount });
});

module.exports = router;
