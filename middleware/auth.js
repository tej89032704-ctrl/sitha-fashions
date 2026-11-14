const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function auth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.redirect('/login');
  const decoded = verifyToken(token);
  if (!decoded) return res.redirect('/login');
  req.user = decoded;
  next();
}

function adminAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.redirect('/login');
  const decoded = verifyToken(token);
  if (!decoded || (decoded.role !== 'admin' && decoded.role !== 'staff')) {
    res.clearCookie('token');
    return res.redirect('/login');
  }
  req.user = decoded;
  next();
}

function guest(req, res, next) {
  const token = req.cookies?.token;
  if (token) {
    const decoded = verifyToken(token);
    if (decoded) {
      if (decoded.role === 'admin') return res.redirect('/admin/dashboard');
      return res.redirect('/');
    }
  }
  next();
}

const COOKIE_OPTIONS = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'Strict', maxAge: 7 * 24 * 60 * 60 * 1000 };

module.exports = { generateToken, verifyToken, auth, adminAuth, guest, COOKIE_OPTIONS };
