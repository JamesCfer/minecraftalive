package dev.celestia.minecraftalive.handlers;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.celestia.minecraftalive.MinecraftAlivePlugin;
import dev.celestia.minecraftalive.bridge.CommandDispatcher;
import dev.celestia.minecraftalive.util.Json;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;

import java.util.Locale;

/** Block editing, world state, entity spawning. */
public class WorldHandlers {

    private final MinecraftAlivePlugin plugin;

    public WorldHandlers(MinecraftAlivePlugin plugin) {
        this.plugin = plugin;
    }

    public void register(CommandDispatcher d) {
        d.register("get_server_info", this::serverInfo);
        d.register("set_block", this::setBlock);
        d.register("get_block", this::getBlock);
        d.register("fill_region", this::fillRegion);
        d.register("set_time", this::setTime);
        d.register("set_weather", this::setWeather);
        d.register("spawn_entity", this::spawnEntity);
    }

    private JsonObject serverInfo(JsonObject args) {
        JsonObject data = new JsonObject();
        data.addProperty("version", Bukkit.getVersion());
        JsonArray worlds = new JsonArray();
        for (World w : Bukkit.getWorlds()) {
            JsonObject wo = new JsonObject();
            wo.addProperty("name", w.getName());
            wo.addProperty("time", w.getTime());
            wo.addProperty("storm", w.hasStorm());
            wo.addProperty("thundering", w.isThundering());
            wo.addProperty("players", w.getPlayers().size());
            worlds.add(wo);
        }
        data.add("worlds", worlds);
        data.addProperty("onlinePlayers", Bukkit.getOnlinePlayers().size());
        return data;
    }

    private Material material(String name) {
        Material m = Material.matchMaterial(name);
        if (m == null) throw new IllegalArgumentException("unknown material: " + name);
        return m;
    }

    private JsonObject setBlock(JsonObject args) {
        Location loc = Json.location(args);
        Material mat = material(Json.reqString(args, "material"));
        loc.getBlock().setType(mat);
        return null;
    }

    private JsonObject getBlock(JsonObject args) {
        Location loc = Json.location(args);
        Block b = loc.getBlock();
        JsonObject data = new JsonObject();
        data.addProperty("material", b.getType().getKey().getKey());
        data.addProperty("blockData", b.getBlockData().getAsString());
        return data;
    }

    private JsonObject fillRegion(JsonObject args) {
        World world = Json.world(args);
        int x1 = (int) Json.reqDouble(args, "x1"), y1 = (int) Json.reqDouble(args, "y1"), z1 = (int) Json.reqDouble(args, "z1");
        int x2 = (int) Json.reqDouble(args, "x2"), y2 = (int) Json.reqDouble(args, "y2"), z2 = (int) Json.reqDouble(args, "z2");
        Material mat = material(Json.reqString(args, "material"));
        boolean hollow = Json.optBool(args, "hollow", false);

        int minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
        int minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
        int minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);
        long volume = (long) (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
        long cap = plugin.getConfig().getLong("max-fill-volume", 100000);
        if (volume > cap) {
            throw new IllegalArgumentException("region too large: " + volume + " blocks (cap " + cap + ")");
        }
        long changed = 0;
        for (int x = minX; x <= maxX; x++) {
            for (int y = minY; y <= maxY; y++) {
                for (int z = minZ; z <= maxZ; z++) {
                    if (hollow && x != minX && x != maxX && y != minY && y != maxY && z != minZ && z != maxZ) {
                        continue;
                    }
                    world.getBlockAt(x, y, z).setType(mat, false);
                    changed++;
                }
            }
        }
        JsonObject data = new JsonObject();
        data.addProperty("blocksChanged", changed);
        return data;
    }

    private JsonObject setTime(JsonObject args) {
        World world = Json.world(args);
        world.setTime((long) Json.reqDouble(args, "time"));
        return null;
    }

    private JsonObject setWeather(JsonObject args) {
        World world = Json.world(args);
        String weather = Json.reqString(args, "weather").toLowerCase(Locale.ROOT);
        switch (weather) {
            case "clear" -> { world.setStorm(false); world.setThundering(false); }
            case "rain" -> { world.setStorm(true); world.setThundering(false); }
            case "thunder" -> { world.setStorm(true); world.setThundering(true); }
            default -> throw new IllegalArgumentException("weather must be clear|rain|thunder");
        }
        return null;
    }

    private JsonObject spawnEntity(JsonObject args) {
        Location loc = Json.location(args);
        EntityType type;
        try {
            type = EntityType.valueOf(Json.reqString(args, "type").toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("unknown entity type");
        }
        loc.getChunk().load();
        Entity entity = loc.getWorld().spawnEntity(loc, type);
        return Json.entityJson(entity);
    }
}
