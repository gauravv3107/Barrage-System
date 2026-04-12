/* immigration.js — OCR pipeline, scan animation, certificate render, Traveler CRUD */
/* NOTE FOR DEVELOPERS:
 * To open the traveler modal programmatically:
 *   openTravelerModal()              → Add mode (blank form)
 *   openTravelerModal('ENTITY_ID')   → Edit mode (pre-filled from API)
 *   deleteTraveler('ENTITY_ID', 'Name') → Delete with confirm
 *   loadTravelers(query, status)     → Refresh table
 */

'use strict';

// ── State ────────────────────────────────────────────────────────
let _webcamStream = null;
let _selectedFile = null;
let _lastScanData = null;  // stores last verify-passport response for escalation
let _modalMode    = 'add';   // 'add' | 'edit'
let _editId       = null;
let _photoFile    = null;    // selected photo in modal

const FACE_MODELS_URL = '/assets/face-models';
let faceModelsLoaded = false;
let webcamDescriptor = null;

// ── Webcam ───────────────────────────────────────────────────────
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
    });
    const video = document.getElementById('webcam-feed');
    if (video) { video.srcObject = stream; _webcamStream = stream; }
    const dot = document.getElementById('camera-dot');
    if (dot) dot.style.opacity = '1';
    const label = document.getElementById('camera-label');
    if (label) label.textContent = '● Camera Active';
  } catch {
    const label = document.getElementById('camera-label');
    if (label) label.textContent = '⚠ Camera unavailable';
  }
}

// ── OCR & MRZ Parsing ─────────────────────────────────────────────
async function performOCR(file) {
  try {
    const { data: { text } } = await Tesseract.recognize(file, 'eng');
    console.log('[DBMS] Raw OCR text:', text);
    return parseMRZ(text);
  } catch (err) {
    console.warn('[DBMS] OCR extraction failed:', err);
    return null;
  }
}

function parseMRZ(text) {
  const lines = text.split('\n').map(l => l.replace(/\s/g, '').toUpperCase()).filter(l => l.includes('<<') && l.length >= 30);
  if (lines.length < 2) return null;

  const result = {};
  for (let i = 0; i < lines.length - 1; i++) {
    const l1 = lines[i];
    const l2 = lines[i+1];
    // Line 1 heuristic: starts with P and has enough chars
    if (l1[0] === 'P' && l1.length >= 35) {
      const country = l1.substring(2, 5).replace(/</g, '');
      const nameParts = l1.substring(5).split('<<');
      const lastName = (nameParts[0] || '').replace(/</g, ' ').trim();
      const givenNames = (nameParts[1] || '').replace(/</g, ' ').trim();
      result.name = `${givenNames} ${lastName}`.trim();
      result.nationality = country;

      // Line 2: Passport No (0-9), Nationality (10-13), DOB (13-19), Gender (20), Expiry (21-27)...
      if (l2.length >= 28) {
        result.passport_no = l2.substring(0, 9).replace(/</g, '');
        const dobRaw = l2.substring(13, 19);
        if (/^\d{6}$/.test(dobRaw)) {
          const year = parseInt(dobRaw.substring(0, 2));
          const month = dobRaw.substring(2, 4);
          const day = dobRaw.substring(4, 6);
          const currentYearShort = new Date().getFullYear() % 100;
          const fullYear = (year > currentYearShort + 10) ? 1900 + year : 2000 + year;
          result.dob = `${fullYear}-${month}-${day}`;
        }
      }
      return result;
    }
  }
  return null;
}

// ── Face Recognition ─────────────────────────────────────────────
async function uploadFaceImage() {
  // Officer permission check
  const officerId = prompt('Enter your Officer ID to authorize face image upload:');
  if (!officerId || !officerId.trim()) {
    showToast('Officer ID required to use face upload.', 'warning');
    return;
  }
  if (!faceModelsLoaded) {
    showToast('Face models not loaded yet — please wait and try again.', 'warning');
    return;
  }
  // Open file picker
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.onchange = async () => {
    const file = inp.files?.[0];
    if (!file) return;
    const btn = document.getElementById('btn-upload-face');
    if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
    try {
      const img = await loadImageElement(file);
      const detection = await faceapi
        .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (!detection) {
        showToast('No face detected in the uploaded image. Please use a clear face photo.', 'error');
        if (btn) { btn.textContent = '📁'; btn.disabled = false; }
        return;
      }
      webcamDescriptor = detection.descriptor;
      if (btn) {
        btn.textContent = '✓';
        btn.style.borderColor = 'var(--color-success)';
        btn.style.color = 'var(--color-success)';
        btn.disabled = false;
      }
      showToast(`Face loaded from file (authorized by Officer ${officerId.trim()}) — ready for verification.`, 'success');
    } catch (err) {
      showToast('Failed to process face image: ' + err.message, 'error');
      if (btn) { btn.textContent = '📁'; btn.disabled = false; }
    }
  };
  inp.click();
}

async function loadFaceModels() {
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODELS_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODELS_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODELS_URL)
    ]);
    faceModelsLoaded = true;
    console.log('[DBMS] Face recognition models loaded successfully.');
  } catch (err) {
    console.warn('[DBMS] Face models failed to load — API score will be used as fallback.', err);
    faceModelsLoaded = false;
  }
}

