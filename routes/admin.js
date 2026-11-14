const express = require('express');
const router = express.Router();
const db = require('../config/database');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const { generateToken, adminAuth, guest } = require('../middleware/auth');

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'public', 'uploads', 'dresses'),
  filename: (req, file, cb) => {
    const safeName = path.basename(file.originalname).replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_.-]/g, '');
    cb(null, Date.now() + '-' + safeName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    cb(null, ext && mime);
  }
});

function logActivity(adminId, adminName, action, entityType, entityId, details) {
  db.prepare('INSERT INTO activity_logs (admin_id, admin_name, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)').run(
    adminId, adminName, action, entityType, entityId || null, details || ''
  );
}

router.get('/login', guest, (req, res) => { res.redirect('/login'); });
router.post('/login', guest, (req, res) => { res.redirect('/login'); });
router.get('/logout', (req, res) => { res.clearCookie('token'); res.redirect('/login'); });

/* ===== CHANGE PASSWORD ===== */
router.get('/change-password', adminAuth, (req, res) => {
  res.render('admin/change-password', { user: req.user, error: null, success: null });
});

router.post('/change-password', adminAuth, (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  if (typeof new_password !== 'string' || new_password.length < 8 || new_password.length > 255) {
    return res.render('admin/change-password', { user: req.user, error: 'Password must be at least 8 characters', success: null });
  }
  if (new_password !== confirm_password) {
    return res.render('admin/change-password', { user: req.user, error: 'Passwords do not match', success: null });
  }
  const admin = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current_password || '', admin.password)) {
    return res.render('admin/change-password', { user: req.user, error: 'Current password is incorrect', success: null });
  }
  const hashed = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?').run(hashed, req.user.id);
  logActivity(req.user.id, req.user.name, 'update', 'user', req.user.id, 'Changed password');
  res.render('admin/change-password', { user: req.user, error: null, success: 'Password updated successfully' });
});

/* ===== FORCE PASSWORD CHANGE ===== */
function mustChangePassword(req, res, next) {
  const user = db.prepare('SELECT must_change_password FROM users WHERE id = ?').get(req.user.id);
  if (user?.must_change_password) {
    return res.redirect('/admin/change-password');
  }
  next();
}

router.use(mustChangePassword);

/* ===== DASHBOARD ===== */
router.get('/dashboard', adminAuth, (req, res) => {
  const dressCount = db.prepare('SELECT COUNT(*) as count FROM dresses').get();
  const orderCount = db.prepare('SELECT COUNT(*) as count FROM orders').get();
  const customerCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('customer');
  const revenue = db.prepare("SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE status != 'cancelled'").get();
  const pendingOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'").get();
  const lowStockCount = db.prepare("SELECT COUNT(*) as count FROM dresses WHERE stock <= low_stock_threshold AND is_active = 1").get();

  const recentOrders = db.prepare(`
    SELECT orders.*, users.name as customer_name
    FROM orders JOIN users ON orders.user_id = users.id
    ORDER BY orders.created_at DESC LIMIT 5
  `).all();
  const lowStock = db.prepare("SELECT * FROM dresses WHERE stock <= low_stock_threshold AND is_active = 1 ORDER BY stock ASC LIMIT 5").all();

  const topProducts = db.prepare(`
    SELECT dresses.id, dresses.name, dresses.image, dresses.price, SUM(order_items.quantity) as total_sold
    FROM order_items JOIN dresses ON order_items.dress_id = dresses.id
    JOIN orders ON order_items.order_id = orders.id
    WHERE orders.status != 'cancelled'
    GROUP BY dresses.id ORDER BY total_sold DESC LIMIT 5
  `).all();

  const revenueByDay = db.prepare(`
    SELECT DATE(created_at) as day, COALESCE(SUM(total_amount), 0) as revenue, COUNT(*) as orders
    FROM orders WHERE status != 'cancelled' AND created_at >= DATE('now', '-30 days')
    GROUP BY strftime('%Y-%m-%d', created_at) ORDER BY day ASC
  `).all();

  const ordersByStatus = db.prepare("SELECT status, COUNT(*) as count FROM orders GROUP BY status").all();
  const customerGrowth = db.prepare(`
    SELECT DATE(created_at) as day, COUNT(*) as count
    FROM users WHERE role = 'customer' AND created_at >= DATE('now', '-30 days')
    GROUP BY strftime('%Y-%m-%d', created_at) ORDER BY day ASC
  `).all();

  res.render('admin/dashboard', {
    user: req.user,
    dressCount: dressCount.count,
    orderCount: orderCount.count,
    customerCount: customerCount.count,
    revenue: revenue.total,
    pendingOrders: pendingOrders.count,
    lowStockCount: lowStockCount.count,
    recentOrders, lowStock, topProducts, revenueByDay, ordersByStatus, customerGrowth
  });
});

