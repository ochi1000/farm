package com.ocorp.xrunner;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        // A not-yet-provisioned or explicitly stopped relay must remain stopped.
        Context storage = RelayStorage.prepare(context);
        if (!storage.getSharedPreferences(RelayStorage.PREFS, Context.MODE_PRIVATE)
                .getBoolean("enabled", false)) return;
        Intent serviceIntent = new Intent(context, AutomationService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent);
        } else {
            context.startService(serviceIntent);
        }
    }
}
