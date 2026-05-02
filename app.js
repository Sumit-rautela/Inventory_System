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

function isPerishableCategoryName(categoryName) {
  const normalizedCategoryName = String(categoryName || '').trim().toLowerCase();
  return ['groceries', 'grocery', 'dairy'].includes(normalizedCategoryName);
}

async function getCategoryNameById(categoryId) {
  const [rows] = await db.execute('SELECT name FROM categories WHERE id = ?', [categoryId]);
  if (!rows.length) return null;
  return rows[0].name;
}

async function getCategoryNameByIdForBusiness(categoryId, businessId) {
  const [rows] = await db.execute(
    'SELECT name FROM categories WHERE id = ? AND business_id = ?',
    [categoryId, businessId]
  );
  if (!rows.length) return null;
  return rows[0].name;
}

async function getUserBusinessId(userId) {
  const [rows] = await db.execute('SELECT business_id FROM users WHERE id = ?', [userId]);
  if (!rows.length) return null;
  return rows[0].business_id;
}

async function getUserByUsernameAndBusiness(username, businessId) {
  const [rows] = await db.execute(
    'SELECT id, username, business_id FROM users WHERE username = ? AND business_id = ?',
    [username, businessId]
  );

  if (!rows.length) {
    return null;
  }

  return rows[0];
}

function getSessionUserId(req) {
  return req.session.userId || req.session.user?.id || null;
}

async function logActivity(userId, actionType, entityType, entityId, description) {
  try {
    console.debug(`[logActivity] Called with userId: ${userId}, actionType: ${actionType}, entityType: ${entityType}, entityId: ${entityId}, description: ${description}`);
    
    if (!userId || !actionType || !entityType || !description) {
      console.debug(`[logActivity] Returning early - missing required params. userId: ${userId}, actionType: ${actionType}, entityType: ${entityType}, description: ${description}`);
      return;
    }

    const businessId = await getUserBusinessId(userId);
    console.debug(`[logActivity] Got businessId: ${businessId} for userId: ${userId}`);
    
    if (!businessId) {
      console.debug(`[logActivity] Returning early - businessId not found for userId: ${userId}`);
      return;
    }

    try {
      await db.execute(
        `INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, description, business_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, actionType, entityType, entityId || null, description, businessId]
      );
      console.debug(`[logActivity] Successfully logged: ${actionType} on ${entityType} id=${entityId}`);
    } catch (insertError) {
      if (insertError.message && insertError.message.includes("Field 'action'")) {
        console.warn('[logActivity] Table has legacy action column, attempting migration...');
        await migrateActivityLogsTable();
        await db.execute(
          `INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, description, business_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [userId, actionType, entityType, entityId || null, description, businessId]
        );
        console.debug(`[logActivity] Successfully logged after migration: ${actionType} on ${entityType} id=${entityId}`);
      } else {
        throw insertError;
      }
    }
  } catch (error) {
    console.error('Failed to write activity log:', error);
  }
}

