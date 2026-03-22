import requests, json

url = 'http://localhost:5050/api/immigration/travelers/BMS-2026-X001'

print("TESTING PUT /api/immigration/travelers/BMS-2026-X001")
r1 = requests.put(url, json={"status": "blacklisted", "blacklisted": 1})
print("PUT status:", r1.status_code)
print("PUT response:", r1.text)

print("\nTESTING DELETE /api/immigration/travelers/BMS-2026-X001")
r2 = requests.delete(url)
print("DELETE status:", r2.status_code)
print("DELETE response:", r2.text)
