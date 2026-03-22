import sqlite3, traceback

def test_db():
    conn = sqlite3.connect('dbms.sqlite')
    conn.row_factory = sqlite3.Row
    entity_id = 'BMS-2026-X001'
    
    print("Testing UPDATE...")
    try:
        set_clause = "status=?, is_blacklist=?"
        values = ['blacklisted', 1, entity_id]
        
        conn.execute(
            f"UPDATE entities SET {set_clause}, updated_at=datetime('now') WHERE id=? AND type='Traveler'",
            values
        )
        conn.commit()
        
        row = conn.execute("SELECT * FROM entities WHERE id=? AND type='Traveler'", (entity_id,)).fetchone()
        if row:
            print("Row updated:", dict(row))
        else:
            print("Row not found after update!")
            
    except Exception as e:
        print("UPDATE ERROR:")
        traceback.print_exc()

    print("\nTesting DELETE...")
    try:
        existing = conn.execute("SELECT id FROM entities WHERE id=? AND type='Traveler'", (entity_id,)).fetchone()
        if not existing:
            print("Row not found before delete!")
        else:
            conn.execute("DELETE FROM entities WHERE id=? AND type='Traveler'", (entity_id,))
            conn.commit()
            print("Delete successful.")
    except Exception as e:
        print("DELETE ERROR:")
        traceback.print_exc()

if __name__ == "__main__":
    test_db()
