package dev.celestia.minecraftalive.handlers;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import dev.celestia.minecraftalive.MinecraftAlivePlugin;
import dev.celestia.minecraftalive.bridge.CommandDispatcher;
import dev.celestia.minecraftalive.util.Json;
import net.kyori.adventure.text.minimessage.MiniMessage;
import net.kyori.adventure.title.Title;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Particle;
import org.bukkit.Registry;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;

import java.time.Duration;
import java.util.Locale;

/** Player queries and direct player-facing effects. */
public class PlayerHandlers {

    private final MinecraftAlivePlugin plugin;
    private final MiniMessage mm = MiniMessage.miniMessage();

    public PlayerHandlers(MinecraftAlivePlugin plugin) {
        this.plugin = plugin;
    }

    public void register(CommandDispatcher d) {
        d.register("list_players", this::listPlayers);
        d.register("give_item", this::giveItem);
        d.register("send_message", this::sendMessage);
        d.register("broadcast", this::broadcast);
        d.register("show_title", this::showTitle);
        d.register("play_sound", this::playSound);
        d.register("spawn_particles", this::spawnParticles);
        d.register("apply_effect", this::applyEffect);
        d.register("teleport_player", this::teleport);
    }

    private Player requirePlayer(JsonObject args) {
        String name = Json.reqString(args, "player");
        Player p = Bukkit.getPlayerExact(name);
        if (p == null) throw new IllegalArgumentException("player not online: " + name);
        return p;
    }

    private JsonObject listPlayers(JsonObject args) {
        JsonArray arr = new JsonArray();
        for (Player p : Bukkit.getOnlinePlayers()) {
            JsonObject o = new JsonObject();
            o.addProperty("name", p.getName());
            o.add("location", Json.locationJson(p.getLocation()));
            o.addProperty("health", p.getHealth());
            o.addProperty("foodLevel", p.getFoodLevel());
            o.addProperty("level", p.getLevel());
            o.addProperty("gameMode", p.getGameMode().name());
            ItemStack hand = p.getInventory().getItemInMainHand();
            o.addProperty("heldItem", hand.getType().getKey().getKey());
            arr.add(o);
        }
        JsonObject data = new JsonObject();
        data.add("players", arr);
        return data;
    }

    private JsonObject giveItem(JsonObject args) {
        Player p = requirePlayer(args);
        Material mat = Material.matchMaterial(Json.reqString(args, "material"));
        if (mat == null) throw new IllegalArgumentException("unknown material");
        int amount = Json.optInt(args, "amount", 1);
        ItemStack item = new ItemStack(mat, amount);
        String displayName = Json.optString(args, "displayName", null);
        String lore = Json.optString(args, "lore", null);
        if (displayName != null || lore != null) {
            item.editMeta(meta -> {
                if (displayName != null) meta.displayName(mm.deserialize("<!italic>" + displayName));
                if (lore != null) meta.lore(java.util.List.of(mm.deserialize("<!italic><gray>" + lore)));
            });
        }
        p.getInventory().addItem(item);
        return null;
    }

    /** Message text supports MiniMessage formatting, e.g. <gold>, <bold>. */
    private JsonObject sendMessage(JsonObject args) {
        requirePlayer(args).sendMessage(mm.deserialize(Json.reqString(args, "text")));
        return null;
    }

    private JsonObject broadcast(JsonObject args) {
        Bukkit.broadcast(mm.deserialize(Json.reqString(args, "text")));
        return null;
    }

    private JsonObject showTitle(JsonObject args) {
        Title title = Title.title(
                mm.deserialize(Json.optString(args, "title", "")),
                mm.deserialize(Json.optString(args, "subtitle", "")),
                Title.Times.times(Duration.ofMillis(500),
                        Duration.ofMillis((long) (Json.optDouble(args, "seconds", 3) * 1000)),
                        Duration.ofMillis(1000)));
        String player = Json.optString(args, "player", null);
        if (player == null) {
            for (Player p : Bukkit.getOnlinePlayers()) p.showTitle(title);
        } else {
            requirePlayer(args).showTitle(title);
        }
        return null;
    }

    private JsonObject playSound(JsonObject args) {
        String sound = Json.reqString(args, "sound");
        float volume = (float) Json.optDouble(args, "volume", 1.0);
        float pitch = (float) Json.optDouble(args, "pitch", 1.0);
        String player = Json.optString(args, "player", null);
        if (player != null) {
            Player p = requirePlayer(args);
            p.playSound(p.getLocation(), sound, volume, pitch);
        } else {
            Location loc = Json.location(args);
            loc.getWorld().playSound(loc, sound, volume, pitch);
        }
        return null;
    }

    private JsonObject spawnParticles(JsonObject args) {
        Location loc = Json.location(args);
        Particle particle;
        try {
            particle = Particle.valueOf(Json.reqString(args, "particle").toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("unknown particle");
        }
        int count = Json.optInt(args, "count", 20);
        double spread = Json.optDouble(args, "spread", 0.5);
        loc.getWorld().spawnParticle(particle, loc, count, spread, spread, spread, 0.02);
        return null;
    }

    private JsonObject applyEffect(JsonObject args) {
        Player p = requirePlayer(args);
        String name = Json.reqString(args, "effect").toLowerCase(Locale.ROOT);
        PotionEffectType type = Registry.EFFECT.get(NamespacedKey.minecraft(name));
        if (type == null) throw new IllegalArgumentException("unknown effect: " + name);
        int seconds = Json.optInt(args, "seconds", 30);
        int amplifier = Json.optInt(args, "amplifier", 0);
        p.addPotionEffect(new PotionEffect(type, seconds * 20, amplifier));
        return null;
    }

    private JsonObject teleport(JsonObject args) {
        Player p = requirePlayer(args);
        p.teleport(Json.location(args));
        return null;
    }
}
