package org.radarmisr.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class CheckWorker extends Worker {
    static final String URL_DATA = "https://raw.githubusercontent.com/elsayedabosama1-cmyk/Radar.misr-/main/data/news.json";
    static final String CH = "news";

    public CheckWorker(@NonNull Context c, @NonNull WorkerParameters p) { super(c, p); }

    static void scanFiles(JSONArray folders, long since, long[] r, String[] title) {
        if (folders == null) return;
        for (int i = 0; i < folders.length(); i++) {
            JSONObject f = folders.optJSONObject(i);
            if (f == null) continue;
            JSONArray files = f.optJSONArray("files");
            if (files != null) for (int k = 0; k < files.length(); k++) {
                JSONObject x = files.optJSONObject(k);
                if (x == null) continue;
                long ts = x.optLong("ts", 0);
                if (ts > r[1]) { r[1] = ts; title[0] = x.optString("title"); }
                if (since >= 0 && ts > since) r[0]++;
            }
            scanFiles(f.optJSONArray("folders"), since, r, title);
        }
    }

    @NonNull
    @Override
    public Result doWork() {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(URL_DATA + "?t=" + System.currentTimeMillis()).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(20000);
            InputStream in = c.getInputStream();
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            in.close();
            JSONArray arr = new JSONObject(bo.toString("UTF-8")).getJSONArray("news");
            long now = System.currentTimeMillis();
            SharedPreferences sp = getApplicationContext().getSharedPreferences("notif", Context.MODE_PRIVATE);
            long last = sp.getLong("last", -1);
            long max = 0;
            int count = 0;
            String title = "";
            long titleAt = 0;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject j = arr.optJSONObject(i);
                if (j == null) continue;
                String st = j.optString("st");
                long at = j.optLong("at", 0);
                if (!(st.equals("published") || st.equals("scheduled")) || at > now) continue;
                if (at > max) max = at;
                if (last >= 0 && at > last) {
                    count++;
                    if (at > titleAt) { titleAt = at; title = j.optString("t"); }
                }
            }
            long[] fr = new long[]{0, 0};
            String[] ft = new String[]{""};
            scanFiles(db.optJSONArray("folders"), last, fr, ft);
            if (fr[1] > max) max = fr[1];
            if (last >= 0 && fr[0] > 0) {
                count += (int) fr[0];
                if (fr[1] >= titleAt) title = ft[0];
            }
            if (last < 0) {
                sp.edit().putLong("last", Math.max(max, now)).apply();
                return Result.success();
            }
            if (count > 0) {
                sp.edit().putLong("last", max).apply();
                notifyNew(getApplicationContext(), count, title);
            }
            return Result.success();
        } catch (Exception e) {
            return Result.retry();
        }
    }

    static void notifyNew(Context ctx, int count, String title) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26)
            nm.createNotificationChannel(new NotificationChannel(CH, "أخبار جديدة", NotificationManager.IMPORTANCE_DEFAULT));
        Intent i = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String txt = count == 1 ? title : count + " أخبار جديدة، آخرها: " + title;
        nm.notify(1, new NotificationCompat.Builder(ctx, CH)
                .setSmallIcon(R.drawable.ic_notif)
                .setContentTitle("رادار مصر")
                .setContentText(txt)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(txt))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build());
    }
}
