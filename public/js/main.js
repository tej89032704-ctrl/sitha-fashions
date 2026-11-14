/* ===== Toast ===== */
function showToast(msg, type) {
  type = type || 'info';
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast-msg ' + type;
  el.textContent = msg;
  container.appendChild(el);
  requestAnimationFrame(function() { el.classList.add('show'); });
  setTimeout(function() {
    el.classList.remove('show');
    setTimeout(function() { el.remove(); }, 400);
  }, 3000);
}

function copyCoupon(code) {
  navigator.clipboard.writeText(code);
  showToast('Copied ' + code + ' to clipboard!', 'success');
}

/* ===== Theme ===== */
function toggleTheme() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  if (isDark) { html.removeAttribute('data-theme'); localStorage.setItem('theme', 'light'); }
  else { html.setAttribute('data-theme', 'dark'); localStorage.setItem('theme', 'dark'); }
  const icon = isDark ? 'fa-moon' : 'fa-sun';
  document.querySelectorAll('.theme-toggle i').forEach(function(i) { i.className = 'fas ' + icon; });
  document.querySelectorAll('.sidebar-footer a[title="Toggle dark mode"] i').forEach(function(i) { i.className = 'fas ' + icon; });
}

/* ===== Confetti ===== */
function fireConfetti() {
  var canvas = document.createElement('canvas');
  canvas.className = 'confetti-canvas';
  document.body.appendChild(canvas);
  var ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  var pieces = [];
  var colors = ['#c9a84c', '#d4a84b', '#e8d5a3', '#800020', '#556b2f', '#f5e6c8', '#d4a017'];
  for (var i = 0; i < 120; i++) {
    pieces.push({
      x: Math.random() * canvas.width, y: Math.random() * canvas.height - canvas.height,
      w: Math.random() * 8 + 4, h: Math.random() * 6 + 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 3, vy: Math.random() * 4 + 2,
      rot: Math.random() * 360, rotV: (Math.random() - 0.5) * 6,
      o: 1
    });
  }
  var frames = 0;
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(function(p) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05;
      p.rot += p.rotV;
      p.o -= 0.002;
      if (p.o <= 0) return;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.globalAlpha = Math.max(0, p.o);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    frames++;
    if (frames < 200) requestAnimationFrame(animate);
    else { canvas.remove(); }
  }
  animate();
}

/* ===== Animated Counters ===== */
function animateCounters() {
  document.querySelectorAll('.counter').forEach(function(el) {
    var target = parseFloat(el.dataset.target);
    if (isNaN(target)) return;
    var duration = 1200;
    var start = performance.now();
    var isRevenue = el.closest('.stat-card') && el.closest('.stat-card').querySelector('.fa-rupee-sign');
    function update(now) {
      var pct = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - pct, 3);
      var val = Math.round(target * eased);
      el.textContent = isRevenue ? '₹' + val.toLocaleString() : val.toLocaleString();
      if (pct < 1) requestAnimationFrame(update);
      else el.textContent = isRevenue ? '₹' + Math.round(target).toLocaleString() : Math.round(target).toLocaleString();
    }
    requestAnimationFrame(update);
  });
}

/* ===== Init ===== */
document.addEventListener('DOMContentLoaded', function() {
  /* Loader */
  var loader = document.getElementById('loader');
  if (loader) {
    loader.classList.add('active');
    setTimeout(function() { loader.classList.remove('active'); }, 1800);
  }

  /* Scroll Progress */
  var progressBar = document.getElementById('scrollProgress');
  var backBtn = document.getElementById('backToTop');
  if (progressBar) {
    window.addEventListener('scroll', function() {
      var scrollTop = window.scrollY;
      var docHeight = document.documentElement.scrollHeight - window.innerHeight;
      var pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      progressBar.style.width = pct + '%';
      if (backBtn) {
        if (scrollTop > 300) backBtn.classList.add('visible');
        else backBtn.classList.remove('visible');
      }
    });
  }

  /* Reveal Animations */
  var revealObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
  document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale').forEach(function(el) {
    revealObserver.observe(el);
  });

  /* Animated Counters */
  if (document.querySelector('.counter')) {
    var counterObserver = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          animateCounters();
          counterObserver.disconnect();
        }
      });
    }, { threshold: 0.3 });
    var statsGrid = document.querySelector('.stats-grid');
    if (statsGrid) counterObserver.observe(statsGrid);
  }

/* Wishlist buttons with toast */
document.querySelectorAll('.wishlist-btn').forEach(function(btn) {
  btn.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    var dressId = this.dataset.id;
    var isWishlisted = this.classList.contains('wishlisted');
    function getCookie(name) {
      var m = document.cookie.match('(^|; )' + name + '=([^;]+)');
      return m ? m[2] : '';
    }
    fetch('/wishlist/toggle', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-CSRF-Token': getCookie('csrf_token')},
      body: JSON.stringify({ dress_id: dressId })
    }).then(function(r) { return r.json(); }).then(function(data) {
        if (data.wishlisted) {
          btn.classList.add('wishlisted');
          btn.querySelector('i').className = 'fas fa-heart';
          showToast('Added to wishlist!', 'success');
        } else {
          btn.classList.remove('wishlisted');
          btn.querySelector('i').className = 'far fa-heart';
          showToast('Removed from wishlist', 'info');
        }
      });
    });
  });
});