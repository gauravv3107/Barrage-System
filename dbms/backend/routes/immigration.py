import os, random, string
from flask import Blueprint, request, send_from_directory, jsonify
from database import get_db, row_to_dict, rows_to_list, api_response, api_error
from werkzeug.utils import secure_filename
from datetime import datetime, timezone

immigration_bp = Blueprint('immigration', __name__)

UPLOADS_DIR = os.path.join(os.path.dirname(__file__), '..', 'uploads', 'photos')
os.makedirs(UPLOADS_DIR, exist_ok=True)

# The demo passport data for Vikram Singh
DEMO_PASSPORT = {
    'passport_no':  'Z8892104',
    'name':         'Vikram Singh',
    'nationality':  'Indian',
    'dob':          '1988-03-15',
    'gender':       'Male',
    'place_of_birth': 'New Delhi',
    'date_of_issue':  '2021-01-12',
    'date_of_expiry': '2031-01-11',
    'mrz_line1': 'P<INDSINGH<<VIKRAM<<<<<<<<<<<<<<<<<<<<<<<<',
    'mrz_line2': 'Z88921048IND8803154M3101118<<<<<<<<<<<<<<<6'
}


@immigration_bp.route('/verify-passport', methods=['POST'])
def verify_passport():
    data     = request.get_json(silent=True) or {}
    pno      = data.get('passport_no', '').strip()
    ocr_name = data.get('ocr_name', '').strip()

    if not pno and not ocr_name:
        return api_error('passport_no or ocr_name required')

    db = get_db()
    try:
        row = None
        if pno:
            row = db.execute("SELECT * FROM entities WHERE passport_no=?", (pno,)).fetchone()
        if not row and ocr_name:
            row = db.execute(
                "SELECT * FROM entities WHERE name LIKE ?",
                (f'%{ocr_name.split()[0]}%',)
            ).fetchone()
    finally:
        db.close()

    if row:
        r = dict(row)
        face_match = 96 if r['passport_no'] == 'Z8892104' else (
            0 if r['is_blacklist'] else
            (int(85 + (100 - r['risk_score']) * 0.1))
        )
        checks = {
            'mrz_valid':        r['is_blacklist'] == 0,
            'not_expired':      True,
            'watchlist_clear':  r['is_blacklist'] == 0,
            'interpol_clear':   r['is_blacklist'] == 0,
            'face_match_score': face_match,
        }
        overall = 'Verified' if all(checks[k] for k in checks if k != 'face_match_score') and face_match > 80 else 'Flagged'
        return api_response(data={
            'found':          True,
            'entity':         r,
            'checks':         checks,
            'overall_status': overall,
            'is_blacklist':   bool(r['is_blacklist']),
            'blacklist_reason': r.get('blacklist_reason')
        })

    return api_response(data={
        'found':          False,
        'entity':         None,
        'checks': {
            'mrz_valid':        True,
            'not_expired':      True,
            'watchlist_clear':  True,
            'interpol_clear':   True,
            'face_match_score': 72,
        },
        'overall_status': 'Pending'
    }, message='Document scanned — manual review recommended')


@immigration_bp.route('/travelers', methods=['GET'])
def search_travelers():
    q      = request.args.get('q', '').strip()
    status = request.args.get('status', '')
    nat    = request.args.get('nationality', '')
    limit  = min(int(request.args.get('limit', 50)), 200)
    offset = int(request.args.get('offset', 0))

    conditions = ["type='Traveler'"]
    params     = []
    if q:
        conditions.append("(name LIKE ? OR passport_no LIKE ?)")
        params += [f'%{q}%', f'%{q}%']
    if status:
        conditions.append("status=?")
        params.append(status)
    if nat:
        conditions.append("nationality LIKE ?")
        params.append(f'%{nat}%')

    where = ' AND '.join(conditions)
    db = get_db()
    try:
        rows  = db.execute(
            f"SELECT * FROM entities WHERE {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
            params + [limit, offset]
        ).fetchall()
        total = db.execute(
            f"SELECT COUNT(*) as c FROM entities WHERE {where}", params
        ).fetchone()['c']
    finally:
        db.close()

    return api_response(data={'items': [dict(r) for r in rows], 'total': total})


