package com.ocorp.xrunner;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.util.UUID;

import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManagerFactory;

public class RelayClient {
    private static final int FRAME_HELLO = 1;
    private static final int FRAME_HEARTBEAT = 2;
    private static final int FRAME_DATA = 3;
    private static final int FRAME_CLOSE = 4;
    private static final int FRAME_ADB_PROBE = 5;
    private static final int MAX_FRAME_BYTES = 1024 * 1024;
    private static final long HEARTBEAT_MS = 15000;
    private static final long SERVER_TIMEOUT_MS = 45000;
    private static final String PREFS = "relay_config";
    private static final String CA_CERT_FILE = "relay-ca.crt";
    private static final String CLIENT_KEYSTORE_FILE = "relay-client.p12";
    private static final String CLIENT_KEYSTORE_PASSWORD_FILE = "relay-client.pass";
    private static final RelayClient INSTANCE = new RelayClient();

    private final Object serverWriteLock = new Object();
    private volatile boolean running;
    private volatile String status = "stopped";
    private volatile String lastError = "";
    private volatile int reconnectAttempt;
    private volatile long nextReconnectAt;
    private volatile int generation;
    private Context appContext;
    private String deviceId = "";
    private Thread thread;
    private Socket relaySocket;
    private Socket adbSocket;
    private Thread adbReaderThread;

    public static RelayClient get() {
        return INSTANCE;
    }

    public synchronized void initialize(Context context) {
        Context storage = RelayStorage.prepare(context);
        if (appContext != null) return;
        appContext = storage;
        SharedPreferences preferences = prefs();
        deviceId = preferences.getString("deviceId", "");
        if (deviceId == null || deviceId.isEmpty()) {
            deviceId = UUID.randomUUID().toString();
            preferences.edit().putString("deviceId", deviceId).apply();
        }
    }

    public synchronized void resumeSavedConnection(Context context) {
        initialize(context);
        SharedPreferences preferences = prefs();
        String host = preferences.getString("host", "");
        int port = preferences.getInt("port", 0);
        String token = preferences.getString("token", "");
        boolean tls = preferences.getBoolean("tls", true);
        boolean enabled = preferences.getBoolean("enabled", false);
        if (enabled && host != null && !host.isEmpty() && port > 0 && token != null && !token.isEmpty()) {
            startInternal(host, port, token, tls, false);
        }
    }

    public synchronized void start(Context context, String host, int port, String token, boolean tls) {
        initialize(context);
        prefs().edit()
                .putString("host", host)
                .putInt("port", port)
                .putString("token", token)
                .putBoolean("tls", tls)
                .putBoolean("enabled", true)
                .apply();
        startInternal(host, port, token, tls, true);
    }

    private synchronized void startInternal(String host, int port, String token, boolean tls, boolean replace) {
        if (running && !replace) return;
        stopInternal(false);
        running = true;
        status = "starting";
        lastError = "";
        reconnectAttempt = 0;
        nextReconnectAt = 0;
        int runGeneration = ++generation;
        thread = new Thread(() -> runLoop(host, port, token, tls, runGeneration), "all-in-relay-client");
        thread.start();
    }

    public synchronized void stop() {
        stopInternal(true);
    }

    public synchronized void shutdown() {
        stopInternal(false);
    }

    private void stopInternal(boolean disableSavedConnection) {
        running = false;
        generation++;
        closeRelay();
        closeAdb();
        if (thread != null) thread.interrupt();
        thread = null;
        nextReconnectAt = 0;
        status = "stopped";
        if (disableSavedConnection && appContext != null) {
            prefs().edit().putBoolean("enabled", false).apply();
        }
    }

    public String statusJson() {
        return "{\"running\":" + running
                + ",\"status\":\"" + JsonUtil.escape(status) + "\""
                + ",\"lastError\":\"" + JsonUtil.escape(lastError) + "\""
                + ",\"deviceId\":\"" + JsonUtil.escape(deviceId) + "\""
                + ",\"reconnectAttempt\":" + reconnectAttempt
                + ",\"nextReconnectAt\":" + nextReconnectAt
                + "}";
    }

