function showTextMessage(element, text, isError) {
  if (!element) return;
  element.textContent = text;
  element.style.color = isError ? '#b42318' : '#067647';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let csrfToken = '';
let csrfTokenPromise = null;

async function ensureCsrfToken() {
  if (csrfToken) return csrfToken;

  if (!csrfTokenPromise) {
    csrfTokenPromise = fetch('/auth/csrf', { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('Unable to load CSRF token');
        }

        const data = await response.json();
        if (!data.csrfToken) {
          throw new Error('CSRF token was not returned by the server');
        }

        csrfToken = data.csrfToken;
        return csrfToken;
      })
      .finally(() => {
        csrfTokenPromise = null;
      });
  }

  return csrfTokenPromise;
}

async function fetchWithCsrf(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    await ensureCsrfToken();
    headers.set('x-csrf-token', csrfToken);
  }

  return fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers
  });
}

function initPasswordToggles() {
  const buttons = document.querySelectorAll('.password-toggle[data-target]');
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const targetId = button.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (!input) return;

      const isHidden = input.type === 'password';
      input.type = isHidden ? 'text' : 'password';
      button.textContent = isHidden ? 'Hide' : 'Show';
    });
  });
}

function initLoginPage() {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const showLoginBtn = document.getElementById('showLoginBtn');
  const showRegisterBtn = document.getElementById('showRegisterBtn');
  const authMessage = document.getElementById('authMessage');
  const loginBusinessName = document.getElementById('loginBusinessName');

  if (!loginForm || !registerForm) return;
  initPasswordToggles();
  ensureCsrfToken().catch(() => {});

  async function loadBusinesses() {
    if (!loginBusinessName) return;

    try {
      const response = await fetch('/auth/businesses', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Unable to load businesses');

      const businesses = await response.json();
      loginBusinessName.innerHTML = '<option value="">Select your business</option>';
      businesses.forEach((business) => {
        const option = document.createElement('option');
        option.value = business.name;
        option.textContent = business.name;
        loginBusinessName.appendChild(option);
      });

      if (!businesses.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No businesses available';
        option.disabled = true;
        loginBusinessName.appendChild(option);
      }
    } catch (error) {
      loginBusinessName.innerHTML = '<option value="">Unable to load businesses</option>';
      loginBusinessName.disabled = true;
    }
  }

  loadBusinesses().catch(() => {});

  function showLogin() {
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    showLoginBtn.classList.add('active');
    showRegisterBtn.classList.remove('active');
    authMessage.textContent = '';
  }

  function showRegister() {
    registerForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    showRegisterBtn.classList.add('active');
    showLoginBtn.classList.remove('active');
    authMessage.textContent = '';
  }

  showLoginBtn.addEventListener('click', showLogin);
  showRegisterBtn.addEventListener('click', showRegister);

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('loginUsername').value.trim();
    const businessName = loginBusinessName ? loginBusinessName.value.trim() : '';
    const password = document.getElementById('loginPassword').value.trim();

    if (username.length < 3 || businessName.length < 2 || password.length < 6) {
      return showTextMessage(authMessage, 'Please enter a valid username, business name, and password.', true);
    }

    try {
      const response = await fetchWithCsrf('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, businessName, password })
      });

      const data = await response.json();
      if (!response.ok) {
        return showTextMessage(authMessage, data.message || 'Login failed.', true);
      }

      window.location.href = '/app';
    } catch (error) {
      showTextMessage(authMessage, 'Network error while logging in.', true);
    }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('registerUsername').value.trim();
    const password = document.getElementById('registerPassword').value.trim();
    const businessName = document.getElementById('registerBusinessName').value.trim();

    if (username.length < 3 || password.length < 6 || businessName.length < 2) {
      return showTextMessage(authMessage, 'Enter a username, business name, and password with valid length.', true);
    }

    try {
      const response = await fetchWithCsrf('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, businessName })
      });

      const data = await response.json();
      if (!response.ok) {
        return showTextMessage(authMessage, data.message || 'Registration failed.', true);
      }

      showTextMessage(authMessage, 'Registration successful. Please login now.', false);
      registerForm.reset();
      showLogin();
    } catch (error) {
      showTextMessage(authMessage, 'Network error while registering.', true);
    }
  });
}