async function migrateActivityLogsTable() {
  try {
    console.log('[migrateActivityLogsTable] Checking if action column exists...');
    const [rows] = await db.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='activity_logs' AND TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='action'`
    );
    
    if (rows.length > 0) {
      console.log('[migrateActivityLogsTable] Found action column, dropping it...');
      await db.execute(`ALTER TABLE activity_logs DROP COLUMN action`);
      console.log('[migrateActivityLogsTable] Successfully dropped action column');
    }
  } catch (error) {
    console.error('[migrateActivityLogsTable] Error during migration:', error);
  }
}

async function ensureBusinessSchema() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS businesses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL UNIQUE,
      owner_user_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  await migrateActivityLogsTable();

  const columnsToEnsure = [
    ['users', 'business_id INT NULL'],
    ['categories', 'business_id INT NULL'],
    ['products', 'business_id INT NULL'],
    ['user_role_assignment', 'business_id INT NULL'],
    ['activity_logs', 'business_id INT NULL'],
    ['notifications', 'business_id INT NULL'],
    ['product_images', 'business_id INT NULL'],
    ['bulk_uploads', 'business_id INT NULL']
  ];

  for (const [tableName, columnDefinition] of columnsToEnsure) {
    try {
      await db.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`);
    } catch (error) {
      if (error.code !== 'ER_DUP_FIELDNAME') {
        throw error;
      }
    }
  }

  const [businessRows] = await db.execute('SELECT id FROM businesses ORDER BY id ASC LIMIT 1');
  let defaultBusinessId = businessRows[0]?.id;

  if (!defaultBusinessId) {
    const [businessResult] = await db.execute('INSERT INTO businesses (name) VALUES (?)', [
      'Default Business'
    ]);
    defaultBusinessId = businessResult.insertId;
  }

  const tablesToBackfill = [
    'users',
    'categories',
    'products',
    'user_role_assignment',
    'activity_logs',
    'notifications',
    'product_images',
    'bulk_uploads'
  ];

  for (const tableName of tablesToBackfill) {
    await db.execute(
      `UPDATE ${tableName} SET business_id = ? WHERE business_id IS NULL`,
      [defaultBusinessId]
    );
  }

  const [ownerRows] = await db.execute('SELECT id FROM users ORDER BY id ASC LIMIT 1');
  if (ownerRows.length) {
    await db.execute('UPDATE businesses SET owner_user_id = ? WHERE id = ?', [
      ownerRows[0].id,
      defaultBusinessId
    ]);
  }
}

async function getUserRoles(userId) {
  const [rows] = await db.execute(
    `SELECT ur.id, ur.role_name, ur.description, ura.assigned_at
     FROM user_roles ur
     INNER JOIN user_role_assignment ura ON ura.role_id = ur.id
     WHERE ura.user_id = ?
     ORDER BY ur.role_name ASC`,
    [userId]
  );

  return rows;
}

async function getRoleIdByName(roleName) {
  const [rows] = await db.execute('SELECT id FROM user_roles WHERE role_name = ?', [roleName]);
  if (!rows.length) {
    return null;
  }

  return rows[0].id;
}

async function assignRoleToUser(userId, roleId) {
  await db.execute('INSERT IGNORE INTO user_role_assignment (user_id, role_id) VALUES (?, ?)', [
    userId,
    roleId
  ]);
}

async function ensureDefaultRoleForUser(userId) {
  const existingRoles = await getUserRoles(userId);
  if (existingRoles.length > 0) {
    return existingRoles;
  }

  const staffRoleId = await getRoleIdByName('staff');
  if (!staffRoleId) {
    return existingRoles;
  }

  await assignRoleToUser(userId, staffRoleId);
  return getUserRoles(userId);
}

function getSessionBusinessId(req) {
  return req.session.user?.business_id || null;
}

function getSessionUserRoles(req) {
  return Array.isArray(req.session.user?.roles) ? req.session.user.roles : [];
}

function hasAnyRole(req, allowedRoles) {
  const sessionRoles = getSessionUserRoles(req);
  return sessionRoles.some((role) => allowedRoles.includes(role));
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.status(401).json({ message: 'Unauthorized. Please login.' });
    }

    if (!hasAnyRole(req, allowedRoles)) {
      return res.status(403).json({ message: 'Forbidden. Insufficient role permissions.' });
    }

    return next();
  };
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
    const { username, password, businessName } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required.' });
    }

    if (!businessName) {
      return res.status(400).json({ message: 'Business name is required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });
    }

    const [existing] = await db.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Username already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [businessResult] = await db.execute('INSERT INTO businesses (name) VALUES (?)', [
      businessName.trim()
    ]);

    const [result] = await db.execute(
      'INSERT INTO users (username, password, business_id) VALUES (?, ?, ?)',
      [username, hashedPassword, businessResult.insertId]
    );

    const adminRoleId = await getRoleIdByName('admin');
    if (adminRoleId) {
      await assignRoleToUser(result.insertId, adminRoleId);
    }

    await db.execute('UPDATE businesses SET owner_user_id = ? WHERE id = ?', [
      result.insertId,
      businessResult.insertId
    ]);

    await logActivity(
      result.insertId,
      'CREATE_USER',
      'USER',
      result.insertId,
      `Created user: ${username} as business admin for ${businessName.trim()}`
    );

    return res.status(201).json({ message: 'User created successfully.', userId: result.insertId });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Business name already exists.' });
    }
    return res.status(500).json({ message: 'Registration failed.' });
  }
});