    private void runLoop(String host, int port, String token, boolean tls, int runGeneration) {
        while (isCurrent(runGeneration)) {
            try (Socket socket = openSocket(host, port, tls);
                 DataOutputStream out = new DataOutputStream(socket.getOutputStream());
                 DataInputStream in = new DataInputStream(socket.getInputStream())) {
                relaySocket = socket;
                status = "connected";
                lastError = "";
                reconnectAttempt = 0;
                nextReconnectAt = 0;
                sendFrame(out, FRAME_HELLO, bytes(helloJson(token, tls)));

                long nextHeartbeat = 0;
                long lastServerFrameAt = System.currentTimeMillis();
                while (isCurrent(runGeneration) && !socket.isClosed()) {
                    long now = System.currentTimeMillis();
                    if (now >= nextHeartbeat) {
                        sendFrame(out, FRAME_HEARTBEAT, bytes(heartbeatJson()));
                        nextHeartbeat = now + HEARTBEAT_MS;
                    }
                    if (now - lastServerFrameAt > SERVER_TIMEOUT_MS) {
                        throw new IOException("Relay heartbeat timeout");
                    }
                    try {
                        int type = in.readInt();
                        int length = in.readInt();
                        if (length < 0 || length > MAX_FRAME_BYTES) throw new IOException("Invalid frame length: " + length);
                        byte[] payload = new byte[length];
                        in.readFully(payload);
                        lastServerFrameAt = System.currentTimeMillis();
                        handleFrame(type, payload, out);
                    } catch (SocketTimeoutException ignored) {
                        // Wake periodically to send heartbeats and detect a stale relay connection.
                    }
                }
            } catch (Exception error) {
                if (!isCurrent(runGeneration)) break;
                status = "reconnecting";
                lastError = message(error);
                closeAdb();
                long delay = reconnectDelay(++reconnectAttempt);
                nextReconnectAt = System.currentTimeMillis() + delay;
                sleepQuietly(delay);
            } finally {
                relaySocket = null;
            }
        }
        if (runGeneration == generation) status = "stopped";
    }

    private Socket openSocket(String host, int port, boolean tls) throws Exception {
        Socket socket = tls ? createMutualTlsSocket(host) : new Socket();
        socket.connect(new InetSocketAddress(host, port), 10000);
        socket.setKeepAlive(true);
        socket.setSoTimeout(1000);
        if (socket instanceof SSLSocket) ((SSLSocket) socket).startHandshake();
        return socket;
    }

    private SSLSocket createMutualTlsSocket(String host) throws Exception {
        File caFile = new File(appContext.getFilesDir(), CA_CERT_FILE);
        File clientFile = new File(appContext.getFilesDir(), CLIENT_KEYSTORE_FILE);
        File passwordFile = new File(appContext.getFilesDir(), CLIENT_KEYSTORE_PASSWORD_FILE);
        if (!caFile.isFile() || !clientFile.isFile() || !passwordFile.isFile()) {
            throw new IOException("mTLS credentials are not provisioned");
        }
        char[] clientPassword = new String(Files.readAllBytes(passwordFile.toPath()), StandardCharsets.US_ASCII).trim().toCharArray();
        if (clientPassword.length == 0) throw new IOException("mTLS keystore password is empty");

        Certificate caCertificate;
        try (InputStream input = new FileInputStream(caFile)) {
            caCertificate = CertificateFactory.getInstance("X.509").generateCertificate(input);
        }
        KeyStore trustStore = KeyStore.getInstance(KeyStore.getDefaultType());
        trustStore.load(null);
        trustStore.setCertificateEntry("relay-ca", caCertificate);
        TrustManagerFactory trustManagers = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        trustManagers.init(trustStore);

        KeyStore clientStore = KeyStore.getInstance("PKCS12");
        try (InputStream input = new FileInputStream(clientFile)) {
            clientStore.load(input, clientPassword);
        }
        KeyManagerFactory keyManagers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
        keyManagers.init(clientStore, clientPassword);

        SSLContext context = SSLContext.getInstance("TLS");
        context.init(keyManagers.getKeyManagers(), trustManagers.getTrustManagers(), null);
        SSLSocket socket = (SSLSocket) context.getSocketFactory().createSocket();
        SSLParameters parameters = socket.getSSLParameters();
        parameters.setEndpointIdentificationAlgorithm("HTTPS");
        socket.setSSLParameters(parameters);
        socket.setEnabledProtocols(new String[]{"TLSv1.3", "TLSv1.2"});
        return socket;
    }

