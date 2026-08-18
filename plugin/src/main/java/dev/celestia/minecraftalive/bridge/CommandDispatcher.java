package dev.celestia.minecraftalive.bridge;

import com.google.gson.JsonObject;
import dev.celestia.minecraftalive.MinecraftAlivePlugin;
import dev.celestia.minecraftalive.util.Json;
import org.bukkit.Bukkit;
import org.java_websocket.WebSocket;

import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Maps command names to handlers and runs them on the main server thread,
 * replying to the WebSocket client when done.
 */
public class CommandDispatcher {

    @FunctionalInterface
    public interface Handler {
        /** Runs on the main thread. Return value becomes the "data" field of the reply. */
        JsonObject handle(JsonObject args) throws Exception;
    }

    private final MinecraftAlivePlugin plugin;
    private final Map<String, Handler> handlers = new ConcurrentHashMap<>();

    public CommandDispatcher(MinecraftAlivePlugin plugin) {
        this.plugin = plugin;
        register("list_commands", args -> {
            JsonObject data = new JsonObject();
            data.add("commands", Json.toArray(new TreeMap<>(handlers).keySet()));
            return data;
        });
    }

    public void register(String name, Handler handler) {
        handlers.put(name, handler);
    }

    public void dispatch(WebSocket conn, String id, String cmd, JsonObject args) {
        Handler handler = handlers.get(cmd);
        if (handler == null) {
            conn.send(Json.error(id, "unknown command: " + cmd));
            return;
        }
        Bukkit.getScheduler().runTask(plugin, () -> {
            try {
                JsonObject data = handler.handle(args);
                conn.send(Json.ok(id, data == null ? new JsonObject() : data));
            } catch (Exception e) {
                conn.send(Json.error(id, e.getMessage() == null ? e.toString() : e.getMessage()));
            }
        });
    }
}
