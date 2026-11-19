package org.radarmisr.app;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONObject;

public final class OfflineQueue extends SQLiteOpenHelper {
    public OfflineQueue(Context context) { super(context, "mirsad_offline.db", null, 1); }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE outbox (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending')");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { }

    public synchronized boolean enqueue(String id, String kind, String payload, long createdAt) {
        android.content.ContentValues v = new android.content.ContentValues();
        v.put("id", id); v.put("kind", kind); v.put("payload", payload); v.put("created_at", createdAt); v.put("state", "pending");
        return getWritableDatabase().insertWithOnConflict("outbox", null, v, SQLiteDatabase.CONFLICT_REPLACE) != -1;
    }

    public synchronized String list() {
        JSONArray rows = new JSONArray();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT id,kind,payload,created_at,state FROM outbox ORDER BY created_at ASC", null)) {
            while (c.moveToNext()) {
                JSONObject o = new JSONObject();
                o.put("id", c.getString(0)); o.put("kind", c.getString(1));
                o.put("payload", c.getString(2)); o.put("createdAt", c.getLong(3)); o.put("state", c.getString(4));
                rows.put(o);
            }
        } catch (Exception ignored) { }
        return rows.toString();
    }

    public synchronized int count() {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM outbox", null)) {
            return c.moveToFirst() ? c.getInt(0) : 0;
        }
    }
}
