package com.ocorp.geckoprobe;

import android.app.*;
import android.content.*;
import android.os.*;
import android.util.Base64;
import org.json.*;
import javax.net.ssl.*;
import java.io.*;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyStore;
import java.security.cert.CertificateFactory;
import java.util.concurrent.*;

public class ProbeService extends Service {
    private final Handler main=new Handler(Looper.getMainLooper());
    private volatile boolean running;
    private volatile HttpsURLConnection connection;
    private Thread worker;
    private BrowserEngine engine;
    private PowerManager.WakeLock wake;
    private String networkState="";
    @Override public void onCreate(){
        super.onCreate();
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("gecko-probe","Gecko remote test",NotificationManager.IMPORTANCE_LOW));
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,ProbeService.class).setAction("STOP"),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification=new Notification.Builder(this,"gecko-probe").setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("Gecko Probe test enabled").setContentText("Remote read/scroll service; tap to open")
            .setContentIntent(open).addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel,"Stop",stop).build()).setOngoing(true).build();
        startForeground(3001,notification);
        engine=BrowserEngine.get(this);
        wake=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"GeckoProbe:command");
        wake.setReferenceCounted(false);
    }
    @Override public int onStartCommand(Intent i,int flags,int startId){
        if(i!=null&&"STOP".equals(i.getAction())){
            getSharedPreferences("probe",MODE_PRIVATE).edit().putBoolean("enabled",false).commit();stopSelf();return START_NOT_STICKY;
        }
        if(!getSharedPreferences("probe",MODE_PRIVATE).getBoolean("enabled",false)){stopSelf();return START_NOT_STICKY;}
        if(!running){
            engine.startReason=i==null?"sticky_restart":i.getStringExtra("reason");
            engine.event("service_started",engine.state());running=true;
            worker=new Thread(this::loop,"gecko-probe-poll");worker.start();
        }
        return START_STICKY;
    }
    private void note(String state){
        main.post(()->{if(running&&!state.equals(networkState)){networkState=state;engine.event("remote_transport",BrowserEngine.obj("state",state));}});
    }
    private SSLSocketFactory tls(JSONObject cfg)throws Exception{
        KeyStore keys=KeyStore.getInstance("PKCS12");
        char[] password=cfg.getString("p12Password").toCharArray();
        keys.load(new ByteArrayInputStream(Base64.decode(cfg.getString("p12"),Base64.DEFAULT)),password);
        KeyManagerFactory km=KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());km.init(keys,password);
        KeyStore trust=KeyStore.getInstance(KeyStore.getDefaultType());trust.load(null,null);
        trust.setCertificateEntry("ca",CertificateFactory.getInstance("X.509").generateCertificate(new ByteArrayInputStream(cfg.getString("ca").getBytes(StandardCharsets.UTF_8))));
        TrustManagerFactory tm=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());tm.init(trust);
        SSLContext ssl=SSLContext.getInstance("TLS");ssl.init(km.getKeyManagers(),tm.getTrustManagers(),null);return ssl.getSocketFactory();
    }
    private JSONObject request(JSONObject cfg,SSLSocketFactory factory,String path,JSONObject body)throws Exception{
        URL base=new URL(cfg.getString("endpoint"));
        if(!"https".equals(base.getProtocol())||base.getUserInfo()!=null||base.getQuery()!=null||base.getRef()!=null)throw new IOException("invalid_endpoint");
        URL url=new URL(base,"/devices/"+cfg.getString("deviceId")+"/"+path);
        HttpsURLConnection c=(HttpsURLConnection)url.openConnection();connection=c;
        c.setSSLSocketFactory(factory); // Default hostname verification remains enabled.
        c.setInstanceFollowRedirects(false);c.setConnectTimeout(8000);c.setReadTimeout(10000);
        c.setRequestProperty("Authorization","Bearer "+cfg.getString("token"));
        c.setRequestProperty("Content-Type","application/json");c.setRequestMethod("POST");c.setDoOutput(true);
        byte[] payload=body.toString().getBytes(StandardCharsets.UTF_8);c.setFixedLengthStreamingMode(payload.length);
        try{
            try(OutputStream out=c.getOutputStream()){out.write(payload);}
            if(c.getResponseCode()!=200)throw new IOException("http_"+c.getResponseCode());
            ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[2048];int n;
            try(InputStream in=c.getInputStream()){while((n=in.read(buffer))!=-1){if(out.size()+n>32768)throw new IOException("response_limit");out.write(buffer,0,n);}}
            return new JSONObject(out.toString("UTF-8"));
        }finally{c.disconnect();if(connection==c)connection=null;}
    }
    private JSONObject execute(JSONObject command)throws Exception{
        String id=command.getString("id"),action=command.getString("command");
        if(!id.matches("[a-f0-9-]{36}"))throw new IOException("bad_command_id");
        if(System.currentTimeMillis()>command.getLong("expiresAt"))return BrowserEngine.obj("id",id,"outcome","expired");
        CompletableFuture<JSONObject> result=new CompletableFuture<>();
        // Durable last-delivery marker: a lost response never causes a scroll replay.
        if(id.equals(getSharedPreferences("probe",MODE_PRIVATE).getString("lastCommand","")))return BrowserEngine.obj("id",id,"outcome","duplicate_not_replayed");
        if(!getSharedPreferences("probe",MODE_PRIVATE).edit().putString("lastCommand",id).commit())throw new IOException("journal_failed");
        main.post(()->{
            if(!running){result.complete(BrowserEngine.obj("id",id,"outcome","stopped"));return;}
            wake.acquire(20000);
            engine.command(id,action,value->{if(wake.isHeld())wake.release();result.complete(value);});
        });
        return result.get(18,TimeUnit.SECONDS);
    }
    private void loop(){
        try{
            File config=new File(getFilesDir(),"remote-config.json");
            if(!config.exists()){note("not_provisioned");return;}
            JSONObject cfg=new JSONObject(new String(Files.readAllBytes(config.toPath()),StandardCharsets.UTF_8));
            if(!cfg.getString("deviceId").matches("[a-zA-Z0-9_-]{1,128}"))throw new IOException("bad_device_id");
            SSLSocketFactory factory=tls(cfg);
            while(running){
                try{
                    CompletableFuture<JSONObject> state=new CompletableFuture<>();main.post(()->state.complete(engine.state()));
                    JSONObject reply=request(cfg,factory,"poll",state.get(3,TimeUnit.SECONDS));note("connected");
                    if(reply.optJSONObject("command")!=null){
                        JSONObject result=execute(reply.getJSONObject("command"));
                        request(cfg,factory,"result",result);
                    }
                }catch(Exception e){if(running)note("request_failed_"+e.getClass().getSimpleName());}
                if(running)Thread.sleep(5000);
            }
        }catch(InterruptedException e){Thread.currentThread().interrupt();}
        catch(Exception e){note("configuration_failed_"+e.getClass().getSimpleName());}
    }
    @Override public void onDestroy(){
        running=false;if(connection!=null)connection.disconnect();if(worker!=null)worker.interrupt();
        if(wake!=null&&wake.isHeld())wake.release();
        // Keep a visible manual browser usable after notification Stop; remote transport is stopped.
        if(engine!=null){engine.event("service_stopped",BrowserEngine.obj());if(!engine.activityVisible)engine.close();}
        super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent){return null;}
}
