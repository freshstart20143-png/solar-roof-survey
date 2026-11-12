package tw.solarroof.survey;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 光電屋頂探勘：用 WebView 包住 assets/www 裡的網頁。
 * - 網頁從 https://appassets.androidplatform.net/assets/www/ 載入
 * - 空拍圖磚走 /tile/{圖層}/{z}/{y}/{x}，由 App 代抓國土測繪中心的圖磚並存在手機快取
 * - 外部連結（Google 地圖、地籍網站）交給其他 App 開
 * - 返回鍵先結束劃屋頂、關視窗，最後才離開
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/assets/www/index.html";
    private static final String TILE_URL = "https://wmts.nlsc.gov.tw/wmts/%s/default/GoogleMapsCompatible/%s/%s/%s";
    private static final long TILE_MAX_AGE_MS = 30L * 24 * 3600 * 1000;      // 圖磚快取 30 天
    private static final long CACHE_LIMIT = 300L * 1024 * 1024;              // 快取超過 300MB 就清舊的
    private static final long CACHE_TARGET = 200L * 1024 * 1024;
    private static final int REQ_LOCATION = 1;

    private WebView web;
    private WebViewAssetLoader assetLoader;
    private File tileDir;
    private GeolocationPermissions.Callback pendingGeoCallback;
    private String pendingGeoOrigin;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        tileDir = new File(getCacheDir(), "tiles");
        new Thread(this::trimTileCache).start();

        assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);

        web.addJavascriptInterface(new Bridge(), "Android");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!HOST.equals(uri.getHost())) return null;
                String path = uri.getPath();
                if (path != null && path.startsWith("/tile/")) return serveTile(path);
                return assetLoader.shouldInterceptRequest(uri);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (HOST.equals(uri.getHost())) return false;
                openExternal(uri);
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (hasLocationPermission()) {
                    callback.invoke(origin, true, false);
                } else {
                    pendingGeoOrigin = origin;
                    pendingGeoCallback = callback;
                    requestPermissions(new String[]{
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
                }
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START_URL);
    }

    // ---------- 圖磚轉接與快取 ----------
    private WebResourceResponse serveTile(String path) {
        // path = /tile/{layer}/{z}/{y}/{x}
        String[] p = path.split("/");
        if (p.length != 6) return notFound();
        String layer = p[2], z = p[3], y = p[4], x = p[5];
        if (!("PHOTO2".equals(layer) || "EMAP".equals(layer))) return notFound();
        if (!z.matches("\\d{1,2}") || !y.matches("\\d{1,7}") || !x.matches("\\d{1,7}")) return notFound();

        File f = new File(tileDir, layer + "/" + z + "/" + y + "/" + x);
        byte[] data = null;
        if (f.exists() && System.currentTimeMillis() - f.lastModified() < TILE_MAX_AGE_MS) {
            data = readFile(f);
        }
        if (data == null) {
            data = download(String.format(TILE_URL, layer, z, y, x));
            if (data != null) writeFile(f, data);
            else if (f.exists()) data = readFile(f);   // 沒網路時用舊的圖磚
        }
        if (data == null || data.length == 0) return notFound();

        String mime = (data.length > 1 && (data[0] & 0xff) == 0x89 && data[1] == 'P') ? "image/png" : "image/jpeg";
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        headers.put("Cache-Control", "max-age=86400");
        return new WebResourceResponse(mime, null, 200, "OK", headers, new ByteArrayInputStream(data));
    }

    private WebResourceResponse notFound() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, new ByteArrayInputStream(new byte[0]));
    }

    private static byte[] download(String url) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(10000);
            c.setReadTimeout(15000);
            c.setRequestProperty("User-Agent", "SolarRoofSurvey/1.0 (Android)");
            if (c.getResponseCode() != 200) return null;
            try (InputStream in = c.getInputStream()) { return readAll(in); }
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static byte[] readAll(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }

    private static byte[] readFile(File f) {
        try (InputStream in = new FileInputStream(f)) { return readAll(in); } catch (Exception e) { return null; }
    }

    private static void writeFile(File f, byte[] data) {
        try {
            File dir = f.getParentFile();
            if (dir != null && !dir.exists()) dir.mkdirs();
            File tmp = new File(f.getPath() + ".tmp" + Thread.currentThread().getId());
            try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(data); }
            if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f); }
        } catch (Exception ignored) { }
    }

    private void trimTileCache() {
        List<File> files = new ArrayList<>();
        collect(tileDir, files);
        long total = 0;
        for (File f : files) total += f.length();
        if (total <= CACHE_LIMIT) return;
        Collections.sort(files, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
        for (File f : files) {
            if (total <= CACHE_TARGET) break;
            total -= f.length();
            f.delete();
        }
    }

    private static void collect(File dir, List<File> out) {
        File[] list = dir.listFiles();
        if (list == null) return;
        for (File f : list) {
            if (f.isDirectory()) collect(f, out);
            else out.add(f);
        }
    }

    // ---------- 外部連結 ----------
    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "手機上沒有可以開啟這個連結的 App", Toast.LENGTH_LONG).show();
        }
    }

    // ---------- 給網頁用的小工具 ----------
    private class Bridge {
        @JavascriptInterface
        public void copy(final String text) {
            runOnUiThread(() -> {
                ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("地址", text));
            });
        }
    }

    // ---------- 定位權限 ----------
    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_LOCATION && pendingGeoCallback != null) {
            pendingGeoCallback.invoke(pendingGeoOrigin, hasLocationPermission(), false);
            pendingGeoCallback = null;
            pendingGeoOrigin = null;
        }
    }

    // ---------- 返回鍵 ----------
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("(window.__back ? window.__back() : 'none')", result -> {
            if (!"\"closed\"".equals(result)) finish();
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
