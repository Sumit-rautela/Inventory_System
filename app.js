const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required in .env');
}

const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'inventory_db',
  port: Number(process.env.DB_PORT || 3306),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

app.use(express.json());

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 4
    }
  })
);

app.use('/public', express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (!req.session.user) {
    if (
      req.originalUrl.startsWith('/products') ||
      req.originalUrl.startsWith('/categories') ||
      req.originalUrl.startsWith('/dashboard')
    ) {
      return res.status(401).json({ message: 'Unauthorized. Please login.' });
    }

    return res.redirect('/login');
  }
  next();
}

function toCSVValue(value) {
  const safe = String(value ?? '').replace(/"/g, '""');
  return `"${safe}"`;
}

function parseDateInput(value) {
  if (value === undefined || value === null || value === '') {
    return { isValid: true, value: null };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { isValid: false, value: null };
  }

  return { isValid: true, value: date.toISOString().slice(0, 10) };
}

async function getCategoryNameById(categoryId) {
  const [rows] = await db.execute('SELECT name FROM categories WHERE id = ?', [categoryId]);
  if (!rows.length) return null;
  return rows[0].name;
}

async function ensureProductsExpiryColumn() {
  try {
    await db.execute('ALTER TABLE products ADD COLUMN expiry_date DATE NULL');
  } catch (error) {
    if (error.code !== 'ER_DUP_FIELDNAME') {
      throw error;
    }
  }
}

// Pages
app.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/');
  }
  return res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/', requireAuth, (req, res) => {
  return res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Auth
app.post('/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    const [existing] = await db.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Username already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await db.execute('INSERT INTO users (username, password) VALUES (?, ?)', [
      username,
      hashedPassword
    ]);

    return res.status(201).json({ message: 'User created successfully.', userId: result.insertId });
  } catch (error) {
    return res.status(500).json({ message: 'Registration failed.' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required.' });
    }

    const [rows] = await db.execute('SELECT id, username, password FROM users WHERE username = ?', [username]);
    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const user = rows[0];
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    req.session.user = { id: user.id, username: user.username };
    return res.json({ message: 'Login successful.' });
  } catch (error) {
    return res.status(500).json({ message: 'Login failed.' });
  }
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: 'Logout failed.' });
    }
    res.clearCookie('connect.sid');
    return res.json({ message: 'Logout successful.' });
  });
});

app.get('/auth/session', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ authenticated: false });
  }
  return res.json({ authenticated: true, user: req.session.user });
});

// Categories
app.get('/categories', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT id, name FROM categories ORDER BY name ASC');
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch categories.' });
  }
});

app.post('/categories', requireAuth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ message: 'Category name is required.' });
    }

    const [result] = await db.execute('INSERT INTO categories (name) VALUES (?)', [name]);
    return res.status(201).json({ message: 'Category added successfully.', categoryId: result.insertId });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Category already exists.' });
    }
    return res.status(500).json({ message: 'Failed to add category.' });
  }
});

app.delete('/categories/:id', requireAuth, async (req, res) => {
  try {
    const parsedId = Number(req.params.id);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      return res.status(400).json({ message: 'Invalid category id.' });
    }

    const [result] = await db.execute('DELETE FROM categories WHERE id = ?', [parsedId]);
    if (!result.affectedRows) {
      return res.status(404).json({ message: 'Category not found.' });
    }
    return res.json({ message: 'Category deleted successfully.' });
  } catch (error) {
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(400).json({ message: 'Cannot delete category with existing products.' });
    }
    return res.status(500).json({ message: 'Failed to delete category.' });
  }
});