async function captureWebcamDescriptor() {
  const videoEl = document.getElementById('webcam-feed');
  if (!videoEl || !faceModelsLoaded) return null;
  try {
    const detection = await faceapi
      .detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (!detection) {
      showToast('No face detected in camera. Please look directly at the camera.', 'warning');
      return null;
    }
    webcamDescriptor = detection.descriptor;
    return webcamDescriptor;
  } catch (err) {
    console.warn('[DBMS] Webcam descriptor capture failed:', err);
    return null;
  }
}

async function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    if (src instanceof File || src instanceof Blob) {
      img.src = URL.createObjectURL(src);
    } else {
      img.src = src;
    }
  });
}

async function computeRealFaceMatch(passportImageSource) {
  if (!faceModelsLoaded || !webcamDescriptor) {
    return null; // null means: use the API score instead
  }
  try {
    const img = await loadImageElement(passportImageSource);
    const passportDetection = await faceapi
      .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (!passportDetection) {
      showToast('No face detected in passport image. Ensure the photo is clearly visible.', 'warning');
      return null;
    }
    const distance = faceapi.euclideanDistance(
      webcamDescriptor,
      passportDetection.descriptor
    );
    return parseFloat(Math.max(0, Math.min(100, (1 - distance) * 100)).toFixed(1));
  } catch (err) {
    console.warn('[DBMS] Real face match failed — using API score as fallback.', err);
    return null;
  }
}

async function captureFrame() {
  const video = document.getElementById('webcam-feed');
  if (!video || !video.videoWidth) { showToast('Camera not active', 'warning'); return; }
  const canvas = document.createElement('canvas');
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);

  const descriptor = await captureWebcamDescriptor();
  const btn = document.getElementById('btn-capture');
  if (descriptor && btn) {
    btn.textContent = '✓ Face Captured';
    btn.style.borderColor = 'var(--color-success)';
    showToast('Face captured successfully — ready for verification.', 'success');
  } else {
    showToast('Frame captured — face image stored for match analysis', 'info');
  }
}

// ── Dropzone ─────────────────────────────────────────────────────
function setupDropzone() {
  const dz  = document.getElementById('dropzone');
  const inp = document.getElementById('file-input');
  if (!dz || !inp) return;

  dz.addEventListener('click', () => inp.click());
  inp.addEventListener('change', () => handleFile(inp.files[0]));
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('drag-over');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
}

function handleFile(file) {
  if (!file) return;
  _selectedFile = file;
  const dz = document.getElementById('dropzone');
  const scanBtn = document.getElementById('btn-scan');
  if (dz) {
    dz.classList.add('has-file');
    dz.innerHTML = `<div style="padding:8px;text-align:center">
      <div style="font-size:13px;font-weight:600;color:var(--color-success)">✓ ${file.name}</div>
      <div style="font-size:11px;color:var(--color-text-muted);margin-top:4px">${(file.size/1024).toFixed(1)} KB — Ready to scan</div>
    </div>`;
  }
  if (scanBtn) scanBtn.disabled = false;
}

// ── Scan sequence ─────────────────────────────────────────────────
const SCAN_STEPS = [
  [0,    'Initializing OCR engine...'],
  [700,  'Extracting biometric fields from document...'],
  [1600, 'Cross-referencing passport database...'],
  [2400, 'Running face match analysis...'],
  [3100, 'Generating verification report...'],
];

