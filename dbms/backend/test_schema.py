import sqlite3

conn = sqlite3.connect('dbms.sqlite')
conn.row_factory = sqlite3.Row

print("=== PRAGMA table_info(entities) ===")
cols = conn.execute("PRAGMA table_info(entities)").fetchall()
for c in cols:
    print(c['name'], c['type'])

print("\n=== SELECT ONE TRAVELER ===")
t = conn.execute("SELECT id FROM entities WHERE type='Traveler' LIMIT 1").fetchone()
if t:
    print("Traveler ID:", t['id'])
else:
    print("No traveler found.")