// Products
app.get('/products', requireAuth, async (req, res) => {
  try {
    const { search = '', categoryId = '' } = req.query;
    const normalizedCategoryId = String(categoryId || '').trim().toLowerCase();
    let sql = `
      SELECT p.id, p.name, p.quantity, p.price, p.expiry_date, p.created_at, c.id AS category_id, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE 1 = 1
    `;
    const params = [];

    if (search) {
      sql += ' AND p.name LIKE ?';
      params.push(`%${search}%`);
    }

    if (normalizedCategoryId && normalizedCategoryId !== 'all') {
      const parsedCategoryId = Number(normalizedCategoryId);
      if (!Number.isInteger(parsedCategoryId) || parsedCategoryId <= 0) {
        return res.status(400).json({ message: 'Invalid category filter.' });
      }

      sql += ' AND p.category_id = ?';
      params.push(parsedCategoryId);
    }

    sql += ' ORDER BY p.created_at DESC';

    const [rows] = await db.execute(sql, params);
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch products.' });
  }
});

app.post('/products', requireAuth, async (req, res) => {
  try {
    const { name, category_id, quantity, price, expiry_date } = req.body;
    if (!name || !category_id || quantity === undefined || price === undefined) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    const parsedCategoryId = Number(category_id);
    const parsedQuantity = Number(quantity);
    const parsedPrice = Number(price);
    if (
      !Number.isInteger(parsedCategoryId) ||
      parsedCategoryId <= 0 ||
      !Number.isFinite(parsedQuantity) ||
      parsedQuantity < 0 ||
      !Number.isFinite(parsedPrice) ||
      parsedPrice < 0
    ) {
      return res.status(400).json({ message: 'Invalid product values.' });
    }

    const categoryName = await getCategoryNameById(parsedCategoryId);
    if (!categoryName) {
      return res.status(400).json({ message: 'Invalid category.' });
    }

    const parsedExpiryDate = parseDateInput(expiry_date);
    if (!parsedExpiryDate.isValid) {
      return res.status(400).json({ message: 'Invalid expiry date.' });
    }

    const isGroceries = categoryName.trim().toLowerCase() === 'groceries';
    if (isGroceries && !parsedExpiryDate.value) {
      return res.status(400).json({ message: 'Expiry date is required for groceries products.' });
    }

    const finalExpiryDate = isGroceries ? parsedExpiryDate.value : null;

    const [result] = await db.execute(
      'INSERT INTO products (name, category_id, quantity, price, expiry_date) VALUES (?, ?, ?, ?, ?)',
      [name, parsedCategoryId, parsedQuantity, parsedPrice, finalExpiryDate]
    );

    return res.status(201).json({ message: 'Product added successfully.', productId: result.insertId });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to add product.' });
  }
});

