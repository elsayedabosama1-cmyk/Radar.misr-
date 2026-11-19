package org.radarmisr.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.OneTimeWorkRequest;
import androidx.work.ExistingWorkPolicy;
import androidx.work.WorkManager;

import java.util.ArrayList;
import java.util.concurrent.TimeUnit;
import java.util.UUID;

public class MainActivity extends Activity {
    private WebView web;
    private ValueCallback<Uri[]> fileCb;
    private OfflineQueue offlineQueue;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);

        if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }

        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
                "check",
                ExistingPeriodicWorkPolicy.KEEP,
                new PeriodicWorkRequest.Builder(CheckWorker.class, 15, TimeUnit.MINUTES)
                        .setConstraints(new Constraints.Builder()
                                .setRequiredNetworkType(NetworkType.CONNECTED)
                                .build())
                        .build()
        );

        offlineQueue = new OfflineQueue(this);
        enqueueSync();
        web = new WebView(this);
        setContentView(web);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);

        web.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void setTopics(String topics) {
                getSharedPreferences("notif", MODE_PRIVATE)
                        .edit()
                        .putString("topics", topics == null ? "" : topics)
                        .apply();
            }

            @JavascriptInterface
            public boolean isOnline() {
                ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
                Network n = cm == null ? null : cm.getActiveNetwork();
                NetworkCapabilities caps = n == null || cm == null ? null : cm.getNetworkCapabilities(n);
                return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                        && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
            }

            @JavascriptInterface
            public boolean queueOperation(String kind, String payload) {
                if (kind == null || payload == null || payload.length() > 10000000) return false;
                // Every edit is a distinct idempotent operation. Reusing kind:entityId
                // would make the server replay the first receipt and silently skip later edits.
                String operationId = UUID.randomUUID().toString();
                boolean saved = offlineQueue.enqueue(operationId, kind, payload, System.currentTimeMillis());
                if (saved) enqueueSync();
                return saved;
            }

            @JavascriptInterface
            public boolean setSyncToken(String token) {
                try {
                    if (token == null || token.isEmpty()) {
                        SyncTokenStore.clear(MainActivity.this);
                        return true;
                    }
                    String api = BuildConfig.MIRSAD_API_BASE_URL == null ? "" : BuildConfig.MIRSAD_API_BASE_URL.trim();
                    if (!api.startsWith("https://")) return false;
                    SyncTokenStore.save(MainActivity.this, token);
                    enqueueSync();
                    return true;
                } catch (Exception e) { return false; }
            }

            @JavascriptInterface
            public String pendingOperations() { return offlineQueue.list(); }

            @JavascriptInterface
            public int pendingCount() { return offlineQueue.pendingCount(); }

            @JavascriptInterface
            public void share(String text) {
                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType("text/plain");
                intent.putExtra(Intent.EXTRA_TEXT, text == null ? "" : text);
                startActivity(Intent.createChooser(intent, "مشاركة"));
            }
        }, "Android");

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = callback;

                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");

                ArrayList<String> mimeTypes = new ArrayList<>();
                if (params.getAcceptTypes() != null) {
                    for (String type : params.getAcceptTypes()) {
                        if (type != null && type.contains("/")) mimeTypes.add(type);
                    }
                }
                if (!mimeTypes.isEmpty()) {
                    intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes.toArray(new String[0]));
                }

                try {
                    startActivityForResult(intent, 2);
                    return true;
                } catch (Exception e) {
                    fileCb = null;
                    callback.onReceiveValue(null);
                    Toast.makeText(MainActivity.this, "تعذر فتح الملفات", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton("تأكيد", (dialog, which) -> result.confirm())
                        .setNegativeButton("إلغاء", (dialog, which) -> result.cancel())
                        .setOnCancelListener(dialog -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton("تمام", (dialog, which) -> result.confirm())
                        .setOnCancelListener(dialog -> result.confirm())
                        .show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message,
                                      String defaultValue, JsPromptResult result) {
                EditText input = new EditText(MainActivity.this);
                if (defaultValue != null) input.setText(defaultValue);
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setView(input)
                        .setPositiveButton("تأكيد", (dialog, which) ->
                                result.confirm(input.getText().toString()))
                        .setNegativeButton("إلغاء", (dialog, which) -> result.cancel())
                        .setOnCancelListener(dialog -> result.cancel())
                        .show();
                return true;
            }
        });

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(Uri.parse(url));
            }

            private boolean handleUrl(Uri uri) {
                String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();

                // Keep navigation inside the packaged application assets only.
                if ("file".equals(scheme)) {
                    String path = uri.getPath();
                    return path == null || !path.startsWith("/android_asset/");
                }

                // Open ordinary web links outside the app; never expose the JS bridge to them.
                if ("https".equals(scheme) || "http".equals(scheme) ||
                        "mailto".equals(scheme) || "tel".equals(scheme)) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    } catch (Exception ignored) {
                        Toast.makeText(MainActivity.this, "تعذر فتح الرابط", Toast.LENGTH_SHORT).show();
                    }
                    return true;
                }

                return true;
            }
        });

        if (b == null) {
            web.loadUrl("file:///android_asset/index.html");
        } else if (web.restoreState(b) == null) {
            web.loadUrl("file:///android_asset/index.html");
        }
    }

    private void enqueueSync() {
        String api = BuildConfig.MIRSAD_API_BASE_URL == null ? "" : BuildConfig.MIRSAD_API_BASE_URL.trim();
        if (!api.startsWith("https://")) return;
        try {
            if (SyncTokenStore.read(this).isEmpty()) return;
            OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(SyncWorker.class)
                    .setConstraints(new Constraints.Builder()
                            .setRequiredNetworkType(NetworkType.CONNECTED).build())
                    .build();
            WorkManager.getInstance(this).enqueueUniqueWork("mirsad-outbox-sync",
                    ExistingWorkPolicy.APPEND_OR_REPLACE, request);
        } catch (Exception ignored) { }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == 2 && fileCb != null) {
            fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCb = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript("window.goBack&&window.goBack()", value -> {
            if (!"true".equals(value)) {
                if (web.canGoBack()) web.goBack();
                else finish();
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (fileCb != null) {
            fileCb.onReceiveValue(null);
            fileCb = null;
        }
        if (web != null) {
            web.stopLoading();
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
