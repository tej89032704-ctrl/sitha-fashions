const db = require('./config/database');
const fs = require('fs');
const path = require('path');

const uploadDir = path.join(__dirname, 'public', 'uploads', 'dresses');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const dresses = db.prepare("SELECT id, name, category, color FROM dresses WHERE image IS NULL OR image = ''").all();
console.log(`Generating images for ${dresses.length} dresses...`);

// Category-based color palette
const palette = {
  'Western': ['#e8d5c4', '#d4a5a5', '#c4d4e8', '#d5c4e8', '#a5c4d4'],
  'Ethnic': ['#c44a4a', '#d4a020', '#4a8c4a', '#c47020', '#8c204a'],
  'Party': ['#1a1a2e', '#2d1b3d', '#3d1b2e', '#4a1a2e', '#2e1a4a'],
  'Traditional': ['#8c2020', '#c47020', '#4a6c20', '#20208c', '#6c204a'],
  'Indo-Western': ['#2e4a6c', '#4a2e6c', '#6c4a2e', '#2e6c4a', '#6c2e4a'],
  'Casual': ['#8ca0b8', '#b8a08c', '#a0b88c', '#8cb8a0', '#b88ca0'],
  'Evening Gowns': ['#1a0a0a', '#0a1a1a', '#1a1a0a', '#0a0a1a', '#1a0a1a'],
};
const fallbackPalette = ['#c084fc', '#f472b6', '#7dd3fc', '#86efac', '#fdba74'];

let idx = 0;
const stmt = db.prepare('UPDATE dresses SET image = ? WHERE id = ?');

for (const dress of dresses) {
  const colors = palette[dress.category] || fallbackPalette;
  const bgColor = colors[idx % colors.length];
  const textColor = isLight(bgColor) ? '#2d2d3d' : '#ffffff';
  const initials = dress.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500" viewBox="0 0 400 500">
  <rect width="400" height="500" fill="${bgColor}"/>
  <circle cx="200" cy="180" r="80" fill="${textColor}15"/>
  <text x="200" y="195" text-anchor="middle" font-family="Georgia,serif" font-size="72" font-weight="bold" fill="${textColor}" opacity="0.9">${initials}</text>
  <text x="200" y="340" text-anchor="middle" font-family="Georgia,serif" font-size="18" fill="${textColor}" opacity="0.7">${escapeXml(dress.category)}</text>
  <text x="200" y="370" text-anchor="middle" font-family="sans-serif" font-size="14" fill="${textColor}" opacity="0.5">${escapeXml(dress.color || '')}</text>
  <line x1="120" y1="400" x2="280" y2="400" stroke="${textColor}" stroke-width="1" opacity="0.2"/>
</svg>`;

  const filename = `dress-${dress.id}.svg`;
  fs.writeFileSync(path.join(uploadDir, filename), svg);
  stmt.run(`/uploads/dresses/${filename}`, dress.id);
  idx++;
}

console.log(`Done! Generated ${dresses.length} placeholder images.`);

function isLight(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substr(0,2), 16);
  const g = parseInt(c.substr(2,2), 16);
  const b = parseInt(c.substr(4,2), 16);
  return (r*299 + g*587 + b*114) / 1000 > 155;
}

function escapeXml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