/* ===== ANALYTICS ===== */
router.get('/analytics', adminAuth, (req, res) => {
  const period = req.query.period || 'month';
  let dateFilter = "created_at >= DATE('now', '-30 days')";
  if (period === 'week') dateFilter = "created_at >= DATE('now', '-7 days')";
  if (period === 'year') dateFilter = "created_at >= DATE('now', '-365 days')";

  const salesData = db.prepare(`
    SELECT DATE(created_at) as day, COALESCE(SUM(total_amount), 0) as revenue, COUNT(*) as orders
    FROM orders WHERE status != 'cancelled' AND ${dateFilter}
    GROUP BY strftime('%Y-%m-%d', created_at) ORDER BY day ASC
  `).all();

  const categoryRevenue = db.prepare(`
    SELECT dresses.category, SUM(order_items.price * order_items.quantity) as revenue, COUNT(DISTINCT orders.id) as order_count
    FROM order_items JOIN dresses ON order_items.dress_id = dresses.id
    JOIN orders ON order_items.order_id = orders.id
    WHERE orders.status != 'cancelled'
    GROUP BY dresses.category ORDER BY revenue DESC
  `).all();

  const totalRevenue = salesData.reduce((s, d) => s + d.revenue, 0);
  const totalOrders = salesData.reduce((s, d) => s + d.orders, 0);
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  res.render('admin/analytics', {
    user: req.user, salesData, categoryRevenue, period,
    totalRevenue, totalOrders, avgOrderValue
  });
});

/* ===== DRESSES CRUD ===== */
router.get('/dresses', adminAuth, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const total = db.prepare('SELECT COUNT(*) as total FROM dresses').get().total;
  const totalPages = Math.ceil(total / limit);
  const dresses = db.prepare('SELECT * FROM dresses ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  res.render('admin/dresses', { user: req.user, dresses, page, totalPages, limit, querystring: 'page=' });
});

router.get('/dresses/add', adminAuth, (req, res) => {
  res.render('admin/add-dress', { user: req.user, error: null, dress: {} });
});

router.post('/dresses/add', adminAuth, upload.single('image'), (req, res) => {
  let { name, description, price, category, size, color, stock, low_stock_threshold } = req.body;
  if (!name || !price || typeof name !== 'string' || typeof price === 'undefined') {
    return res.render('admin/add-dress', { user: req.user, error: 'Name and price are required', dress: req.body });
  }
  name = name.trim();
  if (name.length > 200 || name.length < 2 || parseFloat(price) <= 0) {
    return res.render('admin/add-dress', { user: req.user, error: 'Invalid input', dress: req.body });
  }
  const image = req.file ? '/uploads/dresses/' + req.file.filename : '';
  const result = db.prepare('INSERT INTO dresses (name, description, price, category, size, color, stock, low_stock_threshold, image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    name, description || '', parseFloat(price), category || '', size || '', color || '', parseInt(stock) || 0, parseInt(low_stock_threshold) || 5, image
  );
  logActivity(req.user.id, req.user.name, 'create', 'dress', result.lastInsertRowid, `Added dress: ${name}`);
  res.redirect('/admin/dresses');
});

router.get('/dresses/edit/:id', adminAuth, (req, res) => {
  const dress = db.prepare('SELECT * FROM dresses WHERE id = ?').get(req.params.id);
  if (!dress) return res.redirect('/admin/dresses');
  res.render('admin/edit-dress', { user: req.user, dress, error: null });
});