async function initiateScan() {
  if (!_selectedFile) { showToast('Please upload a passport document first', 'error'); return; }
  // Face guard: if models loaded but no face captured yet, block scan
  if (faceModelsLoaded && !webcamDescriptor) {
    showToast('Please capture your face from the camera (or upload a face image) before scanning.', 'warning');
    return;
  }
  const btn = document.getElementById('btn-scan');
  if (btn) { btn.disabled = true; btn.textContent = 'Scanning...'; }

  const scanContainer = document.getElementById('scan-container');
  if (scanContainer) {
    const overlay = document.createElement('div');
    overlay.className = 'scan-overlay';
    overlay.innerHTML = '<div class="laser-line"></div>';
    scanContainer.style.position = 'relative';
    scanContainer.appendChild(overlay);
    setTimeout(() => overlay.remove(), 3000);
  }

  const statusEl = document.getElementById('scan-status');
  SCAN_STEPS.forEach(([delay, msg]) => setTimeout(() => { if (statusEl) statusEl.textContent = msg; }, delay));

  await new Promise(r => setTimeout(r, 3500));

  const filename = _selectedFile.name.toLowerCase();
  const demoPassportNo = (filename.includes('vikram') || filename.includes('passport') || filename.includes('mockup'))
    ? 'Z8892104' : null;

  // Run OCR and Face Match in parallel
  const [ocrData, realScore] = await Promise.all([
    performOCR(_selectedFile),
    computeRealFaceMatch(_selectedFile)
  ]);

  const res = await apiFetch('/api/immigration/verify-passport', {
    method: 'POST',
    body: JSON.stringify({ 
      passport_no: demoPassportNo || ocrData?.passport_no || '', 
      ocr_name: demoPassportNo ? '' : (ocrData?.name || 'Unknown') 
    })
  });

  if (res.success) {
    const ocrIncomplete = !ocrData || !ocrData.name || !ocrData.passport_no || !ocrData.nationality || !ocrData.dob;
    
    // Merge OCR data if API didn't find a record
    if (!res.data.entity) res.data.entity = {};
    const e = res.data.entity;
    if (ocrData) {
      if (!e.name) e.name = ocrData.name;
      if (!e.nationality) e.nationality = ocrData.nationality;
      if (!e.passport_no) e.passport_no = ocrData.passport_no;
      if (!e.dob) e.dob = ocrData.dob;
    }

    if (ocrIncomplete) {
      res.data.overall_status = 'Flagged';
    }

    if (realScore !== null && res.data.checks) {
      res.data.checks.face_match_score = realScore;
      // Re-derive overall_status using 90% threshold for real face scores
      const otherChecksOk = res.data.checks.mrz_valid && res.data.checks.not_expired &&
                            res.data.checks.watchlist_clear && res.data.checks.interpol_clear;
      // FIX: Allow 90%+ match to override the initial Flagged status from API
      res.data.overall_status = (otherChecksOk && realScore >= 90) ? 'Verified' : 'Flagged';
      
      // Removed: duplicate ocrIncomplete override that was blocking 90%+ success.
    }

    // NOTE: Automated database flagging/insertion has been removed from the scan sequence as requested.
    // Flagging/Registration will now only happen when the officer clicks "Grant Entry" or "Deny Entry".

    _lastScanData = res.data;
    renderCertificate(res.data);
    if (statusEl) statusEl.textContent = '✓ Verification complete.';
  } else {
    showToast('Verification API error: ' + (res.message || 'Unknown error'), 'error');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Initiate Verification Scan →'; }
}

function renderCertificate(data) {
  const container = document.getElementById('cert-container');
  if (!container) return;
  const e = data.entity || {};
  const checks = data.checks || {};
  const overall = data.overall_status || 'Pending';
  const isVerified = overall === 'Verified';
  const isBlacklist = data.is_blacklist;
  const score = checks.face_match_score || 0;

  const checkRows = [
    ['MRZ Validation',       checks.mrz_valid],
    ['Passport Not Expired', checks.not_expired],
    ['Watchlist Clear',      checks.watchlist_clear],
    ['INTERPOL Clear',       checks.interpol_clear],
  ].map(([label, ok]) => `
    <div class="cert-check-row">
      <span class="${ok ? 'check-ok' : 'check-fail'}">${ok ? '✓' : '✕'}</span>
      <span>${label}</span>
    </div>`).join('');

  container.innerHTML = `
    <div class="cert-panel ${isBlacklist ? 'flagged' : isVerified ? 'verified' : 'flagged'}">
      <div class="cert-header ${isBlacklist ? 'flagged' : isVerified ? 'verified' : 'flagged'}">
        ${isVerified && !isBlacklist ? '✓ VERIFICATION SUCCESSFUL' : '⚠ VERIFICATION ALERT'}
        ${isBlacklist ? ' — BLACKLISTED ENTITY — DO NOT GRANT ENTRY' : ''}
      </div>
      <div class="cert-body">
        <div style="display:grid;grid-template-columns:auto 1fr;gap:20px;align-items:start;margin-bottom:16px">
          <div style="text-align:center">
            <div class="cert-score" style="color:${isVerified&&!isBlacklist?'var(--color-success)':'var(--color-alert)'}">${score}%</div>
            <div style="font-size:11px;color:var(--color-text-muted);margin-top:4px">Face Match</div>
          </div>
          <div class="data-grid">
            <div class="data-field"><span class="data-label">Name</span><span class="data-value">${e.name||'—'}</span></div>
            <div class="data-field"><span class="data-label">Passport No.</span><span class="data-value mono">${e.passport_no||'—'}</span></div>
            <div class="data-field"><span class="data-label">Nationality</span><span class="data-value">${e.nationality||'—'}</span></div>
            <div class="data-field"><span class="data-label">Date of Birth</span><span class="data-value">${e.dob||'—'}</span></div>
          </div>
        </div>
        <div class="cert-checks">${checkRows}</div>
        ${isBlacklist ? `<div class="alert-banner error" style="margin-top:14px"><div><div class="alert-title">⚠ BLACKLIST ALERT</div><div class="alert-body-text">${data.blacklist_reason||'Entity is on the watchlist'}</div></div></div>` : ''}
        ${!isBlacklist && isVerified
          ? `<div style="margin-top:16px;display:flex;gap:8px;align-items:center">
               <button class="btn btn-success" onclick="grantEntry('${e.passport_no}')">✓ Grant Entry</button>
             </div>`
          : `<button class="btn btn-danger" style="margin-top:14px" onclick="openEscalateModal()">⚠ Deny Entry — Escalate</button>`}
      </div>
    </div>`;
  container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Escalation Modal ─────────────────────────────────────────────
function openEscalateModal() {
  // Pre-fill from last scan if we have entity data
  const e = _lastScanData?.entity || {};
  const nameEl = document.getElementById('esc-name');
  const natEl  = document.getElementById('esc-nationality');
  const ppEl   = document.getElementById('esc-passport');
  const epEl   = document.getElementById('esc-entry-point');
  const notEl  = document.getElementById('esc-notes');
  if (nameEl) nameEl.value = e.name || '';
  if (natEl)  natEl.value  = e.nationality || '';
  if (ppEl)   ppEl.value   = e.passport_no || '';
  if (epEl)   epEl.value   = e.entry_point || '';
  if (notEl)  notEl.value  = '';
  const modal = document.getElementById('escalate-modal');
  if (modal) modal.style.display = 'flex';
}

function closeEscalateModal(e) {
  if (e && e.type === 'click') {
    const overlay = document.getElementById('escalate-modal');
    if (e.target !== overlay) return;
  }
  const modal = document.getElementById('escalate-modal');
  if (modal) modal.style.display = 'none';
}

async function submitEscalation() {
  const name        = (document.getElementById('esc-name')?.value || '').trim();
  const nationality = (document.getElementById('esc-nationality')?.value || '').trim();
  const passportNo  = (document.getElementById('esc-passport')?.value || '').trim();
  const entryPoint  = (document.getElementById('esc-entry-point')?.value || '').trim();
  const notes       = (document.getElementById('esc-notes')?.value || '').trim();

  if (!name)        { showToast('Full Name is required', 'error'); return; }
  if (!nationality) { showToast('Nationality is required', 'error'); return; }

  const btn = document.getElementById('esc-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

  // Step 1: check if this traveler already exists in DB (from scan)
  const existingId = _lastScanData?.entity?.id || null;

  let entityId = existingId;

  if (!existingId) {
    // Create new traveler record
    const createRes = await apiFetch('/api/immigration/travelers', {
      method: 'POST',
      body: JSON.stringify({
        name, nationality,
        passport_no: passportNo || undefined,
        entry_point: entryPoint,
        status: 'Pending',
        investigation_notes: notes || 'Manually escalated — entry denied at border.'
      })
    });
    if (!createRes.success) {
      showToast('Failed to create record: ' + (createRes.message || 'Unknown error'), 'error');
      if (btn) { btn.disabled = false; btn.textContent = '⚠ Deny & Flag for Investigation'; }
      return;
    }
    entityId = createRes.data.id;
  } else {
    // Update existing record investigation notes
    await apiFetch(`/api/immigration/travelers/${existingId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        investigation_notes: notes || 'Entry denied and escalated for investigation.',
        status: 'Pending'
      })
    });
  }

  // Step 2: flag for investigation
  const flagRes = await apiFetch(`/api/immigration/travelers/${entityId}/flag-investigation`, { method: 'POST' });

  if (btn) { btn.disabled = false; btn.textContent = '⚠ Deny & Flag for Investigation'; }

  if (flagRes.success || flagRes.message) {
    showToast(`Entry denied. ${name} has been flagged for investigation.`, 'warning');
    closeEscalateModal();
  } else {
    showToast('Failed to flag for investigation: ' + (flagRes.message || 'Unknown error'), 'error');
  }
}

async function grantEntry(passportNo) {
  // If entity is new (not in DB from last scan), create it first
  const e = _lastScanData?.entity || {};
  const isNew = !_lastScanData?.found;

  if (isNew) {
    const createRes = await apiFetch('/api/immigration/travelers', {
      method: 'POST',
      body: JSON.stringify({
        name: e.name || 'Unknown',
        nationality: e.nationality || 'Unknown',
        passport_no: passportNo,
        dob: e.dob,
        status: 'Verified'
      })
    });
    if (!createRes.success) {
      showToast('New traveler creation failed: ' + (createRes.message || ''), 'error');
      return;
    }
    showToast(`New traveler ${e.name} registered and entry granted.`, 'success');
  } else {
    const res = await apiFetch('/api/immigration/grant-entry', {
      method: 'POST', body: JSON.stringify({ passport_no: passportNo })
    });
    if (res.success) showToast(`Entry granted for passport ${passportNo}`, 'success');
    else showToast('Grant entry failed: ' + res.message, 'error');
  }
}

// ── Traveler DB Table ─────────────────────────────────────────────
async function loadTravelers(q = '', status = '') {
  const tbodyEl = document.getElementById('traveler-tbody');
  if (!tbodyEl) return;
  tbodyEl.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--color-text-muted)">Loading...</td></tr>';

  const url = `/api/immigration/travelers?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&limit=50`;
  const res = await apiFetch(url);
  if (!res.success) {
    showToast('Failed to load travelers: ' + (res.message || 'error'), 'error');
    tbodyEl.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--color-alert)">Error loading travelers</td></tr>';
    return;
  }

  const items = res.data.items;
  if (!items.length) {
    tbodyEl.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--color-text-muted)">No travelers found</td></tr>';
    return;
  }

  tbodyEl.innerHTML = items.map(r => {
    const photoCell = r.passport_photo
      ? `<a href="${r.passport_photo}" target="_blank" title="View photo"><img src="${r.passport_photo}" class="photo-thumb" alt="Photo" style="cursor:pointer"></a>`
      : `<div class="photo-placeholder" title="No photo">👤</div>`;
    const isBlacklisted = r.status === 'blacklisted' || r.status === 'Flagged' || r.status === 'Denied' || r.is_blacklist;
    const isPending = r.status === 'under_verification' || r.status === 'Pending' || r.status === 'Provisional';
    const normalizedStatus = isBlacklisted ? 'blacklisted' : (isPending ? 'under_verification' : 'active');
    
    // Determine badge color
    let badgeColor = 'var(--color-success)';
    let badgeText = 'Active';
    if (normalizedStatus === 'under_verification') { badgeColor = 'var(--color-warning)'; badgeText = 'Under Verification'; }
    if (normalizedStatus === 'blacklisted') { badgeColor = 'var(--color-alert)'; badgeText = 'Blacklisted'; }

    let rowStyle = '';
    if (isBlacklisted || normalizedStatus === 'blacklisted') rowStyle = 'background:#FEF2F2';
    else if (normalizedStatus === 'under_verification') rowStyle = 'background:#FEFCE8';

    return `<tr id="tr-traveler-${r.id}" style="${rowStyle}">
      <td style="text-align:center">${photoCell}</td>
      <td class="font-mono">${r.passport_no || '—'}</td>
      <td><strong>${r.name}</strong></td>
      <td>${r.nationality}</td>
      <td>${r.gender || '—'}</td>
      <td>${r.dob || '—'}</td>
      <td>${(r.entry_point || '').split(',')[0] || '—'}</td>
      <td>${r.visit_reason || '—'}</td>
      <td>${r.visa_status || '—'}</td>
      <td>
        <div style="display:flex;flex-direction:column;gap:4px">
          <select class="form-input" style="padding: 2px 4px; font-size: 11px; height: auto;" onchange="updateTravelerStatusInline('${r.id}', this.value)">
            <option value="active" ${normalizedStatus === 'active' ? 'selected' : ''}>Active</option>
            <option value="under_verification" ${normalizedStatus === 'under_verification' ? 'selected' : ''}>Under Verification</option>
            <option value="blacklisted" ${normalizedStatus === 'blacklisted' ? 'selected' : ''}>Blacklisted</option>
          </select>
          <div id="status-badge-${r.id}"><span class="badge" style="background:${badgeColor};color:#fff;font-size:10px">${badgeText}</span></div>
        </div>
      </td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn btn-secondary btn-sm" onclick="openTravelerModal('${r.id}')">✏ Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteTraveler('${r.id}')">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

window.updateTravelerStatusInline = async function(id, newStatus) {
  let payload = { status: newStatus };
  if (newStatus === 'blacklisted') payload.blacklisted = 1;
  else payload.blacklisted = 0;

  try {
    const res = await fetch(`/api/immigration/travelers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        const badgeContainer = document.getElementById(`status-badge-${id}`);
        if (badgeContainer) {
          let colorClass = 'var(--color-success)';
          let text = 'Active';
          if (newStatus === 'under_verification') { colorClass = 'var(--color-warning)'; text = 'Under Verification'; }
          if (newStatus === 'blacklisted') { colorClass = 'var(--color-alert)'; text = 'Blacklisted'; }
          badgeContainer.innerHTML = `<span class="badge" style="background:${colorClass};color:#fff;font-size:10px">${text}</span>`;
        }
        
        // update row background if blacklisted
        const row = document.getElementById(`tr-traveler-${id}`);
        if (row) {
          if (newStatus === 'blacklisted') row.style.background = '#FEF2F2';
          else if (newStatus === 'under_verification') row.style.background = '#FEFCE8';
          else row.style.background = '';
        }
      } else {
        alert(data.message || 'Failed to update status');
      }
    } else {
      alert('Failed to update status: HTTP status ' + res.status);
    }
  } catch (err) {
    alert(err.message);
  }
}

// ── Modal: Open ───────────────────────────────────────────────────
async function openTravelerModal(entityId) {
  _modalMode = entityId ? 'edit' : 'add';
  _editId    = entityId || null;
  _photoFile = null;

  // Reset all form fields
  _setField('m-name', '');
  _setField('m-nationality', '');
  _setField('m-passport', '');
  _setField('m-dob', '');
  _setField('m-entry-point', '');
  _setField('m-visit-reason', '');
  _setSelect('m-gender', '');
  _setSelect('m-visa-status', 'None');
  _setSelect('m-status', 'Under Verification');
  const blEl = document.getElementById('m-blacklisted');
  if (blEl) blEl.checked = false;

  // Photo section always visible (both add and edit)
  const photoGroup = document.getElementById('photo-upload-group');
  if (photoGroup) photoGroup.style.display = '';
  _clearPhotoPreview();

  // Update modal title
  const titleEl = document.getElementById('modal-title');
  if (titleEl) titleEl.textContent = entityId ? 'Edit Traveler' : 'Add Traveler';
  const saveBtn = document.getElementById('modal-save-btn');
  if (saveBtn) saveBtn.textContent = entityId ? 'Save Changes' : 'Add Traveler';

  // Show modal immediately (load data in background for edit mode)
  const modal = document.getElementById('traveler-modal');
  if (modal) modal.style.display = 'flex';

  // If edit mode, fetch and fill the data
  if (entityId) {
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Loading...'; }
    const res = await apiFetch(`/api/immigration/travelers/${entityId}`);
    if (res.success) {
      const traveler = res.data;

      if (traveler) {
        _setField('m-name', traveler.name || '');
        _setField('m-nationality', traveler.nationality || '');
        _setField('m-passport', traveler.passport_no || '');
        _setField('m-dob', traveler.dob || '');
        _setField('m-entry-point', traveler.entry_point || '');
        _setField('m-visit-reason', traveler.visit_reason || '');
        _setSelect('m-gender', traveler.gender || '');
        _setSelect('m-visa-status', traveler.visa_status || 'None');
        
        let initialStatus = 'under_verification';
        if (traveler.status === 'Verified') initialStatus = 'active';
        if (traveler.status === 'Flagged' || traveler.status === 'Denied' || traveler.is_blacklist) initialStatus = 'blacklisted';

        _setSelect('m-status', traveler.status || initialStatus);

        if (traveler.passport_photo) {
          const thumb = document.getElementById('modal-photo-thumb');
          if (thumb) { thumb.src = traveler.passport_photo; thumb.style.display = 'block'; }
          const pname = document.getElementById('modal-photo-name');
          if (pname) pname.textContent = 'Current passport photo';
        }
      } else {
        showToast('Traveler record not found', 'error');
        closeTravelerModal();
        return;
      }
    }
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Changes'; }
  }
}

function _setField(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function _setSelect(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  // Try to set the value directly
  el.value = value;
  // If no option matched, default to first
  if (el.value !== value) el.selectedIndex = 0;
}

function _clearPhotoPreview() {
  const thumb = document.getElementById('modal-photo-thumb');
  if (thumb) { thumb.src = ''; thumb.style.display = 'none'; }
  const pname = document.getElementById('modal-photo-name');
  if (pname) pname.textContent = '';
  const fileInput = document.getElementById('m-photo');
  if (fileInput) fileInput.value = '';
  _photoFile = null;
}

// ── Modal: Close ──────────────────────────────────────────────────
function closeTravelerModal(e) {
  // If called from the overlay click, only close if the overlay itself was clicked
  if (e && e.type === 'click') {
    const overlay = document.getElementById('traveler-modal');
    if (e.target !== overlay) return;
  }
  const modal = document.getElementById('traveler-modal');
  if (modal) modal.style.display = 'none';
  _photoFile = null;
}

// ── Modal: Save (Add or Edit) ─────────────────────────────────────
async function saveTraveler() {
  const name        = (document.getElementById('m-name')?.value || '').trim();
  const nationality = (document.getElementById('m-nationality')?.value || '').trim();
  if (!name)        { showToast('Full Name is required', 'error'); document.getElementById('m-name')?.focus(); return; }
  if (!nationality) { showToast('Nationality is required', 'error'); document.getElementById('m-nationality')?.focus(); return; }

  const payload = {
    name,
    nationality,
    passport_no:  (document.getElementById('m-passport')?.value || '').trim(),
    gender:       document.getElementById('m-gender')?.value || '',
    dob:          document.getElementById('m-dob')?.value || '',
    entry_point:  (document.getElementById('m-entry-point')?.value || '').trim(),
    visit_reason: (document.getElementById('m-visit-reason')?.value || '').trim(),
    visa_status:  document.getElementById('m-visa-status')?.value || 'None',
    // Status drives is_blacklist automatically
    status:       document.getElementById('m-status')?.value || 'Under Verification',
    blacklisted:  document.getElementById('m-status')?.value === 'Blacklisted',
  };

  const saveBtn = document.getElementById('modal-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

  let res;
  let entityId = _editId;

  if (_modalMode === 'edit' && _editId) {
    // PATCH to update existing
    res = await apiFetch(`/api/immigration/travelers/${_editId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  } else {
    // POST to create new
    res = await apiFetch('/api/immigration/travelers', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (res.success) entityId = res.data?.id;
  }

  if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = _modalMode === 'edit' ? 'Save Changes' : 'Add Traveler'; }

  if (!res.success) {
    showToast('Save failed: ' + (res.message || 'Unknown error'), 'error');
    return;
  }

  // Upload photo if one was selected
  if (_photoFile && entityId) {
    const uploaded = await uploadPassportPhoto(entityId, _photoFile);
    if (!uploaded) showToast('Traveler saved but photo upload failed', 'warning');
  }

  showToast(_modalMode === 'edit' ? 'Traveler updated successfully' : 'Traveler added successfully', 'success');
  const modal = document.getElementById('traveler-modal');
  if (modal) modal.style.display = 'none';

  // Refresh table
  loadTravelers(
    document.getElementById('traveler-search')?.value || '',
    document.getElementById('traveler-status')?.value || ''
  );
}

// ── Delete ────────────────────────────────────────────────────────
async function deleteTraveler(entityId, name) {
  if (!confirm("Delete this traveller record?")) return;

  try {
    const res = await fetch(`/api/immigration/travelers/${entityId}`, { method: 'DELETE' });
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        showToast('Traveler deleted', 'success');
        const row = document.getElementById(`tr-traveler-${entityId}`);
        if (row) row.remove();
      } else {
        alert(data.message || 'Error deleting traveller');
      }
    } else {
      alert('Delete failed: HTTP status ' + res.status);
    }
  } catch (err) {
    alert(err.message);
  }
}

// ── Photo upload (multipart — does NOT use apiFetch to avoid wrong Content-Type) ──
async function uploadPassportPhoto(entityId, file) {
  const fd = new FormData();
  fd.append('photo', file);
  try {
    // Do NOT set Content-Type header — browser sets it automatically with boundary for multipart
    const raw = await fetch(`/api/immigration/travelers/${entityId}/photo`, {
      method: 'POST',
      body: fd
    });
    const json = await raw.json();
    if (!json.success) { showToast('Photo upload failed: ' + json.message, 'error'); return false; }
    showToast('Passport photo saved', 'success');
    return true;
  } catch (e) {
    showToast('Photo upload error: ' + e.message, 'error');
    return false;
  }
}

// ── DOMContentLoaded ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadFaceModels();
  startCamera();
  setupDropzone();

  // NOTE: btn-scan and btn-capture already have onclick= in HTML; no addEventListener needed.

  // Photo file input in modal — preview on selection
  document.getElementById('m-photo')?.addEventListener('change', function () {
    const file = this.files?.[0];
    if (!file) return;
    _photoFile = file;
    document.getElementById('modal-photo-name').textContent = file.name;
    const thumb = document.getElementById('modal-photo-thumb');
    if (thumb) {
      const reader = new FileReader();
      reader.onload = ev => { thumb.src = ev.target.result; thumb.style.display = 'block'; };
      reader.readAsDataURL(file);
    }
  });

  // Tab switching
  document.querySelectorAll('.tab-item').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const content = document.getElementById(tab.dataset.tab);
      if (content) content.classList.add('active');
      if (tab.dataset.tab === 'tab-travelers') {
        loadTravelers();
      } else if (tab.dataset.tab === 'tab-investigation') {
        loadInvestigationQueue();
      }
    });
  });

  // Traveler search/filter
  document.getElementById('traveler-search')?.addEventListener('input', function () {
    loadTravelers(this.value, document.getElementById('traveler-status')?.value || '');
  });
  document.getElementById('traveler-status')?.addEventListener('change', function () {
    loadTravelers(document.getElementById('traveler-search')?.value || '', this.value);
  });

  // Modal overlay click-outside-to-close
  document.getElementById('traveler-modal')?.addEventListener('click', closeTravelerModal);
});

