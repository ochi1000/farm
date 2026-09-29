package com.ocorp.xrunner;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

public final class PhoneActions {
    private PhoneActions() {}

    public static String openChrome(Context context, String url) {
        String targetUrl = url == null || url.isEmpty() ? MainActivity.DEFAULT_X_URL : url;
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(targetUrl));
            intent.setPackage("com.android.chrome");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            return "{\"ok\":true,\"action\":\"open_chrome\",\"url\":\"" + JsonUtil.escape(targetUrl) + "\"}";
        } catch (Exception error) {
            return "{\"ok\":false,\"action\":\"open_chrome\",\"error\":\"" + JsonUtil.escape(error.getMessage()) + "\"}";
        }
    }

    public static String openHome(Context context) {
        try {
            Intent intent = new Intent(Intent.ACTION_MAIN);
            intent.addCategory(Intent.CATEGORY_HOME);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            return "{\"ok\":true,\"action\":\"open_home\"}";
        } catch (Exception error) {
            return "{\"ok\":false,\"action\":\"open_home\",\"error\":\"" + JsonUtil.escape(error.getMessage()) + "\"}";
        }
    }
}