router.post('/dresses/edit/:id', adminAuth, upload.single('image'), (req, res) => {
  let { name, description, price, category, size, color, stock, low_stock_threshold, is_active } = req.body;
  if (!name || !price || typeof name !== 'string') {
    const dress = db.prepare('SELECT * FROM dresses WHERE id = ?').get(req.params.id);
    return res.render('admin/edit-dress', { user: req.user, dress: { ...dress, ...req.body }, error: 'Name and price are required' });
  }
  name = name.trim();
  if (name.length > 200 || name.length < 2 || isNaN(parseFloat(price)) || parseFloat(price) <= 0) {
    const dress = db.prepare('SELECT * FROM dresses WHERE id = ?').get(req.params.id);
    return res.render('admin/edit-dress', { user: req.user, dress: { ...dress, ...req.body }, error: 'Invalid input' });
  }
  const image = req.file ? '/uploads/dresses/' + req.file.filename : null;
  const active = is_active === 'on' || is_active === '1' ? 1 : 0;
  if (image) {
    db.prepare('UPDATE dresses SET name=?, description=?, price=?, category=?, size=?, color=?, stock=?, low_stock_threshold=?, image=?, is_active=? WHERE id=?').run(
      name, description || '', parseFloat(price), category || '', size || '', color || '', parseInt(stock) || 0, parseInt(low_stock_threshold) || 5, image, active, req.params.id
    );
  } else {
    db.prepare('UPDATE dresses SET name=?, description=?, price=?, category=?, size=?, color=?, stock=?, low_stock_threshold=?, is_active=? WHERE id=?').run(
      name, description || '', parseFloat(price), category || '', size || '', color || '', parseInt(stock) || 0, parseInt(low_stock_threshold) || 5, active, req.params.id
    );
  }
  logActivity(req.user.id, req.user.name, 'update', 'dress', req.params.id, `Updated dress: ${name}`);
  res.redirect('/admin/dresses');
});

router.post('/dresses/delete/:id', adminAuth, (req, res) => {
  const dress = db.prepare('SELECT name FROM dresses WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM cart WHERE dress_id = ?').run(req.params.id);
  db.prepare('DELETE FROM order_items WHERE dress_id = ?').run(req.params.id);
  db.prepare('DELETE FROM dresses WHERE id = ?').run(req.params.id);
  logActivity(req.user.id, req.user.name, 'delete', 'dress', req.params.id, `Deleted dress: ${dress?.name}`);
  res.redirect('/admin/dresses');
});

/* ===== INVENTORY ===== */
router.get('/inventory', adminAuth, (req, res) => {
  const filter = req.query.filter || 'all';
  let query = 'SELECT * FROM dresses WHERE 1=1';
  if (filter === 'low') query += " AND stock <= low_stock_threshold";
  if (filter === 'out') query += " AND stock = 0";
  if (filter === 'active') query += " AND is_active = 1";
  query += ' ORDER BY stock ASC';
  const dresses = db.prepare(query).all();
  const lowCount = db.prepare("SELECT COUNT(*) as count FROM dresses WHERE stock <= low_stock_threshold AND is_active = 1").get();
  const outCount = db.prepare("SELECT COUNT(*) as count FROM dresses WHERE stock = 0 AND is_active = 1").get();
  const inStock = db.prepare("SELECT COUNT(*) as count FROM dresses WHERE stock > low_stock_threshold AND is_active = 1").get();
  res.render('admin/inventory', { user: req.user, dresses, filter, lowCount: lowCount.count, outCount: outCount.count, inStock: inStock.count });
});

router.post('/inventory/update', adminAuth, (req, res) => {
  const { dress_id, stock } = req.body;
  db.prepare('UPDATE dresses SET stock = ? WHERE id = ?').run(parseInt(stock) || 0, dress_id);
  res.redirect('/admin/inventory');
});

router.post('/inventory/bulk', adminAuth, (req, res) => {
  const { action } = req.body;
  if (action === 'activate_all') {
    db.prepare('UPDATE dresses SET is_active = 1').run();
  } else if (action === 'deactivate_zero') {
    db.prepare("UPDATE dresses SET is_active = 0 WHERE stock = 0").run();
  }
  logActivity(req.user.id, req.user.name, 'bulk_update', 'inventory', null, `Bulk action: ${action}`);
  res.redirect('/admin/inventory');
});

