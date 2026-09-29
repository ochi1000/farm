package com.ocorp.xrunner;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.os.PowerManager;

public class AutomationService extends Service {
    public static final String CHANNEL_ID = "x-runner";
    private AutomationServer server;
    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        // Boot/sticky restart must not depend on MainActivity creating this channel.
        getSystemService(NotificationManager.class).createNotificationChannel(
                new NotificationChannel(CHANNEL_ID, "Phone Relay", NotificationManager.IMPORTANCE_LOW));
        Notification notification = new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("All in")
                .setContentText("Relay/status service is running")
                .setSmallIcon(R.drawable.ic_notification)
                .setOngoing(true)
                .build();
        startForeground(1001, notification);
        acquireWakeLock();

        RelayClient.get().initialize(this);
        RelayClient.get().resumeSavedConnection(this);
        WirelessAdbRecovery.get().start(this);
        server = new AutomationServer(this, 8765);
        server.start();
    }

    @Override
    public void onDestroy() {
        WirelessAdbRecovery.get().stop();
        if (server != null) server.stop();
        RelayClient.get().shutdown();
        releaseWakeLock();
        super.onDestroy();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        acquireWakeLock();
        RelayClient.get().resumeSavedConnection(this);
        return START_STICKY;
    }

    private synchronized void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AllIn:RelayWakeLock");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire();
    }

    private synchronized void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
