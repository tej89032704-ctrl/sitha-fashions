const requests = {};

function rateLimit(max = 30, windowMs = 15 * 60 * 1000) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    if (!requests[ip]) requests[ip] = [];
    requests[ip] = requests[ip].filter(t => now - t < windowMs);
    if (requests[ip].length >= max) {
      return res.status(429).send('Too many requests');
    }
    requests[ip].push(now);
    next();
  };
}

module.exports = rateLimit;
