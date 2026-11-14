const db = require('./config/database');
const bcrypt = require('bcryptjs');

// Only seed if the dresses table is empty
const existing = db.prepare('SELECT COUNT(*) as c FROM dresses').get();
if (existing.c > 5) {
  console.log('Database already has data. Skipping seed.');
  process.exit(0);
}

console.log('Seeding database...');

// Categories with dress data
const categories = {
  'Western': [
    { name: 'Crimson Velvet Bodycon Dress', price: 12999, color: 'Crimson', size: 'XS,S,M,L,XL', stock: 25, low_stock_threshold: 5, desc: 'Stunning crimson velvet bodycon dress with a deep V-neckline. Perfect for evening parties and cocktail events.' },
    { name: 'Classic Little Black Dress', price: 8999, color: 'Black', size: 'XS,S,M,L,XL', stock: 40, low_stock_threshold: 8, desc: 'Timeless little black dress with a modern silhouette. A wardrobe essential for every woman.' },
    { name: 'Off-White Power Suit Dress', price: 15999, color: 'Off-White', size: 'S,M,L,XL', stock: 18, low_stock_threshold: 5, desc: 'Elegant off-white blazer dress with structured shoulders. Power dressing redefined.' },
    { name: 'Floral Maxi Dress', price: 7499, color: 'Multicolor', size: 'S,M,L,XL,XXL', stock: 35, low_stock_threshold: 5, desc: 'Boho-chic floral maxi dress with flowy silhouette. Ideal for summer days and beach weddings.' },
    { name: 'Denim Shirt Dress', price: 6499, color: 'Indigo', size: 'S,M,L,XL', stock: 30, low_stock_threshold: 5, desc: 'Casual denim shirt dress with a waist belt. Effortless style for everyday wear.' },
    { name: 'Cobalt Blue Wrap Dress', price: 9999, color: 'Cobalt Blue', size: 'XS,S,M,L,XL', stock: 22, low_stock_threshold: 5, desc: 'Flattering wrap dress in vibrant cobalt blue. Universally flattering silhouette.' },
    { name: 'Pleated Midi Skirt Set', price: 11999, color: 'Dusty Rose', size: 'S,M,L,XL', stock: 15, low_stock_threshold: 4, desc: 'Chic pleated midi skirt with matching cropped top. Coordinated elegance.' },
    { name: 'Leather Mini Dress', price: 18999, color: 'Black', size: 'S,M,L', stock: 12, low_stock_threshold: 3, desc: 'Edgy faux leather mini dress with silver hardware. For the bold fashionista.' },
  ],
  'Ethnic': [
    { name: 'Banarasi Silk Saree', price: 24999, color: 'Gold & Red', size: 'One Size', stock: 10, low_stock_threshold: 3, desc: 'Handwoven Banarasi silk saree with intricate zari work. A timeless heirloom piece.' },
    { name: 'Cotton Printed Saree', price: 3999, color: 'Blue', size: 'One Size', stock: 50, low_stock_threshold: 10, desc: 'Lightweight cotton saree with traditional block prints. Perfect for daily wear.' },
    { name: 'Georgette Saree with Blouse', price: 8999, color: 'Purple', size: 'One Size', stock: 25, low_stock_threshold: 5, desc: 'Elegant georgette saree with embroidered border and matching blouse piece.' },
    { name: 'Silk Lehenga Choli', price: 45999, color: 'Maroon', size: 'S,M,L,XL', stock: 8, low_stock_threshold: 3, desc: 'Opulent silk lehenga choli set with heavy embroidery and dupatta. Wedding season special.' },
    { name: 'Designer Salwar Kameez', price: 7999, color: 'Green', size: 'S,M,L,XL,XXL', stock: 30, low_stock_threshold: 5, desc: 'Contemporary salwar kameez with stylish dupatta. Perfect for festive occasions.' },
    { name: 'Anarkali Dress', price: 12999, color: 'Peach', size: 'S,M,L,XL', stock: 20, low_stock_threshold: 4, desc: 'Floor-length Anarkali dress with exquisite embroidery. Regal elegance for celebrations.' },
    { name: 'Kurti with Palazzo Set', price: 5499, color: 'White & Gold', size: 'S,M,L,XL,XXL', stock: 45, low_stock_threshold: 8, desc: 'Comfortable kurti set with embroidered palazzo pants. Effortlessly stylish.' },
    { name: 'Phulkari Dupatta Set', price: 6499, color: 'Pink', size: 'M,L,XL', stock: 18, low_stock_threshold: 4, desc: 'Traditional Phulkari embroidered suit with rich Punjabi craftsmanship.' },
  ],
  'Party': [
    { name: 'Sequined Mermaid Gown', price: 35999, color: 'Silver', size: 'S,M,L,XL', stock: 8, low_stock_threshold: 3, desc: 'Head-turning sequined mermaid gown with a dramatic train. Red carpet ready.' },
    { name: 'Gold Lamé Mini Dress', price: 14999, color: 'Gold', size: 'S,M,L', stock: 15, low_stock_threshold: 4, desc: 'Dazzling gold lamé mini dress with a high neckline. Party essential.' },
    { name: 'Velvet Blazer Dress', price: 19999, color: 'Emerald', size: 'S,M,L,XL', stock: 12, low_stock_threshold: 4, desc: 'Luxurious velvet blazer dress in rich emerald green. Sophisticated party wear.' },
    { name: 'Tulle Skirt with Corset Top', price: 22500, color: 'Blush Pink', size: 'XS,S,M,L', stock: 10, low_stock_threshold: 3, desc: 'Dreamy tulle skirt paired with a structured corset top. Princess vibes.' },
    { name: 'Asymmetric Ruffle Dress', price: 13999, color: 'Navy', size: 'S,M,L,XL', stock: 16, low_stock_threshold: 4, desc: 'Stunning asymmetric hem dress with cascading ruffles. Modern party glamour.' },
    { name: 'Jumpsuit with Cape', price: 16999, color: 'Black', size: 'S,M,L,XL', stock: 20, low_stock_threshold: 5, desc: 'Sophisticated black jumpsuit with an attached cape detail. Effortless elegance.' },
  ],
  'Traditional': [
    { name: 'Kanjivaram Silk Saree', price: 35999, color: 'Green & Gold', size: 'One Size', stock: 7, low_stock_threshold: 3, desc: 'Authentic Kanjivaram silk saree with temple border design. A South Indian classic.' },
    { name: 'Bandhani Lehenga', price: 28999, color: 'Red & Yellow', size: 'S,M,L,XL', stock: 10, low_stock_threshold: 3, desc: 'Vibrant Bandhani lehenga with mirror work. Traditional Rajasthani craftsmanship.' },
    { name: 'Pashmina Shawl Set', price: 19999, color: 'Ivory', size: 'One Size', stock: 12, low_stock_threshold: 4, desc: 'Pure Pashmina shawl with delicate embroidery. Timeless luxury.' },
    { name: 'Kasavu Saree', price: 8499, color: 'White & Gold', size: 'One Size', stock: 22, low_stock_threshold: 5, desc: 'Traditional Kerala Kasavu saree with golden border. Minimalist elegance.' },
  ],
  'Indo-Western': [
    { name: 'Crop Top Lehenga Set', price: 18999, color: 'Teal', size: 'S,M,L,XL', stock: 14, low_stock_threshold: 4, desc: 'Modern crop top lehenga set with contemporary styling. Fusion fashion at its best.' },
    { name: 'Dhoti Pants with Cape', price: 13999, color: 'Mustard', size: 'S,M,L,XL', stock: 12, low_stock_threshold: 4, desc: 'Trendy dhoti pants with an asymmetric cape top. Indo-western avant-garde.' },
    { name: 'Sharara Set', price: 15999, color: 'Lavender', size: 'S,M,L,XL', stock: 16, low_stock_threshold: 4, desc: 'Elegant sharara set with flowy pants and embroidered kurta. Perfect for sangeet.' },
    { name: 'Saree Gown Fusion', price: 21999, color: 'Burgundy', size: 'S,M,L,XL', stock: 10, low_stock_threshold: 3, desc: 'Innovative saree-gown hybrid with pre-pleated pallu. Saree ease with gown glamour.' },
  ],
  'Casual': [
    { name: 'Striped Cotton Dress', price: 4499, color: 'Blue & White', size: 'XS,S,M,L,XL,XXL', stock: 60, low_stock_threshold: 10, desc: 'Breathable cotton striped dress perfect for casual outings and weekend brunches.' },
    { name: 'Oversized T-shirt Dress', price: 3499, color: 'Grey', size: 'S,M,L,XL', stock: 55, low_stock_threshold: 10, desc: 'Comfort meets style with this oversized t-shirt dress. Your go-to casual staple.' },
    { name: 'Linen Shirt Dress', price: 7999, color: 'Beige', size: 'XS,S,M,L,XL', stock: 28, low_stock_threshold: 6, desc: 'Effortless linen shirt dress with a relaxed fit. Breezy summer essential.' },
    { name: 'Sweater Dress', price: 9999, color: 'Cream', size: 'S,M,L,XL', stock: 20, low_stock_threshold: 5, desc: 'Cozy knit sweater dress with ribbed detailing. Winter wardrobe hero.' },
    { name: 'Graphic Print Mini Dress', price: 5499, color: 'White', size: 'XS,S,M,L', stock: 35, low_stock_threshold: 6, desc: 'Fun graphic print mini dress with a playful silhouette. Express your personality.' },
    { name: 'Jogger Dress Set', price: 6999, color: 'Olive', size: 'S,M,L,XL,XXL', stock: 25, low_stock_threshold: 5, desc: 'Athleisure-inspired jogger dress set with hoodie. Sporty spice redefined.' },
  ],
  'Evening Gowns': [
    { name: 'Strapless Sequin Gown', price: 42999, color: 'Champagne', size: 'S,M,L,XL', stock: 6, low_stock_threshold: 2, desc: 'Breathtaking strapless sequin gown with a sweeping train. For your most glamorous moments.' },
    { name: 'Slit Satin Gown', price: 28999, color: 'Burgundy', size: 'S,M,L,XL', stock: 10, low_stock_threshold: 3, desc: 'Luxurious satin gown with a daring thigh-high slit. Old Hollywood glamour.' },
    { name: 'One-Shoulder Gown', price: 31999, color: 'Navy', size: 'S,M,L,XL', stock: 8, low_stock_threshold: 3, desc: 'Elegant one-shoulder gown with draped detailing. Architectural sophistication.' },
    { name: 'Feathered Gown', price: 49999, color: 'White', size: 'S,M,L', stock: 4, low_stock_threshold: 2, desc: 'Show-stopping feathered gown with a fitted bodice. For the unforgettable entrance.' },
  ],
};

