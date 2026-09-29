package com.ocorp.xrunner;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Socket;

public final class AdbProbe {
    private AdbProbe() {}

    static Socket connect(int timeoutMs) throws IOException {
        int tlsPort = WirelessAdbRecovery.get().port();
        for (int port : new int[]{5555, tlsPort}) {
            if (port <= 0 || port > 65535) continue;
            Socket socket = new Socket();
            try { socket.connect(new InetSocketAddress("127.0.0.1", port), timeoutMs); return socket; }
            catch (IOException error) { try { socket.close(); } catch (IOException ignored) {} }
        }
        throw new IOException("No local ADB listener is ready");
    }

    public static String probe() {
        long started = System.currentTimeMillis();
        try (Socket socket = connect(2000)) {
            return "{\"ok\":true,\"host\":\"127.0.0.1\",\"port\":" + socket.getPort()
                    + ",\"transport\":\"" + (socket.getPort() == 5555 ? "legacy" : "tls")
                    + "\",\"durationMs\":" + (System.currentTimeMillis() - started) + "}";
        } catch (IOException error) {
            return "{\"ok\":false,\"host\":\"127.0.0.1\",\"port\":5555,\"durationMs\":"
                    + (System.currentTimeMillis() - started)
                    + ",\"error\":\"" + JsonUtil.escape(error.getMessage()) + "\"}";
        }
    }
}
