const crypto = require('crypto');

function csrf(req, res, next) {
  const token = req.cookies?.csrf_token || crypto.randomBytes(16).toString('hex');
  res.cookie('csrf_token', token, { httpOnly: false, secure: process.env.NODE_ENV === 'production', sameSite: 'Strict', maxAge: 7 * 24 * 60 * 60 * 1000 });
  const bodyToken = req.body?.csrf_token || req.headers['x-csrf-token'] || req.headers['x-csrftoken'];
  if (req.method === 'POST' && (!bodyToken || bodyToken !== token)) {
    return res.status(403).json({ error: 'CSRF token mismatch' });
  }
  req.csrfToken = token;
  res.locals.csrfToken = token;
  next();
}

module.exports = csrf;
