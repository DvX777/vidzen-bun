import sys
import json
import io
import time

# Ensure stdout uses UTF-8 to prevent encoding errors on Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

try:
    from curl_cffi import requests
except ImportError:
    print(json.dumps({"error": "curl_cffi is not installed. Run: pip install curl-cffi"}))
    sys.exit(1)

if len(sys.argv) < 2:
    print(json.dumps({"error": "Missing URL argument"}))
    sys.exit(1)

url = sys.argv[1]
referer = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != "" else None
origin = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != "" else None

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
}
if referer:
    headers['Referer'] = referer
if origin:
    headers['Origin'] = origin

try:
    # Use impersonate to bypass Cloudflare TLS fingerprinting
    response = requests.get(url, headers=headers, impersonate="chrome120", timeout=15)
    
    result = {
        "status": response.status_code,
        "headers": dict(response.headers),
        "text": response.text
    }
    print(json.dumps(result))
except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