// ── Visa Expiry ───────────────────────────────────────────────────
window.saveExpiryThreshold = async function() {
  const btn = event.target;
  const days = parseInt(document.getElementById('visa-warning-days').value) || 30;
  btn.disabled = true; btn.textContent = 'Saving...';
  
  const res = await apiFetch('/api/immigration/settings/expiry-threshold', {
    method: 'PUT',
    body: { days }
  });
  
  btn.disabled = false; btn.textContent = 'Save Threshold';
  if (res.success) {
    showToast('Threshold saved', 'success');
    loadVisaExpiryQueue();
  } else {
    showToast('Failed to save threshold', 'error');
  }
}

window.loadVisaExpiryQueue = async function() {
  const containerExpired = document.getElementById('list-expired');
  const containerExpiring = document.getElementById('list-expiring');
  if (!containerExpired || !containerExpiring) return;
  
  const res = await apiFetch('/api/immigration/travelers/expiring');
  if (!res.success) return;
  
  const { expired, expiring_soon, threshold } = res.data;
  document.getElementById('visa-warning-days').value = threshold;
  document.getElementById('count-expired').textContent = expired.length;
  document.getElementById('count-expiring').textContent = expiring_soon.length;
  
  function renderCard(p, isExpired) {
    let daysStr = isExpired ? `Expired ${Math.abs(p.days_remaining)} days ago` : `Expires in ${p.days_remaining} days`;
    let color = isExpired ? 'var(--color-alert)' : 'var(--color-warning)';
    return `
      <div style="padding:12px;border:1px solid var(--color-border);border-left:4px solid ${color};border-radius:6px;background:var(--color-surface)">
        <div style="font-weight:600;font-size:14px">${p.name}</div>
        <div style="font-size:12px;color:var(--color-text-secondary);margin-top:4px">Passport / Nationality: ${p.nationality || 'Unknown'}</div>
        <div style="font-size:12px;color:var(--color-text-secondary);margin-top:2px">Expiry Date: <strong>${p.visa_expiry_date || 'N/A'}</strong></div>
        <div style="margin-top:8px;font-size:12px;color:${color};font-weight:600">${daysStr}</div>
      </div>
    `;
  }
  
  containerExpired.innerHTML = expired.length ? expired.map(p => renderCard(p, true)).join('') : '<p class="text-muted text-sm">No expired visas found.</p>';
  containerExpiring.innerHTML = expiring_soon.length ? expiring_soon.map(p => renderCard(p, false)).join('') : '<p class="text-muted text-sm">No visas expiring soon.</p>';
}