    private void handleFrame(int type, byte[] payload, DataOutputStream out) throws IOException {
        if (type == FRAME_HEARTBEAT) {
            sendFrame(out, FRAME_HEARTBEAT, bytes(heartbeatJson()));
        } else if (type == FRAME_ADB_PROBE) {
            sendFrame(out, FRAME_ADB_PROBE, bytes("{\"type\":\"adb_probe_result\",\"payload\":" + AdbProbe.probe() + "}"));
        } else if (type == FRAME_DATA) {
            ensureAdbReader(out);
            synchronized (this) {
                adbSocket.getOutputStream().write(payload);
                adbSocket.getOutputStream().flush();
            }
        } else if (type == FRAME_CLOSE) {
            closeAdb();
        }
    }

    private synchronized void ensureAdbReader(DataOutputStream serverOut) throws IOException {
        if (adbSocket != null && adbSocket.isConnected() && !adbSocket.isClosed()) return;
        adbSocket = AdbProbe.connect(5000);
        adbSocket.setKeepAlive(true);
        adbReaderThread = new Thread(() -> pumpAdbToServer(serverOut), "all-in-adb-reader");
        adbReaderThread.start();
    }

    private void pumpAdbToServer(DataOutputStream serverOut) {
        byte[] buffer = new byte[16384];
        try {
            InputStream input = adbSocket.getInputStream();
            int read;
            while (running && adbSocket != null && !adbSocket.isClosed() && (read = input.read(buffer)) != -1) {
                byte[] payload = new byte[read];
                System.arraycopy(buffer, 0, payload, 0, read);
                sendFrame(serverOut, FRAME_DATA, payload);
            }
        } catch (Exception error) {
            lastError = message(error);
        } finally {
            try {
                sendFrame(serverOut, FRAME_CLOSE, new byte[0]);
            } catch (IOException ignored) {
            }
            closeAdb();
        }
    }

    private synchronized void closeRelay() {
        try {
            if (relaySocket != null) relaySocket.close();
        } catch (IOException ignored) {
        }
        relaySocket = null;
    }

    private synchronized void closeAdb() {
        try {
            if (adbSocket != null) adbSocket.close();
        } catch (IOException ignored) {
        }
        adbSocket = null;
        if (adbReaderThread != null) adbReaderThread.interrupt();
        adbReaderThread = null;
    }

    private String helloJson(String token, boolean tls) {
        return "{\"type\":\"hello\""
                + ",\"token\":\"" + JsonUtil.escape(token) + "\""
                + ",\"deviceId\":\"" + JsonUtil.escape(deviceId) + "\""
                + ",\"model\":\"" + JsonUtil.escape(Build.MODEL) + "\""
                + ",\"manufacturer\":\"" + JsonUtil.escape(Build.MANUFACTURER) + "\""
                + ",\"sdk\":" + Build.VERSION.SDK_INT
                + ",\"tls\":" + tls
                + "}";
    }

    private String heartbeatJson() {
        return "{\"type\":\"heartbeat\""
                + ",\"at\":" + System.currentTimeMillis()
                + ",\"adbProbe\":" + AdbProbe.probe()
                + "}";
    }

    private void sendFrame(DataOutputStream out, int type, byte[] payload) throws IOException {
        synchronized (serverWriteLock) {
            out.writeInt(type);
            out.writeInt(payload.length);
            out.write(payload);
            out.flush();
        }
    }

    private SharedPreferences prefs() {
        return appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private boolean isCurrent(int runGeneration) {
        return running && runGeneration == generation;
    }

    private static byte[] bytes(String value) {
        return value.getBytes(StandardCharsets.UTF_8);
    }

    private static String message(Exception error) {
        return error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
    }

    private static long reconnectDelay(int attempt) {
        long exponential = 1000L << Math.min(Math.max(attempt - 1, 0), 6);
        return Math.min(exponential, 60000L);
    }

    private void sleepQuietly(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }
}
