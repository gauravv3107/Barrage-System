import sqlite3

conn = sqlite3.connect('dbms.sqlite')
conn.row_factory = sqlite3.Row

# Get a row
r1 = conn.execute("SELECT id, status FROM entities WHERE type='Traveler' LIMIT 1").fetchone()
if not r1:
    print("No Traveler found to test!")
    exit(0)

entity_id = r1['id']
print("Testing on entity:", entity_id, "Current status:", r1['status'])

print("Before Update SELECT *:", dict(conn.execute("SELECT * FROM entities WHERE id=?", (entity_id,)).fetchone()))

conn.execute("UPDATE entities SET status='blacklisted', is_blacklist=1 WHERE id=?", (entity_id,))
conn.commit()

r2 = conn.execute("SELECT * FROM entities WHERE id=?", (entity_id,)).fetchone()
if r2 is None:
    print("Row disappeared entirely!")
else:
    print("After Update SELECT *:", dict(r2))

