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

  if (!loginForm || !registerForm) return;
  initPasswordToggles();

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
    const password = document.getElementById('loginPassword').value.trim();

    if (username.length < 3 || password.length < 6) {
      return showTextMessage(authMessage, 'Please enter a valid username and password.', true);
    }

    try {
      const response = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();
      if (!response.ok) {
        return showTextMessage(authMessage, data.message || 'Login failed.', true);
      }

      window.location.href = '/';
    } catch (error) {
      showTextMessage(authMessage, 'Network error while logging in.', true);
    }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('registerUsername').value.trim();
    const password = document.getElementById('registerPassword').value.trim();

    if (username.length < 3 || password.length < 6) {
      return showTextMessage(authMessage, 'Username must be 3+ chars and password 6+ chars.', true);
    }

    try {
      const response = await fetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
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
  const globalMessage = document.getElementById('globalMessage');
  const welcomeText = document.getElementById('welcomeText');

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

  const productsBody = document.getElementById('productsBody');
  const categoriesBody = document.getElementById('categoriesBody');
  const lowStockProductsBody = document.getElementById('lowStockProductsBody');
  const expiringProductsBody = document.getElementById('expiringProductsBody');
  const recentProductsBody = document.getElementById('recentProductsBody');

  const totalProductsEl = document.getElementById('totalProducts');
  const inventoryValueEl = document.getElementById('inventoryValue');

  const logoutBtn = document.getElementById('logoutBtn');

  if (!productForm || !logoutBtn) return;

  let currentSearch = '';
  let currentCategoryFilter = '';
  let categoriesCache = [];

  function showMessage(text, isError) {
    showTextMessage(globalMessage, text, !!isError);
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
    return !!category && category.name.trim().toLowerCase() === 'groceries';
  }

  function formatExpiryDate(expiryDate) {
    if (!expiryDate) return '-';
    const date = new Date(expiryDate);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString();
  }

  function isExpiryWarning(product) {
    if (!product || String(product.category_name || '').trim().toLowerCase() !== 'groceries' || !product.expiry_date) {
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
    const response = await fetch('/auth/session');
    if (!response.ok) {
      window.location.href = '/login';
      return;
    }

    const data = await response.json();
    welcomeText.textContent = 'Logged in as: ' + data.user.username;
  }

  async function loadCategories() {
    const response = await fetch('/categories');
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
  }

  async function loadProducts() {
    const query = new URLSearchParams();
    if (currentSearch) {
      query.set('search', currentSearch);
    }
    if (currentCategoryFilter) {
      query.set('categoryId', currentCategoryFilter);
    }

    const response = await fetch('/products?' + query.toString());
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
  }

  async function loadDashboard() {
    const response = await fetch('/dashboard');
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
    await loadCategories();
    await loadProducts();
    await loadDashboard();
  }

  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => switchSection(btn.dataset.section));
  });

  productForm.addEventListener('submit', async (e) => {
    e.preventDefault();

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
      return showMessage('Expiry date is required for groceries products.', true);
    }

    const id = productIdInput.value;

    try {
      const response = await fetch(id ? '/products/' + id : '/products', {
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

    if (editData) {
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
      if (!window.confirm('Delete this product?')) return;

      try {
        const response = await fetch('/products/' + deleteId, { method: 'DELETE' });
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
    const name = categoryNameInput.value.trim();
    if (!name) return showMessage('Category name is required.', true);

    try {
      const response = await fetch('/categories', {
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
    if (!window.confirm('Delete this category?')) return;

    try {
      const response = await fetch('/categories/' + categoryId, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) return showMessage(data.message || 'Failed to delete category.', true);

      showMessage(data.message, false);
      await refreshAll();
    } catch (error) {
      showMessage('Network error while deleting category.', true);
    }
  });

  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    } catch (error) {
      showMessage('Network error while logging out.', true);
    }
  });

  (async function init() {
    try {
      await checkSession();
      await refreshAll();
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
