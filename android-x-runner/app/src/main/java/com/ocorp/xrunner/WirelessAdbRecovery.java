package com.ocorp.xrunner;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.os.UserManager;
import android.provider.Settings;
import java.net.InetAddress;
import java.net.NetworkInterface;

/** Restores Android's user-authorized TLS ADB listener; never scans ports or bypasses pairing. */
final class WirelessAdbRecovery {
    private static final WirelessAdbRecovery INSTANCE = new WirelessAdbRecovery();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Context context;
    private NsdManager nsd;
    private NsdManager.DiscoveryListener discovery;
    private boolean running, attemptedEnable;
    private int epoch;
    private long discoveryStarted;
    private long listenerReadySince;
    private volatile int tlsPort;
    private String serviceName;
    private volatile String phase = "not_started";
    static WirelessAdbRecovery get() { return INSTANCE; }
    int port() { return tlsPort; }

    void start(Context source) {
        if (running) return;
        context = source.createDeviceProtectedStorageContext();
        nsd = source.getSystemService(NsdManager.class);
        running = true;
        handler.post(tick);
    }

    boolean enabled() {
        return context != null && context.getSharedPreferences(RelayStorage.PREFS, Context.MODE_PRIVATE)
                .getBoolean("wirelessAdbRecovery", true);
    }

    void setEnabled(boolean value) {
        if (context == null) return;
        context.getSharedPreferences(RelayStorage.PREFS, Context.MODE_PRIVATE).edit()
                .putBoolean("wirelessAdbRecovery", value).apply();
        attemptedEnable = false;
        handler.removeCallbacks(tick);
        handler.post(tick);
    }

    void stop() {
        running = false;
        handler.removeCallbacks(tick);
        stopDiscovery();
    }

    String statusJson() {
        return "{\"enabled\":" + enabled() + ",\"phase\":\"" + phase
                + "\",\"tlsListenerDiscovered\":" + (tlsPort > 0) + "}";
    }

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!running) return;
            try { refresh(); } catch (Exception error) { phase = "recovery_error"; stopDiscovery(); }
            if (running) handler.postDelayed(this, 10000);
        }
    };

    private void refresh() {
        if (!enabled() || !context.getSharedPreferences(RelayStorage.PREFS, Context.MODE_PRIVATE).getBoolean("enabled", false)) {
            phase = "disabled"; stopDiscovery(); attemptedEnable = false; return;
        }
        if (Build.VERSION.SDK_INT < 30) { phase = "unsupported_android"; return; }
        if (!context.getSystemService(UserManager.class).isUserUnlocked()) {
            phase = "waiting_for_unlock"; stopDiscovery(); return;
        }
        ConnectivityManager connectivity = context.getSystemService(ConnectivityManager.class);
        boolean wifi = false;
        for (Network network : connectivity.getAllNetworks()) {
            NetworkCapabilities capabilities = connectivity.getNetworkCapabilities(network);
            if (capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) wifi = true;
        }
        if (!wifi) { phase = "wifi_required"; stopDiscovery(); attemptedEnable = false; return; }
        if (Settings.Global.getInt(context.getContentResolver(), "adb_wifi_enabled", 0) != 1) {
            stopDiscovery();
            if (context.checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS) != PackageManager.PERMISSION_GRANTED) {
                phase = "usb_permission_required"; return;
            }
            if (!attemptedEnable) {
                attemptedEnable = true;
                Settings.Global.putInt(context.getContentResolver(), "adb_wifi_enabled", 1);
            }
            // Android owns the network-consent dialog. Never accept it or retry it in a loop.
            phase = "wireless_debugging_off_or_consent_required"; return;
        }
        // Re-arm only after a listener has stayed ready, not merely after writing
        // the setting: Android may briefly expose 1 before rejecting consent.
        if (tlsPort > 0) {
            if (listenerReadySince == 0) listenerReadySince = SystemClock.elapsedRealtime();
            if (SystemClock.elapsedRealtime() - listenerReadySince >= 30000) attemptedEnable = false;
        } else listenerReadySince = 0;
        if (tlsPort == 0 && discovery != null && System.currentTimeMillis() - discoveryStarted > 30000) stopDiscovery();
        if (discovery == null) discover();
        phase = tlsPort > 0 ? "tls_listener_ready" : "discovering_local_listener";
    }

    private void discover() {
        final int currentEpoch = ++epoch;
        discoveryStarted = System.currentTimeMillis();
        discovery = new NsdManager.DiscoveryListener() {
            public void onDiscoveryStarted(String type) {}
            public void onDiscoveryStopped(String type) {}
            public void onStartDiscoveryFailed(String type, int code) { handler.post(() -> { if (epoch == currentEpoch) stopDiscovery(); }); }
            public void onStopDiscoveryFailed(String type, int code) {}
            public void onServiceFound(NsdServiceInfo info) {
                nsd.resolveService(info, new NsdManager.ResolveListener() {
                    public void onResolveFailed(NsdServiceInfo service, int code) {}
                    public void onServiceResolved(NsdServiceInfo service) {
                        handler.post(() -> {
                            if (epoch != currentEpoch || !running || !enabled()) return;
                            // Match an address assigned to this phone, never a neighbouring device.
                            if (isLocalAddress(service.getHost()) && service.getPort() > 0 && service.getPort() <= 65535) {
                                tlsPort = service.getPort(); serviceName = service.getServiceName();
                                phase = "tls_listener_ready";
                            }
                        });
                    }
                });
            }
            public void onServiceLost(NsdServiceInfo service) {
                handler.post(() -> { if (epoch == currentEpoch && service.getServiceName().equals(serviceName)) { tlsPort = 0; serviceName = null; } });
            }
        };
        nsd.discoverServices("_adb-tls-connect._tcp.", NsdManager.PROTOCOL_DNS_SD, discovery);
    }

    private static boolean isLocalAddress(InetAddress address) {
        if (address == null || address.isAnyLocalAddress()) return false;
        try { return address.isLoopbackAddress() || NetworkInterface.getByInetAddress(address) != null; }
        catch (Exception error) { return false; }
    }

    private void stopDiscovery() {
        listenerReadySince = 0;
        epoch++; tlsPort = 0; serviceName = null;
        NsdManager.DiscoveryListener previous = discovery; discovery = null;
        if (previous != null) try { nsd.stopServiceDiscovery(previous); } catch (Exception ignored) {}
    }
}
