import urllib.request, json

def get_hima():
    r = urllib.request.urlopen("http://127.0.0.1:5050/api/sea-marshall/vessels")
    data = json.loads(r.read())
    for v in data.get("data", []):
        if v["imo"] == "9456789":
            return v["health_clearance"], v["customs_clearance"]
    return None

import sqlite3
# 1. wipe
conn = sqlite3.connect("dbms.sqlite")
conn.execute("UPDATE vessels SET health_clearance=0, customs_clearance=0 WHERE imo='9456789'")
conn.commit()

c1 = get_hima()
print("After wipe:", c1)

# 2. Grant Health
req = urllib.request.Request("http://127.0.0.1:5050/api/sea-marshall/vessels/9456789/health-clearance",
    data=json.dumps({"granted": True, "officer_id": "SYS"}).encode('utf-8'),
    headers={"Content-Type": "application/json"})
urllib.request.urlopen(req)

# Grant Customs
req2 = urllib.request.Request("http://127.0.0.1:5050/api/sea-marshall/vessels/9456789/customs-clearance",
    data=json.dumps({"granted": True, "officer_id": "SYS"}).encode('utf-8'),
    headers={"Content-Type": "application/json"})
urllib.request.urlopen(req2)

c2 = get_hima()
print("After grant:", c2)