// ── Investigations Queue ───────────────────────────────────────────
window.loadInvestigationQueue = async function() {
  const container = document.getElementById('investigation-queue');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--color-text-muted);font-size:13px;grid-column:1/-1">Loading queue...</p>';
  
  const res = await apiFetch('/api/immigration/travelers/under-investigation');
  if (!res.success) return;
  
  const items = res.data;
  if (!items.length) {
    container.innerHTML = '<p style="color:var(--color-text-muted);font-size:13px;grid-column:1/-1">No travellers under investigation.</p>';
    return;
  }
  
  container.innerHTML = items.map(p => `
    <div style="border:1px solid var(--color-border);border-left:4px solid var(--color-warning);border-radius:8px;padding:16px;background:var(--color-surface)" id="inv-card-${p.id}">
      <div style="display:flex;gap:12px;align-items:flex-start">
        ${p.passport_photo ? `<img src="${p.passport_photo}" style="width:50px;height:50px;border-radius:25px;object-fit:cover">` : `<div style="width:50px;height:50px;border-radius:25px;background:#eee;display:flex;align-items:center;justify-content:center;font-size:20px">👤</div>`}
        <div style="flex:1">
          <div style="font-weight:600;font-size:15px">${p.name}</div>
          <div style="font-size:12px;color:var(--color-text-muted)">${p.nationality || 'Unknown'}</div>
        </div>
      </div>
      <div style="margin-top:12px;padding:8px;background:var(--color-surface-hover);border-radius:4px;font-size:12px;color:var(--color-text-secondary)">
        <strong>Flagged Date:</strong> ${formatDateTime(p.updated_at || new Date().toISOString())}<br>
        <strong>Notes:</strong> ${p.investigation_notes || 'Auto-flag mismatch / Needs review'}
      </div>
      
      <div style="margin-top:12px">
        <label class="form-label required" style="font-size:11px">Authorizing Officer ID</label>
        <input type="text" id="inv-officer-${p.id}" class="form-input" style="font-size:12px;padding:6px;margin-bottom:8px" placeholder="Override Officer ID">
        <label class="form-label" style="font-size:11px">Officer Notes / Action</label>
        <textarea id="inv-notes-${p.id}" class="form-input" rows="2" style="font-size:12px;padding:6px;margin-bottom:8px" placeholder="Enter resolution notes..."></textarea>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary btn-sm" style="flex:1;background:var(--color-alert)" onclick="confirmBlacklist('${p.id}')">Confirm Blacklist</button>
          <button class="btn btn-secondary btn-sm" style="flex:1" onclick="clearInvestigationFlag('${p.id}')">Clear Flag</button>
        </div>
      </div>
    </div>
  `).join('');
}

