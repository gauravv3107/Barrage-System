const CONFIG = {
  API_BASE_URL: 'http://127.0.0.1:5050' // Use explicit IP to avoid CORS mismatch
};

async function apiFetch(endpoint, options = {}) {
  const url = `${CONFIG.API_BASE_URL}${endpoint}`;
  
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const token = sessionStorage.getItem('ngo_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const config = {
    ...options,
    headers,
  };

  try {
    const response = await fetch(url, config);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('API Error:', error);
    return { success: false, message: 'Network or server error' };
  }
}

function authGuard() {
  const token = sessionStorage.getItem('ngo_token');
  const role = sessionStorage.getItem('ngo_role');
  if (!token || !role) {
    window.location.href = 'index.html';
  }
}

function logout() {
  sessionStorage.removeItem('ngo_token');
  sessionStorage.removeItem('ngo_role');
  sessionStorage.removeItem('ngo_id');
  sessionStorage.removeItem('ngo_name_user');
  window.location.href = 'index.html';
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerText = message;
  
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    padding: '12px 24px',
    backgroundColor: type === 'success' ? '#059669' : '#DC2626',
    color: 'white',
    borderRadius: '4px',
    zIndex: '9999',
    opacity: '0',
    transition: 'opacity 0.3s'
  });

  document.body.appendChild(toast);
  
  setTimeout(() => toast.style.opacity = '1', 10);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
