# 把 src/ 裡的檔案合成一個單一網頁（方便用手機 Chrome 直接預覽）
# 用法：python3 tools/make_single_html.py 輸出檔名.html
import pathlib, sys

src = pathlib.Path(__file__).resolve().parent.parent / 'app' / 'src' / 'main' / 'assets' / 'www'
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '光電屋頂探勘.html')
html = (src / 'index.html').read_text(encoding='utf-8')

def inline_css(name):
    return '<style>' + (src / name).read_text(encoding='utf-8') + '</style>'

def inline_js(name):
    js = (src / name).read_text(encoding='utf-8').replace('</script', '<\\/script')
    return '<script>' + js + '</script>'

for name in ['maplibre-gl.css', 'app.css']:
    html = html.replace(f'<link rel="stylesheet" href="{name}">', inline_css(name))
for name in ['maplibre-gl.js', 'evaluate.js', 'app.js']:
    html = html.replace(f'<script src="{name}"></script>', inline_js(name))

assert 'href="maplibre' not in html and 'src="app.js"' not in html
out.write_text(html, encoding='utf-8')
print('已產生', out, f'{out.stat().st_size // 1024} KB')