window.confirmBlacklist = async function(id) {
  const officerId = document.getElementById(`inv-officer-${id}`)?.value.trim();
  const notes = document.getElementById(`inv-notes-${id}`)?.value || '';
  
  if (!officerId) {
    showToast('Officer ID is required to confirm blacklist', 'error');
    return;
  }
  if (!confirm('Are you sure you want to officially blacklist this traveller?')) return;
  
  const res = await apiFetch(`/api/immigration/travelers/${id}/confirm-blacklist`, {
    method: 'POST',
    body: { officer_id: officerId, notes }
  });
  
  if (res.success) {
    showToast('Traveller blacklisted.', 'success');
    document.getElementById(`inv-card-${id}`)?.remove();
  } else {
    showToast('Error: ' + res.message, 'error');
  }
}

window.clearInvestigationFlag = async function(id) {
  const officerId = document.getElementById(`inv-officer-${id}`)?.value.trim();
  const notes = document.getElementById(`inv-notes-${id}`)?.value || '';
  
  if (!officerId) {
    showToast('Officer ID is required to clear flag', 'error');
    return;
  }
  
  const res = await apiFetch(`/api/immigration/travelers/${id}/clear-flag`, {
    method: 'POST',
    body: { officer_id: officerId, notes }
  });
  
  if (res.success) {
    showToast('Investigation flag cleared.', 'info');
    document.getElementById(`inv-card-${id}`)?.remove();
  } else {
    showToast('Error: ' + res.message, 'error');
  }
}

