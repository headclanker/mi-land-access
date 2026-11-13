"""Polite crawler: for each managing body's own website, find documents mentioning hunting rules.
Stays on the body's registered domain, obeys robots.txt, ~1 request/sec per site, caps pages and PDFs.
Never visits code-hosting services (ecode360, municode, amlegal) or any host that answers with a challenge."""
import json, re, sys, os, time, hashlib, subprocess, threading, queue, urllib.parse, urllib.robotparser
from concurrent.futures import ThreadPoolExecutor
import requests
from bs4 import BeautifulSoup

UA = 'SketchX-research/1.0 (personal hunting-access map; reads public park rules)'
BROWSER_UA = 'Mozilla/5.0 (compatible; SketchX-research/1.0; personal hunting-access map; reads public park rules)'
SKIP_HOSTS = ('ecode360.com', 'municode.com', 'amlegal.com', 'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'youtube.com', 'google.com', 'linkedin.com')
PRIORITY = re.compile(r'ordinanc|code|park|rule|regulat|recreat|hunt|firearm|weapon|deer|document|archive|board|plan|policy|polic', re.I)
KEY = re.compile(r'\b(hunt\w*|trap(?:ping)?|firearms?|guns?|bows?|archery|crossbows?|discharg\w*|weapons?|deer management)\b', re.I)
PARKY = re.compile(r'\bpark|recreation|preserve|nature area|township property|village property|city property|public property|public lands?|sanctuary', re.I)
MAX_PAGES, MAX_PDFS, MAX_PDF_BYTES = 160, 60, 25_000_000

def reg_domain(host):
    parts = host.lower().split('.')
    return '.'.join(parts[-3:]) if len(parts) > 2 and parts[-2] in ('mi', 'co', 'state') else '.'.join(parts[-2:])

def sentences(text):
    text = re.sub(r'\s+', ' ', text)
    out = []
    for m in KEY.finditer(text):
        a = max(0, text.rfind('.', 0, m.start()) + 1, m.start() - 350)
        b = text.find('.', m.end()); b = len(text) if b < 0 else min(b + 1, m.end() + 350)
        out.append(text[a:b].strip())
    seen, res = set(), []
    for s in out:
        k = s[:120]
        if k not in seen: seen.add(k); res.append(s)
    return res

def pdf_text(path):
    try:
        return subprocess.run(['pdftotext', '-l', '120', path, '-'], capture_output=True, text=True, timeout=120).stdout
    except Exception:
        return ''

def crawl(body, outdir):
    home = body['homepage']
    host0 = urllib.parse.urlparse(home).netloc
    dom = reg_domain(host0)
    s = requests.Session(); s.headers['User-Agent'] = BROWSER_UA
    rp = urllib.robotparser.RobotFileParser()
    try:
        r = s.get(f'https://{host0}/robots.txt', timeout=20); rp.parse(r.text.splitlines() if r.ok else [])
    except Exception:
        rp.parse([])
    seen, hits, log = set(), [], {'pages': 0, 'pdfs': 0, 'blocked': 0, 'errors': 0}
    q = [(0 if PRIORITY.search(home) else 1, 0, home)]
    while q and log['pages'] < MAX_PAGES:
        q.sort(); _, depth, url = q.pop(0)
        if url in seen: continue
        seen.add(url)
        u = urllib.parse.urlparse(url)
        if not u.netloc.endswith(dom) or any(h in u.netloc for h in SKIP_HOSTS): continue
        if not rp.can_fetch(BROWSER_UA, url): continue
        is_pdf = u.path.lower().endswith('.pdf') or 'DocumentCenter/View' in u.path
        if is_pdf and log['pdfs'] >= MAX_PDFS: continue
        time.sleep(1.0)
        try:
            r = s.get(url, timeout=40, stream=True)
            ctype = r.headers.get('content-type', '')
            if r.status_code in (403, 429, 503):
                log['blocked'] += 1
                if log['blocked'] >= 5: break  # the site is refusing us: stop, do not work around it
                continue
            if r.status_code != 200: continue
            if 'pdf' in ctype or is_pdf:
                data = r.raw.read(MAX_PDF_BYTES + 1, decode_content=True)
                if len(data) > MAX_PDF_BYTES or not data.startswith(b'%PDF'): continue
                log['pdfs'] += 1
                p = os.path.join(outdir, hashlib.md5(url.encode()).hexdigest() + '.pdf')
                open(p, 'wb').write(data)
                text = pdf_text(p)
            elif 'html' in ctype:
                log['pages'] += 1
                html = r.text
                if re.search(r'just a moment|verify you are human|attention required|cf-chl', html[:3000], re.I):
                    log['blocked'] += 1; break
                soup = BeautifulSoup(html, 'html.parser')
                for a in soup.find_all('a', href=True):
                    nu = urllib.parse.urljoin(url, a['href']).split('#')[0]
                    if nu.startswith('http') and nu not in seen and depth < 4:
                        pri = 0 if PRIORITY.search(nu + ' ' + a.get_text(' ')) else 2
                        q.append((pri + depth, depth + 1, nu))
                for t in soup(['script', 'style', 'nav', 'footer']): t.decompose()
                text = soup.get_text(' ')
            else:
                continue
            for sent in sentences(text):
                if PARKY.search(sent) or re.search(r'no person shall|prohibit|unlawful|shall not|permitted|allowed', sent, re.I):
                    hits.append({'url': url, 'text': sent[:700]})
        except Exception:
            log['errors'] += 1
    return {**body, 'domain': dom, 'log': log, 'hits': hits}

def main(inp, out):
    bodies = [b for b in json.load(open(inp)) if b.get('homepage')]
    uniq = {}
    for b in bodies: uniq.setdefault(b['homepage'].rstrip('/'), b)
    results = []
    lock = threading.Lock()
    def work(b):
        d = os.path.join(os.path.dirname(out), 'docs', hashlib.md5(b['homepage'].encode()).hexdigest()[:10]); os.makedirs(d, exist_ok=True)
        res = crawl(b, d)
        with lock:
            results.append(res); json.dump(results, open(out, 'w'), indent=1)
            print(len(results), '/', len(uniq), b['manager'], res['log'], len(res['hits']), 'hits', flush=True)
    with ThreadPoolExecutor(8) as ex: list(ex.map(work, uniq.values()))

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