app.put('/products/:id', requireAuth, async (req, res) => {
  try {
    const { name, category_id, quantity, price, expiry_date } = req.body;
    if (!name || !category_id || quantity === undefined || price === undefined) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    const parsedCategoryId = Number(category_id);
    const parsedQuantity = Number(quantity);
    const parsedPrice = Number(price);
    const parsedId = Number(req.params.id);
    if (
      !Number.isInteger(parsedCategoryId) ||
      parsedCategoryId <= 0 ||
      !Number.isFinite(parsedQuantity) ||
      parsedQuantity < 0 ||
      !Number.isFinite(parsedPrice) ||
      parsedPrice < 0 ||
      !Number.isInteger(parsedId) ||
      parsedId <= 0
    ) {
      return res.status(400).json({ message: 'Invalid product values.' });
    }

    const categoryName = await getCategoryNameById(parsedCategoryId);
    if (!categoryName) {
      return res.status(400).json({ message: 'Invalid category.' });
    }

    const parsedExpiryDate = parseDateInput(expiry_date);
    if (!parsedExpiryDate.isValid) {
      return res.status(400).json({ message: 'Invalid expiry date.' });
    }

    const isGroceries = categoryName.trim().toLowerCase() === 'groceries';
    if (isGroceries && !parsedExpiryDate.value) {
      return res.status(400).json({ message: 'Expiry date is required for groceries products.' });
    }

    const finalExpiryDate = isGroceries ? parsedExpiryDate.value : null;

    const [result] = await db.execute(
      'UPDATE products SET name = ?, category_id = ?, quantity = ?, price = ?, expiry_date = ? WHERE id = ?',
      [name, parsedCategoryId, parsedQuantity, parsedPrice, finalExpiryDate, parsedId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    return res.json({ message: 'Product updated successfully.' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update product.' });
  }
});

app.delete('/products/:id', requireAuth, async (req, res) => {
  try {
    const parsedId = Number(req.params.id);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      return res.status(400).json({ message: 'Invalid product id.' });
    }

    const [result] = await db.execute('DELETE FROM products WHERE id = ?', [parsedId]);
    if (!result.affectedRows) {
      return res.status(404).json({ message: 'Product not found.' });
    }
    return res.json({ message: 'Product deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to delete product.' });
  }
});

app.get('/products/export/csv', requireAuth, async (req, res) => {
  try {
    const { search = '', categoryId = '' } = req.query;
    const normalizedCategoryId = String(categoryId || '').trim().toLowerCase();
    let sql = `
      SELECT p.id, p.name, p.quantity, p.price, p.expiry_date, p.created_at, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE 1 = 1
    `;
    const params = [];

    if (search) {
      sql += ' AND p.name LIKE ?';
      params.push(`%${search}%`);
    }

    if (normalizedCategoryId && normalizedCategoryId !== 'all') {
      const parsedCategoryId = Number(normalizedCategoryId);
      if (!Number.isInteger(parsedCategoryId) || parsedCategoryId <= 0) {
        return res.status(400).json({ message: 'Invalid category filter.' });
      }

      sql += ' AND p.category_id = ?';
      params.push(parsedCategoryId);
    }

    sql += ' ORDER BY p.created_at DESC';

    const [rows] = await db.execute(sql, params);
    const header = ['ID', 'Name', 'Category', 'Quantity', 'Price', 'Expiry Date', 'Created At'];
    const dataRows = rows.map((row) => [
      row.id,
      row.name,
      row.category_name || '',
      row.quantity,
      row.price,
      row.expiry_date ? new Date(row.expiry_date).toISOString().slice(0, 10) : '',
      new Date(row.created_at).toISOString()
    ]);
    const csv = [header, ...dataRows].map((row) => row.map(toCSVValue).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="products.csv"');
    return res.send(csv);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to export CSV.' });
  }
});

// Dashboard
app.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const [totalRows] = await db.execute('SELECT COUNT(*) AS total FROM products');
    const [lowStockRows] = await db.execute(
      `SELECT p.id, p.name, p.quantity, p.price, p.expiry_date, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.quantity < 10
       ORDER BY p.quantity ASC`
    );
    const [recentRows] = await db.execute(
      `SELECT p.id, p.name, p.quantity, p.price, p.expiry_date, p.created_at, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       ORDER BY p.created_at DESC
       LIMIT 5`
    );
    const [expiringRows] = await db.execute(
      `SELECT p.id, p.name, p.quantity, p.price, p.expiry_date, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.expiry_date IS NOT NULL
         AND DATEDIFF(p.expiry_date, CURDATE()) BETWEEN 0 AND 7
       ORDER BY p.expiry_date ASC`
    );
    const [valueRows] = await db.execute('SELECT IFNULL(SUM(quantity * price), 0) AS totalValue FROM products');

    return res.json({
      totalProducts: totalRows[0].total,
      lowStockItems: lowStockRows,
      expiringProducts: expiringRows,
      recentProducts: recentRows,
      totalInventoryValue: Number(valueRows[0].totalValue || 0)
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load dashboard data.' });
  }
});

app.use((req, res) => {
  return res.status(404).json({ message: 'Route not found.' });
});

app.use((error, req, res, next) => {
  console.error(error);

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Invalid JSON body.' });
  }

  return res.status(500).json({ message: 'Internal server error.' });
});

const PORT = Number(process.env.PORT || 3000);
ensureProductsExpiryColumn()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Server startup failed:', error.message);
    process.exit(1);
  });