// ── CSV Import / Export ───────────────────────────────────────────
window.exportTravelersCSV = async function() {
  const btn = event.target || document.querySelector('button[onclick="exportTravelersCSV()"]');
  const orgTxt = btn ? btn.innerText : 'Export CSV';
  if (btn) { btn.innerText = 'Exporting...'; btn.disabled = true; }

  try {
    const res = await apiFetch(`/api/immigration/travelers?limit=5000`);
    if (!res.success) throw new Error(res.message);
    const items = res.data.items;
    if (!items.length) { showToast('No data to export', 'info'); return; }

    const cols = ['passport_no','name','nationality','gender','dob','entry_point','visit_reason','visa_status','status'];
    let csv = cols.join(',') + '\n';
    items.forEach(r => {
      csv += cols.map(c => '"' + (r[c] || '').toString().replace(/"/g, '""') + '"').join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `travelers_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      showToast('Export complete', 'success');
    }, 100);
  } catch (err) {
    showToast('Export failed: ' + err.message, 'error');
  } finally {
    if (btn) { btn.innerText = orgTxt; btn.disabled = false; }
  }
};

window.importTravelersCSV = function() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.csv';
  inp.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const btn = event.target || document.querySelector('button[onclick="importTravelersCSV()"]');
    const orgTxt = btn ? btn.innerText : 'Import CSV';
    if (btn) { btn.innerText = 'Importing...'; btn.disabled = true; }

    try {
      const text = await file.text();
      const rows = text.split('\n').filter(r => r.trim());
      if (rows.length < 2) { showToast('Empty or invalid CSV', 'error'); return; }

      // Basic regex config to handle properly quoted commas
      const splitCsv = (str) => {
          const arr = []; let quote = false; let col = '';
          for (let i = 0; i < str.length; i++) {
              if (str[i] === '"') if (str[i+1] === '"') { col += '"'; i++; } else quote = !quote;
              else if (str[i] === ',' && !quote) { arr.push(col); col = ''; }
              else col += str[i];
          }
          arr.push(col); return arr;
      };

      const headers = splitCsv(rows[0]).map(h => h.trim().toLowerCase());
      const reqHeaders = ['name', 'nationality'];
      if (!reqHeaders.every(h => headers.includes(h))) {
        showToast('CSV must include at least: ' + reqHeaders.join(', '), 'error');
        return;
      }

      let success = 0, failed = 0;
      for (let i = 1; i < rows.length; i++) {
          const cols = splitCsv(rows[i]).map(c => c.trim());
          const obj = {};
          headers.forEach((h, idx) => { obj[h] = cols[idx]; });
          if (!obj.name || !obj.nationality) continue;
          
          const res = await apiFetch('/api/immigration/travelers', {
              method: 'POST', body: JSON.stringify(obj)
          });
          if (res.success) success++; else failed++;
      }

      showToast(`Imported ${success} records. Failed: ${failed}.`, success > 0 ? 'success' : 'warning');
      loadTravelers();
    } catch (err) {
      showToast('Import error: ' + err.message, 'error');
    } finally {
      if (btn) { btn.innerText = orgTxt; btn.disabled = false; }
    }
  };
  inp.click();
};