/* ===== COUPONS ===== */
router.get('/coupons', adminAuth, (req, res) => {
  const coupons = db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all();
  res.render('admin/coupons', { user: req.user, coupons });
});

router.get('/coupons/add', adminAuth, (req, res) => {
  res.render('admin/coupons-add', { user: req.user, error: null, coupon: {} });
});

router.post('/coupons/add', adminAuth, (req, res) => {
  const { code, discount_type, discount_value, min_order_amount, max_uses, expires_at } = req.body;
  if (!code || !discount_value) {
    return res.render('admin/coupons-add', { user: req.user, error: 'Code and value are required', coupon: req.body });
  }
  const existing = db.prepare('SELECT id FROM coupons WHERE code = ?').get(code.toUpperCase());
  if (existing) {
    return res.render('admin/coupons-add', { user: req.user, error: 'Coupon code already exists', coupon: req.body });
  }
  db.prepare('INSERT INTO coupons (code, discount_type, discount_value, min_order_amount, max_uses, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    code.toUpperCase(), discount_type, parseFloat(discount_value), parseFloat(min_order_amount) || 0, parseInt(max_uses) || 0, expires_at || null
  );
  logActivity(req.user.id, req.user.name, 'create', 'coupon', null, `Created coupon: ${code.toUpperCase()}`);
  res.redirect('/admin/coupons');
});

router.post('/coupons/toggle/:id', adminAuth, (req, res) => {
  const coupon = db.prepare('SELECT is_active FROM coupons WHERE id = ?').get(req.params.id);
  if (coupon) {
    db.prepare('UPDATE coupons SET is_active = ? WHERE id = ?').run(coupon.is_active ? 0 : 1, req.params.id);
    res.redirect('/admin/coupons');
  } else {
    res.redirect('/admin/coupons');
  }
});

router.post('/coupons/delete/:id', adminAuth, (req, res) => {
  db.prepare('DELETE FROM coupons WHERE id = ?').run(req.params.id);
  res.redirect('/admin/coupons');
});

/* ===== ORDERS ===== */
router.get('/orders', adminAuth, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const status = req.query.status || '';
  const payment = req.query.payment || '';
  let countQuery = 'SELECT COUNT(*) as total FROM orders JOIN users ON orders.user_id = users.id WHERE 1=1';
  let query = `
    SELECT orders.*, users.name as customer_name, users.email as customer_email
    FROM orders JOIN users ON orders.user_id = users.id WHERE 1=1
  `;
  const countParams = [];
  const params = [];
  if (status) { query += ' AND orders.status = ?'; countQuery += ' AND orders.status = ?'; params.push(status); countParams.push(status); }
  if (payment) { query += ' AND orders.payment_status = ?'; countQuery += ' AND orders.payment_status = ?'; params.push(payment); countParams.push(payment); }
  const total = db.prepare(countQuery).get(...countParams).total;
  const totalPages = Math.ceil(total / limit);
  query += ' ORDER BY orders.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const orders = db.prepare(query).all(...params);
  const orderItems = {};
  for (const order of orders) {
    orderItems[order.id] = db.prepare(`
      SELECT order_items.*, dresses.name, dresses.image
      FROM order_items JOIN dresses ON order_items.dress_id = dresses.id
      WHERE order_items.order_id = ?
    `).all(order.id);
  }
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (payment) qs.set('payment', payment);
  qs.set('page', '');
  res.render('admin/orders', { user: req.user, orders, orderItems, selectedStatus: status, selectedPayment: payment, page, totalPages, limit, querystring: qs.toString() });
});

router.post('/orders/status', adminAuth, (req, res) => {
  const { order_id, status, payment_status, tracking_note } = req.body;
  if (status) {
    db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, order_id);
    db.prepare('INSERT INTO order_tracking (order_id, status, note) VALUES (?, ?, ?)').run(order_id, status, tracking_note || `Status changed to ${status}`);
  }
  if (payment_status) {
    db.prepare("UPDATE orders SET payment_status = ? WHERE id = ?").run(payment_status, order_id);
  }
  logActivity(req.user.id, req.user.name, 'update', 'order', order_id, `Order #${order_id} status updated`);
  res.redirect('/admin/orders');
});

