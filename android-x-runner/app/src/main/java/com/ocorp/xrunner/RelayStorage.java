package com.ocorp.xrunner;

import android.content.Context;
import android.os.UserManager;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;

/** Only the machine relay identity/configuration belongs in boot-accessible storage. */
final class RelayStorage {
    static final String PREFS = "relay_config";
    private static final String[] FILES = {"relay-ca.crt", "relay-client.p12", "relay-client.pass"};

    static synchronized Context prepare(Context context) {
        Context boot = context.createDeviceProtectedStorageContext();
        if (!context.getSystemService(UserManager.class).isUserUnlocked()) return boot;
        // The application keeps the platform's default credential-protected context.
        Context legacy = context.getApplicationContext();
        if (legacy.isDeviceProtectedStorage()) throw new IllegalStateException("Unexpected default relay storage");
        // Existing desktop provisioning writes these files through run-as into CE storage.
        // Move them on first upgrade and after each reprovision, before enabling boot startup.
        try {
            for (String name : FILES) {
                File source = new File(legacy.getFilesDir(), name);
                if (!source.isFile()) continue;
                AtomicFile destination = new AtomicFile(new File(boot.getFilesDir(), name));
                FileOutputStream output = null;
                try {
                    output = destination.startWrite();
                    Files.copy(source.toPath(), output);
                    destination.finishWrite(output);
                } catch (IOException error) {
                    if (output != null) destination.failWrite(output);
                    throw error;
                }
                if (!source.delete()) throw new IOException("Relay credential migration incomplete");
            }
            if (legacy.getSharedPreferences(PREFS, Context.MODE_PRIVATE).contains("deviceId")) {
                if (!boot.moveSharedPreferencesFrom(legacy, PREFS)) {
                    throw new IOException("Relay configuration migration incomplete");
                }
            }
        } catch (IOException error) {
            // Do not include credential contents or file paths in diagnostics.
            throw new IllegalStateException("Relay boot storage migration failed");
        }
        return boot;
    }

    private RelayStorage() {}
}
