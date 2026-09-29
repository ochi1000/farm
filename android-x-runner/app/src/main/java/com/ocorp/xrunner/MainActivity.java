package com.ocorp.xrunner;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.app.Activity;
import android.widget.TextView;
import android.widget.LinearLayout;
import android.widget.Switch;

public class MainActivity extends Activity {
    public static final String DEFAULT_X_URL = "https://x.com/home";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createNotificationChannel();

        TextView view = new TextView(this);
        view.setText("All in\n\nService: starting\nLocal API: 127.0.0.1:8765\n\nThis app supervises relay/status only. X stays in Chrome.");
        view.setTextSize(18);
        view.setPadding(32, 48, 32, 32);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.addView(view);
        Switch recovery = new Switch(this);
        recovery.setText("Reconnect Chrome after restart (Wi-Fi)");
        recovery.setChecked(createDeviceProtectedStorageContext().getSharedPreferences(RelayStorage.PREFS, MODE_PRIVATE)
                .getBoolean("wirelessAdbRecovery", true));
        recovery.setOnCheckedChangeListener((button, checked) -> WirelessAdbRecovery.get().setEnabled(checked));
        layout.addView(recovery);
        TextView setup = new TextView(this);
        setup.setText("Requires one-time USB permission setup and approval of your Wi-Fi network. Unlock the phone after restart. Turning this off stops automatic recovery; Android's Wireless debugging setting is managed separately.");
        setup.setPadding(32, 16, 32, 16);
        layout.addView(setup);
        setContentView(layout);

        startSupervisor();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        startSupervisor();
    }

    private void startSupervisor() {
        Intent serviceIntent = new Intent(this, AutomationService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
                AutomationService.CHANNEL_ID,
                "Phone Relay",
                NotificationManager.IMPORTANCE_LOW
        );
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(channel);
    }
}