function initDashboardPage() {
  const sections = document.querySelectorAll('.panel');
  const navButtons = document.querySelectorAll('.nav-btn[data-section]');
  const roleRestrictedElements = document.querySelectorAll('[data-role-only]');
  const globalMessage = document.getElementById('globalMessage');
  const welcomeText = document.getElementById('welcomeText');
  const notificationOverlay = document.getElementById('notificationOverlay');
  const notificationList = document.getElementById('notificationList');
  const closeNotificationBtn = document.getElementById('closeNotificationBtn');

  const productForm = document.getElementById('productForm');
  const productIdInput = document.getElementById('productId');
  const productNameInput = document.getElementById('productName');
  const productCategoryInput = document.getElementById('productCategory');
  const productQuantityInput = document.getElementById('productQuantity');
  const productPriceInput = document.getElementById('productPrice');
  const productExpiryInput = document.getElementById('productExpiry');
  const cancelEditBtn = document.getElementById('cancelEditBtn');
  const saveProductBtn = document.getElementById('saveProductBtn');

  const searchInput = document.getElementById('searchInput');
  const categoryFilter = document.getElementById('categoryFilter');
  const exportCsvBtn = document.getElementById('exportCsvBtn');

  const categoryForm = document.getElementById('categoryForm');
  const categoryNameInput = document.getElementById('categoryName');

  const roleForm = document.getElementById('roleForm');
  const roleUsernameInput = document.getElementById('roleUsername');
  const roleNameInput = document.getElementById('roleName');
  const roleLookupUsernameInput = document.getElementById('roleLookupUsername');
  const roleLookupRoleFilter = document.getElementById('roleLookupRoleFilter');
  const exportTeamCsvBtn = document.getElementById('exportTeamCsvBtn');
  const userRolesBody = document.getElementById('userRolesBody');
  const teamUsernamesList = document.getElementById('teamUsernames');
  const activityLogsBody = document.getElementById('activityLogsBody');

  const teamForm = document.getElementById('teamForm');
  const teamUsernameInput = document.getElementById('teamUsername');
  const teamPasswordInput = document.getElementById('teamPassword');
  const teamRoleInput = document.getElementById('teamRole');

  const productsBody = document.getElementById('productsBody');
  const categoriesBody = document.getElementById('categoriesBody');
  const lowStockProductsBody = document.getElementById('lowStockProductsBody');
  const expiringProductsBody = document.getElementById('expiringProductsBody');
  const recentProductsBody = document.getElementById('recentProductsBody');

  const totalProductsEl = document.getElementById('totalProducts');
  const inventoryValueEl = document.getElementById('inventoryValue');

  const logoutBtn = document.getElementById('logoutBtn');

  if (!productForm || !logoutBtn) return;

  ensureCsrfToken().catch(() => {});

  let currentSearch = '';
  let currentCategoryFilter = '';
  let categoriesCache = [];
  let currentUser = { roles: [] };
  let roleAssignmentsCache = [];
  let currentRoleLookupUsername = '';
  let currentRoleLookupRoleFilter = '';
  let teamSearchTouched = false;

  if (closeNotificationBtn) {
    closeNotificationBtn.addEventListener('click', hideNotificationPopup);
  }

  if (notificationOverlay) {
    notificationOverlay.addEventListener('click', (e) => {
      if (e.target === notificationOverlay) {
        hideNotificationPopup();
      }
    });
  }

  function showMessage(text, isError) {
    showTextMessage(globalMessage, text, !!isError);
  }

  function hideNotificationPopup() {
    if (!notificationOverlay) return;

    notificationOverlay.classList.add('hidden');
    notificationOverlay.setAttribute('aria-hidden', 'true');
  }

  function showNotificationPopup(notifications) {
    if (!notificationOverlay || !notificationList) return;

    if (!notifications.length) {
      hideNotificationPopup();
      notificationList.innerHTML = '';
      return;
    }

    notificationList.innerHTML = notifications
      .map((notification) => {
        const kind = notification.message.includes('expiring soon') ? 'warning' : 'low-stock';
        return '<div class="notification-item ' + kind + '">' +
          '<strong>' + escapeHtml(notification.title || 'Inventory alert') + '</strong>' +
          '<p>' + escapeHtml(notification.message || '') + '</p>' +
        '</div>';
      })
      .join('');

    notificationOverlay.classList.remove('hidden');
    notificationOverlay.setAttribute('aria-hidden', 'false');
  }

  async function loadInventoryNotifications() {
    try {
      const response = await fetch('/notifications/inventory-alerts', { credentials: 'same-origin' });
      if (!response.ok) return;

      const notifications = await response.json();
      showNotificationPopup(notifications);

      if (notifications.length) {
        await fetchWithCsrf('/notifications/inventory-alerts/read', { method: 'POST' });
      }
    } catch (error) {
      hideNotificationPopup();
    }
  }

  function getUserRoles() {
    return Array.isArray(currentUser.roles) ? currentUser.roles : [];
  }

  function hasRole(roleName) {
    return getUserRoles().includes(roleName);
  }

  function hasAnyRole(roleNames) {
    return roleNames.some((roleName) => hasRole(roleName));
  }

  function canManageInventory() {
    return hasAnyRole(['admin', 'manager']);
  }

  function canManageRoles() {
    return hasRole('admin');
  }

  function canManageTeam() {
    return hasAnyRole(['admin', 'manager']);
  }

  function canViewActivityLogs() {
    return hasAnyRole(['admin', 'manager']);
  }

  function getAssignableTeamRoles() {
    if (hasRole('admin')) {
      return ['manager', 'staff'];
    }

    if (hasRole('manager')) {
      return ['staff'];
    }

    return [];
  }

  function applyRoleVisibility() {
    roleRestrictedElements.forEach((element) => {
      const allowedRoles = String(element.getAttribute('data-role-only') || '')
        .split(',')
        .map((role) => role.trim())
        .filter(Boolean);
      const visible = allowedRoles.length === 0 || allowedRoles.some((role) => hasRole(role));
      element.classList.toggle('hidden', !visible);
    });

    const inventoryLocked = !canManageInventory();
    const rolesLocked = !canManageRoles();

    [productForm, categoryForm, roleForm, teamForm].forEach((form) => {
      if (!form) return;
      form.querySelectorAll('input, select, button').forEach((field) => {
        if (field.closest('#teamForm')) {
          field.disabled = !canManageTeam();
          return;
        }

        if (field.closest('#roleForm')) {
          field.disabled = rolesLocked;
          return;
        }

        if (field.closest('#categoryForm')) {
          field.disabled = !hasAnyRole(['admin', 'manager']);
          return;
        }

        if (field.closest('#productForm')) {
          field.disabled = inventoryLocked;
        }
      });
    });

    const productButtons = document.querySelectorAll('[data-edit-product], [data-delete-product]');
    productButtons.forEach((button) => {
      button.disabled = inventoryLocked;
      button.classList.toggle('hidden', inventoryLocked);
    });

    const categoryButtons = document.querySelectorAll('[data-delete-category]');
    categoryButtons.forEach((button) => {
      button.disabled = !hasAnyRole(['admin', 'manager']);
      button.classList.toggle('hidden', !hasAnyRole(['admin', 'manager']));
    });
  }

  function getDefaultSectionForUser() {
    return 'dashboardSection';
  }

  function switchSection(sectionId) {
    sections.forEach((section) => {
      section.classList.toggle('visible', section.id === sectionId);
    });
    navButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.section === sectionId);
    });
  }

  function formatINR(value) {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR'
    }).format(value);
  }

  function isGroceriesByCategoryId(categoryId) {
    const category = categoriesCache.find((item) => String(item.id) === String(categoryId));
    if (!category) return false;

    const normalizedCategoryName = category.name.trim().toLowerCase();
    return ['groceries', 'grocery', 'dairy'].includes(normalizedCategoryName);
  }

  function formatExpiryDate(expiryDate) {
    if (!expiryDate) return '-';
    const date = new Date(expiryDate);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString();
  }

  function isExpiryWarning(product) {
    const normalizedCategoryName = String(product?.category_name || '').trim().toLowerCase();
    if (!product || !['groceries', 'grocery', 'dairy'].includes(normalizedCategoryName) || !product.expiry_date) {
      return false;
    }

    const expiryDate = new Date(product.expiry_date);
    if (Number.isNaN(expiryDate.getTime())) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiryDate.setHours(0, 0, 0, 0);

    const diffDays = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays <= 7;
  }

  function renderExpiryCell(product) {
    const formattedDate = formatExpiryDate(product.expiry_date);
    if (formattedDate === '-') return '-';

    if (isExpiryWarning(product)) {
      return '<span class="expiry-warning">' + escapeHtml(formattedDate) + '</span>';
    }

    return escapeHtml(formattedDate);
  }

  async function checkSession() {
    const response = await fetch('/auth/session', { credentials: 'same-origin' });
    if (!response.ok) {
      window.location.href = '/login';
      return;
    }

    const data = await response.json();
    currentUser = data.user || { roles: [] };
    const roleLabel = getUserRoles().length ? getUserRoles().join(', ') : 'no roles assigned';
    const businessLabel = currentUser.business_name ? ' @ ' + currentUser.business_name : '';
    welcomeText.textContent = 'Logged in as: ' + currentUser.username + businessLabel + ' (' + roleLabel + ')';
    applyRoleVisibility();
  }

  async function loadAvailableRoles() {
    if (!roleNameInput || !canManageRoles()) return;

    const response = await fetch('/roles', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Unable to load roles');

    const roles = await response.json();
    roleNameInput.innerHTML = '';
    roles.forEach((role) => {
      const option = document.createElement('option');
      option.value = role.role_name;
      option.textContent = role.role_name;
      roleNameInput.appendChild(option);
    });
  }

  async function loadTeamUsers() {
    if (!teamUsernamesList || !canManageTeam()) return;

    const response = await fetch('/team/users', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Unable to load team users');

    const rows = await response.json();
    roleAssignmentsCache = rows;
    const usernames = Array.from(
      new Set(rows.map((row) => String(row.username || '').trim()).filter(Boolean))
    ).sort((left, right) => left.localeCompare(right));

    teamUsernamesList.innerHTML = '';
    usernames.forEach((username) => {
      const option = document.createElement('option');
      option.value = username;
      teamUsernamesList.appendChild(option);
    });

    populateRoleLookupFilters(rows);
    renderUserRoles(rows);
  }

  function populateTeamRoles() {
    if (!teamRoleInput || !canManageTeam()) return;

    const roles = getAssignableTeamRoles();
    teamRoleInput.innerHTML = '';
    roles.forEach((role) => {
      const option = document.createElement('option');
      option.value = role;
      option.textContent = role;
      teamRoleInput.appendChild(option);
    });
  }

  function renderUserRoles(rows) {
    if (!userRolesBody) return;

    const visibleRows = getVisibleTeamRows(rows);
    const adminUserCount = rows.filter((row) => hasAdminRole(row)).length;

    userRolesBody.innerHTML = '';
    if (!visibleRows.length) {
      const row = document.createElement('tr');
      row.innerHTML = '<td colspan="4">No users found.</td>';
      userRolesBody.appendChild(row);
      return;
    }

    visibleRows.forEach((role) => {
      const isProtectedUser = String(role.is_owner) === '1' || (hasAdminRole(role) && adminUserCount <= 1);
      const actionCell = isProtectedUser
        ? '<button class="btn-danger" type="button" disabled title="This admin account cannot be removed.">Protected</button>'
        : '<button class="btn-danger" data-delete-user="' + encodeURIComponent(role.username || '') + '">Remove User</button>';
      const row = document.createElement('tr');
      row.innerHTML =
        '<td>' + escapeHtml(role.username || '-') + '</td>' +
        '<td>' + escapeHtml(role.roles || '-') + '</td>' +
        '<td>' + formatAssignedAt(role.assigned_at) + '</td>' +
        '<td>' + actionCell + '</td>';
      userRolesBody.appendChild(row);
    });

    applyRoleVisibility();
  }

  function formatAssignedAt(value) {
    if (!value) return '-';

    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return escapeHtml(date.toLocaleString());
    }

    return escapeHtml(String(value));
  }

  function getVisibleTeamRows(rows) {
    const filteredRows = currentRoleLookupRoleFilter
      ? rows.filter((role) => String(role.roles || '').toLowerCase().includes(currentRoleLookupRoleFilter.toLowerCase()))
      : rows;

    const searchTerm = teamSearchTouched ? currentRoleLookupUsername.trim().toLowerCase() : '';
    if (!searchTerm) return filteredRows;

    return filteredRows.filter((row) => {
      const username = String(row.username || '').toLowerCase();
      const roleName = String(row.roles || '').toLowerCase();
      return username.includes(searchTerm) || roleName.includes(searchTerm);
    });
  }

  function hasAdminRole(row) {
    return String(row?.roles || '')
      .split(',')
      .map((role) => role.trim().toLowerCase())
      .includes('admin');
  }

  function downloadCsv(filename, rows) {
    const csvLines = [
      ['Username', 'Role', 'Assigned At'].join(','),
      ...rows.map((row) => {
        const values = [row.username, row.roles, formatCsvDate(row.assigned_at)].map((value) => {
          if (value === undefined || value === null || value === '') {
            return '""';
          }

          const safeValue = String(value ?? '').replace(/"/g, '""');
          return '"' + safeValue + '"';
        });
        return values.join(',');
      })
    ];

    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function formatCsvDate(value) {
    if (!value) return '';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value).slice(0, 10);
    }

    return date.toISOString().slice(0, 10);
  }

  function populateRoleLookupFilters(rows) {
    if (!roleLookupRoleFilter) return;

    const uniqueRoles = Array.from(
      new Set(
        rows
          .flatMap((role) => String(role.roles || '').split(',').map((value) => value.trim()))
          .filter(Boolean)
      )
    ).sort((left, right) => left.localeCompare(right));

    const existingFilter = currentRoleLookupRoleFilter;
    roleLookupRoleFilter.innerHTML = '<option value="">All Roles</option>';
    uniqueRoles.forEach((roleName) => {
      const option = document.createElement('option');
      option.value = roleName;
      option.textContent = roleName;
      roleLookupRoleFilter.appendChild(option);
    });

    if (existingFilter && uniqueRoles.includes(existingFilter)) {
      roleLookupRoleFilter.value = existingFilter;
    } else {
      currentRoleLookupRoleFilter = '';
      roleLookupRoleFilter.value = '';
    }

    roleLookupRoleFilter.disabled = uniqueRoles.length === 0;
  }

  function renderActivityLogs(rows) {
    if (!activityLogsBody) return;

    activityLogsBody.innerHTML = '';
    if (!rows.length) {
      const row = document.createElement('tr');
      row.innerHTML = '<td colspan="3">No activity logs found.</td>';
      activityLogsBody.appendChild(row);
      return;
    }

    rows.forEach((logItem) => {
      const row = document.createElement('tr');
      row.innerHTML =
        '<td>' + escapeHtml(logItem.role_name || '-') + '</td>' +
        '<td>' + escapeHtml(logItem.description || '-') + '</td>' +
        '<td>' + (logItem.created_at ? new Date(logItem.created_at).toLocaleString() : '-') + '</td>';
      activityLogsBody.appendChild(row);
    });
  }

  async function loadCategories() {
    const response = await fetch('/categories', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Unable to load categories');

    const categories = await response.json();
    categoriesCache = categories;
    productCategoryInput.innerHTML = '<option value="">Select Category</option>';
    categoryFilter.innerHTML = '<option value="">All Categories</option>';
    categoriesBody.innerHTML = '';

    categories.forEach((category) => {
      const option1 = document.createElement('option');
      option1.value = category.id;
      option1.textContent = category.name;
      productCategoryInput.appendChild(option1);

      const option2 = document.createElement('option');
      option2.value = category.id;
      option2.textContent = category.name;
      categoryFilter.appendChild(option2);

      const row = document.createElement('tr');
      row.innerHTML =
        '<td>' + escapeHtml(category.name) + '</td>' +
        '<td><button class="btn-danger" data-delete-category="' + category.id + '">Delete</button></td>';
      categoriesBody.appendChild(row);
    });

    applyRoleVisibility();
  }

  async function loadProducts() {
    const query = new URLSearchParams();
    if (currentSearch) {
      query.set('search', currentSearch);
    }
    if (currentCategoryFilter) {
      query.set('categoryId', currentCategoryFilter);
    }

    const response = await fetch('/products?' + query.toString(), { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Unable to load products');

    const products = await response.json();
    productsBody.innerHTML = '';

    products.forEach((product) => {
      const row = document.createElement('tr');
      if (product.quantity < 10) row.classList.add('low-stock-row');

      row.innerHTML =
        '<td>' + escapeHtml(product.name) + '</td>' +
        '<td>' + escapeHtml(product.category_name || '-') + '</td>' +
        '<td>' + product.quantity + '</td>' +
        '<td>' + formatINR(product.price) + '</td>' +
        '<td>' + renderExpiryCell(product) + '</td>' +
        '<td>' +
        '<button class="btn-secondary" data-edit-product="' + encodeURIComponent(JSON.stringify(product)) + '">Edit</button> ' +
        '<button class="btn-danger" data-delete-product="' + product.id + '">Delete</button>' +
        '</td>';
      productsBody.appendChild(row);
    });

    applyRoleVisibility();
  }

  async function loadDashboard() {
    const response = await fetch('/dashboard', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Unable to load dashboard');

    const data = await response.json();
    totalProductsEl.textContent = data.totalProducts;
    inventoryValueEl.textContent = formatINR(data.totalInventoryValue);

    lowStockProductsBody.innerHTML = '';
    data.lowStockItems.forEach((product) => {
      const row = document.createElement('tr');
      row.classList.add('low-stock-row');
      row.innerHTML =
        '<td>' + escapeHtml(product.name) + '</td>' +
        '<td>' + escapeHtml(product.category_name || '-') + '</td>' +
        '<td>' + product.quantity + '</td>' +
        '<td>' + formatINR(product.price) + '</td>' +
        '<td>' + renderExpiryCell(product) + '</td>';
      lowStockProductsBody.appendChild(row);
    });

    expiringProductsBody.innerHTML = '';
    data.expiringProducts.forEach((product) => {
      const row = document.createElement('tr');
      row.innerHTML =
        '<td>' + escapeHtml(product.name) + '</td>' +
        '<td>' + escapeHtml(product.category_name || '-') + '</td>' +
        '<td>' + product.quantity + '</td>' +
        '<td>' + formatINR(product.price) + '</td>' +
        '<td>' + renderExpiryCell(product) + '</td>';
      expiringProductsBody.appendChild(row);
    });

    recentProductsBody.innerHTML = '';
    data.recentProducts.forEach((product) => {
      const row = document.createElement('tr');
      row.innerHTML =
        '<td>' + escapeHtml(product.name) + '</td>' +
        '<td>' + escapeHtml(product.category_name || '-') + '</td>' +
        '<td>' + product.quantity + '</td>' +
        '<td>' + formatINR(product.price) + '</td>' +
        '<td>' + renderExpiryCell(product) + '</td>' +
        '<td>' + new Date(product.created_at).toLocaleString() + '</td>';
      recentProductsBody.appendChild(row);
    });
  }

  function resetProductForm() {
    productForm.reset();
    productIdInput.value = '';
    productExpiryInput.value = '';
    saveProductBtn.textContent = 'Add Product';
    cancelEditBtn.classList.add('hidden');
  }

  async function refreshAll() {
    await Promise.all([
      loadCategories(),
      loadProducts(),
      loadDashboard()
    ]);
    if (canManageTeam()) {
      loadTeamUsers().catch(() => {
        roleAssignmentsCache = [];
        renderUserRoles([]);
      });
    }
    if (canViewActivityLogs()) {
      await loadActivityLogs();
    }
  }

  async function loadActivityLogs() {
    if (!activityLogsBody || !canViewActivityLogs()) return;

    try {
      const response = await fetch('/logs', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Unable to load activity logs');

      const rows = await response.json();
      renderActivityLogs(rows);
    } catch (error) {
      renderActivityLogs([]);
    }
  }

  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => switchSection(btn.dataset.section));
  });

  if (roleLookupUsernameInput) {
    roleLookupUsernameInput.addEventListener('input', () => {
      teamSearchTouched = true;
      currentRoleLookupUsername = roleLookupUsernameInput.value.trim();
      renderUserRoles(roleAssignmentsCache);
    });
  }

  if (roleLookupRoleFilter) {
    roleLookupRoleFilter.addEventListener('change', () => {
      currentRoleLookupRoleFilter = roleLookupRoleFilter.value;
      renderUserRoles(roleAssignmentsCache);
    });
  }

  if (exportTeamCsvBtn) {
    exportTeamCsvBtn.addEventListener('click', () => {
      downloadCsv('team-users.csv', getVisibleTeamRows(roleAssignmentsCache));
    });
  }

  if (teamForm) {
    teamForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      if (!canManageTeam()) {
        return showMessage('You do not have permission to create team members.', true);
      }

      const username = teamUsernameInput.value.trim();
      const password = teamPasswordInput.value.trim();
      const roleName = teamRoleInput.value;

      if (username.length < 3 || password.length < 6 || !roleName) {
        return showMessage('Enter a valid username, password, and role.', true);
      }

      try {
        const response = await fetchWithCsrf('/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, roleName })
        });

        const data = await response.json();
        if (!response.ok) return showMessage(data.message || 'Failed to create user.', true);

        showMessage(data.message, false);
        teamForm.reset();
        populateTeamRoles();
        await loadTeamUsers();
      } catch (error) {
        showMessage('Network error while creating user.', true);
      }
    });
  }

  productForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!canManageInventory()) {
      return showMessage('You do not have permission to manage products.', true);
    }

    const payload = {
      name: productNameInput.value.trim(),
      category_id: productCategoryInput.value,
      quantity: Number(productQuantityInput.value),
      price: Number(productPriceInput.value),
      expiry_date: productExpiryInput.value
    };

    if (!payload.name || !payload.category_id || payload.quantity < 0 || payload.price < 0) {
      return showMessage('Please fill all product fields with valid values.', true);
    }

    if (isGroceriesByCategoryId(payload.category_id) && !payload.expiry_date) {
      return showMessage('Expiry date is required for perishable products.', true);
    }

    const id = productIdInput.value;

    try {
      const response = await fetchWithCsrf(id ? '/products/' + id : '/products', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!response.ok) return showMessage(data.message || 'Failed to save product.', true);

      showMessage(data.message, false);
      resetProductForm();
      await refreshAll();
      switchSection('productsSection');
    } catch (error) {
      showMessage('Network error while saving product.', true);
    }
  });

  cancelEditBtn.addEventListener('click', resetProductForm);

  productsBody.addEventListener('click', async (e) => {
    const editData = e.target.getAttribute('data-edit-product');
    const deleteId = e.target.getAttribute('data-delete-product');

    if (e.target.getAttribute('data-remove-role')) return;

    if (editData) {
      if (!canManageInventory()) {
        return showMessage('You do not have permission to edit products.', true);
      }

      const product = JSON.parse(decodeURIComponent(editData));
      productIdInput.value = product.id;
      productNameInput.value = product.name;
      productCategoryInput.value = product.category_id || '';
      productQuantityInput.value = product.quantity;
      productPriceInput.value = product.price;
      productExpiryInput.value = product.expiry_date ? String(product.expiry_date).slice(0, 10) : '';
      saveProductBtn.textContent = 'Update Product';
      cancelEditBtn.classList.remove('hidden');
      switchSection('productsSection');
    }

    if (deleteId) {
      if (!canManageInventory()) {
        return showMessage('You do not have permission to delete products.', true);
      }

      if (!window.confirm('Delete this product?')) return;

      try {
        const response = await fetchWithCsrf('/products/' + deleteId, { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok) return showMessage(data.message || 'Failed to delete product.', true);

        showMessage(data.message, false);
        await refreshAll();
      } catch (error) {
        showMessage('Network error while deleting product.', true);
      }
    }
  });

  searchInput.addEventListener('input', async () => {
    currentSearch = searchInput.value.trim();
    await loadProducts();
  });

  categoryFilter.addEventListener('change', async () => {
    currentCategoryFilter = categoryFilter.value;
    await loadProducts();
  });

  exportCsvBtn.addEventListener('click', () => {
    const query = new URLSearchParams();
    if (currentSearch) {
      query.set('search', currentSearch);
    }
    if (currentCategoryFilter) {
      query.set('categoryId', currentCategoryFilter);
    }
    window.location.href = '/products/export/csv?' + query.toString();
  });

  categoryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!hasAnyRole(['admin', 'manager'])) {
      return showMessage('You do not have permission to manage categories.', true);
    }

    const name = categoryNameInput.value.trim();
    if (!name) return showMessage('Category name is required.', true);

    try {
      const response = await fetchWithCsrf('/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });

      const data = await response.json();
      if (!response.ok) return showMessage(data.message || 'Failed to add category.', true);

      showMessage(data.message, false);
      categoryForm.reset();
      await refreshAll();
      switchSection('categoriesSection');
    } catch (error) {
      showMessage('Network error while adding category.', true);
    }
  });

  categoriesBody.addEventListener('click', async (e) => {
    const categoryId = e.target.getAttribute('data-delete-category');
    if (!categoryId) return;
    if (!hasAnyRole(['admin', 'manager'])) {
      return showMessage('You do not have permission to delete categories.', true);
    }
    if (!window.confirm('Delete this category?')) return;

    try {
      const response = await fetchWithCsrf('/categories/' + categoryId, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) return showMessage(data.message || 'Failed to delete category.', true);

      showMessage(data.message, false);
      await refreshAll();
    } catch (error) {
      showMessage('Network error while deleting category.', true);
    }
  });

  if (roleForm) {
    roleForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!canManageRoles()) {
        return showMessage('You do not have permission to manage roles.', true);
      }

      const username = roleUsernameInput.value.trim();
      const roleName = roleNameInput.value;

      if (!username || !roleName) {
        return showMessage('Please enter a valid username and role.', true);
      }

      try {
        const response = await fetchWithCsrf('/users/by-username/' + encodeURIComponent(username) + '/roles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roleName })
        });

        const data = await response.json();
        if (!response.ok) return showMessage(data.message || 'Failed to assign role.', true);

        showMessage(data.message, false);
        await loadAvailableRoles();
        await loadTeamUsers();
      } catch (error) {
        showMessage('Network error while assigning role.', true);
      }
    });
  }

  if (userRolesBody) {
    userRolesBody.addEventListener('click', async (e) => {
      const deleteUser = e.target.getAttribute('data-delete-user');
      if (!deleteUser) return;

      if (!canManageRoles()) {
        return showMessage('You do not have permission to remove users.', true);
      }

      const username = decodeURIComponent(deleteUser);
      if (!window.confirm('Delete user "' + username + '" from the database?')) return;

      try {
        const response = await fetchWithCsrf('/users/by-username/' + encodeURIComponent(username), {
          method: 'DELETE',
        });

        const data = await response.json();
        if (!response.ok) return showMessage(data.message || 'Failed to delete user.', true);

        showMessage(data.message, false);
        if (roleLookupUsernameInput && roleLookupUsernameInput.value.trim().toLowerCase() === username.toLowerCase()) {
          roleLookupUsernameInput.value = '';
          currentRoleLookupUsername = '';
          teamSearchTouched = false;
        }
        await loadTeamUsers();
      } catch (error) {
        showMessage('Network error while deleting user.', true);
      }
    });
  }

  logoutBtn.addEventListener('click', async () => {
    try {
      await fetchWithCsrf('/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    } catch (error) {
      showMessage('Network error while logging out.', true);
    }
  });

  (async function init() {
    try {
      await checkSession();
      await refreshAll();
      await loadInventoryNotifications();
      populateTeamRoles();
      if (canManageRoles()) {
        await loadAvailableRoles();
      }
      switchSection(getDefaultSectionForUser());
      applyRoleVisibility();
    } catch (error) {
      showMessage('Unable to load data. Please login again.', true);
      setTimeout(() => {
        window.location.href = '/login';
      }, 800);
    }
  })();
}

initLoginPage();
initDashboardPage();
