package dev.celestia.minecraftalive.update;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.celestia.minecraftalive.MinecraftAlivePlugin;

import java.io.File;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;

/**
 * Checks the GitHub Releases feed on startup and downloads a newer plugin jar into
 * Bukkit's plugins/update/ folder, which Paper applies automatically on the next
 * server start. Runs entirely off the main thread.
 */
public final class Updater {

    private final MinecraftAlivePlugin plugin;
    private final File currentJar;

    public Updater(MinecraftAlivePlugin plugin, File currentJar) {
        this.plugin = plugin;
        this.currentJar = currentJar;
    }

    /** Call from onEnable; schedules the async check. */
    public void checkAsync() {
        if (!plugin.getConfig().getBoolean("auto-update.enabled", true)) return;
        String repo = plugin.getConfig().getString("auto-update.github-repo", "");
        if (repo == null || repo.isBlank() || !repo.contains("/")) {
            plugin.getLogger().warning("auto-update.github-repo is not set; skipping update check");
            return;
        }
        plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> check(repo));
    }

    private void check(String repo) {
        try (HttpClient http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build()) {
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create("https://api.github.com/repos/" + repo + "/releases/latest"))
                    .header("Accept", "application/vnd.github+json")
                    .header("User-Agent", "MinecraftAlive-Updater")
                    .timeout(Duration.ofSeconds(15))
                    .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() != 200) {
                plugin.getLogger().info("Update check: GitHub returned " + resp.statusCode() + " (no release yet?)");
                return;
            }
            JsonObject release = JsonParser.parseString(resp.body()).getAsJsonObject();
            String tag = release.get("tag_name").getAsString();
            String remote = tag.startsWith("v") ? tag.substring(1) : tag;
            String local = plugin.getPluginMeta().getVersion();
            if (compareVersions(remote, local) <= 0) {
                plugin.getLogger().info("Update check: up to date (v" + local + ")");
                return;
            }

            String jarUrl = null;
            JsonArray assets = release.getAsJsonArray("assets");
            for (JsonElement a : assets) {
                JsonObject asset = a.getAsJsonObject();
                if (asset.get("name").getAsString().endsWith(".jar")) {
                    jarUrl = asset.get("browser_download_url").getAsString();
                    break;
                }
            }
            if (jarUrl == null) {
                plugin.getLogger().warning("Update check: release " + tag + " has no jar asset");
                return;
            }

            plugin.getLogger().info("Update found: v" + local + " -> v" + remote + ", downloading...");
            File updateDir = new File(plugin.getDataFolder().getParentFile(),
                    plugin.getServer().getUpdateFolder());
            updateDir.mkdirs();
            // must keep the same filename as the running jar for Paper to swap it in
            Path target = new File(updateDir, currentJar.getName()).toPath();
            Path tmp = Files.createTempFile(updateDir.toPath(), "mcalive-", ".part");
            HttpRequest dl = HttpRequest.newBuilder()
                    .uri(URI.create(jarUrl))
                    .header("User-Agent", "MinecraftAlive-Updater")
                    .timeout(Duration.ofMinutes(2))
                    .build();
            HttpResponse<InputStream> jar = http.send(dl, HttpResponse.BodyHandlers.ofInputStream());
            if (jar.statusCode() != 200) {
                plugin.getLogger().warning("Update download failed: HTTP " + jar.statusCode());
                Files.deleteIfExists(tmp);
                return;
            }
            try (InputStream in = jar.body()) {
                Files.copy(in, tmp, StandardCopyOption.REPLACE_EXISTING);
            }
            long size = Files.size(tmp);
            if (size < 10_000) { // sanity check: a real jar is never this small
                plugin.getLogger().warning("Update download looks truncated (" + size + " bytes), discarding");
                Files.deleteIfExists(tmp);
                return;
            }
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
            plugin.getLogger().info("Update v" + remote + " staged in " + updateDir.getName()
                    + "/ - it will apply automatically on the next server restart.");
        } catch (Exception e) {
            plugin.getLogger().warning("Update check failed: " + e.getMessage());
        }
    }

    /** Compare dotted numeric versions; positive if a > b. */
    static int compareVersions(String a, String b) {
        String[] pa = a.split("[.-]"), pb = b.split("[.-]");
        int n = Math.max(pa.length, pb.length);
        for (int i = 0; i < n; i++) {
            int va = i < pa.length ? parseIntSafe(pa[i]) : 0;
            int vb = i < pb.length ? parseIntSafe(pb[i]) : 0;
            if (va != vb) return Integer.compare(va, vb);
        }
        return 0;
    }

    private static int parseIntSafe(String s) {
        try {
            return Integer.parseInt(s.replaceAll("\\D", ""));
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
