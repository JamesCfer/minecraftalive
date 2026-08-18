package dev.celestia.minecraftalive.util;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Entity;

import java.util.Collection;

public final class Json {

    private Json() {}

    public static JsonObject parse(String s) {
        return JsonParser.parseString(s).getAsJsonObject();
    }

    public static String optString(JsonObject o, String key, String def) {
        JsonElement e = o.get(key);
        return e == null || e.isJsonNull() ? def : e.getAsString();
    }

    public static double optDouble(JsonObject o, String key, double def) {
        JsonElement e = o.get(key);
        return e == null || e.isJsonNull() ? def : e.getAsDouble();
    }

    public static int optInt(JsonObject o, String key, int def) {
        JsonElement e = o.get(key);
        return e == null || e.isJsonNull() ? def : e.getAsInt();
    }

    public static boolean optBool(JsonObject o, String key, boolean def) {
        JsonElement e = o.get(key);
        return e == null || e.isJsonNull() ? def : e.getAsBoolean();
    }

    public static String reqString(JsonObject o, String key) {
        JsonElement e = o.get(key);
        if (e == null || e.isJsonNull()) throw new IllegalArgumentException("missing required arg: " + key);
        return e.getAsString();
    }

    public static double reqDouble(JsonObject o, String key) {
        JsonElement e = o.get(key);
        if (e == null || e.isJsonNull()) throw new IllegalArgumentException("missing required arg: " + key);
        return e.getAsDouble();
    }

    public static JsonArray toArray(Collection<String> items) {
        JsonArray arr = new JsonArray();
        for (String s : items) arr.add(s);
        return arr;
    }

    public static String ok(String id, JsonObject data) {
        JsonObject o = new JsonObject();
        if (id != null) o.addProperty("id", id);
        o.addProperty("ok", true);
        o.add("data", data);
        return o.toString();
    }

    public static String error(String id, String message) {
        JsonObject o = new JsonObject();
        if (id != null) o.addProperty("id", id);
        o.addProperty("ok", false);
        o.addProperty("error", message);
        return o.toString();
    }

    /** Resolve a location from args: world (optional, defaults to first world), x, y, z. */
    public static Location location(JsonObject args) {
        World world = world(args);
        return new Location(world, reqDouble(args, "x"), reqDouble(args, "y"), reqDouble(args, "z"));
    }

    public static World world(JsonObject args) {
        String name = optString(args, "world", null);
        World world = name == null ? Bukkit.getWorlds().get(0) : Bukkit.getWorld(name);
        if (world == null) throw new IllegalArgumentException("unknown world: " + name);
        return world;
    }

    public static JsonObject locationJson(Location loc) {
        JsonObject o = new JsonObject();
        o.addProperty("world", loc.getWorld().getName());
        o.addProperty("x", Math.round(loc.getX() * 100.0) / 100.0);
        o.addProperty("y", Math.round(loc.getY() * 100.0) / 100.0);
        o.addProperty("z", Math.round(loc.getZ() * 100.0) / 100.0);
        return o;
    }

    public static JsonObject entityJson(Entity e) {
        JsonObject o = new JsonObject();
        o.addProperty("uuid", e.getUniqueId().toString());
        o.addProperty("type", e.getType().name());
        o.add("location", locationJson(e.getLocation()));
        return o;
    }
}
