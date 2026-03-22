import sqlite3

db = sqlite3.connect('dbms.sqlite')
cols = [r[1] for r in db.execute("PRAGMA table_info(vessels)")]
print('Existing columns:', cols)

if 'movement_status' not in cols:
    db.execute("ALTER TABLE vessels ADD COLUMN movement_status TEXT DEFAULT 'APPROACHING'")
    db.commit()
    print('Added movement_status column.')
else:
    print('movement_status already exists, skipping.')

db.close()
print('Database migration complete.')
