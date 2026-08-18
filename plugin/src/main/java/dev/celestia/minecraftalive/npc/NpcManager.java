package dev.celestia.minecraftalive.npc;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.celestia.minecraftalive.MinecraftAlivePlugin;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Villager;
import org.bukkit.persistence.PersistentDataType;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.ConcurrentHashMap;

/** Registry, persistence, and routine ticking for living NPCs. */
public class NpcManager {

    private final MinecraftAlivePlugin plugin;
    private final NamespacedKey npcKey;
    private final Map<String, NpcData> npcs = new ConcurrentHashMap<>();
    private final Random random = new Random();

    public NpcManager(MinecraftAlivePlugin plugin) {
        this.plugin = plugin;
        this.npcKey = new NamespacedKey(plugin, "npc_id");
    }

    public NamespacedKey key() {
        return npcKey;
    }

    public NpcData get(String id) {
        return npcs.get(id);
    }

    public NpcData byEntity(Entity entity) {
        String id = entity.getPersistentDataContainer().get(npcKey, PersistentDataType.STRING);
        return id == null ? null : npcs.get(id);
    }

    public List<NpcData> all() {
        return new ArrayList<>(npcs.values());
    }

    public int count() {
        return npcs.size();
    }

    /** Spawn the backing entity for an NPC record and register it. */
    public Entity spawn(NpcData data, Location loc) {
        EntityType type;
        try {
            type = EntityType.valueOf(data.entityType.toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("unknown entity type: " + data.entityType);
        }
        loc.getChunk().load();
        Entity entity = loc.getWorld().spawnEntity(loc, type);
        applyIdentity(entity, data);
        data.entityUuid = entity.getUniqueId();
        data.lastLocation = loc.clone();
        npcs.put(data.id, data);
        return entity;
    }

    private void applyIdentity(Entity entity, NpcData data) {
        entity.customName(Component.text(data.name, NamedTextColor.GOLD));
        entity.setCustomNameVisible(true);
        entity.setPersistent(true);
        entity.getPersistentDataContainer().set(npcKey, PersistentDataType.STRING, data.id);
        if (entity instanceof LivingEntity living) {
            living.setRemoveWhenFarAway(false);
        }
        if (entity instanceof Villager villager && data.profession != null) {
            Villager.Profession prof = switch (data.profession.toLowerCase(Locale.ROOT)) {
                case "armorer" -> Villager.Profession.ARMORER;
                case "butcher" -> Villager.Profession.BUTCHER;
                case "cartographer" -> Villager.Profession.CARTOGRAPHER;
                case "cleric" -> Villager.Profession.CLERIC;
                case "farmer" -> Villager.Profession.FARMER;
                case "fisherman" -> Villager.Profession.FISHERMAN;
                case "fletcher" -> Villager.Profession.FLETCHER;
                case "leatherworker" -> Villager.Profession.LEATHERWORKER;
                case "librarian" -> Villager.Profession.LIBRARIAN;
                case "mason" -> Villager.Profession.MASON;
                case "nitwit" -> Villager.Profession.NITWIT;
                case "shepherd" -> Villager.Profession.SHEPHERD;
                case "toolsmith" -> Villager.Profession.TOOLSMITH;
                case "weaponsmith" -> Villager.Profession.WEAPONSMITH;
                default -> Villager.Profession.NONE;
            };
            villager.setProfession(prof);
        }
    }

    /** Remove an NPC and its entity. Returns true if it existed. */
    public boolean remove(String id) {
        NpcData data = npcs.remove(id);
        if (data == null) return false;
        Entity entity = resolveEntity(data);
        if (entity != null) entity.remove();
        return true;
    }

    /** The live entity backing an NPC, respawning it if it went missing. Null if unresolvable. */
    public Entity resolveEntity(NpcData data) {
        if (data.entityUuid != null) {
            Entity e = Bukkit.getEntity(data.entityUuid);
            if (e != null && e.isValid()) return e;
        }
        Location loc = data.lastLocation != null ? data.lastLocation
                : data.home != null ? data.home : data.work;
        if (loc == null || loc.getWorld() == null) return null;
        try {
            Entity e = spawn(data, loc.clone());
            plugin.getLogger().info("Respawned missing NPC " + data.id + " at " + loc);
            return e;
        } catch (Exception ex) {
            plugin.getLogger().warning("Could not respawn NPC " + data.id + ": " + ex.getMessage());
            return null;
        }
    }

    /** Called every 100 ticks: advance every NPC's daily routine. */
    public void tickRoutines() {
        for (NpcData data : npcs.values()) {
            try {
                tickOne(data);
            } catch (Exception e) {
                plugin.getLogger().warning("NPC tick failed for " + data.id + ": " + e.getMessage());
            }
        }
    }

    private void tickOne(NpcData data) {
        Entity entity = resolveEntity(data);
        if (entity == null) return;
        data.lastLocation = entity.getLocation().clone();
        if (System.currentTimeMillis() < data.manualOverrideUntilMs) return;
        if (!(entity instanceof Mob mob)) return;

        NpcData.ScheduleEntry entry = data.activeEntry(entity.getWorld().getTime());
        if (entry == null) return;
        switch (entry.action) {
            case "goto_home" -> walkTowards(mob, data.home);
            case "goto_work" -> walkTowards(mob, data.work);
            case "wander" -> {
                if (random.nextDouble() < 0.35) {
                    Location anchor = data.work != null ? data.work : entity.getLocation();
                    Location target = anchor.clone().add(
                            (random.nextDouble() * 2 - 1) * entry.radius,
                            0,
                            (random.nextDouble() * 2 - 1) * entry.radius);
                    target.setY(anchor.getWorld().getHighestBlockYAt(target) + 1);
                    mob.getPathfinder().moveTo(target, 1.0);
                }
            }
            default -> { /* idle */ }
        }
    }

    private void walkTowards(Mob mob, Location target) {
        if (target == null || target.getWorld() != mob.getWorld()) return;
        if (mob.getLocation().distanceSquared(target) > 9) {
            mob.getPathfinder().moveTo(target, 1.0);
        }
    }

    // ---- persistence ----

    private File file() {
        return new File(plugin.getDataFolder(), "npcs.json");
    }

    public void save() {
        try {
            plugin.getDataFolder().mkdirs();
            JsonArray arr = new JsonArray();
            for (NpcData d : npcs.values()) arr.add(d.toJson());
            Files.write(file().toPath(), arr.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            plugin.getLogger().warning("Failed to save npcs.json: " + e.getMessage());
        }
    }

    public void load() {
        File f = file();
        if (!f.exists()) return;
        try {
            String s = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
            for (JsonElement e : JsonParser.parseString(s).getAsJsonArray()) {
                NpcData d = NpcData.fromJson(e.getAsJsonObject());
                npcs.put(d.id, d);
            }
            plugin.getLogger().info("Loaded " + npcs.size() + " NPCs");
        } catch (Exception e) {
            plugin.getLogger().warning("Failed to load npcs.json: " + e.getMessage());
        }
    }

    public void putRaw(NpcData data) {
        npcs.put(data.id, data);
    }

    public JsonObject toJson(NpcData d) {
        JsonObject o = d.toJson();
        Entity e = d.entityUuid == null ? null : Bukkit.getEntity(d.entityUuid);
        o.addProperty("alive", e != null && e.isValid());
        return o;
    }
}