@immigration_bp.route('/travelers/<entity_id>', methods=['GET'])
def get_traveler(entity_id):
    """Fetch a single traveler by ID (used by the Edit modal)."""
    db = get_db()
    try:
        row = db.execute(
            "SELECT * FROM entities WHERE id=? AND type='Traveler'", (entity_id,)
        ).fetchone()
    finally:
        db.close()
    if not row:
        return api_error('Traveler not found', 404)
    return api_response(data=dict(row))


@immigration_bp.route('/travelers', methods=['POST'])
def add_traveler():
    """Create a new Traveler entity."""
    data = request.get_json(silent=True) or {}
    required = ['name', 'nationality']
    for f in required:
        if not data.get(f):
            return api_error(f'Field required: {f}')

    entity_id   = f"BMS-TRV-{random.randint(10000,99999)}"
    passport_no = data.get('passport_no') or f"TEMP-TRV-{random.randint(1000,9999)}"
    # Status drives blacklist flag: 'Blacklisted' status → is_blacklist=1
    status_input = data.get('status', 'Pending')
    if status_input == 'Under Verification':
        status = 'Pending'
    elif status_input == 'Blacklisted':
        status = 'Flagged'
    else:
        status = status_input

    blacklisted = 1 if (data.get('blacklisted') or status == 'Flagged') else 0

    db = get_db()
    try:
        db.execute("""
            INSERT INTO entities
              (id, name, passport_no, nationality, type, entry_point, status,
               risk_score, is_blacklist, dob, gender, visit_reason, visa_status, visa_expiry_date,
               created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
        """, (
            entity_id, data['name'], passport_no, data['nationality'],
            'Traveler',
            data.get('entry_point', ''),
            status,
            int(data.get('risk_score', 0)),
            blacklisted,
            data.get('dob', ''),
            data.get('gender', ''),
            data.get('visit_reason', ''),
            data.get('visa_status', 'None'),
            data.get('visa_expiry_date', ''),
        ))
        db.commit()
    except Exception as e:
        return api_error(f'Database error: {str(e)}', 500)
    finally:
        db.close()

    return api_response(data={'id': entity_id, 'passport_no': passport_no},
                        message='Traveler added successfully')