app.post('/users', requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const { username, password, roleName } = req.body;

    if (!username || !password || !roleName) {
      return res.status(400).json({ message: 'Username, password, and role are required.' });
    }

    const normalizedRoleName = String(roleName).trim().toLowerCase();
    const currentRoles = getSessionUserRoles(req);
    const currentBusinessId = getSessionBusinessId(req);

    if (!currentBusinessId) {
      return res.status(400).json({ message: 'Business context is missing.' });
    }

    if (currentRoles.includes('manager') && normalizedRoleName !== 'staff') {
      return res.status(403).json({ message: 'Managers can only create staff users.' });
    }

    if (currentRoles.includes('admin') && !['manager', 'staff'].includes(normalizedRoleName)) {
      return res.status(400).json({ message: 'Admins can only create manager or staff users.' });
    }

    const [existing] = await db.execute('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Username already exists.' });
    }

    const roleId = await getRoleIdByName(normalizedRoleName);
    if (!roleId) {
      return res.status(404).json({ message: 'Role not found.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await db.execute(
      'INSERT INTO users (username, password, business_id) VALUES (?, ?, ?)',
      [username, hashedPassword, currentBusinessId]
    );

    await assignRoleToUser(result.insertId, roleId);
    await logActivity(
      getSessionUserId(req),
      'CREATE_USER',
      'USER',
      result.insertId,
      `Created user: ${username} with role ${normalizedRoleName}`
    );
    return res.status(201).json({ message: 'User created successfully.', userId: result.insertId });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to create user.' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required.' });
    }

    const [rows] = await db.execute(
      `SELECT u.id, u.username, u.password, u.business_id, b.name AS business_name
       FROM users u
       LEFT JOIN businesses b ON b.id = u.business_id
       WHERE u.username = ?`,
      [username]
    );
    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const user = rows[0];
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const roles = await ensureDefaultRoleForUser(user.id);

    req.session.user = {
      id: user.id,
      username: user.username,
      business_id: user.business_id,
      business_name: user.business_name,
      roles: roles.map((role) => role.role_name)
    };
    req.session.userId = user.id;
    await logActivity(user.id, 'LOGIN', 'USER', user.id, `User ${user.username} logged in`);
    return res.json({ message: 'Login successful.' });
  } catch (error) {
    return res.status(500).json({ message: 'Login failed.' });
  }
});

app.post('/auth/logout', (req, res) => {
  const actorUserId = getSessionUserId(req);
  const actorUsername = req.session.user?.username || 'Unknown';

  (async () => {
    if (actorUserId) {
      await logActivity(actorUserId, 'LOGOUT', 'USER', actorUserId, `User ${actorUsername} logged out`);
    }
  })()
    .catch((error) => {
      console.error('Failed to log logout activity:', error);
    })
    .finally(() => {
      req.session.destroy((err) => {
        if (err) {
          return res.status(500).json({ message: 'Logout failed.' });
        }
        res.clearCookie('connect.sid');
        return res.json({ message: 'Logout successful.' });
      });
    });
});

app.get('/auth/session', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ authenticated: false });
  }
  return res.json({ authenticated: true, user: req.session.user });
});

