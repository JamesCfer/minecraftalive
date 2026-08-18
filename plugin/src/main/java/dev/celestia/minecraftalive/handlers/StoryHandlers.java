package dev.celestia.minecraftalive.handlers;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.celestia.minecraftalive.MinecraftAlivePlugin;
import dev.celestia.minecraftalive.bridge.CommandDispatcher;
import dev.celestia.minecraftalive.util.Json;
import net.kyori.adventure.bossbar.BossBar;
import net.kyori.adventure.text.minimessage.MiniMessage;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Story memory (arbitrary JSON the game master persists between sessions),
 * boss bars for quest/story headers, and gated console command access.
 */
public class StoryHandlers {

    private final MinecraftAlivePlugin plugin;
    private final MiniMessage mm = MiniMessage.miniMessage();
    private final Map<String, BossBar> bossBars = new ConcurrentHashMap<>();
    private JsonObject storyState = new JsonObject();

    public StoryHandlers(MinecraftAlivePlugin plugin) {
        this.plugin = plugin;
        loadState();
    }

    public void register(CommandDispatcher d) {
        d.register("story_get", args -> {
            JsonObject data = new JsonObject();
            data.add("state", storyState);
            return data;
        });
        d.register("story_set", this::storySet);
        d.register("bossbar_set", this::bossbarSet);
        d.register("bossbar_remove", this::bossbarRemove);
        d.register("run_command", this::runCommand);
    }

    /** Merge the given keys into story state; a JSON null value deletes the key. */
    private JsonObject storySet(JsonObject args) {
        JsonObject patch = args.getAsJsonObject("state");
        if (patch == null) throw new IllegalArgumentException("missing required arg: state");
        for (Map.Entry<String, com.google.gson.JsonElement> e : patch.entrySet()) {
            if (e.getValue().isJsonNull()) storyState.remove(e.getKey());
            else storyState.add(e.getKey(), e.getValue());
        }
        save();
        JsonObject data = new JsonObject();
        data.add("state", storyState);
        return data;
    }

    private JsonObject bossbarSet(JsonObject args) {
        String id = Json.reqString(args, "id");
        String text = Json.reqString(args, "text");
        float progress = (float) Math.clamp(Json.optDouble(args, "progress", 1.0), 0.0, 1.0);
        BossBar.Color color;
        try {
            color = BossBar.Color.valueOf(Json.optString(args, "color", "PURPLE").toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("color must be one of PINK BLUE RED GREEN YELLOW PURPLE WHITE");
        }
        BossBar bar = bossBars.get(id);
        if (bar == null) {
            bar = BossBar.bossBar(mm.deserialize(text), progress, color, BossBar.Overlay.PROGRESS);
            bossBars.put(id, bar);
        } else {
            bar.name(mm.deserialize(text));
            bar.progress(progress);
            bar.color(color);
        }
        for (Player p : Bukkit.getOnlinePlayers()) p.showBossBar(bar);
        return null;
    }

    private JsonObject bossbarRemove(JsonObject args) {
        BossBar bar = bossBars.remove(Json.reqString(args, "id"));
        if (bar != null) {
            for (Player p : Bukkit.getOnlinePlayers()) p.hideBossBar(bar);
        }
        return null;
    }

    /** Show all active boss bars to a newly joined player. */
    public void showBarsTo(Player p) {
        for (BossBar bar : bossBars.values()) p.showBossBar(bar);
    }

    private JsonObject runCommand(JsonObject args) {
        if (!plugin.getConfig().getBoolean("allow-console-commands", false)) {
            throw new IllegalStateException("console commands disabled - set allow-console-commands: true in config.yml");
        }
        String command = Json.reqString(args, "command");
        boolean success = Bukkit.dispatchCommand(Bukkit.getConsoleSender(), command);
        JsonObject data = new JsonObject();
        data.addProperty("dispatched", success);
        return data;
    }

    // ---- persistence ----

    private File file() {
        return new File(plugin.getDataFolder(), "story.json");
    }

    public void save() {
        try {
            plugin.getDataFolder().mkdirs();
            Files.write(file().toPath(), storyState.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            plugin.getLogger().warning("Failed to save story.json: " + e.getMessage());
        }
    }

    private void loadState() {
        File f = file();
        if (!f.exists()) return;
        try {
            String s = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
            storyState = JsonParser.parseString(s).getAsJsonObject();
        } catch (Exception e) {
            plugin.getLogger().warning("Failed to load story.json: " + e.getMessage());
        }
    }
}
