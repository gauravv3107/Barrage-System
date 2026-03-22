/* auth.js — Login flow, sessionStorage management, RBAC guard */

function enforceRBAC() {
  const session = getSession();
  const path    = window.location.pathname;
  const pubPages = ['/index.html', '/', ''];

  if (pubPages.includes(path)) return; // Login page — no guard

  if (!session.role) {
    window.location.href = '/index.html';
    return;
  }
  // Refugee: only allowed on refugee-portal
  // Redirect to refugee portal (not logout/index) so clicking any sidebar link
  // still lands them in the right place instead of signing them out.
  if (session.role === 'refugee' && !path.includes('refugee-portal')) {
    window.location.href = '/pages/refugee-portal.html';
    return;
  }
  // NGO: only ngo-portal and refugee-portal (read-only view)
  if (session.role === 'ngo' && !path.includes('ngo-portal') && !path.includes('refugee-portal')) {
    window.location.href = '/pages/ngo-portal.html';
    return;
  }
  // Authority users can access all portals — no redirect
}

function renderSidebarUser() {
  const session = getSession();
  const el = document.getElementById('sidebar-user-info');
  if (!el || !session.role) return;
  const roleLabel = {
    authority: `${session.sub_role || 'Officer'} — ${session.force || ''}`,
    ngo:       'NGO User',
    refugee:   'Refugee Portal'
  }[session.role] || session.role;
  el.innerHTML = `<strong>${session.user_id || 'Officer'}</strong>${roleLabel}`;
}

function setupLogout() {
  const btn = document.getElementById('logout-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    sessionStorage.removeItem('dbms_session');
    window.location.href = '/index.html';
  });
}

function startLiveClock() {
  const el = document.getElementById('live-clock');
  if (!el) return;
  const tick = () => {
    const now = new Date();
    el.textContent = now.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12: false }) +
      ' IST · ' + now.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  };
  tick();
  setInterval(tick, 1000);
}

function setupLangPills() {
  document.querySelectorAll('.lang-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      if (window.i18n) window.i18n.switch(btn.dataset.lang);
    });
  });
}

function setActiveNav() {
  const path = window.location.pathname;
  document.querySelectorAll('.nav-item').forEach(item => {
    const href = item.getAttribute('href') || '';
    if (href && path.includes(href.replace('/index.html','').replace('.html','').split('/').pop())) {
      item.classList.add('active');
    }
  });
}

// ── Login Page Logic ──────────────────────────────────────────
function initLoginPage() {
  const subRoleBtns = document.querySelectorAll('.sub-role-btn[data-subrole]');
  let selectedSubRole = null;
  let selectedForce   = null;

  subRoleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      subRoleBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedSubRole = btn.dataset.subrole;

      // Show/hide force selector
      const forceExpand = document.getElementById('force-expand');
      if (forceExpand) {
        forceExpand.classList.toggle('open', selectedSubRole === 'border_patrol');
      }
    });
  });

  // Force selector
  const forceSelect = document.getElementById('force-select');
  if (forceSelect) {
    forceSelect.addEventListener('change', () => { selectedForce = forceSelect.value; });
  }

  // Proceed buttons
  document.querySelectorAll('[data-proceed]').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.proceed;

      let role = 'authority', subRole = type, force = '';
      let target = '';

      if (type === 'border_patrol') {
        force  = forceSelect ? forceSelect.value : 'BSF';
        if (!force) { showToast('Please select a force', 'error'); return; }
        const slug = FORCE_SLUGS[force] || 'bsf';
        target = `/pages/border-patrol/${slug}.html`;
      } else if (type === 'sea_marshall') {
        target = '/pages/sea-marshall.html';
      } else if (type === 'immigration_officer') {
        target = '/pages/immigration.html';
      } else if (type === 'ngo') {
        role = 'ngo'; subRole = 'ngo';
        target = '/pages/ngo-portal.html';
      } else if (type === 'refugee') {
        role = 'refugee'; subRole = 'refugee';
        target = '/pages/refugee-portal.html';
      }

      sessionStorage.setItem('dbms_session', JSON.stringify({
        role, sub_role: subRole, force,
        user_id: `DEMO-${type.toUpperCase().slice(0,4)}`,
        logged_in: true
      }));
      window.location.href = target;
    });
  });
}

// ── Shared init ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const isLoginPage = window.location.pathname.endsWith('index.html') ||
                      window.location.pathname === '/';
  if (isLoginPage) {
    initLoginPage();
  } else {
    enforceRBAC();
    renderSidebarUser();
    setupLogout();
    startLiveClock();
    setupLangPills();
    setActiveNav();
    if (window.i18n) window.i18n.init();
  }
});
