package dev.celestia.minecraftalive.listeners;

import com.google.gson.JsonObject;
import dev.celestia.minecraftalive.MinecraftAlivePlugin;
import dev.celestia.minecraftalive.bridge.BridgeServer;
import dev.celestia.minecraftalive.handlers.StoryHandlers;
import dev.celestia.minecraftalive.npc.NpcData;
import dev.celestia.minecraftalive.npc.NpcManager;
import dev.celestia.minecraftalive.util.Json;
import io.papermc.paper.event.player.AsyncChatEvent;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.world.EntitiesLoadEvent;
import org.bukkit.inventory.EquipmentSlot;

/** Forwards the interesting things happening in the world to the game master. */
public class GameListeners implements Listener {

    private final MinecraftAlivePlugin plugin;
    private final NpcManager npcs;
    private final BridgeServer bridge;
    private final StoryHandlers story;

    public GameListeners(MinecraftAlivePlugin plugin, NpcManager npcs,
                         BridgeServer bridge, StoryHandlers story) {
        this.plugin = plugin;
        this.npcs = npcs;
        this.bridge = bridge;
        this.story = story;
    }

    @EventHandler
    public void onEntitiesLoad(EntitiesLoadEvent event) {
        // adopt or delete NPC-tagged entities as their chunks stream in, so
        // respawn logic can never leave duplicates behind
        npcs.sweepEntities(event.getEntities());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onChat(AsyncChatEvent event) {
        JsonObject data = new JsonObject();
        data.addProperty("player", event.getPlayer().getName());
        data.addProperty("message", PlainTextComponentSerializer.plainText().serialize(event.message()));
        data.add("location", Json.locationJson(event.getPlayer().getLocation()));
        bridge.broadcastEvent("player_chat", data);
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        story.showBarsTo(event.getPlayer());
        JsonObject data = new JsonObject();
        data.addProperty("player", event.getPlayer().getName());
        data.add("location", Json.locationJson(event.getPlayer().getLocation()));
        bridge.broadcastEvent("player_join", data);
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        JsonObject data = new JsonObject();
        data.addProperty("player", event.getPlayer().getName());
        bridge.broadcastEvent("player_quit", data);
    }

    @EventHandler
    public void onInteractEntity(PlayerInteractEntityEvent event) {
        if (event.getHand() != EquipmentSlot.HAND) return;
        NpcData npc = npcs.byEntity(event.getRightClicked());
        if (npc == null) return;
        event.setCancelled(true); // don't open villager trades etc.
        JsonObject data = new JsonObject();
        data.addProperty("player", event.getPlayer().getName());
        data.addProperty("npcId", npc.id);
        data.addProperty("npcName", npc.name);
        data.addProperty("npcRole", npc.role);
        bridge.broadcastEvent("npc_interact", data);
    }

    /**
     * NPCs walk their routines all day unattended; terrain mishaps should not quietly
     * kill the cast. Deliberate harm from players and mobs still lands.
     */
    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onNpcEnvironmentalDamage(EntityDamageEvent event) {
        if (event instanceof EntityDamageByEntityEvent) return;
        if (npcs.byEntity(event.getEntity()) == null) return;
        switch (event.getCause()) {
            case FALL, SUFFOCATION, DROWNING, CRAMMING, FLY_INTO_WALL, CONTACT, HOT_FLOOR, VOID ->
                    event.setCancelled(true);
            default -> { }
        }
    }

    @EventHandler
    public void onNpcDamaged(EntityDamageByEntityEvent event) {
        NpcData npc = npcs.byEntity(event.getEntity());
        if (npc == null) return;
        if (!(event.getDamager() instanceof Player player)) return;
        JsonObject data = new JsonObject();
        data.addProperty("player", player.getName());
        data.addProperty("npcId", npc.id);
        data.addProperty("npcName", npc.name);
        data.addProperty("damage", event.getFinalDamage());
        bridge.broadcastEvent("npc_attacked", data);
    }

    @EventHandler
    public void onEntityDeath(EntityDeathEvent event) {
        NpcData npc = npcs.byEntity(event.getEntity());
        if (npc == null) return;
        JsonObject data = new JsonObject();
        data.addProperty("npcId", npc.id);
        data.addProperty("npcName", npc.name);
        data.add("location", Json.locationJson(event.getEntity().getLocation()));
        bridge.broadcastEvent("npc_death", data);
    }

    @EventHandler
    public void onPlayerDeath(PlayerDeathEvent event) {
        JsonObject data = new JsonObject();
        data.addProperty("player", event.getPlayer().getName());
        data.addProperty("deathMessage", event.deathMessage() == null ? ""
                : PlainTextComponentSerializer.plainText().serialize(event.deathMessage()));
        data.add("location", Json.locationJson(event.getPlayer().getLocation()));
        bridge.broadcastEvent("player_death", data);
    }
}
