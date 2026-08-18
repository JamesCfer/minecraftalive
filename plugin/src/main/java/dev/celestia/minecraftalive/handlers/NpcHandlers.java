package dev.celestia.minecraftalive.handlers;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.celestia.minecraftalive.MinecraftAlivePlugin;
import dev.celestia.minecraftalive.bridge.CommandDispatcher;
import dev.celestia.minecraftalive.npc.NpcData;
import dev.celestia.minecraftalive.npc.NpcManager;
import dev.celestia.minecraftalive.util.Json;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Location;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Player;

/** Spawning, directing, and voicing NPCs. */
public class NpcHandlers {

    private final MinecraftAlivePlugin plugin;
    private final NpcManager npcs;

    public NpcHandlers(MinecraftAlivePlugin plugin, NpcManager npcs) {
        this.plugin = plugin;
        this.npcs = npcs;
    }

    public void register(CommandDispatcher d) {
        d.register("npc_spawn", this::spawn);
        d.register("npc_update", this::update);
        d.register("npc_remove", this::remove);
        d.register("npc_list", this::list);
        d.register("npc_get", this::get);
        d.register("npc_say", this::say);
        d.register("npc_move_to", this::moveTo);
    }

    private NpcData require(JsonObject args) {
        NpcData data = npcs.get(Json.reqString(args, "id"));
        if (data == null) throw new IllegalArgumentException("no NPC with id: " + Json.reqString(args, "id"));
        return data;
    }

    private JsonObject spawn(JsonObject args) {
        String id = Json.reqString(args, "id");
        if (npcs.get(id) != null) throw new IllegalArgumentException("NPC id already exists: " + id);
        NpcData data = new NpcData();
        data.id = id;
        data.name = Json.reqString(args, "name");
        data.entityType = Json.optString(args, "entityType", "MANNEQUIN");
        data.profession = Json.optString(args, "profession", null);
        data.skin = Json.optString(args, "skin", null);
        data.role = Json.optString(args, "role", "");
        applyPlaces(data, args);
        Location loc = Json.location(args);
        npcs.spawn(data, loc);
        applySchedule(data, args);
        npcs.save();
        return npcs.toJson(data);
    }

    private void applyPlaces(NpcData data, JsonObject args) {
        if (args.has("home") && args.get("home").isJsonObject()) {
            data.home = Json.location(args.getAsJsonObject("home"));
        }
        if (args.has("work") && args.get("work").isJsonObject()) {
            data.work = Json.location(args.getAsJsonObject("work"));
        }
    }

    private void applySchedule(NpcData data, JsonObject args) {
        if (!args.has("schedule") || !args.get("schedule").isJsonArray()) return;
        data.schedule.clear();
        for (JsonElement e : args.getAsJsonArray("schedule")) {
            data.schedule.add(NpcData.ScheduleEntry.fromJson(e.getAsJsonObject()));
        }
    }

    private JsonObject update(JsonObject args) {
        NpcData data = require(args);
        if (args.has("name")) {
            data.name = Json.reqString(args, "name");
            Entity e = npcs.resolveEntity(data);
            if (e != null) e.customName(Component.text(data.name, NamedTextColor.GOLD));
        }
        if (args.has("role")) data.role = Json.optString(args, "role", "");
        boolean respawn = false;
        if (args.has("entityType")) {
            String type = Json.reqString(args, "entityType");
            respawn = !type.equalsIgnoreCase(data.entityType);
            data.entityType = type;
        }
        if (args.has("profession")) {
            data.profession = Json.optString(args, "profession", null);
            respawn = true;
        }
        if (args.has("skin")) {
            data.skin = Json.optString(args, "skin", null);
            respawn = true;
        }
        if (respawn) npcs.respawn(data); // swap the backing entity to match the new look
        applyPlaces(data, args);
        applySchedule(data, args);
        npcs.save();
        return npcs.toJson(data);
    }

    private JsonObject remove(JsonObject args) {
        String id = Json.reqString(args, "id");
        boolean removed = npcs.remove(id);
        if (!removed) throw new IllegalArgumentException("no NPC with id: " + id);
        npcs.save();
        return null;
    }

    private JsonObject list(JsonObject args) {
        JsonArray arr = new JsonArray();
        for (NpcData d : npcs.all()) arr.add(npcs.toJson(d));
        JsonObject data = new JsonObject();
        data.add("npcs", arr);
        return data;
    }

    private JsonObject get(JsonObject args) {
        return npcs.toJson(require(args));
    }

    private JsonObject say(JsonObject args) {
        NpcData data = require(args);
        String text = Json.reqString(args, "text");
        Entity entity = npcs.resolveEntity(data);
        if (entity == null) throw new IllegalStateException("NPC entity could not be resolved");
        double radius = plugin.getConfig().getDouble("npc-chat-radius", 20.0);

        Component msg = Component.text(data.name, NamedTextColor.GOLD)
                .append(Component.text(": ", NamedTextColor.GRAY))
                .append(Component.text(text, NamedTextColor.WHITE));
        int heard = 0;
        for (Player p : entity.getWorld().getPlayers()) {
            if (p.getLocation().distanceSquared(entity.getLocation()) <= radius * radius) {
                p.sendMessage(msg);
                heard++;
            }
        }
        if (entity instanceof org.bukkit.entity.Villager) {
            entity.getWorld().playSound(entity.getLocation(), "entity.villager.ambient", 1.0f, 1.0f);
        }
        // face the nearest player while speaking
        Player nearest = null;
        double best = Double.MAX_VALUE;
        for (Player p : entity.getWorld().getPlayers()) {
            double d2 = p.getLocation().distanceSquared(entity.getLocation());
            if (d2 < best) { best = d2; nearest = p; }
        }
        if (nearest != null && best <= radius * radius) {
            npcs.face(entity, nearest.getLocation());
        }
        JsonObject out = new JsonObject();
        out.addProperty("playersHeard", heard);
        return out;
    }

    private JsonObject moveTo(JsonObject args) {
        NpcData data = require(args);
        Location target = Json.location(args);
        double speed = Json.optDouble(args, "speed", 1.0);
        // pause the daily routine so the walk isn't overridden
        data.manualOverrideUntilMs = System.currentTimeMillis() + (long) (Json.optDouble(args, "holdSeconds", 60) * 1000);
        boolean started = npcs.walkTo(data, target, speed);
        JsonObject out = new JsonObject();
        out.addProperty("pathStarted", started);
        return out;
    }
}
