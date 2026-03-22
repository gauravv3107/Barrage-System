"""One-time script to seed sample alerts into the DB for testing."""
import sqlite3, os

db = sqlite3.connect(os.path.join(os.path.dirname(__file__), 'dbms.sqlite'))
db.execute("""
    CREATE TABLE IF NOT EXISTS alerts (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        type         TEXT    NOT NULL DEFAULT 'system',
        message      TEXT    NOT NULL,
        severity     TEXT    NOT NULL DEFAULT 'info',
        triggered_by TEXT,
        read         INTEGER NOT NULL DEFAULT 0,
        timestamp    DATETIME DEFAULT CURRENT_TIMESTAMP
    )
""")
db.executemany(
    "INSERT INTO alerts (type, message, severity, triggered_by) VALUES (?,?,?,?)",
    [
        ("security",
         "3 blacklisted travelers detected at IGI Airport in the last 24 hours — review flagged records.",
         "critical", "Immigration System"),
        ("ngo",
         "NGO assignment pending for 12 newly registered refugees — action required.",
         "warning", "Refugee Registration"),
        ("system",
         "Daily backup completed successfully. 847 entity records archived.",
         "info", "System Scheduler"),
    ]
)
db.commit()
count = db.execute("SELECT COUNT(*) FROM alerts").fetchone()[0]
print(f"Alerts table ready. Total: {count} records.")
db.close()
