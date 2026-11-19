package org.radarmisr.app;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import androidx.work.OneTimeWorkRequest;
import androidx.work.ExistingWorkPolicy;
import androidx.work.Constraints;
import androidx.work.NetworkType;
import androidx.work.WorkManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.OutputStream;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class SyncWorker extends Worker {
    public SyncWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }

    @NonNull @Override public Result doWork() {
        String base = BuildConfig.MIRSAD_API_BASE_URL == null ? "" : BuildConfig.MIRSAD_API_BASE_URL.trim();
        if (base.isEmpty()) return Result.failure();
        String token;
        try { token = SyncTokenStore.read(getApplicationContext()); }
        catch (Exception e) { return Result.failure(); }
        if (token.isEmpty()) return Result.failure();

        OfflineQueue queue = new OfflineQueue(getApplicationContext());
        JSONArray pending;
        try { pending = new JSONArray(queue.listPending()); }
        catch (Exception e) { return Result.retry(); }
        if (pending.length() == 0) return Result.success();

        JSONArray batch = new JSONArray();
        try {
            for (int i=0; i<pending.length() && i<50; i++) {
                JSONObject row = pending.getJSONObject(i);
                JSONObject operation = new JSONObject();
                operation.put("id", row.getString("id"));
                operation.put("kind", row.getString("kind"));
                operation.put("payload", new JSONObject(row.getString("payload")));
                batch.put(operation);
            }
            JSONObject body = new JSONObject().put("operations", batch);
            URL url = new URL(base.replaceAll("/+$", "") + "/api/v1/sync");
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(25000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Authorization", "Bearer " + token);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "application/json");
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
            int status = connection.getResponseCode();
            if (status == 401 || status == 403) { connection.disconnect(); return Result.failure(); }
            if (status < 200 || status >= 300) { connection.disconnect(); return Result.retry(); }
            InputStream input = connection.getInputStream();
            ByteArrayOutputStream responseBytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) responseBytes.write(buffer, 0, read);
            input.close();
            JSONObject response = new JSONObject(new String(responseBytes.toByteArray(), StandardCharsets.UTF_8));
            connection.disconnect();
            JSONArray results = response.optJSONArray("results");
            if (results == null) return Result.retry();
            for (int i=0; i<results.length(); i++) {
                JSONObject result = results.optJSONObject(i);
                if (result == null) continue;
                String id = result.optString("id", "");
                String state = result.optString("status", "");
                if ("acknowledged".equals(state)) queue.acknowledge(id);
                else if ("conflict".equals(state) || "rejected".equals(state)) queue.markState(id, state);
            }
            if (queue.pendingCount() > 0) {
                OneTimeWorkRequest next = new OneTimeWorkRequest.Builder(SyncWorker.class)
                        .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                        .build();
                WorkManager.getInstance(getApplicationContext()).enqueueUniqueWork(
                        "mirsad-outbox-sync", ExistingWorkPolicy.APPEND_OR_REPLACE, next);
            }
            return Result.success();
        } catch (Exception e) { return Result.retry(); }
    }
}