router.post('/orders/delete/:id', adminAuth, (req, res) => {
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(req.params.id);
  db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
  logActivity(req.user.id, req.user.name, 'delete', 'order', req.params.id, `Deleted order #${req.params.id}`);
  res.redirect('/admin/orders');
});

/* ===== CUSTOMERS ===== */
router.get('/customers', adminAuth, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const search = req.query.search || '';
  let countQuery = "SELECT COUNT(*) as total FROM users WHERE role = 'customer'";
  let query = "SELECT * FROM users WHERE role = 'customer'";
  const countParams = [];
  const params = [];
  if (search) {
    countQuery += ' AND (name LIKE ? OR email LIKE ?)';
    query += ' AND (name LIKE ? OR email LIKE ?)';
    countParams.push(`%${search}%`, `%${search}%`);
    params.push(`%${search}%`, `%${search}%`);
  }
  const total = db.prepare(countQuery).get(...countParams).total;
  const totalPages = Math.ceil(total / limit);
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const customers = db.prepare(query).all(...params);
  for (const c of customers) {
    c.order_count = db.prepare('SELECT COUNT(*) as count FROM orders WHERE user_id = ?').get(c.id).count;
    c.total_spent = db.prepare("SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE user_id = ? AND status != 'cancelled'").get(c.id).total;
    c.last_order = db.prepare("SELECT MAX(created_at) as last FROM orders WHERE user_id = ?").get(c.id).last;
  }
  const qs = new URLSearchParams();
  if (search) qs.set('search', search);
  qs.set('page', '');
  res.render('admin/customers', { user: req.user, customers, search, page, totalPages, limit, querystring: qs.toString() });
});

router.get('/customers/:id', adminAuth, (req, res) => {
  const customer = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(req.params.id, 'customer');
  if (!customer) return res.redirect('/admin/customers');
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(customer.id);
  const orderItems = {};
  for (const order of orders) {
    orderItems[order.id] = db.prepare(`
      SELECT order_items.*, dresses.name, dresses.image
      FROM order_items JOIN dresses ON order_items.dress_id = dresses.id
      WHERE order_items.order_id = ?
    `).all(order.id);
  }
  const totalSpent = db.prepare("SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE user_id = ? AND status != 'cancelled'").get(customer.id).total;
  const orderCount = db.prepare('SELECT COUNT(*) as count FROM orders WHERE user_id = ?').get(customer.id).count;
  const wishlistItems = db.prepare(`
    SELECT wishlist.*, dresses.name, dresses.price, dresses.image
    FROM wishlist JOIN dresses ON wishlist.dress_id = dresses.id
    WHERE wishlist.user_id = ?
  `).all(customer.id);
  res.render('admin/customer-detail', { user: req.user, customer, orders, orderItems, totalSpent, orderCount, wishlistItems });
});

/* ===== REVIEWS ===== */
router.get('/reviews', adminAuth, (req, res) => {
  const filter = req.query.filter || 'all';
  let query = `
    SELECT reviews.*, users.name as user_name, dresses.name as dress_name
    FROM reviews JOIN users ON reviews.user_id = users.id
    JOIN dresses ON reviews.dress_id = dresses.id
  `;
  if (filter === 'pending') query += ' WHERE reviews.is_approved = 0';
  query += ' ORDER BY reviews.created_at DESC';
  const reviews = db.prepare(query).all();
  const pendingCount = db.prepare('SELECT COUNT(*) as count FROM reviews WHERE is_approved = 0').get().count;
  res.render('admin/reviews', { user: req.user, reviews, filter, pendingCount });
});

router.post('/reviews/approve/:id', adminAuth, (req, res) => {
  db.prepare('UPDATE reviews SET is_approved = 1 WHERE id = ?').run(req.params.id);
  res.redirect('/admin/reviews');
});

router.post('/reviews/delete/:id', adminAuth, (req, res) => {
  db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
  res.redirect('/admin/reviews');
});

/* ===== STAFF ===== */
router.get('/staff', adminAuth, (req, res) => {
  const staff = db.prepare("SELECT id, name, email, role, is_active, created_at FROM users WHERE role IN ('admin','staff') ORDER BY created_at DESC").all();
  res.render('admin/staff', { user: req.user, staff });
});