app.get('/roles', requireRole(['admin']), async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT id, role_name, description, created_at FROM user_roles ORDER BY role_name ASC'
    );
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch roles.' });
  }
});

app.get('/team/users', requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const businessId = getSessionBusinessId(req);
    const [rows] = await db.execute(
      `SELECT
         u.id,
         u.username,
         COALESCE(GROUP_CONCAT(DISTINCT ur.role_name ORDER BY ur.role_name SEPARATOR ', '), 'staff') AS roles
       FROM users u
       LEFT JOIN user_role_assignment ura ON ura.user_id = u.id
       LEFT JOIN user_roles ur ON ur.id = ura.role_id
       WHERE u.business_id = ?
       GROUP BY u.id, u.username
       ORDER BY u.username ASC`,
      [businessId]
    );

    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch team users.' });
  }
});

app.get('/users/by-username/:username/roles', requireRole(['admin']), async (req, res) => {
  try {
    const username = String(req.params.username || '').trim();
    if (!username) {
      return res.status(400).json({ message: 'Invalid username.' });
    }

    const currentBusinessId = getSessionBusinessId(req);
    const user = await getUserByUsernameAndBusiness(username, currentBusinessId);
    if (!user) {
      return res.status(404).json({ message: 'User not found in this business.' });
    }

    const userBusinessId = user.business_id;
    if (String(userBusinessId) !== String(currentBusinessId)) {
      return res.status(403).json({ message: 'Forbidden. Cross-business access is not allowed.' });
    }

    const roles = await getUserRoles(user.id);
    return res.json(roles);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch user roles.' });
  }
});

app.delete('/users/by-username/:username', requireRole(['admin']), async (req, res) => {
  try {
    const username = String(req.params.username || '').trim();
    if (!username) {
      return res.status(400).json({ message: 'Invalid username.' });
    }

    const businessId = getSessionBusinessId(req);
    const user = await getUserByUsernameAndBusiness(username, businessId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const [result] = await db.execute('DELETE FROM users WHERE id = ? AND business_id = ?', [user.id, businessId]);
    if (!result.affectedRows) {
      return res.status(404).json({ message: 'User not found.' });
    }

    await logActivity(
      getSessionUserId(req),
      'DELETE_USER',
      'USER',
      user.id,
      `Deleted user: ${user.username}`
    );

    return res.json({ message: 'User deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to delete user.' });
  }
});

app.post('/users/by-username/:username/roles', requireRole(['admin']), async (req, res) => {
  try {
    const username = String(req.params.username || '').trim();
    const { roleName } = req.body;

    if (!username) {
      return res.status(400).json({ message: 'Invalid username.' });
    }

    if (!roleName) {
      return res.status(400).json({ message: 'roleName is required.' });
    }

    const normalizedRoleName = String(roleName).trim().toLowerCase();
    if (!['manager', 'staff'].includes(normalizedRoleName)) {
      return res.status(400).json({ message: 'Only manager and staff roles can be assigned here.' });
    }

    const currentBusinessId = getSessionBusinessId(req);
    const user = await getUserByUsernameAndBusiness(username, currentBusinessId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const roleId = await getRoleIdByName(normalizedRoleName);
    if (!roleId) {
      return res.status(404).json({ message: 'Role not found.' });
    }

    await assignRoleToUser(user.id, roleId);
    const roles = await getUserRoles(user.id);
    await logActivity(
      getSessionUserId(req),
      'ASSIGN_ROLE',
      'USER_ROLE',
      user.id,
      `Assigned role ${normalizedRoleName} to user: ${username}`
    );
    return res.status(201).json({ message: 'Role assigned successfully.', roles });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to assign role.' });
  }
});

app.delete('/users/by-username/:username/roles/:roleId', requireRole(['admin']), async (req, res) => {
  try {
    const username = String(req.params.username || '').trim();
    const roleId = Number(req.params.roleId);

    if (!username || !Number.isInteger(roleId) || roleId <= 0) {
      return res.status(400).json({ message: 'Invalid username or role id.' });
    }

    const currentBusinessId = getSessionBusinessId(req);
    const user = await getUserByUsernameAndBusiness(username, currentBusinessId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const userBusinessId = user.business_id;
    if (String(userBusinessId) !== String(currentBusinessId)) {
      return res.status(403).json({ message: 'Forbidden. Cross-business access is not allowed.' });
    }

    const [result] = await db.execute(
      'DELETE FROM user_role_assignment WHERE user_id = ? AND role_id = ?',
      [user.id, roleId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: 'Role assignment not found.' });
    }

    const [roleRows] = await db.execute('SELECT role_name FROM user_roles WHERE id = ?', [roleId]);
    const roleName = roleRows.length > 0 ? roleRows[0].role_name : 'Unknown';
    
    await logActivity(
      getSessionUserId(req),
      'REMOVE_ROLE',
      'USER_ROLE',
      user.id,
      `Removed role ${roleName} from user: ${username}`
    );

    const roles = await getUserRoles(user.id);
    return res.json({ message: 'Role removed successfully.', roles });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to remove role.' });
  }
});

// Categories
app.get('/categories', requireAuth, async (req, res) => {
  try {
    const businessId = getSessionBusinessId(req);
    const [rows] = await db.execute(
      'SELECT id, name FROM categories WHERE business_id = ? ORDER BY name ASC',
      [businessId]
    );
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch categories.' });
  }
});

app.post('/categories', requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ message: 'Category name is required.' });
    }

    const businessId = getSessionBusinessId(req);
    const [result] = await db.execute('INSERT INTO categories (name, business_id) VALUES (?, ?)', [
      name,
      businessId
    ]);
    await logActivity(
      getSessionUserId(req),
      'ADD_CATEGORY',
      'CATEGORY',
      result.insertId,
      `${req.session.user?.username || 'Unknown'} added category: ${name}`
    );
    return res.status(201).json({ message: 'Category added successfully.', categoryId: result.insertId });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Category already exists.' });
    }
    return res.status(500).json({ message: 'Failed to add category.' });
  }
});

