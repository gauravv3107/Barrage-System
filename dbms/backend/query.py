import sqlite3
conn = sqlite3.connect('dbms.sqlite')
conn.row_factory = sqlite3.Row

statuses = conn.execute("SELECT DISTINCT status, COUNT(*) as c FROM entities GROUP BY status").fetchall()
print("Entity Statuses:")
for r in statuses:
    print(repr(r['status']), r['c'])
