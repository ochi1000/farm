package com.ocorp.geckoprobe;

import android.content.Context;
import android.net.Uri;
import android.os.*;
import android.app.KeyguardManager;
import android.media.Image;
import android.media.ImageReader;
import android.graphics.PixelFormat;
import org.json.*;
import org.mozilla.geckoview.*;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.function.Consumer;

/** Main-thread owner independent of Activity lifetime. Never reads browser auth stores. */
public final class BrowserEngine {
    private static BrowserEngine instance;
    private static GeckoRuntime runtime;
    private static final String PROCESS = UUID.randomUUID().toString();
    private final String run = UUID.randomUUID().toString();
    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ArrayDeque<JSONObject> events = new ArrayDeque<>();
    public final GeckoSession session;
    private WebExtension.Port port;
    private GeckoDisplay offscreenDisplay;
    private ImageReader imageReader;
    private GeckoView attachedView;
    private boolean closed, extensionReady;
    public boolean activityVisible;
    public String startReason = "manual";
    private String pendingId;
    private Consumer<JSONObject> pending;
    private JSONObject pendingEnvironment;
    public Consumer<String> listener;
    public static BrowserEngine get(Context c) {
        if(instance==null)instance=new BrowserEngine(c.getApplicationContext());return instance;
    }
    public static JSONObject obj(Object... pairs) {
        JSONObject j=new JSONObject();
        try{for(int i=0;i<pairs.length;i+=2)j.put((String)pairs[i],pairs[i+1]);}
        catch(JSONException e){throw new IllegalArgumentException("Diagnostic schema error");}return j;
    }
    public JSONObject state() {
        return obj("processId",PROCESS,"runId",run,"startReason",startReason,"activityVisible",activityVisible,
            "interactive",context.getSystemService(PowerManager.class).isInteractive(),
            "keyguardLocked",context.getSystemService(KeyguardManager.class).isKeyguardLocked(),
            "bridgeReady",port!=null,"appVersion",BuildConfig.VERSION_NAME,
            "displayOwner",attachedView!=null?"activity":offscreenDisplay!=null?"offscreen":"none");
    }
    public void event(String kind,JSONObject data) {
        if(events.size()>=100)events.removeFirst();events.add(obj("at",Instant.now().toString(),"kind",kind,"data",data));
        save();if(listener!=null)listener.accept(kind+": "+data);
    }
    public boolean save() {
        JSONObject report=obj("schema",3,"appVersion",BuildConfig.VERSION_NAME,"geckoDependency",BuildConfig.GECKO_VERSION,
            "androidSdk",Build.VERSION.SDK_INT,"privateSession",false,"userAgentOverride",false,"state",state(),"events",new JSONArray(events));
        try(FileOutputStream out=context.openFileOutput("report.json",Context.MODE_PRIVATE)){
            out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));return true;
        }catch(Exception e){return false;}
    }
    private String host(String url) {
        String h=url==null?"":Uri.parse(url).getHost();
        return "x.com".equals(h)||"www.x.com".equals(h)?"x":"twitter.com".equals(h)||"www.twitter.com".equals(h)?"twitter":"other";
    }
    private BrowserEngine(Context c) {
        context=c;if(runtime==null)runtime=GeckoRuntime.create(c);
        session=new GeckoSession(new GeckoSessionSettings.Builder().usePrivateMode(false).build());
        session.setContentDelegate(new GeckoSession.ContentDelegate(){
            @Override public void onCrash(GeckoSession s){port=null;event("content_crashed",state());}
            @Override public void onKill(GeckoSession s){port=null;event("content_killed",state());}
            @Override public void onFirstComposite(GeckoSession s){event("first_composite",state());}
        });
        session.setProgressDelegate(new GeckoSession.ProgressDelegate(){
            @Override public void onPageStart(GeckoSession s,String url){port=null;event("page_start",obj("hostGroup",host(url)));}
            @Override public void onPageStop(GeckoSession s,boolean ok){event("page_stop",obj("engineLoadSucceeded",ok));}
        });
        session.setNavigationDelegate(new GeckoSession.NavigationDelegate(){
            @Override public GeckoResult<String> onLoadError(GeckoSession s,String url,WebRequestError e){event("load_error",obj("hostGroup",host(url),"category",e.category,"code",e.code));return null;}
            @Override public GeckoResult<GeckoSession> onNewSession(GeckoSession s,String url){event("popup_not_supported",obj("hostGroup",host(url)));return null;}
            @Override public GeckoResult<AllowOrDeny> onLoadRequest(GeckoSession s,LoadRequest r){return GeckoResult.fromValue("https".equals(Uri.parse(r.uri).getScheme())?AllowOrDeny.ALLOW:AllowOrDeny.DENY);}
        });
        session.open(runtime);session.setActive(false);
        createOffscreen();
        event("engine_started",state());
        runtime.getWebExtensionController().ensureBuiltIn("resource://android/assets/probe/","probe@ocorp.local")
            .accept(this::bridge,e->event("extension_failed",obj("exceptionType",e.getClass().getSimpleName())));
    }
    private void createOffscreen(){
        if(closed||attachedView!=null||offscreenDisplay!=null)return;
        try{
            imageReader=ImageReader.newInstance(720,1280,PixelFormat.RGBA_8888,2);
            imageReader.setOnImageAvailableListener(reader->{
                // Drain buffers without inspecting or saving their pixels.
                try(Image image=reader.acquireLatestImage()){}catch(IllegalStateException ignored){}
            },main);
            offscreenDisplay=session.acquireDisplay();
            offscreenDisplay.surfaceChanged(new GeckoDisplay.SurfaceInfo.Builder(imageReader.getSurface()).size(720,1280).build());
            event("offscreen_attached",obj("width",720,"height",1280));
        }catch(RuntimeException e){releaseOffscreen();event("offscreen_failed",obj("exceptionType",e.getClass().getSimpleName()));}
    }
    private void releaseOffscreen(){
        if(offscreenDisplay!=null){
            offscreenDisplay.surfaceDestroyed();session.releaseDisplay(offscreenDisplay);offscreenDisplay=null;
        }
        if(imageReader!=null){imageReader.setOnImageAvailableListener(null,null);imageReader.close();imageReader=null;}
    }
    public void attachView(GeckoView view){
        if(attachedView==view)return;
        if(attachedView!=null)attachedView.releaseSession();
        releaseOffscreen();view.setSession(session);attachedView=view;
        event("display_attached_to_activity",state());
    }
    public void detachView(GeckoView view){
        if(attachedView!=view)return;
        view.releaseSession();attachedView=null;createOffscreen();
    }
    private void bridge(WebExtension extension) {
        if(closed)return;
        session.getWebExtensionController().setMessageDelegate(extension,new WebExtension.MessageDelegate(){
            @Override public void onConnect(WebExtension.Port p){
                if(p.sender.session!=session||!p.sender.isTopLevel()||"other".equals(host(p.sender.url))){p.disconnect();return;}
                port=p;
                p.setDelegate(new WebExtension.PortDelegate(){
                    @Override public void onDisconnect(WebExtension.Port p){if(port==p){port=null;event("bridge_disconnected",state());}}
                    @Override public void onPortMessage(Object message,WebExtension.Port p){
                        if(closed||p!=port||!(message instanceof JSONObject))return;
                        JSONObject input=(JSONObject)message,clean=obj();
                        try{
                            for(String k:new String[]{"webdriver","secureContext","ready","passwordFieldPresent","unsupportedBrowser","loginFailed","genericError","challenge","documentHidden"})clean.put(k,input.optBoolean(k));
                            for(String k:new String[]{"visiblePosts","extractedCharacters","alertCount","scrollBefore","scrollAfter","viewportHeight"})clean.put(k,Math.max(0,Math.min(10000000,input.optInt(k))));
                            for(String k:new String[]{"command","route","userAgent","language"}){String v=input.optString(k);clean.put(k,v.substring(0,Math.min(300,v.length())));}
                        }catch(JSONException e){return;}
                        event("dom_snapshot",clean);
                        if(pendingId!=null&&pendingId.equals(input.optString("requestId")))finish("completed",clean);
                    }
                });
            }
        },"probe");
        extensionReady=true;event("extension_ready",obj());openHome();
    }
    public void openHome(){
        event("open_home_requested",obj("extensionReady",extensionReady,"closed",closed,"sessionOpen",session.isOpen(),"activityVisible",activityVisible));
        if(!extensionReady||closed){event("open_home_unavailable",obj("extensionReady",extensionReady,"closed",closed));return;}
        try{
            if(activityVisible)session.setActive(true);
            session.loadUri("https://x.com/home");
        }catch(RuntimeException e){event("open_home_failed",obj("exceptionType",e.getClass().getSimpleName()));}
    }
    public void command(String id,String command,Consumer<JSONObject> callback){
        if(closed){callback.accept(obj("id",id,"outcome","stopped"));return;}
        if(!Arrays.asList("status","capture","read","scroll").contains(command)){callback.accept(obj("id",id,"outcome","invalid_command"));return;}
        if("status".equals(command)){callback.accept(obj("id",id,"outcome","completed","state",state()));return;}
        if(pending!=null){callback.accept(obj("id",id,"outcome","busy","state",state()));return;}
        if(port==null){callback.accept(obj("id",id,"outcome","bridge_unavailable","state",state()));return;}
        pending=callback;pendingId=id;pendingEnvironment=state();
        event("command_started",obj("id",id,"command",command,"state",pendingEnvironment));
        try{port.postMessage(obj("requestId",id,"command",command));}catch(Exception e){finish("send_failed",obj());return;}
        main.postDelayed(()->{if(id.equals(pendingId))finish("timeout",obj());},15000);
    }
    private void finish(String outcome,JSONObject snapshot){
        Consumer<JSONObject> callback=pending;
        JSONObject result=obj("id",pendingId,"outcome",outcome,"startedState",pendingEnvironment,"state",state(),"snapshot",snapshot);
        pending=null;pendingId=null;pendingEnvironment=null;event("command_result",result);if(callback!=null)callback.accept(result);
    }
    public void close(){closed=true;if(pending!=null)finish("stopped",obj());port=null;releaseOffscreen();if(attachedView!=null){attachedView.releaseSession();attachedView=null;}session.close();event("engine_stopped",obj());instance=null;}
}