app.delete('/categories/:id', requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const parsedId = Number(req.params.id);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      return res.status(400).json({ message: 'Invalid category id.' });
    }

    const businessId = getSessionBusinessId(req);
    const [existingRows] = await db.execute('SELECT name FROM categories WHERE id = ? AND business_id = ?', [
      parsedId,
      businessId
    ]);
    const categoryName = existingRows[0]?.name;
    const [result] = await db.execute('DELETE FROM categories WHERE id = ? AND business_id = ?', [
      parsedId,
      businessId
    ]);
    if (!result.affectedRows) {
      return res.status(404).json({ message: 'Category not found.' });
    }
    await logActivity(
      getSessionUserId(req),
      'DELETE_CATEGORY',
      'CATEGORY',
      parsedId,
      `${req.session.user?.username || 'Unknown'} deleted category: ${categoryName || parsedId}`
    );
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
    const businessId = getSessionBusinessId(req);
    let sql = `
      SELECT p.id, p.name, p.quantity, p.price, p.expiry_date, p.created_at, c.id AS category_id, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id AND c.business_id = p.business_id
      WHERE p.business_id = ?
    `;
    const params = [businessId];

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

app.post('/products', requireRole(['admin', 'manager']), async (req, res) => {
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

    const businessId = getSessionBusinessId(req);
    const categoryName = await getCategoryNameByIdForBusiness(parsedCategoryId, businessId);
    if (!categoryName) {
      return res.status(400).json({ message: 'Invalid category.' });
    }

    const parsedExpiryDate = parseDateInput(expiry_date);
    if (!parsedExpiryDate.isValid) {
      return res.status(400).json({ message: 'Invalid expiry date.' });
    }

    const isPerishable = isPerishableCategoryName(categoryName);
    if (isPerishable && !parsedExpiryDate.value) {
      return res.status(400).json({ message: 'Expiry date is required for perishable products.' });
    }

    const finalExpiryDate = isPerishable ? parsedExpiryDate.value : null;

    const [result] = await db.execute(
      'INSERT INTO products (name, category_id, quantity, price, expiry_date, business_id) VALUES (?, ?, ?, ?, ?, ?)',
      [name, parsedCategoryId, parsedQuantity, parsedPrice, finalExpiryDate, businessId]
    );

    await logActivity(
      getSessionUserId(req),
      'ADD_PRODUCT',
      'PRODUCT',
      result.insertId,
      `${req.session.user?.username || 'Unknown'} added product: ${name} with quantity ${parsedQuantity}`
    );

    return res.status(201).json({ message: 'Product added successfully.', productId: result.insertId });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to add product.' });
  }
});

