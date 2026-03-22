/* map.js — Leaflet setup, custom markers, popup builder */

const ALL_MARKERS = [
  // Airports
  { name:'IGI Airport, Delhi',    coords:[28.5562,77.1000], type:'airport',  module:'/pages/immigration.html' },
  { name:'CSIA Mumbai',            coords:[19.0896,72.8656], type:'airport',  module:'/pages/immigration.html' },
  { name:'KIA Bengaluru',          coords:[13.1989,77.7068], type:'airport',  module:'/pages/immigration.html' },
  { name:'NSCBI Kolkata',          coords:[22.6520,88.4463], type:'airport',  module:'/pages/immigration.html' },
  { name:'Chennai International',  coords:[12.9941,80.1709], type:'airport',  module:'/pages/immigration.html' },
  // Seaports
  { name:'JNPT, Navi Mumbai',      coords:[18.9499,72.9507], type:'seaport', module:'/pages/sea-marshall.html' },
  { name:'Kandla Port, Gujarat',   coords:[23.0364,70.2185], type:'seaport', module:'/pages/sea-marshall.html' },
  { name:'Kochi Port, Kerala',     coords:[9.9634, 76.2625], type:'seaport', module:'/pages/sea-marshall.html' },
  { name:'Chennai Port',           coords:[13.0844,80.2899], type:'seaport', module:'/pages/sea-marshall.html' },
  { name:'Visakhapatnam Port',     coords:[17.6976,83.2982], type:'seaport', module:'/pages/sea-marshall.html' },
  { name:'Kolkata Port',           coords:[22.5412,88.3304], type:'seaport', module:'/pages/sea-marshall.html' },
  // Land borders
  { name:'Attari-Wagah, Punjab',   coords:[31.6040,74.5723], type:'land', module:'/pages/border-patrol/bsf.html' },
  { name:'Petrapole Land Port',    coords:[23.0388,88.8757], type:'land', module:'/pages/border-patrol/bsf.html' },
  { name:'Dawki-Tamabil, Meghalaya', coords:[25.1866,92.0163], type:'land', module:'/pages/border-patrol/bsf.html' },
  { name:'Raxaul-Birgunj, Bihar', coords:[26.9806,84.8517], type:'land', module:'/pages/border-patrol/ssb.html' },
  { name:'Sunauli-Bhairahawa, UP',coords:[27.4393,83.4566], type:'land', module:'/pages/border-patrol/ssb.html' },
  { name:'Jaigaon-Phuentsholing', coords:[26.8500,89.3833], type:'land', module:'/pages/border-patrol/ssb.html' },
  { name:'Moreh-Tamu, Manipur',   coords:[24.2425,94.3060], type:'land', module:'/pages/border-patrol/assam-rifles.html' },
  // Refugee camps
  { name:'Zokhawthar, Mizoram',   coords:[23.3652,93.3855], type:'camp', module:'/pages/border-patrol/assam-rifles.html' },
  { name:'Matia Transit Camp, Assam', coords:[26.1618,90.6264], type:'camp', module:'/pages/border-patrol/bsf.html' },
  { name:'Champhai, Mizoram',     coords:[23.4560,93.3290], type:'camp', module:'/pages/border-patrol/assam-rifles.html' },
  { name:'Coopers Camp, WB',      coords:[23.1777,88.5735], type:'camp', module:'/pages/border-patrol/bsf.html' },
  { name:'EPDP Colony, Delhi',    coords:[28.5395,77.2476], type:'camp', module:'/pages/border-patrol/itbp.html' },
  { name:'Mandapam Camp, TN',     coords:[9.2810, 79.1576], type:'camp', module:'/pages/border-patrol/cisf.html' },
  { name:'Shaheen Nagar, Hyderabad', coords:[17.3100,78.4860], type:'camp', module:'/pages/border-patrol/cisf.html' },
];

const MARKER_ICONS = {
  airport: '✈', seaport: '⚓', land: '⛩', camp: '⛺'
};
const MARKER_COLORS = {
  airport: '#0057B8', seaport: '#002147', land: '#1A7F4B', camp: '#D97706'
};
const TYPE_LABELS = {
  airport: 'International Airport',
  seaport: 'Major Seaport',
  land:    'Land Border Crossing',
  camp:    'Refugee Camp'
};

function createMarkerIcon(type) {
  const color = MARKER_COLORS[type];
  const icon  = MARKER_ICONS[type];
  return L.divIcon({
    className: '',
    html: `<div style="background:${color};color:#fff;width:32px;height:32px;border-radius:50%;border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;font-size:14px;">${icon}</div>`,
    iconSize:[32,32],
    iconAnchor:[16,16],
    popupAnchor:[0,-20]
  });
}

function buildPopupHTML(marker, stats) {
  const s = stats || {};
  return `
    <div class="map-popup-title">${marker.name}</div>
    <span class="badge badge-${marker.type === 'camp' ? 'pending' : 'verified'}" style="margin-bottom:8px;font-size:10px">${TYPE_LABELS[marker.type]}</span>
    <div class="map-popup-row"><span>Total Entities</span><strong>${s.total ?? '—'}</strong></div>
    <div class="map-popup-row"><span>Security Flags</span><strong style="color:${s.flagged > 0 ? 'var(--color-alert)':'inherit'}">${s.flagged ?? '—'}</strong></div>
    <div class="map-popup-row"><span>Pending Aid</span><strong>${s.pending_aid ?? '—'}</strong></div>
    <a href="${marker.module}" class="btn btn-primary btn-sm map-popup-btn" style="display:block;text-align:center;">View Module →</a>
  `;
}

async function initMainMap(containerId) {
  const map = L.map(containerId, {
    center: [20.5937, 78.9629],
    zoom: 5,
    zoomControl: true,
    attributionControl: false
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);

  for (const marker of ALL_MARKERS) {
    const lMarker = L.marker(marker.coords, { icon: createMarkerIcon(marker.type) }).addTo(map);
    lMarker.bindPopup('<div class="map-popup-title">Loading...</div>', { maxWidth: 260 });
    lMarker.on('click', async () => {
      lMarker.openPopup();
      try {
        const res = await apiFetch(`/api/dashboard/marker-stats?location=${encodeURIComponent(marker.name.split(',')[0])}`);
        if (res.success) lMarker.setPopupContent(buildPopupHTML(marker, res.data));
      } catch {}
    });
  }
  return map;
}

function initCampMiniMap(containerId, campNames) {
  const coords = campNames.map(c => CAMP_COORDS[c]).filter(Boolean);
  const center = coords.length ? [
    coords.reduce((s, c) => s + c[0], 0) / coords.length,
    coords.reduce((s, c) => s + c[1], 0) / coords.length
  ] : [22, 82];

  const map = L.map(containerId, { center, zoom: 5, zoomControl: false, attributionControl: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map);

  campNames.forEach(campName => {
    const coords = CAMP_COORDS[campName];
    if (!coords) return;
    const cap = CAMP_CAPACITY[campName] || 0;
    L.marker(coords, { icon: createMarkerIcon('camp') })
      .bindPopup(`<strong>${campName}</strong><br>Capacity: ~${cap.toLocaleString()}`)
      .addTo(map);
  });
  return map;
}
