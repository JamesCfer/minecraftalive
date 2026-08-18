package dev.celestia.minecraftalive.bridge;

import com.google.gson.JsonObject;
import dev.celestia.minecraftalive.MinecraftAlivePlugin;
import dev.celestia.minecraftalive.util.Json;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.net.InetSocketAddress;
import java.util.Collections;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * WebSocket server the MCP bridge connects to. First message from a client must be
 * {"cmd":"auth","args":{"token":"..."}}; until then every other command is refused.
 */
public class BridgeServer extends WebSocketServer {

    private final MinecraftAlivePlugin plugin;
    private final CommandDispatcher dispatcher;
    private final String token;
    private final Set<WebSocket> authed = Collections.newSetFromMap(new ConcurrentHashMap<>());

    public BridgeServer(InetSocketAddress address, MinecraftAlivePlugin plugin,
                        CommandDispatcher dispatcher, String token) {
        super(address);
        this.plugin = plugin;
        this.dispatcher = dispatcher;
        this.token = token;
    }

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        plugin.getLogger().info("Bridge client connected: " + conn.getRemoteSocketAddress());
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        authed.remove(conn);
        plugin.getLogger().info("Bridge client disconnected");
    }

    @Override
    public void onMessage(WebSocket conn, String message) {
        JsonObject req;
        try {
            req = Json.parse(message);
        } catch (Exception e) {
            conn.send(Json.error(null, "invalid json: " + e.getMessage()));
            return;
        }
        String id = Json.optString(req, "id", null);
        String cmd = Json.optString(req, "cmd", "");
        JsonObject args = req.has("args") && req.get("args").isJsonObject()
                ? req.getAsJsonObject("args") : new JsonObject();

        if (cmd.equals("auth")) {
            if (token.equals(Json.optString(args, "token", ""))) {
                authed.add(conn);
                JsonObject data = new JsonObject();
                data.addProperty("authed", true);
                conn.send(Json.ok(id, data));
            } else {
                conn.send(Json.error(id, "bad token"));
                conn.close();
            }
            return;
        }
        if (!authed.contains(conn)) {
            conn.send(Json.error(id, "not authenticated - send auth first"));
            return;
        }
        dispatcher.dispatch(conn, id, cmd, args);
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        plugin.getLogger().warning("Bridge error: " + ex.getMessage());
    }

    @Override
    public void onStart() {
        setConnectionLostTimeout(30);
    }

    /** Push an event to every authenticated client. Safe to call from any thread. */
    public void broadcastEvent(String event, JsonObject data) {
        JsonObject msg = new JsonObject();
        msg.addProperty("event", event);
        msg.add("data", data);
        String s = msg.toString();
        for (WebSocket ws : authed) {
            if (ws.isOpen()) ws.send(s);
        }
    }

    public int clientCount() {
        return authed.size();
    }
}