app.put('/products/:id', requireRole(['admin', 'manager']), async (req, res) => {
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

    const businessId = getSessionBusinessId(req);
    const categoryName = await getCategoryNameByIdForBusiness(parsedCategoryId, businessId);
    if (!categoryName) {
      return res.status(400).json({ message: 'Invalid category.' });
    }

    const parsedExpiryDate = parseDateInput(expiry_date);
    if (!parsedExpiryDate.isValid) {
      return res.status(400).json({ message: 'Invalid expiry date.' });
    }

    const isPerishable = isPerishableCategoryName(categoryName);
    if (isPerishable && !parsedExpiryDate.value) {
      return res.status(400).json({ message: 'Expiry date is required for perishable products.' });
    }

    const finalExpiryDate = isPerishable ? parsedExpiryDate.value : null;

    const [existingRows] = await db.execute('SELECT name FROM products WHERE id = ? AND business_id = ?', [
      parsedId,
      businessId
    ]);
    const existingProductName = existingRows[0]?.name || name;

    const [result] = await db.execute(
      'UPDATE products SET name = ?, category_id = ?, quantity = ?, price = ?, expiry_date = ? WHERE id = ? AND business_id = ?',
      [name, parsedCategoryId, parsedQuantity, parsedPrice, finalExpiryDate, parsedId, businessId]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    await logActivity(
      getSessionUserId(req),
      'UPDATE_PRODUCT',
      'PRODUCT',
      parsedId,
      `${req.session.user?.username || 'Unknown'} updated product: ${existingProductName} with quantity ${parsedQuantity}`
    );

    return res.json({ message: 'Product updated successfully.' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update product.' });
  }
});

app.delete('/products/:id', requireRole(['admin', 'manager']), async (req, res) => {
  try {
    const parsedId = Number(req.params.id);
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      return res.status(400).json({ message: 'Invalid product id.' });
    }

    const businessId = getSessionBusinessId(req);
    const [existingRows] = await db.execute('SELECT name FROM products WHERE id = ? AND business_id = ?', [
      parsedId,
      businessId
    ]);
    const productName = existingRows[0]?.name;
    const [result] = await db.execute('DELETE FROM products WHERE id = ? AND business_id = ?', [
      parsedId,
      businessId
    ]);
    if (!result.affectedRows) {
      return res.status(404).json({ message: 'Product not found.' });
    }
    await logActivity(
      getSessionUserId(req),
      'DELETE_PRODUCT',
      'PRODUCT',
      parsedId,
      `${req.session.user?.username || 'Unknown'} deleted product: ${productName || parsedId}`
    );
    return res.json({ message: 'Product deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to delete product.' });
  }
});

app.get('/products/export/csv', requireAuth, async (req, res) => {
  try {
    const { search = '', categoryId = '' } = req.query;
    const normalizedCategoryId = String(categoryId || '').trim().toLowerCase();
    const businessId = getSessionBusinessId(req);
    let sql = `
      SELECT p.id, p.name, p.quantity, p.price, p.expiry_date, p.created_at, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id AND c.business_id = p.business_id
      WHERE p.business_id = ?
    `;
    const params = [businessId];

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

app.get('/logs', requireAuth, async (req, res) => {
  try {
    const businessId = getSessionBusinessId(req);
    const currentUserId = getSessionUserId(req);
    const isAdmin = hasAnyRole(req, ['admin']);
    const isManager = hasAnyRole(req, ['manager']);
    const { type = '', action = '' } = req.query;

    console.debug(`[/logs] userId: ${currentUserId}, isAdmin: ${isAdmin}, isManager: ${isManager}, businessId: ${businessId}`);

    let sql = `
      SELECT
        al.id,
        al.user_id,
        COALESCE(
          (
            SELECT GROUP_CONCAT(DISTINCT ur.role_name ORDER BY ur.role_name SEPARATOR ', ')
            FROM user_role_assignment ura
            INNER JOIN user_roles ur ON ur.id = ura.role_id
            WHERE ura.user_id = al.user_id
          ),
          'N/A'
        ) AS role_name,
        al.action_type,
        al.entity_type,
        al.entity_id,
        al.description,
        al.created_at
      FROM activity_logs al
      WHERE al.business_id = ?
    `;
    const params = [businessId];

    if (!isAdmin && !isManager) {
      sql += ' AND al.user_id = ?';
      params.push(currentUserId);
      console.debug(`[/logs] Non-admin/manager: filtering to own logs only`);
    } else {
      console.debug(`[/logs] Admin/Manager: showing all business logs`);
    }

    sql += ' AND al.action_type NOT IN (?, ?)';
    params.push('LOGIN', 'LOGOUT');

    if (type) {
      sql += ' AND al.entity_type = ?';
      params.push(String(type).trim().toUpperCase());
    }

    if (action) {
      sql += ' AND al.action_type = ?';
      params.push(String(action).trim().toUpperCase());
    }

    sql += ' ORDER BY al.created_at DESC, al.id DESC';

    const [rows] = await db.execute(sql, params);
    return res.json(rows);
  } catch (error) {
    console.error('Failed to fetch activity logs:', error);
    return res.status(500).json({ message: 'Failed to fetch logs.' });
  }
});

// Dashboard
app.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const businessId = getSessionBusinessId(req);
    const [totalRows] = await db.execute('SELECT COUNT(*) AS total FROM products WHERE business_id = ?', [
      businessId
    ]);
    const [lowStockRows] = await db.execute(
      `SELECT p.id, p.name, p.quantity, p.price, p.expiry_date, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id AND c.business_id = p.business_id
       WHERE p.business_id = ? AND p.quantity < 10
       ORDER BY p.quantity ASC`,
      [businessId]
    );
    const [recentRows] = await db.execute(
      `SELECT p.id, p.name, p.quantity, p.price, p.expiry_date, p.created_at, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id AND c.business_id = p.business_id
       WHERE p.business_id = ?
       ORDER BY p.created_at DESC
       LIMIT 5`,
      [businessId]
    );
    const [expiringRows] = await db.execute(
      `SELECT p.id, p.name, p.quantity, p.price, p.expiry_date, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id AND c.business_id = p.business_id
       WHERE p.business_id = ?
         AND p.expiry_date IS NOT NULL
         AND DATEDIFF(p.expiry_date, CURDATE()) BETWEEN 0 AND 7
       ORDER BY p.expiry_date ASC`,
      [businessId]
    );
    const [valueRows] = await db.execute(
      'SELECT IFNULL(SUM(quantity * price), 0) AS totalValue FROM products WHERE business_id = ?',
      [businessId]
    );

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
ensureBusinessSchema()
  .then(() => ensureProductsExpiryColumn())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Server startup failed:', error.message);
    process.exit(1);
  });
