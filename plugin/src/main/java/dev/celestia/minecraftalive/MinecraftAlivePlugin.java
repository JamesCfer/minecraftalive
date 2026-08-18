package dev.celestia.minecraftalive;

import dev.celestia.minecraftalive.bridge.BridgeServer;
import dev.celestia.minecraftalive.bridge.CommandDispatcher;
import dev.celestia.minecraftalive.handlers.NpcHandlers;
import dev.celestia.minecraftalive.handlers.PlayerHandlers;
import dev.celestia.minecraftalive.handlers.StoryHandlers;
import dev.celestia.minecraftalive.handlers.WorldHandlers;
import dev.celestia.minecraftalive.listeners.GameListeners;
import dev.celestia.minecraftalive.npc.NpcManager;
import net.kyori.adventure.text.Component;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.plugin.java.JavaPlugin;

import java.net.InetSocketAddress;

public final class MinecraftAlivePlugin extends JavaPlugin {

    private BridgeServer bridge;
    private NpcManager npcManager;
    private StoryHandlers storyHandlers;

    @Override
    public void onEnable() {
        saveDefaultConfig();

        npcManager = new NpcManager(this);
        npcManager.load();

        CommandDispatcher dispatcher = new CommandDispatcher(this);
        new WorldHandlers(this).register(dispatcher);
        new NpcHandlers(this, npcManager).register(dispatcher);
        PlayerHandlers playerHandlers = new PlayerHandlers(this);
        playerHandlers.register(dispatcher);
        storyHandlers = new StoryHandlers(this);
        storyHandlers.register(dispatcher);

        String host = getConfig().getString("bridge.host", "127.0.0.1");
        int port = getConfig().getInt("bridge.port", 8765);
        String token = getConfig().getString("bridge.token", "change-me");
        bridge = new BridgeServer(new InetSocketAddress(host, port), this, dispatcher, token);
        bridge.setReuseAddr(true);
        bridge.start();

        getServer().getPluginManager().registerEvents(
                new GameListeners(this, npcManager, bridge, storyHandlers), this);

        // clean up any duplicate/orphaned NPC entities once the world has settled
        getServer().getScheduler().runTaskLater(this, () -> {
            int removed = npcManager.sweepAllLoaded();
            if (removed > 0) getLogger().info("Removed " + removed + " duplicate/orphaned NPC entities");
        }, 60L);

        // NPC routine tick, every 5 seconds
        getServer().getScheduler().runTaskTimer(this, () -> npcManager.tickRoutines(), 100L, 100L);
        // Autosave NPCs + story every 5 minutes
        getServer().getScheduler().runTaskTimer(this, () -> {
            npcManager.save();
            storyHandlers.save();
        }, 6000L, 6000L);

        new dev.celestia.minecraftalive.update.Updater(this, getFile()).checkAsync();

        getLogger().info("MinecraftAlive bridge listening on ws://" + host + ":" + port);
        if ("change-me".equals(token)) {
            getLogger().warning("bridge.token is still the default! Set a real token in config.yml.");
        }
    }

    @Override
    public void onDisable() {
        if (npcManager != null) npcManager.save();
        if (storyHandlers != null) storyHandlers.save();
        if (bridge != null) {
            try {
                bridge.stop(1000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    public BridgeServer bridge() {
        return bridge;
    }

    public NpcManager npcManager() {
        return npcManager;
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (args.length > 0 && args[0].equalsIgnoreCase("status")) {
            sender.sendMessage(Component.text("[MinecraftAlive] bridge clients: " + bridge.clientCount()
                    + ", NPCs: " + npcManager.count()));
            return true;
        }
        if (args.length > 0 && args[0].equalsIgnoreCase("reload")) {
            reloadConfig();
            sender.sendMessage(Component.text("[MinecraftAlive] config reloaded (bridge restart requires server restart)"));
            return true;
        }
        return false;
    }
}
