package com.ocorp.geckoprobe;
import android.content.*;

public class ProbeBootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c,Intent i){
        String a=i.getAction();
        if(!Intent.ACTION_BOOT_COMPLETED.equals(a)&&!Intent.ACTION_MY_PACKAGE_REPLACED.equals(a))return;
        if(!c.getSharedPreferences("probe",Context.MODE_PRIVATE).getBoolean("enabled",false))return;
        // Credential-protected browser profile: start after first unlock, not locked boot.
        try{c.startForegroundService(new Intent(c,ProbeService.class).putExtra("reason",Intent.ACTION_BOOT_COMPLETED.equals(a)?"boot_completed":"package_replaced"));}
        catch(RuntimeException e){
            c.getSharedPreferences("probe",Context.MODE_PRIVATE).edit().putString("bootStartError",e.getClass().getSimpleName()).apply();
        }
    }
}
