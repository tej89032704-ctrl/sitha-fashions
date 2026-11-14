require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(require('./middleware/securityHeaders'));
app.use(require('./middleware/csrf'));
app.use(express.static(path.join(__dirname, 'public')));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use('/', require('./routes/customer'));
app.use('/admin', require('./routes/admin'));

app.use(function(req, res) {
  const token = req.cookies?.token;
  let user = null;
  if (token) {
    try { user = require('./middleware/auth').verifyToken(token); } catch(e) {}
  }
  res.status(404).render('customer/404', { user, cartCount: 0 });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sitha Fashions running at http://localhost:${PORT}`);
});