const insertDress = db.prepare('INSERT INTO dresses (name, description, price, category, size, color, stock, low_stock_threshold, image, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)');

let total = 0;
for (const [category, dresses] of Object.entries(categories)) {
  for (const dress of dresses) {
    insertDress.run(dress.name, dress.desc, dress.price, category, dress.size, dress.color, dress.stock, dress.low_stock_threshold, dress.image || '');
    total++;
  }
}

// Create a sample coupon
const existingCoupon = db.prepare('SELECT id FROM coupons WHERE code = ?').get('WELCOME20');
if (!existingCoupon) {
  db.prepare('INSERT INTO coupons (code, discount_type, discount_value, min_order_amount, max_uses, is_active) VALUES (?, ?, ?, ?, ?, ?)').run('WELCOME20', 'percentage', 20, 2999, 100, 1);
  db.prepare('INSERT INTO coupons (code, discount_type, discount_value, min_order_amount, max_uses, is_active) VALUES (?, ?, ?, ?, ?, ?)').run('FESTIVE500', 'fixed', 500, 1999, 50, 1);
  db.prepare('INSERT INTO coupons (code, discount_type, discount_value, min_order_amount, max_uses, is_active) VALUES (?, ?, ?, ?, ?, ?)').run('VIP30', 'percentage', 30, 9999, 20, 1);
  console.log('Created 3 coupons');
}

console.log(`Seeded ${total} dresses across ${Object.keys(categories).length} categories.`);
console.log('Run `npm start` and login to explore!');
