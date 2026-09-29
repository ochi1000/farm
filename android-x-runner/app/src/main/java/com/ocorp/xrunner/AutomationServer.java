package com.ocorp.xrunner;

import android.content.Context;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class AutomationServer {
    private final Context context;
    private final int port;
    private volatile boolean running;
    private Thread thread;
    private ServerSocket serverSocket;

    public AutomationServer(Context context, int port) {
        this.context = context.getApplicationContext();
        this.port = port;
    }

    public void start() {
        if (running) return;
        running = true;
        thread = new Thread(this::runLoop, "x-runner-http");
        thread.start();
    }

    public void stop() {
        running = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException ignored) {
        }
    }

    private void runLoop() {
        try {
            serverSocket = new ServerSocket(port, 20, InetAddress.getByName("127.0.0.1"));
            while (running) {
                Socket socket = serverSocket.accept();
                new Thread(() -> handle(socket), "x-runner-http-client").start();
            }
        } catch (IOException ignored) {
            running = false;
        }
    }

    private void handle(Socket socket) {
        try (Socket s = socket;
             BufferedReader reader = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.UTF_8));
             OutputStream out = s.getOutputStream()) {
            String requestLine = reader.readLine();
            if (requestLine == null || requestLine.isEmpty()) return;

            String[] parts = requestLine.split(" ");
            String target = parts.length > 1 ? parts[1] : "/";
            String path = target.split("\\?", 2)[0];
            Map<String, String> query = parseQuery(target);

            String body;
            int status = 200;
            try {
                if (("/chrome/open".equals(path) || "/home".equals(path))
                        && !context.getSystemService(android.os.UserManager.class).isUserUnlocked()) {
                    status = 423;
                    body = "{\"ok\":false,\"error\":\"Manual user unlock required\"}";
                } else if ("/health".equals(path)) {
                    body = "{\"ok\":true,\"app\":\"phone-relay\",\"relay\":" + RelayClient.get().statusJson() + "}";
                } else if ("/chrome/open".equals(path)) {
                    body = PhoneActions.openChrome(context, query.getOrDefault("url", MainActivity.DEFAULT_X_URL));
                } else if ("/home".equals(path)) {
                    body = PhoneActions.openHome(context);
                } else if ("/adb-probe".equals(path)) {
                    body = AdbProbe.probe();
                } else if ("/adb/recovery/status".equals(path)) {
                    body = WirelessAdbRecovery.get().statusJson();
                } else if ("/relay/start".equals(path)) {
                    String host = query.get("host");
                    int relayPort = Integer.parseInt(query.getOrDefault("port", "0"));
                    String token = query.getOrDefault("token", "");
                    boolean tls = Boolean.parseBoolean(query.getOrDefault("tls", "true"));
                    if (host == null || host.isEmpty() || relayPort <= 0) {
                        status = 400;
                        body = "{\"ok\":false,\"error\":\"host and port are required\"}";
                    } else {
                        RelayClient.get().start(context, host, relayPort, token, tls);
                        body = "{\"ok\":true,\"relay\":" + RelayClient.get().statusJson() + "}";
                    }
                } else if ("/relay/stop".equals(path)) {
                    RelayClient.get().stop();
                    body = "{\"ok\":true,\"relay\":" + RelayClient.get().statusJson() + "}";
                } else if ("/relay/status".equals(path)) {
                    body = "{\"ok\":true,\"relay\":" + RelayClient.get().statusJson() + "}";
                } else {
                    status = 404;
                    body = "{\"ok\":false,\"error\":\"unknown endpoint\"}";
                }
            } catch (Exception error) {
                status = 500;
                body = "{\"ok\":false,\"error\":\"" + JsonUtil.escape(error.getMessage()) + "\"}";
            }

            writeResponse(out, status, body);
        } catch (IOException ignored) {
        }
    }

    private static Map<String, String> parseQuery(String target) {
        Map<String, String> result = new HashMap<>();
        String[] split = target.split("\\?", 2);
        if (split.length < 2) return result;
        for (String pair : split[1].split("&")) {
            String[] parts = pair.split("=", 2);
            String key = decode(parts[0]);
            String value = parts.length > 1 ? decode(parts[1]) : "";
            result.put(key, value);
        }
        return result;
    }

    private static String decode(String value) {
        return URLDecoder.decode(value, StandardCharsets.UTF_8);
    }

    private static void writeResponse(OutputStream out, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        String reason = status == 200 ? "OK" : status == 404 ? "Not Found" : "Error";
        String headers = "HTTP/1.1 " + status + " " + reason + "\r\n"
                + "Content-Type: application/json; charset=utf-8\r\n"
                + "Content-Length: " + bytes.length + "\r\n"
                + "Connection: close\r\n\r\n";
        out.write(headers.getBytes(StandardCharsets.UTF_8));
        out.write(bytes);
    }
}