@immigration_bp.route('/travelers/<entity_id>', methods=['PUT', 'PATCH'])
def update_traveler(entity_id):
    """Update any field on a Traveler entity."""
    try:
        data = request.get_json(force=True, silent=True)
        if not data:
            return api_error('No data provided')

        allowed_fields = ['name', 'passport_no', 'nationality', 'gender', 'dob',
                          'entry_point', 'visit_reason', 'status', 'visa_status',
                          'is_blacklist', 'blacklist_reason', 'risk_score',
                          'visa_expiry_date', 'investigation_flag', 'investigation_notes']

        # Build updates dict from allowed fields only
        updates = {k: v for k, v in data.items() if k in allowed_fields}

        # Map convenience 'blacklisted' field → is_blacklist
        if 'blacklisted' in data:
            updates['is_blacklist'] = 1 if data['blacklisted'] else 0

        # Status drives is_blacklist automatically — handle mapping strictly to CHECK constraint
        if 'status' in data:
            s = data['status'].lower() if data['status'] else ''
            if s == 'blacklisted':
                updates['is_blacklist'] = 1
                updates['status'] = 'Flagged'
            elif s == 'under_verification' or s == 'under verification' or s == 'pending':
                updates['is_blacklist'] = 0
                updates['status'] = 'Pending'
            elif s in ('active', 'verified'):
                updates['is_blacklist'] = 0
                updates['status'] = 'Verified'

        if not updates:
            return api_error('No valid fields provided to update')

        set_clause = ', '.join(f"{k}=?" for k in updates.keys())
        values = list(updates.values()) + [entity_id]

        db = get_db()
        try:
            db.execute(
                f"UPDATE entities SET {set_clause}, updated_at=datetime('now') WHERE id=? AND type='Traveler'",
                values
            )
            db.commit()

            updated_row = db.execute(
                "SELECT * FROM entities WHERE id=? AND type='Traveler'", (entity_id,)
            ).fetchone()
            if not updated_row:
                return api_error('Traveler not found', 404)
            updated_traveller = dict(updated_row)
        finally:
            db.close()

        return api_response(data=updated_traveller, message='Traveler updated successfully')
    except Exception as e:
        print(f"Error updating traveler {entity_id}: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@immigration_bp.route('/travelers/<entity_id>', methods=['DELETE'])
def delete_traveler(entity_id):
    """Delete a Traveler entity."""
    try:
        db = get_db()
        try:
            existing = db.execute(
                "SELECT id FROM entities WHERE id=? AND type='Traveler'", (entity_id,)
            ).fetchone()
            if not existing:
                return jsonify({"success": False, "error": "Traveler not found"}), 404
            db.execute(
                "DELETE FROM entities WHERE id=? AND type='Traveler'", (entity_id,)
            )
            db.commit()
        finally:
            db.close()
        return jsonify({"success": True, "message": "Traveler deleted"}), 200
    except Exception as e:
        print(f"Error deleting traveler {entity_id}: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@immigration_bp.route('/travelers/<entity_id>/photo', methods=['POST'])
def upload_photo(entity_id):
    """Store a passport photo associated with the traveler entity."""
    if 'photo' not in request.files:
        return api_error('No photo file provided')

    photo = request.files['photo']
    if not photo.filename:
        return api_error('Empty filename')

    ext      = os.path.splitext(secure_filename(photo.filename))[1].lower() or '.jpg'
    filename = f"{entity_id}{ext}"
    save_path = os.path.join(UPLOADS_DIR, filename)
    photo.save(save_path)

    # Store relative path reference in passport_photo column
    photo_url = f"/uploads/photos/{filename}"
    db = get_db()
    try:
        db.execute(
            "UPDATE entities SET passport_photo=?, updated_at=datetime('now') WHERE id=?",
            (photo_url, entity_id)
        )
        db.commit()
    finally:
        db.close()

    return api_response(data={'photo_url': photo_url}, message='Photo uploaded successfully')


@immigration_bp.route('/grant-entry', methods=['POST'])
def grant_entry():
    data = request.get_json(silent=True) or {}
    passport_no = data.get('passport_no', '')
    if not passport_no:
        return api_error('passport_no required')

    db = get_db()
    try:
        db.execute(
            "UPDATE entities SET status='Verified', updated_at=datetime('now') WHERE passport_no=?",
            (passport_no,)
        )
        db.commit()
    finally:
        db.close()

    return api_response(message=f'Entry granted for passport {passport_no}')


@immigration_bp.route('/settings/expiry-threshold', methods=['PUT'])
def set_expiry_threshold():
    data = request.get_json(silent=True) or {}
    days = data.get('days', 30)
    db = get_db()
    try:
        db.execute(
            "INSERT INTO app_settings (key, value) VALUES ('expiry_warning_days', ?) ON CONFLICT(key) DO UPDATE SET value=?",
            (str(days), str(days))
        )
        db.commit()
        return api_response(message='Expiry threshold updated')
    finally:
        db.close()


@immigration_bp.route('/travelers/expiring', methods=['GET'])
def get_expiring_travelers():
    db = get_db()
    try:
        # Get threshold
        setting = db.execute("SELECT value FROM app_settings WHERE key='expiry_warning_days'").fetchone()
        warning_days = int(setting['value']) if setting else 30
        
        # SQLite date calculations
        # Return all travelers that have a visa_expiry_date (and are not already blacklisted/verified)
        rows = db.execute("""
            SELECT id as traveller_id, name, nationality, visa_expiry_date,
                   CAST(julianday(visa_expiry_date) - julianday('now', 'localtime') AS INTEGER) as days_remaining
            FROM entities
            WHERE type='Traveler' AND visa_expiry_date IS NOT NULL AND visa_expiry_date != ''
        """).fetchall()
        
        expired = []
        expiring_soon = []
        
        for r in rows:
            d = dict(r)
            d['id'] = d.pop('traveller_id') # To match prompt requirement
            days = d['days_remaining']
            if days < 0:
                expired.append(d)
            elif days <= warning_days:
                expiring_soon.append(d)
                
        # Write alerts - check for duplicates by triggered_by + date
        today_str = datetime.now(timezone.utc).strftime('%Y-%m-%d')
        for group, severity, msg_tpl in [
            (expired, 'error', 'Visa for {name} ({nationality}) is expired.'),
            (expiring_soon, 'warning', 'Visa for {name} ({nationality}) expires in {days} days.')
        ]:
            for p in group:
                msg = msg_tpl.format(name=p['name'], nationality=p['nationality'], days=p.get('days_remaining'))
                trigger_key = f"EXP-{p['id']}-{today_str}"
                
                # Check duplicate
                dup = db.execute("SELECT id FROM alerts WHERE triggered_by=?", (trigger_key,)).fetchone()
                if not dup:
                    db.execute(
                        "INSERT INTO alerts (type, message, severity, triggered_by) VALUES (?, ?, ?, ?)",
                        ('visa_expiry', msg, severity, trigger_key)
                    )
        db.commit()

        return api_response(data={'expired': expired, 'expiring_soon': expiring_soon, 'threshold': warning_days})
    finally:
        db.close()


@immigration_bp.route('/travelers/under-investigation', methods=['GET'])
def get_under_investigation():
    db = get_db()
    try:
        rows = db.execute("""
            SELECT id, name, nationality, passport_photo, investigation_notes, updated_at, status
            FROM entities
            WHERE type='Traveler' AND (investigation_flag = 1 OR status IN ('Pending', 'Provisional')) AND is_blacklist = 0
            ORDER BY updated_at DESC
        """).fetchall()
        return api_response(data=[dict(r) for r in rows])
    finally:
        db.close()


@immigration_bp.route('/travelers/<entity_id>/flag-investigation', methods=['POST'])
def flag_investigation(entity_id):
    db = get_db()
    try:
        db.execute("UPDATE entities SET investigation_flag=1, status='Flagged', updated_at=datetime('now') WHERE id=?", (entity_id,))
        row = db.execute("SELECT name FROM entities WHERE id=?", (entity_id,)).fetchone()
        name = row['name'] if row else entity_id
        
        # Write alert
        db.execute(
            "INSERT INTO alerts (type, message, severity, triggered_by) VALUES (?, ?, ?, ?)",
            ('investigation_flag', f"Traveller {name} flagged for investigation — face mismatch on scan.", 'error', 'Immigration Scanner')
        )
        db.commit()
        return api_response(message=f"Traveller {name} flagged for investigation")
    finally:
        db.close()


@immigration_bp.route('/travelers/<entity_id>/confirm-blacklist', methods=['POST'])
def confirm_blacklist(entity_id):
    data = request.get_json(silent=True) or {}
    officer_id = data.get('officer_id', 'Unknown Officer')
    notes = data.get('notes', '')
    
    db = get_db()
    try:
        db.execute("""
            UPDATE entities 
            SET is_blacklist=1, investigation_flag=0, status='Blacklisted', blacklist_reason=?, investigation_notes=?, updated_at=datetime('now') 
            WHERE id=?
        """, (f"Confirmed by {officer_id}: {notes}", notes, entity_id))
        
        row = db.execute("SELECT name FROM entities WHERE id=?", (entity_id,)).fetchone()
        name = row['name'] if row else entity_id
        
        db.execute(
            "INSERT INTO alerts (type, message, severity, triggered_by) VALUES (?, ?, ?, ?)",
            ('blacklist_confirmed', f"Traveller {name} confirmed blacklisted by officer {officer_id}.", 'critical', officer_id)
        )
        db.commit()
        return api_response(message=f"Traveller {name} blacklisted")
    finally:
        db.close()


@immigration_bp.route('/travelers/<entity_id>/clear-flag', methods=['POST'])
def clear_flag(entity_id):
    data = request.get_json(silent=True) or {}
    notes = data.get('notes', '')
    officer_id = data.get('officer_id', 'Immigration Officer')
    
    db = get_db()
    try:
        db.execute("""
            UPDATE entities 
            SET investigation_flag=0, status='Under Verification', investigation_notes=?, updated_at=datetime('now') 
            WHERE id=?
        """, (notes, entity_id))
        
        row = db.execute("SELECT name FROM entities WHERE id=?", (entity_id,)).fetchone()
        name = row['name'] if row else entity_id
        
        db.execute(
            "INSERT INTO alerts (type, message, severity, triggered_by) VALUES (?, ?, ?, ?)",
            ('flag_cleared', f"Investigation flag cleared for {name} by {officer_id}.", 'info', officer_id)
        )
        db.commit()
        return api_response(message=f"Flag cleared for {name}")
    finally:
        db.close()