router.post('/staff/add', adminAuth, (req, res) => {
  let { name, email, password } = req.body;
  if (!name || !email || !password || typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
    return res.render('admin/staff', { user: req.user, staff: db.prepare("SELECT id, name, email, role, is_active, created_at FROM users WHERE role IN ('admin','staff') ORDER BY created_at DESC").all(), error: 'All fields required' });
  }
  name = name.trim(); email = email.trim();
  if (name.length < 2 || name.length > 100 || email.length > 255 || password.length < 6 || password.length > 255) {
    return res.render('admin/staff', { user: req.user, staff: db.prepare("SELECT id, name, email, role, is_active, created_at FROM users WHERE role IN ('admin','staff') ORDER BY created_at DESC").all(), error: 'Invalid input length' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    const staff = db.prepare("SELECT id, name, email, role, is_active, created_at FROM users WHERE role IN ('admin','staff') ORDER BY created_at DESC").all();
    return res.render('admin/staff', { user: req.user, staff, error: 'Email already registered' });
  }
  const hashed = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run(name, email, hashed, 'staff');
  logActivity(req.user.id, req.user.name, 'create', 'staff', null, `Added staff: ${name} (${email})`);
  res.redirect('/admin/staff');
});

router.post('/staff/toggle/:id', adminAuth, (req, res) => {
  const staff = db.prepare('SELECT is_active FROM users WHERE id = ? AND role != ?').get(req.params.id, 'admin');
  if (staff) {
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(staff.is_active ? 0 : 1, req.params.id);
  }
  res.redirect('/admin/staff');
});

router.post('/staff/delete/:id', adminAuth, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ? AND role = ?').run(req.params.id, 'staff');
  res.redirect('/admin/staff');
});

/* ===== ACTIVITY LOG ===== */
router.get('/activity', adminAuth, (req, res) => {
  const logs = db.prepare('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 200').all();
  res.render('admin/activity', { user: req.user, logs });
});

/* ===== RETURNS ===== */
router.get('/returns', adminAuth, (req, res) => {
  const returns = db.prepare(`
    SELECT returns.*, users.name as user_name, dresses.name as dress_name, orders.id as order_id
    FROM returns JOIN users ON returns.user_id = users.id
    JOIN dresses ON returns.dress_id = dresses.id
    JOIN orders ON returns.order_id = orders.id
    ORDER BY returns.created_at DESC
  `).all();
  res.render('admin/returns', { user: req.user, returns });
});

router.post('/returns/update/:id', adminAuth, (req, res) => {
  const { status, notes } = req.body;
  db.prepare('UPDATE returns SET status = ?, notes = ? WHERE id = ?').run(status, notes || '', req.params.id);
  if (status === 'refunded') {
    const r = db.prepare('SELECT order_id FROM returns WHERE id = ?').get(req.params.id);
    db.prepare("UPDATE orders SET payment_status = 'refunded' WHERE id = ?").run(r.order_id);
  }
  logActivity(req.user.id, req.user.name, 'update', 'return', req.params.id, `Return #${req.params.id} status: ${status}`);
  res.redirect('/admin/returns');
});

/* ===== SETTINGS ===== */
router.get('/settings', adminAuth, (req, res) => {
  const settings = {};
  const rows = db.prepare('SELECT * FROM settings').all();
  for (const row of rows) settings[row.key] = row.value;
  res.render('admin/settings', { user: req.user, settings, success: null, error: null });
});

router.post('/settings', adminAuth, (req, res) => {
  const { store_name, store_currency, tax_rate, shipping_fee, free_shipping_min } = req.body;
  const updates = [
    ['store_name', store_name],
    ['store_currency', store_currency],
    ['tax_rate', tax_rate || '0'],
    ['shipping_fee', shipping_fee || '0'],
    ['free_shipping_min', free_shipping_min || '0'],
  ];
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of updates) stmt.run(k, v);
  logActivity(req.user.id, req.user.name, 'update', 'settings', null, 'Updated store settings');
  const settings = {};
  const rows = db.prepare('SELECT * FROM settings').all();
  for (const row of rows) settings[row.key] = row.value;
  res.render('admin/settings', { user: req.user, settings, success: 'Settings saved', error: null });
});

module.exports = router;
