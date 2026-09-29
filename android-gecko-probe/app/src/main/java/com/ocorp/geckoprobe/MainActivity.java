package com.ocorp.geckoprobe;
import android.app.*;
import android.content.*;
import android.os.*;
import android.widget.*;
import org.mozilla.geckoview.GeckoView;
import java.util.UUID;

public class MainActivity extends Activity {
    private BrowserEngine engine;
    private GeckoView view;
    private TextView status;
    private void button(LinearLayout row,String label,Runnable action){
        Button b=new Button(this);b.setText(label);row.addView(b,new LinearLayout.LayoutParams(0,-2,1));b.setOnClickListener(v->action.run());
    }
    private void command(String name){engine.command(UUID.randomUUID().toString(),name,r->status.setText(r.toString()));}
    @Override public void onCreate(Bundle saved){
        super.onCreate(saved);
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setFitsSystemWindows(true);
        LinearLayout row=new LinearLayout(this);root.addView(row);
        button(row,"Open X",()->engine.openHome());button(row,"Read",()->command("read"));button(row,"Scroll",()->command("scroll"));
        LinearLayout second=new LinearLayout(this);root.addView(second);
        button(second,"Capture",()->command("capture"));button(second,"Save",()->status.setText(engine.save()?"Report saved":"Report write failed"));
        button(second,"Outcome",()->new AlertDialog.Builder(this).setTitle("Manual observation").setItems(new String[]{"Signed in","Login rejected","Other"},
            (d,i)->engine.event("user_observation",BrowserEngine.obj("outcome",new String[]{"signed_in","login_rejected","other"}[i]))).show());
        LinearLayout third=new LinearLayout(this);root.addView(third);
        button(third,"Enable service",()->{
            if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)
                requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},1);
            getSharedPreferences("probe",MODE_PRIVATE).edit().putBoolean("enabled",true).commit();
            startForegroundService(new Intent(this,ProbeService.class).putExtra("reason","user_enabled"));
        });
        button(third,"Stop service",()->{
            getSharedPreferences("probe",MODE_PRIVATE).edit().putBoolean("enabled",false).commit();
            engine.listener=null;stopService(new Intent(this,ProbeService.class));finishAndRemoveTask();
        });
        button(third,"Hide browser",()->finishAndRemoveTask());
        status=new TextView(this);status.setMaxLines(4);root.addView(status);
        view=new GeckoView(this);root.addView(view,new LinearLayout.LayoutParams(-1,0,1));setContentView(root);
        engine=BrowserEngine.get(this);
        if(getSharedPreferences("probe",MODE_PRIVATE).getBoolean("enabled",false))
            startForegroundService(new Intent(this,ProbeService.class).putExtra("reason","activity_resume"));
    }
    @Override protected void onStart(){
        super.onStart();
        BrowserEngine current=BrowserEngine.get(this);
        if(current!=engine){engine.detachView(view);engine=current;}
        engine.attachView(view);
        engine.listener=s->status.setText(s);engine.activityVisible=true;engine.session.setActive(true);engine.event("activity_started",engine.state());
    }
    @Override protected void onStop(){engine.activityVisible=false;engine.session.setActive(false);engine.detachView(view);engine.event("activity_stopped",engine.state());engine.listener=null;super.onStop();}
    @Override protected void onDestroy(){engine.detachView(view);super.onDestroy();}
    @Override public void onBackPressed(){engine.session.goBack();}
}
