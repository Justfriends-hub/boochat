import urllib.request
import urllib.error
try:
    resp = urllib.request.urlopen('http://127.0.0.1:4174/')
    print(resp.status)
    print(resp.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print('HTTP', e.code)
    print(e.read().decode('utf-8'))
except Exception as ex:
    print(type(ex).__name__, ex)
