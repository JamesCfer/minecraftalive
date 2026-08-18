package dev.celestia.minecraftalive.npc;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.celestia.minecraftalive.util.Json;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Persistent state for one living NPC. */
public class NpcData {

    /** One schedule entry: at world time {@code start} (0-23999) the NPC begins {@code action}. */
    public static class ScheduleEntry {
        public long start;
        /** goto_home | goto_work | wander | idle */
        public String action;
        /** wander radius in blocks */
        public double radius = 8;

        public JsonObject toJson() {
            JsonObject o = new JsonObject();
            o.addProperty("start", start);
            o.addProperty("action", action);
            o.addProperty("radius", radius);
            return o;
        }

        public static ScheduleEntry fromJson(JsonObject o) {
            ScheduleEntry e = new ScheduleEntry();
            e.start = o.get("start").getAsLong();
            e.action = Json.optString(o, "action", "idle");
            e.radius = Json.optDouble(o, "radius", 8);
            return e;
        }
    }

    public String id;
    public String name;
    public String entityType = "MANNEQUIN";
    public String profession;   // villager profession key, optional
    public String skin;         // Minecraft username whose skin a mannequin NPC wears
    public String role = "";    // free-text character sheet for the game master
    public UUID entityUuid;
    public Location home;
    public Location work;
    public Location lastLocation;
    public List<ScheduleEntry> schedule = new ArrayList<>();
    public transient long manualOverrideUntilMs = 0;
    public transient long lastRespawnMs = 0;
    /** Once true, the NPC has permanently died and must never be auto-respawned. */
    public boolean dead = false;
    /** ISO-8601 timestamp of death, or null if alive. */
    public String diedAt;

    /** Schedule entry active at the given world time, or null if no schedule. */
    public ScheduleEntry activeEntry(long worldTime) {
        if (schedule.isEmpty()) return null;
        ScheduleEntry best = schedule.get(schedule.size() - 1); // wraps around midnight
        for (ScheduleEntry e : schedule) {
            if (e.start <= worldTime) best = e;
        }
        return best;
    }

    public JsonObject toJson() {
        JsonObject o = new JsonObject();
        o.addProperty("id", id);
        o.addProperty("name", name);
        o.addProperty("entityType", entityType);
        if (profession != null) o.addProperty("profession", profession);
        if (skin != null) o.addProperty("skin", skin);
        o.addProperty("role", role);
        if (entityUuid != null) o.addProperty("entityUuid", entityUuid.toString());
        if (home != null) o.add("home", Json.locationJson(home));
        if (work != null) o.add("work", Json.locationJson(work));
        if (lastLocation != null) o.add("lastLocation", Json.locationJson(lastLocation));
        o.addProperty("dead", dead);
        if (diedAt != null) o.addProperty("diedAt", diedAt);
        JsonArray sched = new JsonArray();
        for (ScheduleEntry e : schedule) sched.add(e.toJson());
        o.add("schedule", sched);
        return o;
    }

    public static NpcData fromJson(JsonObject o) {
        NpcData d = new NpcData();
        d.id = o.get("id").getAsString();
        d.name = o.get("name").getAsString();
        d.entityType = Json.optString(o, "entityType", "MANNEQUIN");
        d.profession = Json.optString(o, "profession", null);
        d.skin = Json.optString(o, "skin", null);
        d.role = Json.optString(o, "role", "");
        String uuid = Json.optString(o, "entityUuid", null);
        if (uuid != null) d.entityUuid = UUID.fromString(uuid);
        d.home = locFrom(o.get("home"));
        d.work = locFrom(o.get("work"));
        d.lastLocation = locFrom(o.get("lastLocation"));
        d.dead = Json.optBool(o, "dead", false);
        d.diedAt = Json.optString(o, "diedAt", null);
        if (o.has("schedule")) {
            for (JsonElement e : o.getAsJsonArray("schedule")) {
                d.schedule.add(ScheduleEntry.fromJson(e.getAsJsonObject()));
            }
        }
        return d;
    }

    private static Location locFrom(JsonElement e) {
        if (e == null || !e.isJsonObject()) return null;
        JsonObject o = e.getAsJsonObject();
        World w = Bukkit.getWorld(Json.optString(o, "world", "world"));
        if (w == null) return null;
        return new Location(w, o.get("x").getAsDouble(), o.get("y").getAsDouble(), o.get("z").getAsDouble());
    }
}
