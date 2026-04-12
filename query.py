import urllib.request
import json
r = urllib.request.urlopen('http://127.0.0.1:5050/api/sea-marshall/vessels')
data = json.loads(r.read())
for v in data.get('data', []):
    if v['imo'] == '9456789':
        print('API Response:', v['health_clearance'], v['customs_clearance'])
